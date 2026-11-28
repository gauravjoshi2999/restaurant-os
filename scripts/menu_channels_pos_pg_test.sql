-- Isolated PostgreSQL only. Run after the menu dietary fixture.
begin;
\ir ../docs/sql/menu_channels_visibility_candidate.sql
create schema private;
grant usage on schema private to authenticated;
create table public.bite_property_outlets(property_id uuid,restaurant_id uuid);
create table public.orders(
 id uuid primary key default gen_random_uuid(),restaurant_id uuid,order_code text,
 channel text,amount numeric,status text,customer_name text,customer_phone text,
 created_by uuid,table_id uuid
);
create table public.order_items(
 order_id uuid references public.orders(id),item_name text,quantity numeric,
 unit_price numeric,menu_item_id uuid references public.menu_items(id)
);
create function public.create_order_financial_snapshot(uuid) returns void language plpgsql as $$begin return; end$$;
\i :writer_file
grant execute on function private.create_order_with_items_and_table(uuid,text,text,text,text,jsonb,uuid) to authenticated;
\ir ../docs/sql/menu_channels_pos_candidate.sql
insert into public.bite_property_outlets values ('80000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001');
update public.menu_items set available_room=false where id='20000000-0000-0000-0000-000000000001';
insert into public.menu_items(id,restaurant_id,name,price,is_available,available_pos,available_room) values
 ('80000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Room dish',100,true,false,true),
 ('80000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','Paused dish',100,false,true,true);
create temp table menu_channel_test_scope(id integer);
create function pg_temp.create_menu_test_bill(p_item uuid) returns uuid language sql as $$
 select private.create_order_with_items_and_table(
  '10000000-0000-0000-0000-000000000001',gen_random_uuid()::text,'POS - Counter','','',
  jsonb_build_array(jsonb_build_object('name','Recorded name','quantity',2,'unit_price',100,'menu_item_id',p_item)),null)
$$;
create function pg_temp.expect_channel_rejection(p_item uuid) returns void language plpgsql as $$
begin
 begin
  perform pg_temp.create_menu_test_bill(p_item);
  raise exception 'Expected channel rejection for %',p_item;
 exception when invalid_parameter_value then null;
 end;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.create_menu_test_bill('20000000-0000-0000-0000-000000000001');
select pg_temp.expect_channel_rejection('80000000-0000-0000-0000-000000000002');
select pg_temp.expect_channel_rejection('80000000-0000-0000-0000-000000000003');
select pg_temp.expect_channel_rejection('20000000-0000-0000-0000-000000000002');
-- Stand in for the trusted room command scope while exercising the shared writer.
select set_config('bite.staff_room_charge_scope','80000000-0000-0000-0000-000000000001',true);
select pg_temp.create_menu_test_bill('80000000-0000-0000-0000-000000000002');
select pg_temp.expect_channel_rejection('20000000-0000-0000-0000-000000000001');
select pg_temp.expect_channel_rejection('80000000-0000-0000-0000-000000000003');
select pg_temp.create_menu_test_bill(null);
reset role;
do $$
begin
 if (select count(*) from public.orders)<>3
  or (select count(*) from public.order_items where menu_item_id is not null)<>2
  or (select count(*) from public.order_items where menu_item_id is null)<>1
  or (select sum(amount) from public.orders)<>600 then
  raise exception 'Channel validation changed bill totals, lost IDs, or left a rejected bill';
 end if;
end $$;
rollback;
