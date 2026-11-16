#!/usr/bin/env bash
# Disposable CI database only. Exercises blocking across separate PG sessions.
set -euo pipefail
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -v ON_ERROR_STOP=1 -q <<'SQL'
insert into public.restaurants(id,name,created_by,status,onboarding_status)values('adadadad-adad-4dad-8dad-adadadadadad','Closing race QA','66666666-6666-4666-8666-666666666666','Active','approved');
insert into public.bite_properties(id,business_id,name,business_type,capabilities)select 'edededed-eded-4ded-8ded-edededededed',id,'Closing race QA','restaurant',private.bite_default_capabilities('restaurant') from public.bite_businesses where owner_id='11111111-1111-4111-8111-111111111111';
insert into public.bite_property_members values('edededed-eded-4ded-8ded-edededededed','11111111-1111-4111-8111-111111111111','owner',true);
insert into public.bite_property_outlets values('edededed-eded-4ded-8ded-edededededed','adadadad-adad-4dad-8dad-adadadadadad');
insert into public.restaurant_members values('adadadad-adad-4dad-8dad-adadadadadad','11111111-1111-4111-8111-111111111111','owner');
SQL
wait_marker(){
 for task_n in {1..80};do
  if [[ $(psql -Atqc 'select not pg_try_advisory_lock(9876543399)') == t ]];then return;fi
  sleep 0.05
 done
 echo 'Timed out waiting for combined closing transaction' >&2;exit 1
}
cat > "$task_tmp/close.sql" <<'SQL'
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$declare p uuid:='edededed-eded-4ded-8ded-edededededed';v jsonb;begin
 v:=public.bite_property_report(p,current_date,current_date);
 perform public.bite_property_command(p,'close_shift',jsonb_build_object('shift_date',current_date,'opening_cash',100,'counted_cash',99,'source_hash',v->>'source_hash','lock_journals',true),gen_random_uuid());
end $$;
select pg_advisory_xact_lock(9876543399);
select pg_sleep(1.5);
commit;
SQL
psql -v ON_ERROR_STOP=1 > "$task_tmp/source.log" 2>&1 <<'SQL' &
begin;
insert into public.restaurant_expenses(restaurant_id,expense_date,amount,payment_method)values('adadadad-adad-4dad-8dad-adadadadadad',current_date,1,'Cash');
select pg_advisory_xact_lock(9876543399);
select pg_sleep(1.5);
commit;
SQL
task_job=$!
wait_marker
if psql -v ON_ERROR_STOP=1 -f "$task_tmp/close.sql" > "$task_tmp/stale.log" 2>&1;then echo 'FAIL: stale closing accepted a concurrent source';exit 1;fi
wait "$task_job"
grep -q 'Ledger changed' "$task_tmp/stale.log"
[[ $(psql -Atqc "select count(*) from public.bite_property_shift_closings where property_id='edededed-eded-4ded-8ded-edededededed'") == 0 ]]
psql -v ON_ERROR_STOP=1 -f "$task_tmp/close.sql" > "$task_tmp/close.log" 2>&1 &
task_job=$!
wait_marker
if psql -v ON_ERROR_STOP=1 -c "insert into public.restaurant_expenses(restaurant_id,expense_date,amount)values('adadadad-adad-4dad-8dad-adadadadadad',current_date,2)" > "$task_tmp/late.log" 2>&1;then echo 'FAIL: source passed a concurrent closing';exit 1;fi
wait "$task_job"
grep -q 'day is locked' "$task_tmp/late.log"
[[ $(psql -Atqc "select count(*) from public.restaurant_expenses where restaurant_id='adadadad-adad-4dad-8dad-adadadadadad'") == 1 ]]
echo 'PASS: combined day close vs source writes serializes in both directions; stale review rejected'
