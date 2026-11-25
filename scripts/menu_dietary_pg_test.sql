-- Run after isolated fixture and candidate; never on production.
do $$begin
 if (select count(*) from public.menu_items where dietary_type is null)<>2 then raise exception 'legacy classifications overwritten';end if;
 if not exists(select 1 from public.menu_items where name='Legacy Veg' and price=120 and is_vegetarian=true)
 or not exists(select 1 from public.menu_items where name='Legacy Other' and price=200 and is_vegetarian=false)
 then raise exception 'existing menu data changed';end if;
end$$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
update public.menu_items set dietary_type='egg',is_vegetarian=false
 where id='20000000-0000-0000-0000-000000000001';
do $$begin
 if not exists(select 1 from public.menu_items where dietary_type='egg' and is_vegetarian=false) then raise exception 'owner Egg not saved';end if;
 begin
  update public.menu_items set is_vegetarian=true where dietary_type='egg';
  raise exception 'Egg labelled vegetarian';
 exception when check_violation then null;end;
 begin
  update public.menu_items set dietary_type='vegan' where dietary_type='egg';
  raise exception 'invalid type accepted';
 exception when check_violation then null;end;
 update public.menu_items set dietary_type='egg' where id='20000000-0000-0000-0000-000000000002';
 if found then raise exception 'cross-tenant dietary edit allowed';end if;
 begin
  update public.menu_items set restaurant_id='10000000-0000-0000-0000-000000000002' where dietary_type='egg';
  raise exception 'cross-tenant reassignment allowed';
 exception when insufficient_privilege then null;end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
update public.menu_items set dietary_type='nonveg',is_vegetarian=false where dietary_type='egg';
do $$begin
 if not exists(select 1 from public.menu_items where dietary_type='nonveg') then raise exception 'manager could not classify';end if;
end$$;
-- Foreign owner, ordinary staff and platform admin cannot edit dietary data.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$begin
 update public.menu_items set dietary_type='egg' where id='20000000-0000-0000-0000-000000000001';
 if found then raise exception 'foreign owner allowed';end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
do $$begin
 update public.menu_items set dietary_type='egg' where id='20000000-0000-0000-0000-000000000001';
 if found then raise exception 'staff allowed';end if;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$begin
 update public.menu_items set dietary_type='egg' where id='20000000-0000-0000-0000-000000000001';
 if found then raise exception 'platform admin operational edit allowed';end if;
end$$;
reset role;
set role anon;
do $$begin
 if not exists(select 1 from public.menu_items where dietary_type='nonveg') then raise exception 'public read missing';end if;
 update public.menu_items set dietary_type='egg';
 if found then raise exception 'anon update allowed';end if;
 begin
  insert into public.menu_items(id,restaurant_id,name,price,is_vegetarian,dietary_type)
  values('20000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000001','Unauthorized',1,false,'egg');
  raise exception 'anon insert allowed';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select 'menu dietary consistency and tenant RLS checks passed' as result;
