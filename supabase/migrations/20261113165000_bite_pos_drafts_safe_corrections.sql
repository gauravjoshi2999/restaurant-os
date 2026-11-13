-- Bite POS: restaurant-scoped persistent drafts, guarded POS write-off,
-- and auditable corrections/voids for unpaid counter bills only.
-- Marketplace orders, payments and refunds remain immutable.
create table if not exists public.restaurant_pos_drafts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurant_pos_drafts_object check (jsonb_typeof(payload)='object'),
  constraint restaurant_pos_drafts_size check (octet_length(payload::text)<=65536)
);
create index if not exists restaurant_pos_drafts_owner_recent
  on public.restaurant_pos_drafts(restaurant_id,created_by,updated_at desc);
alter table public.restaurant_pos_drafts enable row level security;
revoke all on public.restaurant_pos_drafts from public,anon;
grant select,insert,update,delete on public.restaurant_pos_drafts to authenticated;
grant all on public.restaurant_pos_drafts to service_role;
drop policy if exists "POS owner reads own drafts" on public.restaurant_pos_drafts;
create policy "POS owner reads own drafts" on public.restaurant_pos_drafts
 for select to authenticated
 using (created_by=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']));
drop policy if exists "POS owner creates own drafts" on public.restaurant_pos_drafts;
create policy "POS owner creates own drafts" on public.restaurant_pos_drafts
 for insert to authenticated
 with check (created_by=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']));
drop policy if exists "POS owner edits own drafts" on public.restaurant_pos_drafts;
create policy "POS owner edits own drafts" on public.restaurant_pos_drafts
 for update to authenticated
 using (created_by=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']))
 with check (created_by=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']));
drop policy if exists "POS owner deletes own drafts" on public.restaurant_pos_drafts;
create policy "POS owner deletes own drafts" on public.restaurant_pos_drafts
 for delete to authenticated
 using (created_by=(select auth.uid()) and public.has_restaurant_role(restaurant_id,array['owner']));

create or replace function public.guard_pos_draft_identity()
returns trigger language plpgsql set search_path to '' as $$
begin
 if new.restaurant_id is distinct from old.restaurant_id or new.created_by is distinct from old.created_by then
  raise exception 'POS draft owner and restaurant cannot change' using errcode='42501';
 end if;
 new.updated_at=now();
 return new;
end; $$;
revoke all on function public.guard_pos_draft_identity() from public,anon,authenticated;
drop trigger if exists guard_pos_draft_identity_trigger on public.restaurant_pos_drafts;
create trigger guard_pos_draft_identity_trigger before update on public.restaurant_pos_drafts
for each row execute function public.guard_pos_draft_identity();

-- This is the fix for 'Restaurant Owner may update only order status and status note'
-- during the initial POS sale RPC's waived_off_amount update.
-- Permit exactly one initial POS waiver, equal to the unpaid amount, with no other
-- changed fields. All marketplace order mutation protections remain unchanged.
create or replace function public.guard_owner_order_mutable_fields()
returns trigger language plpgsql security definer set search_path to '' as $$
declare
 v_jwt_role text := coalesce((select auth.jwt())->>'role','');
 v_new_payload jsonb;
 v_old_payload jsonb;
 v_paid numeric(14,2);
begin
 if v_jwt_role='service_role' or auth.uid() is null then return new; end if;
 v_new_payload:=to_jsonb(new)-array['status','status_note'];
 v_old_payload:=to_jsonb(old)-array['status','status_note'];
 if current_setting('app.customer_cancel',true)='true'
    and old.customer_id=(select auth.uid()) and old.status='Received' and new.status='Cancelled'
    and v_new_payload=v_old_payload then return new; end if;
 if current_setting('app.delivery_handoff_confirm',true)='true'
    and old.status='Handed Over' and new.status='Completed'
    and v_new_payload=v_old_payload then return new; end if;
 if not public.has_restaurant_role(old.restaurant_id,array['owner']) then
   raise exception 'Only the assigned Restaurant Owner can update order status.'
   using errcode='42501';
 end if;
 if old.channel='POS - Counter'
    and old.status='Received' and new.status=old.status
    and old.created_by=(select auth.uid())
    and now()-old.created_at <= interval '5 minutes'
    and old.waived_off_amount=0 and new.waived_off_amount>0
    and (to_jsonb(new)-array['waived_off_amount'])=(to_jsonb(old)-array['waived_off_amount']) then
    select coalesce(sum(p.amount),0) into v_paid from public.restaurant_order_payments p where p.order_id=old.id;
    if new.waived_off_amount=round(old.amount-v_paid,2) and v_paid>=0 then
      return new;
    end if;
 end if;
 if v_new_payload is distinct from v_old_payload then
  raise exception 'Restaurant Owner may update only order status and status note.' using errcode='42501';
 end if;
 if new.status is not distinct from old.status and new.status_note is distinct from old.status_note then
  raise exception 'Order status note can change only with an order status transition.' using errcode='42501';
 end if;
 return new;
end; $$;
revoke all on function public.guard_owner_order_mutable_fields() from public,anon,authenticated;

-- A finalized POS bill is not deleted: unpaid Received bills are voided
-- with a status history entry, preserving the audit trail.
create or replace function public.void_unpaid_pos_order(
 p_order_id uuid,p_reason text default 'Voided by restaurant owner'
) returns uuid language plpgsql security invoker set search_path to '' as $$
declare v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.channel <> 'POS - Counter' or v_order.is_demo
    or v_order.status<>'Received' or v_order.waived_off_amount<>0 then
   raise exception 'Only unpaid, open POS counter bills can be voided';
 end if;
 if not public.has_restaurant_role(v_order.restaurant_id,array['owner']) then
   raise exception 'Owner access required' using errcode='42501';
 end if;
 if exists(select 1 from public.restaurant_order_payments where order_id=p_order_id)
    or exists(select 1 from public.restaurant_order_refunds where order_id=p_order_id)
    or exists(select 1 from public.restaurant_cashbook_closings where restaurant_id=v_order.restaurant_id and close_date=timezone('Asia/Kolkata',v_order.order_date)::date) then
   raise exception 'Paid, refunded or closed-day bills cannot be voided';
 end if;
 update public.orders set status='Cancelled',
    status_note=left(coalesce(nullif(btrim(p_reason),''),'Voided by owner'),250)
 where id=p_order_id and restaurant_id=v_order.restaurant_id;
 return p_order_id;
end; $$;
revoke all on function public.void_unpaid_pos_order(uuid,text) from public,anon;
grant execute on function public.void_unpaid_pos_order(uuid,text) to authenticated;

-- Edit is a single transaction: void the old unpaid bill and create its replacement.
-- If creation fails, the void rolls back too; this prevents double-counted sales.
create or replace function public.replace_unpaid_pos_order(
 p_original_order_id uuid,
 p_restaurant_id uuid,p_order_code text,p_customer_name text,p_customer_phone text,
 p_items jsonb,p_paid_amount numeric,p_payment_method text,p_payment_date date,
 p_reference text,p_balance_action text,p_writeoff_reason text
) returns uuid language plpgsql security invoker set search_path to '' as $$
declare v_order public.orders%rowtype;
begin
 if auth.uid() is null then raise exception 'Login required'; end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner']) then
  raise exception 'Owner access required' using errcode='42501';
 end if;
 select * into v_order from public.orders
 where id=p_original_order_id and restaurant_id=p_restaurant_id for update;
 if not found or v_order.channel<>'POS - Counter' or v_order.is_demo
    or v_order.status<>'Received' or v_order.waived_off_amount<>0 then
  raise exception 'Only unpaid, open POS counter bills can be corrected';
 end if;
 if exists(select 1 from public.restaurant_order_payments where order_id=p_original_order_id)
    or exists(select 1 from public.restaurant_order_refunds where order_id=p_original_order_id)
    or exists(select 1 from public.restaurant_cashbook_closings where restaurant_id=p_restaurant_id and close_date=timezone('Asia/Kolkata',v_order.order_date)::date) then
  raise exception 'Paid, refunded or closed-day bills cannot be edited; use the refund/correction workflow';
 end if;
 update public.orders set status='Cancelled',status_note='Replaced by corrected POS bill'
 where id=p_original_order_id and restaurant_id=p_restaurant_id;
 return public.create_pos_order_with_balance_action(
   p_restaurant_id,p_order_code,p_customer_name,p_customer_phone,p_items,
   p_paid_amount,p_payment_method,p_payment_date,p_reference,p_balance_action,p_writeoff_reason
 );
end; $$;
revoke all on function public.replace_unpaid_pos_order(uuid,uuid,text,text,text,jsonb,numeric,text,date,text,text,text) from public,anon;
grant execute on function public.replace_unpaid_pos_order(uuid,uuid,text,text,text,jsonb,numeric,text,date,text,text,text) to authenticated;
