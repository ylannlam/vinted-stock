alter table public.vinted_accounts
  drop constraint if exists vinted_accounts_telephone_type_check,
  add constraint vinted_accounts_telephone_type_check
    check (telephone_type in ('lyca', 'onoff', 'autre'));
