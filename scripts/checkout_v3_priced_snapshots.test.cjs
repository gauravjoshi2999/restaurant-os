'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=(version,name)=>fs.readFileSync('supabase/migrations/'+version+'_'+name+'.sql','utf8');
const columns=read('20261113142155','bite_checkout_v3_immutable_line_snapshot_columns');
const notesQuote=read('20261113142352','bite_checkout_v3_quote_with_line_notes');
const candidate=read('20261113142750','bite_checkout_v3_priced_candidate_locked');
const finalize=read('20261113143141','bite_finalize_verified_v3_option_snapshots_safe');
const limit=read('20261113143220','bite_v3_reject_overlong_variant_identity_before_payment');
const audit=read('20261113143503','bite_v3_order_snapshot_delete_shadow_guard');
const legacyGate=read('20261113142133','bite_prepare_checkout_v3_legacy_safe_gate');
const checkout=fs.readFileSync('customer.html','utf8');
const edge=fs.readFileSync('supabase/functions/bite-live-create-session/index.ts','utf8');

test('V3 order item snapshots are additive and V2 remains default',()=>{
 assert.match(columns,/add column pricing_schema_version smallint not null default 1/);
 assert.match(columns,/selected_options_snapshot jsonb not null default '\[\]'::jsonb/);
 assert.match(columns,/add column base_unit_price numeric\(12,2\)/);
 assert.match(columns,/add column option_unit_total numeric\(12,2\)/);
 assert.match(columns,/add column variant_line_key text/);
 assert.match(columns,/add column cooking_request text/);
 assert.match(legacyGate,/Paid options checkout is not enabled/);
});

test('read-only quote V2 includes separate per-line cooking requests with trusted prices',()=>{
 assert.match(notesQuote,/FUNCTION public\.bite_quote_menu_options_v2\(/);
 assert.match(notesQuote,/item_note := btrim\(regexp_replace/);
 assert.match(notesQuote,/length\(item_note\)>100/);
 assert.match(notesQuote,/line_key := id_item::text.*item_note/);
 assert.match(notesQuote,/'note',item_note/);
 assert.match(notesQuote,/'unit_price',item_unit/);
 assert.match(notesQuote,/'authorizes_payment',false/);
 assert.match(limit,/length\(line_key\)>900/);
 assert.match(notesQuote,/prices must be calculated by the server/);
});

test('new V3 priced preparation rechecks hours, delivery area, minimum and customer identity',()=>{
 assert.match(candidate,/function public\.bite_prepare_checkout_v3_priced_candidate\(/i);
 assert.match(candidate,/perform public\.bite_assert_customer_can_order\(\)/);
 assert.match(candidate,/customer_contact_profiles/);
 assert.match(candidate,/v_restaurant\.opening_time/);
 assert.match(candidate,/restaurant_delivery_zone_pincodes/);
 assert.match(candidate,/Restaurant does not deliver to this PIN/);
 assert.match(candidate,/v_subtotal<v_min/);
 assert.match(candidate,/v_quote:=public\.bite_quote_menu_options_v2/);
 assert.match(candidate,/v_quote->'lines',3,2,v_quote->'lines'/);
});

test('coupon and retry keys use server quote, locks and immutable intent snapshot',()=>{
 assert.match(candidate,/pg_advisory_xact_lock\(hashtextextended\(v_customer::text\|\|p_checkout_key::text,0\)\)/);
 assert.match(candidate,/Checkout key belongs to a different cart/);
 assert.match(candidate,/i\.items=p_lines/);
 assert.match(candidate,/perform pg_advisory_xact_lock\(hashtextextended\(v_coupon::text,0\)\)/);
 assert.match(candidate,/public\.bite_coupon_quote\(p_restaurant_id,v_code,v_subtotal\)/);
 assert.match(candidate,/v_subtotal\+v_fee-v_discount/);
 assert.match(candidate,/v_quote->'lines'/);
});

test('priced V3 candidate is locked from browser and customer execution',()=>{
 assert.match(candidate,/revoke all on function public\.bite_prepare_checkout_v3_priced_candidate/);
 assert.match(candidate,/from public,anon,authenticated/);
 assert.match(candidate,/to service_role/);
 assert.doesNotMatch(candidate,/grant execute[^;]+to authenticated/i);
 assert.doesNotMatch(candidate,/cashfree|payment_session_id/i);
 assert.match(checkout,/bite_prepare_checkout_v2/);
 assert.doesNotMatch(checkout,/bite_prepare_checkout_v3_priced_candidate/);
});

test('verified payment finalizer snapshots options and validates amounts without altering V2 path',()=>{
 assert.match(finalize,/function public\.bite_finalize_verified_live_checkout\(/i);
 assert.match(finalize,/service_role/);
 assert.match(finalize,/v\.status<>'payment_verified'/);
 assert.match(finalize,/v\.pricing_version=3/);
 assert.match(finalize,/v\.variant_priced_items is distinct from v\.priced_items/);
 assert.match(finalize,/v_option_sum<>\(v_item->>'option_unit_total'\)::numeric/);
 assert.match(finalize,/option_choices_snapshot,base_unit_price_snapshot,option_unit_total_snapshot/);
 assert.match(finalize,/selected_options_snapshot,base_unit_price,option_unit_total/);
 assert.match(finalize,/case when v\.pricing_version=3 then v_item->'options' else '\[\]'::jsonb end/);
 assert.match(finalize,/v_snapshot_total<>v\.food_subtotal/);
});

test('snapshot mutation and deletion are blocked only when a priced V3 line exists',()=>{
 assert.match(audit,/before update or delete on public\.order_items/);
 assert.match(audit,/old\.cart_line_key_snapshot is not null/);
 assert.match(audit,/old\.option_choices_snapshot<>'\[\]'::jsonb/);
 assert.match(audit,/V3 priced order snapshots cannot be deleted/);
 assert.match(audit,/new\.selected_options_snapshot is distinct from old\.selected_options_snapshot/);
 assert.match(audit,/return old/);
 assert.match(audit,/return new/);
});

test('Cashfree session amount still comes exclusively from stored checkout intent',()=>{
 assert.match(edge,/from\("bite_live_checkout_intents"\)/);
 assert.match(edge,/intent\.priced_items\.reduce/);
 assert.match(edge,/intent\.food_subtotal/);
 assert.match(edge,/payment_session_id/);
});
