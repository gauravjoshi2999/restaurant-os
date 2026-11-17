-- Activate restaurant-confirmation-first checkout only AFTER the matching
-- customer.html, Owner index.html and their approval assets are live on GitHub Pages
-- and bite-live-create-session v15+ is verified. This is the production cutover.
-- Existing intents are not rewritten and existing paid orders are untouched.
ALTER TABLE public.bite_live_checkout_intents
  ALTER COLUMN confirmation_required SET DEFAULT true;
