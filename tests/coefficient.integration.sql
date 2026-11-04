begin;
set local role service_role;
do $$
declare result jsonb; t jsonb; leader jsonb;
begin
 result:=public.workspace_finance('2099-12',0);
 select value into t from jsonb_array_elements(result->'totals') where value->>'currency'='EUR';
 -- (40 + 30 - 7 + 0) / (10 + 30 + 8 + 6): returns, missing and zero costs excluded.
 if (t->>'coef_revenue')::numeric is distinct from 63 or (t->>'coef_cost')::numeric is distinct from 54 or (t->>'coef_count')::int is distinct from 4 then raise exception 'EUR weighted coefficient incorrect'; end if;
 if (t->>'quantity')::int is distinct from 8 or (t->>'returns')::int is distinct from 1 or (t->>'missing_revenue')::int is distinct from 1 then raise exception 'existing coverage changed'; end if;
 if (t->>'confirmed_margin')::numeric is distinct from 30 or (t->>'purchase_cost')::numeric is distinct from 108 then raise exception 'existing financial amounts changed'; end if;
 select value into leader from jsonb_array_elements(result->'leaders') where value->>'sku'='SKU-A' and value->>'currency'='EUR';
 if (leader->>'coef_revenue')::numeric is distinct from 70 or (leader->>'coef_cost')::numeric is distinct from 40 or (leader->>'coef_count')::int is distinct from 2 then raise exception 'product weighting or exclusion incorrect'; end if;
 select value into leader from jsonb_array_elements(result->'leaders') where value->>'sku'='SKU-B';
 if (leader->>'coef_revenue')::numeric is distinct from -7 then raise exception 'negative net lost'; end if;
 select value into leader from jsonb_array_elements(result->'leaders') where value->>'sku'='SKU-ZERO';
 if (leader->>'coef_revenue')::numeric is distinct from 0 or (leader->>'coef_count')::int is distinct from 1 then raise exception 'zero coefficient lost'; end if;
 select value into t from jsonb_array_elements(result->'totals') where value->>'currency'='USD';
 if (t->>'coef_revenue')::numeric is distinct from 100 or (t->>'coef_cost')::numeric is distinct from 10 then raise exception 'currencies mixed'; end if;
 result:=public.workspace_finance('2099-11',0);
 if jsonb_array_length(result->'totals')<>0 then raise exception 'Paris month boundary incorrect'; end if;
 result:=public.workspace_finance('',0);
 select value into t from jsonb_array_elements(result->'totals') where value->>'currency'='EUR';
 if (t->>'coef_revenue')::numeric is distinct from 75 or (t->>'coef_cost')::numeric is distinct from 58 or (t->>'coef_count')::int is distinct from 5 then raise exception 'all periods coefficient incorrect'; end if;
 result:=public.workspace_finance('2099-12',1);
 if jsonb_array_length(result->'rows')<>0 then raise exception 'pagination changed'; end if;
 if has_function_privilege('anon','public.workspace_finance(text,int)','execute') or has_function_privilege('authenticated','public.workspace_finance(text,int)','execute') then raise exception 'finance function exposed'; end if;
end $$;
rollback;
