#!/usr/bin/env bash
# Disposable PostgreSQL only: two simultaneous fifth copies cannot both win.
set -euo pipefail
qa_tmp=$(mktemp -d)
trap 'rm -rf "$qa_tmp"' EXIT
psql -v ON_ERROR_STOP=1 >"$qa_tmp/setup" <<'SQL'
create table public.document_race(p uuid,g uuid);
grant select,insert on public.document_race to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$declare p uuid;g uuid;begin
 p:=public.bite_create_property('Synthetic copy-limit race','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic race guest","phone":"9999999999"}',gen_random_uuid())->>'id')::uuid;
 insert into public.document_race values(p,g);
 for i in 1..4 loop perform public.bite_guest_document_command(p,g,gen_random_uuid(),'begin','{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}');end loop;
end $$;
SQL
attempt(){
 psql -v ON_ERROR_STOP=1 >"$qa_tmp/$1.log" 2>&1 <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
select public.bite_guest_document_command(p,g,gen_random_uuid(),'begin','{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}') from public.document_race;
SQL
}
attempt first & first_pid=$!
attempt second & second_pid=$!
winners=0
if wait "$first_pid";then winners=$((winners+1));else grep -Fq 'Five copies already exist' "$qa_tmp/first.log";fi
if wait "$second_pid";then winners=$((winners+1));else grep -Fq 'Five copies already exist' "$qa_tmp/second.log";fi
test "$winners" -eq 1
psql -v ON_ERROR_STOP=1 >"$qa_tmp/check" <<'SQL'
do $$begin assert (select count(*) from public.bite_guest_documents where property_id in(select p from public.document_race))=5;end $$;
SQL
echo 'PASS A108: exactly one concurrent fifth copy; bounded private-copy count preserved'
