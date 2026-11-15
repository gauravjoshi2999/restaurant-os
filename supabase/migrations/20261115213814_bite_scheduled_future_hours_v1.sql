-- Let vetted preferred-slot checkout use the selected future hours.
-- Ordinary pickup/ASAP remains blocked while the restaurant is closed.
-- No payment, refund or order activation changes.
do $migration$
declare v_definition text;
begin
 select pg_get_functiondef('public.bite_prepare_live_checkout(uuid,text,uuid,text,jsonb)'::regprocedure) into v_definition;
 if position('app.bite_scheduled_for' in v_definition)=0 then
  if position('v_local_time time;' in v_definition)=0 or
     position('select * into v_restaurant from public.restaurants where id=p_restaurant_id;' in v_definition)=0 or
     position('if v_restaurant.is_temporarily_closed and' in v_definition)=0 or
     position('if v_restaurant.opening_time is not null' in v_definition)=0 then
    raise exception 'Checkout function shape changed; refusing to weaken ordinary hours validation';
  end if;
  v_definition:=replace(v_definition,'v_local_time time;','v_local_time time;v_scheduled_for timestamptz;');
  v_definition:=replace(v_definition,
   'select * into v_restaurant from public.restaurants where id=p_restaurant_id;',
   $replace$select * into v_restaurant from public.restaurants where id=p_restaurant_id;
 v_scheduled_for:=nullif(current_setting('app.bite_scheduled_for',true),'')::timestamptz;
 if v_scheduled_for is not null then
  if p_delivery_type<>'delivery' then raise exception 'Only delivery can be scheduled';end if;
  perform public.bite_validate_scheduled_delivery_v1(p_restaurant_id,v_scheduled_for);
 end if;$replace$);
  v_definition:=replace(v_definition,
   'if v_restaurant.is_temporarily_closed and',
   'if v_scheduled_for is null and v_restaurant.is_temporarily_closed and');
  v_definition:=replace(v_definition,
   'if v_restaurant.opening_time is not null',
   'if v_scheduled_for is null and v_restaurant.opening_time is not null');
  execute v_definition;
 end if;

 select pg_get_functiondef('public.bite_prepare_scheduled_checkout_v1(uuid,text,uuid,text,jsonb,text,uuid,timestamp with time zone)'::regprocedure)
 into v_definition;
 if position('app.bite_scheduled_for' in v_definition)=0 then
  if position('v_id:=public.bite_prepare_checkout_v2(' in v_definition)=0 or
     position('select * into v_intent from public.bite_live_checkout_intents' in v_definition)=0 then
    raise exception 'Scheduled checkout wrapper changed; refusing unsafe mutation';
  end if;
  v_definition:=replace(v_definition,
   'v_id:=public.bite_prepare_checkout_v2(',
   $replace$perform set_config('app.bite_scheduled_for',p_scheduled_for::text,true);
 v_id:=public.bite_prepare_checkout_v2($replace$);
  v_definition:=replace(v_definition,
   'select * into v_intent from public.bite_live_checkout_intents',
   $replace$perform set_config('app.bite_scheduled_for','',true);
 select * into v_intent from public.bite_live_checkout_intents$replace$);
  execute v_definition;
 end if;
end $migration$;