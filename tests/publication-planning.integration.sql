-- Planning sur plusieurs jours : l'heure choisie est gardée, sauf si elle touche une annonce du même
-- compte (écart du compte) ou le même SKU (30 minutes, tous comptes). Tout est annulé à la fin.
begin;
set local role service_role;
do $$
declare member uuid; a text:=gen_random_uuid()::text; b text:=gen_random_uuid()::text; sku text:='SZ'||substr(md5(random()::text),1,12);
  d1 uuid:=gen_random_uuid(); d2 uuid:=gen_random_uuid(); d3 uuid:=gen_random_uuid(); d4 uuid:=gen_random_uuid(); d5 uuid:=gen_random_uuid();
  target timestamptz:=date_trunc('minute',now())+interval '2 days'; slot timestamptz; note text;
begin
 select id into member from public.profiles limit 1;
 insert into public.listing_drafts(id,owner_id,fields) values
  (d1,member,jsonb_build_object('account_id',a,'sku',sku)),(d2,member,jsonb_build_object('account_id',a,'sku','AUTRE'||sku)),
  (d3,member,jsonb_build_object('account_id',b,'sku',lower(sku))),(d4,member,jsonb_build_object('account_id',b,'sku','X'||sku)),
  (d5,member,jsonb_build_object('account_id',a,'sku','Y'||sku));
 select planned_at,message into slot,note from public.reserve_listing_slot(d1,member,1,'{}',35,target);
 assert slot=target,'The chosen time is kept when nothing is close';
 assert note like 'Programmée pour le%','The planned time is shown';
 -- Même compte, 10 minutes après : glisse à l'écart du compte (35 min après la première).
 select planned_at,message into slot,note from public.reserve_listing_slot(d2,member,1,'{}',35,target+interval '10 minutes');
 assert slot=target+interval '35 minutes','Account spacing is respected around the chosen time';
 assert note like '%décalée%','The shift is explained';
 -- Même SKU sur un autre compte, 5 minutes après : 30 minutes après le premier.
 select planned_at into slot from public.reserve_listing_slot(d3,member,1,'{}',35,target+interval '5 minutes');
 assert slot=target+interval '30 minutes','Same SKU waits 30 minutes, whatever the account';
 -- Autre SKU, autre compte, même heure que la première : gardée.
 select planned_at into slot from public.reserve_listing_slot(d4,member,1,'{}',35,target+interval '2 hours');
 assert slot=target+interval '2 hours','An unrelated listing keeps its time';
 -- Une annonce plus tôt dans la journée ne pousse pas après la dernière du compte (pas de « max »).
 select planned_at into slot from public.reserve_listing_slot(d5,member,1,'{}',35,target-interval '3 hours');
 assert slot=target-interval '3 hours','An earlier free slot stays free';
 begin
  perform public.reserve_listing_slot(gen_random_uuid(),member,1,'{}',35,now()+interval '40 days');
  raise exception 'expected failure';
 exception when others then assert sqlerrm='Invalid publication date','Too far in the future is refused';
 end;
end $$;
rollback;
