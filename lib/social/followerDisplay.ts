import type { UserRole } from '@/lib/auth/types';

/** Cosmetic admin-profile label only. Never use this value for relationships,
 * follower lists, authorization, ranking, feeds, or persisted follow counts.
 * A hidden public role must not be inferred from other profile attributes. */
export function followerDisplay(count: number | null | undefined, visibleRole?: UserRole) {
  if (visibleRole === 'admin') {
    return {
      label: '1,2 jt',
      note: 'Angka tampilan profil admin. Daftar pengikut menampilkan akun yang benar-benar mengikuti.',
    };
  }
  return { label: count == null ? '…' : String(count), note: undefined };
}
