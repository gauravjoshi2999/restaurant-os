-- CI-only. No customer data or production mutation.
begin;
create temp table credit_qa(k text primary key,v uuid);grant all on credit_qa to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare p uuid;g uuid;r uuid;v jsonb;d date:=(now() at time zone 'Asia/Kolkata')::date;begin
 p:=public.bite_create_property('Synthetic H13 guest credit','hotel',gen_random_uuid());
 g:=(public.bite_property_command(p,'guest_save','{"full_name":"Synthetic credit guest","phone":"9999999965","address":"Synthetic address"}',gen_random_uuid())->>'id')::uuid;
 r:=(public.bite_property_command(p,'room_save','{"number":"CREDIT-QA","room_type":"Deluxe"}',gen_random_uuid())->>'id')::uuid;
 v:=public.bite_property_command(p,'reserve',jsonb_build_object('guest_id',g,'room_id',r,'arrival',d,'departure',d+1,'adults',1,'children',0,'nightly_rate',1500,'terms_at_checkin',true,'booking_mode','checkin'),gen_random_uuid());
 perform public.bite_property_command(p,'checkin',jsonb_build_object('id',v->>'id'),gen_random_uuid());
 insert into credit_qa values('p',p),('f',(v->>'folio_id')::uuid),('s',(v->>'id')::uuid),('g',g);
end$$;
reset role;
do $$
declare p uuid:=(select v from credit_qa where k='p');f uuid:=(select v from credit_qa where k='f');g uuid:=(select v from credit_qa where k='g');s uuid:=(select v from credit_qa where k='s');d date:=(now() at time zone 'Asia/Kolkata')::date;v jsonb;failed boolean;n integer;pending uuid;
begin
 if has_table_privilege('authenticated','private.bite_hotel_credit_approvals','select') or has_table_privilege('authenticated','private.bite_hotel_credit_approvals','insert') or has_table_privilege('anon','private.bite_hotel_credit_approvals','select') or has_function_privilege('authenticated','private.bite_hotel_credit_candidate(uuid,uuid,numeric,date,text)','execute') or has_function_privilege('anon','private.bite_hotel_credit_candidate(uuid,uuid,numeric,date,text)','execute') then raise exception 'Internal credit metadata exposed';end if;
 n:=(select count(*) from public.bite_folio_entries where folio_id=f);
 v:=private.bite_hotel_credit_candidate(p,f,1500,d+7,'Agreed invoice on credit');
 if v->>'guest_id'<>g::text or v->>'balance'<>'1500' and (v->>'balance')::numeric<>1500 or v->'checkout_enabled' is distinct from 'false'::jsonb then raise exception 'Wrong credit review';end if;
 if exists(select 1 from private.bite_hotel_credit_approvals where folio_id=f) or (select count(*) from public.bite_folio_entries where folio_id=f)<>n or not exists(select 1 from public.bite_stays where id=s and status='in_house') then raise exception 'Read-only review mutated financial data';end if;
 failed:=false;begin perform private.bite_hotel_credit_candidate(p,f,1499,d+7,'Agreed invoice on credit');exception when others then failed:=true;end;
 if not failed then raise exception 'Stale balance accepted';end if;
 failed:=false;begin perform private.bite_hotel_credit_candidate(p,f,1500,d-1,'Agreed invoice on credit');exception when others then failed:=true;end;
 if not failed then raise exception 'Past due date accepted';end if;
 failed:=false;begin perform private.bite_hotel_credit_candidate(p,f,1500,d+7,'x');exception when others then failed:=true;end;
 if not failed then raise exception 'Missing reason accepted';end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;begin perform private.bite_hotel_credit_candidate(p,f,1500,d+7,'Agreed invoice on credit');exception when sqlstate '42501' then failed:=true;end;
 if not failed then raise exception 'Wrong property owner accepted';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 pending:=(public.bite_property_command(p,'payment',jsonb_build_object('folio_id',f,'amount',100,'method','UPI','description','Synthetic pending credit receipt','reference','CREDIT-QA'),gen_random_uuid())->>'id')::uuid;
 failed:=false;begin perform private.bite_hotel_credit_candidate(p,f,1500,d+7,'Agreed invoice on credit');exception when others then failed:=true;end;
 if not failed then raise exception 'Credit review accepted pending receipt';end if;
 perform public.bite_property_command(p,'payment_void',jsonb_build_object('id',pending,'folio_id',f,'description','Synthetic not received'),gen_random_uuid());
 insert into private.bite_hotel_credit_approvals(property_id,folio_id,approved_balance,due_date,reason,approved_by,request_id) values(p,f,1500,d+7,'Synthetic approval metadata',auth.uid(),gen_random_uuid());
 failed:=false;begin insert into private.bite_hotel_credit_approvals(property_id,folio_id,approved_balance,due_date,reason,approved_by,request_id) values(p,f,1500,d+7,'Synthetic duplicate approval',auth.uid(),gen_random_uuid());exception when unique_violation then failed:=true;end;
 if not failed then raise exception 'Duplicate credit approval accepted';end if;
 if (private.bite_folio_totals(f)->>'balance')::numeric<>1500 or exists(select 1 from public.bite_folio_entries where folio_id=f and kind='payment' and status='confirmed') then raise exception 'Metadata changed receipts or balance';end if;
 raise notice 'PASS hotel credit metadata access, exact balance, owner scope, pending receipt and no financial mutation';
end$$;
rollback;
