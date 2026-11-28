-- Apply only to a fresh disposable Supabase stack. Auth and API roles come from Supabase.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.restaurant_members (restaurant_id uuid, user_id uuid, role text);
CREATE TABLE public.menu_items (
 id uuid PRIMARY KEY, restaurant_id uuid NOT NULL, name text NOT NULL,
 price numeric NOT NULL, is_available boolean NOT NULL
);
CREATE TABLE public.menu_option_groups (
 id uuid PRIMARY KEY, restaurant_id uuid, name text,
 min_select integer, max_select integer, is_available boolean
);
CREATE TABLE public.menu_option_choices (
 id uuid PRIMARY KEY, restaurant_id uuid, option_group_id uuid,
 name text, price_delta numeric, is_available boolean
);
CREATE TABLE public.menu_item_option_groups (
 restaurant_id uuid, menu_item_id uuid, option_group_id uuid, is_available boolean
);
CREATE TABLE public.bite_live_checkout_intents (
 id uuid PRIMARY KEY, restaurant_id uuid NOT NULL, customer_id uuid NOT NULL,
 status text NOT NULL, priced_items jsonb NOT NULL, created_at timestamptz DEFAULT now(),
 provider_attempted_at timestamptz, provider_order_id text
);

ALTER TABLE public.restaurant_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_option_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bite_live_checkout_intents ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.is_restaurant_public(rid uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT rid='10000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.is_restaurant_member(rid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT FROM public.restaurant_members WHERE restaurant_id=rid AND user_id=auth.uid())
$$;
CREATE FUNCTION public.has_restaurant_role(rid uuid, allowed text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT FROM public.restaurant_members WHERE restaurant_id=rid AND user_id=auth.uid() AND role=ANY(allowed))
$$;
REVOKE EXECUTE ON FUNCTION public.is_platform_admin(),public.is_restaurant_member(uuid),
 public.has_restaurant_role(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(),public.is_restaurant_member(uuid),
 public.has_restaurant_role(uuid,text[]) TO authenticated;

CREATE POLICY menu_catalog_fixture ON public.menu_items FOR SELECT TO anon,authenticated USING (true);
CREATE POLICY options_fixture ON public.menu_option_groups FOR SELECT TO anon,authenticated USING (is_available);
CREATE POLICY choices_fixture ON public.menu_option_choices FOR SELECT TO anon,authenticated USING (is_available);
CREATE POLICY links_fixture ON public.menu_item_option_groups FOR SELECT TO anon,authenticated USING (is_available);
GRANT SELECT ON public.menu_items, public.menu_option_groups, public.menu_option_choices,
 public.menu_item_option_groups TO anon,authenticated;
GRANT SELECT,UPDATE ON public.menu_items TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.bite_live_checkout_intents TO service_role;
GRANT SELECT,INSERT ON public.restaurant_members TO service_role;
\ir ../docs/sql/menu_channels_visibility_candidate.sql
\ir ../docs/sql/menu_channels_options_candidate.sql
\ir menu_channels_quote_candidate_fixture.sql
\ir ../docs/sql/menu_channels_owner_quote_candidate.sql
\ir ../docs/sql/menu_channels_first_attempt_candidate.sql

INSERT INTO public.menu_items
 (id,restaurant_id,name,price,is_available,available_online,available_pos,available_room,available_qr)
VALUES
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Online dish',120,true,true,false,false,false),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Room dish',100,true,false,false,true,false),
 ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','QR dish',90,true,false,false,false,true),
 ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Paused dish',90,false,true,true,true,true);
INSERT INTO public.menu_option_groups VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Room options',0,1,true);
INSERT INTO public.menu_option_choices VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Room extra',25,true);
INSERT INTO public.menu_item_option_groups VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',true);
NOTIFY pgrst, 'reload schema';
COMMIT;
