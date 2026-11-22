-- A13 screenshot attachment candidate. Apply only after isolated Storage and API QA.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('bite-owner-support','bite-owner-support',false,3145728,array['image/jpeg','image/png','image/webp']::text[]);
-- One screenshot per ticket. A ticket UUID is not itself an authorization token.
-- Exact path uses a single fixed file name; no overwrite, move or deletion through browser roles.
create policy owner_support_image_anon_boundary on storage.objects as restrictive for all to anon
using (bucket_id <> 'bite-owner-support') with check (bucket_id <> 'bite-owner-support');
create policy owner_support_image_read on storage.objects for select to authenticated using (
 bucket_id='bite-owner-support' and exists (
  select 1 from public.owner_support_tickets t
   where name=t.id::text||'/screenshot'
     and (public.is_platform_admin() or
      (t.owner_id=(select auth.uid()) and public.has_restaurant_role(t.restaurant_id,array['owner']::text[])))
 ));
create policy owner_support_image_read_boundary on storage.objects as restrictive for select to authenticated using (
 bucket_id<>'bite-owner-support' or exists (
  select 1 from public.owner_support_tickets t
   where name=t.id::text||'/screenshot'
     and (public.is_platform_admin() or
      (t.owner_id=(select auth.uid()) and public.has_restaurant_role(t.restaurant_id,array['owner']::text[])))
 ));
create policy owner_support_image_insert on storage.objects for insert to authenticated with check (
 bucket_id='bite-owner-support' and exists (
  select 1 from public.owner_support_tickets t
   where name=t.id::text||'/screenshot'
     and t.status in ('Open','In Progress')
     and t.owner_id=(select auth.uid())
     and public.has_restaurant_role(t.restaurant_id,array['owner']::text[])
 ));
create policy owner_support_image_insert_boundary on storage.objects as restrictive for insert to authenticated with check (
 bucket_id<>'bite-owner-support' or exists (
  select 1 from public.owner_support_tickets t
   where name=t.id::text||'/screenshot'
     and t.status in ('Open','In Progress')
     and t.owner_id=(select auth.uid())
     and public.has_restaurant_role(t.restaurant_id,array['owner']::text[])
 ));
create policy owner_support_image_no_replace on storage.objects as restrictive for update to authenticated
using (bucket_id<>'bite-owner-support') with check (bucket_id<>'bite-owner-support');
create policy owner_support_image_no_delete on storage.objects as restrictive for delete to authenticated
using (bucket_id<>'bite-owner-support');
commit;
