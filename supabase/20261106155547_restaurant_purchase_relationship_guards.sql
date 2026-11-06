-- Applied migration 20261106155547_restaurant_purchase_relationship_guards
create or replace function public.guard_restaurant_purchase_links()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.created_by is distinct from old.created_by or new.restaurant_id is distinct from old.restaurant_id) then
  raise exception 'Purchase ownership fields are immutable';
 end if;
 if new.supplier_id is not null and not exists (
  select 1 from public.restaurant_suppliers s where s.id=new.supplier_id and s.restaurant_id=new.restaurant_id
 ) then
  raise exception 'Supplier must belong to the same restaurant';
 end if;
 return new;
end;
$$;
create trigger restaurant_purchases_guard_links before insert or update on public.restaurant_purchases
for each row execute function public.guard_restaurant_purchase_links();

create or replace function public.guard_restaurant_supplier_identity()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.created_by is distinct from old.created_by or new.restaurant_id is distinct from old.restaurant_id) then
  raise exception 'Supplier ownership fields are immutable';
 end if;
 return new;
end;
$$;
create trigger restaurant_suppliers_guard_identity before update on public.restaurant_suppliers
for each row execute function public.guard_restaurant_supplier_identity();
