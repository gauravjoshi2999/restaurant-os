-- Bite read-only owner tenant isolation smoke for existing Supabase project.
-- Runs under the database administrator in ONE explicit transaction and ROLLBACK.
-- No real data inserts, updates or deletes; no personal details returned.
-- SET LOCAL ROLE / local JWT claims temporarily emulate the signed-in Owner
-- inside this transaction to evaluate ACTUAL current RLS policies.
-- Does not prove real browser login, APK permissions, or every RPC.
BEGIN;
DO $owner_isolation$
DECLARE
  owner_record record;
  owners_checked integer := 0;
BEGIN
  FOR owner_record IN
    SELECT m.user_id,m.restaurant_id
    FROM public.restaurant_members m
    WHERE m.role='owner'
    ORDER BY m.restaurant_id
    LIMIT 5
  LOOP
    PERFORM set_config(
      'request.jwt.claims',
      json_build_object('sub',owner_record.user_id,'role','authenticated')::text,
      true
    );
    EXECUTE 'SET LOCAL ROLE authenticated';

    IF auth.uid() IS DISTINCT FROM owner_record.user_id THEN
      RAISE EXCEPTION 'JWT claim did not resolve to target Owner in RLS smoke';
    END IF;
    IF (SELECT count(*) FROM public.restaurants WHERE id=owner_record.restaurant_id) <> 1 THEN
      RAISE EXCEPTION 'Own restaurant not readable in RLS smoke';
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurants WHERE id<>owner_record.restaurant_id) THEN
      RAISE EXCEPTION 'Other restaurant private profile visible to Owner';
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurant_members WHERE restaurant_id<>owner_record.restaurant_id) THEN
      RAISE EXCEPTION 'Another restaurant membership visible to Owner';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.orders
      WHERE restaurant_id<>owner_record.restaurant_id
        AND customer_id IS DISTINCT FROM owner_record.user_id
    ) THEN
      RAISE EXCEPTION 'Another restaurant private order visible to Owner';
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurant_cashbook_entries WHERE restaurant_id<>owner_record.restaurant_id) THEN
      RAISE EXCEPTION 'Another restaurant cashbook entry visible to Owner';
    END IF;
    IF EXISTS (SELECT 1 FROM public.restaurant_inventory_balances WHERE restaurant_id<>owner_record.restaurant_id) THEN
      RAISE EXCEPTION 'Another restaurant inventory balance visible to Owner';
    END IF;
    EXECUTE 'RESET ROLE';
    owners_checked := owners_checked+1;
  END LOOP;
  IF owners_checked < 2 THEN RAISE EXCEPTION 'Require at least two existing owner memberships for coverage'; END IF;
  RAISE NOTICE 'PASS: verified read-only Owner RLS boundary for % owner accounts, no data rows changed',owners_checked;
END
$owner_isolation$;
ROLLBACK;
