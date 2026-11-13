-- Protect V3 paid order evidence from deletion or shadow-field modification.
-- Legacy POS/V2 order items (without V3 snapshot keys) behave as before.
create function public.bite_guard_v3_order_item_audit()
returns trigger language plpgsql set search_path=''
as $audit$
begin
 if tg_op='DELETE' then
   if old.cart_line_key_snapshot is not null
      or old.option_choices_snapshot<>'[]'::jsonb
      or old.variant_line_key is not null then
      raise exception 'V3 priced order snapshots cannot be deleted; use refunds or status changes'
         using errcode='23514';
   end if;
   return old;
 end if;
 if (old.cart_line_key_snapshot is not null
       or old.variant_line_key is not null
       or old.option_choices_snapshot<>'[]'::jsonb
       or new.cart_line_key_snapshot is not null
       or new.variant_line_key is not null)
   and (new.selected_options_snapshot is distinct from old.selected_options_snapshot
     or new.base_unit_price is distinct from old.base_unit_price
     or new.option_unit_total is distinct from old.option_unit_total
     or new.variant_line_key is distinct from old.variant_line_key
     or new.cooking_request is distinct from old.cooking_request)
 then
   raise exception 'V3 priced order snapshot fields cannot change after creation'
     using errcode='23514';
 end if;
 return new;
end
$audit$;
create trigger bite_guard_v3_order_item_audit_trg
before update or delete on public.order_items for each row
execute function public.bite_guard_v3_order_item_audit();
revoke all on function public.bite_guard_v3_order_item_audit() from public,anon,authenticated;
