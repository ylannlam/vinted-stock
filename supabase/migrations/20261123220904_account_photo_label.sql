alter table public.creative_accounts add column photo_label text check (length(photo_label) <= 120);
