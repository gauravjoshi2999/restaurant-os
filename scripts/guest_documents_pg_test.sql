-- A108: real policy/RPC execution in disposable PostgreSQL, synthetic metadata.
begin;
create table public.document_qa(p uuid,g uuid,d uuid,path text);
grant select,insert,update on public.document_qa to authenticated;
create function pg_temp.document_denied(q text) returns void language plpgsql as $$
begin
 begin execute q;exception when sqlstate '42501' or sqlstate '22023' or sqlstate 'P0002' then return;end;
 raise exception 'Expected document denial: %',q;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$ declare p uuid;g uuid;d uuid:=gen_random_uuid();v jsonb;r jsonb;begin
 p:=public.bite_create_property('Synthetic document privacy','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic masked-copy guest","phone":"9999999999"}',gen_random_uuid())->>'id')::uuid;
 v:='{"kind":"masked_id","mime_type":"image/png","byte_size":8,"redacted_confirmed":true}'::jsonb;
 r:=public.bite_guest_document_command(p,g,d,'begin',v);
 assert r=public.bite_guest_document_command(p,g,d,'begin',v),'Unknown-response retries must return the same document';
 insert into public.document_qa values(p,g,d,r->>'object_path');
 assert jsonb_array_length(public.bite_guest_document_list(p,g))=1;
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',p,g,d,(v||'{"byte_size":9}')::text));
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''finish'')',p,g,d));
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',p,g,gen_random_uuid(),(v||'{"redacted_confirmed":false}')::text));
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',p,g,gen_random_uuid(),(v||'{"mime_type":"image/svg+xml"}')::text));
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',p,g,gen_random_uuid(),(v||'{"byte_size":4194305}')::text));
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',p,g,gen_random_uuid(),(v||'{"byte_size":0}')::text));
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',p,gen_random_uuid(),gen_random_uuid(),v::text));
 perform pg_temp.document_denied(format('insert into public.bite_guest_documents(id,property_id,guest_id,kind,mime_type,byte_size,object_path,created_by) values(%L,%L,%L,''masked_id'',''image/png'',8,''bypass'',auth.uid())',gen_random_uuid(),p,g));
end $$;
-- No API operation: neither direct Data API SELECT nor signed URL generation.
select set_config('storage.operation','object.upload',true);
insert into storage.objects(bucket_id,name,metadata,owner_id)
 select 'bite-guest-documents',path,'{"size":8,"mimetype":"image/png"}',auth.uid()::text from document_qa;
do $$declare q document_qa;begin
 select * into q from document_qa;
 perform public.bite_guest_document_command(q.p,q.g,q.d,'finish');
 perform public.bite_guest_document_command(q.p,q.g,q.d,'finish');
 assert (select count(*) from public.bite_property_audit where entity_id=q.d and action='guest_document_complete')=1;
 assert public.bite_guest_document_list(q.p,q.g)->0->>'status'='ready';
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''forget'')',q.p,q.g,q.d));
 assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents');
end $$;
select set_config('storage.operation','storage.object.get_authenticated',true);
do $$begin assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents'),'Direct Storage URL remains disabled even for an owner';end $$;
select set_config('storage.operation','object.get_authenticated_info',true);
do $$begin assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents'),'No cached Storage metadata read';end $$;
select set_config('storage.operation','object.head_authenticated_info',true);
do $$begin assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents'),'No cached Storage HEAD metadata read';end $$;
select set_config('storage.operation','storage.object.sign',true);
do $$begin assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents'),'Bearer URL signing must be denied';end $$;
select set_config('storage.operation','object.list',true);
do $$begin assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents'),'Raw bucket listing must be denied';end $$;
select set_config('storage.operation','object.copy',true);
do $$declare q document_qa;begin
 select * into q from document_qa;
 perform pg_temp.document_denied(format('insert into storage.objects(bucket_id,name) values(''bite-guest-documents'',%L)',q.path||'.copy'));
end $$;
-- Even the broad fixture UPDATE policy cannot replace an existing copy.
select set_config('storage.operation','object.get_authenticated',true);
do $$declare n integer;begin update storage.objects set metadata='{}' where bucket_id='bite-guest-documents';get diagnostics n=row_count;assert n=0;end $$;
-- Current property permissions, not filename knowledge or uploader JWT claims.
reset role;
insert into public.bite_property_members(property_id,user_id,role,active)
 select p,'33333333-3333-4333-8333-333333333333','receptionist',true from document_qa;
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$declare q document_qa;begin
 select * into q from document_qa;assert jsonb_array_length(public.bite_guest_document_list(q.p,q.g))=1;
 assert public.bite_guest_document_read(q.p,q.g,q.d)->>'id'=q.d::text;
 assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents');
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''finish'')',q.p,q.g,q.d));
end $$;
reset role;
update public.bite_property_members set active=false where user_id='33333333-3333-4333-8333-333333333333' and property_id in(select p from document_qa);
set role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
do $$declare q document_qa;begin
 select * into q from document_qa;
 assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents'),'Revoked membership must invalidate the same JWT';
 perform pg_temp.document_denied(format('select public.bite_guest_document_list(%L,%L)',q.p,q.g));
  perform pg_temp.document_denied(format('select public.bite_guest_document_read(%L,%L,%L)',q.p,q.g,q.d));
end $$;
-- An outsider, platform admin, cashier, housekeeper and accountant cannot read.
reset role;
insert into public.bite_property_members(property_id,user_id,role,active)
 select p,u,r,true from document_qa cross join (values
 ('44444444-4444-4444-8444-444444444444'::uuid,'housekeeping'),
 ('55555555-5555-4555-8555-555555555555'::uuid,'accountant'),
 ('77777777-7777-4777-8777-777777777777'::uuid,'cashier')) as x(u,r);
set role authenticated;
do $$declare u text;q document_qa;begin
 select * into q from document_qa;
 foreach u in array array['22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666','77777777-7777-4777-8777-777777777777'] loop
  perform set_config('request.jwt.claim.sub',u,true);
  assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents');
  assert not exists(select 1 from public.bite_guest_documents);
  perform pg_temp.document_denied(format('select public.bite_guest_document_list(%L,%L)',q.p,q.g));
  perform pg_temp.document_denied(format('select public.bite_guest_document_read(%L,%L,%L)',q.p,q.g,q.d));
  perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''forget'')',q.p,q.g,q.d));
 end loop;
end $$;
set role anon;
select set_config('request.jwt.claim.sub','',true);
do $$begin
 assert not exists(select 1 from storage.objects where bucket_id='bite-guest-documents');
 perform pg_temp.document_denied('select * from public.bite_guest_documents');
 perform pg_temp.document_denied('select public.bite_guest_document_list(gen_random_uuid(),gen_random_uuid())');
end $$;
-- Actual deletion must precede metadata retirement; repeat safely.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('storage.operation','object.delete_many',true);
delete from storage.objects where bucket_id='bite-guest-documents';
do $$declare q document_qa;v jsonb;d uuid;begin
 select * into q from document_qa;
 perform public.bite_guest_document_command(q.p,q.g,q.d,'forget');
 perform public.bite_guest_document_command(q.p,q.g,q.d,'forget');
 assert public.bite_guest_document_list(q.p,q.g)='[]'::jsonb;
 assert (select count(*) from public.bite_property_audit where entity_id=q.d and action='guest_document_delete')=1;
 v:='{"kind":"supporting_record","mime_type":"application/pdf","byte_size":10,"redacted_confirmed":true}'::jsonb;
 for i in 1..5 loop d:=gen_random_uuid();perform public.bite_guest_document_command(q.p,q.g,d,'begin',v);end loop;
 perform pg_temp.document_denied(format('select public.bite_guest_document_command(%L,%L,%L,''begin'',%L)',q.p,q.g,gen_random_uuid(),v::text));
 assert jsonb_array_length(public.bite_guest_document_list(q.p,q.g))=5;
 assert not (public.bite_hotel_workspace(q.p)::text like '%object_path%'),'Document paths never join normal workspace or guest bill payloads';
end $$;
rollback;
select 'PASS A108: optional private copies, exact guest/property scope, revoked membership, protected operations, once-only completion/deletion and bounded retention; SQL metadata scope only' as result;
