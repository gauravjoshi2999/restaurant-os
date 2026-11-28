-- Isolated fixture ONLY: invoke after existing menu dietary tests on disposable CI PostgreSQL.
BEGIN;
\ir ../docs/sql/menu_channels_visibility_candidate.sql
-- Mirror actual helper ACLs, and use deterministic publication in the fixture.
REVOKE EXECUTE ON FUNCTION public.is_platform_admin() FROM PUBLIC,anon;
REVOKE EXECUTE ON FUNCTION public.is_restaurant_member(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(),public.is_restaurant_member(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.is_restaurant_public(rid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT rid='10000000-0000-0000-0000-000000000001'::uuid
$$;
-- Stable synthetic rows independent of previous dietary test fixtures.
INSERT INTO public.menu_items(id,restaurant_id,name,price,is_vegetarian,is_available,available_online,available_pos,available_room,available_qr)
VALUES
 ('31000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Channel online',100,true,true,true,false,false,false),
 ('31000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Channel private room',20,true,true,false,true,true,false),
 ('31000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Channel QR only',20,true,true,false,false,false,true),
 ('31000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Channel paused',20,true,false,true,true,true,true),
 ('31000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','Channel unpublished',20,true,true,true,true,true,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.menu_items WHERE name LIKE 'Legacy %' AND NOT (available_online AND available_pos AND available_room AND available_qr)) THEN RAISE EXCEPTION 'Existing menu flags not preserved'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%')<>2 THEN RAISE EXCEPTION 'Anon must see only published online/QR items'; END IF;
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%' AND available_online)<>1 THEN RAISE EXCEPTION 'Online filter leaked QR only'; END IF;
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%' AND available_qr)<>1 THEN RAISE EXCEPTION 'QR filter leaked online only'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%')<>2 THEN RAISE EXCEPTION 'Customer visibility mismatch'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%')<>4 THEN RAISE EXCEPTION 'Owner must see own private/paused items but not other unpublished tenant'; END IF;
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%' AND is_available AND available_room)<>1 THEN RAISE EXCEPTION 'Room picker should show only eligible private item'; END IF;
 IF (SELECT count(*) FROM public.menu_items WHERE id::text LIKE '31000000-%' AND is_available AND available_pos)<>1 THEN RAISE EXCEPTION 'POS picker should show only eligible private item'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',true);
DO $$ DECLARE changed integer; BEGIN
 UPDATE public.menu_items SET available_online=true WHERE id='31000000-0000-0000-0000-000000000002'; GET DIAGNOSTICS changed=ROW_COUNT;
 IF changed<>0 THEN RAISE EXCEPTION 'Cross tenant update succeeded'; END IF;
END $$;
RESET ROLE;
-- Rehearse exact current v1/v2 server quote code with the candidate channel predicate.
-- Disposable fixture tables only; never import these grants or seed rows to production.
CREATE TABLE public.menu_option_groups(id uuid primary key,restaurant_id uuid,name text,min_select integer,max_select integer,is_available boolean);
CREATE TABLE public.menu_option_choices(id uuid primary key,restaurant_id uuid,option_group_id uuid,name text,price_delta numeric,is_available boolean);
CREATE TABLE public.menu_item_option_groups(restaurant_id uuid,menu_item_id uuid,option_group_id uuid,is_available boolean);
GRANT SELECT ON public.menu_option_groups,public.menu_option_choices,public.menu_item_option_groups TO anon,authenticated;
INSERT INTO public.menu_option_groups VALUES ('32000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Size',1,1,true);
INSERT INTO public.menu_option_choices VALUES ('33000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','Large',15,true);
INSERT INTO public.menu_item_option_groups VALUES ('10000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001',true);
-- Model the pre-rollout public metadata access and the team exception.
ALTER TABLE public.menu_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_option_choices ENABLE ROW LEVEL SECURITY;
CREATE POLICY option_groups_fixture_read ON public.menu_option_groups FOR SELECT TO anon,authenticated USING(is_available);
CREATE POLICY option_choices_fixture_read ON public.menu_option_choices FOR SELECT TO anon,authenticated USING(is_available);
INSERT INTO public.menu_option_groups VALUES
 ('32000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Room options',0,1,true),
 ('32000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','QR options',0,1,true);
INSERT INTO public.menu_option_choices VALUES
 ('33000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000002','Room extra',20,true),
 ('33000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000003','QR extra',25,true);
INSERT INTO public.menu_item_option_groups VALUES
 ('10000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000002',true),
 ('10000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000003',true);
\ir ../docs/sql/menu_channels_options_candidate.sql
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_option_groups)<>2 OR (SELECT count(*) FROM public.menu_option_choices)<>2 THEN
  RAISE EXCEPTION 'Public option metadata must match the Online and QR catalog';
 END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.menu_option_groups WHERE name='Room options')
 OR EXISTS (SELECT 1 FROM public.menu_option_choices WHERE name='Room extra') THEN
  RAISE EXCEPTION 'Signed-in customer can read room-only options';
 END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.menu_option_groups)<>3 OR (SELECT count(*) FROM public.menu_option_choices)<>3 THEN
  RAISE EXCEPTION 'Owner lost private options in own catalog';
 END IF;
END $$;
RESET ROLE;
\ir menu_channels_quote_candidate_fixture.sql
-- Both quote versions must compute canonical pricing and reject direct or stale offline cart lines.
SET LOCAL ROLE anon;
DO $qa$
DECLARE ver text; item uuid; quote jsonb; rejected boolean;
BEGIN
 FOREACH ver IN ARRAY ARRAY['bite_quote_menu_options_v1','bite_quote_menu_options_v2'] LOOP
  EXECUTE format('SELECT public.%I($1,$2)',ver) INTO quote USING
   '10000000-0000-0000-0000-000000000001'::uuid,
   '[{"menu_item_id":"31000000-0000-0000-0000-000000000001","quantity":2,"option_choice_ids":["33000000-0000-0000-0000-000000000001"]}]'::jsonb;
  IF (quote->>'food_subtotal')::numeric<>230 OR quote->>'authorizes_payment'<>'false' THEN RAISE EXCEPTION 'Wrong canonical quote %: %',ver,quote; END IF;
  FOREACH item IN ARRAY ARRAY['31000000-0000-0000-0000-000000000002'::uuid,'31000000-0000-0000-0000-000000000003'::uuid,'31000000-0000-0000-0000-000000000004'::uuid,'31000000-0000-0000-0000-000000000005'::uuid] LOOP
   rejected:=false;
   BEGIN
    EXECUTE format('SELECT public.%I($1,$2)',ver) INTO quote USING '10000000-0000-0000-0000-000000000001'::uuid,jsonb_build_array(jsonb_build_object('menu_item_id',item,'quantity',1));
   EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM<>'Menu item is unavailable' THEN RAISE; END IF;
    rejected:=true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION 'Direct quote leaked unavailable item %/%',ver,item; END IF;
  END LOOP;
  rejected:=false;
  BEGIN
   EXECUTE format('SELECT public.%I($1,$2)',ver) INTO quote USING '10000000-0000-0000-0000-000000000001'::uuid,'[{"menu_item_id":"31000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb;
  EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM NOT LIKE 'Selection limit not met%' THEN RAISE; END IF;
   rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Mandatory option bypass %',ver; END IF;
 END LOOP;
END $qa$;
RESET ROLE;
-- Model a stale cart: previously eligible online item disabled after menu load.
UPDATE public.menu_items SET available_online=false,available_qr=true WHERE id='31000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
DO $qa$
DECLARE ver text; rejected boolean; quote jsonb;
BEGIN
 FOREACH ver IN ARRAY ARRAY['bite_quote_menu_options_v1','bite_quote_menu_options_v2'] LOOP
  rejected:=false;
  BEGIN
   EXECUTE format('SELECT public.%I($1,$2)',ver) INTO quote USING '10000000-0000-0000-0000-000000000001'::uuid,'[{"menu_item_id":"31000000-0000-0000-0000-000000000001","quantity":2,"option_choice_ids":["33000000-0000-0000-0000-000000000001"]}]'::jsonb;
  EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM<>'Menu item is unavailable' THEN RAISE; END IF;
   rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Stale online cart accepted by %',ver; END IF;
 END LOOP;
END $qa$;
RESET ROLE;
SELECT 'PASS: exact v1/v2 quote candidates reject offline/QR/paused/cross-tenant/stale items and preserve option pricing' AS result;
\ir menu_channels_paid_finalize_fixture.sql
ROLLBACK;
SELECT 'PASS: channel visibility, ACL, tenant and legacy defaults (synthetic fixture)' AS result;
