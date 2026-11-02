begin;
alter table public.vinted_accounts add column blocked_at timestamptz,add column ready_at timestamptz,add column password_changed_at timestamptz;

create function app_private.account_reminder_state() returns trigger language plpgsql security invoker set search_path='' as $$
declare next_group text;prev_group text;
begin
 next_group:=case when new.deleted_at is not null or new.is_shadowbanned then 'other'
 when new.statut in ('banni_temp','banni_def','suspendu') or new.creation_stage='blocked' then 'blocked'
 when new.creation_stage='ready' or (new.creation_stage is null and new.is_ready) then 'ready' else 'other' end;
 if tg_op='UPDATE' then
 prev_group:=case when old.deleted_at is not null or old.is_shadowbanned then 'other'
 when old.statut in ('banni_temp','banni_def','suspendu') or old.creation_stage='blocked' then 'blocked'
 when old.creation_stage='ready' or (old.creation_stage is null and old.is_ready) then 'ready' else 'other' end;
 end if;
 if next_group='blocked' then
  new.blocked_at:=case when prev_group is distinct from 'blocked' then clock_timestamp() else coalesce(old.blocked_at,case when new.blocked_at is not null then clock_timestamp() end) end;
 else new.blocked_at:=null;end if;
 if next_group='ready' then
  new.ready_at:=case when prev_group is distinct from 'ready' then clock_timestamp() else coalesce(old.ready_at,case when new.ready_at is not null then clock_timestamp() end) end;
  if prev_group is distinct from 'ready' then new.password_changed_at:=null;
  elsif old.password_changed_at is not null then new.password_changed_at:=old.password_changed_at;
  elsif new.password_changed_at is not null then new.password_changed_at:=clock_timestamp();end if;
 else new.ready_at:=null;new.password_changed_at:=null;end if;
 return new;
end $$;
revoke all on function app_private.account_reminder_state() from public,anon,authenticated;
create trigger account_reminder_state before insert or update on public.vinted_accounts for each row execute function app_private.account_reminder_state();
commit;
