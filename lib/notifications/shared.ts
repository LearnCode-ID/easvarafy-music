/**
 * Shared, framework-free helpers for broadcast notifications (admin composer,
 * user inbox, the FCM send route and unit tests).
 */
import type { NavTab } from '@/lib/metrolist/types';

export type NotificationCategory = 'info' | 'story' | 'music' | 'promo' | 'update';
export type NotificationAudience = 'all' | 'logged_in' | 'role';
export type NotificationTargetRole = 'user' | 'admin' | 'developer';
export type PushStatus = 'pending' | 'sent' | 'partial' | 'skipped' | 'failed';

export const NOTIFICATION_CATEGORIES: ReadonlyArray<{
  id: NotificationCategory;
  label: string;
  color: string;
}> = [
  { id: 'info', label: 'Pengumuman', color: '#7C5CFF' },
  { id: 'story', label: 'Story', color: '#EC4899' },
  { id: 'music', label: 'Rilis Baru', color: '#22C55E' },
  { id: 'promo', label: 'Promo', color: '#F59E0B' },
  { id: 'update', label: 'Update', color: '#3B82F6' },
];

export function categoryMeta(category: string | null | undefined) {
  return NOTIFICATION_CATEGORIES.find((c) => c.id === category) ?? NOTIFICATION_CATEGORIES[0];
}

export const AUDIENCE_LABELS: Record<NotificationAudience, string> = {
  all: 'Semua perangkat',
  logged_in: 'Pengguna login',
  role: 'Role tertentu',
};

export const ROLE_LABELS: Record<NotificationTargetRole, string> = {
  user: 'Member',
  admin: 'Admin',
  developer: 'Developer',
};

export function audienceLabel(audience: string, role?: string | null): string {
  if (audience === 'role' && role && role in ROLE_LABELS) {
    return `Role: ${ROLE_LABELS[role as NotificationTargetRole]}`;
  }
  return AUDIENCE_LABELS[audience as NotificationAudience] ?? audience;
}

/** Deep-link presets offered in the admin composer. */
export const DEEP_LINK_PRESETS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '/', label: 'Beranda' },
  { value: '/explore', label: 'Jelajah / Cari' },
  { value: '/?tab=charts', label: 'Chart' },
  { value: '/?tab=library', label: 'Library' },
  { value: '/?tab=settings', label: 'Pengaturan' },
];

const TAB_ALIASES: Record<string, NavTab> = {
  '': 'home',
  home: 'home',
  beranda: 'home',
  explore: 'search',
  search: 'search',
  cari: 'search',
  jelajah: 'search',
  charts: 'charts',
  chart: 'charts',
  library: 'library',
  listeners: 'listeners',
  settings: 'settings',
  pengaturan: 'settings',
};

export type NotificationTarget =
  | { kind: 'tab'; tab: NavTab }
  | { kind: 'path'; path: string }
  | { kind: 'external'; url: string }
  | { kind: 'none' };

/**
 * Maps a broadcast `action_url` to an in-app destination:
 *  "/", "/explore", "/search", "/?tab=charts", "/library" -> tab
 *  "/login", "/reset-password" (other app routes)         -> path
 *  "https://…"                                            -> external (in-app browser)
 */
export function resolveNotificationTarget(actionUrl: string | null | undefined): NotificationTarget {
  const raw = (actionUrl ?? '').trim();
  if (!raw) return { kind: 'none' };
  if (/^https:\/\//i.test(raw)) return { kind: 'external', url: raw };
  if (!raw.startsWith('/') || raw.startsWith('//')) return { kind: 'none' };

  let url: URL;
  try {
    url = new URL(raw, 'https://app.local');
  } catch {
    return { kind: 'none' };
  }
  const tabParam = url.searchParams.get('tab')?.toLowerCase();
  const segment = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (segment === '' || segment in TAB_ALIASES) {
    const tab = (tabParam && TAB_ALIASES[tabParam]) || TAB_ALIASES[segment] || 'home';
    return { kind: 'tab', tab };
  }
  return { kind: 'path', path: `${url.pathname}${url.search}${url.hash}` };
}

export interface ComposerInput {
  title: string;
  body: string;
  category: string;
  imageUrl: string;
  actionUrl: string;
  audience: string;
  targetRole: string;
}

export interface ValidComposerInput {
  title: string;
  body: string;
  category: NotificationCategory;
  image_url: string | null;
  action_url: string | null;
  target_audience: NotificationAudience;
  target_role: NotificationTargetRole | null;
}

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;

/** Mirrors the DB check constraints so the admin gets errors before sending. */
export function validateComposer(
  input: ComposerInput
): { ok: true; value: ValidComposerInput } | { ok: false; errors: Partial<Record<keyof ComposerInput, string>> } {
  const errors: Partial<Record<keyof ComposerInput, string>> = {};
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) errors.title = 'Judul wajib diisi';
  else if (title.length > TITLE_MAX) errors.title = `Maksimal ${TITLE_MAX} karakter`;
  if (!body) errors.body = 'Isi notifikasi wajib diisi';
  else if (body.length > BODY_MAX) errors.body = `Maksimal ${BODY_MAX} karakter`;

  const category = NOTIFICATION_CATEGORIES.some((c) => c.id === input.category)
    ? (input.category as NotificationCategory)
    : null;
  if (!category) errors.category = 'Kategori tidak valid';

  const imageUrl = input.imageUrl.trim();
  if (imageUrl) {
    try {
      const u = new URL(imageUrl);
      if (u.protocol !== 'https:') errors.imageUrl = 'Gambar harus memakai https://';
    } catch {
      errors.imageUrl = 'URL gambar tidak valid';
    }
  }

  const actionUrl = input.actionUrl.trim();
  if (actionUrl && resolveNotificationTarget(actionUrl).kind === 'none') {
    errors.actionUrl = 'Gunakan path aplikasi (mis. /explore) atau URL https://';
  }

  const audience = (['all', 'logged_in', 'role'] as const).find((a) => a === input.audience) ?? null;
  if (!audience) errors.audience = 'Target tidak valid';
  const role = (['user', 'admin', 'developer'] as const).find((r) => r === input.targetRole) ?? null;
  if (audience === 'role' && !role) errors.targetRole = 'Pilih role tujuan';

  if (Object.keys(errors).length > 0 || !category || !audience) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      body,
      category,
      image_url: imageUrl || null,
      action_url: actionUrl || null,
      target_audience: audience,
      target_role: audience === 'role' ? role : null,
    },
  };
}

export interface InboxItem {
  source?: 'broadcast' | 'social';
  id: string;
  title: string;
  body: string;
  category: NotificationCategory;
  image_url: string | null;
  action_url: string | null;
  created_at: string;
  read_at: string | null;
}

/** Relative time in Indonesian: "baru saja", "5 mnt", "3 jam", "2 hari", "12 Nov". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 3600) return `${Math.floor(diff / 60)} mnt lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)} hari lalu`;
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/** Merges inbox lists (newest first, unique by id, newest read state wins). */
export function mergeInbox(current: InboxItem[], incoming: InboxItem[], limit = 100): InboxItem[] {
  const map = new Map<string, InboxItem>();
  for (const item of current) map.set(item.id, item);
  for (const item of incoming) {
    const prev = map.get(item.id);
    map.set(item.id, prev ? { ...prev, ...item, read_at: item.read_at ?? prev.read_at } : item);
  }
  return [...map.values()]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, limit);
}
