do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.place_customer_order(uuid,text,uuid,text,jsonb)'::regprocedure)
    into v_definition;

  if position('v_total, 18.00, round(v_total * 0.18,2),' in v_definition) = 0 then
    raise exception 'Expected legacy 18%% commission expression was not found; aborting safely.';
  end if;

  v_updated := replace(v_definition, 'v_zone_minimum numeric(12,2);',
    'v_zone_minimum numeric(12,2); v_rate numeric(5,2);');
  if v_updated = v_definition then
    raise exception 'Could not add commission-rate variable; aborting safely.';
  end if;

  v_definition := v_updated;
  v_updated := replace(v_definition, 'insert into public.order_financials (',
    'select coalesce(r.platform_commission_rate, ps.default_commission_rate, 10.00) into v_rate from public.restaurants r left join public.platform_settings ps on ps.id=1 where r.id=p_restaurant_id; if v_rate is null then v_rate:=10.00; end if; insert into public.order_financials (');
  if v_updated = v_definition then
    raise exception 'Could not insert the approved commission lookup; aborting safely.';
  end if;

  v_definition := v_updated;
  v_updated := replace(v_definition, 'v_total, 18.00, round(v_total * 0.18,2),',
    'v_total, v_rate, round(v_total * v_rate / 100,2),');
  if v_updated = v_definition then
    raise exception 'Could not replace the legacy commission calculation; aborting safely.';
  end if;

  execute v_updated;
end
$migration$;