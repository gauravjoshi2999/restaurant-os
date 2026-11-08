-- Bite: owner-only cancellation decisions and one pending cancellation per order.
create unique index if not exists restaurant_customer_order_requests_one_pending_cancel
on public.restaurant_customer_order_requests(order_id)
where request_type='cancel_request' and status='Pending';

create or replace function public.create_customer_order_request(
 p_order_id uuid, p_request_type text, p_message text
) returns uuid
language plpgsql security definer set search_path=''
as $function$
declare v_order public.orders%rowtype; v_request_id uuid;
begin
 if auth.uid() is null then raise exception 'Customer login required.'; end if;
 if p_request_type not in ('cancel_request','complaint') then raise exception 'Invalid request type.'; end if;
 if p_message is null or length(btrim(p_message))<3 or length(btrim(p_message))>500 then
  raise exception 'Please enter a reason between 3 and 500 characters.';
 end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.customer_id<>(select auth.uid()) then raise exception 'Order not found for this customer.'; end if;
 if p_request_type='cancel_request' then
  if v_order.status not in ('Accepted','Preparing','Ready') then
   raise exception 'Cancellation request is available only before delivery handover.';
  end if;
  if exists(select 1 from public.restaurant_customer_order_requests r
    where r.order_id=v_order.id and r.request_type='cancel_request' and r.status='Pending') then
   raise exception 'A cancellation request is already pending for this order.';
  end if;
 elsif v_order.status<>'Completed' then
  raise exception 'You can report an issue after delivery is completed.';
 end if;
 insert into public.restaurant_customer_order_requests(restaurant_id,order_id,customer_id,request_type,message)
 values(v_order.restaurant_id,v_order.id,(select auth.uid()),p_request_type,btrim(p_message))
 returning id into v_request_id;
 return v_request_id;
end;
$function$;

create or replace function public.respond_customer_order_request(
 p_request_id uuid, p_decision text, p_response text
) returns boolean
language plpgsql security definer set search_path=''
as $function$
declare v_request public.restaurant_customer_order_requests%rowtype; v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Restaurant login required.'; end if;
 select * into v_request from public.restaurant_customer_order_requests where id=p_request_id for update;
 if not found then raise exception 'Request not found.'; end if;
 if v_request.status<>'Pending' then raise exception 'This request has already been handled.'; end if;
 if p_response is null or length(btrim(p_response))<3 or length(btrim(p_response))>500 then
  raise exception 'Response must be 3 to 500 characters.';
 end if;
 if v_request.request_type='cancel_request' then
  if not public.has_restaurant_role(v_request.restaurant_id,array['owner']) then
   raise exception 'Only the restaurant Owner can approve or reject a cancellation request.';
  end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Cancellation decision must be Approved or Rejected.'; end if;
  if p_decision='Approved' then
   select * into v_order from public.orders where id=v_request.order_id and restaurant_id=v_request.restaurant_id for update;
   if not found or v_order.status not in ('Accepted','Preparing','Ready') then
    raise exception 'Order can no longer be cancelled.';
   end if;
   perform set_config('app.restaurant_cancel_request','true',true);
   update public.orders set status='Cancelled',status_note='Customer cancellation request approved by restaurant Owner'
   where id=v_order.id;
  end if;
 else
  if not public.has_restaurant_role(v_request.restaurant_id,array['owner','manager']) then
   raise exception 'Owner/Manager access required.';
  end if;
  if p_decision not in ('Resolved','Rejected') then raise exception 'Complaint decision must be Resolved or Rejected.'; end if;
 end if;
 update public.restaurant_customer_order_requests
 set status=p_decision,response=btrim(p_response),responded_by=(select auth.uid()),responded_at=now(),updated_at=now()
 where id=v_request.id;
 return true;
end;
$function$;

revoke all on function public.create_customer_order_request(uuid,text,text) from public;
revoke all on function public.respond_customer_order_request(uuid,text,text) from public;
grant execute on function public.create_customer_order_request(uuid,text,text) to authenticated;
grant execute on function public.respond_customer_order_request(uuid,text,text) to authenticated;
