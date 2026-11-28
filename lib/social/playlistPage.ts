import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { playlistFromRow } from "./community";
import { getProfilePage, publicProfileUrl } from "./profilePage";
import type { UserPlaylist } from "@/lib/metrolist/types";

// Existing playlist IDs include legacy slugs as well as generated UUIDs.
export const isPlaylistId = (id: string) =>
  /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(id);
export function playlistPath(id: string, native = false): string {
  if (!isPlaylistId(id)) throw new Error("ID playlist tidak valid.");
  return native
    ? `/playlist/?id=${encodeURIComponent(id)}`
    : `/playlist/${encodeURIComponent(id)}`;
}
export function publicPlaylistUrl(id: string): string {
  // Reuse the canonical HTTPS origin validation used by profile sharing.
  return new URL(playlistPath(id), publicProfileUrl("")).href;
}
export interface PlaylistPageData {
  playlist: UserPlaylist;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string | null;
}
/** RLS is authoritative: owner OR public playlist under a public profile.
 * Never fetch by service role, change privacy, or cache private route data. */
export async function getPlaylistPage(
  id: string
): Promise<PlaylistPageData | null> {
  if (!isPlaylistId(id)) return null;
  if (!isSupabaseConfigured) throw new Error("Supabase belum dikonfigurasi.");
  const { data, error } = await supabase
    .from("user_playlists")
    .select(
      "id,user_id,name,description,tags,tracks,cover_url,is_public,version,created_at,updated_at"
    )
    .eq("id", id)
    .limit(2);
  if (error) throw new Error(error.message);
  // IDs historically have a composite owner/id key. Do not guess an owner if
  // two accessible legacy IDs collide; normal UUID-created playlists are unique.
  if (!data || data.length !== 1) return null;
  const row = data[0];
  const profile = await getProfilePage(String(row.user_id));
  if (profile.status !== "ok") return null;
  return {
    playlist: playlistFromRow(row),
    ownerId: String(row.user_id),
    ownerName: profile.name || "Pendengar",
    ownerAvatar: profile.avatar_url || null,
  };
}
