create table if not exists public.restaurant_reviews (
 id uuid primary key default gen_random_uuid(), restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 order_id uuid not null references public.orders(id) on delete cascade, customer_id uuid not null references auth.users(id) on delete cascade,
 rating smallint not null check(rating between 1 and 5), review text not null check(length(btrim(review)) between 3 and 500),
 status text not null default 'Pending' check(status in('Pending','Published','Hidden')), response text,
 responded_by uuid references auth.users(id), responded_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(order_id,customer_id));
create index if not exists restaurant_reviews_restaurant_status_idx on public.restaurant_reviews(restaurant_id,status,created_at desc);
create index if not exists restaurant_reviews_customer_idx on public.restaurant_reviews(customer_id,created_at desc);
alter table public.restaurant_reviews enable row level security;
drop policy if exists "public read published restaurant reviews" on public.restaurant_reviews;
create policy "public read published restaurant reviews" on public.restaurant_reviews for select to anon,authenticated using(status='Published');
drop policy if exists "customers read own restaurant reviews" on public.restaurant_reviews;
create policy "customers read own restaurant reviews" on public.restaurant_reviews for select to authenticated using(customer_id=(select auth.uid()));
drop policy if exists "restaurant teams read reviews" on public.restaurant_reviews;
create policy "restaurant teams read reviews" on public.restaurant_reviews for select to authenticated using(public.is_platform_admin() or public.is_restaurant_member(restaurant_id));
drop policy if exists "customers create own restaurant reviews" on public.restaurant_reviews;
create policy "customers create own restaurant reviews" on public.restaurant_reviews for insert to authenticated with check(customer_id=(select auth.uid()) and exists(select 1 from public.orders o where o.id=order_id and o.restaurant_id=restaurant_reviews.restaurant_id and o.customer_id=(select auth.uid()) and o.status='Completed'));
drop policy if exists "owners managers respond to reviews" on public.restaurant_reviews;
create policy "owners managers respond to reviews" on public.restaurant_reviews for update to authenticated using(public.has_restaurant_role(restaurant_id,array['owner','manager'])) with check(public.has_restaurant_role(restaurant_id,array['owner','manager']));
grant select on public.restaurant_reviews to anon,authenticated; grant insert,update on public.restaurant_reviews to authenticated;
create or replace function public.create_customer_restaurant_review(p_order_id uuid,p_rating integer,p_review text)
returns uuid language plpgsql security definer set search_path=''
as $function$ declare v_order public.orders%rowtype; v_review_id uuid;
begin
 if auth.uid() is null then raise exception 'Customer login required.'; end if;
 if p_rating is null or p_rating<1 or p_rating>5 then raise exception 'Rating must be from 1 to 5 stars.'; end if;
 if p_review is null or length(btrim(p_review))<3 or length(btrim(p_review))>500 then raise exception 'Review must be 3 to 500 characters.'; end if;
 select * into v_order from public.orders where id=p_order_id for update;
 if not found or v_order.customer_id<>(select auth.uid()) then raise exception 'Order not found for this customer.'; end if;
 if v_order.status<>'Completed' then raise exception 'Review can be submitted only after delivery is completed.'; end if;
 insert into public.restaurant_reviews(restaurant_id,order_id,customer_id,rating,review,status) values(v_order.restaurant_id,v_order.id,(select auth.uid()),p_rating,btrim(p_review),'Pending') returning id into v_review_id; return v_review_id;
end; $function$;
create or replace function public.respond_restaurant_review(p_review_id uuid,p_response text,p_publish boolean)
returns boolean language plpgsql security definer set search_path=''
as $function$ declare v_review public.restaurant_reviews%rowtype;
begin
 if auth.uid() is null then raise exception 'Restaurant login required.'; end if;
 select * into v_review from public.restaurant_reviews where id=p_review_id for update;
 if not found then raise exception 'Review not found.'; end if;
 if not public.has_restaurant_role(v_review.restaurant_id,array['owner','manager']) then raise exception 'Owner/Manager access required.'; end if;
 if p_response is null or length(btrim(p_response))<3 or length(btrim(p_response))>500 then raise exception 'Reply must be 3 to 500 characters.'; end if;
 if v_review.status='Hidden' then raise exception 'Hidden review cannot be replied to.'; end if;
 update public.restaurant_reviews set response=btrim(p_response),status=case when coalesce(p_publish,true) then 'Published' else 'Hidden' end,responded_by=(select auth.uid()),responded_at=now(),updated_at=now() where id=v_review.id; return true;
end; $function$;
revoke execute on function public.create_customer_restaurant_review(uuid,integer,text) from public,anon; grant execute on function public.create_customer_restaurant_review(uuid,integer,text) to authenticated;
revoke execute on function public.respond_restaurant_review(uuid,text,boolean) from public,anon; grant execute on function public.respond_restaurant_review(uuid,text,boolean) to authenticated;
drop function if exists public.list_public_restaurants();
create function public.list_public_restaurants()
returns table(id uuid,name text,city text,address text,public_description text,cuisine_tags text[],default_delivery_fee numeric,minimum_order_amount numeric,accepts_delivery boolean,accepts_pickup boolean,estimated_prep_minutes integer,latitude double precision,longitude double precision,average_rating numeric,review_count bigint)
language sql stable security definer set search_path=''
as $function$ select r.id,r.name,r.city,r.address,r.public_description,r.cuisine_tags,r.default_delivery_fee,r.minimum_order_amount,r.accepts_delivery,r.accepts_pickup,r.estimated_prep_minutes,r.latitude,r.longitude,coalesce(avg(rv.rating),0)::numeric(2,1),count(rv.id) from public.restaurants r left join public.restaurant_reviews rv on rv.restaurant_id=r.id and rv.status='Published' where r.is_published and r.status='Active' group by r.id order by r.name; $function$;
revoke execute on function public.list_public_restaurants() from public; grant execute on function public.list_public_restaurants() to anon,authenticated;
drop function if exists public.list_my_customer_orders();
create function public.list_my_customer_orders()
returns table(id uuid,order_code text,restaurant_id uuid,restaurant_name text,amount numeric,status text,order_date timestamptz,customer_name text,delivery_type text,customer_note text,delivery_otp text,review_id uuid,review_rating smallint,review_status text,review_text text)
language sql stable security definer set search_path=''
as $function$ select o.id,o.order_code,o.restaurant_id,r.name,o.amount,o.status,o.order_date,o.customer_name,o.delivery_type,o.customer_note,(select h.delivery_otp from public.restaurant_delivery_handoffs h where h.order_id=o.id and h.restaurant_id=o.restaurant_id and h.is_active and h.expires_at>now() and h.verified_at is null),(select rv.id from public.restaurant_reviews rv where rv.order_id=o.id and rv.customer_id=(select auth.uid())),(select rv.rating from public.restaurant_reviews rv where rv.order_id=o.id and rv.customer_id=(select auth.uid())),(select rv.status from public.restaurant_reviews rv where rv.order_id=o.id and rv.customer_id=(select auth.uid())),(select rv.review from public.restaurant_reviews rv where rv.order_id=o.id and rv.customer_id=(select auth.uid())) from public.orders o join public.restaurants r on r.id=o.restaurant_id where auth.uid() is not null and o.customer_id=(select auth.uid()) order by o.order_date desc,o.created_at desc; $function$;
revoke execute on function public.list_my_customer_orders() from public,anon; grant execute on function public.list_my_customer_orders() to authenticated;