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
-- Simulate a future approved credit invoice in isolated QA only; no production writes.
do $$
declare p uuid:=(select v from credit_qa where k='p');f uuid:=(select v from credit_qa where k='f');s uuid:=(select v from credit_qa where k='s');d date:=(now() at time zone 'Asia/Kolkata')::date;v jsonb;invoice jsonb;book jsonb;req uuid:=gen_random_uuid();failed boolean;before_count integer;
begin
 if has_function_privilege('authenticated','private.bite_hotel_credit_receipt(uuid,uuid,numeric,text,text,text,boolean,uuid)','execute') or has_function_privilege('anon','private.bite_hotel_credit_receipt(uuid,uuid,numeric,text,text,text,boolean,uuid)','execute') then raise exception 'Recovery helper exposed';end if;
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,200,'Cash','','',false,req);exception when others then failed:=true;end;
 if not failed then raise exception 'Recovery accepted unapproved folio';end if;
 insert into private.bite_hotel_credit_approvals(property_id,folio_id,approved_balance,due_date,reason,approved_by,request_id) values(p,f,1500,d+7,'Synthetic approved credit',auth.uid(),gen_random_uuid());
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,200,'Cash','','',false,req);exception when others then failed:=true;end;
 if not failed then raise exception 'Recovery accepted open folio';end if;
 invoice:=jsonb_build_object('number','SYNTHETIC-CREDIT-TEST','guest',jsonb_build_object('name','Synthetic credit guest'),'totals',private.bite_folio_totals(f),'gst','[]'::jsonb,'entries','[]'::jsonb);
 update public.bite_folios set status='settled',settled_at=now(),invoice_number='SYNTHETIC-CREDIT-TEST',invoice_snapshot=invoice where id=f;
 update public.bite_stays set status='checked_out',checked_out_at=now() where id=s;
 before_count:=(select count(*) from public.bite_folio_entries where folio_id=f);
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,1600,'Cash','','',false,req);exception when others then failed:=true;end;
 if not failed then raise exception 'Overcollection accepted';end if;
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,200,'UPI','SYNTHETIC','','false',req);exception when others then failed:=true;end;
 if not failed then raise exception 'Unverified UPI accepted';end if;
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,200,'Cash','','',false,req);exception when sqlstate '42501' then failed:=true;end;
 if not failed then raise exception 'Other property receipt accepted';end if;
 perform set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 insert into public.bite_property_shift_closings(property_id,shift_date,opening_cash,counted_cash,locked,created_by) values(p,d,0,0,true,auth.uid());
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,200,'Cash','','',false,req);exception when others then failed:=true;end;
 if not failed then raise exception 'Locked day accepted';end if;
 delete from public.bite_property_shift_closings where property_id=p and shift_date=d;
 if (select count(*) from public.bite_folio_entries where folio_id=f)<>before_count then raise exception 'Rejected recovery mutated ledger';end if;
 v:=private.bite_hotel_credit_receipt(p,f,500,'Cash','','',false,req);
 if (v->>'balance')::numeric<>1000 or private.bite_hotel_credit_receipt(p,f,500,'Cash','','',false,req)<>v then raise exception 'Cash receipt or replay failed';end if;
 failed:=false;begin perform private.bite_hotel_credit_receipt(p,f,501,'Cash','','',false,req);exception when others then failed:=true;end;
 if not failed then raise exception 'Altered replay accepted';end if;
 v:=private.bite_hotel_credit_receipt(p,f,1000,'UPI','SYNTHETIC-CREDIT','Synthetic bank',true,gen_random_uuid());
 if (v->>'balance')::numeric<>0 then raise exception 'Remaining balance not recovered';end if;
 if (select invoice_snapshot from public.bite_folios where id=f) is distinct from invoice then raise exception 'Original issued invoice changed';end if;
 book:=private.bite_daily_book(p,d,d);
 if (book->'days'->0->>'hotel_sales')::numeric is distinct from 1500::numeric or (book->'days'->0->>'cash_in')::numeric is distinct from 500::numeric or (book->'days'->0->>'online_in')::numeric is distinct from 1000::numeric then raise exception 'Daily Book double counted sale or wrong receipt: %',book->'days';end if;
 raise notice 'PASS credit recovery original ledger, invoice immutable, closed day and exact Daily Book';
end$$;
rollback;
