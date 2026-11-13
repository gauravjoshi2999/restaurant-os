-- Only V3 item lines with paid selections are immutable. Existing V2/POS rows are unaffected.
alter table public.order_items
  add constraint order_items_v3_priced_snapshot_consistent check (
    option_choices_snapshot = '[]'::jsonb
    or (
      base_unit_price_snapshot is not null
      and cart_line_key_snapshot is not null
      and unit_price = round(base_unit_price_snapshot + option_unit_total_snapshot,2)
    )
  );

create function public.bite_protect_priced_order_item_snapshot()
returns trigger language plpgsql set search_path=''
as $$
begin
 if tg_op='UPDATE' and (
   old.option_choices_snapshot <> '[]'::jsonb
   or new.option_choices_snapshot <> '[]'::jsonb
   or old.cart_line_key_snapshot is not null
   or new.cart_line_key_snapshot is not null
 ) and (
   new.menu_item_id is distinct from old.menu_item_id
   or new.item_name is distinct from old.item_name
   or new.quantity is distinct from old.quantity
   or new.unit_price is distinct from old.unit_price
   or new.option_choices_snapshot is distinct from old.option_choices_snapshot
   or new.base_unit_price_snapshot is distinct from old.base_unit_price_snapshot
   or new.option_unit_total_snapshot is distinct from old.option_unit_total_snapshot
   or new.cart_line_key_snapshot is distinct from old.cart_line_key_snapshot
   or new.cooking_request_snapshot is distinct from old.cooking_request_snapshot
 ) then
   raise exception 'Priced V3 order item snapshots cannot be changed after creation' using errcode='23514';
 end if;
 return new;
end
$$;

create trigger bite_protect_priced_order_item_snapshot_trg
before update on public.order_items
for each row execute function public.bite_protect_priced_order_item_snapshot();

revoke all on function public.bite_protect_priced_order_item_snapshot() from public,anon,authenticated;
comment on function public.bite_protect_priced_order_item_snapshot()
 is 'Trigger only: paid option line immutable after order insertion; legacy rows unaffected.';
