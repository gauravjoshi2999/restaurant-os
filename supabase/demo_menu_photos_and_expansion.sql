-- Demo menu expansion + dish photography for the five RestaurantOS test restaurants.
-- Run after supabase/demo_restaurants_seed.sql. Safe to run repeatedly.
-- All listings, menu items, prices and images below are fictional/demo content.

begin;

do $$
declare
  x record;
  v_restaurant_id uuid;
  v_category_id uuid;
begin
  for x in
    select * from (values
      -- Existing dishes: assign photos
      ('Demo Royal Thali House','Royal Veg Thali','Popular',189::numeric,'A complete vegetarian thali with seasonal sabzi, dal, rice and breads.','photo-1546833999-b9f581a1996d'),
      ('Demo Royal Thali House','Paneer Butter Masala','Popular',219::numeric,'Paneer in a rich tomato and butter gravy.','photo-1631452180519-c014fe946bc7'),
      ('Demo Royal Thali House','Dal Tadka with Rice','More to try',159::numeric,'Yellow dal tempered with spices, served with steamed rice.','photo-1516684732162-798a0062be99'),
      ('Demo Royal Thali House','Butter Roti','More to try',20::numeric,'Soft whole-wheat roti finished with butter.','photo-1628294895950-9805252327bc'),
      ('Demo Pizza Junction','Margherita Pizza','Popular',199::numeric,'Classic pizza with mozzarella, tomato and herbs.','photo-1574071318508-1cdbab80d002'),
      ('Demo Pizza Junction','Farmhouse Pizza','Popular',279::numeric,'Loaded with capsicum, onion, tomato and cheese.','photo-1513104890138-7c749659a591'),
      ('Demo Pizza Junction','Garlic Bread','More to try',119::numeric,'Toasted garlic bread with herbs.','photo-1573140247632-f8fd74997d5c'),
      ('Demo Pizza Junction','Cheese Burst Pizza','More to try',329::numeric,'Cheese-filled crust pizza for cheese lovers.','photo-1571407970349-bc81e7e96d47'),
      ('Demo Spice & Curry','Paneer Lababdar','Popular',229::numeric,'Paneer cubes in a mildly spiced creamy gravy.','photo-1631452180519-c014fe946bc7'),
      ('Demo Spice & Curry','Veg Hakka Noodles','Popular',169::numeric,'Wok-tossed noodles with fresh vegetables.','photo-1585032226651-759b368d7246'),
      ('Demo Spice & Curry','Jeera Rice','More to try',119::numeric,'Fragrant rice tempered with cumin.','photo-1516684732162-798a0062be99'),
      ('Demo Spice & Curry','Chilli Paneer','More to try',199::numeric,'Indo-Chinese paneer tossed in chilli sauce.','photo-1631452180519-c014fe946bc7'),
      ('Demo South Street','Masala Dosa','Popular',119::numeric,'Crisp dosa filled with spiced potato masala.','photo-1668236543090-82eba5ee5976'),
      ('Demo South Street','Idli Sambar','Popular',79::numeric,'Steamed idlis served with sambar and chutney.','photo-1589301760014-d929f3979dbc'),
      ('Demo South Street','Medu Vada','More to try',69::numeric,'Crispy lentil fritters served with chutney.','photo-1601050690597-df0568f70950'),
      ('Demo South Street','Plain Uttapam','More to try',99::numeric,'Soft South Indian rice-and-lentil pancake.','photo-1630383249896-424e6be7e0b7'),
      ('Demo Sweet & Snacks','Pani Puri','Popular',49::numeric,'Crisp puris with tangy flavoured water.','photo-1606491956689-2ea866880c84'),
      ('Demo Sweet & Snacks','Aloo Tikki Chaat','Popular',79::numeric,'Potato patties topped with chutneys and curd.','photo-1601050690117-94f5f6fa8bd7'),
      ('Demo Sweet & Snacks','Gulab Jamun','More to try',59::numeric,'Soft milk dumplings soaked in sugar syrup.','photo-1666190092159-3a2f6a6c7f35'),
      ('Demo Sweet & Snacks','Kesar Rasmalai','More to try',89::numeric,'Soft chenna patties in saffron milk.','photo-1666190092159-3a2f6a6c7f35'),

      -- Four additional dishes per restaurant
      ('Demo Royal Thali House','Shahi Paneer','Popular',229::numeric,'Paneer in a mildly sweet creamy tomato gravy.','photo-1631452180519-c014fe946bc7'),
      ('Demo Royal Thali House','Chole Masala','Popular',149::numeric,'North Indian chickpea curry with aromatic spices.','photo-1546833999-b9f581a1996d'),
      ('Demo Royal Thali House','Veg Pulao','More to try',139::numeric,'Basmati rice cooked with vegetables and whole spices.','photo-1516684732162-798a0062be99'),
      ('Demo Royal Thali House','Plain Paratha','More to try',35::numeric,'Flaky whole-wheat layered paratha.','photo-1628294895950-9805252327bc'),

      ('Demo Pizza Junction','Paneer Tikka Pizza','Popular',299::numeric,'Pizza topped with paneer tikka, onion and capsicum.','photo-1571407970349-bc81e7e96d47'),
      ('Demo Pizza Junction','Veggie Delight Pizza','Popular',249::numeric,'A colourful mix of vegetables and mozzarella.','photo-1513104890138-7c749659a591'),
      ('Demo Pizza Junction','Peri Peri Fries','More to try',99::numeric,'Crispy fries tossed in peri peri seasoning.','photo-1573080496219-bb080dd4f877'),
      ('Demo Pizza Junction','Cheese Garlic Toast','More to try',109::numeric,'Toasted bread topped with garlic and melted cheese.','photo-1573140247632-f8fd74997d5c'),

      ('Demo Spice & Curry','Veg Fried Rice','Popular',159::numeric,'Wok-fried rice with vegetables and mild seasoning.','photo-1603133872878-684f208fb84b'),
      ('Demo Spice & Curry','Dal Makhani','Popular',189::numeric,'Slow-cooked black lentils in a creamy gravy.','photo-1546833999-b9f581a1996d'),
      ('Demo Spice & Curry','Veg Manchurian','More to try',179::numeric,'Vegetable dumplings tossed in tangy Manchurian sauce.','photo-1585032226651-759b368d7246'),
      ('Demo Spice & Curry','Butter Naan','More to try',35::numeric,'Soft leavened bread brushed with butter.','photo-1628294895950-9805252327bc'),

      ('Demo South Street','Rava Dosa','Popular',129::numeric,'Thin crispy semolina dosa.','photo-1668236543090-82eba5ee5976'),
      ('Demo South Street','Onion Uttapam','Popular',119::numeric,'Uttapam topped with onion and herbs.','photo-1630383249896-424e6be7e0b7'),
      ('Demo South Street','Filter Coffee','More to try',49::numeric,'South Indian style filter coffee.','photo-1509042239860-f550ce710b93'),
      ('Demo South Street','Sweet Lassi','More to try',69::numeric,'Chilled sweet yoghurt drink.','photo-1570197788417-0e82375c9371'),

      ('Demo Sweet & Snacks','Dahi Puri','Popular',69::numeric,'Crisp puris filled with potato, curd and chutneys.','photo-1606491956689-2ea866880c84'),
      ('Demo Sweet & Snacks','Samosa','Popular',25::numeric,'Crisp pastry filled with spiced potato.','photo-1601050690597-df0568f70950'),
      ('Demo Sweet & Snacks','Jalebi','More to try',49::numeric,'Crispy spirals soaked in sugar syrup.','photo-1666190092159-3a2f6a6c7f35'),
      ('Demo Sweet & Snacks','Mango Lassi','More to try',79::numeric,'Chilled yoghurt drink blended with mango.','photo-1570197788417-0e82375c9371')
    ) as t(restaurant_name,item_name,category_name,item_price,item_description,photo_id)
  loop
    select id into v_restaurant_id
    from public.restaurants
    where name = x.restaurant_name
      and city = 'Rajsamand'
      and public_description like '[RestaurantOS DEMO]%'
    limit 1;

    if v_restaurant_id is null then
      raise exception 'Demo restaurant not found: %. Run demo_restaurants_seed.sql first.', x.restaurant_name;
    end if;

    select id into v_category_id
    from public.menu_categories
    where restaurant_id = v_restaurant_id and name = x.category_name
    limit 1;

    if v_category_id is null then
      raise exception 'Menu category % missing for %. Run demo_restaurants_seed.sql first.', x.category_name, x.restaurant_name;
    end if;

    update public.menu_items
    set category_id = v_category_id,
        description = x.item_description,
        price = x.item_price,
        image_url = 'https://images.unsplash.com/' || x.photo_id || '?auto=format&fit=crop&w=900&q=82',
        is_vegetarian = true,
        is_available = true
    where restaurant_id = v_restaurant_id and name = x.item_name;

    if not found then
      insert into public.menu_items (
        restaurant_id, category_id, name, description, price,
        image_url, is_vegetarian, is_available, sort_order
      ) values (
        v_restaurant_id, v_category_id, x.item_name, x.item_description,
        x.item_price,
        'https://images.unsplash.com/' || x.photo_id || '?auto=format&fit=crop&w=900&q=82',
        true, true, 10
      );
    end if;
  end loop;
end;
$$;

commit;

-- Verify: each of the five demo restaurants should show 8 dishes with image URLs.
select r.name,
       count(mi.id) as menu_items,
       count(mi.image_url) as dishes_with_photo
from public.restaurants r
left join public.menu_items mi on mi.restaurant_id = r.id
where r.public_description like '[RestaurantOS DEMO]%'
group by r.id, r.name
order by r.name;

