export type UserRole = 'user' | 'admin' | 'developer';

export interface Profile {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_banned: boolean;
  created_at: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
}

/**
 * Only the `admin` role may open the admin panel (/admin/*).
 * `developer` is a badge role only (yellow check) and has NO admin access.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin';
}

/**
 * Whether the admin-panel UI (Admin Dashboard / Admin Console shortcuts) may be
 * shown. Strictly role `admin` and not banned — developers never see it.
 */
export function canSeeAdminUi(
  role: string | null | undefined,
  isBanned?: boolean | null
): boolean {
  return role === 'admin' && !isBanned;
}

/** Internal role label, used only inside the admin panel. */
export function roleLabelOf(role: string | null | undefined): string {
  if (role === 'admin') return 'Admin';
  if (role === 'developer') return 'Developer';
  return 'Member';
}

/**
 * Public label shown next to the verified badge everywhere outside the admin
 * panel. The blue check means "Akun Terverifikasi" — it never reveals that an
 * account is an admin.
 */
export function publicRoleLabelOf(role: string | null | undefined): string {
  if (role === 'admin') return 'Terverifikasi';
  if (role === 'developer') return 'Developer';
  return 'Member';
}

export function displayNameOf(profile: Profile | null, fallbackEmail?: string | null): string {
  if (profile?.name && profile.name.trim()) return profile.name.trim();
  if (profile?.email) return profile.email.split('@')[0];
  if (fallbackEmail) return fallbackEmail.split('@')[0];
  return 'Listener';
}

export function initialsOf(value: string | null | undefined): string {
  const source = (value || 'E').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'E';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
