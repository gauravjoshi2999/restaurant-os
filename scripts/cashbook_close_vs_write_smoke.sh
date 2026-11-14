#!/usr/bin/env bash
# Ephemeral GitHub CI fixture ONLY. Never point this script at live Supabase.
set -euo pipefail
if [[ "$CI" != "true" || "$PGDATABASE" != "bite_cashbook_ci" || "$PGHOST" != "localhost" ]]; then
  echo "REFUSED: only bite_cashbook_ci on local GitHub CI PostgreSQL is allowed" >&2
  exit 2
fi
tmp_dir="$(mktemp -d)"
holder=""
cleanup() {
  if [[ -n "$holder" ]]; then kill "$holder" 2>/dev/null || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
wait_for_lock() {
  local ready=0 count
  for _ in $(seq 1 50); do
    count="$(psql -X -Atqc "select count(*) from pg_catalog.pg_locks where locktype='advisory' and granted and pid<>pg_catalog.pg_backend_pid()")"
    if [[ "$count" -ge 1 ]]; then ready=1; break; fi
    if ! kill -0 "$holder" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [[ "$ready" -ne 1 ]]; then
    cat "$tmp_dir/holder.log" >&2
    echo "FAIL: expected an advisory lock" >&2
    exit 1
  fi
}
finish_holder() {
  if ! wait "$holder"; then cat "$tmp_dir/holder.log" >&2; exit 1; fi
  holder=""
}

# CASE A: Closing owns the day lock. Source write must wait, then be rejected.
psql -X -v ON_ERROR_STOP=1 >"$tmp_dir/holder.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.close_restaurant_cashbook_day(
 '22222222-2222-4222-8222-222222222222','2099-12-21',100,100,null);
select pg_catalog.pg_sleep(4);
commit;
SQL
holder=$!
wait_for_lock
if psql -X -v ON_ERROR_STOP=1 >"$tmp_dir/writer-wait.log" 2>&1 <<'SQL'
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local lock_timeout='700ms';
insert into public.restaurant_cashbook_manual_entries
 (restaurant_id,entry_date,direction,category,amount,payment_method)
 values ('22222222-2222-4222-8222-222222222222','2099-12-21','in','Late cash',1,'Cash');
rollback;
SQL
then
  echo "FAIL: source insert bypassed closing lock" >&2; exit 1
fi
grep -q 'canceling statement due to lock timeout' "$tmp_dir/writer-wait.log" ||
  { cat "$tmp_dir/writer-wait.log"; echo "FAIL: unrelated write error"; exit 1; }
finish_holder
if psql -X -v ON_ERROR_STOP=1 >"$tmp_dir/writer-closed.log" 2>&1 <<'SQL'
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.restaurant_cashbook_manual_entries
 (restaurant_id,entry_date,direction,category,amount,payment_method)
 values ('22222222-2222-4222-8222-222222222222','2099-12-21','in','Late cash',1,'Cash');
rollback;
SQL
then
  echo "FAIL: source write accepted after completed closing" >&2; exit 1
fi
grep -q 'This cashbook day is already closed' "$tmp_dir/writer-closed.log" ||
  { cat "$tmp_dir/writer-closed.log"; echo "FAIL: unrelated closed-day error"; exit 1; }

# CASE B: Source owns the day lock. Closing must wait and then count that cash.
psql -X -v ON_ERROR_STOP=1 >"$tmp_dir/holder.log" 2>&1 <<'SQL' &
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
insert into public.restaurant_cashbook_manual_entries
 (restaurant_id,entry_date,direction,category,amount,payment_method)
 values ('22222222-2222-4222-8222-222222222222','2099-12-20','in','Before close',7,'Cash');
select pg_catalog.pg_sleep(4);
commit;
SQL
holder=$!
wait_for_lock
if psql -X -v ON_ERROR_STOP=1 >"$tmp_dir/closing-wait.log" 2>&1 <<'SQL'
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
set local lock_timeout='700ms';
select public.close_restaurant_cashbook_day(
 '22222222-2222-4222-8222-222222222222','2099-12-20',100,107,null);
rollback;
SQL
then
  echo "FAIL: close bypassed in-flight source write lock" >&2; exit 1
fi
grep -q 'canceling statement due to lock timeout' "$tmp_dir/closing-wait.log" ||
  { cat "$tmp_dir/closing-wait.log"; echo "FAIL: unrelated close error"; exit 1; }
finish_holder

psql -X -v ON_ERROR_STOP=1 >"$tmp_dir/closing-count.log" 2>&1 <<'SQL'
begin;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select public.close_restaurant_cashbook_day(
 '22222222-2222-4222-8222-222222222222','2099-12-20',100,107,null);
do $assert$
begin
 if not exists(
  select 1 from public.restaurant_cashbook_closings
  where restaurant_id='22222222-2222-4222-8222-222222222222'
    and close_date='2099-12-20' and cash_in=7 and cash_out=0
    and expected_cash=107 and counted_cash=107
 ) then raise exception 'FAIL: closing omitted committed cash'; end if;
end
$assert$;
rollback;
SQL
echo "PASS: actual closing RPC versus cash source race verified in both orders"
