-- Run only on isolated fixture after foundation candidate.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
insert into public.owner_support_tickets(id,restaurant_id,category,subject,message)
values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','POS','Bill issue','Test issue');
do $$begin
 if (select count(*) from public.owner_support_tickets)<>1 then raise exception 'owner cannot see own ticket'; end if;
 begin
  insert into public.owner_support_tickets(id,restaurant_id,category,subject,message)
  values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Other','Cross scope','Not allowed');
  raise exception 'cross-tenant insert allowed';
 exception when insufficient_privilege then null; end;
 update public.owner_support_tickets set status='Resolved';
 if found then raise exception 'owner update unexpectedly allowed'; end if;
 begin
  delete from public.owner_support_tickets;
  raise exception 'owner delete allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.owner_support_tickets(id,restaurant_id,category,subject,message)
  values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','POS','Bill issue','Test issue');
  raise exception 'duplicate allowed';
 exception when unique_violation then null; end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 if exists(select 1 from public.owner_support_tickets) then raise exception 'another owner can read first tenant'; end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$begin
 if exists(select 1 from public.owner_support_tickets) then raise exception 'staff can read'; end if;
 begin
  insert into public.owner_support_tickets(id,restaurant_id,category,subject,message)
  values ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','Other','Staff issue','Not allowed');
  raise exception 'staff insert allowed';
 exception when insufficient_privilege then null; end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$declare revision timestamptz;begin
 select updated_at into revision from public.owner_support_tickets where id='20000000-0000-0000-0000-000000000001';
 if revision is null then raise exception 'admin cannot see owner ticket'; end if;
 update public.owner_support_tickets set status='Resolved',admin_response='Fixed' where id='20000000-0000-0000-0000-000000000001' and updated_at=revision;
 if not found then raise exception 'admin cannot update'; end if;
 update public.owner_support_tickets set status='Open' where id='20000000-0000-0000-0000-000000000001' and updated_at=revision;
 if found then raise exception 'stale revision accepted'; end if;
 begin
  update public.owner_support_tickets set owner_id='00000000-0000-0000-0000-000000000002';
  raise exception 'admin can reassign requester';
 exception when insufficient_privilege then null; end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 if not exists(select 1 from public.owner_support_tickets where status='Resolved' and admin_response='Fixed') then raise exception 'owner cannot read confirmed reply'; end if;
end$$;
reset role;
set role anon;
do $$begin
 begin
  perform 1 from public.owner_support_tickets;
  raise exception 'anonymous read allowed';
 exception when insufficient_privilege then null; end;
end$$;
reset role;
select 'owner support RLS tests passed' as result;
