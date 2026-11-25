-- B007 / R14 upload authorization audit — READ ONLY.
-- Inspect EFFECTIVE permissive/restrictive policies; do not infer a grant from
-- only a policy's USING/WITH CHECK expression. No uploads, DDL or data writes.
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
WHERE id='bite-menu';

SELECT policyname, permissive, cmd, roles::text AS roles, qual, with_check
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
  AND (policyname LIKE 'bite_assets_%' OR policyname LIKE 'guest_docs_%')
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='storage' AND table_name='objects'
  AND grantee IN ('anon','authenticated')
ORDER BY grantee, privilege_type;

SELECT bucket_id, split_part(name,'/',2) AS second_segment, count(*) AS objects
FROM storage.objects
WHERE bucket_id='bite-menu'
GROUP BY bucket_id, split_part(name,'/',2)
ORDER BY second_segment;

SELECT count(*) AS current_dish_photo_objects
FROM storage.objects
WHERE bucket_id='bite-menu' AND name LIKE '%/menu/%';

SELECT role, count(*) AS memberships
FROM public.restaurant_members
GROUP BY role
ORDER BY role;
