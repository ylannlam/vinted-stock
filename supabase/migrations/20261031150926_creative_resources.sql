begin;
create table public.creative_resources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('prompt','background')),
  title text not null check(length(btrim(title)) between 1 and 120),
  category text not null default '' check(length(category)<=60),
  content text not null default '' check(length(content)<=50000),
  notes text not null default '' check(length(notes)<=3000),
  image_bucket text check(image_bucket in ('creative-assets','fonds')),
  image_path text check(length(image_path)<=300),
  favorite boolean not null default false,
  archived_at timestamptz,
  version integer not null default 1 check(version>0),
  legacy_fond_id uuid unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((image_bucket is null)=(image_path is null)),
  check((kind='prompt' and length(btrim(content))>0) or (kind='background' and image_path is not null))
);
create index creative_resources_recent on public.creative_resources(updated_at desc,id);
create index creative_resources_creator on public.creative_resources(created_by);
alter table public.creative_resources enable row level security;
revoke all on public.creative_resources from public,anon,authenticated;
grant all on public.creative_resources to service_role;

-- Existing backgrounds retain their original files and account associations.
insert into public.creative_resources(kind,title,category,image_bucket,image_path,legacy_fond_id,created_at)
select 'background',left(coalesce(nullif(btrim(f.nom),''),'Fond enregistré'),120),'Fonds existants','fonds',
  substring(f.image_url from '/storage/v1/object/public/fonds/([^?]+)$'),f.id,f.created_at
from public.fonds f
where f.image_url like 'https://xnclywhkqpdulogykvoy.supabase.co/storage/v1/object/public/fonds/%'
  and substring(f.image_url from '/storage/v1/object/public/fonds/([^?]+)$') is not null
on conflict(legacy_fond_id) do nothing;
commit;
