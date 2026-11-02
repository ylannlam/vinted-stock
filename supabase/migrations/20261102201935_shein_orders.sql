begin;
create table public.shein_orders (
 ref text primary key check(ref ~ '^G[A-Z0-9]{7,39}$'),
 order_date date not null, observed_at timestamptz not null,
 collector_id uuid references public.catalog_collectors(id), updated_at timestamptz not null default now()
);
create index shein_orders_recent_idx on public.shein_orders(order_date desc,ref);
create index shein_orders_collector_idx on public.shein_orders(collector_id);
create table public.shein_order_items (
 id text primary key, order_ref text not null references public.shein_orders(ref),
 sku text not null, supplier_id text not null, product_url text not null, title text not null,
 size text not null, color text not null, photo text, eta text,
 quantity integer not null check(quantity between 1 and 200), unit_price numeric(12,2) check(unit_price>=0),
 status text not null check(status in('processing','shipped','delivered','exception','unpaid','unknown')),
 present boolean not null default true, updated_at timestamptz not null default now()
);
create index shein_order_items_order_idx on public.shein_order_items(order_ref);
create index shein_order_items_sku_idx on public.shein_order_items(lower(sku)) where present;
create table public.shein_order_links (
 line_id text primary key references public.sales_lines(id), item_id text not null references public.shein_order_items(id),
 origin text not null check(origin in('auto','manual')), before_state jsonb not null, managed_state jsonb not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index shein_order_links_item_idx on public.shein_order_links(item_id);
create table public.shein_order_exclusions (
 item_id text not null references public.shein_order_items(id), line_id text not null references public.sales_lines(id),
 primary key(item_id,line_id)
);
create index shein_order_exclusions_line_idx on public.shein_order_exclusions(line_id);
create table public.shein_sync_state (
 id boolean primary key default true check(id), last_completed_at timestamptz, orders_read integer not null default 0,
 linked_count integer not null default 0
);
insert into public.shein_sync_state(id) values(true);
alter table public.shein_orders enable row level security;
alter table public.shein_order_items enable row level security;
alter table public.shein_order_links enable row level security;
alter table public.shein_order_exclusions enable row level security;
alter table public.shein_sync_state enable row level security;
revoke all on public.shein_orders,public.shein_order_items,public.shein_order_links,public.shein_order_exclusions,public.shein_sync_state from anon,authenticated;
grant all on public.shein_orders,public.shein_order_items,public.shein_order_links,public.shein_order_exclusions,public.shein_sync_state to service_role;

create function app_private.shein_norm(p text) returns text language sql immutable set search_path='' as $$
 select lower(regexp_replace(translate(coalesce(p,''),'éèêëàâäîïôöùûüç','eeeeaaaiioouuuc'),'\s+','','g'))
$$;
create function app_private.shein_size(p text) returns text language sql immutable set search_path='' as $$
 select app_private.shein_norm(case when p ~ '^\s*[0-9]+\s*\([A-Za-z0-9]+\)\s*$' then substring(p from '\(([A-Za-z0-9]+)\)') else p end)
$$;
create function app_private.shein_line_state(p public.sales_lines) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('stage',p.stage,'supplier_order_ref',p.supplier_order_ref,'supplier_size',p.supplier_size,
 'supplier_color',p.supplier_color,'actual_cost',p.actual_cost,'ordered_at',p.ordered_at)
$$;
-- Every operation serializes allocation, then locks parent orders before sale lines,
-- matching the existing Dotb/manual-edit lock order.
create function app_private.shein_lock_sales() returns void language plpgsql set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('stock-vinted-shein-orders',0));
 perform 1 from public.sales_orders o where exists(select 1 from public.workspace_sales w where w.order_id=o.id) order by o.id for update;
 perform 1 from public.sales_lines l where exists(select 1 from public.workspace_sales w where w.id=l.id) order by l.id for update;
end $$;

create function public.import_shein_order(p_order jsonb,p_device uuid) returns void language plpgsql security invoker set search_path='' as $$
declare row jsonb; v_ref text:=p_order->>'ref'; old_at timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock-vinted-shein-orders',0));
 if not exists(select 1 from public.catalog_collectors where id=p_device and enabled and revoked_at is null and expires_at>now()) then raise exception 'device_revoked';end if;
 if (p_order->>'order_date')::date < (select (starts_at at time zone time_zone)::date from public.dotb_tracking_period limit 1) then raise exception 'order_outside_period';end if;
 select observed_at into old_at from public.shein_orders where shein_orders.ref=v_ref;
 if old_at >= (p_order->>'observed_at')::timestamptz then return;end if;
 insert into public.shein_orders(ref,order_date,observed_at,collector_id)
 values(v_ref,(p_order->>'order_date')::date,(p_order->>'observed_at')::timestamptz,p_device)
 on conflict (ref) do update set order_date=excluded.order_date,observed_at=excluded.observed_at,collector_id=excluded.collector_id,updated_at=clock_timestamp();
 update public.shein_order_items set present=false where order_ref=v_ref;
 for row in select value from jsonb_array_elements(p_order->'items') loop
  insert into public.shein_order_items(id,order_ref,sku,supplier_id,product_url,title,size,color,photo,eta,quantity,unit_price,status)
  values(row->>'id',v_ref,row->>'sku',row->>'supplier_id',row->>'product_url',row->>'title',row->>'size',row->>'color',row->>'photo',row->>'eta',(row->>'quantity')::int,(row->>'unit_price')::numeric,row->>'status')
  on conflict(id) do update set quantity=excluded.quantity,unit_price=excluded.unit_price,status=excluded.status,photo=excluded.photo,
   eta=excluded.eta,title=excluded.title,present=true,updated_at=clock_timestamp();
 end loop;
end $$;

create function app_private.shein_attach(p_item text,p_line text,p_origin text,p_user uuid) returns void language plpgsql set search_path='' as $$
declare i public.shein_order_items; l public.sales_lines; before_value jsonb; new_stage text;
begin
 select * into i from public.shein_order_items where id=p_item;
 select * into l from public.sales_lines where id=p_line;
 if i.id is null or l.id is null or not i.present or i.status not in('processing','shipped','delivered') then raise exception 'shein_item_unavailable';end if;
 if exists(select 1 from public.shein_order_links where line_id=p_line) then raise exception 'shein_already_linked';end if;
 if (select count(*) from public.shein_order_links where item_id=p_item)>=i.quantity then raise exception 'shein_quantity_used';end if;
 if not exists(select 1 from public.workspace_sales w where w.id=p_line and not w.is_blocked and w.effective_stage in('to_order','ordered','in_transit')
   and lower(w.resolved_sku)=lower(i.sku)) then raise exception 'shein_sale_mismatch';end if;
 if nullif(l.supplier_order_ref,'') is not null and l.supplier_order_ref<>i.order_ref then raise exception 'shein_already_ordered';end if;
 before_value:=app_private.shein_line_state(l);
 new_stage:=case when l.stage='in_transit' or i.status in('shipped','delivered') then 'in_transit' else 'ordered' end;
 update public.sales_lines set stage=new_stage,supplier_order_ref=i.order_ref,supplier_size=i.size,supplier_color=i.color,
  actual_cost=coalesce(actual_cost,i.unit_price),ordered_at=coalesce(ordered_at,now()),updated_at=clock_timestamp(),updated_by=p_user where id=p_line;
 select * into l from public.sales_lines where id=p_line;
 insert into public.shein_order_links(line_id,item_id,origin,before_state,managed_state) values(p_line,p_item,p_origin,before_value,app_private.shein_line_state(l));
end $$;

create function public.reconcile_shein_orders(p_user uuid default null) returns integer language plpgsql security invoker set search_path='' as $$
declare r record; candidates text[]; line text; n integer:=0; l public.sales_lines;
begin
 perform app_private.shein_lock_sales();
 -- Exact SKU + size + color, known paid status, no competing order or manual exclusion.
 for r in select i.*,o.order_date from public.shein_order_items i join public.shein_orders o on o.ref=i.order_ref
  where i.present and i.status in('processing','shipped','delivered') and i.size<>'' and i.color<>'' order by o.order_date,i.id loop
  select array_agg(w.id order by w.sale_date,w.id) into candidates from public.workspace_sales w
  left join public.sales_supplier_details c on c.sku=w.resolved_sku
  where not w.is_blocked and w.effective_stage in('to_order','ordered','in_transit')
   and lower(w.resolved_sku)=lower(r.sku) and app_private.shein_size(w.supplier_size)=app_private.shein_size(r.size)
   and app_private.shein_norm(coalesce(nullif(w.supplier_color,''),c.color))=app_private.shein_norm(r.color)
   and w.sale_date::date<=r.order_date
   and (nullif(w.supplier_order_ref,'') is null or w.supplier_order_ref=r.order_ref)
   and not exists(select 1 from public.shein_order_links a where a.line_id=w.id)
   and not exists(select 1 from public.shein_order_exclusions e where e.line_id=w.id and e.item_id=r.id)
   and not exists(select 1 from public.shein_order_items other where other.id<>r.id and other.present and other.status in('processing','shipped','delivered')
    and lower(other.sku)=lower(r.sku) and app_private.shein_size(other.size)=app_private.shein_size(r.size)
    and app_private.shein_norm(other.color)=app_private.shein_norm(r.color)
    and (nullif(w.supplier_order_ref,'') is null or other.order_ref=w.supplier_order_ref)
    and other.quantity>(select count(*) from public.shein_order_links x where x.item_id=other.id));
  if cardinality(candidates)>0 and cardinality(candidates)<=(r.quantity-(select count(*) from public.shein_order_links where item_id=r.id)) then
   foreach line in array candidates loop perform app_private.shein_attach(r.id,line,'auto',p_user);n:=n+1;end loop;
  end if;
 end loop;
 -- Progress only when the entire identical-variant group is shipped; delivery still needs a physical receipt confirmation.
 for r in select a.*,i.status,i.present,i.quantity,i.sku,i.order_ref from public.shein_order_links a join public.shein_order_items i on i.id=a.item_id loop
  select * into l from public.sales_lines where id=r.line_id;
  if r.present and r.status in('shipped','delivered') and l.stage='ordered' and l.supplier_order_ref=r.order_ref
   and lower(coalesce(l.sku_override,l.source->>'sku'))=lower(r.sku)
   and exists(select 1 from public.workspace_sales w where w.id=l.id and not w.is_blocked and w.effective_stage='ordered')
   and r.quantity>=(select count(*) from public.shein_order_links where item_id=r.item_id) then
   update public.sales_lines set stage='in_transit',updated_at=clock_timestamp(),updated_by=p_user where id=l.id;
   select * into l from public.sales_lines where id=r.line_id;
   update public.shein_order_links set managed_state=jsonb_set(managed_state,'{stage}','"in_transit"'::jsonb),updated_at=clock_timestamp() where line_id=l.id;
  end if;
 end loop;
 return n;
end $$;

create function public.finish_shein_sync(p_device uuid,p_count integer) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; owner uuid;
begin
 select created_by into owner from public.catalog_collectors where id=p_device and enabled and revoked_at is null and expires_at>now();
 if owner is null then raise exception 'device_revoked';end if;
 n:=public.reconcile_shein_orders(owner);
 update public.shein_sync_state set last_completed_at=now(),orders_read=p_count,linked_count=n where id;
 return n;
end $$;

create function public.review_shein_order(p_operation text,p_item text,p_line text,p_version timestamptz,p_user uuid) returns void language plpgsql security invoker set search_path='' as $$
declare l public.sales_lines; a public.shein_order_links; b jsonb;
begin
 perform app_private.shein_lock_sales();
 select * into l from public.sales_lines where id=p_line for update;
 if l.id is null then raise exception 'line_not_found';end if;
 if l.updated_at is distinct from p_version then raise exception 'stale_version';end if;
 select * into a from public.shein_order_links where line_id=p_line and item_id=p_item;
 if p_operation='link' then
  perform app_private.shein_attach(p_item,p_line,'manual',p_user);
 elsif p_operation='unlink' then
  if a.line_id is null then raise exception 'shein_link_missing';end if;
  if app_private.shein_line_state(l) is distinct from a.managed_state then raise exception 'shein_link_changed';end if;
  b:=a.before_state;
  update public.sales_lines set stage=b->>'stage',supplier_order_ref=b->>'supplier_order_ref',supplier_size=b->>'supplier_size',supplier_color=b->>'supplier_color',
   actual_cost=(b->>'actual_cost')::numeric,ordered_at=(b->>'ordered_at')::timestamptz,updated_at=clock_timestamp(),updated_by=p_user where id=p_line;
  insert into public.shein_order_exclusions(item_id,line_id) values(p_item,p_line) on conflict do nothing;
  delete from public.shein_order_links where line_id=p_line;
 elsif p_operation='confirm_received' then
  if a.line_id is null or not exists(select 1 from public.shein_order_items where id=p_item and present and status='delivered') then raise exception 'shein_item_unavailable';end if;
  perform public.save_sales_line(p_line,p_version,null,null,'received',p_user);
 else raise exception 'invalid_transition';end if;
end $$;

create function public.shein_sale_choices(p_skus text[]) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',w.id,'title',w.source->>'title','sku',w.resolved_sku,'size',w.supplier_size,'color',w.supplier_color,
 'stage',w.effective_stage,'blocked',w.is_blocked,'updated_at',w.updated_at,'account',w.account_login,'sale_date',w.sale_date,'item_id',a.item_id) order by w.sale_date desc,w.id),'[]'::jsonb)
 from public.workspace_sales w left join public.shein_order_links a on a.line_id=w.id
 where lower(w.resolved_sku)=any(p_skus) or a.item_id in(select id from public.shein_order_items where lower(sku)=any(p_skus))
$$;
revoke all on function app_private.shein_norm(text),app_private.shein_size(text),app_private.shein_line_state(public.sales_lines),app_private.shein_lock_sales(),app_private.shein_attach(text,text,text,uuid) from public,anon,authenticated;
grant usage on schema app_private to service_role;
grant execute on function app_private.shein_norm(text),app_private.shein_size(text),app_private.shein_line_state(public.sales_lines),app_private.shein_lock_sales(),app_private.shein_attach(text,text,text,uuid) to service_role;
revoke all on function public.import_shein_order(jsonb,uuid),public.reconcile_shein_orders(uuid),public.finish_shein_sync(uuid,integer),public.review_shein_order(text,text,text,timestamptz,uuid),public.shein_sale_choices(text[]) from public,anon,authenticated;
grant execute on function public.import_shein_order(jsonb,uuid),public.reconcile_shein_orders(uuid),public.finish_shein_sync(uuid,integer),public.review_shein_order(text,text,text,timestamptz,uuid),public.shein_sale_choices(text[]) to service_role;
commit;
