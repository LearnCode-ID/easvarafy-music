-- Requires 20261127010000_private_profiles_streak_playlists.sql first.
-- Follow edges are public by product design, not private profile attributes.
-- Blend is a private, two-party, revocable consent scope; never a public playlist.
begin;
alter table public.profiles add column share_friend_activity boolean not null default false;
create function public.social_user_available(uid uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select exists(select 1 from profiles where id=uid and not is_banned);
$$;
revoke all on function public.social_user_available(uuid) from public;
grant execute on function public.social_user_available(uuid) to anon,authenticated;

create table public.user_follows (
 follower_id uuid not null references public.profiles(id) on delete cascade,
 following_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(follower_id,following_id), check(follower_id<>following_id)
);
create index user_follows_inbound on public.user_follows(following_id,created_at desc);
alter table public.user_follows enable row level security;
grant select on public.user_follows to anon,authenticated;
grant insert(follower_id,following_id),delete on public.user_follows to authenticated;
create policy follows_read on public.user_follows for select to anon,authenticated using(true);
create policy follows_insert on public.user_follows for insert to authenticated with check(
 follower_id=auth.uid() and public.social_user_available(follower_id) and public.social_user_available(following_id));
create policy follows_delete on public.user_follows for delete to authenticated using(follower_id=auth.uid());

create function public.get_follow_counts(p_user_id uuid) returns jsonb
language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('followers_count',(select count(*) from user_follows where following_id=p_user_id),
 'following_count',(select count(*) from user_follows where follower_id=p_user_id),
 'is_following',exists(select 1 from user_follows where follower_id=auth.uid() and following_id=p_user_id));
$$;
create function public.get_follow_list(p_user_id uuid,p_direction text default 'followers',p_offset integer default 0,p_limit integer default 30)
returns table(id uuid,name text,avatar_url text,role text,is_private boolean,is_following boolean)
language sql stable security definer set search_path=public as $$
 select p.id,case when p.is_public or p.id=auth.uid() then coalesce(p.name,'Listener') else 'Profil privat' end,
 case when p.is_public or p.id=auth.uid() then p.avatar_url else null end,
 case when (p.is_public and p.show_badges) or p.id=auth.uid() then p.role else 'user' end,
 not p.is_public and p.id is distinct from auth.uid(),
 exists(select 1 from user_follows me where me.follower_id=auth.uid() and me.following_id=p.id)
 from user_follows f join profiles p on p.id=case when p_direction='following' then f.following_id else f.follower_id end
 where (case when p_direction='following' then f.follower_id else f.following_id end)=p_user_id and not p.is_banned
 order by f.created_at desc,p.id limit least(greatest(p_limit,1),50) offset greatest(p_offset,0);
$$;
create function public.get_following_feed(p_offset integer default 0,p_limit integer default 30)
returns table(user_id uuid,name text,avatar_url text,role text,is_private boolean,last_track jsonb,last_played_at timestamptz,playlist jsonb)
language sql stable security definer set search_path=public as $$
 select p.id,case when p.is_public then coalesce(p.name,'Listener') else 'Profil privat' end,
 case when p.is_public then p.avatar_url else null end,
 case when p.is_public and p.show_badges then p.role else 'user' end,not p.is_public,
 case when p.is_public and p.share_friend_activity and s.last_track_video_id is not null then
 jsonb_build_object('videoId',s.last_track_video_id,'title',s.last_track_title,'artist',s.last_track_artist,'thumbnail',s.last_track_thumbnail,'duration',null,'type','SONG','artists','[]'::jsonb) else null end,
 case when p.is_public and p.share_friend_activity then s.updated_at else null end,
 case when p.is_public and up.id is not null then jsonb_build_object('id',up.id,'name',up.name,'cover_url',up.cover_url,'updated_at',up.updated_at) else null end
 from user_follows f join profiles p on p.id=f.following_id
 left join lateral (select m.* from monthly_listening_stats m where m.user_id=p.id order by m.updated_at desc limit 1) s on p.is_public and p.share_friend_activity
 left join lateral (select u.* from user_playlists u where u.user_id=p.id and u.is_public order by u.updated_at desc,u.id limit 1) up on p.is_public
 where f.follower_id=auth.uid() and not p.is_banned
 order by greatest(case when p.is_public and p.share_friend_activity then s.updated_at end,case when p.is_public then up.updated_at end,f.created_at) desc,p.id
 limit least(greatest(p_limit,1),50) offset greatest(p_offset,0);
$$;
revoke all on function public.get_follow_counts(uuid),public.get_follow_list(uuid,text,integer,integer),public.get_following_feed(integer,integer) from public;
grant execute on function public.get_follow_counts(uuid),public.get_follow_list(uuid,text,integer,integer) to anon,authenticated;
grant execute on function public.get_following_feed(integer,integer) to authenticated;
-- Extend the explicit-allowlist page RPC without exposing private page payloads.
do $$ declare d text; begin
 d:=pg_get_functiondef('public.get_profile_page(uuid)'::regprocedure);
 if position('return result;' in d)=0 then raise exception 'Reaudit get_profile_page before applying social migration'; end if;
 d:=replace(d,'return result;', 'return result || public.get_follow_counts(p_user_id) || case when own then jsonb_build_object(''share_friend_activity'',p.share_friend_activity) else ''{}''::jsonb end;');
 execute d;
end $$;

create table public.blend_playlists (
 id uuid primary key default gen_random_uuid(),
 creator_id uuid not null references public.profiles(id) on delete cascade,
 partner_id uuid references public.profiles(id) on delete cascade,
 invite_code text not null unique default replace(gen_random_uuid()::text,'-',''),
 invite_expires_at timestamptz not null default now()+interval '7 days',
 status text not null default 'pending' check(status in ('pending','active','declined')),
 match_percent integer not null default 0 check(match_percent between 0 and 100),
 shared_artists jsonb not null default '[]' check(jsonb_typeof(shared_artists)='array'),
 tracks jsonb not null default '[]' check(jsonb_typeof(tracks)='array' and jsonb_array_length(tracks)<=40),
 version integer not null default 1,
 last_refreshed_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(creator_id is distinct from partner_id),check(status<>'active' or partner_id is not null)
);
create index blends_creator on public.blend_playlists(creator_id,updated_at desc);
create index blends_partner on public.blend_playlists(partner_id,updated_at desc);
alter table public.blend_playlists enable row level security;
revoke all on public.blend_playlists from anon,authenticated;
grant select on public.blend_playlists to authenticated;
create policy blend_participant_read on public.blend_playlists for select to authenticated
 using(auth.uid() in (creator_id,partner_id) and public.social_user_available(auth.uid()));
-- Writes are RPC-only: a participant cannot assign arbitrary partners, redeem
-- an invitation for someone else, overwrite a code, or forge its status.
create table public.social_notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 blend_id uuid not null references public.blend_playlists(id) on delete cascade,
 event text not null check(event in ('blend_invite','blend_accepted')),
 title text not null,body text not null,action_url text not null,
 created_at timestamptz not null default now(),read_at timestamptz,
 unique(user_id,blend_id,event)
);
alter table public.social_notifications enable row level security;
revoke all on public.social_notifications from anon,authenticated;
grant select on public.social_notifications to authenticated;
create policy social_notification_read on public.social_notifications for select to authenticated using(user_id=auth.uid());
create function public.read_social_notifications(p_ids uuid[]) returns void
language sql security definer set search_path=public as $$
 update social_notifications set read_at=coalesce(read_at,now()) where user_id=auth.uid() and id=any(p_ids[1:100]);
$$;

create function public.create_blend_invite(p_partner_id uuid default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); b blend_playlists; begin
 if uid is null or not social_user_available(uid) then raise exception 'Login diperlukan' using errcode='42501'; end if;
 if p_partner_id=uid or (p_partner_id is not null and not social_user_available(p_partner_id)) then raise exception 'Teman tidak valid'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,2));
 if (select count(*) from blend_playlists where creator_id=uid and created_at>now()-interval '1 day')>=20 then raise exception 'Batas 20 undangan per hari tercapai'; end if;
 insert into blend_playlists(creator_id,partner_id) values(uid,p_partner_id) returning * into b;
 if p_partner_id is not null then
 insert into social_notifications(user_id,blend_id,event,title,body,action_url)
 values(p_partner_id,b.id,'blend_invite','Undangan Blend','Teman mengundangmu membuat playlist gabungan. Buka untuk menerima dan berbagi cuplikan selera musik.', '/blend?code='||b.invite_code);
 end if;
 return b.id;
end $$;
create function public.join_blend(p_code text) returns uuid
language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid(); b blend_playlists; begin
 if uid is null or not social_user_available(uid) then raise exception 'Login diperlukan' using errcode='42501'; end if;
 if p_code !~ '^[a-f0-9]{32}$' then raise exception 'Undangan tidak valid atau kedaluwarsa'; end if;
 select * into b from blend_playlists where invite_code=p_code for update;
 if not found then raise exception 'Undangan tidak valid atau kedaluwarsa'; end if;
 if not social_user_available(b.creator_id) then raise exception 'Undangan tidak tersedia'; end if;
 if uid=b.creator_id then return b.id; end if;
 if b.status='active' and b.partner_id=uid then return b.id; end if;
 if b.status<>'pending' or b.invite_expires_at<=now() or (b.partner_id is not null and b.partner_id<>uid) then raise exception 'Undangan tidak valid, sudah dipakai, atau kedaluwarsa'; end if;
 update blend_playlists set partner_id=uid,status='active',version=version+1,updated_at=now() where id=b.id;
 insert into social_notifications(user_id,blend_id,event,title,body,action_url)
 values(b.creator_id,b.id,'blend_accepted','Blend sudah terhubung','Teman menerima undanganmu. Buka Blend untuk meracik musik bersama.','/blend?id='||b.id::text) on conflict do nothing;
 return b.id;
end $$;
create function public.leave_blend(p_blend_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 update blend_playlists set status='declined',tracks='[]',shared_artists='[]',match_percent=0,version=version+1,updated_at=now()
 where id=p_blend_id and auth.uid() in (creator_id,partner_id);
 if not found then raise exception 'Blend tidak ditemukan' using errcode='42501'; end if;
 delete from social_notifications where blend_id=p_blend_id;
end $$;

create function public.get_blend_members(p_blend_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare b blend_playlists; begin
 select * into b from blend_playlists where id=p_blend_id and auth.uid() in (creator_id,partner_id) and social_user_available(auth.uid());
 if not found then raise exception 'Blend tidak ditemukan' using errcode='42501'; end if;
 return (select jsonb_agg(jsonb_build_object('id',p.id,'name',case when p.id=b.creator_id or b.status='active' or p.id=auth.uid() or p.is_public then coalesce(p.name,'Listener') else 'Teman' end,
 'avatar_url',case when p.id=auth.uid() or p.is_public then p.avatar_url else null end))
 from profiles p where p.id in (b.creator_id,b.partner_id));
end $$;
-- An active two-party Blend is explicit consent to share a bounded musical
-- sample (not email, private playlist titles, full history or account settings).
create function public.get_blend_tastes(p_blend_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare b blend_playlists; result jsonb; begin
 select * into b from blend_playlists where id=p_blend_id and status='active' and auth.uid() in (creator_id,partner_id);
 if not found or not social_user_available(b.creator_id) or not social_user_available(b.partner_id) then raise exception 'Blend belum aktif atau tidak diizinkan' using errcode='42501'; end if;
 select jsonb_object_agg(u.id::text,coalesce(samples.tracks,'[]'::jsonb)) into result
 from (values(b.creator_id),(b.partner_id)) u(id)
 cross join lateral (
 select jsonb_agg(t.track order by t.priority,t.position) tracks from (
 select distinct on (x.track->>'videoId') x.track,x.priority,x.position from (
 select ul.track,0 priority,row_number() over(order by ul.liked_at desc) as position from user_liked_tracks ul where ul.user_id=u.id
 union all
 select item.value,1,row_number() over(order by up.updated_at desc,up.id,item.ordinality) from user_playlists up cross join lateral jsonb_array_elements(up.tracks) with ordinality item(value,ordinality) where up.user_id=u.id
 union all
 select jsonb_build_object('videoId',s.last_track_video_id,'title',s.last_track_title,'artist',s.last_track_artist,'thumbnail',s.last_track_thumbnail,'duration',null,'type','SONG','artists','[]'::jsonb),2,row_number() over(order by s.updated_at desc) from monthly_listening_stats s where s.user_id=u.id and s.last_track_video_id is not null
 ) x where nullif(x.track->>'videoId','') is not null and nullif(x.track->>'title','') is not null
 order by x.track->>'videoId',x.priority,x.position limit 200
 ) t
 ) samples;
 return result;
end $$;
create function public.save_blend_mix(p_blend_id uuid,p_version integer,p_tracks jsonb,p_match integer,p_artists jsonb,p_actor_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare b blend_playlists; begin
 select * into b from blend_playlists where id=p_blend_id and status='active' and auth.uid() in (creator_id,partner_id) for update;
 if not found or p_actor_id is distinct from auth.uid() or not social_user_available(b.creator_id) or not social_user_available(b.partner_id) then raise exception 'Blend tidak aktif atau tidak diizinkan' using errcode='42501'; end if;
 if p_version is null or b.version<>p_version then raise exception 'Blend berubah di perangkat lain. Muat ulang lalu coba lagi.' using errcode='40001'; end if;
 if p_match is null or p_match not between 0 and 100 or jsonb_typeof(p_tracks) is distinct from 'array' or jsonb_array_length(p_tracks)>40 or octet_length(p_tracks::text)>262144
 or jsonb_typeof(p_artists) is distinct from 'array' or jsonb_array_length(p_artists)>20 then raise exception 'Racikan Blend tidak valid'; end if;
 if exists(select 1 from jsonb_array_elements(p_tracks) t where nullif(t->>'videoId','') is null or nullif(t->>'title','') is null
 or t->>'source' not in ('favorite','shared','related') or t->>'source' is null
 or jsonb_typeof(t->'tasteOwnerIds') is distinct from 'array' or jsonb_array_length(t->'tasteOwnerIds') not between 1 and 2
 or exists(select 1 from jsonb_array_elements_text(t->'tasteOwnerIds') owner where owner is null or owner not in (b.creator_id::text,b.partner_id::text))
 or (t->>'addedByUserId' is not null and t->>'addedByUserId' not in (b.creator_id::text,b.partner_id::text))) then raise exception 'Atribusi lagu tidak valid'; end if;
 if (select count(*) from jsonb_array_elements(p_tracks))<>(select count(distinct t->>'videoId') from jsonb_array_elements(p_tracks) t) then raise exception 'Lagu Blend tidak boleh duplikat'; end if;
 update blend_playlists set tracks=p_tracks,match_percent=p_match,shared_artists=p_artists,last_refreshed_at=now(),updated_at=now(),version=version+1 where id=b.id;
end $$;
revoke all on function public.create_blend_invite(uuid),public.join_blend(text),public.leave_blend(uuid),public.get_blend_members(uuid),public.get_blend_tastes(uuid),public.save_blend_mix(uuid,integer,jsonb,integer,jsonb,uuid),public.read_social_notifications(uuid[]) from public;
grant execute on function public.create_blend_invite(uuid),public.join_blend(text),public.leave_blend(uuid),public.get_blend_members(uuid),public.get_blend_tastes(uuid),public.save_blend_mix(uuid,integer,jsonb,integer,jsonb,uuid),public.read_social_notifications(uuid[]) to authenticated;
commit;
