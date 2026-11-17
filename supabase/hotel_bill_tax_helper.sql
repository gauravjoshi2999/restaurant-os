-- Internal invoker helper, called only through the existing guarded property command.
create or replace function private.bite_apply_bill_tax(p_property uuid,p_folio uuid,p_mode text)returns jsonb
language plpgsql set search_path='' as $tax$
declare pr public.bite_properties;bf public.bite_folios;bs public.bite_stays;line record;rate numeric;profile jsonb;
begin
 if auth.uid()is null or private.bite_property_role(p_property)not in('owner','manager','receptionist')or not private.bite_can(p_property,'folios')then raise exception 'Bill access denied'using errcode='42501';end if;
 select * into strict pr from public.bite_properties where id=p_property for update;
 select * into strict bf from public.bite_folios where property_id=p_property and id=p_folio for update;
 if bf.status<>'open'then raise exception 'Issued bills cannot be changed';end if;
 select * into strict bs from public.bite_stays where property_id=p_property and id=bf.stay_id;
 if p_mode is null or p_mode not in('gst','plain')then raise exception 'Choose GST invoice or guest bill';end if;
 if p_mode='gst'then
  if not coalesce((pr.tax_profile->>'reviewed')::boolean,false)or coalesce(pr.tax_profile->>'gstin','')!~'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'then raise exception 'Set the hotel GSTIN and billing details first';end if;
  if coalesce((pr.tax_profile->>'food_rate')::numeric,0)not in(5,18)then raise exception 'Review the restaurant GST rate';end if;
  profile:=(pr.tax_profile-'primary_account')||jsonb_build_object('billing_mode','gst','room_rate',case when bs.nightly_rate>7500 then 18 else 5 end,'room_rate_auto',true);
 else
  if nullif(pr.tax_profile->>'gstin','')is not null then raise exception 'Use a GST invoice for the registered hotel. Update registration details in billing settings if its registration has changed';end if;
  profile:=jsonb_build_object('billing_mode','plain','gstin','','reviewed',true,'room_rate',0,'food_rate',0,'incidental_rate',0);
 end if;
 for line in select e.* from public.bite_folio_entries e where e.property_id=p_property and e.folio_id=p_folio and e.status='confirmed'and e.kind='charge'loop
  rate:=case when p_mode='plain'then 0 when line.category='food'then(profile->>'food_rate')::numeric when line.category='room'then case when coalesce(line.unit_rate,bs.nightly_rate)>7500 then 18 else 5 end else coalesce((profile->>'incidental_rate')::numeric,0)end;
  if line.tax_rate is distinct from rate or line.tax_amount<>round(line.amount*rate/100,2)then
   update public.bite_folio_entries set tax_rate=rate,tax_amount=round(amount*rate/100,2)where property_id=p_property and id=line.id;
  end if;
 end loop;
 update public.bite_folio_entries rev set tax_rate=orig.tax_rate,tax_amount=round(rev.amount*coalesce(orig.tax_rate,0)/100,2)
 from public.bite_folio_entries orig where rev.property_id=p_property and rev.folio_id=p_folio and rev.status='confirmed'and rev.kind='reversal'and orig.property_id=p_property and orig.folio_id=p_folio and orig.id=rev.reversal_of and(rev.tax_rate is distinct from orig.tax_rate or rev.tax_amount<>round(rev.amount*coalesce(orig.tax_rate,0)/100,2));
 update public.bite_stays set room_tax_rate=(profile->>'room_rate')::numeric where property_id=p_property and id=bs.id;
 update public.bite_folios set bill_tax_profile=profile where property_id=p_property and id=p_folio;
 return jsonb_build_object('id',p_folio,'folio_id',p_folio,'totals',private.bite_folio_totals(p_folio),'tax_profile',profile);
end$tax$;
revoke all on function private.bite_apply_bill_tax(uuid,uuid,text)from public,anon,authenticated;
