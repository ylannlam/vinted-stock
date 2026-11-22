create table public.scalency_sale_costs (
  order_id text not null,
  line_id text not null,
  actual_cost numeric(12,2) check(actual_cost >= 0),
  notes text not null default '',
  primary key(order_id,line_id)
);
alter table public.scalency_sale_costs enable row level security;
revoke all on public.scalency_sale_costs from public,anon,authenticated;
grant all on public.scalency_sale_costs to service_role;
