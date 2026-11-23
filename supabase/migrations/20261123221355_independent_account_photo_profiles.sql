-- Remove only the unused column from the previous migration, preserving any concurrent data.
do $$ begin
  if not exists(select 1 from public.creative_accounts where photo_label is not null) then
    alter table public.creative_accounts drop column photo_label;
  end if;
end $$;

create table public.account_photo_backgrounds (
  id uuid primary key,
  title text not null check(length(trim(title)) between 1 and 120),
  image_path text not null unique check(image_path like 'account-photos/%'),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create table public.account_photo_profiles (
  id uuid primary key,
  login text not null check(length(login) between 1 and 200),
  background_id uuid references public.account_photo_backgrounds(id),
  photo_label text check(length(photo_label)<=120),
  prompt_front text check(length(prompt_front)<=50000),
  prompt_back text check(length(prompt_back)<=50000),
  version integer not null default 1 check(version>=1),
  updated_at timestamptz not null default now()
);
alter table public.account_photo_profiles enable row level security;
alter table public.account_photo_backgrounds enable row level security;
revoke all on public.account_photo_profiles,public.account_photo_backgrounds from anon, authenticated, public;
grant select,insert,update on public.account_photo_profiles to service_role;
grant select,insert on public.account_photo_backgrounds to service_role;
