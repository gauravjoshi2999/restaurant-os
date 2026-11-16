-- Storage catalogue and operation helpers ONLY for an empty disposable DB.
-- No bytes are stored by this fixture; live objects are managed through the API.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets,
 name text not null,metadata jsonb,owner_id text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated,anon;
grant select,insert,update,delete on storage.objects to authenticated,anon;
create function storage.allow_any_operation(expected text[]) returns boolean language sql stable as $$
 select coalesce(regexp_replace(current_setting('storage.operation',true),'^storage\.','')=any(
  array(select regexp_replace(x,'^storage\.','') from unnest(expected) x)),false)
$$;
create function storage.allow_only_operation(expected text) returns boolean language sql stable as $$
 select storage.allow_any_operation(array[expected])
$$;
-- Deliberately broad unrelated policy: restrictive new-bucket boundaries must
-- still deny anonymous, cross-property, signing, copy and overwrite operations.
create policy unrelated_broad_policy on storage.objects for all to authenticated,anon using(true) with check(true);
insert into storage.buckets values('other-fixture','other-fixture',false,null,null);
