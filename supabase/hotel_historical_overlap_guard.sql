-- Historical room overlap check. Exact normalized room label only; no writes to live rooms/stays/tasks.
-- Existing historical snapshots are untouched. Adjacent departure/arrival dates are allowed.
create or replace function public.bite_historical_room_overlap_guard()
returns trigger language plpgsql security invoker set search_path='' as $fn$
declare room_key text;
begin
 if new.entry_kind<>'room' then return new;end if;
 if auth.uid() is null or not exists(select 1 from public.bite_property_members m where m.property_id=new.property_id and m.user_id=auth.uid() and m.active and m.role in ('owner','manager')) then
  raise exception 'Historical register access denied' using errcode='42501';end if;
 room_key:=lower(btrim(new.room_number));
 if room_key='' then raise exception 'Historical room number required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(new.property_id::text||':'||room_key,0));
 if exists(select 1 from public.bite_owner_historical_entries e
  where e.entry_kind='room' and e.property_id=new.property_id and lower(btrim(e.room_number))=room_key
  and e.request_id<>new.request_id and e.record_date<new.departure_date and new.record_date<e.departure_date) then
  raise exception 'H15_ROOM_OVERLAP: Review the existing historical room record before saving.' using errcode='P0001';
 end if;
 return new;
end
$fn$;
revoke all on function public.bite_historical_room_overlap_guard() from public,anon,authenticated;
drop trigger if exists bite_historical_room_overlap on public.bite_owner_historical_entries;
create trigger bite_historical_room_overlap before insert on public.bite_owner_historical_entries for each row execute function public.bite_historical_room_overlap_guard();
