begin;
alter table public.vinted_accounts
  add column creation_stage text check (creation_stage in ('post1','post2','wait','ready','blocked')),
  add column creation_next_at timestamptz,
  add column browser text,
  add column tracker_source_id text unique;
-- Keep the original imported document as a recovery copy. Move account management
-- to the existing account table without overwriting credentials or proxy settings.
do $migration$
declare a jsonb; matches uuid[]; target uuid;
begin
  perform 1 from public.drop_tracker where id for update;
  for a in select value from public.drop_tracker d cross join lateral jsonb_array_elements(d.payload->'accounts') loop
    select array_agg(id) into matches from public.vinted_accounts
      where tracker_source_id=a->>'id'
        or nullif(lower(trim(a->>'pseudo')),'')=lower(trim(pseudo))
        or nullif(lower(trim(a->>'email')),'')=lower(trim(email));
    if coalesce(array_length(matches,1),0)>1 then raise exception 'Ambiguous account match; migration cancelled'; end if;
    if matches is null then
      insert into public.vinted_accounts(pseudo,email,telephone,browser,notes,created_at,creation_stage,creation_next_at,tracker_source_id,is_ready,statut)
      values(coalesce(nullif(a->>'pseudo',''),a->>'email'),nullif(a->>'email',''),nullif(a->>'phone',''),nullif(a->>'browser',''),nullif(a->>'notes',''),
        coalesce(to_timestamp((a->>'createdAt')::double precision/1000),now()),a->>'stage',to_timestamp((a->>'nextAt')::double precision/1000),a->>'id',
        a->>'stage'='ready',case a->>'stage' when 'ready' then 'actif' when 'blocked' then 'suspendu' else 'en_preparation' end);
    else
      target:=matches[1];
      update public.vinted_accounts set creation_stage=a->>'stage',creation_next_at=to_timestamp((a->>'nextAt')::double precision/1000),
        browser=coalesce(browser,nullif(a->>'browser','')),tracker_source_id=a->>'id',
        telephone=coalesce(telephone,nullif(a->>'phone','')),notes=concat_ws(E'\n',nullif(notes,''),nullif(a->>'notes',''))
      where id=target;
    end if;
  end loop;
end $migration$;
commit;
