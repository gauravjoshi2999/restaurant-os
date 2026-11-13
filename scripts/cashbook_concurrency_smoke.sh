#!/usr/bin/env bash
# Ephemeral CI PostgreSQL ONLY: prove source INSERT waits on the SAME lock
# as closing. Never run this against a production Supabase database.
set -euo pipefail

# Session A: hold the exact day lock used by both migration triggers and RPC.
psql -v ON_ERROR_STOP=1 >/tmp/bite-cashbook-session-a.log 2>&1 <<'SQL' &
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
 'bite.cashbook.day.v1|22222222-2222-4222-8222-222222222222|2099-12-24',0::bigint));
select pg_catalog.pg_sleep(5);
rollback;
SQL
holder=$!
trap 'kill "$holder" 2>/dev/null || true' EXIT

# Wait until A actually holds its advisory lock (avoid timing-based flakiness).
ready=0
for _ in $(seq 1 30); do
 count="$(psql -Atqc "select count(*) from pg_catalog.pg_locks where locktype='advisory' and granted and pid<>pg_catalog.pg_backend_pid()")"
 if [ "$count" -ge 1 ]; then ready=1; break; fi
 sleep 0.1
done
if [ "$ready" -ne 1 ]; then
 cat /tmp/bite-cashbook-session-a.log
 echo "FAIL: advisory lock holder did not become ready"
 exit 1
fi

# Session B: an otherwise-valid source write must time out waiting for A.
if psql -v ON_ERROR_STOP=1 >/tmp/bite-cashbook-session-b.log 2>&1 <<'SQL'
begin;
set local lock_timeout='500ms';
insert into public.restaurant_cashbook_manual_entries
 (restaurant_id,entry_date,direction,category,amount,payment_method)
 values ('22222222-2222-4222-8222-222222222222','2099-12-24','in','Concurrent cash',1,'Cash');
rollback;
SQL
then
 cat /tmp/bite-cashbook-session-b.log
 echo "FAIL: source INSERT bypassed day lock"
 exit 1
fi
if ! grep -q 'canceling statement due to lock timeout' /tmp/bite-cashbook-session-b.log; then
 cat /tmp/bite-cashbook-session-b.log
 echo "FAIL: source INSERT failed for an unrelated reason"
 exit 1
fi
wait "$holder"
trap - EXIT

# Once the lock is released, a source write on an OPEN day succeeds.
psql -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
begin;
insert into public.restaurant_cashbook_manual_entries
 (restaurant_id,entry_date,direction,category,amount,payment_method)
 values ('22222222-2222-4222-8222-222222222222','2099-12-24','in','Open cash',1,'Cash');
rollback;
SQL
echo "PASS: two-session cashbook advisory lock serializes writes and releases on rollback"
