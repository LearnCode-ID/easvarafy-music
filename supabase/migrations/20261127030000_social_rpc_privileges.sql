-- Supabase projects can directly grant EXECUTE to anon via default privileges.
-- Revoking only PUBLIC does not remove those inherited creation-time grants.
-- Keep explicitly public profile/count/list RPCs callable by guests; require
-- authentication for personal writes, private activity and all Blend operations.
begin;
revoke execute on function
 public.record_daily_activity(text),
 public.save_user_playlist(jsonb,integer),
 public.get_following_feed(integer,integer),
 public.create_blend_invite(uuid),
 public.join_blend(text),
 public.leave_blend(uuid),
 public.get_blend_members(uuid),
 public.get_blend_tastes(uuid),
 public.save_blend_mix(uuid,integer,jsonb,integer,jsonb,uuid),
 public.read_social_notifications(uuid[])
from public,anon;
grant execute on function
 public.record_daily_activity(text),
 public.save_user_playlist(jsonb,integer),
 public.get_following_feed(integer,integer),
 public.create_blend_invite(uuid),
 public.join_blend(text),
 public.leave_blend(uuid),
 public.get_blend_members(uuid),
 public.get_blend_tastes(uuid),
 public.save_blend_mix(uuid,integer,jsonb,integer,jsonb,uuid),
 public.read_social_notifications(uuid[])
to authenticated;
-- Explicit column-level follow inserts, even with permissive table defaults.
revoke all on public.user_follows from anon,authenticated;
grant select on public.user_follows to anon,authenticated;
grant insert(follower_id,following_id),delete on public.user_follows to authenticated;
commit;
