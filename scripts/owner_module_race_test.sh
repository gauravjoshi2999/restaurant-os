#!/usr/bin/env bash
# ONLY the disposable Universal Owner CI database. No provider or network calls.
set -euo pipefail
task_tmp=$(mktemp -d)
trap 'rm -rf "$task_tmp"' EXIT
psql -v ON_ERROR_STOP=1 <<'SQL'
insert into public.restaurants(id,name)values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Synthetic module race');
insert into public.restaurant_members(restaurant_id,user_id,role)values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','11111111-1111-4111-8111-111111111111','owner');
insert into public.bite_properties(id,business_id,origin_restaurant_id,name,business_type,capabilities)
select 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','Synthetic module race','restaurant',private.bite_default_capabilities('restaurant') from public.bite_businesses where owner_id='11111111-1111-4111-8111-111111111111';
insert into public.bite_property_members values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','11111111-1111-4111-8111-111111111111','owner',true);
insert into public.bite_property_outlets values('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc');
SQL
wait_marker(){
 for task_n in {1..60};do
  if [[ $(psql -Atqc 'select not pg_try_advisory_lock(9876543301)') == t ]];then return 0;fi
  sleep 0.05
 done
 echo 'Timed out waiting for concurrent module transaction' >&2;return 1
}
disable_sql="select public.bite_property_command('dddddddd-dddd-4ddd-8ddd-dddddddddddd','config','{\"name\":\"Synthetic module race\",\"business_type\":\"restaurant\",\"capabilities\":[\"restaurant_pos\",\"restaurant_menu\",\"dine_in\",\"takeaway\",\"inventory\",\"expenses\",\"staff_management\",\"reporting\"]}'::jsonb,gen_random_uuid());"
psql -v ON_ERROR_STOP=1 >"$task_tmp/disable.log" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
$disable_sql
select pg_advisory_xact_lock(9876543301);
select pg_sleep(1.5);
commit;
SQL
task_job=$!
wait_marker
if psql -v ON_ERROR_STOP=1 -c "insert into public.bite_live_checkout_intents values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','awaiting_payment')" >"$task_tmp/intent.log" 2>&1;then
 echo 'FAIL: checkout passed a concurrent module disable';exit 1
fi
wait "$task_job"
rg -q 'Business module disabled' "$task_tmp/intent.log"
psql -v ON_ERROR_STOP=1 -qc "update public.bite_properties set capabilities=private.bite_default_capabilities('restaurant') where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'"
psql -v ON_ERROR_STOP=1 >"$task_tmp/intent-first.log" 2>&1 <<'SQL' &
begin;
insert into public.bite_live_checkout_intents values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','awaiting_payment');
select pg_advisory_xact_lock(9876543301);
select pg_sleep(1.5);
commit;
SQL
task_job=$!
wait_marker
if psql -v ON_ERROR_STOP=1 >"$task_tmp/config.log" 2>&1 <<SQL
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
$disable_sql
commit;
SQL
then echo 'FAIL: disable ignored the concurrent pending checkout';exit 1;fi
wait "$task_job"
rg -q 'pending online checkouts' "$task_tmp/config.log"
[[ $(psql -Atqc "select 'online_food_orders'=any(capabilities) from public.bite_properties where id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'") == t ]]
echo 'PASS: module disable and checkout creation serialize correctly in both directions'
