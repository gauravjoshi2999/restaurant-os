-- Bite marketplace delivery handoff: capability link + customer OTP
-- Apply to Supabase project wedbgpybbgsszcmffoha.

create table if not exists public.restaurant_delivery_handoffs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash bytea not null unique,
  delivery_otp text not null check (delivery_otp ~ '^[0-9]{4}$'),
  otp_attempts integer not null default 0 check (otp_attempts between 0 and 5),
  is_active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create unique index if not exists restaurant_delivery_handoffs_one_active_order
  on public.restaurant_delivery_handoffs(order_id) where is_active;
create index if not exists restaurant_delivery_handoffs_restaurant_idx
  on public.restaurant_delivery_handoffs(restaurant_id, created_at desc);
alter table public.restaurant_delivery_handoffs enable row level security;
revoke all on public.restaurant_delivery_handoffs from anon, authenticated;

-- Include customer map pin in address snapshot for future marketplace orders.
do $do$
declare v_def text;
begin
  select pg_get_functiondef('public.place_customer_order(uuid,text,uuid,text,jsonb)'::regprocedure) into v_def;
  if position('''latitude'', a.latitude' in v_def)=0 then
    v_def := replace(v_def, '''postal_code'', a.postal_code', '''postal_code'', a.postal_code, ''latitude'', a.latitude, ''longitude'', a.longitude');
    if position('''latitude'', a.latitude' in v_def)=0 then raise exception 'Could not add customer map coordinates to delivery snapshot'; end if;
    execute v_def;
  end if;
end $do$;

create or replace function public.create_delivery_handoff(p_order_id uuid)
returns table(token text, order_code text, customer_name text, customer_phone text, delivery_address jsonb, customer_note text, restaurant_name text, items jsonb)
language plpgsql security definer set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_token text;
  v_otp text;
begin
  if auth.uid() is null then raise exception 'Owner login required.'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'Order not found.'; end if;
  if not public.has_restaurant_role(v_order.restaurant_id,array['owner']) then
    raise exception 'Only the restaurant owner can create a delivery handoff link.';
  end if;
  if v_order.status <> 'Ready' or v_order.delivery_type <> 'delivery' or v_order.customer_id is null or v_order.delivery_address_snapshot is null then
    raise exception 'Delivery link is available only for a Ready marketplace delivery order with customer address.';
  end if;
  update public.restaurant_delivery_handoffs set is_active=false where order_id=p_order_id and is_active;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_otp := lpad((floor(random()*10000))::integer::text,4,'0');
  insert into public.restaurant_delivery_handoffs(order_id,restaurant_id,token_hash,delivery_otp,created_by)
    values(p_order_id,v_order.restaurant_id,extensions.digest(v_token,'sha256'),v_otp,auth.uid());
  return query
    select v_token,v_order.order_code,v_order.customer_name,v_order.customer_phone,
      v_order.delivery_address_snapshot,v_order.customer_note,r.name,
      coalesce((select jsonb_agg(jsonb_build_object('item_name',oi.item_name,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total) order by oi.created_at)
        from public.order_items oi where oi.order_id=p_order_id),'[]'::jsonb)
    from public.restaurants r where r.id=v_order.restaurant_id;
end;
$function$;

create or replace function public.get_delivery_handoff(p_token text)
returns table(order_code text, customer_name text, customer_phone text, delivery_address jsonb, customer_note text, restaurant_name text, items jsonb, order_status text)
language sql stable security definer set search_path = ''
as $function$
  select o.order_code,o.customer_name,o.customer_phone,o.delivery_address_snapshot,o.customer_note,r.name,
    coalesce((select jsonb_agg(jsonb_build_object('item_name',oi.item_name,'quantity',oi.quantity,'unit_price',oi.unit_price,'line_total',oi.line_total) order by oi.created_at)
      from public.order_items oi where oi.order_id=o.id),'[]'::jsonb),o.status
  from public.restaurant_delivery_handoffs h
  join public.orders o on o.id=h.order_id and o.restaurant_id=h.restaurant_id
  join public.restaurants r on r.id=h.restaurant_id
  where p_token is not null and h.token_hash=extensions.digest(p_token,'sha256')
    and h.is_active and h.expires_at>now() and h.verified_at is null
    and o.status in ('Ready','Handed Over');
$function$;

create or replace function public.get_my_delivery_otp(p_order_id uuid)
returns table(order_code text, delivery_otp text)
language sql stable security definer set search_path = ''
as $function$
  select o.order_code,h.delivery_otp
  from public.orders o join public.restaurant_delivery_handoffs h on h.order_id=o.id and h.restaurant_id=o.restaurant_id
  where auth.uid() is not null and o.customer_id=(select auth.uid()) and o.id=p_order_id
    and o.delivery_type='delivery' and o.status in ('Ready','Handed Over')
    and h.is_active and h.expires_at>now() and h.verified_at is null;
$function$;

create or replace function public.confirm_delivery_handoff(p_token text,p_otp text)
returns boolean
language plpgsql security definer set search_path = ''
as $function$
declare
  v_handoff public.restaurant_delivery_handoffs%rowtype;
  v_order public.orders%rowtype;
begin
  if p_token is null or length(p_token)<32 then raise exception 'Invalid delivery link.'; end if;
  select * into v_handoff from public.restaurant_delivery_handoffs h
    where h.token_hash=extensions.digest(p_token,'sha256') and h.is_active and h.expires_at>now()
    for update;
  if not found then raise exception 'Delivery link is invalid, expired, or already used.'; end if;
  if v_handoff.otp_attempts>=5 then raise exception 'Too many OTP attempts. Ask restaurant to generate a new link.'; end if;
  select * into v_order from public.orders where id=v_handoff.order_id and restaurant_id=v_handoff.restaurant_id for update;
  if not found or v_order.status<>'Handed Over' then raise exception 'Restaurant must hand over the order before delivery confirmation.'; end if;
  if p_otp is null or p_otp !~ '^[0-9]{4}$' or p_otp<>v_handoff.delivery_otp then
    update public.restaurant_delivery_handoffs set otp_attempts=otp_attempts+1 where id=v_handoff.id;
    return false;
  end if;
  update public.restaurant_delivery_handoffs set is_active=false,verified_at=now() where id=v_handoff.id;
  update public.orders set status='Completed',status_note='Delivery confirmed by customer OTP' where id=v_order.id;
  insert into public.order_status_history(order_id,restaurant_id,from_status,to_status,note,changed_by)
    values(v_order.id,v_order.restaurant_id,v_order.status,'Completed','Delivery confirmed by customer OTP',null);
  return true;
end;
$function$;

drop function if exists public.list_my_customer_orders();
create function public.list_my_customer_orders()
returns table(id uuid, order_code text, restaurant_id uuid, restaurant_name text, amount numeric, status text, order_date timestamptz, customer_name text, delivery_type text, customer_note text, delivery_otp text)
language sql stable security definer set search_path=''
as $function$
  select o.id,o.order_code,o.restaurant_id,r.name as restaurant_name,o.amount,o.status,o.order_date,o.customer_name,o.delivery_type,o.customer_note,
    (select h.delivery_otp from public.restaurant_delivery_handoffs h
      where h.order_id=o.id and h.restaurant_id=o.restaurant_id and h.is_active
        and h.expires_at>now() and h.verified_at is null)
  from public.orders o join public.restaurants r on r.id=o.restaurant_id
  where auth.uid() is not null and o.customer_id=(select auth.uid())
  order by o.order_date desc,o.created_at desc;
$function$;

revoke execute on function public.create_delivery_handoff(uuid) from public, anon;
grant execute on function public.create_delivery_handoff(uuid) to authenticated;
revoke execute on function public.get_delivery_handoff(text) from public;
grant execute on function public.get_delivery_handoff(text) to anon, authenticated;
revoke execute on function public.get_my_delivery_otp(uuid) from public, anon;
grant execute on function public.get_my_delivery_otp(uuid) to authenticated;
revoke execute on function public.confirm_delivery_handoff(text,text) from public;
grant execute on function public.confirm_delivery_handoff(text,text) to anon, authenticated;
revoke execute on function public.list_my_customer_orders() from public, anon;
grant execute on function public.list_my_customer_orders() to authenticated;