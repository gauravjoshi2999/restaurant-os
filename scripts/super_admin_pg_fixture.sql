-- Isolated, disposable schema matching the columns/constraints used by the
-- production migration. All fixtures below are synthetic and never deployed.
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.platform_admins(user_id uuid PRIMARY KEY REFERENCES auth.users);
CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id=auth.uid()) $$;
CREATE TABLE public.restaurants(id uuid PRIMARY KEY,name text,address text,phone text,city text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),status text DEFAULT 'Pending',is_published boolean DEFAULT false,onboarding_status text DEFAULT 'pending' CHECK(onboarding_status IN('pending','approved','rejected','suspended')),onboarding_rejection_reason text,onboarding_reviewed_by uuid REFERENCES auth.users,onboarding_reviewed_at timestamptz,estimated_prep_minutes integer DEFAULT 25,accepts_pickup boolean DEFAULT true,accepts_delivery boolean DEFAULT true,platform_commission_rate numeric CHECK(platform_commission_rate BETWEEN 0 AND 100));
CREATE TABLE public.restaurant_members(restaurant_id uuid REFERENCES public.restaurants,user_id uuid REFERENCES auth.users,role text);
CREATE TABLE public.menu_items(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,restaurant_id uuid REFERENCES public.restaurants,is_available boolean DEFAULT true);
CREATE TABLE public.restaurant_delivery_zones(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,restaurant_id uuid REFERENCES public.restaurants,is_active boolean DEFAULT true);
CREATE TABLE public.restaurant_delivery_zone_pincodes(zone_id uuid REFERENCES public.restaurant_delivery_zones,restaurant_id uuid REFERENCES public.restaurants,postal_code text);
CREATE TABLE public.orders(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,restaurant_id uuid REFERENCES public.restaurants,order_code text,channel text,status text,is_demo boolean DEFAULT false,order_date timestamptz DEFAULT now());
CREATE TABLE public.order_financials(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,order_id uuid UNIQUE REFERENCES public.orders,channel text,is_demo boolean DEFAULT false,customer_payable_amount numeric,commission_rate numeric,commission_amount numeric,payment_status text);
CREATE TABLE public.restaurant_settlements(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,status text);
CREATE TABLE public.bite_refund_jobs(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,order_id uuid REFERENCES public.orders,status text);
CREATE TABLE public.customer_support_tickets(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,status text);
CREATE TABLE public.platform_settings(id integer PRIMARY KEY CHECK(id=1),default_commission_rate numeric CHECK(default_commission_rate BETWEEN 0 AND 100),updated_by uuid REFERENCES auth.users,updated_at timestamptz);
CREATE TABLE public.platform_audit_logs(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,actor_id uuid REFERENCES auth.users,action text,entity_type text,entity_id uuid,details jsonb,created_at timestamptz DEFAULT now());
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222'),('33333333-3333-4333-8333-333333333333');
INSERT INTO public.platform_admins VALUES('11111111-1111-4111-8111-111111111111');
INSERT INTO public.restaurants(id,name,address,phone,city) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Synthetic A','QA road','9999999999','Rajsamand'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Synthetic B','QA road','8888888888','Udaipur');
INSERT INTO public.restaurant_members VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222','owner');
INSERT INTO public.platform_settings VALUES(1,10,NULL,now());
-- Faithful baseline delivery policies: membership reads/writes, no platform
-- read permission until the new review migration is applied.
ALTER TABLE public.restaurant_delivery_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_delivery_zone_pincodes ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.restaurant_members TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.restaurant_delivery_zones,public.restaurant_delivery_zone_pincodes TO authenticated;
CREATE POLICY fixture_delivery_members ON public.restaurant_delivery_zones FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.restaurant_members m WHERE m.restaurant_id=restaurant_delivery_zones.restaurant_id AND m.user_id=auth.uid() AND m.role IN('owner','manager')));
CREATE POLICY fixture_pincode_members ON public.restaurant_delivery_zone_pincodes FOR ALL TO authenticated USING (EXISTS(SELECT 1 FROM public.restaurant_members m WHERE m.restaurant_id=restaurant_delivery_zone_pincodes.restaurant_id AND m.user_id=auth.uid() AND m.role IN('owner','manager')));
INSERT INTO public.restaurant_delivery_zones(id,restaurant_id) VALUES('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('10000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
INSERT INTO public.restaurant_delivery_zone_pincodes VALUES('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','313324'),('10000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','313001');
