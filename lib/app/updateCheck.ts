'use client';

/**
 * In-app update check for the Android APK.
 *
 * - Installed version: @capacitor/app App.getInfo() (versionName + versionCode)
 * - Latest version:    GET /api/app/version
 * - "Update Sekarang"  opens the update site inside the app with
 *   @capacitor/browser (Chrome Custom Tab sheet on top of Easvarafy — the user
 *   is never thrown out to an external browser app).
 */
import { useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { apiUrl } from '@/lib/api/base';
import {
  APP_UPDATE_URL,
  evaluateUpdate,
  parseVersionPayload,
  toBuildNumber,
  type AppVersionInfo,
  type InstalledAppInfo,
} from './version';

export type UpdateCheckStatus = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error' | 'unsupported';

export interface UpdateState {
  status: UpdateCheckStatus;
  installed: InstalledAppInfo | null;
  latest: AppVersionInfo | null;
  force: boolean;
  /** Popup visible */
  open: boolean;
  error: string | null;
  checkedAt: number | null;
}

const SNOOZE_KEY = 'easvarafy_update_snooze_v1';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

let state: UpdateState = {
  status: 'idle',
  installed: null,
  latest: null,
  force: false,
  open: false,
  error: null,
  checkedAt: null,
};
const listeners = new Set<() => void>();
let inflight: Promise<UpdateState> | null = null;

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => state;

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function getInstalledAppInfo(): Promise<InstalledAppInfo | null> {
  if (!isNativeApp()) return null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return { version: info.version, build: toBuildNumber(info.build) };
  } catch {
    return null;
  }
}

export async function fetchLatestAppVersion(signal?: AbortSignal): Promise<AppVersionInfo> {
  const res = await fetch(apiUrl('/api/app/version'), { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = parseVersionPayload(await res.json());
  if (!parsed) throw new Error('Format versi tidak valid');
  return parsed;
}

function snoozeKeyFor(latest: AppVersionInfo) {
  return `${latest.latestVersion}#${latest.latestBuild ?? ''}`;
}

function isSnoozed(latest: AppVersionInfo): boolean {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { key?: string; until?: number };
    return parsed.key === snoozeKeyFor(latest) && typeof parsed.until === 'number' && parsed.until > Date.now();
  } catch {
    return false;
  }
}

/**
 * Checks for a newer APK. `manual` (Settings > Cek Pembaruan) ignores the
 * "Nanti" snooze and always reports the result.
 */
export function checkForAppUpdate(options: { manual?: boolean } = {}): Promise<UpdateState> {
  if (inflight) return inflight;
  inflight = (async () => {
    setState({ status: 'checking', error: null });
    try {
      const installed = await getInstalledAppInfo();
      if (!installed) {
        // Web build: always the latest deployed version.
        let latest: AppVersionInfo | null = null;
        try {
          latest = await fetchLatestAppVersion();
        } catch {
          latest = null;
        }
        setState({ status: 'unsupported', installed: null, latest, force: false, checkedAt: Date.now() });
        return state;
      }
      const latest = await fetchLatestAppVersion();
      const result = evaluateUpdate(installed, latest);
      if (result.kind === 'available') {
        const showPopup = options.manual || result.force || !isSnoozed(latest);
        setState({
          status: 'available',
          installed,
          latest,
          force: result.force,
          open: showPopup || state.open,
          checkedAt: Date.now(),
        });
      } else {
        setState({ status: 'up-to-date', installed, latest, force: false, open: false, checkedAt: Date.now() });
      }
    } catch (err) {
      setState({
        status: 'error',
        error: err instanceof Error ? err.message : 'Gagal memeriksa pembaruan',
        checkedAt: Date.now(),
      });
    } finally {
      inflight = null;
    }
    return state;
  })();
  return inflight;
}

/** "Nanti": hide the popup for 24 h for this exact version (never when forced). */
export function dismissAppUpdate() {
  if (state.force) return;
  if (state.latest) {
    try {
      window.localStorage.setItem(
        SNOOZE_KEY,
        JSON.stringify({ key: snoozeKeyFor(state.latest), until: Date.now() + SNOOZE_MS })
      );
    } catch {
      // storage unavailable
    }
  }
  setState({ open: false });
}

export function showAppUpdatePopup() {
  if (state.status === 'available') setState({ open: true });
}

/** Opens the update site inside the app (in-app browser sheet). */
export async function openUpdatePage(url: string = state.latest?.updateUrl || APP_UPDATE_URL) {
  const safeUrl = /^https:\/\//i.test(url) ? url : APP_UPDATE_URL;
  if (isNativeApp()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: safeUrl, presentationStyle: 'popover', toolbarColor: '#111216' });
      return;
    } catch {
      // fall through
    }
  }
  window.open(safeUrl, '_blank', 'noopener,noreferrer');
}
