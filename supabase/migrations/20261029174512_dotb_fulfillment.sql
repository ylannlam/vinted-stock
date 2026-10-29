-- New module only. Does not modify or delete existing stock/accounts.
begin;
create table public.sales_orders (
  id uuid primary key, account_id text, account_login text, transaction_id text,
  status text, currency text, order_date timestamptz, deadline timestamptz,
  label_url text, tracking_code text, synced_at timestamptz not null default now()
);
create table public.sales_lines (
  id text primary key, order_id uuid not null references public.sales_orders(id), dotb_item_id uuid not null,
  source jsonb not null default '{}', source_active boolean not null default true,
  stage text not null default 'to_order' check (stage in ('to_order','ordered','in_transit','received','prepared','shipped')),
  sku_override text, supplier_order_ref text, supplier_tracking text, location text, notes text,
  actual_cost numeric(12,2) check (actual_cost >= 0),
  ordered_at timestamptz, received_at timestamptz, shipped_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(), updated_by uuid references auth.users(id),
  unique(order_id, dotb_item_id)
);
create index sales_lines_order on public.sales_lines(order_id);
create index sales_lines_stage on public.sales_lines(stage) where source_active;
create index sales_orders_date on public.sales_orders(order_date desc);
create table public.sales_catalog (
  sku text primary key check (length(sku) between 1 and 200),
  supplier_url text not null, variant text,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.dotb_sync_state (
  id boolean primary key default true check (id), cursor text, processed integer not null default 0,
  last_completed_at timestamptz, locked_until timestamptz not null default '-infinity',
  lease uuid, next_allowed_at timestamptz not null default '-infinity'
);
insert into public.dotb_sync_state(id) values (true);
alter table public.sales_orders enable row level security;
alter table public.sales_lines enable row level security;
alter table public.sales_catalog enable row level security;
alter table public.dotb_sync_state enable row level security;
-- Browser clients cannot import orders, change stages or invoke service functions.
revoke all on public.sales_orders, public.sales_lines, public.sales_catalog, public.dotb_sync_state from public, anon, authenticated;
grant select on public.sales_orders, public.sales_lines, public.sales_catalog to authenticated;
grant all on public.sales_orders, public.sales_lines, public.sales_catalog, public.dotb_sync_state to service_role;
create policy sales_orders_read on public.sales_orders for select to authenticated
  using (exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','stock')));
create policy sales_lines_read on public.sales_lines for select to authenticated
  using (exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','stock')));
create policy sales_catalog_read on public.sales_catalog for select to authenticated
  using (exists(select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('admin','stock')));

-- A page and its continuation cursor commit together, or not at all.
create function public.import_dotb_page(p_orders jsonb, p_lines jsonb, p_cursor text, p_lease uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.dotb_sync_state where id and lease = p_lease and locked_until > now() for update;
  if not found then raise exception 'sync_lease_expired'; end if;
  insert into public.sales_orders
    select * from jsonb_populate_recordset(null::public.sales_orders, p_orders)
    on conflict (id) do update set account_id=excluded.account_id, account_login=excluded.account_login,
      transaction_id=excluded.transaction_id, status=excluded.status, currency=excluded.currency,
      order_date=excluded.order_date, deadline=excluded.deadline, label_url=excluded.label_url,
      tracking_code=excluded.tracking_code, synced_at=excluded.synced_at;
  update public.sales_lines set source_active = false
    where order_id in (select (value->>'id')::uuid from jsonb_array_elements(p_orders));
  insert into public.sales_lines(id,order_id,dotb_item_id,source)
    select x.id,x.order_id,x.dotb_item_id,x.source
    from jsonb_to_recordset(p_lines) as x(id text,order_id uuid,dotb_item_id uuid,source jsonb)
    on conflict(id) do update set source=excluded.source, source_active=true;
  update public.dotb_sync_state set cursor=p_cursor,
    processed=processed+jsonb_array_length(p_orders),
    last_completed_at=case when p_cursor is null then now() else last_completed_at end,
    locked_until='-infinity', lease=null, next_allowed_at=now()+interval '1.2 seconds' where id;
end; $$;

-- Serializes local edits and checks the version shown to the operator.
create function public.save_sales_line(p_id text, p_version timestamptz, p_edit jsonb, p_product jsonb, p_stage text, p_user uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare l public.sales_lines; o public.sales_orders; target text; current_sku text; supplier text;
begin
  -- Lock the parent first, as imports do; serialize changes within a bundle.
  select * into o from public.sales_orders where id=(select order_id from public.sales_lines where id=p_id) for update;
  if not found then raise exception 'line_not_found'; end if;
  select * into l from public.sales_lines where id=p_id for update;
  if not found then raise exception 'line_not_found'; end if;
  if l.updated_at <> p_version then raise exception 'stale_version'; end if;
  if p_stage is not null then
    if not l.source_active or o.status is null or o.status in ('cancelled','returning','suspended','shipped','ready_for_pickup','delivered','completed') then raise exception 'order_blocked'; end if;
    target := case l.stage when 'to_order' then 'ordered' when 'ordered' then 'in_transit' when 'in_transit' then 'received' when 'received' then 'prepared' when 'prepared' then 'shipped' end;
    if p_stage is distinct from target then raise exception 'invalid_transition'; end if;
    current_sku := coalesce(l.sku_override, l.source->>'sku');
    select supplier_url into supplier from public.sales_catalog where sku=current_sku;
    supplier := coalesce(supplier,l.source->>'supplier_link');
    if p_stage='ordered' and (coalesce(trim(current_sku),'')='' or coalesce(supplier,'')='' or coalesce(trim(l.supplier_order_ref),'')='') then raise exception 'purchase_details_required'; end if;
    -- Bundles must be prepared completely before any line is marked deposited.
    if p_stage='shipped' and exists(select 1 from public.sales_lines where order_id=l.order_id and source_active and stage not in ('prepared','shipped')) then raise exception 'bundle_not_ready'; end if;
    update public.sales_lines set stage=p_stage,
      ordered_at=case when p_stage='ordered' then now() else ordered_at end,
      received_at=case when p_stage='received' then now() else received_at end,
      shipped_at=case when p_stage='shipped' then now() else shipped_at end,
      updated_at=clock_timestamp(), updated_by=p_user where id=p_id;
  else
    if p_product is not null then
      insert into public.sales_catalog(sku,supplier_url,variant)
        values(p_product->>'sku',p_product->>'supplier_url',p_product->>'variant')
        on conflict(sku) do update set supplier_url=excluded.supplier_url,variant=excluded.variant,updated_at=clock_timestamp();
    end if;
    update public.sales_lines set sku_override=p_edit->>'sku_override', supplier_order_ref=p_edit->>'supplier_order_ref',
      supplier_tracking=p_edit->>'supplier_tracking', location=p_edit->>'location', notes=p_edit->>'notes',
      actual_cost=(p_edit->>'actual_cost')::numeric, updated_at=clock_timestamp(), updated_by=p_user where id=p_id;
  end if;
end; $$;
revoke all on function public.import_dotb_page(jsonb,jsonb,text,uuid) from public, anon, authenticated;
revoke all on function public.save_sales_line(text,timestamptz,jsonb,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.import_dotb_page(jsonb,jsonb,text,uuid) to service_role;
grant execute on function public.save_sales_line(text,timestamptz,jsonb,jsonb,text,uuid) to service_role;
commit;
