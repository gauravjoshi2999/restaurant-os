'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const snapshot=fs.readFileSync('supabase/migrations/20261113142110_bite_option_snapshot_columns_v3_safe.sql','utf8');
const gate=fs.readFileSync('supabase/migrations/20261113142133_bite_prepare_checkout_v3_legacy_safe_gate.sql','utf8');
const customer=fs.readFileSync('customer.html','utf8');
const previous=fs.readFileSync('supabase/migrations/20261113135618_bite_quote_anon_role_guard.sql','utf8');
const freeze=fs.readFileSync('supabase/migrations/20261113142518_bite_v3_option_snapshot_immutable_guard.sql','utf8');

test('order lines have optional immutable selection snapshot slots with legacy defaults',()=>{
 for(const name of ['option_choices_snapshot','base_unit_price_snapshot','option_unit_total_snapshot','cart_line_key_snapshot','cooking_request_snapshot'])
  assert.ok(snapshot.includes('add column '+name+' '));
 assert.ok(snapshot.includes("option_choices_snapshot jsonb not null default '[]'::jsonb"));
 assert.ok(snapshot.includes('option_unit_total_snapshot numeric(12,2) not null default 0'));
 assert.ok(snapshot.includes("jsonb_typeof(option_choices_snapshot)='array'"));
 assert.ok(snapshot.includes('length(cooking_request_snapshot) <= 100'));
});

test('legacy V2 intents and order lines are never rewritten',()=>{
 assert.ok(snapshot.includes('add column pricing_version smallint not null default 2'));
 assert.ok(snapshot.includes('add column variant_priced_items jsonb'));
 assert.ok(snapshot.includes('pricing_version in (2,3)'));
 assert.ok(snapshot.includes('pricing_version<>3 or variant_priced_items is not null'));
 assert.ok(!snapshot.includes('update public.bite_live_checkout_intents'));
 assert.ok(!snapshot.includes('update public.order_items'));
});

test('V3 RPC is invoker-only and not callable anonymously',()=>{
 assert.ok(gate.includes("language plpgsql security invoker set search_path=''"));
 assert.ok(gate.includes('if auth.uid() is null then'));
 assert.ok(gate.includes('revoke all on function public.bite_prepare_checkout_v3'));
 assert.ok(gate.includes('to authenticated;'));
 assert.ok(!gate.toLowerCase().includes('security definer'));
});

test('V3 rejects paid options and unknown cart fields before any checkout write',()=>{
 const guard=gate.indexOf('if jsonb_array_length(v_option_ids)>0 then');
 const handoff=gate.indexOf('return public.bite_prepare_checkout_v2(');
 assert.ok(guard>0&&handoff>guard);
 assert.ok(gate.includes('Paid options checkout is not enabled until verified V3 payment snapshots are deployed'));
 assert.ok(gate.includes("raise exception 'Unsupported cart line fields'"));
 assert.ok(gate.includes('Invalid or duplicate cart item'));
 assert.ok(gate.includes("v_line - 'menu_item_id' - 'quantity' - 'option_choice_ids'"));
 assert.ok(!gate.includes('insert into public.'));
 assert.ok(!gate.includes('update public.'));
});

test('option-free V3 preserves coupon, delivery and idempotency through V2',()=>{
 assert.ok(gate.includes('return public.bite_prepare_checkout_v2('));
 assert.ok(gate.includes('v_items,p_coupon_code,p_checkout_key'));
 assert.ok(gate.includes("jsonb_build_object('menu_item_id',v_item_id,'quantity',v_qty)"));
 assert.ok(gate.includes('p_checkout_key is null'));
 assert.ok(customer.includes('bite_prepare_checkout_v2'));
 assert.ok(!customer.includes('bite_prepare_checkout_v3'));
 assert.ok(previous.includes("'authorizes_payment',false"));
});

test('future paid-order lines enforce consistent server-snapshot totals and immutability',()=>{
 assert.ok(freeze.includes('order_items_v3_priced_snapshot_consistent'));
 assert.ok(freeze.includes('unit_price = round(base_unit_price_snapshot + option_unit_total_snapshot,2)'));
 assert.ok(freeze.includes('old.option_choices_snapshot'));
 assert.ok(freeze.includes('new.option_choices_snapshot'));
 assert.ok(freeze.includes('before update on public.order_items'));
 assert.ok(freeze.includes('Priced V3 order item snapshots cannot be changed after creation'));
 assert.ok(!freeze.includes('delete from public.order_items'));
});
