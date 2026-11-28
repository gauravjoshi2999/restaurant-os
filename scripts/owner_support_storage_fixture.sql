-- Isolated fixture; never run on production.
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text not null references storage.buckets(id),name text not null,primary key(bucket_id,name));
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to anon,authenticated;
alter table storage.objects enable row level security;
-- Deliberately broad permissive policy proves that the new restrictive boundaries win.
create policy test_existing_permissive on storage.objects to authenticated,anon using(true) with check(true);
