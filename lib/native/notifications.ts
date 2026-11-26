'use client';

/**
 * Bridge to EasvarafyNotifyPlugin.java (Android).
 *
 * - getDeviceId():  stable per-install id stored in SharedPreferences (shared
 *   by the web layer, FCM registration and the background poller)
 * - configure():    gives the native background poller (NotificationPollJobService,
 *   runs every ~15 min via JobScheduler even when the app is closed) the
 *   Supabase URL + anon key so it works without FCM.
 * - show():         post a native notification (used while the WebView is
 *   alive in the background, e.g. during music playback)
 * - "notificationOpened" event: a notification was tapped -> navigate.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeNotifyStatus {
  permission: 'granted' | 'denied' | 'prompt';
  firebaseConfigured: boolean;
  pollerScheduled: boolean;
  deviceId: string;
}

export interface NativeShowOptions {
  id: string;
  title: string;
  body: string;
  imageUrl?: string | null;
  actionUrl?: string | null;
  category?: string | null;
}

interface EasvarafyNotifyPlugin {
  getDeviceId(): Promise<{ deviceId: string }>;
  configure(options: {
    supabaseUrl: string;
    anonKey: string;
    enabled: boolean;
    appVersion?: string;
  }): Promise<{ scheduled: boolean }>;
  getStatus(): Promise<NativeNotifyStatus>;
  requestPermission(): Promise<{ permission: NativeNotifyStatus['permission'] }>;
  show(options: NativeShowOptions): Promise<{ shown: boolean }>;
  markSeen(options: { ids: string[] }): Promise<void>;
  pollNow(): Promise<void>;
  addListener(
    event: 'notificationOpened',
    cb: (data: { id?: string; actionUrl?: string }) => void
  ): Promise<PluginListenerHandle>;
}

const Notify = registerPlugin<EasvarafyNotifyPlugin>('EasvarafyNotify');

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/** True when the APK ships the EasvarafyNotify plugin (older APKs don't). */
export function hasNativeNotify(): boolean {
  try {
    return isNativeAndroid() && Capacitor.isPluginAvailable('EasvarafyNotify');
  } catch {
    return false;
  }
}

export async function nativeGetDeviceId(): Promise<string | null> {
  if (!hasNativeNotify()) return null;
  try {
    const { deviceId } = await Notify.getDeviceId();
    return deviceId || null;
  } catch {
    return null;
  }
}

export async function nativeConfigure(options: Parameters<EasvarafyNotifyPlugin['configure']>[0]) {
  if (!hasNativeNotify()) return false;
  try {
    return (await Notify.configure(options)).scheduled;
  } catch {
    return false;
  }
}

export async function nativeStatus(): Promise<NativeNotifyStatus | null> {
  if (!hasNativeNotify()) return null;
  try {
    return await Notify.getStatus();
  } catch {
    return null;
  }
}

export async function nativeRequestPermission() {
  if (!hasNativeNotify()) return null;
  try {
    return (await Notify.requestPermission()).permission;
  } catch {
    return null;
  }
}

export async function nativeShow(options: NativeShowOptions) {
  if (!hasNativeNotify()) return false;
  try {
    return (await Notify.show(options)).shown;
  } catch {
    return false;
  }
}

export async function nativeMarkSeen(ids: string[]) {
  if (!hasNativeNotify() || ids.length === 0) return;
  try {
    await Notify.markSeen({ ids });
  } catch {
    // ignore
  }
}

export async function nativePollNow() {
  if (!hasNativeNotify()) return;
  try {
    await Notify.pollNow();
  } catch {
    // ignore
  }
}

export function onNativeNotificationOpened(
  cb: (data: { id?: string; actionUrl?: string }) => void
): () => void {
  if (!hasNativeNotify()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;
  void Notify.addListener('notificationOpened', cb).then((h) => {
    if (cancelled) void h.remove();
    else handle = h;
  });
  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
