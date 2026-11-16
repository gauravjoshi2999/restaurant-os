-- This is an isolated PostgreSQL 17 fixture, never run against production.
-- Public delivery RPC definitions below were copied verbatim by inspection of
-- active Supabase project wedbgpybbgsszcmffoha on 2026-11-16.
\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $roles$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $roles$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.restaurants (id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE public.restaurant_members (
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 role text NOT NULL,
 PRIMARY KEY(restaurant_id,user_id)
);
CREATE TABLE public.orders (
 id uuid PRIMARY KEY,
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
 order_code text NOT NULL,
 customer_id uuid REFERENCES auth.users(id),
 customer_name text,
 customer_phone text,
 customer_note text,
 delivery_address_snapshot jsonb,
 delivery_type text NOT NULL,
 status text NOT NULL,
 status_note text
);
CREATE TABLE public.order_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 item_name text, quantity numeric, unit_price numeric, line_total numeric,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.restaurant_delivery_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
 token_hash bytea NOT NULL UNIQUE,
 delivery_otp text NOT NULL CHECK(delivery_otp ~ '^[0-9]{4}$'),
 otp_attempts int NOT NULL DEFAULT 0 CHECK (otp_attempts BETWEEN 0 AND 5),
 is_active boolean NOT NULL DEFAULT true,
 expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 verified_at timestamptz
);
CREATE TABLE public.order_status_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 order_id uuid NOT NULL REFERENCES public.orders(id),
 restaurant_id uuid NOT NULL REFERENCES public.restaurants(id),
 from_status text,
 to_status text NOT NULL,
 note text,
 changed_by uuid,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE AS $auth$
  SELECT nullif(current_setting('request.jwt.claims',true)::jsonb ->> 'sub','')::uuid
$auth$;
CREATE OR REPLACE FUNCTION public.has_restaurant_role(p_restaurant_id uuid, p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $role$
  SELECT EXISTS(SELECT 1 FROM public.restaurant_members m
       WHERE m.restaurant_id=p_restaurant_id
         AND m.user_id=auth.uid()
         AND m.role=ANY(p_roles))
$role$;
-- Actual deployed privileged RPC logic follows; fixture schema is minimal.
-- BEGIN LIVE RPC confirm_delivery_handoff
CREATE OR REPLACE FUNCTION public.confirm_delivery_handoff(p_token text, p_otp text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform set_config('app.delivery_handoff_confirm','true',true);
  update public.orders set status='Completed',status_note='Delivery confirmed by customer OTP' where id=v_order.id;
  insert into public.order_status_history(order_id,restaurant_id,from_status,to_status,note,changed_by)
    values(v_order.id,v_order.restaurant_id,v_order.status,'Completed','Delivery confirmed by customer OTP',null);
  return true;
end;
$function$;
-- END LIVE RPC confirm_delivery_handoff

-- BEGIN LIVE RPC create_delivery_handoff
CREATE OR REPLACE FUNCTION public.create_delivery_handoff(p_order_id uuid)
 RETURNS TABLE(token text, order_code text, customer_name text, customer_phone text, delivery_address jsonb, customer_note text, restaurant_name text, items jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if v_order.status NOT IN ('Ready','Handed Over') or v_order.delivery_type <> 'delivery' or v_order.customer_id is null or v_order.delivery_address_snapshot is null then
    raise exception 'Delivery link is available only for a Ready or Handed Over delivery order with customer address.';
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
-- END LIVE RPC create_delivery_handoff

-- BEGIN LIVE RPC get_delivery_handoff
CREATE OR REPLACE FUNCTION public.get_delivery_handoff(p_token text)
 RETURNS TABLE(order_code text, customer_name text, customer_phone text, delivery_address jsonb, customer_note text, restaurant_name text, items jsonb, order_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
-- END LIVE RPC get_delivery_handoff

-- BEGIN LIVE RPC get_my_delivery_otp
CREATE OR REPLACE FUNCTION public.get_my_delivery_otp(p_order_id uuid)
 RETURNS TABLE(order_code text, delivery_otp text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.order_code,h.delivery_otp
  from public.orders o join public.restaurant_delivery_handoffs h on h.order_id=o.id and h.restaurant_id=o.restaurant_id
  where auth.uid() is not null and o.customer_id=(select auth.uid()) and o.id=p_order_id
    and o.delivery_type='delivery' and o.status in ('Ready','Handed Over')
    and h.is_active and h.expires_at>now() and h.verified_at is null;
$function$;
-- END LIVE RPC get_my_delivery_otp

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,anon,authenticated;
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.confirm_delivery_handoff(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_delivery_handoff(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_delivery_handoff(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_delivery_otp(uuid) FROM PUBLIC;
GRANT USAGE ON SCHEMA public,extensions TO anon,authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_delivery_handoff(uuid),public.get_my_delivery_otp(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_delivery_handoff(text),public.confirm_delivery_handoff(text,text) TO anon,authenticated;
