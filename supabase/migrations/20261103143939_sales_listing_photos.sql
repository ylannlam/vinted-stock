begin;

-- Photo-only cache: never touches SKU, purchases or fulfilment state.
create table public.sales_order_photos (
 order_id uuid primary key references public.sales_orders(id) on delete cascade,
 account_id uuid not null,
 items jsonb not null default '{}' check(jsonb_typeof(items)='object'),
 checked_at timestamptz,
 next_attempt_at timestamptz not null default now(),
 last_started_at timestamptz,
 lease uuid,
 lease_until timestamptz
);
alter table public.sales_order_photos enable row level security;
revoke all on public.sales_order_photos from public,anon,authenticated;
grant all on public.sales_order_photos to service_role;
create trigger workspace_bump after insert or update or delete on public.sales_order_photos
 for each statement execute function app_private.workspace_bump();

create or replace view public.workspace_sales with(security_invoker=true) as
 select l.*,raw.fees_amount,raw.refund_amount,raw.finance_confirmed,
 trim(coalesce(l.sku_override,l.source->>'sku','')) as resolved_sku,
 coalesce(l."order"->>'account_login','') as account_login,
 (l."order"->>'order_date')::timestamptz as sale_date,
 (l."order"->>'deadline')::timestamptz as deadline_at,
 coalesce(l."order"->>'status','') as order_status,
 coalesce(l."order"->>'currency','') as currency,
 (l."order"->>'status' is null or l."order"->>'status' in ('cancelled','returning','suspended')) as is_blocked,
 case when l."order"->>'status' in ('shipped','ready_for_pickup','delivered','completed') then 'shipped' else l.stage end as effective_stage,
 coalesce(raw.supplier_size,nullif(l.source->>'size','')) as supplier_size,raw.supplier_color,
 (raw.supplier_size is not null) as supplier_size_manual,
 coalesce(p.photo_url,case when nullif(l.source->>'vinted_id','') is null
   or l.source->>'vinted_id'=c.items->l.dotb_item_id::text->>'vinted_id'
   then c.items->l.dotb_item_id::text->>'photo_url' end) as listing_photo_url
 from public.sales_lines_in_period l
 join public.sales_lines raw on raw.id=l.id
 left join public.sales_order_photos c on c.order_id=l.order_id and c.account_id::text=l."order"->>'account_id'
 left join public.publication_items p on p.account_id::text=l."order"->>'account_id'
   and p.item_id=coalesce(nullif(l.source->>'vinted_id',''),c.items->l.dotb_item_id::text->>'vinted_id')
 where l.source_active;

create function public.claim_sale_photos(p_ids text[],p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare chosen uuid; account uuid; result jsonb;
begin
 if p_lease is null or coalesce(cardinality(p_ids),0)>50 then raise exception 'invalid_photo_request';end if;
 if not pg_try_advisory_xact_lock(72493156) then return null;end if;
 -- Across tabs/users, only one remote request batch at a time, at most every 12s.
 if exists(select 1 from public.sales_order_photos where lease_until>now() or last_started_at>now()-interval '12 seconds') then return null;end if;
 select s.order_id,(s."order"->>'account_id')::uuid into chosen,account
 from public.workspace_sales s left join public.sales_order_photos c on c.order_id=s.order_id
 where s.id=any(p_ids) and s.listing_photo_url is null
 and s."order"->>'account_id' ~ '^[0-9a-fA-F-]{36}$'
 and (c.order_id is null or c.next_attempt_at<=now() or c.account_id::text is distinct from s."order"->>'account_id')
 order by c.checked_at asc nulls first,s.sale_date desc nulls last,s.id limit 1;
 if chosen is null then return null;end if;
 insert into public.sales_order_photos(order_id,account_id,last_started_at,lease,lease_until,next_attempt_at)
 values(chosen,account,now(),p_lease,now()+interval '40 seconds',now()+interval '1 hour')
 on conflict(order_id) do update set account_id=excluded.account_id,
 items=case when sales_order_photos.account_id=excluded.account_id then sales_order_photos.items else '{}'::jsonb end,
 last_started_at=excluded.last_started_at,lease=excluded.lease,lease_until=excluded.lease_until,next_attempt_at=excluded.next_attempt_at;
 select jsonb_build_object('order_id',o.id,'account_id',o.account_id,'transaction_id',o.transaction_id,
 'bridge_connected',coalesce(a.bridge_connected,false),'items',c.items,
 'lines',(select jsonb_agg(jsonb_build_object('id',l.dotb_item_id,'vinted_id',l.source->>'vinted_id','dotb_listing_id',l.source->>'dotb_listing_id')) from public.sales_lines l where l.order_id=o.id and l.source_active))
 into result from public.sales_orders o join public.sales_order_photos c on c.order_id=o.id
 left join public.publication_accounts a on a.id=c.account_id where o.id=chosen;
 return result;
end $$;

create function public.save_sale_photos(p_order uuid,p_lease uuid,p_items jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare cleaned jsonb; changed boolean;
begin
 if jsonb_typeof(p_items) is distinct from 'object' or octet_length(p_items::text)>200000 then raise exception 'invalid_photos';end if;
 select coalesce(jsonb_object_agg(e.key,jsonb_build_object(
 'vinted_id',case when e.value->>'vinted_id' ~ '^[1-9][0-9]{0,17}$' then e.value->>'vinted_id' end,
 'photo_url',case when e.value->>'photo_url' like 'https://%' and length(e.value->>'photo_url')<=4000 then e.value->>'photo_url' end)),'{}') into cleaned
 from jsonb_each(p_items) e where exists(select 1 from public.sales_lines l where l.order_id=p_order and l.dotb_item_id::text=e.key and l.source_active);
 select items is distinct from cleaned into changed from public.sales_order_photos where order_id=p_order and lease=p_lease and lease_until>now();
 if not found then return false;end if;
 update public.sales_order_photos set items=cleaned,checked_at=now(),lease=null,lease_until=null
 where order_id=p_order and lease=p_lease and lease_until>now();
 return changed;
end $$;
revoke all on function public.claim_sale_photos(text[],uuid),public.save_sale_photos(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_sale_photos(text[],uuid),public.save_sale_photos(uuid,uuid,jsonb) to service_role;

commit;
