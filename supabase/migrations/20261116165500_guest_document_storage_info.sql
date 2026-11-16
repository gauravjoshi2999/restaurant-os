-- Storage SDKs may preflight /object/info before downloading a private file.
-- Permit scoped authenticated info, retaining the signing/list/copy boundaries.
alter policy guest_docs_read on storage.objects using(
 bucket_id='bite-guest-documents' and private.bite_document_access(name,false) and
 storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info',
  'object.head_authenticated_info','object.info_authenticated','object.delete','object.delete_many']));
alter policy guest_docs_read_boundary on storage.objects using(
 bucket_id<>'bite-guest-documents' or (private.bite_document_access(name,false) and
 storage.allow_any_operation(array['object.get_authenticated','object.get_authenticated_info',
  'object.head_authenticated_info','object.info_authenticated','object.delete','object.delete_many'])));
