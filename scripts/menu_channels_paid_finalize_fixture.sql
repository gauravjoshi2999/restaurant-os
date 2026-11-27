-- Disposable CI only. Exact live finalizer snapshot, minimal dependency schema.
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT jsonb_build_object('role',current_setting('request.jwt.claim.role',true)) $$;
CREATE TABLE public.bite_live_checkout_intents(id uuid primary key,customer_id uuid,restaurant_id uuid,delivery_type text,address_id uuid,customer_note text,food_subtotal numeric,delivery_fee numeric,amount numeric,discount_amount numeric,discount_sponsor text,coupon_code text,priced_items jsonb,variant_priced_items jsonb,pricing_version integer,pricing_schema_version integer,customer_snapshot jsonb,address_snapshot jsonb,commission_rate_snapshot numeric,status text,provider_order_id text,activated_order_id uuid,scheduled_for timestamptz,updated_at timestamptz);
CREATE TABLE public.customer_contact_profiles(customer_id uuid primary key,full_name text,phone text);
CREATE TABLE public.customer_addresses(id uuid,customer_id uuid);
CREATE TABLE public.restaurants(id uuid,platform_commission_rate numeric);
CREATE TABLE public.platform_settings(default_commission_rate numeric);
CREATE TABLE public.orders(id uuid primary key default gen_random_uuid(),restaurant_id uuid,order_code text,channel text,amount numeric,status text,created_by uuid,customer_id uuid,customer_name text,customer_phone text,delivery_type text,delivery_address_snapshot jsonb,customer_note text,is_demo boolean,scheduled_for timestamptz,status_note text);
CREATE TABLE public.order_items(order_id uuid,item_name text,quantity numeric,unit_price numeric,menu_item_id uuid,option_choices_snapshot jsonb,base_unit_price_snapshot numeric,option_unit_total_snapshot numeric,cart_line_key_snapshot text,cooking_request_snapshot text,selected_options_snapshot jsonb,base_unit_price numeric,option_unit_total numeric,variant_line_key text,cooking_request text,line_total numeric GENERATED ALWAYS AS (round(quantity*unit_price,2)) STORED);
CREATE TABLE public.order_financials(order_id uuid,restaurant_id uuid,channel text,food_subtotal numeric,restaurant_discount numeric,platform_discount numeric,coupon_code text,commissionable_food_value numeric,commission_rate numeric,commission_amount numeric,delivery_fee numeric,customer_payable_amount numeric,payment_status text,created_by uuid,is_demo boolean);
CREATE TABLE public.bite_order_confirmations(intent_id uuid,restaurant_id uuid,customer_id uuid,state text,reviewed_by uuid,reviewed_at timestamptz);
CREATE OR REPLACE FUNCTION public.bite_finalize_verified_live_checkout(p_intent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.bite_live_checkout_intents%rowtype; v_order uuid; v_item jsonb; v_menu public.menu_items%rowtype; v_profile public.customer_contact_profiles%rowtype; v_address jsonb; v_rate numeric(8,2); v_code text;v_snapshot_total numeric(12,2):=0; v_option_sum numeric(12,2);
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Service role only';end if;
 select * into v from public.bite_live_checkout_intents where id=p_intent_id for update;
 if not found then raise exception 'Intent missing';end if;
 if v.status='activated' then return v.activated_order_id;end if;
 if v.status<>'payment_verified' or v.provider_order_id is null then raise exception 'Verified payment required';end if;
 if v.delivery_type not in ('pickup','delivery') or v.priced_items is null or jsonb_typeof(v.priced_items)<>'array' or jsonb_array_length(v.priced_items) not between 1 and 50 then raise exception 'Invalid checkout snapshot';end if;
 if v.food_subtotal is null or v.delivery_fee is null or v.food_subtotal+v.delivery_fee-v.discount_amount<>v.amount or v.discount_amount>v.food_subtotal then raise exception 'Checkout totals inconsistent';end if;
 if v.pricing_version=3 and
  (v.pricing_schema_version<>2 or v.variant_priced_items is distinct from v.priced_items)
 then raise exception 'Verified V3 checkout snapshot versions do not match';end if;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop
 if (v_item->>'quantity') !~ '^[0-9]{1,2}$' or (v_item->>'unit_price') !~ '^[0-9]+([.][0-9]{1,2})?$' or nullif(v_item->>'item_name','') is null then raise exception 'Invalid priced snapshot';end if;
 if v.pricing_version=3 then
  if jsonb_typeof(v_item->'options')<>'array'
   or coalesce(length(v_item->>'line_key'),0) not between 1 and 1024
   or length(coalesce(v_item->>'note',''))>100
   or (v_item->>'base_unit_price') is null
   or (v_item->>'option_unit_total') is null
  then raise exception 'Invalid V3 option snapshot structure';end if;
  select coalesce(sum((o.value->>'price_delta')::numeric),0)
    into v_option_sum from jsonb_array_elements(v_item->'options') as o(value);
  if v_option_sum<>(v_item->>'option_unit_total')::numeric
   or (v_item->>'base_unit_price')::numeric+(v_item->>'option_unit_total')::numeric
      <>(v_item->>'unit_price')::numeric
   or v_option_sum<0
  then raise exception 'V3 priced option snapshot mismatch';end if;
 end if;
 v_snapshot_total:=v_snapshot_total+round((v_item->>'quantity')::numeric*(v_item->>'unit_price')::numeric,2);
 end loop;
 if v_snapshot_total<>v.food_subtotal then raise exception 'Snapshot total mismatch';end if;
 select * into v_profile from public.customer_contact_profiles where customer_id=v.customer_id;
 if v.customer_snapshot is not null then v_profile.full_name:=v.customer_snapshot->>'full_name';v_profile.phone:=v.customer_snapshot->>'phone';end if;
 if v.delivery_type='delivery' then
 v_address:=v.address_snapshot;
 if v_address is null then select to_jsonb(a) into v_address from public.customer_addresses a where a.id=v.address_id and a.customer_id=v.customer_id;end if;
 if v_address is null then raise exception 'Delivery address missing';end if;
 end if;
 select coalesce(v.commission_rate_snapshot,(select r.platform_commission_rate from public.restaurants r where r.id=v.restaurant_id),(select ps.default_commission_rate from public.platform_settings ps limit 1),10) into v_rate;
 if v_rate is null or v_rate<0 or v_rate>100 then raise exception 'Invalid commission rate';end if;
 v_code:='BITE-'||upper(substr(replace(v.id::text,'-',''),1,12));
 perform set_config('app.verified_checkout_activation','true',true);
 insert into public.orders(restaurant_id,order_code,channel,amount,status,created_by,customer_id,customer_name,customer_phone,delivery_type,delivery_address_snapshot,customer_note,is_demo,scheduled_for)
 values(v.restaurant_id,v_code,'Own Platform',v.amount,'Received',v.customer_id,v.customer_id,coalesce(nullif(v_profile.full_name,''),'Customer'),v_profile.phone,v.delivery_type,v_address,v.customer_note,false,v.scheduled_for) returning id into v_order;
 for v_item in select value from jsonb_array_elements(v.priced_items) loop

 insert into public.order_items(
  order_id,item_name,quantity,unit_price,menu_item_id,
  option_choices_snapshot,base_unit_price_snapshot,option_unit_total_snapshot,
  cart_line_key_snapshot,cooking_request_snapshot,
  selected_options_snapshot,base_unit_price,option_unit_total,variant_line_key,cooking_request
 )
 values(
  v_order,v_item->>'item_name',(v_item->>'quantity')::numeric,
  (v_item->>'unit_price')::numeric,
  (select m.id from public.menu_items m where m.id=(v_item->>'menu_item_id')::uuid and m.restaurant_id=v.restaurant_id),
  case when v.pricing_version=3 then v_item->'options' else '[]'::jsonb end,
  case when v.pricing_version=3 then (v_item->>'base_unit_price')::numeric else null end,
  case when v.pricing_version=3 then (v_item->>'option_unit_total')::numeric else 0 end,
  case when v.pricing_version=3 then v_item->>'line_key' else null end,
  case when v.pricing_version=3 then v_item->>'note' else null end,
  case when v.pricing_version=3 then v_item->'options' else '[]'::jsonb end,
  case when v.pricing_version=3 then (v_item->>'base_unit_price')::numeric else null end,
  case when v.pricing_version=3 then (v_item->>'option_unit_total')::numeric else null end,
  case when v.pricing_version=3 then v_item->>'line_key' else null end,
  case when v.pricing_version=3 then v_item->>'note' else null end
 );
 end loop;
 if (select coalesce(sum(line_total),0) from public.order_items where order_id=v_order)<>v.food_subtotal then raise exception 'Menu prices changed; manual reconciliation required';end if;
 insert into public.order_financials(order_id,restaurant_id,channel,food_subtotal,restaurant_discount,platform_discount,coupon_code,commissionable_food_value,commission_rate,commission_amount,delivery_fee,customer_payable_amount,payment_status,created_by,is_demo)
 values(v_order,v.restaurant_id,'Own Platform',v.food_subtotal,case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end,case when v.discount_sponsor='platform' then v.discount_amount else 0 end,v.coupon_code,v.food_subtotal-case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end,v_rate,round((v.food_subtotal-case when v.discount_sponsor='restaurant' then v.discount_amount else 0 end)*v_rate/100,2),v.delivery_fee,v.amount,'paid',v.customer_id,false);

 -- BITE_PREPAY_APPROVAL_AUTO_ACCEPT_V1
 -- Only the server-verified, already restaurant-approved checkout skips a second Accept.
 update public.orders o
    set status='Accepted',
        status_note='Restaurant confirmed before payment; payment verified'
  where o.id=v_order and o.restaurant_id=v.restaurant_id and o.customer_id=v.customer_id
    and o.channel='Own Platform' and o.is_demo is not true and o.status='Received'
    and exists(
      select 1 from public.bite_order_confirmations c
       where c.intent_id=v.id and c.restaurant_id=v.restaurant_id
         and c.customer_id=v.customer_id and c.state='approved'
         and c.reviewed_by is not null and c.reviewed_at is not null
         and c.reviewed_at<=now()
    );
 update public.bite_live_checkout_intents set status='activated',activated_order_id=v_order,updated_at=now() where id=p_intent_id;
 return v_order;
end $function$;

REVOKE EXECUTE ON FUNCTION public.bite_finalize_verified_live_checkout(uuid) FROM PUBLIC,anon,authenticated;
-- Use synthetic test values only. Previously purchased item is now offline and changed in price.
UPDATE public.menu_items SET available_online=false,available_qr=false,is_available=false,price=999 WHERE id='31000000-0000-0000-0000-000000000001';
INSERT INTO public.bite_live_checkout_intents(id,customer_id,restaurant_id,delivery_type,customer_note,food_subtotal,delivery_fee,amount,discount_amount,priced_items,variant_priced_items,pricing_version,pricing_schema_version,customer_snapshot,commission_rate_snapshot,status,provider_order_id)
SELECT id,'00000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','pickup','',230,0,230,0,lines,lines,3,2,'{"full_name":"Synthetic customer","phone":"7000000000"}'::jsonb,10,status,provider
FROM (VALUES ('34000000-0000-0000-0000-000000000001'::uuid,'payment_verified','synthetic-paid'),('34000000-0000-0000-0000-000000000002'::uuid,'awaiting_payment',NULL)) AS v(id,status,provider)
CROSS JOIN (SELECT '[{"menu_item_id":"31000000-0000-0000-0000-000000000001","item_name":"Original dish","quantity":2,"unit_price":115,"base_unit_price":100,"option_unit_total":15,"options":[{"price_delta":15}],"line_key":"synthetic","note":"No salt"}]'::jsonb lines) q;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $qa$
DECLARE result uuid; again uuid; rejected boolean:=false;
BEGIN
 result:=public.bite_finalize_verified_live_checkout('34000000-0000-0000-0000-000000000001');
 again:=public.bite_finalize_verified_live_checkout('34000000-0000-0000-0000-000000000001');
 IF result IS NULL OR result IS DISTINCT FROM again OR (SELECT count(*) FROM public.orders)<>1 THEN RAISE EXCEPTION 'Paid activation not idempotent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=result AND item_name='Original dish' AND quantity=2 AND unit_price=115 AND line_total=230 AND base_unit_price_snapshot=100 AND option_unit_total_snapshot=15 AND cooking_request_snapshot='No salt') THEN RAISE EXCEPTION 'Paid price snapshot changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.order_financials WHERE order_id=result AND customer_payable_amount=230 AND payment_status='paid') THEN RAISE EXCEPTION 'Paid financial snapshot changed'; END IF;
 BEGIN
  PERFORM public.bite_finalize_verified_live_checkout('34000000-0000-0000-0000-000000000002');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'Verified payment required' THEN RAISE; END IF;
  rejected:=true;
 END;
 IF NOT rejected OR (SELECT count(*) FROM public.orders)<>1 THEN RAISE EXCEPTION 'Unverified payment activated'; END IF;
END $qa$;
SELECT 'PASS: exact live finalizer preserves paid price/options, idempotency and rejects unverified payment after menu change' AS result;

-- Isolated first-attempt gate tests use the exact candidate function.
CREATE ROLE service_role NOLOGIN BYPASSRLS;
ALTER TABLE public.bite_live_checkout_intents ADD COLUMN provider_attempted_at timestamptz, ADD COLUMN created_at timestamptz DEFAULT now();
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT SELECT,UPDATE ON public.bite_live_checkout_intents,public.menu_items TO service_role;
\ir ../docs/sql/menu_channels_first_attempt_candidate.sql
INSERT INTO public.bite_live_checkout_intents(id,customer_id,restaurant_id,status,priced_items,provider_attempted_at,provider_order_id)
VALUES
 ('35000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','awaiting_payment','[{"menu_item_id":"31000000-0000-0000-0000-000000000001"}]',NULL,NULL),
 ('35000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','awaiting_payment','[{"menu_item_id":"31000000-0000-0000-0000-000000000001"}]',now()-interval '2 minutes',NULL),
 ('35000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','awaiting_payment','[{"menu_item_id":"31000000-0000-0000-0000-000000000001"}]',NULL,'existing-provider');
DO $$ BEGIN
 IF has_function_privilege('anon','public.bite_claim_channel_payment_attempt(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.bite_claim_channel_payment_attempt(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Client may claim payment'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','service_role',true);
DO $$ DECLARE c uuid:='00000000-0000-0000-0000-000000000099'; i uuid:='35000000-0000-0000-0000-000000000001'; t timestamptz;
BEGIN
 IF public.bite_claim_channel_payment_attempt(i,c)<>'menu_changed' THEN RAISE EXCEPTION 'Offline first attempt accepted'; END IF;
 IF (SELECT provider_attempted_at FROM public.bite_live_checkout_intents WHERE id=i) IS NOT NULL THEN RAISE EXCEPTION 'Rejected attempt mutated'; END IF;
 IF public.bite_claim_channel_payment_attempt(i,'00000000-0000-0000-0000-000000000001')<>'not_payable' THEN RAISE EXCEPTION 'Wrong customer accepted'; END IF;
 UPDATE public.menu_items SET is_available=true,available_online=true WHERE id='31000000-0000-0000-0000-000000000001';
 IF public.bite_claim_channel_payment_attempt(i,c)<>'claimed' THEN RAISE EXCEPTION 'Eligible first attempt denied'; END IF;
 SELECT provider_attempted_at INTO t FROM public.bite_live_checkout_intents WHERE id=i;
 UPDATE public.menu_items SET available_online=false WHERE id='31000000-0000-0000-0000-000000000001';
 IF public.bite_claim_channel_payment_attempt(i,c)<>'retry' THEN RAISE EXCEPTION 'Already claimed attempt lost'; END IF;
 IF t IS DISTINCT FROM (SELECT provider_attempted_at FROM public.bite_live_checkout_intents WHERE id=i) THEN RAISE EXCEPTION 'Retry extended original timestamp'; END IF;
 IF public.bite_claim_channel_payment_attempt('35000000-0000-0000-0000-000000000002',c)<>'reconcile' OR public.bite_claim_channel_payment_attempt('35000000-0000-0000-0000-000000000003',c)<>'reconcile' THEN RAISE EXCEPTION 'Old/uncertain provider attempt incorrectly accepted'; END IF;
 IF public.bite_claim_channel_payment_attempt('34000000-0000-0000-0000-000000000001',c)<>'not_payable' THEN RAISE EXCEPTION 'Activated order payable again'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: first attempt rejects offline, checks customer, retains original retry boundary and protects activated/uncertain orders' AS result;
