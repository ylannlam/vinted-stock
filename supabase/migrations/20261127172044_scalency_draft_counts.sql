create function public.scalency_draft_counts(p_owner uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(account, n), '{}'::jsonb)
  from (
    select fields->>'account_id' as account, count(*) as n
    from public.listing_drafts
    where owner_id=p_owner and state='draft' and nullif(fields->>'account_id','') is not null
    group by fields->>'account_id'
  ) totals;
$$;
revoke all on function public.scalency_draft_counts(uuid) from public, anon, authenticated;
grant execute on function public.scalency_draft_counts(uuid) to service_role;
