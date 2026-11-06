-- Undo a received parcel atomically, preserving purchase details and associations.
create function public.undo_reception(p_order uuid,p_lines jsonb,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare o public.sales_orders; l public.sales_lines; n integer:=0;
begin
 select * into o from public.sales_orders where id=p_order for update;
 if not found then raise exception 'line_not_found'; end if;
 if o.status is null or o.status in ('cancelled','returning','suspended','shipped','ready_for_pickup','delivered','completed') then raise exception 'order_blocked'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'stale_version'; end if;
 for l in select * from public.sales_lines where order_id=p_order and source_active order by id for update loop
  if l.stage<>'received' then raise exception 'invalid_transition'; end if;
  if not exists(select 1 from jsonb_array_elements(p_lines) e where e->>'id'=l.id and (e->>'updated_at')::timestamptz=l.updated_at) then raise exception 'stale_version'; end if;
  n:=n+1;
 end loop;
 if n=0 or n<>jsonb_array_length(p_lines) then raise exception 'stale_version'; end if;
 update public.sales_lines set stage='in_transit',received_at=null,location=null,updated_at=clock_timestamp(),updated_by=p_user where order_id=p_order and source_active;
 perform public.queue_sales_sources(array[p_order]);
end $$;
revoke all on function public.undo_reception(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.undo_reception(uuid,jsonb,uuid) to service_role;
