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
-- Remain authenticated: exercise actual public property command, not private helper.
do $$
declare p uuid:=(select v from credit_qa where k='p');f uuid:=(select v from credit_qa where k='f');d date:=(now() at time zone 'Asia/Kolkata')::date;req uuid:=gen_random_uuid();payload jsonb;v jsonb;accounts jsonb;failed boolean;
begin
 payload:=jsonb_build_object('folio_id',f,'balance',1500,'due_date',d+7,'reason','Synthetic credit checkout through API');
 accounts:=public.bite_property_command(p,'hotel_credit_list','{}',gen_random_uuid())->'accounts';
 if accounts is distinct from '[]'::jsonb then raise exception 'Unexpected initial credit accounts';end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;begin perform public.bite_property_command(p,'hotel_credit_checkout',payload,req);exception when sqlstate '42501' then failed:=true;end;
 if not failed then raise exception 'Cross-property credit API checkout accepted';end if;
 failed:=false;begin perform public.bite_property_command(p,'hotel_credit_list','{}',gen_random_uuid());exception when sqlstate '42501' then failed:=true;end;
 if not failed then raise exception 'Cross-property credit list leaked';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 v:=public.bite_property_command(p,'hotel_credit_checkout',payload,req);
 if v->'invoice'->'credit'->>'status' is distinct from 'unpaid' or public.bite_property_command(p,'hotel_credit_checkout',payload,req)<>v then raise exception 'API credit checkout or retry failed';end if;
 accounts:=public.bite_property_command(p,'hotel_credit_list','{}',gen_random_uuid())->'accounts';
 if jsonb_array_length(accounts)<>1 or (accounts->0->>'balance')::numeric is distinct from 1500::numeric then raise exception 'Original credit missing from list';end if;
 payload:=jsonb_build_object('folio_id',f,'amount',500,'method','Cash','reference','','account_note','','verified',false);
 req:=gen_random_uuid();v:=public.bite_property_command(p,'hotel_credit_receipt',payload,req);
 if (v->>'balance')::numeric is distinct from 1000::numeric or public.bite_property_command(p,'hotel_credit_receipt',payload,req)<>v then raise exception 'Credit receipt retry failed';end if;
 accounts:=public.bite_property_command(p,'hotel_credit_list','{}',gen_random_uuid())->'accounts';
 if (accounts->0->>'balance')::numeric is distinct from 1000::numeric or (accounts->0->>'approved_balance')::numeric is distinct from 1500::numeric then raise exception 'Credit list recovery balance mismatch';end if;
 raise notice 'PASS authenticated credit checkout, receipt, list and tenant isolation';
end$$;
reset role;
rollback;
