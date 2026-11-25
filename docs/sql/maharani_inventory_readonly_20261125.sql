-- B005: Hotel Maharani Palace inventory evidence (2026-11-25).
-- READ-ONLY, no DDL, no writes, no guest/customer/payment data.
-- A row or image URL here is not proof of owner-approved sale/price/photo rights.
-- Run statements individually in Supabase SQL editor; review aggregate evidence.
-- Reuse docs/sql/maharani_missing_menu_readonly_20261116.sql for historical candidate labels.

-- 1. Current menu integrity and external photo-link types.
WITH menu AS (
 SELECT m.id,m.name,m.price,m.is_available,m.image_url,m.category_id,
        regexp_replace(lower(m.name),'[^a-z0-9]','','g') normalized_name
 FROM public.menu_items m
 WHERE m.restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid
)
SELECT count(*) total,
       count(*) FILTER (WHERE is_available) available,
       count(*) FILTER (WHERE NOT is_available) unavailable,
       count(*) FILTER (WHERE category_id IS NULL) uncategorized,
       count(*) FILTER (WHERE price IS NULL OR price<=0) invalid_price,
       count(*) FILTER (WHERE price=1) one_rupee_items,
       count(*) FILTER (WHERE image_url IS NULL OR btrim(image_url)='') missing_image_urls,
       count(*) FILTER (WHERE image_url ILIKE 'https://commons.wikimedia.org/wiki/Special:FilePath/%') wikimedia_filepaths,
       count(DISTINCT normalized_name) distinct_normalized_names
FROM menu;

-- 2. Specific public-catalogue review candidates. Do not change publication.
SELECT name, price, is_available,
       (image_url IS NOT NULL AND btrim(image_url)<>'') AS has_image_url
FROM public.menu_items
WHERE restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid
  AND (price=1 OR image_url IS NULL OR btrim(image_url)='')
ORDER BY name;

-- 3. Category counts, including zero-item categories.
SELECT c.name AS category,
       count(m.id) items,
       count(m.id) FILTER (WHERE m.is_available) available
FROM public.menu_categories c
LEFT JOIN public.menu_items m ON m.category_id=c.id
WHERE c.restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid
GROUP BY c.id,c.name,c.sort_order
ORDER BY c.sort_order,c.name;

-- 4. Property-scoped configured rooms by declared type and active flag.
-- Do not infer an omitted room number or create missing inventory.
SELECT r.room_type,
       count(*) configured,
       count(*) FILTER (WHERE r.active) active,
       count(*) FILTER (WHERE r.housekeeping='ready') housekeeping_ready
FROM public.bite_rooms r
JOIN public.bite_properties p ON p.id=r.property_id
WHERE p.origin_restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid
GROUP BY r.room_type ORDER BY r.room_type;

-- 5. Verified inventory check without names, guests, booking or private data.
SELECT count(*) configured_rooms,
       count(*) FILTER (WHERE r.active) active_rooms,
       count(DISTINCT r.number) unique_room_numbers
FROM public.bite_rooms r
JOIN public.bite_properties p ON p.id=r.property_id
WHERE p.origin_restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid;

-- 6. Checks for accidental duplicate normalized names.
SELECT regexp_replace(lower(name),'[^a-z0-9]','','g') normalized_name, count(*) duplicate_rows
FROM public.menu_items
WHERE restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid
GROUP BY 1 HAVING count(*)>1
ORDER BY duplicate_rows DESC;
