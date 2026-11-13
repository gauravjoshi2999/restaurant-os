-- Additive representation for a server-priced menu choice snapshot.
-- Existing Checkout V2, old orders, POS and Cashfree are untouched.
alter table public.bite_live_checkout_intents
  add column pricing_schema_version smallint not null default 1
    constraint bite_checkout_pricing_schema_version check (pricing_schema_version in (1,2));

alter table public.order_items
  add column base_unit_price numeric(12,2),
  add column option_unit_total numeric(12,2),
  add column selected_options_snapshot jsonb not null default '[]'::jsonb,
  add column variant_line_key text,
  add column cooking_request text;

alter table public.order_items
  add constraint order_items_selected_options_array check (jsonb_typeof(selected_options_snapshot)='array'),
  add constraint order_items_base_unit_price_range check (base_unit_price is null or (base_unit_price>=0 and base_unit_price<=1000000)),
  add constraint order_items_option_total_range check (option_unit_total is null or (option_unit_total>=0 and option_unit_total<=1000000)),
  add constraint order_items_variant_line_key_limit check (variant_line_key is null or length(variant_line_key) <= 900),
  add constraint order_items_cooking_request_limit check (cooking_request is null or length(cooking_request) <= 100);

comment on column public.bite_live_checkout_intents.pricing_schema_version is
  '1=legacy base-only checkout, 2=server-priced item variants; v2 remains default';
comment on column public.order_items.selected_options_snapshot is
  'Immutable server-priced option labels and price deltas for the paid order';
comment on column public.order_items.variant_line_key is
  'Canonical menu item + chosen option IDs + cooking request; never a client price';
