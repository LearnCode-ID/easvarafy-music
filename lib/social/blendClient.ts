import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { apiUrl } from "@/lib/api/base";
import { publicProfileUrl } from "./profilePage";
import {
  buildBlendMix,
  cleanTasteTracks,
  type BlendTrack,
  type TasteTrack,
} from "./blend";
import type { Track } from "@/lib/metrolist/types";
export const BLEND_EVENT = "easvarafy:blends";
export interface BlendMember {
  id: string;
  name: string;
  avatar_url: string | null;
}
export interface BlendPlaylist {
  id: string;
  creator_id: string;
  partner_id: string | null;
  invite_code: string;
  invite_expires_at: string;
  status: "pending" | "active" | "declined";
  match_percent: number;
  shared_artists: string[];
  tracks: BlendTrack[];
  version: number;
  created_at: string;
  updated_at: string;
  last_refreshed_at: string | null;
}
function configured() {
  if (!isSupabaseConfigured) throw new Error("Supabase belum dikonfigurasi.");
}
async function rpc<T>(
  name: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  configured();
  if (typeof navigator !== "undefined" && !navigator.onLine)
    throw new Error("Offline. Perubahan Blend belum tersimpan.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
function changed() {
  window.dispatchEvent(new Event(BLEND_EVENT));
  window.dispatchEvent(new Event("easvarafy:social-notifications"));
}
export async function createBlendInvite(partnerId?: string): Promise<string> {
  const id = await rpc<string>("create_blend_invite", {
    p_partner_id: partnerId || null,
  });
  changed();
  return id;
}
export async function joinBlend(code: string): Promise<string> {
  const id = await rpc<string>("join_blend", {
    p_code: code.trim().toLowerCase(),
  });
  changed();
  return id;
}
export async function leaveBlend(id: string) {
  await rpc("leave_blend", { p_blend_id: id });
  changed();
}
export async function fetchBlends(): Promise<BlendPlaylist[]> {
  configured();
  const { data, error } = await supabase
    .from("blend_playlists")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data as BlendPlaylist[];
}
export async function fetchBlend(
  id: string
): Promise<{ blend: BlendPlaylist; members: BlendMember[] }> {
  configured();
  const { data, error } = await supabase
    .from("blend_playlists")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error("Blend tidak ditemukan atau kamu bukan pesertanya.");
  const members = await rpc<BlendMember[]>("get_blend_members", {
    p_blend_id: id,
  });
  return { blend: data as BlendPlaylist, members };
}
export function blendInviteUrl(
  blend: Pick<BlendPlaylist, "creator_id" | "invite_code">
) {
  return `${
    new URL(publicProfileUrl(blend.creator_id)).origin
  }/blend?code=${encodeURIComponent(blend.invite_code)}`;
}
async function related(
  seed: Track | undefined,
  region: string
): Promise<{ tracks: TasteTrack[]; failed: boolean }> {
  if (!seed) return { tracks: [], failed: false };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const query = new URLSearchParams({
      videoId: seed.videoId,
      mode: "related",
      gl: region,
      strict: "true",
    });
    const res = await fetch(apiUrl(`/api/music/up-next?${query}`), {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("Rekomendasi tidak tersedia");
    const data = await res.json();
    return { tracks: cleanTasteTracks(data.tracks), failed: !!data.degraded };
  } catch {
    return { tracks: [], failed: true };
  } finally {
    clearTimeout(timer);
  }
}
export async function refreshBlend(
  blend: BlendPlaylist,
  actorId: string,
  history: Track[],
  region = "ID"
) {
  const { data: user, error } = await supabase.auth.getUser();
  if (error || user.user?.id !== actorId)
    throw new Error("Sesi berubah. Buka ulang Blend.");
  const tastes = await rpc<Record<string, TasteTrack[]>>("get_blend_tastes", {
    p_blend_id: blend.id,
  });
  if (!blend.partner_id) throw new Error("Teman belum menerima undangan.");
  let a = cleanTasteTracks(tastes[blend.creator_id]),
    b = cleanTasteTracks(tastes[blend.partner_id]);
  const ownHistory = cleanTasteTracks(history).slice(0, 30);
  if (actorId === blend.creator_id) a = cleanTasteTracks([...a, ...ownHistory]);
  else if (actorId === blend.partner_id)
    b = cleanTasteTracks([...b, ...ownHistory]);
  else throw new Error("Kamu bukan peserta Blend.");
  const [ra, rb] = await Promise.all([
    related(a[0], region),
    related(b[0], region),
  ]);
  const mix = buildBlendMix(
    a,
    b,
    blend.creator_id,
    blend.partner_id,
    ra.tracks,
    rb.tracks
  );
  await rpc("save_blend_mix", {
    p_blend_id: blend.id,
    p_version: blend.version,
    p_tracks: mix.tracks,
    p_match: mix.percent,
    p_artists: mix.sharedArtists,
    p_actor_id: actorId,
  });
  changed();
  return {
    warning: !mix.hasEnoughData
      ? "Salah satu peserta belum memiliki cukup data selera. Skor masih 0; tambah lagu disukai lalu refresh."
      : ra.failed || rb.failed
      ? "Racikan tersimpan dari koleksi yang tersedia. Sebagian rekomendasi terkait gagal dimuat."
      : mix.tracks.length < 24
      ? "Racikan tersimpan. Lagu unik yang tersedia belum mencapai 24; tidak ada lagu dummy yang ditambahkan."
      : null,
  };
}
