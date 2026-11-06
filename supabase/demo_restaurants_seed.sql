-- RestaurantOS demo storefront seed: 5 clearly labelled fictional restaurants.
-- Safe to run more than once. Uses the existing Super Admin account as creator.
-- These are TEST listings and sample menu/prices, not real businesses or offers.

begin;

do $$
declare
  v_admin uuid := 'b34674bf-b8e6-47d9-9fef-a08ba59ba5c2';
  r record;
  v_restaurant_id uuid;
  v_category_id uuid;
  v_item record;
begin
  if not exists (select 1 from public.platform_admins where user_id = v_admin) then
    raise exception 'Configured Super Admin account was not found. Stop; no demo data was added.';
  end if;

  for r in
    select * from (values
      ('Demo Royal Thali House', 'North Indian', 'Traditional thalis, dal and fresh breads', 25::numeric, 149::numeric, 30),
      ('Demo Pizza Junction', 'Pizza, Fast Food', 'Pizza, garlic bread and quick bites', 35::numeric, 199::numeric, 25),
      ('Demo Spice & Curry', 'North Indian, Chinese', 'Curries, rice, noodles and family meals', 30::numeric, 179::numeric, 35),
      ('Demo South Street', 'South Indian', 'Dosa, idli, uttapam and filter coffee', 20::numeric, 99::numeric, 20),
      ('Demo Sweet & Snacks', 'Desserts, Snacks', 'Sweets, chaat and evening snacks', 20::numeric, 79::numeric, 20)
    ) as x(name, cuisines, description, delivery_fee, minimum_order, prep_minutes)
  loop
    select id into v_restaurant_id
    from public.restaurants
    where name = r.name
      and city = 'Rajsamand'
      and public_description like '[RestaurantOS DEMO]%';

    if v_restaurant_id is null then
      insert into public.restaurants (
        name, city, status, created_by, address, is_published,
        public_description, cuisine_tags, default_delivery_fee,
        minimum_order_amount, accepts_delivery, accepts_pickup,
        estimated_prep_minutes
      ) values (
        r.name, 'Rajsamand', 'Active', v_admin,
        'Demo address, Rajsamand (test listing)', true,
        '[RestaurantOS DEMO] ' || r.description,
        string_to_array(r.cuisines, ', '), r.delivery_fee,
        r.minimum_order, true, true, r.prep_minutes
      ) returning id into v_restaurant_id;
    else
      update public.restaurants
      set status = 'Active',
          is_published = true,
          address = 'Demo address, Rajsamand (test listing)',
          public_description = '[RestaurantOS DEMO] ' || r.description,
          cuisine_tags = string_to_array(r.cuisines, ', '),
          default_delivery_fee = r.delivery_fee,
          minimum_order_amount = r.minimum_order,
          accepts_delivery = true,
          accepts_pickup = true,
          estimated_prep_minutes = r.prep_minutes
      where id = v_restaurant_id;
    end if;

    -- Two menu categories per demo restaurant.
    insert into public.menu_categories (restaurant_id, name, sort_order, is_active)
    values (v_restaurant_id, 'Popular', 1, true),
           (v_restaurant_id, 'More to try', 2, true)
    on conflict (restaurant_id, name)
    do update set is_active = true, sort_order = excluded.sort_order;

    select id into v_category_id
    from public.menu_categories
    where restaurant_id = v_restaurant_id and name = 'Popular';

    for v_item in
      select * from (values
        ('Royal Veg Thali', 189::numeric, true, 'Popular'),
        ('Paneer Butter Masala', 219::numeric, true, 'Popular'),
        ('Dal Tadka with Rice', 159::numeric, true, 'More to try'),
        ('Butter Roti', 20::numeric, true, 'More to try')
      ) as m(item_name, item_price, veg, category_name)
    loop
      select id into v_category_id
      from public.menu_categories
      where restaurant_id = v_restaurant_id and name = v_item.category_name;

      if not exists (
        select 1 from public.menu_items
        where restaurant_id = v_restaurant_id and name = v_item.item_name
      ) then
        insert into public.menu_items (
          restaurant_id, category_id, name, description, price,
          is_vegetarian, is_available, sort_order
        ) values (
          v_restaurant_id, v_category_id, v_item.item_name,
          'Sample demo menu item for testing only',
          v_item.item_price, v_item.veg, true, 1
        );
      else
        update public.menu_items
        set category_id = v_category_id,
            price = v_item.item_price,
            is_vegetarian = v_item.veg,
            is_available = true
        where restaurant_id = v_restaurant_id and name = v_item.item_name;
      end if;
    end loop;
  end loop;
end;
$$;

commit;

-- Verify: should return 5 demo restaurants and 20 sample menu items.
select r.name, r.city, r.is_published, r.status,
       count(mi.id) as sample_menu_items
from public.restaurants r
left join public.menu_items mi on mi.restaurant_id = r.id
where r.public_description like '[RestaurantOS DEMO]%'
group by r.id, r.name, r.city, r.is_published, r.status
order by r.name;
