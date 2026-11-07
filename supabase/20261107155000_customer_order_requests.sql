-- Bite customer cancellation before acceptance, cancellation requests after acceptance,
-- and post-delivery complaint/reply workflow.

create table if not exists public.restaurant_customer_order_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null check (request_type in ('cancel_request','complaint')),
  message text not null check (length(btrim(message)) between 3 and 500),
  status text not null default 'Pending' check (status in ('Pending','Approved','Rejected','Resolved')),
  response text,
  responded_by uuid references auth.users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists restaurant_customer_cancel_request_pending_unique
 on public.restaurant_customer_order_requests(order_id,customer_id) where request_type='cancel_request' and status='Pending';
create index if not exists restaurant_customer_order_requests_restaurant_status_idx
 on public.restaurant_customer_order_requests(restaurant_id,status,created_at desc);
create index if not exists restaurant_customer_order_requests_customer_idx
 on public.restaurant_customer_order_requests(customer_id,created_at desc);
alter table public.restaurant_customer_order_requests enable row level security;

drop policy if exists "customers read own order requests" on public.restaurant_customer_order_requests;
create policy "customers read own order requests" on public.restaurant_customer_order_requests for select to authenticated using (customer_id=(select auth.uid()));
drop policy if exists "restaurant teams read order requests" on public.restaurant_customer_order_requests;
create policy "restaurant teams read order requests" on public.restaurant_customer_order_requests for select to authenticated using (public.is_platform_admin() or public.is_restaurant_member(restaurant_id));
drop policy if exists "customers create own order requests" on public.restaurant_customer_order_requests;
create policy "customers create own order requests" on public.restaurant_customer_order_requests for insert to authenticated with check (customer_id=(select auth.uid()) and exists(select 1 from public.orders o where o.id=order_id and o.restaurant_id=restaurant_customer_order_requests.restaurant_id and o.customer_id=(select auth.uid())));
drop policy if exists "owners managers respond to order requests" on public.restaurant_customer_order_requests;
create policy "owners managers respond to order requests" on public.restaurant_customer_order_requests for update to authenticated using (public.has_restaurant_role(restaurant_id,array['owner','manager'])) with check (public.has_restaurant_role(restaurant_id,array['owner','manager']));
grant select,insert,update on public.restaurant_customer_order_requests to authenticated;

-- Keep the owner-only status update rule while allowing these narrow validated RPC paths.
create or replace function public.enforce_owner_order_status_updates()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare jwt_role text := coalesce((select auth.jwt())->>'role','');
begin
 if new.status is distinct from old.status
    and current_setting('app.delivery_handoff_confirm',true)='true'
    and old.status='Handed Over' and new.status='Completed' then
   return new;
 end if;
 if new.status is distinct from old.status
    and current_setting('app.customer_cancel',true)='true'
    and old.status='Received' and new.status='Cancelled'
    and old.customer_id=(select auth.uid()) then
   return new;
 end if;
 if new.status is distinct from old.status
    and current_setting('app.restaurant_cancel_request',true)='true'
    and old.status in ('Accepted','Preparing','Ready') and new.status='Cancelled' then
   return new;
 end if;
 if new.status is distinct from old.status
    and jwt_role<>'service_role'
    and not public.has_restaurant_role(new.restaurant_id,array['owner']) then
   raise exception 'Only the restaurant Owner can update order status.';
 end if;
 return new;
end;
$function$;

create or replace function public.customer_cancel_order(p_order_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Customer login required.'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.customer_id<>(select auth.uid()) then raise exception 'Order not found for this customer.'; end if;
 if v_order.status<>'Received' then raise exception 'Direct cancellation is available only before restaurant acceptance. Submit a cancellation request instead.'; end if;
 perform set_config('app.customer_cancel','true',true);
 update public.orders set status='Cancelled',status_note='Cancelled by customer before restaurant acceptance' where id=v_order.id;
 return true;
end;
$function$;

create or replace function public.create_customer_order_request(p_order_id uuid,p_request_type text,p_message text)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare v_order public.orders%rowtype; v_request_id uuid;
begin
 if auth.uid() is null then raise exception 'Customer login required.'; end if;
 if p_request_type not in ('cancel_request','complaint') then raise exception 'Invalid request type.'; end if;
 if p_message is null or length(btrim(p_message))<3 or length(btrim(p_message))>500 then raise exception 'Please enter a reason between 3 and 500 characters.'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.customer_id<>(select auth.uid()) then raise exception 'Order not found for this customer.'; end if;
 if p_request_type='cancel_request' and v_order.status not in ('Accepted','Preparing','Ready') then raise exception 'Cancellation request is available only before delivery handover.'; end if;
 if p_request_type='complaint' and v_order.status<>'Completed' then raise exception 'You can report an issue after delivery is completed.'; end if;
 insert into public.restaurant_customer_order_requests(restaurant_id,order_id,customer_id,request_type,message)
 values(v_order.restaurant_id,v_order.id,(select auth.uid()),p_request_type,btrim(p_message)) returning id into v_request_id;
 return v_request_id;
end;
$function$;

create or replace function public.respond_customer_order_request(p_request_id uuid,p_decision text,p_response text)
returns boolean language plpgsql security definer set search_path=''
as $function$
declare v_request public.restaurant_customer_order_requests%rowtype; v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Restaurant login required.'; end if;
 select * into v_request from public.restaurant_customer_order_requests where id=p_request_id for update;
 if not found then raise exception 'Request not found.'; end if;
 if not public.has_restaurant_role(v_request.restaurant_id,array['owner','manager']) then raise exception 'Owner/Manager access required.'; end if;
 if v_request.status<>'Pending' then raise exception 'This request has already been handled.'; end if;
 if p_response is null or length(btrim(p_response))<3 or length(btrim(p_response))>500 then raise exception 'Response must be 3 to 500 characters.'; end if;
 if v_request.request_type='cancel_request' then
  if p_decision not in ('Approved','Rejected') then raise exception 'Cancellation decision must be Approved or Rejected.'; end if;
  if p_decision='Approved' then
   select * into v_order from public.orders where id=v_request.order_id and restaurant_id=v_request.restaurant_id for update;
   if not found or v_order.status not in ('Accepted','Preparing','Ready') then raise exception 'Order can no longer be cancelled.'; end if;
   perform set_config('app.restaurant_cancel_request','true',true);
   update public.orders set status='Cancelled',status_note='Customer cancellation request approved' where id=v_order.id;
  end if;
 else
  if p_decision not in ('Resolved','Rejected') then raise exception 'Complaint decision must be Resolved or Rejected.'; end if;
 end if;
 update public.restaurant_customer_order_requests set status=p_decision,response=btrim(p_response),responded_by=(select auth.uid()),responded_at=now(),updated_at=now() where id=v_request.id;
 return true;
end;
$function$;

revoke execute on function public.customer_cancel_order(uuid) from public,anon;
grant execute on function public.customer_cancel_order(uuid) to authenticated;
revoke execute on function public.create_customer_order_request(uuid,text,text) from public,anon;
grant execute on function public.create_customer_order_request(uuid,text,text) to authenticated;
revoke execute on function public.respond_customer_order_request(uuid,text,text) from public,anon;
grant execute on function public.respond_customer_order_request(uuid,text,text) to authenticated;