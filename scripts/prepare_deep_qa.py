"""Generate rollback-only Owner/Delivery SQL with ephemeral fixture IDs.

Run these generated queries using the authorized Supabase SQL connection.
They simulate database roles; they do not perform an Auth password login.
No password, provider transaction, email or WhatsApp message is created.
"""
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'dist' / 'deep-qa'
OUT.mkdir(parents=True, exist_ok=True)
for kind, filename in [('owner', 'owner_database_regression.sql'), ('delivery', 'owner_delivery_regression.sql')]:
    owner, foreign_owner, rid, foreign_rid = [str(uuid4()) for _ in range(4)]
    source = (ROOT / 'scripts' / filename).read_text()
    body = source[source.index('DO $test$'):source.index('END $test$;') + len('END $test$;')]
    for name, value in [('OWNER_ID', owner), ('RESTAURANT_ID', rid), ('FOREIGN_RESTAURANT_ID', foreign_rid)]:
        body = body.replace('__' + name + '__', value)
    owner_role = f'''EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims','{{"sub":"{owner}","role":"authenticated"}}',true);''' if kind == 'owner' else ''
    query = f'''-- Generated ephemeral QA fixtures; every write is rolled back.
DO $deep_outer$
DECLARE test_result jsonb;
BEGIN
 BEGIN
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  VALUES ('{owner}','authenticated','authenticated','qa-owner-{owner}@bite.example','{{}}','{{"full_name":"Ephemeral deep QA Owner"}}',now(),now()),
  ('{foreign_owner}','authenticated','authenticated','qa-owner-{foreign_owner}@bite.example','{{}}','{{"full_name":"Ephemeral foreign QA Owner"}}',now(),now());
  INSERT INTO public.restaurants(id,name,created_by) VALUES ('{rid}','BITE DEEP QA rollback only','{owner}'),('{foreign_rid}','BITE DEEP QA foreign rollback only','{foreign_owner}');
  {owner_role}
  EXECUTE $original_test${body}$original_test$;
  test_result:=current_setting('bite.qa.{kind}_result')::jsonb;
  RAISE SQLSTATE 'ZX999' USING MESSAGE='Rollback every fixture and business change';
 EXCEPTION WHEN SQLSTATE 'ZX999' THEN NULL;
 END;
 PERFORM set_config('bite.qa.deep_{kind}_result',test_result::text,false);
END $deep_outer$;
SELECT current_setting('bite.qa.deep_{kind}_result')::jsonb AS passed_checks;
'''
    (OUT / (kind + '_rollback.sql')).write_text(query)
    print('Prepared:', kind + '_rollback.sql')
