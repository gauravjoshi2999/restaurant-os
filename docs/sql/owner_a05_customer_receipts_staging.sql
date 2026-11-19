-- Bite Owner V3 / A05: idempotent manual customer receipts into the ONE existing
-- restaurant_customer_ledger_entries. No new sales or parallel ledger tables.
-- Nullable request IDs leave historical entries byte-for-byte untouched.
alter table public.restaurant_customer_ledger_entries
 add column if not exists receipt_request_id uuid;
create unique index if not exists restaurant_customer_receipt_request_unique
 on public.restaurant_customer_ledger_entries(receipt_request_id)
 where receipt_request_id is not null;

create or replace function public.record_restaurant_khata_receipt(
 p_restaurant_id uuid, p_customer_id uuid, p_amount numeric,
 p_entry_date date, p_payment_method text, p_request_id uuid,
 p_reference text default '', p_description text default '',
 p_allow_advance boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 customer_record public.restaurant_customers%rowtype;
 prior public.restaurant_customer_ledger_entries%rowtype;
 current_due numeric(14,2);
 new_id uuid;
 reference_text text:=trim(coalesce(p_reference,''));
 note_text text:=trim(coalesce(p_description,''));
begin
 if auth.uid() is null or p_request_id is null or p_restaurant_id is null or p_customer_id is null then
   raise exception 'Authenticated customer receipt request required' using errcode='42501';
 end if;
 if not public.has_restaurant_role(p_restaurant_id,array['owner','manager','staff'])
    or not private.bite_restaurant_staff_can(p_restaurant_id,'payment_entry') then
   raise exception 'Customer payment permission required' using errcode='42501';
 end if;
 if p_amount is null or p_amount<=0 or p_amount>9999999999.99
    or p_amount<>round(p_amount,2) then
   raise exception 'Receipt amount must be positive with at most two decimal places';
 end if;
 if p_entry_date is null or p_entry_date<date '2000-01-01'
    or p_entry_date>(now() at time zone 'Asia/Kolkata')::date then
   raise exception 'Receipt date must be a valid past or current date';
 end if;
 if p_payment_method is null or p_payment_method not in ('Cash','UPI','Card','Bank Transfer') then
   raise exception 'Choose a verified receipt payment method';
 end if;
 if length(reference_text)>100 or length(note_text)>250 then
   raise exception 'Receipt reference or note is too long';
 end if;

 -- Serialize simultaneous manual receipts for the same customer. A retry must
 -- be checked before current due, since the first receipt already changed it.
 select * into customer_record from public.restaurant_customers
 where id=p_customer_id and restaurant_id=p_restaurant_id for update;
 if not found or customer_record.status<>'Active' then
   raise exception 'Active customer not found in this restaurant' using errcode='42501';
 end if;
 select * into prior from public.restaurant_customer_ledger_entries
 where receipt_request_id=p_request_id;
 if found then
   if prior.restaurant_id<>p_restaurant_id or prior.customer_id<>p_customer_id
      or prior.amount<>p_amount or prior.entry_date<>p_entry_date
      or prior.entry_type<>'credit' or prior.payment_method<>p_payment_method
      or coalesce(prior.reference,'')<>reference_text
      or coalesce(prior.description,'')<>note_text
      or prior.created_by<>auth.uid() then
     raise exception 'Receipt request already used for another transaction';
   end if;
   return prior.id;
 end if;

 if exists(select 1 from public.restaurant_cashbook_closings c
    where c.restaurant_id=p_restaurant_id and c.close_date=p_entry_date)
    or exists(select 1 from public.bite_property_shift_closings c
       join public.bite_property_outlets o on o.property_id=c.property_id
       where o.restaurant_id=p_restaurant_id and c.shift_date=p_entry_date and c.locked)
 then raise exception 'Receipt day is closed. Use an open date with documented correction'; end if;

 select balance into current_due from public.restaurant_customer_balances
 where restaurant_id=p_restaurant_id and customer_id=p_customer_id;
 if current_due is null then raise exception 'Verified customer balance unavailable'; end if;
 if not coalesce(p_allow_advance,false) and (current_due<=0 or p_amount>current_due) then
   raise exception 'Receipt exceeds current customer due; refresh before collecting';
 end if;

 insert into public.restaurant_customer_ledger_entries(
  restaurant_id,customer_id,entry_date,entry_type,amount,
  payment_method,reference,description,created_by,receipt_request_id)
 values(p_restaurant_id,p_customer_id,p_entry_date,'credit',p_amount,
  p_payment_method,nullif(reference_text,''),nullif(note_text,''),auth.uid(),p_request_id)
 returning id into new_id;
 return new_id;
end $$;
revoke all on function public.record_restaurant_khata_receipt(uuid,uuid,numeric,date,text,uuid,text,text,boolean)
 from public,anon,authenticated;
grant execute on function public.record_restaurant_khata_receipt(uuid,uuid,numeric,date,text,uuid,text,text,boolean)
 to authenticated;
comment on function public.record_restaurant_khata_receipt(uuid,uuid,numeric,date,text,uuid,text,text,boolean) is
 'Idempotent recorded customer receipt in the original Khata ledger. No real money transfer, no new POS sale.';
