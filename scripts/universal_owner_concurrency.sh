#!/usr/bin/env bash
# Run only against scripts/universal_owner_pg_fixture.sql in ephemeral CI.
set -euo pipefail
qa_dir=$(mktemp -d)
trap 'rm -rf "$qa_dir"' EXIT
psql -v ON_ERROR_STOP=1 -q <<'SQL'
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
do $$declare p uuid;begin
 select id into p from public.bite_properties where name='Synthetic Hotel';
 perform public.bite_property_command(p,'room_save','{"number":"CONCURRENT","room_type":"Deluxe","nightly_rate":100,"adults":2,"children":1}',gen_random_uuid());
 perform public.bite_property_command(p,'guest_save','{"full_name":"Concurrent Test","phone":"7777777777"}',gen_random_uuid());
end $$;
SQL
qa_property=$(psql -Atq -c "select id from public.bite_properties where name='Synthetic Hotel'")
qa_room=$(psql -Atq -c "select id from public.bite_rooms where number='CONCURRENT'")
qa_guest=$(psql -Atq -c "select id from public.bite_guests where full_name='Concurrent Test'")
for qa_id in "$qa_property" "$qa_room" "$qa_guest";do [[ "$qa_id" =~ ^[0-9a-f-]{36}$ ]];done
for qa_attempt in 1 2;do
 cat > "$qa_dir/reserve-$qa_attempt.sql" <<SQL
begin;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.bite_property_command('$qa_property','reserve',jsonb_build_object('guest_id','$qa_guest','room_id','$qa_room','arrival',current_date,'departure',current_date+1,'adults',1,'children',0),gen_random_uuid());
select pg_sleep(0.7);
commit;
SQL
done
psql -v ON_ERROR_STOP=1 -q -f "$qa_dir/reserve-1.sql" > "$qa_dir/one.log" 2>&1 & qa_one=$!
psql -v ON_ERROR_STOP=1 -q -f "$qa_dir/reserve-2.sql" > "$qa_dir/two.log" 2>&1 & qa_two=$!
qa_success=0
if wait "$qa_one";then qa_success=$((qa_success+1));fi
if wait "$qa_two";then qa_success=$((qa_success+1));fi
[[ "$qa_success" == 1 ]]
[[ "$(psql -Atq -c "select count(*) from public.bite_stays where room_id='$qa_room' and status='reserved'")" == 1 ]]
echo 'PASS: two concurrent requests for the last room create exactly one stay'
qa_folio=$(psql -Atq -c "select f.id from public.bite_folios f join public.bite_stays s on s.id=f.stay_id where s.room_id='$qa_room'")
qa_stay=$(psql -Atq -c "select id from public.bite_stays where room_id='$qa_room'")
psql -v ON_ERROR_STOP=1 -q <<SQL
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.bite_property_command('$qa_property','checkin',jsonb_build_object('id','$qa_stay'),gen_random_uuid());
SQL
cat > "$qa_dir/charge.sql" <<SQL
set role authenticated;
set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.bite_property_command('$qa_property','charge',jsonb_build_object('folio_id','$qa_folio','amount',20,'description','Concurrent retry'),'98989898-9898-4989-8989-989898989898');
SQL
psql -v ON_ERROR_STOP=1 -q -f "$qa_dir/charge.sql" > "$qa_dir/charge-one.log" 2>&1 & qa_one=$!
psql -v ON_ERROR_STOP=1 -q -f "$qa_dir/charge.sql" > "$qa_dir/charge-two.log" 2>&1 & qa_two=$!
wait "$qa_one";wait "$qa_two"
[[ "$(psql -Atq -c "select count(*) from public.bite_folio_entries where folio_id='$qa_folio' and description='Concurrent retry'")" == 1 ]]
echo 'PASS: concurrent identical charge retries create exactly one ledger entry'
