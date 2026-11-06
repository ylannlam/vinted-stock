-- Même SKU sur deux comptes : 30 minutes d'écart au minimum. Tout est annulé à la fin.
begin;
set local role service_role;
do $$
declare member uuid; a text:=gen_random_uuid()::text; b text:=gen_random_uuid()::text; sku text:='SZ'||substr(md5(random()::text),1,12);
  first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); third_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid();
  first_slot timestamptz; second_slot timestamptz; third_slot timestamptz; other_slot timestamptz; note text;
begin
 select id into member from public.profiles limit 1;
 insert into public.listing_drafts(id,owner_id,fields) values
  (first_id,member,jsonb_build_object('account_id',a,'sku',sku)),(second_id,member,jsonb_build_object('account_id',b,'sku',lower(sku)||' ')),
  (third_id,member,jsonb_build_object('account_id',b,'sku','AUTRE'||sku)),(other_id,member,jsonb_build_object('account_id',a,'sku',''));
 select planned_at into first_slot from public.reserve_listing_slot(first_id,member,1,'{}',0);
 select planned_at,message into second_slot,note from public.reserve_listing_slot(second_id,member,1,'{}',0);
 assert second_slot>=first_slot+interval '30 minutes','Same SKU on another account must wait 30 minutes';
 assert note like 'Même SKU%','The delay is explained';
 select planned_at into third_slot from public.reserve_listing_slot(third_id,member,1,'{}',0);
 assert third_slot<first_slot+interval '1 minute','Another SKU is not delayed';
 select planned_at into other_slot from public.reserve_listing_slot(other_id,member,1,'{}',0);
 assert other_slot<first_slot+interval '1 minute','A listing without SKU is not delayed';
end $$;
rollback;
