-- REHEARSAL CANDIDATE ONLY. No production migration has been applied.
-- Run against a disposable production-like clone. Always rolls back.
BEGIN;
ALTER TABLE public.menu_items
 ADD COLUMN available_online boolean NOT NULL DEFAULT true,
 ADD COLUMN available_pos boolean NOT NULL DEFAULT true,
 ADD COLUMN available_room boolean NOT NULL DEFAULT true,
 ADD COLUMN available_qr boolean NOT NULL DEFAULT true;
-- Restrict all existing permissive SELECT policies, retaining existing tenant/role grants.
CREATE POLICY bite_menu_channel_visibility ON public.menu_items AS RESTRICTIVE
 FOR SELECT TO anon, authenticated
 USING ((is_available AND (available_online OR available_qr))
        OR public.is_platform_admin() OR public.is_restaurant_member(restaurant_id));
-- Exact-match guard: abort on drift instead of silently editing unexpected server code.
DO $patch$
DECLARE item record; old_def text; new_def text; actual_count integer;
BEGIN
 FOR item IN SELECT * FROM (VALUES
  ('public.bite_prepare_live_checkout(uuid,text,uuid,text,jsonb)','and restaurant_id=p_restaurant_id and is_available;','and restaurant_id=p_restaurant_id and is_available and available_online;',1),
  ('public.create_bite_sandbox_order_draft(uuid,text,uuid,text,jsonb)','and restaurant_id=p_restaurant_id and is_available;','and restaurant_id=p_restaurant_id and is_available and available_online;',1),
  ('public.bite_quote_menu_options_v1(uuid,jsonb)','and m.restaurant_id=p_restaurant_id and m.is_available;','and m.restaurant_id=p_restaurant_id and m.is_available and m.available_online;',1),
  ('public.bite_quote_menu_options_v2(uuid,jsonb)','and m.restaurant_id=p_restaurant_id and m.is_available;','and m.restaurant_id=p_restaurant_id and m.is_available and m.available_online;',1),
  ('public.bite_reorder_items(uuid)','select mi.id,mi.price,mi.is_available','select mi.id,mi.price,(mi.is_available and mi.available_online) as is_available',1),
  ('public.bite_storefront(text)','m.restaurant_id=r.id and m.is_available','m.restaurant_id=r.id and m.is_available and m.available_online',3),
  ('public.bite_super_admin_review_v1(uuid,text,text,timestamp with time zone)','WHERE restaurant_id=r.id AND is_available)','WHERE restaurant_id=r.id AND is_available AND available_online)',1),
  ('public.guard_restaurant_publication()','and mi.is_available = true','and mi.is_available = true and mi.available_online = true',1),
  ('public.place_customer_order(uuid,text,uuid,text,jsonb)','and mi.is_available;','and mi.is_available and mi.available_online;',2)
 ) AS x(signature,before_text,after_text,expected_count)
 LOOP
  old_def:=pg_get_functiondef(to_regprocedure(item.signature));
  IF old_def IS NULL THEN RAISE EXCEPTION 'Missing expected function %',item.signature; END IF;
  actual_count:=(length(old_def)-length(replace(old_def,item.before_text,'')))/length(item.before_text);
  IF actual_count<>item.expected_count THEN RAISE EXCEPTION 'Unexpected function body %: expected %, got %',item.signature,item.expected_count,actual_count; END IF;
  new_def:=replace(old_def,item.before_text,item.after_text);
  EXECUTE new_def;
 END LOOP;
END $patch$;
-- Verified paid-order finalization deliberately unchanged: immutable purchased snapshot.
-- No production deployment until role, quote, cart, QR, POS, stale intent and paid-finalization tests pass.
SELECT column_name,column_default,is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='menu_items' AND column_name LIKE 'available_%'
 ORDER BY column_name;
ROLLBACK;
