import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { Track } from "@/lib/metrolist/types";
import type { UserRole } from "@/lib/auth/types";

export const FOLLOW_EVENT = "easvarafy:follows";
export interface FollowStatus {
  followers_count: number;
  following_count: number;
  is_following: boolean;
}
export interface FollowPerson {
  id: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  is_private: boolean;
  is_following: boolean;
}
export interface FriendActivity {
  user_id: string;
  name: string;
  avatar_url: string | null;
  role: UserRole;
  is_private: boolean;
  last_track: Track | null;
  last_played_at: string | null;
  playlist: {
    id: string;
    name: string;
    cover_url: string | null;
    updated_at: string;
  } | null;
}
function configured() {
  if (!isSupabaseConfigured) throw new Error("Supabase belum dikonfigurasi.");
}
async function ownId() {
  configured();
  if (typeof navigator !== "undefined" && !navigator.onLine)
    throw new Error("Offline. Perubahan follow belum disimpan.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Masuk terlebih dahulu.");
  return data.user.id;
}
export async function followUser(targetUserId: string) {
  const uid = await ownId();
  if (uid === targetUserId)
    throw new Error("Tidak bisa mengikuti diri sendiri.");
  const { error } = await supabase
    .from("user_follows")
    .upsert(
      { follower_id: uid, following_id: targetUserId },
      { onConflict: "follower_id,following_id", ignoreDuplicates: true }
    );
  if (error) throw new Error(error.message);
  window.dispatchEvent(
    new CustomEvent(FOLLOW_EVENT, { detail: { targetUserId } })
  );
}
export async function unfollowUser(targetUserId: string) {
  const uid = await ownId();
  const { error } = await supabase
    .from("user_follows")
    .delete()
    .eq("follower_id", uid)
    .eq("following_id", targetUserId);
  if (error) throw new Error(error.message);
  window.dispatchEvent(
    new CustomEvent(FOLLOW_EVENT, { detail: { targetUserId } })
  );
}
export async function fetchFollowStatus(
  targetUserId: string
): Promise<FollowStatus> {
  configured();
  const { data, error } = await supabase.rpc("get_follow_counts", {
    p_user_id: targetUserId,
  });
  if (error) throw new Error(error.message);
  return data as FollowStatus;
}
async function fetchList(
  userId: string,
  direction: string,
  offset = 0
): Promise<FollowPerson[]> {
  configured();
  const { data, error } = await supabase.rpc("get_follow_list", {
    p_user_id: userId,
    p_direction: direction,
    p_offset: offset,
    p_limit: 30,
  });
  if (error) throw new Error(error.message);
  return data as FollowPerson[];
}
export const fetchFollowersList = (userId: string, offset = 0) =>
  fetchList(userId, "followers", offset);
export const fetchFollowingList = (userId: string, offset = 0) =>
  fetchList(userId, "following", offset);
export async function fetchFollowingFeed(
  offset = 0
): Promise<FriendActivity[]> {
  configured();
  const { data, error } = await supabase.rpc("get_following_feed", {
    p_offset: offset,
    p_limit: 30,
  });
  if (error) throw new Error(error.message);
  return data as FriendActivity[];
}
