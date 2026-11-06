-- RestaurantOS: READ-ONLY preflight check
-- Safe to run in Supabase SQL Editor. This script makes no database changes.
-- Copy the complete output back before applying any pending migration.

with expected_objects(object_type, object_name) as (
  values
    ('table','restaurants'),
    ('table','restaurant_members'),
    ('table','orders'),
    ('table','order_items'),
    ('table','order_status_history'),
    ('table','platform_admins'),
    ('table','menu_categories'),
    ('table','menu_items'),
    ('table','order_financials'),
    ('table','customer_addresses'),
    ('table','customer_contact_profiles')
)
select
  object_type,
  object_name,
  case
    when object_type = 'table'
      then case when to_regclass('public.' || object_name) is null then 'MISSING' else 'PRESENT' end
  end as status
from expected_objects
order by object_type, object_name;

select
  'function' as object_type,
  expected.signature as object_name,
  case when to_regprocedure(expected.signature) is null then 'MISSING' else 'PRESENT' end as status
from (values
  ('public.is_platform_admin()'),
  ('public.has_restaurant_role(uuid,text[])'),
  ('public.create_order_with_items(uuid,text,text,text,text,jsonb)'),
  ('public.place_customer_order(uuid,text,uuid,text,jsonb)')
) as expected(signature)
order by expected.signature;

select
  'column' as object_type,
  expected.table_name || '.' || expected.column_name as object_name,
  case when c.column_name is null then 'MISSING' else 'PRESENT' end as status
from (values
  ('orders','channel'),
  ('orders','restaurant_id'),
  ('orders','status'),
  ('orders','customer_id'),
  ('orders','delivery_type'),
  ('restaurants','is_published'),
  ('menu_items','price')
) as expected(table_name,column_name)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = expected.table_name
 and c.column_name = expected.column_name
order by object_name;

select
  t.tgname as trigger_name,
  c.relname as table_name,
  pg_get_triggerdef(t.oid) as trigger_definition
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('orders')
  and not t.tgisinternal
order by t.tgname;

select
  schemaname,
  tablename,
  policyname,
  cmd,
  roles
from pg_policies
where schemaname = 'public'
  and tablename in ('orders','order_items','order_status_history','restaurant_members')
order by tablename, policyname;

select
  to_regclass('supabase_migrations.schema_migrations') is not null
    as supabase_migration_history_table_exists;
