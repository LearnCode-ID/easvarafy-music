import {
  resolveProfileImage,
  validateProfileFile,
  cropProfileImage,
  uploadProfileMedia,
} from '@/lib/social/profilePage';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { Profile, UserRole } from './types';

const PROFILE_COLUMNS = 'id, email, name, avatar_url, role, is_banned, created_at';
const AVATAR_BUCKET = 'profile-media';

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
  if (!data) return null;
  const profile = data as Profile;
  return {
    ...profile,
    avatar_url: await resolveProfileImage(profile.avatar_url),
  };
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
    if (
      patch.avatar_url &&
      !patch.avatar_url.startsWith('https://') &&
      !patch.avatar_url.startsWith(`profile-media:${user.id}/`)
    ) {
      return {
        error:
          'Gunakan URL gambar HTTPS atau unggah gambar. URL preview lokal tidak dapat disimpan.',
      };
    }
    dbPatch.avatar_url = patch.avatar_url;
    metaPatch.avatar_url = patch.avatar_url;
  }

  if (Object.keys(dbPatch).length === 0) {
    const current = await fetchProfile(user.id);
    return { profile: current };
  }

  const { error } = await supabase
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

  return { profile: await fetchProfile(user.id) };
}

/** Reuse the same validated canvas/compression pipeline as the profile editor. */
async function prepareAvatarBlob(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    return await cropProfileImage(url, 1, 50, 50, 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Delete previously uploaded avatar files in this user's storage folder (best-effort). */
async function clearPreviousAvatarFiles(userId: string, keepPath?: string): Promise<void> {
  try {
    const { data: files } = await supabase.storage.from(AVATAR_BUCKET).list(userId);
    if (!files || files.length === 0) return;
    const toRemove = files
      .map((f) => `${userId}/${f.name}`)
      .filter((p) => p !== keepPath && p.split('/').pop()?.startsWith('avatar-'));
    if (toRemove.length > 0) {
      await supabase.storage.from(AVATAR_BUCKET).remove(toRemove);
    }
  } catch {
    /* non-fatal cleanup */
  }
}

/** Upload to private profile-media storage and save only its object reference. */
export async function uploadOwnAvatar(
  file: File
): Promise<{ profile?: Profile | null; error?: string }> {
  if (!isSupabaseConfigured) {
    return { error: 'Supabase belum dikonfigurasi.' };
  }
  try {
    validateProfileFile(file);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'File tidak valid.' };
  }

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) {
    return { error: 'Sesi login tidak ditemukan. Silakan masuk ulang.' };
  }

  let filePath: string;
  try {
    filePath = await uploadProfileMedia(user.id, await prepareAvatarBlob(file), 'avatar');
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Gagal mengunggah avatar.',
    };
  }
  const result = await updateOwnProfile({
    avatar_url: `profile-media:${filePath}`,
  });
  if (result.error) await supabase.storage.from(AVATAR_BUCKET).remove([filePath]);
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

  const result = await updateOwnProfile({ avatar_url: null });
  if (!result.error) await clearPreviousAvatarFiles(user.id);
  return result;
}
