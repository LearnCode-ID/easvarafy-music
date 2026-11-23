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

export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'developer';
}

export function roleLabelOf(role: string | null | undefined): string {
  if (role === 'admin') return 'Admin';
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
