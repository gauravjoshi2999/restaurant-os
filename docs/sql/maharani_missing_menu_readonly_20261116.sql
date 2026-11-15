-- Hotel Maharani Palace: candidate historical menu gap report (READ-ONLY).
-- 2026-11-16. Uses photo-credit labels to *detect* mismatches; not an
-- approved commercial 112-dish/price list. Never auto-restore from this query.
-- No INSERT/UPDATE/DELETE/DDL/temporary tables; safe to rerun.
WITH photo_labels (name) AS (VALUES
    ('Butter Milk (Chhach)'),
    ('Chilli Potato'),
    ('Chinese Bhel'),
    ('Hakka Noodles'),
    ('Honey Chilli Potato'),
    ('Malai Kofta'),
    ('Paneer Kofta'),
    ('Soya Chaap'),
    ('Paneer Pasanda'),
    ('Pineapple Raita'),
    ('Veg Navratan Korma (Sweet)'),
    ('Veg Kofta'),
    ('Veg Jaipuri'),
    ('Sweet Corn Soup'),
    ('Chana Paneer'),
    ('Mushroom Chilli Dry'),
    ('Nargis Kofta'),
    ('Paneer Patiala Shahi'),
    ('Paneer Peshawari'),
    ('Paneer Tufani Special'),
    ('Veg Patiala')
), normalized AS (
 SELECT label.name, m.id, m.price, m.is_available
 FROM photo_labels label
 LEFT JOIN public.menu_items m
   ON m.restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid
  AND regexp_replace(lower(m.name), '[^a-z0-9]', '', 'g') = regexp_replace(lower(label.name), '[^a-z0-9]', '', 'g')
)
SELECT name AS candidate_missing_dish
FROM normalized
WHERE id IS NULL
ORDER BY name;

-- Complementary snapshot of menu state; no personal data is returned.
SELECT COUNT(*) AS total_rows,
       COUNT(*) FILTER (WHERE is_available) AS available_rows,
       COUNT(*) FILTER (WHERE NOT is_available) AS unavailable_rows,
       COUNT(*) FILTER (WHERE image_url IS NULL OR btrim(image_url)='') AS missing_photo_links,
       COUNT(*) FILTER (WHERE created_at >= '2026-11-15T00:00:00Z' AND created_at < '2026-11-16T00:00:00Z') AS nov15_created_rows,
       COUNT(*) FILTER (WHERE NOT is_available AND updated_at >= '2026-11-15T09:15:00Z' AND updated_at < '2026-11-15T09:35:00Z') AS nov15_recently_paused_rows
FROM public.menu_items WHERE restaurant_id='262aaba7-f48b-4fa5-9ff6-b334ededca84'::uuid;
