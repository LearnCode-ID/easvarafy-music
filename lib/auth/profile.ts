import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from './types';

const PROFILE_COLUMNS = 'id, email, name, avatar_url, role, is_banned, created_at';
const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
const AVATAR_OUTPUT_SIZE = 512;

/** Fetch the profile row (role included) for a given auth user id. */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!isSupabaseConfigured || !userId) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    // Profiles row may not exist yet (e.g. older Google accounts) — don't throw.
    console.warn('fetchProfile failed:', error.message);
    return null;
  }
  return (data as Profile | null) ?? null;
}

/** Where should this role land after login? */
export function homeForRole(role: UserRole | null | undefined): string {
  return role === 'admin' ? '/admin/dashboard' : '/';
}

/**
 * Resolve the post-login destination from the profiles table.
 * Returns '/login' if there is no session.
 */
export async function resolveDestinationAfterLogin(): Promise<string> {
  if (!isSupabaseConfigured) return '/';
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return '/login';
  const profile = await fetchProfile(user.id);
  return homeForRole(profile?.role ?? 'user');
}

/** Ensure a profiles row exists for the current auth user (idempotent). */
export async function ensureProfile(params?: {
  name?: string;
  avatarUrl?: string | null;
}): Promise<Profile | null> {
  if (!isSupabaseConfigured) return null;
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;

  const existing = await fetchProfile(user.id);
  if (existing) {
    const patch: Partial<Profile> = {};
    if (!existing.name && params?.name) patch.name = params.name;
    if (!existing.avatar_url && params?.avatarUrl) patch.avatar_url = params.avatarUrl;
    if (Object.keys(patch).length > 0) {
      const { data: updated } = await supabase
        .from('profiles')
        .update(patch)
        .eq('id', user.id)
        .select(PROFILE_COLUMNS)
        .maybeSingle();
      return (updated as Profile | null) ?? existing;
    }
    return existing;
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metaName =
    typeof metadata.name === 'string'
      ? metadata.name
      : typeof metadata.full_name === 'string'
        ? metadata.full_name
        : null;
  const metaAvatar =
    typeof metadata.avatar_url === 'string'
      ? metadata.avatar_url
      : typeof metadata.picture === 'string'
        ? metadata.picture
        : null;

  const insertPayload = {
    id: user.id,
    email: user.email ?? null,
    name: params?.name ?? metaName ?? (user.email ? user.email.split('@')[0] : null),
    avatar_url: params?.avatarUrl ?? metaAvatar,
    role: 'user' as const,
  };

  const { data: inserted, error } = await supabase
    .from('profiles')
    .insert(insertPayload)
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) {
    console.warn('ensureProfile insert failed:', error.message);
    return fetchProfile(user.id);
  }
  return (inserted as Profile | null) ?? null;
}

/** Update the signed-in user's own `name` and/or `avatar_url`. */
export async function updateOwnProfile(patch: {
  name?: string;
  avatar_url?: string | null;
}): Promise<{ profile?: Profile | null; error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase belum dikonfigurasi.' };
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return { error: 'Sesi login tidak ditemukan. Silakan masuk ulang.' };
  }

  // Ensure profile row exists before updating
  await ensureProfile();

  const dbPatch: { name?: string; avatar_url?: string | null } = {};
  const metaPatch: Record<string, string | null> = {};

  if (patch.name !== undefined) {
    const trimmed = patch.name.trim();
    if (!trimmed) return { error: 'Nama panggilan tidak boleh kosong.' };
    if (trimmed.length > 50) return { error: 'Nama panggilan maksimal 50 karakter.' };
    dbPatch.name = trimmed;
    metaPatch.name = trimmed;
    metaPatch.full_name = trimmed;
  }

  if (patch.avatar_url !== undefined) {
    dbPatch.avatar_url = patch.avatar_url;
    metaPatch.avatar_url = patch.avatar_url;
  }

  if (Object.keys(dbPatch).length === 0) {
    const current = await fetchProfile(user.id);
    return { profile: current };
  }

  const { data: updated, error } = await supabase
    .from('profiles')
    .update(dbPatch)
    .eq('id', user.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();

  if (error) {
    return { error: error.message || 'Gagal memperbarui profil.' };
  }

  // Best-effort sync to auth user_metadata so metadata stays consistent
  if (Object.keys(metaPatch).length > 0) {
    await supabase.auth.updateUser({ data: metaPatch }).catch(() => {});
  }

  return { profile: (updated as Profile | null) ?? (await fetchProfile(user.id)) };
}

/** Center-crop and resize an image file into a compact square blob for avatar upload. */
async function prepareAvatarBlob(
  file: File
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  // Keep animated GIFs or SVGs as-is if small enough, or fall back if canvas fails
  if (file.type === 'image/gif') {
    return { blob: file, ext: 'gif', contentType: 'image/gif' };
  }

  if (typeof document === 'undefined') {
    const ext = file.type.split('/')[1] || 'png';
    return { blob: file, ext, contentType: file.type || 'image/png' };
  }

  try {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Gagal membaca gambar.'));
        image.src = objectUrl;
      });

      const size = Math.min(AVATAR_OUTPUT_SIZE, Math.max(img.naturalWidth, img.naturalHeight));
      const targetSize = Math.max(256, size);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        const ext = file.type.split('/')[1] || 'png';
        return { blob: file, ext, contentType: file.type || 'image/png' };
      }

      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/webp', 0.88)
      );
      if (blob) {
        return { blob, ext: 'webp', contentType: 'image/webp' };
      }

      const jpegBlob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88)
      );
      if (jpegBlob) {
        return { blob: jpegBlob, ext: 'jpg', contentType: 'image/jpeg' };
      }
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch {
    // Fall back to original file
  }

  const ext = file.type.split('/')[1] || 'png';
  return { blob: file, ext, contentType: file.type || 'image/png' };
}

/** Delete previously uploaded avatar files in this user's storage folder (best-effort). */
async function clearPreviousAvatarFiles(userId: string, keepPath?: string): Promise<void> {
  try {
    const { data: files } = await supabase.storage.from(AVATAR_BUCKET).list(userId);
    if (!files || files.length === 0) return;
    const toRemove = files
      .map((f) => `${userId}/${f.name}`)
      .filter((p) => p !== keepPath);
    if (toRemove.length > 0) {
      await supabase.storage.from(AVATAR_BUCKET).remove(toRemove);
    }
  } catch {
    /* non-fatal cleanup */
  }
}

/** Upload an image file to Supabase Storage (`avatars`) and save its public URL on `profiles`. */
export async function uploadOwnAvatar(
  file: File
): Promise<{ profile?: Profile | null; error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase belum dikonfigurasi.' };
  }
  if (!file.type.startsWith('image/')) {
    return { error: 'File harus berupa gambar (PNG, JPG, WebP, atau GIF).' };
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES * 2) {
    return { error: 'Ukuran file terlalu besar (maksimal 10 MB sebelum kompresi).' };
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return { error: 'Sesi login tidak ditemukan. Silakan masuk ulang.' };
  }

  const { blob, ext, contentType } = await prepareAvatarBlob(file);
  if (blob.size > MAX_AVATAR_UPLOAD_BYTES) {
    return { error: 'Ukuran gambar setelah kompresi masih melebihi 5 MB.' };
  }

  const filePath = `${user.id}/avatar-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(filePath, blob, {
      contentType,
      upsert: true,
      cacheControl: '3600',
    });

  if (uploadError) {
    return { error: uploadError.message || 'Gagal mengunggah avatar ke penyimpanan.' };
  }

  const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(filePath);
  const publicUrl = urlData?.publicUrl;
  if (!publicUrl) {
    return { error: 'Gagal mendapatkan URL publik avatar.' };
  }

  const result = await updateOwnProfile({ avatar_url: publicUrl });
  if (!result.error) {
    void clearPreviousAvatarFiles(user.id, filePath);
  }
  return result;
}

/** Remove the user's avatar from storage and reset `profiles.avatar_url` to null. */
export async function removeOwnAvatar(): Promise<{
  profile?: Profile | null;
  error?: string;
}> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase belum dikonfigurasi.' };
  }
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return { error: 'Sesi login tidak ditemukan. Silakan masuk ulang.' };
  }

  await clearPreviousAvatarFiles(user.id);
  return updateOwnProfile({ avatar_url: null });
}
