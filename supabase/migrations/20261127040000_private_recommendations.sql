-- Private recommendation signals. No grants to profile/social/Blend readers.
create table if not exists public.recommendation_tastes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  epoch integer not null default 0,
  events jsonb not null default '[]'::jsonb check (jsonb_typeof(events)='array' and jsonb_array_length(events)<=600 and octet_length(events::text)<=3000000),
  window_start timestamptz not null default now(),
  window_count integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.recommendation_tastes enable row level security;
revoke all on public.recommendation_tastes from public, anon, authenticated;
grant select on public.recommendation_tastes to authenticated;
create policy recommendation_taste_owner on public.recommendation_tastes for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.get_recommendation_taste() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.recommendation_tastes;
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.recommendation_tastes(user_id) values(u) on conflict do nothing;
  -- Retention is also enforced on reads so stale devices cannot revive old taste.
  update public.recommendation_tastes set events=coalesce((select jsonb_agg(e) from jsonb_array_elements(events) e where (e->>'at')::numeric >= extract(epoch from now()-interval '180 days')*1000),'[]'::jsonb) where user_id=u returning * into r;
  return jsonb_build_object('enabled',r.enabled,'epoch',r.epoch,'events',r.events);
end $$;

create or replace function public.ingest_recommendation_signals(p_events jsonb, p_epoch integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.recommendation_tastes; item jsonb; t jsonb; sanitized jsonb:='[]'::jsonb; n integer; millis numeric:=extract(epoch from now())*1000;
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' or octet_length(p_events::text)>180000 then raise exception 'Invalid batch'; end if;
  n:=jsonb_array_length(p_events);
  if n>30 then raise exception 'Batch limit exceeded'; end if;
  insert into public.recommendation_tastes(user_id) values(u) on conflict do nothing;
  select * into r from public.recommendation_tastes where user_id=u for update;
  if not r.enabled or p_epoch is distinct from r.epoch then return jsonb_build_object('enabled',r.enabled,'epoch',r.epoch,'events',r.events); end if;
  if r.window_start < now()-interval '1 minute' then r.window_start:=now();r.window_count:=0; end if;
  if r.window_count+n>180 then raise exception 'Rate limit exceeded' using errcode='54000'; end if;
  for item in select value from jsonb_array_elements(p_events) loop
    t:=item->'track';
    if jsonb_typeof(item) is distinct from 'object' or jsonb_typeof(t) is distinct from 'object'
      or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id') not between 1 and 100
      or coalesce(item->>'kind','') not in ('select','listen','complete','replay','like','playlist','skip','not_interested','block_artist','import')
      or coalesce(item->>'origin','') not in ('explicit','auto')
      or jsonb_typeof(item->'at') is distinct from 'number' or jsonb_typeof(item->'seconds') is distinct from 'number'
      or coalesce(t->>'provider','youtube') <> 'youtube'
      or jsonb_typeof(t->'videoId') is distinct from 'string' or (t->>'videoId') !~ '^[A-Za-z0-9_-]{1,128}$'
      or jsonb_typeof(t->'title') is distinct from 'string' or length(t->>'title') not between 1 and 500
      or jsonb_typeof(t->'artist') is distinct from 'string' or length(t->>'artist')>300
      or coalesce(t->>'type','') not in ('SONG','VIDEO')
      or (item->>'seconds')::numeric not between 0 and 86400
      or (item->>'at')::numeric not between millis-15552000000 and millis+60000
    then raise exception 'Invalid signal'; end if;
    -- Whitelist only provider metadata. No arbitrary payload, location or PII.
    t:=jsonb_build_object('provider','youtube','videoId',t->>'videoId','title',t->>'title','artist',t->>'artist','type',t->>'type',
      'duration',case when jsonb_typeof(t->'duration')='number' and (t->>'duration')::numeric between 1 and 86400 then t->'duration' else 'null'::jsonb end,
      'thumbnail',case when length(t->>'thumbnail')<=2000 and (t->>'thumbnail') like 'https://%' then t->>'thumbnail' else '' end,
      'artists',coalesce((select jsonb_agg(jsonb_build_object('name',left(a->>'name',200),'artistId',case when length(a->>'artistId')<=128 then a->>'artistId' else null end)) from (select a from jsonb_array_elements(case when jsonb_typeof(t->'artists')='array' then t->'artists' else '[]'::jsonb end) a limit 10) x where jsonb_typeof(a->'name')='string'),'[]'::jsonb));
    sanitized:=sanitized||jsonb_build_array(jsonb_build_object('id',item->>'id','track',t,'kind',item->>'kind','origin',item->>'origin','seconds',item->'seconds','at',item->'at'));
  end loop;
  update public.recommendation_tastes set events=coalesce((
    select jsonb_agg(e order by (e->>'at')::numeric) from (
      select e from (
        select distinct on (e->>'id') e from jsonb_array_elements(r.events||sanitized) with ordinality as v(e,ord)
        where (e->>'at')::numeric>=millis-15552000000 order by e->>'id',ord
      ) d order by (e->>'at')::numeric desc limit 600
    ) bounded),'[]'::jsonb),window_start=r.window_start,window_count=r.window_count+n,updated_at=now()
    where user_id=u returning * into r;
  return jsonb_build_object('enabled',r.enabled,'epoch',r.epoch,'events',r.events);
end $$;

create or replace function public.set_recommendation_preferences(p_enabled boolean,p_reset boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.recommendation_tastes;
begin
  if u is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_enabled is null or p_reset is null then raise exception 'Invalid preferences';end if;
  insert into public.recommendation_tastes(user_id) values(u) on conflict do nothing;
  update public.recommendation_tastes set enabled=p_enabled,events=case when p_reset then '[]'::jsonb else events end,
    epoch=epoch+1,updated_at=now() where user_id=u returning * into r;
  return jsonb_build_object('enabled',r.enabled,'epoch',r.epoch,'events',r.events);
end $$;
revoke all on function public.get_recommendation_taste() from public,anon;
revoke all on function public.ingest_recommendation_signals(jsonb,integer) from public,anon;
revoke all on function public.set_recommendation_preferences(boolean,boolean) from public,anon;
grant execute on function public.get_recommendation_taste() to authenticated;
grant execute on function public.ingest_recommendation_signals(jsonb,integer) to authenticated;
grant execute on function public.set_recommendation_preferences(boolean,boolean) to authenticated;
