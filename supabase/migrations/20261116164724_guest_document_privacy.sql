-- Optional masked guest records. No existing guest, order or payment is rewritten.
-- Bytes are created/deleted only through Storage API, never through SQL.
create table public.bite_guest_documents (
 id uuid primary key,
 property_id uuid not null references public.bite_properties(id),
 guest_id uuid not null,
 kind text not null check(kind in ('masked_id','travel_record','supporting_record')),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','application/pdf')),
 byte_size integer not null check(byte_size between 1 and 4194304),
 object_path text not null unique,
 status text not null default 'pending' check(status in ('pending','ready','deleted')),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 deleted_at timestamptz,
 foreign key(property_id,guest_id) references public.bite_guests(property_id,id),
 check(object_path=property_id::text||'/'||guest_id::text||'/'||id::text||
  case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end)
);
create index bite_guest_documents_guest on public.bite_guest_documents(property_id,guest_id,created_at desc);
alter table public.bite_guest_documents enable row level security;
revoke all on public.bite_guest_documents from public,anon,authenticated;
grant select on public.bite_guest_documents to authenticated;
create policy guest_documents_read on public.bite_guest_documents for select to authenticated
 using(private.bite_can(property_id,'guest_register') and status<>'deleted');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('bite-guest-documents','bite-guest-documents',false,4194304,array['image/jpeg','image/png','application/pdf']);

create function private.bite_document_access(p_path text,p_upload boolean default false) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select private.bite_can(d.property_id,'guest_register') and
  case when p_upload then d.status='pending' and d.created_by=(select auth.uid())
   else d.status in ('ready','pending') end
  from public.bite_guest_documents d where d.object_path=p_path),false)
$$;
revoke all on function private.bite_document_access(text,boolean) from public,anon;
grant execute on function private.bite_document_access(text,boolean) to authenticated;

-- Operation filters prevent minting bearer/signed URLs, copy/move and upsert.
-- Restrictive boundaries also resist unrelated permissive Storage policies.
create policy guest_docs_anon_boundary on storage.objects as restrictive for all to anon
 using(bucket_id<>'bite-guest-documents') with check(bucket_id<>'bite-guest-documents');
create policy guest_docs_read on storage.objects for select to authenticated
 using(bucket_id='bite-guest-documents' and private.bite_document_access(name,false) and
  storage.allow_any_operation(array['object.get_authenticated','object.delete','object.delete_many']));
create policy guest_docs_read_boundary on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'bite-guest-documents' or (private.bite_document_access(name,false) and
  storage.allow_any_operation(array['object.get_authenticated','object.delete','object.delete_many'])));
create policy guest_docs_insert on storage.objects for insert to authenticated
 with check(bucket_id='bite-guest-documents' and private.bite_document_access(name,true) and storage.allow_only_operation('object.upload'));
create policy guest_docs_insert_boundary on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'bite-guest-documents' or (private.bite_document_access(name,true) and storage.allow_only_operation('object.upload')));
create policy guest_docs_no_replace on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'bite-guest-documents') with check(bucket_id<>'bite-guest-documents');
create policy guest_docs_delete on storage.objects for delete to authenticated
 using(bucket_id='bite-guest-documents' and private.bite_document_access(name,false) and
  storage.allow_any_operation(array['object.delete','object.delete_many']));
create policy guest_docs_delete_boundary on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'bite-guest-documents' or (private.bite_document_access(name,false) and
  storage.allow_any_operation(array['object.delete','object.delete_many'])));

create function private.bite_guest_document_list(p_property uuid,p_guest uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.bite_can(p_property,'guest_register') then
  raise exception 'Guest document access denied' using errcode='42501';
 end if;
 if not exists(select 1 from public.bite_guests where property_id=p_property and id=p_guest) then
  raise exception 'Guest not found in this property' using errcode='P0002';
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'mime_type',d.mime_type,
  'byte_size',d.byte_size,'object_path',d.object_path,'status',d.status,'created_at',d.created_at,
  'can_finish',d.created_by=auth.uid()) order by d.created_at desc),'[]'::jsonb)
  from public.bite_guest_documents d where d.property_id=p_property and d.guest_id=p_guest and d.status<>'deleted');
end $$;

create function private.bite_guest_document_command(p_property uuid,p_guest uuid,p_document uuid,p_action text,p_details jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.bite_guest_documents; g uuid; object_meta jsonb; object_owner text; ext text;
begin
 if auth.uid() is null or not private.bite_can(p_property,'guest_register') then
  raise exception 'Guest document access denied' using errcode='42501';
 end if;
 -- Serializes the five-file limit and repeated requests for this guest.
 select id into g from public.bite_guests where property_id=p_property and id=p_guest for update;
 if g is null then raise exception 'Guest not found in this property' using errcode='P0002'; end if;
 if p_document is null then raise exception 'Document request ID required' using errcode='22023'; end if;
 select * into d from public.bite_guest_documents where id=p_document for update;
 if d.id is not null and (d.property_id<>p_property or d.guest_id<>p_guest) then
  raise exception 'Document does not belong to this guest' using errcode='42501';
 end if;
 if p_action='begin' then
  if coalesce(p_details->>'kind','') not in ('masked_id','travel_record','supporting_record') or
     coalesce(p_details->>'mime_type','') not in ('image/jpeg','image/png','application/pdf') or
     coalesce(p_details->>'byte_size','') !~ '^[0-9]{1,7}$' or
     not coalesce((p_details->>'redacted_confirmed')::boolean,false) then
   raise exception 'Choose a supported masked copy and confirm necessary, redacted information only' using errcode='22023';
  end if;
  if (p_details->>'byte_size')::integer not between 1 and 4194304 then
   raise exception 'Document must be at most 4 MB' using errcode='22023';
  end if;
  if d.id is not null then
   if d.created_by<>auth.uid() or d.status='deleted' or d.kind<>p_details->>'kind' or
      d.mime_type<>p_details->>'mime_type' or d.byte_size<>(p_details->>'byte_size')::integer then
    raise exception 'Document request already has different details. Refresh before retrying' using errcode='22023';
   end if;
  else
   if (select count(*) from public.bite_guest_documents where property_id=p_property and guest_id=p_guest and status<>'deleted')>=5 then
    raise exception 'Five copies already exist. Remove an unnecessary or unfinished copy first' using errcode='22023';
   end if;
   ext:=case p_details->>'mime_type' when 'image/jpeg' then '.jpg' when 'image/png' then '.png' else '.pdf' end;
   insert into public.bite_guest_documents(id,property_id,guest_id,kind,mime_type,byte_size,object_path,created_by)
    values(p_document,p_property,p_guest,p_details->>'kind',p_details->>'mime_type',(p_details->>'byte_size')::integer,
     p_property::text||'/'||p_guest::text||'/'||p_document::text||ext,auth.uid()) returning * into d;
   insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
    values(p_property,auth.uid(),'guest_document_begin',p_document,p_document);
  end if;
 elsif p_action='finish' then
  if d.id is null or d.status='deleted' or d.created_by<>auth.uid() then
   raise exception 'Your unfinished document upload is required' using errcode='42501';
  end if;
  if d.status='pending' then
   select metadata,owner_id into object_meta,object_owner from storage.objects
    where bucket_id='bite-guest-documents' and name=d.object_path;
   if object_meta is null or coalesce(object_meta->>'size','') !~ '^[0-9]{1,7}$' or
      (object_meta->>'size')::integer<>d.byte_size or object_meta->>'mimetype' is distinct from d.mime_type or
      object_owner is distinct from d.created_by::text then
    raise exception 'Upload not confirmed. Retry the same file, or remove the unfinished copy' using errcode='22023';
   end if;
   update public.bite_guest_documents set status='ready',completed_at=now() where id=d.id returning * into d;
   insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
    values(p_property,auth.uid(),'guest_document_complete',p_document,p_document);
  end if;
 elsif p_action='forget' then
  if d.id is null then raise exception 'Document not found' using errcode='P0002'; end if;
  if exists(select 1 from storage.objects where bucket_id='bite-guest-documents' and name=d.object_path) then
   raise exception 'File deletion is not confirmed. Retry Remove; the copy is still retained' using errcode='22023';
  end if;
  if d.status<>'deleted' then
   update public.bite_guest_documents set status='deleted',deleted_at=now() where id=d.id returning * into d;
   insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
    values(p_property,auth.uid(),'guest_document_delete',p_document,p_document);
  end if;
 else raise exception 'Unknown document action' using errcode='22023';
 end if;
 return jsonb_build_object('id',d.id,'object_path',d.object_path,'status',d.status);
end $$;

create function public.bite_guest_document_list(p_property uuid,p_guest uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.bite_guest_document_list(p_property,p_guest) $$;
create function public.bite_guest_document_command(p_property uuid,p_guest uuid,p_document uuid,p_action text,p_details jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$ select private.bite_guest_document_command(p_property,p_guest,p_document,p_action,p_details) $$;
revoke all on function private.bite_guest_document_list(uuid,uuid),private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb),
 public.bite_guest_document_list(uuid,uuid),public.bite_guest_document_command(uuid,uuid,uuid,text,jsonb) from public,anon;
grant execute on function private.bite_guest_document_list(uuid,uuid),private.bite_guest_document_command(uuid,uuid,uuid,text,jsonb),
 public.bite_guest_document_list(uuid,uuid),public.bite_guest_document_command(uuid,uuid,uuid,text,jsonb) to authenticated;
