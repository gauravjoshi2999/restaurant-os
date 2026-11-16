-- Direct authenticated Storage responses can remain cached after revocation.
-- Guest bytes are served only by the no-store, freshly authorized Edge proxy.
-- Browser SELECT remains solely for Storage's delete operation, not URLs/info.
alter policy guest_docs_read on storage.objects using(
 bucket_id='bite-guest-documents' and private.bite_document_access(name,false) and
 storage.allow_any_operation(array['object.delete','object.delete_many']));
alter policy guest_docs_read_boundary on storage.objects using(
 bucket_id<>'bite-guest-documents' or (private.bite_document_access(name,false) and
 storage.allow_any_operation(array['object.delete','object.delete_many'])));

create function private.bite_guest_document_read(p_property uuid,p_guest uuid,p_document uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d public.bite_guest_documents;
begin
 if auth.uid() is null or not private.bite_can(p_property,'guest_register') then
  raise exception 'Guest document access denied' using errcode='42501';
 end if;
 select * into d from public.bite_guest_documents where id=p_document and property_id=p_property and guest_id=p_guest and status='ready';
 if d.id is null then raise exception 'Retained copy not found' using errcode='P0002'; end if;
 insert into public.bite_property_audit(property_id,actor_id,action,entity_id,request_id)
  values(p_property,auth.uid(),'guest_document_download_request',p_document,gen_random_uuid());
 return jsonb_build_object('id',d.id,'kind',d.kind,'mime_type',d.mime_type,'byte_size',d.byte_size,'object_path',d.object_path);
end $$;
create function public.bite_guest_document_read(p_property uuid,p_guest uuid,p_document uuid) returns jsonb
language sql security invoker set search_path='' as $$ select private.bite_guest_document_read(p_property,p_guest,p_document) $$;
revoke all on function private.bite_guest_document_read(uuid,uuid,uuid),public.bite_guest_document_read(uuid,uuid,uuid) from public,anon;
grant execute on function private.bite_guest_document_read(uuid,uuid,uuid),public.bite_guest_document_read(uuid,uuid,uuid) to authenticated;
