"""Generate one rollback-only migration + role regression probe. No deployment."""
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
schema=(root/'supabase/migrations/20261109201541_bite_launch_completion.sql').read_text()
schema+='\n'+(root/'supabase/migrations/20261110124118_customer_payment_recovery.sql').read_text()
body=(root/'scripts/launch_completion_regression.sql').read_text()+'\n'+(root/'scripts/customer_payment_recovery_regression.sql').read_text()
sql="""DO $launch_qa$
<<launch_qa>>
DECLARE oa uuid:=gen_random_uuid();ob uuid:=gen_random_uuid();ca uuid:=gen_random_uuid();cb uuid:=gen_random_uuid();
ra uuid:=gen_random_uuid();rb uuid:=gen_random_uuid();meal uuid;addr uuid;admin_id uuid;coupon uuid;intent uuid;order_id uuid;
refund_job uuid;refund_reference text;request_key uuid:=gen_random_uuid();code text:='QA'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
q jsonb;amount numeric;blocked boolean;result jsonb:='[]';
BEGIN BEGIN
EXECUTE $migration$"""+schema+"$migration$;\n"+body+"\nRAISE SQLSTATE 'ZX996';\nEXCEPTION WHEN SQLSTATE 'ZX996' THEN NULL; END;\nPERFORM set_config('bite.qa.launch_results',result::text,false);\nEND $launch_qa$;\nSELECT current_setting('bite.qa.launch_results')::jsonb AS checks;"
out=root/'dist/launch-qa';out.mkdir(parents=True,exist_ok=True);(out/'rollback-regression.sql').write_text(sql)
if __name__=='__main__':print(json.dumps(sql))
