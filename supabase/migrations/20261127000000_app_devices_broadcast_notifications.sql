-- Device registry + admin broadcast notifications (Instagram-style announcements).
--
-- * app_devices              : every APK (and web client) registers / heartbeats
--                              itself through register_app_device() — guests too.
-- * broadcast_notifications  : history of broadcasts. INSERT/UPDATE/DELETE only
--                              for role 'admin' (NOT 'developer'); SELECT only
--                              for the audience a broadcast targets.
-- * user_notification_reads  : per-device delivery / read receipts.
--
-- Devices (including the native Android background poller, which has no user
-- JWT) read their notifications through SECURITY DEFINER RPCs keyed by the
-- device's random device_id.
-- Applied to project kxvckczujvwvfkykofzc on 2026-11-27.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.app_devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique
    check (device_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  user_id uuid null references auth.users (id) on delete set null,
  platform text not null default 'android'
    check (platform in ('android', 'ios', 'web')),
  app_version text null check (app_version is null or char_length(app_version) <= 40),
  app_build integer null,
  fcm_token text null check (fcm_token is null or char_length(fcm_token) <= 4096),
  notifications_enabled boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists app_devices_last_seen_idx on public.app_devices (last_seen_at desc);
create index if not exists app_devices_user_idx on public.app_devices (user_id);
create index if not exists app_devices_fcm_idx on public.app_devices (fcm_token) where fcm_token is not null;

create table if not exists public.broadcast_notifications (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  category text not null default 'info'
    check (category in ('info', 'story', 'music', 'promo', 'update')),
  image_url text null
    check (image_url is null or (image_url ~* '^https://' and char_length(image_url) <= 1000)),
  action_url text null
    check (action_url is null or char_length(action_url) <= 500),
  target_audience text not null default 'all'
    check (target_audience in ('all', 'logged_in', 'role')),
  target_role text null
    check (target_role is null or target_role in ('user', 'admin', 'developer')),
  sent_by uuid null default auth.uid() references auth.users (id) on delete set null,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  read_count integer not null default 0,
  push_status text not null default 'pending'
    check (push_status in ('pending', 'sent', 'partial', 'skipped', 'failed')),
  push_sent_count integer not null default 0,
  push_failed_count integer not null default 0,
  push_error text null,
  created_at timestamptz not null default now(),
  constraint broadcast_role_target check (target_audience <> 'role' or target_role is not null)
);

create index if not exists broadcast_notifications_created_idx
  on public.broadcast_notifications (created_at desc);

create table if not exists public.user_notification_reads (
  notification_id uuid not null references public.broadcast_notifications (id) on delete cascade,
  device_id text not null,
  user_id uuid null references auth.users (id) on delete set null,
  delivered_at timestamptz not null default now(),
  read_at timestamptz null,
  primary key (notification_id, device_id)
);

create index if not exists user_notification_reads_device_idx
  on public.user_notification_reads (device_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Whether a broadcast targets a given (possibly anonymous) user.
create or replace function public.broadcast_targets(
  p_audience text,
  p_target_role text,
  p_uid uuid,
  p_role text
) returns boolean
language sql
immutable
as $$
  select case p_audience
    when 'all' then true
    when 'logged_in' then p_uid is not null
    when 'role' then p_uid is not null and p_role is not null and p_role = p_target_role
    else false
  end;
$$;

-- Resolve the user behind a device: the caller's JWT first, then the user that
-- last registered the device (lets the JWT-less native poller see
-- logged-in-only broadcasts for its signed-in owner).
create or replace function public.device_owner(p_device_id text)
returns table (uid uuid, role text)
language sql
stable
security definer
set search_path to 'public'
as $$
  with u as (
    select coalesce(
      auth.uid(),
      (select d.user_id from public.app_devices d where d.device_id = p_device_id)
    ) as uid
  )
  select u.uid,
         (select p.role from public.profiles p where p.id = u.uid and p.is_banned = false)
  from u;
$$;

-- recipient_count + sender are always computed server-side.
create or replace function public.broadcast_notifications_before_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.sent_by := auth.uid();
  new.title := btrim(new.title);
  new.body := btrim(new.body);
  new.delivered_count := 0;
  new.read_count := 0;
  if new.target_audience <> 'role' then
    new.target_role := null;
  end if;
  new.recipient_count := (
    select count(*)
    from public.app_devices d
    left join public.profiles p on p.id = d.user_id
    where d.notifications_enabled
      and public.broadcast_targets(new.target_audience, new.target_role, d.user_id, p.role)
  );
  return new;
end;
$$;

drop trigger if exists broadcast_notifications_before_insert on public.broadcast_notifications;
create trigger broadcast_notifications_before_insert
  before insert on public.broadcast_notifications
  for each row execute function public.broadcast_notifications_before_insert();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.app_devices enable row level security;
alter table public.broadcast_notifications enable row level security;
alter table public.user_notification_reads enable row level security;

-- app_devices: written only through register_app_device(); admins can read
-- (stats / push tokens) and clean up.
drop policy if exists app_devices_admin_select on public.app_devices;
create policy app_devices_admin_select on public.app_devices
  for select to authenticated using (public.is_admin());
drop policy if exists app_devices_admin_update on public.app_devices;
create policy app_devices_admin_update on public.app_devices
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists app_devices_admin_delete on public.app_devices;
create policy app_devices_admin_delete on public.app_devices
  for delete to authenticated using (public.is_admin());

-- broadcast_notifications: admin-only writes ('developer' is NOT admin).
drop policy if exists broadcast_admin_insert on public.broadcast_notifications;
create policy broadcast_admin_insert on public.broadcast_notifications
  for insert to authenticated with check (public.is_admin());
drop policy if exists broadcast_admin_update on public.broadcast_notifications;
create policy broadcast_admin_update on public.broadcast_notifications
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists broadcast_admin_delete on public.broadcast_notifications;
create policy broadcast_admin_delete on public.broadcast_notifications
  for delete to authenticated using (public.is_admin());
-- Recipients (anon devices included) may read broadcasts addressed to them.
drop policy if exists broadcast_select_audience on public.broadcast_notifications;
create policy broadcast_select_audience on public.broadcast_notifications
  for select to anon, authenticated
  using (
    public.is_admin()
    or public.broadcast_targets(target_audience, target_role, auth.uid(), public.current_profile_role())
  );

-- user_notification_reads: own rows or admin; writes only through RPCs.
drop policy if exists notification_reads_select on public.user_notification_reads;
create policy notification_reads_select on public.user_notification_reads
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- RPCs (device side)
-- ---------------------------------------------------------------------------

create or replace function public.register_app_device(
  p_device_id text,
  p_platform text default 'android',
  p_app_version text default null,
  p_app_build integer default null,
  p_fcm_token text default null,
  p_notifications_enabled boolean default true
) returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_platform text := case when p_platform in ('android', 'ios', 'web') then p_platform else 'web' end;
  v_token text := nullif(btrim(coalesce(p_fcm_token, '')), '');
  v_row public.app_devices;
begin
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'invalid device id' using errcode = '22023';
  end if;
  if v_token is not null and char_length(v_token) > 4096 then
    v_token := null;
  end if;

  -- An FCM token belongs to exactly one install.
  if v_token is not null then
    update public.app_devices set fcm_token = null
    where fcm_token = v_token and device_id <> p_device_id;
  end if;

  insert into public.app_devices as d
    (device_id, user_id, platform, app_version, app_build, fcm_token, notifications_enabled, last_seen_at)
  values
    (p_device_id, v_uid, v_platform, left(p_app_version, 40), p_app_build, v_token,
     coalesce(p_notifications_enabled, true), now())
  on conflict (device_id) do update set
    user_id = excluded.user_id,
    platform = excluded.platform,
    app_version = coalesce(excluded.app_version, d.app_version),
    app_build = coalesce(excluded.app_build, d.app_build),
    fcm_token = coalesce(excluded.fcm_token, d.fcm_token),
    notifications_enabled = excluded.notifications_enabled,
    last_seen_at = now()
  returning * into v_row;

  return json_build_object('id', v_row.id, 'device_id', v_row.device_id, 'user_id', v_row.user_id);
end;
$$;

-- New broadcasts for a device since a timestamp (used by the Android
-- background poller and the in-app realtime refresh).
create or replace function public.fetch_device_notifications(
  p_device_id text,
  p_since timestamptz default null,
  p_limit integer default 20
) returns table (
  id uuid,
  title text,
  body text,
  category text,
  image_url text,
  action_url text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.title, n.body, n.category, n.image_url, n.action_url, n.created_at, r.read_at
  from public.broadcast_notifications n
  cross join public.device_owner(p_device_id) o
  left join public.user_notification_reads r
    on r.notification_id = n.id and r.device_id = p_device_id
  where n.created_at > coalesce(p_since, now() - interval '3 days')
    and n.created_at > now() - interval '30 days'
    and public.broadcast_targets(n.target_audience, n.target_role, o.uid, o.role)
  order by n.created_at asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Inbox (bell icon): latest broadcasts with per-device read state.
create or replace function public.get_notification_inbox(
  p_device_id text,
  p_limit integer default 50
) returns table (
  id uuid,
  title text,
  body text,
  category text,
  image_url text,
  action_url text,
  created_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select n.id, n.title, n.body, n.category, n.image_url, n.action_url, n.created_at, r.read_at
  from public.broadcast_notifications n
  cross join public.device_owner(p_device_id) o
  left join public.user_notification_reads r
    on r.notification_id = n.id and r.device_id = p_device_id
  where n.created_at > now() - interval '90 days'
    and public.broadcast_targets(n.target_audience, n.target_role, o.uid, o.role)
  order by n.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

create or replace function public.refresh_broadcast_counts(p_ids uuid[])
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.broadcast_notifications n set
    delivered_count = (select count(*) from public.user_notification_reads r where r.notification_id = n.id),
    read_count = (select count(*) from public.user_notification_reads r where r.notification_id = n.id and r.read_at is not null)
  where n.id = any (p_ids);
$$;

-- Receipts only count for registered devices.
create or replace function public.mark_notifications_delivered(p_device_id text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_count integer;
begin
  select d.user_id into v_owner from public.app_devices d where d.device_id = p_device_id;
  if not found or p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  insert into public.user_notification_reads (notification_id, device_id, user_id)
  select n.id, p_device_id, coalesce(auth.uid(), v_owner)
  from public.broadcast_notifications n
  where n.id = any (p_ids[1:100])
  on conflict (notification_id, device_id) do nothing;
  get diagnostics v_count = row_count;
  perform public.refresh_broadcast_counts(p_ids[1:100]);
  return v_count;
end;
$$;

create or replace function public.mark_notifications_read(p_device_id text, p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_owner uuid;
  v_count integer;
begin
  select d.user_id into v_owner from public.app_devices d where d.device_id = p_device_id;
  if not found or p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  insert into public.user_notification_reads as r (notification_id, device_id, user_id, read_at)
  select n.id, p_device_id, coalesce(auth.uid(), v_owner), now()
  from public.broadcast_notifications n
  where n.id = any (p_ids[1:100])
  on conflict (notification_id, device_id) do update set read_at = coalesce(r.read_at, now());
  get diagnostics v_count = row_count;
  perform public.refresh_broadcast_counts(p_ids[1:100]);
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs (admin side)
-- ---------------------------------------------------------------------------

create or replace function public.admin_notification_stats()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return json_build_object(
    'devices_total', (select count(*) from public.app_devices),
    'devices_android', (select count(*) from public.app_devices where platform = 'android'),
    'devices_web', (select count(*) from public.app_devices where platform = 'web'),
    'active_24h', (select count(*) from public.app_devices where last_seen_at > now() - interval '24 hours'),
    'active_7d', (select count(*) from public.app_devices where last_seen_at > now() - interval '7 days'),
    'logged_in', (select count(*) from public.app_devices where user_id is not null),
    'push_ready', (select count(*) from public.app_devices where fcm_token is not null and notifications_enabled),
    'notifications_enabled', (select count(*) from public.app_devices where notifications_enabled),
    'broadcasts_total', (select count(*) from public.broadcast_notifications),
    'broadcasts_7d', (select count(*) from public.broadcast_notifications where created_at > now() - interval '7 days')
  );
end;
$$;

-- Push targets for the FCM sender (/api/admin/notifications/send).
create or replace function public.admin_broadcast_push_targets(p_notification_id uuid)
returns table (device_id text, fcm_token text)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select d.device_id, d.fcm_token
    from public.broadcast_notifications n
    join public.app_devices d on d.fcm_token is not null and d.notifications_enabled
    left join public.profiles p on p.id = d.user_id
    where n.id = p_notification_id
      and public.broadcast_targets(n.target_audience, n.target_role, d.user_id, p.role);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.register_app_device(text, text, text, integer, text, boolean) from public;
revoke all on function public.fetch_device_notifications(text, timestamptz, integer) from public;
revoke all on function public.get_notification_inbox(text, integer) from public;
revoke all on function public.mark_notifications_delivered(text, uuid[]) from public;
revoke all on function public.mark_notifications_read(text, uuid[]) from public;
revoke all on function public.refresh_broadcast_counts(uuid[]) from public, anon, authenticated;
revoke all on function public.device_owner(text) from public, anon, authenticated;
revoke all on function public.admin_notification_stats() from public, anon;
revoke all on function public.admin_broadcast_push_targets(uuid) from public, anon;

grant execute on function public.register_app_device(text, text, text, integer, text, boolean) to anon, authenticated;
grant execute on function public.fetch_device_notifications(text, timestamptz, integer) to anon, authenticated;
grant execute on function public.get_notification_inbox(text, integer) to anon, authenticated;
grant execute on function public.mark_notifications_delivered(text, uuid[]) to anon, authenticated;
grant execute on function public.mark_notifications_read(text, uuid[]) to anon, authenticated;
grant execute on function public.admin_notification_stats() to authenticated;
grant execute on function public.admin_broadcast_push_targets(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: open apps refresh their inbox instantly on new broadcasts.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'broadcast_notifications'
     ) then
    execute 'alter publication supabase_realtime add table public.broadcast_notifications';
  end if;
end;
$$;
