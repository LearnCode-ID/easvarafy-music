'use client';

/**
 * Native media notification + lock-screen controls for the Android APK.
 *
 * Android WebView ignores `navigator.mediaSession` (only Chrome wires it to the
 * OS), so inside the Capacitor app we talk to our own native plugin
 * (`EasvarafyMedia`, see native/android/java/.../EasvarafyMediaPlugin.java),
 * which drives a real Android MediaSession + MediaStyle notification.
 *
 * On the web every function here is a no-op; the regular Media Session API in
 * MusicProvider keeps handling browsers.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export type NativeMediaAction = 'play' | 'pause' | 'next' | 'previous' | 'seekto' | 'open';

export interface NativeMediaState {
  title: string;
  artist: string;
  album: string;
  artworkUrl: string | null;
  playing: boolean;
  /** seconds */
  position: number;
  /** seconds */
  duration: number;
  playbackRate: number;
}

export interface NativeMediaActionEvent {
  action: NativeMediaAction;
  /** seconds, only for `seekto` */
  position?: number;
}

export type NativeIslandMode = 'accessibility' | 'overlay' | 'none';

export interface NativeIslandStatus {
  supported: boolean;
  /** user preference (default on) */
  enabled: boolean;
  /** "display over other apps" granted */
  overlayPermission: boolean;
  /** Easvarafy Dynamic Island accessibility service is on (camera-cutout mode) */
  accessibilityEnabled: boolean;
  mode: NativeIslandMode;
  /** island is drawn by Android, so the in-app island should hide */
  active: boolean;
}

interface EasvarafyMediaPlugin {
  update(state: NativeMediaState): Promise<void>;
  clear(): Promise<void>;
  getIslandStatus(): Promise<NativeIslandStatus>;
  setIslandEnabled(options: { enabled: boolean }): Promise<NativeIslandStatus>;
  openOverlaySettings(): Promise<void>;
  openAccessibilitySettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  addListener(
    eventName: 'mediaAction',
    listener: (event: NativeMediaActionEvent) => void
  ): Promise<PluginListenerHandle>;
}

let plugin: EasvarafyMediaPlugin | null = null;

function getPlugin(): EasvarafyMediaPlugin | null {
  if (typeof window === 'undefined') return null;
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return null;
  if (!Capacitor.isPluginAvailable('EasvarafyMedia')) return null;
  if (!plugin) plugin = registerPlugin<EasvarafyMediaPlugin>('EasvarafyMedia');
  return plugin;
}

export function hasNativeMediaControls(): boolean {
  return getPlugin() !== null;
}

/**
 * Bigger artwork for the lock screen. YouTube Music covers come as
 * `...=w120-h120-l90-rj`; ask for 544px instead. Video thumbnails are left alone.
 */
export function upgradeArtworkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    return url.replace(/=w\d+-h\d+[^&?#]*/, '=w544-h544-l90-rj');
  }
  return url;
}

export async function updateNativeMedia(state: NativeMediaState): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.update(state);
  } catch {
    // never let the notification break playback
  }
}

export async function clearNativeMedia(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.clear();
  } catch {
    // ignore
  }
}

/** Subscribe to notification / lock-screen / headset buttons. Returns cleanup. */
export function onNativeMediaAction(
  handler: (event: NativeMediaActionEvent) => void
): () => void {
  const p = getPlugin();
  if (!p) return () => {};
  let removed = false;
  let handle: PluginListenerHandle | null = null;
  void p
    .addListener('mediaAction', handler)
    .then((h) => {
      if (removed) {
        void h.remove();
      } else {
        handle = h;
      }
    })
    .catch(() => {});
  return () => {
    removed = true;
    if (handle) void handle.remove();
  };
}

// ---------------------------------------------------------------------------
// System-wide Dynamic Island (Android). Drawn natively around the front camera
// on top of every app; see native/android/.../DynamicIslandController.java.
// ---------------------------------------------------------------------------

let islandStatus: NativeIslandStatus | null = null;
const islandSubscribers = new Set<() => void>();

function setIslandStatus(next: NativeIslandStatus | null) {
  islandStatus = next;
  islandSubscribers.forEach((fn) => fn());
}

/** Synchronous read of the last known status (null on web / unknown). */
export function getNativeIslandStatus(): NativeIslandStatus | null {
  return islandStatus;
}

export function isNativeIslandActive(): boolean {
  return Boolean(islandStatus?.active);
}

export async function refreshNativeIslandStatus(): Promise<NativeIslandStatus | null> {
  const p = getPlugin();
  if (!p) return null;
  try {
    const status = await p.getIslandStatus();
    setIslandStatus(status);
    return status;
  } catch {
    return islandStatus;
  }
}

export async function setNativeIslandEnabled(enabled: boolean): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    setIslandStatus(await p.setIslandEnabled({ enabled }));
  } catch {
    // ignore
  }
}

export async function openNativeIslandSettings(
  target: 'overlay' | 'accessibility' | 'app'
): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    if (target === 'overlay') await p.openOverlaySettings();
    else if (target === 'accessibility') await p.openAccessibilitySettings();
    else await p.openAppSettings();
  } catch {
    // ignore
  }
}

function subscribeIsland(fn: () => void) {
  islandSubscribers.add(fn);
  return () => {
    islandSubscribers.delete(fn);
  };
}

/**
 * Live status of the native Dynamic Island. Re-checks whenever the app comes
 * back to the foreground (e.g. after granting a permission in system settings).
 */
export function useNativeIslandStatus(): NativeIslandStatus | null {
  const status = useSyncExternalStore(
    subscribeIsland,
    () => islandStatus,
    () => null
  );

  useEffect(() => {
    if (!hasNativeMediaControls()) return;
    void refreshNativeIslandStatus();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshNativeIslandStatus();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return status;
}
