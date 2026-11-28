import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import type { UserRole } from "@/lib/auth/types";

export interface StreakData {
  current: number;
  longest: number;
  active_today: boolean;
  timezone?: string;
  days: { date: string; active: boolean }[];
}
export interface ProfilePageData {
  status: "ok" | "private" | "not_found";
  id?: string;
  name?: string;
  bio?: string;
  avatar_url?: string | null;
  banner_path?: string | null;
  created_at?: string;
  role?: UserRole;
  is_public?: boolean;
  show_stats?: boolean;
  show_badges?: boolean;
  share_friend_activity?: boolean;
  followers_count?: number;
  following_count?: number;
  is_following?: boolean;
  show_streak?: boolean;
  streak?: StreakData | null;
  stats?: { plays: number; seconds: number };
}
export const isUserId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export async function getProfilePage(id: string): Promise<ProfilePageData> {
  if (!isUserId(id)) return { status: "not_found" };
  if (!isSupabaseConfigured) throw new Error("Supabase belum dikonfigurasi.");
  const { data, error } = await supabase.rpc("get_profile_page", {
    p_user_id: id,
  });
  if (error) throw new Error(error.message);
  return data as ProfilePageData;
}

/** No public URLs or long-lived signed URLs: every new download is checked by RLS.
 * The caller owns/revokes the returned object URL. Previously downloaded bytes
 * cannot be recalled; the view revalidates every 30 seconds and on focus. */
export async function resolveProfileImage(
  reference?: string | null,
  banner = false
): Promise<string | null> {
  if (!reference) return null;
  let bucket = "profile-media";
  let path = reference;
  if (reference.startsWith("profile-media:")) path = reference.slice(14);
  else if (reference.includes("/avatars/")) {
    bucket = "avatars";
    path = decodeURIComponent(reference.split("/avatars/")[1].split("?")[0]);
  } else if (/^https?:/.test(reference)) return banner ? null : reference;
  else if (!banner) return null;
  const { data, error } = await supabase.storage
    .from(bucket)
    .download(path, {}, { cache: "no-store" });
  if (error) return null;
  return URL.createObjectURL(data);
}
export function releaseImage(url?: string | null) {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}
export async function uploadProfileMedia(
  userId: string,
  blob: Blob,
  kind: "banner" | "avatar"
) {
  const path = `${userId}/${kind}-${crypto.randomUUID()}.webp`;
  const { error } = await supabase.storage
    .from("profile-media")
    .upload(path, blob, {
      contentType: "image/webp",
      cacheControl: "0",
      upsert: false,
    });
  if (error) throw new Error(error.message);
  return path;
}
export function publicProfileUrl(id: string): string {
  const configured =
    process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_API_BASE;
  const native =
    typeof window !== "undefined" &&
    Boolean(
      (
        window as unknown as {
          Capacitor?: { isNativePlatform?: () => boolean };
        }
      ).Capacitor?.isNativePlatform?.()
    );
  const origin =
    configured ||
    (!native &&
    typeof window !== "undefined" &&
    !["localhost", "127.0.0.1"].includes(window.location.hostname)
      ? window.location.origin
      : "");
  if (!origin || !/^https:\/\//.test(origin))
    throw new Error(
      "Atur NEXT_PUBLIC_APP_URL ke domain web HTTPS untuk membagikan profil."
    );
  const parsed = new URL(origin);
  if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    throw new Error(
      "Domain berbagi harus berupa domain web publik, bukan alamat lokal APK."
    );
  return `${parsed.origin}/profile/${id}`;
}

export async function cropProfileImage(
  src: string,
  aspect: number,
  x: number,
  y: number,
  zoom: number
): Promise<Blob> {
  const image = new Image();
  image.src = src;
  await image.decode();
  if (image.naturalWidth * image.naturalHeight > 60_000_000)
    throw new Error("Resolusi gambar terlalu besar.");
  const sw = Math.min(image.naturalWidth, image.naturalHeight * aspect) / zoom;
  const sh = sw / aspect;
  const canvas = document.createElement("canvas");
  canvas.width = aspect === 1 ? 512 : 1600;
  canvas.height = Math.round(canvas.width / aspect);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Pengolah gambar tidak tersedia.");
  ctx.drawImage(
    image,
    ((image.naturalWidth - sw) * x) / 100,
    ((image.naturalHeight - sh) * y) / 100,
    sw,
    sh,
    0,
    0,
    canvas.width,
    canvas.height
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.84)
  );
  if (!blob || blob.size > 5 * 1024 * 1024)
    throw new Error("Gagal mengompres gambar hingga 5 MB.");
  return blob;
}
export function validateProfileFile(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Gunakan JPG, PNG, atau WebP.");
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Ukuran file maksimal 10 MB.");
}
