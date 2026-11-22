-- A13 follow-up candidate. Isolated QA first; no fabricated history for prior tickets.
begin;
create schema if not exists private;
create table public.owner_support_ticket_events (
 id bigint generated always as identity primary key,
 ticket_id uuid not null references public.owner_support_tickets(id) on delete restrict,
 event_kind text not null check (event_kind in ('Opened','Updated')),
 previous_status text check (previous_status in ('Open','In Progress','Resolved','Closed')),
 status text not null check (status in ('Open','In Progress','Resolved','Closed')),
 response text check (response is null or char_length(btrim(response)) between 1 and 2000),
 occurred_at timestamptz not null default clock_timestamp()
);
create index owner_support_event_ticket_idx on public.owner_support_ticket_events(ticket_id,id);
alter table public.owner_support_ticket_events enable row level security;
revoke all on public.owner_support_ticket_events from public,anon,authenticated;
grant select on public.owner_support_ticket_events to authenticated;
create policy owner_support_event_read on public.owner_support_ticket_events
 for select to authenticated using (exists(
  select 1 from public.owner_support_tickets t
   where t.id=owner_support_ticket_events.ticket_id
   and (public.is_platform_admin() or
   (t.owner_id=(select auth.uid()) and public.has_restaurant_role(t.restaurant_id,array['owner']::text[])))
 ));
-- Only the trigger may append. Direct user writes are not granted.
create function private.append_owner_support_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authenticated support actor required' using errcode='42501'; end if;
 if tg_op='INSERT' then
  if new.owner_id is distinct from auth.uid() or not public.has_restaurant_role(new.restaurant_id,array['owner']::text[]) then
   raise exception 'Invalid support requester' using errcode='42501';
  end if;
  insert into public.owner_support_ticket_events(ticket_id,event_kind,status,response)
  values(new.id,'Opened',new.status,null);
 elsif tg_op='UPDATE' then
  if not public.is_platform_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  if (old.status,old.admin_response) is distinct from (new.status,new.admin_response) then
   insert into public.owner_support_ticket_events(ticket_id,event_kind,previous_status,status,response)
   values(new.id,'Updated',old.status,new.status,new.admin_response);
  end if;
 end if;
 return new;
end;
$$;
revoke all on function private.append_owner_support_event() from public,anon,authenticated;
create trigger owner_support_event_append after insert or update on public.owner_support_tickets
for each row execute function private.append_owner_support_event();
commit;
