-- Admin panel is for role 'admin' only.
-- 'developer' is a badge-only role (yellow check) with NO admin privileges.
-- Applied to project kxvckczujvwvfkykofzc on 2026-11-26.

create or replace function public.is_admin(uid uuid default auth.uid())
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin' and p.is_banned = false
  );
$function$;

create or replace function public.admin_user_stats()
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return json_build_object(
    'total', (select count(*) from public.profiles),
    'admins', (select count(*) from public.profiles where role = 'admin'),
    'developers', (select count(*) from public.profiles where role = 'developer'),
    'banned', (select count(*) from public.profiles where is_banned),
    'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'new_30d', (select count(*) from public.profiles where created_at > now() - interval '30 days')
  );
end;
$function$;
