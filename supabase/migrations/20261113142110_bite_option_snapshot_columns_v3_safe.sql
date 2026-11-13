-- Additive snapshot slots: existing v2 checkout, POS and existing orders remain valid.
alter table public.bite_live_checkout_intents
  add column pricing_version smallint not null default 2,
  add column variant_priced_items jsonb,
  add constraint bite_live_checkout_pricing_version_guard check (pricing_version in (2,3)),
  add constraint bite_live_checkout_variant_items_shape check (
    variant_priced_items is null
    or (jsonb_typeof(variant_priced_items)='array' and jsonb_array_length(variant_priced_items) between 1 and 50)
  ),
  add constraint bite_live_checkout_v3_requires_snapshot check (
    pricing_version<>3 or variant_priced_items is not null
  );

alter table public.order_items
  add column option_choices_snapshot jsonb not null default '[]'::jsonb,
  add column base_unit_price_snapshot numeric(12,2),
  add column option_unit_total_snapshot numeric(12,2) not null default 0,
  add column cart_line_key_snapshot text,
  add column cooking_request_snapshot text,
  add constraint order_items_option_snapshot_is_array check (jsonb_typeof(option_choices_snapshot)='array'),
  add constraint order_items_base_price_nonnegative check (base_unit_price_snapshot is null or base_unit_price_snapshot >=0),
  add constraint order_items_option_total_nonnegative check (option_unit_total_snapshot >=0),
  add constraint order_items_line_key_length check (cart_line_key_snapshot is null or length(cart_line_key_snapshot) between 1 and 1024),
  add constraint order_items_cooking_request_length check (cooking_request_snapshot is null or length(cooking_request_snapshot) <= 100);

comment on column public.bite_live_checkout_intents.variant_priced_items
  is 'V3-only immutable signed-off server-priced selection snapshot; currently no v3 paid checkout path enabled.';
comment on column public.order_items.option_choices_snapshot
  is 'Immutable option name/group/price choices captured when a verified V3 checkout becomes an order. Empty for legacy orders.';
