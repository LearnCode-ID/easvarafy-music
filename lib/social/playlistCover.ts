import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { isUserId } from "./profilePage";

export const PLAYLIST_COVER_PREFIX = "playlist-covers:";
export function playlistCoverPath(reference?: string | null): string | null {
  if (!reference?.startsWith(PLAYLIST_COVER_PREFIX)) return null;
  const path = reference.slice(PLAYLIST_COVER_PREFIX.length);
  const parts = path.split("/");
  const [owner, file] = parts;
  return isUserId(owner || "") &&
    parts.length === 2 &&
    /^cover-[0-9a-f-]{36}\.(webp|png|jpg)$/i.test(file || "")
    ? path
    : null;
}

export async function uploadPlaylistCover(
  userId: string,
  blob: Blob
): Promise<string> {
  if (!isSupabaseConfigured || !isUserId(userId))
    throw new Error("Masuk untuk mengunggah cover playlist.");
  const extension = (
    { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" } as Record<
      string,
      string
    >
  )[blob.type];
  if (!extension || !blob.size || blob.size > 5 * 1024 * 1024)
    throw new Error(
      "Cover harus JPG, PNG, atau WebP maksimal 5 MB setelah kompresi."
    );
  const path = `${userId}/cover-${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage
    .from("playlist-covers")
    .upload(path, blob, {
      contentType: blob.type,
      cacheControl: "0",
      upsert: false,
    });
  if (error) throw new Error(error.message);
  return `${PLAYLIST_COVER_PREFIX}${path}`;
}

/** Authenticated download enforces current playlist/profile visibility on each read. */
export async function resolvePlaylistCover(
  reference: string
): Promise<string | null> {
  const path = playlistCoverPath(reference);
  if (!path || !isSupabaseConfigured) return null;
  const { data, error } = await supabase.storage
    .from("playlist-covers")
    .download(path, {}, { cache: "no-store" });
  return error || !data ? null : URL.createObjectURL(data);
}
