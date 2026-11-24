-- One synthetic fixture, no provider network access, no transaction initiation.
begin;
set local role authenticated;
do $$begin
 begin
  perform public.bite_record_verified_refund_observation(
   '60000000-0000-0000-0000-000000000001',
   'bite_rf_60000000000000000000000000000001','SUCCESS',174,'INR');
  raise exception 'authenticated browser bypassed service-only grant';
 exception when insufficient_privilege then null; end;
end$$;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
do $$
declare rid uuid:='60000000-0000-0000-0000-000000000001';
        ref text:='bite_rf_60000000000000000000000000000001';
        second uuid:='60000000-0000-0000-0000-000000000002';
        s text;blocked boolean;
begin
 blocked:=false;
 begin perform public.bite_record_verified_refund_observation(rid,ref,'SUCCESS',173,'INR');
 exception when raise_exception then blocked:=true;end;
 if not blocked then raise exception 'Mismatched refund amount accepted';end if;
 blocked:=false;
 begin perform public.bite_record_verified_refund_observation(rid,ref,'UNKNOWN',174,'INR');
 exception when raise_exception then blocked:=true;end;
 if not blocked then raise exception 'Unknown refund status accepted';end if;
 -- An independently verified empty Cashfree refund list is NOT a refund,
 -- and must retain the internal request/approval status and zero money.
 s:=public.bite_record_verified_refund_observation(rid,ref,'NOT_INITIATED',174,'INR');
 if s<>'pending_approval' then raise exception 'Not initiated changed internal request state';end if;
 if not exists(select 1 from public.bite_refund_jobs
               where id=rid and provider_status='NOT_INITIATED' and provider_checked_at is not null)
 then raise exception 'No-refund provider evidence was not recorded';end if;
 if (select refund_amount_actual from public.order_financials where order_id='10000000-0000-0000-0000-000000000001')<>0
 then raise exception 'Not initiated incorrectly changed financials';end if;
 s:=public.bite_record_verified_refund_observation(rid,ref,'PENDING',174,'INR');
 if s<>'pending_approval' then raise exception 'Observed pending wrong state';end if;
 if not exists(select 1 from public.bite_refund_jobs
               where id=rid and provider_status='PENDING' and provider_checked_at is not null)
 then raise exception 'Provider pending evidence not saved';end if;
 if (select refund_amount_actual from public.order_financials where order_id='10000000-0000-0000-0000-000000000001')<>0
 then raise exception 'Provider pending incorrectly moved ledger';end if;
 s:=public.bite_record_verified_refund_observation(rid,ref,'SUCCESS',174,'INR');
 if s<>'succeeded' then raise exception 'Successful externally observed refund failed';end if;
 if not exists(select 1 from public.order_financials where order_id='10000000-0000-0000-0000-000000000001'
               and payment_status='refunded' and refund_amount_actual=174)
 then raise exception 'Refund not reflected in financial ledger';end if;
 -- Retry, out-of-order and repeated webhook must never double count or reverse.
 s:=public.bite_record_verified_refund_observation(rid,ref,'SUCCESS',174,'INR');
 if s<>'succeeded' then raise exception 'Retry not idempotent';end if;
 s:=public.bite_record_verified_refund_observation(rid,ref,'PENDING',174,'INR');
 if s<>'succeeded' then raise exception 'Late event reverted confirmed refund';end if;
 s:=public.bite_record_verified_refund_observation(rid,ref,'NOT_INITIATED',174,'INR');
 if s<>'succeeded' then raise exception 'Late no-refund event reverted SUCCESS';end if;
 if (select refund_amount_actual from public.order_financials where order_id='10000000-0000-0000-0000-000000000001')<>174
 then raise exception 'Duplicate counted refund twice';end if;
 -- Cashfree FAILED is an observed external status, not a new debit.
 update public.bite_refund_jobs set status='submitted' where id=second;
 s:=public.bite_record_verified_refund_observation(
  second,'bite_rf_60000000000000000000000000000002','FAILED',50,'INR');
 if s<>'failed' then raise exception 'Provider FAILED status was not recorded';end if;
 if (select refund_amount_actual from public.order_financials
    where order_id='10000000-0000-0000-0000-000000000002')<>0
 then raise exception 'Failed refund changed financial totals';end if;
 -- Suspicious preexisting ledger balance never receives a guessed second refund.
 update public.order_financials set refund_amount_actual=1
 where order_id='10000000-0000-0000-0000-000000000002';
 blocked:=false;
 begin perform public.bite_record_verified_refund_observation(
  second,'bite_rf_60000000000000000000000000000002','SUCCESS',50,'INR');
 exception when raise_exception then blocked:=true;end;
 if not blocked then raise exception 'Existing refund amount was double counted';end if;
 if (select refund_amount_actual from public.order_financials where order_id='10000000-0000-0000-0000-000000000002')<>1
 then raise exception 'Rejected update changed financials';end if;
 raise notice 'PASS: verified refund is idempotent and preserves provider evidence and no double ledger';
end$$;
rollback;
