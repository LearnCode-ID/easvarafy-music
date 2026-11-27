-- Existing schema audited 2026-11-27: user_playlists.tracks is an ordered JSONB
-- array of YouTube-compatible Track metadata (no catalogue FK/item table).
begin;
alter table public.profiles enable row level security;
alter table public.user_playlists enable row level security;
alter table public.user_liked_tracks enable row level security;
alter table public.monthly_listening_stats enable row level security;
-- Auth metadata is not authoritative after a profile image has been edited.
-- The previous auth trigger overwrote the image on every auth.users UPDATE.
create or replace function public.handle_user_updated() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 update profiles set email=coalesce(new.email,email) where id=new.id;
 return new;
end $$;
alter table public.profiles
  add column if not exists bio text not null default '' check (length(bio) <= 500),
  add column if not exists banner_path text,
  add column if not exists is_public boolean not null default false,
  add column if not exists show_stats boolean not null default false,
  add column if not exists show_streak boolean not null default false,
  add column if not exists show_badges boolean not null default false;
-- Preserve existing explicit choices, but never inherit a public default for
-- newly created accounts (or treat an old NULL flag as publicly visible).
alter table public.profiles alter column is_public set default false;
update public.profiles set is_public=false where is_public is null;
alter table public.profiles alter column is_public set not null;
alter table public.user_playlists
  add column if not exists cover_url text,
  add column if not exists version integer not null default 1;
alter table public.user_playlists alter column is_public set default false;

create or replace function public.profile_is_public(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
 select exists(select 1 from profiles where id=uid and is_public and not is_banned);
$$;
revoke all on function public.profile_is_public(uuid) from public;
grant execute on function public.profile_is_public(uuid) to anon,authenticated;

drop policy if exists user_playlists_select_public on public.user_playlists;
create policy user_playlists_select_public on public.user_playlists for select to anon,authenticated
 using (user_id=auth.uid() or (is_public and public.profile_is_public(user_id)));
drop policy if exists user_liked_tracks_select_public on public.user_liked_tracks;
create policy user_liked_tracks_select_own on public.user_liked_tracks for select to authenticated using(user_id=auth.uid());
drop policy if exists monthly_listening_select_public on public.monthly_listening_stats;
create policy monthly_listening_select_own on public.monthly_listening_stats for select to authenticated using(user_id=auth.uid());

-- Old definer RPCs must not bypass new profile privacy. Only explicitly opted-in
-- listeners appear in discovery/rankings; badges are separately opt-in.
do $$ declare f record; d text; begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace
 and proname in ('search_public_profiles','get_monthly_top_listeners','get_public_profile') loop
  d := pg_get_functiondef(f.oid);
  d := replace(d, 'p.is_banned = false', 'p.is_banned = false AND p.is_public = true AND p.show_stats = true');
  d := replace(d, 'p.role,', 'CASE WHEN p.show_badges THEN p.role ELSE ''user'' END,');
  -- Listening history is private, even when aggregate statistics are shared.
  d := replace(d, 's.last_track_video_id,', 'NULL::text AS last_track_video_id,');
  d := replace(d, 's.last_track_title,', 'NULL::text AS last_track_title,');
  d := replace(d, 's.last_track_artist,', 'NULL::text AS last_track_artist,');
  d := replace(d, 's.last_track_thumbnail,', 'NULL::text AS last_track_thumbnail,');
  d := replace(d, '(SELECT count(*) FROM public.user_liked_tracks ul WHERE ul.user_id = p.id)', '0::bigint');
  if (select proname from pg_proc where oid=f.oid) <> 'get_monthly_top_listeners' then
   d := replace(d, 'AND p.show_stats = true', '');
   d := replace(d, 'COALESCE(s.play_count, 0)', 'CASE WHEN p.show_stats THEN COALESCE(s.play_count, 0) ELSE 0 END');
   d := replace(d, 'COALESCE(s.listen_seconds, 0)', 'CASE WHEN p.show_stats THEN COALESCE(s.listen_seconds, 0) ELSE 0 END');
  end if;
  execute d;
 end loop;
end $$;

-- Privatize existing objects too: old public /object/public/avatars URLs stop
-- working. References remain intact and are resolved through authorized download.
update storage.buckets set public=false, file_size_limit=5242880, allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='avatars';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('profile-media','profile-media',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists avatars_public_read on storage.objects;
create or replace function public.profile_media_access(object_name text, bucket text) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles p where p.is_public and not p.is_banned
 and p.id::text=split_part(object_name,'/',1) and (
 (bucket='profile-media' and (p.banner_path=object_name or p.avatar_url='profile-media:'||object_name))
 or (bucket='avatars' and p.avatar_url like '%/avatars/'||object_name)
 ));
$$;
revoke all on function public.profile_media_access(text,text) from public;
grant execute on function public.profile_media_access(text,text) to anon,authenticated;
create policy profile_images_read on storage.objects for select to anon,authenticated using (
 bucket_id in ('avatars','profile-media') and (
 (storage.foldername(name))[1]=auth.uid()::text or public.profile_media_access(name,bucket_id))
);
create policy profile_media_insert on storage.objects for insert to authenticated
 with check(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
create policy profile_media_delete on storage.objects for delete to authenticated
 using(bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);

create table public.user_streaks (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 timezone text not null,
 current_streak integer not null default 0,
 longest_streak integer not null default 0,
 last_active date
);
create table public.user_activity_days (
 user_id uuid not null references public.profiles(id) on delete cascade,
 day date not null,
 primary key(user_id,day)
);
alter table public.user_streaks enable row level security;
alter table public.user_activity_days enable row level security;
create policy streak_own_read on public.user_streaks for select to authenticated using(user_id=auth.uid());
create policy activity_own_read on public.user_activity_days for select to authenticated using(user_id=auth.uid());
revoke all on public.user_streaks,public.user_activity_days from anon,authenticated;
grant select on public.user_streaks,public.user_activity_days to authenticated;

create or replace function public.read_profile_streak(uid uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare s public.user_streaks; today date; begin
 if not exists(select 1 from profiles where id=uid and (id=auth.uid() or (is_public and show_streak and not is_banned))) then return null; end if;
 select * into s from user_streaks where user_id=uid;
 if not found then return jsonb_build_object('current',0,'longest',0,'active_today',false,'days','[]'::jsonb); end if;
 today := (now() at time zone s.timezone)::date;
 return jsonb_build_object('current',case when s.last_active>=today-1 then s.current_streak else 0 end,
 'longest',s.longest_streak,'active_today',s.last_active=today,'timezone',case when uid=auth.uid() then s.timezone else null end,
 'days',(select jsonb_agg(jsonb_build_object('date',d::date,'active',exists(select 1 from user_activity_days a where a.user_id=uid and a.day=d::date)) order by d)
 from generate_series(today-13,today,'1 day'::interval) d));
end $$;
create or replace function public.record_daily_activity(p_timezone text default 'UTC') returns jsonb
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); s public.user_streaks; today date; n integer; begin
 if uid is null then raise exception 'Login diperlukan' using errcode='42501'; end if;
 -- One lock shared by every device, including first-ever activity. The timezone
 -- is initialized once, never silently replaced by a travelling device.
 perform 1 from profiles where id=uid and not is_banned for update;
 if not found then raise exception 'Profil tidak tersedia'; end if;
 if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Zona waktu tidak valid'; end if;
 insert into user_streaks(user_id,timezone) values(uid,p_timezone) on conflict do nothing;
 select * into s from user_streaks where user_id=uid for update;
 today := (now() at time zone s.timezone)::date;
 if s.last_active is null or s.last_active<today then
  n := case when s.last_active=today-1 then s.current_streak+1 else 1 end;
  insert into user_activity_days values(uid,today) on conflict do nothing;
  update user_streaks set current_streak=n,longest_streak=greatest(longest_streak,n),last_active=today where user_id=uid;
 end if;
 return public.read_profile_streak(uid);
end $$;
revoke all on function public.record_daily_activity(text) from public;
grant execute on function public.record_daily_activity(text) to authenticated;
revoke all on function public.read_profile_streak(uuid) from public;
grant execute on function public.read_profile_streak(uuid) to anon,authenticated;

create or replace function public.get_profile_page(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare p public.profiles; own boolean; result jsonb; begin
 select * into p from profiles where id=p_user_id and not is_banned;
 if not found then return jsonb_build_object('status','not_found'); end if;
 own:=coalesce(auth.uid()=p.id,false);
 if not own and not coalesce(p.is_public,false) then return jsonb_build_object('status','private'); end if;
 result:=jsonb_build_object('status','ok','id',p.id,'name',coalesce(p.name,'Listener'),
 'bio',p.bio,'avatar_url',p.avatar_url,'banner_path',p.banner_path,'created_at',p.created_at,
 'role',case when own or p.show_badges then p.role else 'user' end,
 'streak',public.read_profile_streak(p.id));
 if own then result:=result||jsonb_build_object('is_public',p.is_public,'show_stats',p.show_stats,'show_badges',p.show_badges,'show_streak',p.show_streak); end if;
 if own or p.show_stats then
 result:=result||jsonb_build_object('stats',(select jsonb_build_object('plays',coalesce(sum(play_count),0),'seconds',coalesce(sum(listen_seconds),0)) from monthly_listening_stats where user_id=p.id));
 end if;
 return result;
end $$;
revoke all on function public.get_profile_page(uuid) from public;
grant execute on function public.get_profile_page(uuid) to anon,authenticated;

-- Versioned saves avoid silent lost updates across devices. The entire ordered
-- JSON array is in the parent row, so its visibility cannot diverge from RLS.
create or replace function public.save_user_playlist(p_playlist jsonb, p_expected_version integer default 0) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare uid uuid:=auth.uid(); r public.user_playlists; pid text:=p_playlist->>'id'; begin
 if uid is null then raise exception 'Login diperlukan' using errcode='42501'; end if;
 if p_playlist->>'ownerId' is distinct from uid::text then raise exception 'Pemilik playlist tidak valid' using errcode='42501'; end if;
 if length(pid)>128 or coalesce(length(pid),0)=0 or coalesce(length(trim(p_playlist->>'name')),0) not between 1 and 150
 or length(coalesce(p_playlist->>'description',''))>2000 or jsonb_typeof(p_playlist->'tracks') is distinct from 'array'
 or jsonb_array_length(p_playlist->'tracks')>2000 then raise exception 'Playlist tidak valid'; end if;
 if exists(select 1 from jsonb_array_elements(p_playlist->'tracks') t where coalesce(t->>'videoId','')='' or coalesce(t->>'title','')='') then raise exception 'Metadata lagu tidak valid'; end if;
 -- Serializes creates as well as edits for this user.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into r from user_playlists where id=pid and user_id=uid for update;
 if found then
  if r.version<>p_expected_version then raise exception 'Playlist berubah di perangkat lain. Muat ulang dan coba lagi.' using errcode='40001'; end if;
  update user_playlists set name=trim(p_playlist->>'name'),description=coalesce(p_playlist->>'description',''),
  cover_url=nullif(p_playlist->>'coverUrl',''),is_public=coalesce((p_playlist->>'isPublic')::boolean,false),
  tags=array(select jsonb_array_elements_text(coalesce(p_playlist->'tags','[]'))),tracks=p_playlist->'tracks',updated_at=now(),version=version+1
  where id=pid and user_id=uid returning * into r;
 else
  if p_expected_version<>0 then raise exception 'Playlist tidak ditemukan atau sudah dihapus'; end if;
  insert into user_playlists(id,user_id,name,description,cover_url,is_public,tags,tracks)
  values(pid,uid,trim(p_playlist->>'name'),coalesce(p_playlist->>'description',''),nullif(p_playlist->>'coverUrl',''),coalesce((p_playlist->>'isPublic')::boolean,false),
  array(select jsonb_array_elements_text(coalesce(p_playlist->'tags','[]'))),p_playlist->'tracks') returning * into r;
 end if;
 return to_jsonb(r);
end $$;
revoke all on function public.save_user_playlist(jsonb,integer) from public;
grant execute on function public.save_user_playlist(jsonb,integer) to authenticated;
commit;
