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
declare p uuid:=(select v from credit_qa where k='p');f uuid:=(select v from credit_qa where k='f');s uuid:=(select v from credit_qa where k='s');d date:=(now() at time zone 'Asia/Kolkata')::date;req uuid:=gen_random_uuid();result jsonb;receipt jsonb;invoice jsonb;failed boolean;
begin
 if has_function_privilege('authenticated','private.bite_hotel_credit_checkout(uuid,uuid,numeric,date,text,uuid)','execute') or has_function_privilege('anon','private.bite_hotel_credit_checkout(uuid,uuid,numeric,date,text,uuid)','execute') then raise exception 'Private credit command exposed';end if;
 -- Direct client flag cannot substitute for private approval row.
 failed:=false;begin perform public.bite_property_command(p,'checkout',jsonb_build_object('folio_id',f,'credit_approval_request',req),gen_random_uuid());exception when others then failed:=true;end;
 if not failed then raise exception 'Unapproved credit checkout accepted';end if;
 failed:=false;begin perform private.bite_hotel_credit_checkout(p,f,1499,d+7,'Synthetic credit authorization',req);exception when others then failed:=true;end;
 if not failed or exists(select 1 from private.bite_hotel_credit_approvals where folio_id=f) then raise exception 'Wrong balance created credit approval';end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;begin perform private.bite_hotel_credit_checkout(p,f,1500,d+7,'Synthetic credit authorization',req);exception when sqlstate '42501' then failed:=true;end;
 if not failed then raise exception 'Other property owner approved credit';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 result:=private.bite_hotel_credit_checkout(p,f,1500,d+7,'Synthetic credit authorization',req);
 invoice:=result->'invoice';
 if (invoice->'totals'->>'paid')::numeric is distinct from 0::numeric or (invoice->'totals'->>'balance')::numeric is distinct from 1500::numeric or invoice->'credit'->>'status' is distinct from 'unpaid' then raise exception 'Invoice incorrectly treats credit as paid';end if;
 if not exists(select 1 from public.bite_stays where id=s and status='checked_out') or exists(select 1 from public.bite_folio_entries where folio_id=f and kind='payment') then raise exception 'Credit checkout did not preserve unpaid balance';end if;
 if private.bite_hotel_credit_checkout(p,f,1500,d+7,'Synthetic credit authorization',req)<>result then raise exception 'Credit retry was not stable';end if;
 failed:=false;begin perform private.bite_hotel_credit_checkout(p,f,1500,d+8,'Synthetic credit authorization',req);exception when others then failed:=true;end;
 if not failed then raise exception 'Changed credit retry accepted';end if;
 receipt:=private.bite_hotel_credit_receipt(p,f,500,'Cash','','',false,gen_random_uuid());
 if (receipt->>'balance')::numeric is distinct from 1000::numeric or (select invoice_snapshot from public.bite_folios where id=f) is distinct from invoice then raise exception 'Post-checkout recovery failed or changed invoice';end if;
 raise notice 'PASS atomic hotel credit checkout, exact outstanding, forged flag, retries and subsequent recovery';
end$$;
rollback;
