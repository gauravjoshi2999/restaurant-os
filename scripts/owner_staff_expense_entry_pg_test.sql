-- Staff input and accounting verification in disposable QA.
begin;
create temp table staff_expense_fixture(property_id uuid, other_property_id uuid,
 request_id uuid, expense_date date, receipt jsonb);
grant select,insert,update on staff_expense_fixture to authenticated;
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';

do $$
declare
 p uuid:=public.bite_create_property('Staff Expense QA','hotel',gen_random_uuid());
 other_p uuid:=public.bite_create_property('Staff Expense Other QA','hotel',gen_random_uuid());
begin
 perform public.bite_save_staff_access(p,'33333333-3333-4333-8333-333333333333','',
  'receptionist',true,array['expense_entry']);
 perform public.bite_save_staff_access(p,'44444444-4444-4444-8444-444444444444','',
  'accountant',true,array['expenses','reporting']);
 insert into staff_expense_fixture values
  (p,other_p,gen_random_uuid(),(now() at time zone 'Asia/Kolkata')::date,null);
end $$;

set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$
declare
 f staff_expense_fixture;
 details jsonb;
 saved jsonb;
begin
 select * into strict f from staff_expense_fixture;
 details:=jsonb_build_object('description','Laundry QA','amount',500,'expense_date',f.expense_date,'method','Cash');
 saved:=public.bite_property_command(f.property_id,'expense',details,f.request_id);
 if saved->>'confirmed'<>'true' or saved->>'id' is null
 or public.bite_property_command(f.property_id,'expense',details,f.request_id)<>saved then
  raise exception 'Staff expense did not record one confirmed and retryable receipt';
 end if;
 if exists (select 1 from public.bite_property_expenses where property_id=f.property_id)
 or public.bite_hotel_workspace(f.property_id)?'expenses'
 or private.bite_can(f.property_id,'reporting') then
  raise exception 'Entry-only staff obtained accounting data';
 end if;
 begin
  perform public.bite_daily_book(f.property_id,f.expense_date,f.expense_date);
  raise exception 'Reception can read Daily Book';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.bite_property_command(f.other_property_id,'expense',details,gen_random_uuid());
  raise exception 'Reception accessed an unrelated hotel';
 exception when insufficient_privilege then null;
 end;
 update staff_expense_fixture set receipt=saved;
end $$;

set local request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$
declare
 f staff_expense_fixture;
 report jsonb;
begin
 select * into strict f from staff_expense_fixture;
 if (select count(*) from public.bite_property_expenses where property_id=f.property_id and amount=500
 and created_by='33333333-3333-4333-8333-333333333333' and id=(f.receipt->>'id')::uuid)<>1 then
  raise exception 'Accountant did not see exactly one attributed expense';
 end if;
 report:=public.bite_daily_book(f.property_id,f.expense_date,f.expense_date);
 if (select count(*) from jsonb_array_elements(report->'journal') as entry
     where entry->>'id'=f.receipt->>'id' and (entry->>'amount')::numeric=500)<>1 then
  raise exception 'Accountant Daily Book did not include the expense exactly once';
 end if;
end $$;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
select public.bite_save_staff_access(property_id,'33333333-3333-4333-8333-333333333333','',
 'receptionist',false,array['expense_entry']) from staff_expense_fixture;
set local request.jwt.claim.sub='33333333-3333-4333-8333-333333333333';
do $$
declare f staff_expense_fixture;
begin
 select * into strict f from staff_expense_fixture;
 begin
  perform public.bite_property_command(f.property_id,'expense',
   jsonb_build_object('description','Laundry QA','amount',500,'expense_date',f.expense_date,'method','Cash'),f.request_id);
  raise exception 'Revoked reception account can still submit an expense request';
 exception when insufficient_privilege then null;
 end;
end $$;
rollback;
