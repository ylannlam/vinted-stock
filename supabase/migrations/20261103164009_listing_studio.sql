begin;
create table public.listing_drafts (
 id uuid primary key,
 owner_id uuid not null references public.profiles(id),
 version integer not null default 1 check(version > 0),
 state text not null default 'draft' check(state in ('draft','preparing','scheduled','published','attention')),
 fields jsonb not null default '{}' check(jsonb_typeof(fields)='object'),
 photos jsonb not null default '[]' check(jsonb_typeof(photos)='array' and jsonb_array_length(photos)<=20),
 dotb_item_id uuid unique,
 uploaded integer not null default 0 check(uploaded between 0 and 20),
 payload jsonb,
 inflight text check(inflight in ('create','update','photo','schedule','generate')),
 lease uuid,
 lease_until timestamptz,
 ai_count integer not null default 0 check(ai_count between 0 and 10),
 ai_updated_at timestamptz,
 message text,
 last_error text,
 vinted_id text,
 scheduled_at timestamptz,
 published_at timestamptz,
 checked_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index listing_drafts_owner_recent on public.listing_drafts(owner_id,updated_at desc,id);
alter table public.listing_drafts enable row level security;
revoke all on public.listing_drafts from public,anon,authenticated;
grant all on public.listing_drafts to service_role;
comment on table public.listing_drafts is 'Private listing preparation. Administrator API checks owner and uses version comparisons for every write; uncertain remote creations are never repeated.';
commit;
