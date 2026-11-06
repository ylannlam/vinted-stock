begin;
do $$ begin
 if has_function_privilege('authenticated','public.listing_title_examples(text)','execute') or has_function_privilege('anon','public.listing_title_examples(text)','execute') then raise exception 'title examples exposed';end if;
 if has_table_privilege('authenticated','public.listing_settings','select') or has_table_privilege('anon','public.listing_settings','select') then raise exception 'listing settings exposed';end if;
end $$;
set local role service_role;
do $$
declare a text:='aaaaaaaa-0000-4000-8000-'||substr(md5(random()::text),1,12);b text:='bbbbbbbb-0000-4000-8000-'||substr(md5(random()::text),1,12);
 o1 uuid:=gen_random_uuid();o2 uuid:=gen_random_uuid();o3 uuid:=gen_random_uuid();o4 uuid:=gen_random_uuid();result jsonb;
begin
 insert into public.sales_orders(id,account_id,account_login,status,order_date) values
  (o1,upper(a),'compte-a','completed',now()-interval '1 day'),
  (o2,a,'compte-a','completed',now()-interval '2 hours'),
  (o3,b,'compte-b','completed',now()-interval '3 hours'),
  (o4,a,'compte-a','completed',now()-interval '200 days');
 insert into public.sales_lines(id,order_id,dotb_item_id,source) values
  ('t-1',o1,gen_random_uuid(),jsonb_build_object('title','Robe longue noire tulle bustier cœur drapé princesse taille S')),
  ('t-2',o2,gen_random_uuid(),jsonb_build_object('title','Robe longue noire tulle bustier cœur drapé princesse taille S')),
  ('t-3',o2,gen_random_uuid(),jsonb_build_object('title','Body noir effet cuir vinyle décolleté V plongeant Y2K taille M')),
  ('t-4',o2,gen_random_uuid(),jsonb_build_object('title','Trop court')),
  ('t-5',o3,gen_random_uuid(),jsonb_build_object('title','Combinaison léopard marron col montant zippée manches longues taille S')),
  ('t-6',o4,gen_random_uuid(),jsonb_build_object('title','Ancienne vente de plus de quatre mois taille M')),
  ('t-7',o1,gen_random_uuid(),jsonb_build_object('title','Jupe midi satinée verte fendue élégante soirée taille S'));
 result:=public.listing_title_examples(a);
 -- Same title sold twice counts once, account ids match whatever their case; short and old titles are ignored.
 if jsonb_array_length(result->'own') is distinct from 3 or not (result->'own') @> '["Robe longue noire tulle bustier cœur drapé princesse taille S","Body noir effet cuir vinyle décolleté V plongeant Y2K taille M","Jupe midi satinée verte fendue élégante soirée taille S"]'::jsonb then raise exception 'own examples %',result->'own';end if;
 if result->'own'->>0 is not distinct from 'Jupe midi satinée verte fendue élégante soirée taille S' then raise exception 'examples are not most recent first';end if;
 if not (result->'others') @> '["Combinaison léopard marron col montant zippée manches longues taille S"]'::jsonb or (result->'others') @> '["Body noir effet cuir vinyle décolleté V plongeant Y2K taille M"]'::jsonb then raise exception 'other examples %',result->'others';end if;
 if jsonb_array_length(public.listing_title_examples('cccccccc-0000-4000-8000-000000000000')->'own')<>0 then raise exception 'unknown account has examples';end if;
 -- Settings: only « default » or an account id; the content must be an object.
 insert into public.listing_settings(scope,settings) values(a,'{"dotb":true}');
 begin insert into public.listing_settings(scope,settings) values('pas-un-compte','{}');raise exception 'invalid scope accepted';exception when check_violation then null;end;
 begin insert into public.listing_settings(scope,settings) values(b,'[]');raise exception 'array settings accepted';exception when check_violation then null;end;
end $$;
do $$
declare member uuid; a text:=gen_random_uuid()::text; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); first_slot timestamptz; second_slot timestamptz;
begin
 if has_function_privilege('authenticated','public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer,timestamptz)','execute') then raise exception 'reservation exposed';end if;
 select id into member from public.profiles limit 1;
 if member is null then raise exception 'seed one test profile before running';end if;
 insert into public.listing_drafts(id,owner_id,fields) values(first_id,member,jsonb_build_object('account_id',a)),(second_id,member,jsonb_build_object('account_id',a));
 select planned_at into first_slot from public.reserve_listing_slot(first_id,member,1,'{}',30);
 -- Published reservations still preserve the gap, including between two successive batches.
 update public.listing_drafts set state='published',published_at=first_slot where id=first_id;
 select planned_at into second_slot from public.reserve_listing_slot(second_id,member,1,'{}',30);
 if first_slot is null or second_slot<>first_slot+interval '30 minutes' then raise exception 'slots overlap';end if;
 -- A finished Vinted draft also reserves its slot for the following article.
 update public.listing_drafts set state='vinted_draft',dotb_publish=false where id=second_id;
 insert into public.listing_drafts(id,owner_id,fields) values(gen_random_uuid(),member,jsonb_build_object('account_id',a)) returning id into second_id;
 select planned_at into first_slot from public.reserve_listing_slot(second_id,member,1,'{}',30);
 if first_slot<>second_slot+interval '30 minutes' then raise exception 'Vinted draft spacing ignored';end if;
 if exists(select 1 from public.reserve_listing_slot(second_id,member,1,'{}',30)) then raise exception 'stale version accepted';end if;
 if exists(select 1 from public.reserve_listing_slot(second_id,gen_random_uuid(),2,'{}',30)) then raise exception 'wrong owner accepted';end if;
end $$;
do $$
declare member uuid; a uuid:=gen_random_uuid(); result jsonb;
begin
 select id into member from public.profiles limit 1;
 insert into public.publication_accounts(id,login) values(a,'test-dotb-draft-'||a);
 -- A Vinted draft created by Dotb, published by hand afterwards, counts once; a live Dotb listing still relies on the readings.
 insert into public.listing_drafts(id,owner_id,state,fields,vinted_id,published_at,dotb_item_id,dotb_publish) values
  (gen_random_uuid(),member,'published',jsonb_build_object('account_id',a,'title','Brouillon publié'),'990001',now(),gen_random_uuid(),false),
  (gen_random_uuid(),member,'vinted_draft',jsonb_build_object('account_id',a,'title','Encore en brouillon'),'990002',null,gen_random_uuid(),false);
 result:=public.team_board_counts((now() at time zone 'Europe/Paris')::date);
 if (select (value->>'today')::int from jsonb_array_elements(result->'stats') where value->>'account_id'=a::text) is distinct from 1 then raise exception 'Vinted draft counts %',result->'stats';end if;
end $$;
rollback;
