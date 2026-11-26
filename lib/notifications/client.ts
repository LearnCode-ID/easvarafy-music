'use client';

/**
 * Client side of broadcast notifications:
 *  - per-install device id + auto registration/heartbeat (guest or logged in)
 *  - inbox (bell icon) with per-device read state
 *  - Supabase Realtime while the app is open (and while the WebView keeps
 *    running in the background during playback -> native notification)
 *  - FCM push registration when the APK ships google-services.json
 *  - tap/deep-link handling for every delivery path
 */
import { useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import { APP_PACKAGE_VERSION } from '@/lib/app/release';
import { getInstalledAppInfo } from '@/lib/app/updateCheck';
import type { NavTab } from '@/lib/metrolist/types';
import {
  hasNativeNotify,
  isNativeAndroid,
  nativeConfigure,
  nativeGetDeviceId,
  nativeMarkSeen,
  nativeShow,
  nativeStatus,
  onNativeNotificationOpened,
} from '@/lib/native/notifications';
import { mergeInbox, resolveNotificationTarget, type InboxItem } from './shared';

const DEVICE_KEY = 'easvarafy_device_id_v1';
const FCM_TOKEN_KEY = 'easvarafy_fcm_token_v1';

export interface NotificationState {
  deviceId: string | null;
  registered: boolean;
  items: InboxItem[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  /** Newest notification that arrived while the app was open (in-app banner). */
  incoming: InboxItem | null;
}

let state: NotificationState = {
  deviceId: null,
  registered: false,
  items: [],
  loading: false,
  loaded: false,
  error: null,
  incoming: null,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<NotificationState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useNotifications(): NotificationState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}

export function unreadCount(items: InboxItem[]): number {
  return items.reduce((n, item) => n + (item.read_at ? 0 : 1), 0);
}

/* ------------------------------------------------------------------ device */

function randomId(prefix: string): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${prefix}${b64}`;
}

let deviceIdPromise: Promise<string> | null = null;

export function getDeviceId(): Promise<string> {
  if (!deviceIdPromise) {
    deviceIdPromise = (async () => {
      // Native: one id per install, shared with the background poller.
      const native = await nativeGetDeviceId();
      if (native) {
        try {
          localStorage.setItem(DEVICE_KEY, native);
        } catch {
          // ignore
        }
        return native;
      }
      try {
        const stored = localStorage.getItem(DEVICE_KEY);
        if (stored && /^[A-Za-z0-9_-]{8,128}$/.test(stored)) return stored;
      } catch {
        // ignore
      }
      const id = randomId(isNativeAndroid() ? 'and_' : 'web_');
      try {
        localStorage.setItem(DEVICE_KEY, id);
      } catch {
        // ignore
      }
      return id;
    })();
  }
  return deviceIdPromise;
}

function storedFcmToken(): string | null {
  try {
    return localStorage.getItem(FCM_TOKEN_KEY);
  } catch {
    return null;
  }
}

let registering: Promise<void> | null = null;
let lastRegisterAt = 0;

/** Upserts this install in app_devices (also the heartbeat). */
export function registerDevice(options: { force?: boolean } = {}): Promise<void> {
  if (!isSupabaseConfigured) return Promise.resolve();
  if (!options.force && Date.now() - lastRegisterAt < 60_000 && state.registered) return Promise.resolve();
  if (registering) return registering;
  registering = (async () => {
    try {
      const deviceId = await getDeviceId();
      setState({ deviceId });
      const installed = await getInstalledAppInfo();
      const status = await nativeStatus();
      const supabase = getSupabase();
      const { error } = await supabase.rpc('register_app_device', {
        p_device_id: deviceId,
        p_platform: isNativeAndroid() ? 'android' : 'web',
        p_app_version: installed?.version ?? APP_PACKAGE_VERSION,
        p_app_build: installed?.build ?? null,
        p_fcm_token: storedFcmToken(),
        p_notifications_enabled: status ? status.permission === 'granted' : true,
      });
      if (error) throw error;
      lastRegisterAt = Date.now();
      setState({ registered: true, error: null });
      // Hand the Supabase config to the native background poller.
      if (hasNativeNotify()) {
        await nativeConfigure({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
          anonKey:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
          enabled: true,
          appVersion: installed?.version,
        });
      }
      await refreshInbox();
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : 'Gagal mendaftarkan perangkat' });
    } finally {
      registering = null;
    }
  })();
  return registering;
}

/* ------------------------------------------------------------------- inbox */

function toItems(rows: unknown): InboxItem[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r): r is InboxItem => Boolean(r && typeof r === 'object' && 'id' in r && 'title' in r))
    .map((r) => ({
      id: String(r.id),
      title: String(r.title),
      body: String(r.body ?? ''),
      category: r.category,
      image_url: r.image_url ?? null,
      action_url: r.action_url ?? null,
      created_at: String(r.created_at),
      read_at: r.read_at ?? null,
    }));
}

export async function refreshInbox(): Promise<void> {
  if (!isSupabaseConfigured) return;
  const deviceId = state.deviceId ?? (await getDeviceId());
  setState({ loading: true });
  try {
    const { data, error } = await getSupabase().rpc('get_notification_inbox', {
      p_device_id: deviceId,
      p_limit: 50,
    });
    if (error) throw error;
    const items = toItems(data);
    setState({ items, loading: false, loaded: true, error: null });
    // Anything already listed in the inbox should not pop up natively again.
    void nativeMarkSeen(items.map((i) => i.id));
  } catch (err) {
    setState({ loading: false, loaded: true, error: err instanceof Error ? err.message : 'Gagal memuat notifikasi' });
  }
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const target = (ids ?? state.items.filter((i) => !i.read_at).map((i) => i.id)).filter(Boolean);
  if (target.length === 0 || !state.deviceId) return;
  const now = new Date().toISOString();
  setState({
    items: state.items.map((i) => (target.includes(i.id) && !i.read_at ? { ...i, read_at: now } : i)),
  });
  try {
    await getSupabase().rpc('mark_notifications_read', { p_device_id: state.deviceId, p_ids: target });
  } catch {
    // Best effort; the local state already shows them as read.
  }
}

export function dismissIncoming() {
  setState({ incoming: null });
}

/* ----------------------------------------------------------- new arrivals */

async function fetchNew(): Promise<InboxItem[]> {
  const deviceId = state.deviceId ?? (await getDeviceId());
  const newest = state.items[0]?.created_at;
  const since = newest ?? new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await getSupabase().rpc('fetch_device_notifications', {
    p_device_id: deviceId,
    p_since: since,
    p_limit: 20,
  });
  if (error) throw error;
  const known = new Set(state.items.map((i) => i.id));
  return toItems(data).filter((i) => !known.has(i.id));
}

async function handleArrivals() {
  try {
    const fresh = await fetchNew();
    if (fresh.length === 0) return;
    setState({ items: mergeInbox(state.items, fresh), incoming: fresh[fresh.length - 1] });
    const ids = fresh.map((f) => f.id);
    if (state.deviceId) {
      void getSupabase().rpc('mark_notifications_delivered', { p_device_id: state.deviceId, p_ids: ids });
    }
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (hidden && hasNativeNotify()) {
      // WebView alive in the background (music playing): native notification now.
      for (const item of fresh) {
        await nativeShow({
          id: item.id,
          title: item.title,
          body: item.body,
          imageUrl: item.image_url,
          actionUrl: item.action_url,
          category: item.category,
        });
      }
    } else {
      void nativeMarkSeen(ids);
    }
  } catch {
    // Realtime is best-effort; the native poller/FCM are the backstop.
  }
}

let channel: RealtimeChannel | null = null;

function startRealtime() {
  if (channel || !isSupabaseConfigured) return;
  const supabase = getSupabase();
  channel = supabase
    .channel('broadcast-notifications')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcast_notifications' }, () => {
      // RLS already filters by audience; re-fetch through the device RPC so
      // the read state + targeting are always exact.
      void handleArrivals();
    })
    .subscribe();
}

async function restartRealtime() {
  if (!channel) return startRealtime();
  const supabase = getSupabase();
  await supabase.removeChannel(channel);
  channel = null;
  startRealtime();
}

/* ------------------------------------------------------------- navigation */

let pendingTab: NavTab | null = null;
export const OPEN_TAB_EVENT = 'easvarafy:open-tab';

export function consumePendingTab(): NavTab | null {
  const tab = pendingTab;
  pendingTab = null;
  return tab;
}

/** Opens a broadcast's action_url inside the app. */
export async function openNotificationTarget(actionUrl: string | null | undefined) {
  const target = resolveNotificationTarget(actionUrl);
  if (target.kind === 'none') return;
  if (target.kind === 'external') {
    if (isNativeAndroid()) {
      try {
        const { Browser } = await import('@capacitor/browser');
        await Browser.open({ url: target.url, toolbarColor: '#111216' });
        return;
      } catch {
        // fall through
      }
    }
    window.open(target.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (target.kind === 'path') {
    window.location.assign(target.path);
    return;
  }
  if (window.location.pathname !== '/') {
    window.location.assign(target.tab === 'home' ? '/' : `/?tab=${target.tab}`);
    return;
  }
  pendingTab = target.tab;
  window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: { tab: target.tab } }));
}

/* ------------------------------------------------------------------- push */

let pushStarted = false;

async function startPush() {
  if (pushStarted || !isNativeAndroid()) return;
  const status = await nativeStatus();
  // Without google-services.json Firebase is not initialised -> skip FCM;
  // the native poller + realtime still deliver everything.
  if (!status?.firebaseConfigured) return;
  pushStarted = true;
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.addListener('registration', ({ value }) => {
      try {
        localStorage.setItem(FCM_TOKEN_KEY, value);
      } catch {
        // ignore
      }
      void registerDevice({ force: true });
    });
    await PushNotifications.addListener('registrationError', () => {
      pushStarted = false;
    });
    await PushNotifications.addListener('pushNotificationReceived', () => {
      void handleArrivals();
    });
    await PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
      const data = (notification?.data ?? {}) as Record<string, string>;
      if (data.notification_id) void markNotificationsRead([data.notification_id]);
      void openNotificationTarget(data.action_url || null);
    });
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive === 'granted') await PushNotifications.register();
  } catch {
    pushStarted = false;
  }
}

/* -------------------------------------------------------------- bootstrap */

let booted = false;

/** Called once from <NotificationBootstrap/>; idempotent. */
export function bootNotifications(): () => void {
  if (booted || typeof window === 'undefined') return () => {};
  booted = true;
  void registerDevice({ force: true }).then(() => {
    startRealtime();
    void startPush();
  });

  const offOpened = onNativeNotificationOpened(({ id, actionUrl }) => {
    if (id) void markNotificationsRead([id]);
    void openNotificationTarget(actionUrl ?? null);
  });

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void registerDevice();
      void handleArrivals();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  // Heartbeat + safety refresh while open (realtime can drop on flaky networks).
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      void registerDevice({ force: true });
    } else {
      void handleArrivals();
    }
  }, 5 * 60 * 1000);

  return () => {
    booted = false;
    offOpened();
    document.removeEventListener('visibilitychange', onVisible);
    window.clearInterval(timer);
  };
}

/** Auth changed (login/logout): re-link the device and reconnect realtime with the new JWT. */
export function onAuthIdentityChanged() {
  if (!booted) return;
  void registerDevice({ force: true }).then(() => restartRealtime());
}
