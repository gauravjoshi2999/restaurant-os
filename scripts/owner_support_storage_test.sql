-- Run after ticket-history test. Reopen ticket with trusted admin before owner screenshot test.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
update public.owner_support_tickets set status='Open';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into storage.objects values ('bite-owner-support','20000000-0000-0000-0000-000000000001/screenshot');
do $$begin
 if (select count(*) from storage.objects)<>1 then raise exception 'owner cannot see own screenshot'; end if;
 begin
  insert into storage.objects values ('bite-owner-support','20000000-0000-0000-0000-000000000001/extra');
  raise exception 'extra file allowed';
 exception when insufficient_privilege then null; end;
 update storage.objects set name='replacement';
 if found then raise exception 'replace allowed'; end if;
 delete from storage.objects;
 if found then raise exception 'delete allowed'; end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 if exists(select 1 from storage.objects) then raise exception 'cross-tenant screenshot read'; end if;
 begin
  insert into storage.objects values ('bite-owner-support','20000000-0000-0000-0000-000000000001/screenshot');
  raise exception 'cross-tenant upload allowed';
 exception when insufficient_privilege then null; end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$begin
 if exists(select 1 from storage.objects) then raise exception 'staff screenshot read'; end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if (select count(*) from storage.objects)<>1 then raise exception 'admin cannot read screenshot'; end if;
 delete from storage.objects;
 if found then raise exception 'admin delete allowed'; end if;
end$$;
reset role;
set role anon;
do $$begin
 if exists(select 1 from storage.objects) then raise exception 'anonymous screenshot read'; end if;
end$$;
reset role;
do $$begin
 if not exists(select 1 from storage.buckets where id='bite-owner-support' and public=false and file_size_limit=3145728 and allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[]) then raise exception 'unsafe bucket settings'; end if;
end$$;
select 'owner support screenshot RLS tests passed' as result;
