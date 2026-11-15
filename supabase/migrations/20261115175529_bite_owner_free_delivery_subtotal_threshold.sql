-- Owner-funded free delivery. No restaurant is opted in without explicit owner action.
alter table public.restaurants add column if not exists free_delivery_above numeric(12,2);
alter table public.restaurants drop constraint if exists restaurants_free_delivery_above_range;
alter table public.restaurants add constraint restaurants_free_delivery_above_range check (
 free_delivery_above is null or (free_delivery_above >= 1 and free_delivery_above <= 100000)
);
comment on column public.restaurants.free_delivery_above is
 'Optional owner-funded free delivery threshold on food subtotal before coupons. Null disables the offer.';

-- Only override delivery fee AFTER authoritative menu pricing and PIN-zone checks.
-- Preserve all existing checkout guards, idempotency and payment snapshots.
do $migration$
declare v_definition text;
begin
 select pg_get_functiondef('public.bite_prepare_live_checkout(uuid,text,uuid,text,jsonb)'::regprocedure)
   into v_definition;
 if position('v_restaurant.free_delivery_above' in v_definition)=0 then
   if position('if v_total+v_fee<1 or v_total+v_fee>1000000' in v_definition)=0 then
     raise exception 'Unsupported checkout pricing function: refusing to modify';
   end if;
   v_definition:=replace(
     v_definition,
     'if v_total+v_fee<1 or v_total+v_fee>1000000',
     $addition$if p_delivery_type='delivery' and v_restaurant.free_delivery_above is not null
       and v_total>=v_restaurant.free_delivery_above then v_fee:=0;end if;
     if v_total+v_fee<1 or v_total+v_fee>1000000$addition$
   );
   execute v_definition;
 end if;
 select pg_get_functiondef('public.bite_storefront(text)'::regprocedure)
   into v_definition;
 if position('''free_delivery_above''' in v_definition)=0 then
   if position('''price_from'',(select min(m.price)' in v_definition)=0 then
     raise exception 'Unsupported public storefront query: refusing to modify';
   end if;
   v_definition:=replace(
     v_definition,
     '''price_from'',(select min(m.price)',
     $addition$'free_delivery_above',(select o.free_delivery_above
       from public.restaurants o where o.id=r.id),
     'price_from',(select min(m.price)$addition$
   );
   execute v_definition;
 end if;
end $migration$;