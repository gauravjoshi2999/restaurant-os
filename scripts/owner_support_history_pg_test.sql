-- Isolated database; requires owner_support_pg_test.sql to have completed.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$begin
 if (select count(*) from public.owner_support_ticket_events)<>2 then raise exception 'missing opened/resolved events'; end if;
 if not exists(select 1 from public.owner_support_ticket_events where event_kind='Opened' and status='Open') then raise exception 'missing initial state'; end if;
 if not exists(select 1 from public.owner_support_ticket_events where event_kind='Updated' and previous_status='Open' and status='Resolved' and response='Fixed') then raise exception 'missing transition'; end if;
 begin
  insert into public.owner_support_ticket_events(ticket_id,event_kind,status) values ('20000000-0000-0000-0000-000000000001','Opened','Open');
  raise exception 'owner can forge history';
 exception when insufficient_privilege then null; end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 if exists(select 1 from public.owner_support_ticket_events) then raise exception 'cross-tenant history read'; end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$begin
 if exists(select 1 from public.owner_support_ticket_events) then raise exception 'staff history read'; end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 if (select count(*) from public.owner_support_ticket_events)<>2 then raise exception 'admin history missing'; end if;
 update public.owner_support_tickets set status='Resolved',admin_response='Fixed';
 if (select count(*) from public.owner_support_ticket_events)<>2 then raise exception 'duplicate history on same reply'; end if;
 update public.owner_support_tickets set admin_response='Fixed again';
 if (select count(*) from public.owner_support_ticket_events)<>3 then raise exception 'new reply not recorded'; end if;
 begin
  delete from public.owner_support_ticket_events;
  raise exception 'admin can delete history';
 exception when insufficient_privilege then null; end;
end$$;
reset role;
set role anon;
do $$begin
 begin
  perform 1 from public.owner_support_ticket_events;
  raise exception 'anon can read history';
 exception when insufficient_privilege then null; end;
end$$;
reset role;
select 'owner support history tests passed' as result;
