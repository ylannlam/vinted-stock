-- Archive accounts separately without changing credentials or preparation history.
alter table public.vinted_accounts
  add column if not exists is_shadowbanned boolean not null default false;

comment on column public.vinted_accounts.is_shadowbanned is
  'Manually archived shadowbanned account; excluded from usable accounts and preparation actions.';
