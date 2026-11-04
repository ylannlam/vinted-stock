begin;
do $$ declare u uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) values(u,u||'@team-board-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(u,u||'@team-board-test.invalid','Alicia test','admin');
 perform set_config('test.board_user',u::text,true);
 if has_function_privilege('authenticated','public.team_board_counts(date)','execute') or has_function_privilege('anon','public.team_board_counts(date)','execute') then raise exception 'board counts exposed';end if;
end $$;
set local role service_role;
do $$
declare u uuid:=current_setting('test.board_user')::uuid;a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();day date:='2099-06-15';
 today timestamptz:='2099-06-15 10:00:00 Europe/Paris';result jsonb;s jsonb;
begin
 insert into public.publication_accounts(id,login) values(a,'test-board-a-'||a),(b,'test-board-b-'||b);
 insert into public.publication_items(account_id,item_id,title,url,status,estimated_at,published) values
  (a,'900100','Vue par un relevé et collée à la main','https://www.vinted.fr/items/900100','active',today-interval '2 hours',true),
  (a,'900101','Hier','https://www.vinted.fr/items/900101','active',today-interval '1 day',true),
  (a,'900102','Il y a 10 jours','https://www.vinted.fr/items/900102','active',today-interval '10 days',true),
  (a,'900103','Pas une publication','https://www.vinted.fr/items/900103','active',today,false),
  (a,'900104','Juste avant minuit à Paris la veille','https://www.vinted.fr/items/900104','active','2099-06-14 23:30:00 Europe/Paris',true);
 insert into public.listing_drafts(id,owner_id,state,fields,vinted_id,published_at) values
  (gen_random_uuid(),u,'published',jsonb_build_object('account_id',a,'title','Même annonce que le relevé'),'900100',today),
  (gen_random_uuid(),u,'published',jsonb_build_object('account_id',a,'title','Collée à la main'),'900200',today+interval '1 hour'),
  (gen_random_uuid(),u,'draft',jsonb_build_object('account_id',a,'title','En cours'),null,null),
  (gen_random_uuid(),u,'draft',jsonb_build_object('account_id',b,'title','En cours B'),null,null),
  (gen_random_uuid(),u,'published',jsonb_build_object('account_id','pas-un-uuid','title','Ignorée'),'900300',today);
 result:=public.team_board_counts(day);
 select value into s from jsonb_array_elements(result->'stats') where value->>'account_id'=a::text;
 -- today: 900100 (once, though seen twice) + 900200; week adds 900101 and 900104; 900102 is too old; 900103 is not published.
 if (s->>'today')::int is distinct from 2 then raise exception 'today count %',s->>'today';end if;
 if (s->>'week')::int is distinct from 4 then raise exception 'week count %',s->>'week';end if;
 if (s->>'last_at')::timestamptz is distinct from today+interval '1 hour' then raise exception 'last publication %',s->>'last_at';end if;
 if exists(select 1 from jsonb_array_elements(result->'stats') where value->>'account_id'=b::text) then raise exception 'account without publication counted';end if;
 if (select (value->>'drafts')::int from jsonb_array_elements(result->'drafts') where value->>'account_id'=a::text) is distinct from 1
  or (select (value->>'drafts')::int from jsonb_array_elements(result->'drafts') where value->>'account_id'=b::text) is distinct from 1 then raise exception 'drafts in progress incorrect';end if;
 if (select jsonb_array_length(value->'items') from jsonb_array_elements(result->'recent') where value->>'account_id'=a::text) is distinct from 2
  or (select value#>>'{items,0,vinted_id}' from jsonb_array_elements(result->'recent') where value->>'account_id'=a::text) is distinct from '900200' then raise exception 'recent manual publications incorrect';end if;
 -- The database, not just the preflight request, rejects a duplicate item.
 begin
  insert into public.listing_drafts(id,owner_id,state,fields,vinted_id,published_at)
   values(gen_random_uuid(),u,'published',jsonb_build_object('account_id',b),'900200',today);
  raise exception 'duplicate Vinted id was accepted';
 exception when unique_violation then null;
 end;
 -- The list of recent manual publications is bounded without reducing totals.
 insert into public.listing_drafts(id,owner_id,state,fields,vinted_id,published_at)
  select gen_random_uuid(),u,'published',jsonb_build_object('account_id',b),('901000'::int+n)::text,today-interval '1 minute'*n from generate_series(1,7)n;
 result:=public.team_board_counts(day);
 if (select jsonb_array_length(value->'items') from jsonb_array_elements(result->'recent') where value->>'account_id'=b::text) is distinct from 5 then raise exception 'recent list limit incorrect';end if;
 if (select (value->>'today')::int from jsonb_array_elements(result->'stats') where value->>'account_id'=b::text) is distinct from 7 then raise exception 'recent list truncated the counters';end if;
end $$;
rollback;
