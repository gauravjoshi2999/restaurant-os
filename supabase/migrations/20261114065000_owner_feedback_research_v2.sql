alter table public.bite_owner_feedback
add column if not exists marketplace_platforms text[] not null default '{}',
add column if not exists marketplace_opportunities text[] not null default '{}',
add column if not exists marketplace_best_part text,
add column if not exists marketplace_wish text,
add column if not exists marketplace_nonuse_reason text,
add column if not exists pos_brand text,
add column if not exists pos_best_part text,
add column if not exists pos_improvement text,
add column if not exists switch_motivators text[] not null default '{}',
add column if not exists demo_preference text;
comment on column public.bite_owner_feedback.marketplace_platforms is 'Owner-selected platforms, not verified enrollment; none means does not currently use online platforms.';
comment on column public.bite_owner_feedback.switch_motivators is 'Non-binding discovery preferences, not purchase commitments.';
