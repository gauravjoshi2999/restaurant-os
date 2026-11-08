-- All review writes must pass through verified SECURITY DEFINER RPCs.
-- This prevents customers from forging restaurant replies or setting review visibility directly.
DROP POLICY IF EXISTS "customers create own restaurant reviews" ON public.restaurant_reviews;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.restaurant_reviews FROM PUBLIC, anon, authenticated;
