-- Only unrelated later-schema prerequisites for the claim function in this disposable DB.
alter table public.vinted_agent_settings add column messaging jsonb not null default '{}';
alter table public.vinted_agent_tasks add column priority integer not null default 0;
alter table public.vinted_agent_tasks drop constraint vinted_agent_tasks_kind_check;
create table public.listing_drafts(publication_task_id uuid,publish_provider text,state text,owner_id uuid,fields jsonb);
