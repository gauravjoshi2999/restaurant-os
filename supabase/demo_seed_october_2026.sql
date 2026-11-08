-- October 2026 simulated Bite dataset for Demo Royal Thali House only.
-- Safe to re-run: order codes are deterministic and expenses are checked by date/title.
-- All rows are is_demo=true. No real customer, payment, settlement or delivery is created.
begin;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role","sub":"fb9ccb33-d01f-433f-b091-165acf589d71"}',true);
do $$
declare
  v_restaurant uuid := '97012f3c-19c5-4347-b1d3-4534f887b401';
  v_owner uuid := 'fb9ccb33-d01f-433f-b091-165acf589d71';
  v_day int; v_slot int; v_order uuid; v_code text; v_target text;
  v_item1 record; v_item2 record; v_q1 numeric; v_total numeric; v_commission numeric; v_delivery numeric;
  v_steps text[]; v_step text; v_menu_count int;
begin
  select count(*) into v_menu_count from public.menu_items where restaurant_id=v_restaurant and is_available;
  if v_menu_count < 2 then raise exception 'Demo restaurant needs at least two available menu items'; end if;
  for v_day in 1..31 loop
    for v_slot in 1..2 loop
      v_code := 'BITE-DEMO-202610' || lpad(v_day::text,2,'0') || '-' || v_slot::text;
      if exists(select 1 from public.orders where restaurant_id=v_restaurant and order_code=v_code) then continue; end if;
      select id,name,price into v_item1 from public.menu_items where restaurant_id=v_restaurant and is_available order by sort_order,name offset ((v_day*2+v_slot)%v_menu_count) limit 1;
      select id,name,price into v_item2 from public.menu_items where restaurant_id=v_restaurant and is_available order by sort_order,name offset ((v_day*2+v_slot+3)%v_menu_count) limit 1;
      v_q1 := 1 + ((v_day+v_slot)%2);
      v_total := round(v_q1*v_item1.price + v_item2.price,2);
      v_delivery := case when (v_day+v_slot)%4=0 then 0 else 25 end;
      v_target := case when v_slot=1 then 'Completed' else case v_day%10 when 0 then 'Rejected' when 1 then 'Cancelled' when 2 then 'Accepted' when 3 then 'Preparing' when 4 then 'Ready' when 5 then 'Handed Over' else 'Completed' end end;
      insert into public.orders(restaurant_id,order_code,channel,amount,status,order_date,created_by,customer_name,delivery_type,delivery_address_snapshot,customer_note,status_note,is_demo)
      values(v_restaurant,v_code,'Bite Demo Simulation',v_total,'Received',
        make_timestamptz(2026,10,v_day,11+((v_day+v_slot)%8),((v_day*7+v_slot*11)%60),0,'Asia/Kolkata'),
        v_owner,'Demo Guest '||lpad(v_day::text,2,'0')||'-'||v_slot::text,
        case when v_delivery=0 then 'pickup' else 'delivery' end,
        case when v_delivery=0 then null else jsonb_build_object('label','Demo Address','address_line','Demo Delivery Lane','city','Rajsamand','state','Rajasthan','postal_code','313324') end,
        'Bite QA simulation only. No customer payment or real delivery.',
        'DEMO ONLY — simulated record; no money collected.',true)
      on conflict (restaurant_id,order_code) do nothing returning id into v_order;
      if v_order is null then continue; end if;
      insert into public.order_items(order_id,item_name,quantity,unit_price)
        values(v_order,v_item1.name,v_q1,v_item1.price),(v_order,v_item2.name,1,v_item2.price);
      v_commission := round(v_total*coalesce((select platform_commission_rate from public.restaurants where id=v_restaurant),(select default_commission_rate from public.platform_settings where id=1),10.00)/100,2);
      insert into public.order_financials(order_id,restaurant_id,channel,currency,food_subtotal,restaurant_discount,platform_discount,commissionable_food_value,commission_rate,commission_amount,tax_amount,delivery_fee,tip_amount,customer_payable_amount,payment_status,settlement_status,created_by,is_demo)
      values(v_order,v_restaurant,'Bite Demo Simulation','INR',v_total,0,0,v_total,
        coalesce((select platform_commission_rate from public.restaurants where id=v_restaurant),(select default_commission_rate from public.platform_settings where id=1),10.00),
        v_commission,0,v_delivery,0,v_total+v_delivery,'unpaid','not_ready',v_owner,true);
      if v_target='Rejected' then v_steps:=array['Rejected'];
      elsif v_target='Cancelled' then v_steps:=array['Cancelled'];
      elsif v_target='Accepted' then v_steps:=array['Accepted'];
      elsif v_target='Preparing' then v_steps:=array['Accepted','Preparing'];
      elsif v_target='Ready' then v_steps:=array['Accepted','Preparing','Ready'];
      elsif v_target='Handed Over' then v_steps:=array['Accepted','Preparing','Ready','Handed Over'];
      else v_steps:=array['Accepted','Preparing','Ready','Handed Over','Completed']; end if;
      foreach v_step in array v_steps loop
        update public.orders set status=v_step,status_note='DEMO ONLY — simulated status; no real fulfilment.' where id=v_order;
      end loop;
      v_order:=null;
    end loop;
  end loop;
  for v_day in 1..31 loop
    if not exists(select 1 from public.restaurant_expenses where restaurant_id=v_restaurant and expense_date=make_date(2026,10,v_day) and title like '[DEMO] %') then
      insert into public.restaurant_expenses(restaurant_id,expense_date,category,title,amount,payment_method,description,created_by,is_demo)
      values(v_restaurant,make_date(2026,10,v_day),
        case v_day%5 when 0 then 'Ingredients' when 1 then 'Packaging' when 2 then 'Utilities' when 3 then 'Cleaning' else 'Miscellaneous' end,
        '[DEMO] '||case v_day%5 when 0 then 'Kitchen ingredients' when 1 then 'Food packaging' when 2 then 'Daily utilities' when 3 then 'Cleaning supplies' else 'Small operating expense' end,
        (120+((v_day*37)%380))::numeric,
        case v_day%3 when 0 then 'UPI' when 1 then 'Cash' else 'Other' end,
        'DEMO ONLY — synthetic October 2026 test data; not an actual expense.',v_owner,true);
    end if;
  end loop;
end $$;
commit;
