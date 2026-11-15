-- Expose published schedule capability only, never private staffing/capacity.
do $migration$
declare v_definition text;
begin
 select pg_get_functiondef('public.bite_storefront(text)'::regprocedure) into v_definition;
 if position('''accepts_scheduled_delivery''' in v_definition)=0 then
  if position('''price_from'',(select min(m.price)' in v_definition)=0
  then raise exception 'Public storefront signature changed; refuse unsafe mutation';end if;
  v_definition:=replace(v_definition,
    '''price_from'',(select min(m.price)',
    $safe$'accepts_scheduled_delivery',(select x.accepts_scheduled_delivery from public.restaurants x where x.id=r.id),
    'scheduled_lead_minutes',(select x.scheduled_lead_minutes from public.restaurants x where x.id=r.id),
    'scheduled_horizon_days',(select x.scheduled_horizon_days from public.restaurants x where x.id=r.id),
    'price_from',(select min(m.price)$safe$);
  execute v_definition;
 end if;
end $migration$;