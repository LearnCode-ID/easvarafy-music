-- Minimal audited pre-migration Supabase schema for isolated PostgreSQL tests.
-- This is not a replacement/bootstrap migration for a production Supabase project.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema public,auth to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table public.profiles(id uuid primary key,email text,name text,avatar_url text,role text default 'user',is_banned boolean default false,created_at timestamptz default now());
create table public.user_playlists(id text,user_id uuid references profiles(id),name text,description text default '',tags text[] default '{}',tracks jsonb default '[]',is_public boolean default true,created_at timestamptz default now(),updated_at timestamptz default now(),primary key(user_id,id));
create table public.user_liked_tracks(user_id uuid,video_id text,track jsonb,liked_at timestamptz default now());
create table public.monthly_listening_stats(user_id uuid,month_key text,play_count integer,listen_seconds integer,last_track_video_id text,last_track_title text,last_track_artist text,last_track_thumbnail text);
create function public.is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and not is_banned)$$;
alter table profiles enable row level security;
alter table user_playlists enable row level security;
alter table user_liked_tracks enable row level security;
alter table monthly_listening_stats enable row level security;
grant select on profiles,user_playlists,user_liked_tracks,monthly_listening_stats to anon;
grant select,insert,update,delete on profiles,user_playlists,user_liked_tracks to authenticated;
grant select on monthly_listening_stats to authenticated;
create policy profiles_select_own on profiles for select to authenticated using(id=auth.uid() or public.is_admin());
create policy profiles_update_own on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy user_playlists_select_public on user_playlists for select using(user_id=auth.uid() or is_public);
create policy user_playlists_insert_own on user_playlists for insert with check(user_id=auth.uid());
create policy user_playlists_update_own on user_playlists for update using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy user_playlists_delete_own on user_playlists for delete using(user_id=auth.uid());
create policy user_liked_tracks_select_public on user_liked_tracks for select using(true);
create policy monthly_listening_select_public on monthly_listening_stats for select using(true);
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
insert into storage.buckets values('avatars','avatars',true,null,null);
create table storage.objects(bucket_id text,name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
alter table storage.objects enable row level security;
grant usage on schema storage to anon,authenticated;
grant select,insert,update,delete on storage.objects to authenticated;
grant select on storage.objects to anon;
create policy avatars_public_read on storage.objects for select using(bucket_id='avatars');
-- Representative legacy definer RPC, including its vulnerable clauses. Verify
-- the migration hardens its definition as well as the new page RPC.
create function public.get_public_profile(p_user_id uuid,p_month_key text default null)
returns table(id uuid,name text,avatar_url text,role text,created_at timestamptz,month_play_count integer,month_listen_seconds integer,last_track_video_id text,last_track_title text,last_track_artist text,last_track_thumbnail text,playlist_count bigint,liked_count bigint)
language sql stable security definer set search_path=public as $$
SELECT p.id,p.name,p.avatar_url,p.role,p.created_at,COALESCE(s.play_count, 0),COALESCE(s.listen_seconds, 0),s.last_track_video_id,s.last_track_title,s.last_track_artist,s.last_track_thumbnail,
(SELECT count(*) FROM public.user_playlists up WHERE up.user_id=p.id AND up.is_public),
(SELECT count(*) FROM public.user_liked_tracks ul WHERE ul.user_id = p.id)
FROM public.profiles p LEFT JOIN monthly_listening_stats s on s.user_id=p.id WHERE p.id=p_user_id AND p.is_banned = false;
$$;

alter table monthly_listening_stats add column updated_at timestamptz default now();
create or replace function public.current_profile_role() returns text language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid()$$;
create or replace function public.current_profile_banned() returns boolean language sql stable security definer set search_path=public as $$select is_banned from profiles where id=auth.uid()$$;
drop policy profiles_update_own on profiles;
create policy profiles_update_own on profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid() and role=public.current_profile_role() and is_banned=public.current_profile_banned());

CREATE FUNCTION public.get_monthly_top_listeners(p_month_key text DEFAULT NULL, p_limit integer DEFAULT 30)
RETURNS TABLE(user_id uuid, name text, avatar_url text, role text, play_count integer, listen_seconds integer, last_track_video_id text, last_track_title text, last_track_artist text, last_track_thumbnail text, playlist_count bigint, liked_count bigint, rank bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
 WITH target_month AS (
 SELECT COALESCE(NULLIF(trim(p_month_key), ''), to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM')) AS mk
 )
 SELECT p.id AS user_id,COALESCE(NULLIF(trim(p.name), ''), 'Listener') AS name,p.avatar_url,p.role,
 s.play_count,s.listen_seconds,s.last_track_video_id,s.last_track_title,s.last_track_artist,s.last_track_thumbnail,
 (SELECT count(*) FROM public.user_playlists up WHERE up.user_id = p.id AND up.is_public = true) AS playlist_count,
 (SELECT count(*) FROM public.user_liked_tracks ul WHERE ul.user_id = p.id) AS liked_count,
 row_number() OVER (ORDER BY s.play_count DESC, s.listen_seconds DESC, s.updated_at ASC) AS rank
 FROM public.monthly_listening_stats s JOIN public.profiles p ON p.id = s.user_id CROSS JOIN target_month tm
 WHERE s.month_key = tm.mk AND s.play_count > 0 AND p.is_banned = false
 ORDER BY s.play_count DESC, s.listen_seconds DESC, s.updated_at ASC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 30), 100));
$$;
CREATE FUNCTION public.search_public_profiles(p_query text DEFAULT '', p_limit integer DEFAULT 24)
RETURNS TABLE(id uuid, name text, avatar_url text, role text, created_at timestamptz, month_play_count integer, playlist_count bigint, liked_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO public AS $$
 WITH target_month AS ( SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS mk )
 SELECT p.id,COALESCE(NULLIF(trim(p.name), ''), 'Listener') AS name,p.avatar_url,p.role,p.created_at,
 COALESCE(s.play_count, 0) AS month_play_count,
 (SELECT count(*) FROM public.user_playlists up WHERE up.user_id = p.id AND up.is_public = true) AS playlist_count,
 (SELECT count(*) FROM public.user_liked_tracks ul WHERE ul.user_id = p.id) AS liked_count
 FROM public.profiles p CROSS JOIN target_month tm LEFT JOIN public.monthly_listening_stats s ON s.user_id = p.id AND s.month_key = tm.mk
 WHERE p.is_banned = false AND (COALESCE(trim(p_query), '') = '' OR p.name ILIKE '%' || trim(p_query) || '%')
 ORDER BY COALESCE(s.play_count, 0) DESC, p.created_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 24), 60));
$$;
