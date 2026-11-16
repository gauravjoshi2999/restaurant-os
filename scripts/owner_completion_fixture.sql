-- Disposable DB additions matching the existing production POS/cashbook shape.
alter table public.orders add column order_date timestamptz not null default now();
alter table public.restaurant_order_payments add column restaurant_id uuid;
alter table public.restaurant_order_payments add column payment_method text default 'Cash';
alter table public.restaurant_order_payments add column payment_date date default current_date;
create table public.restaurant_pos_drafts(id uuid primary key,restaurant_id uuid,created_by uuid,payload jsonb);
alter table public.restaurant_pos_drafts enable row level security;
grant select,insert,update,delete on public.restaurant_pos_drafts to authenticated;
grant select on public.orders,public.restaurant_members to authenticated;
create view public.restaurant_cashbook_entries as select id entry_id,restaurant_id,payment_date entry_date,'in'::text direction,amount,payment_method from public.restaurant_order_payments;
create or replace function public.create_pos_order_with_payment(p_restaurant_id uuid,p_order_code text,p_channel text,p_customer_name text,p_customer_phone text,p_items jsonb,p_paid_amount numeric,p_payment_method text,p_payment_date date,p_reference text,p_table_id uuid) returns uuid language plpgsql as $$
declare v_id uuid; total numeric;item jsonb; begin
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager','staff']) then raise exception 'POS denied' using errcode='42501';end if;
 select sum(round((i->>'quantity')::numeric*(i->>'unit_price')::numeric,2)) into total from jsonb_array_elements(p_items) i;
 insert into public.orders(restaurant_id,order_code,channel,amount) values(p_restaurant_id,p_order_code,p_channel,total) returning orders.id into v_id;
 for item in select value from jsonb_array_elements(p_items) loop
  insert into public.order_items(order_id,item_name,quantity,unit_price)values(v_id,item->>'name',(item->>'quantity')::numeric,(item->>'unit_price')::numeric);
 end loop;
 if p_paid_amount>0 then insert into public.restaurant_order_payments(order_id,restaurant_id,amount,payment_method,payment_date)values(v_id,p_restaurant_id,p_paid_amount,p_payment_method,p_payment_date);end if;
 return v_id;
end $$;
