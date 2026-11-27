'use client';

/**
 * Android hardware/gesture back button.
 *
 * Easvarafy is a single-page app: tabs, detail pages, the full player and
 * every sheet are React state, not browser history. Capacitor's default back
 * handling only calls `webView.goBack()` when the WebView has history, so the
 * button used to do nothing at all. Instead, every open layer registers a
 * handler here and the topmost one is closed first:
 *
 *   sheets / dialogs / menus  ->  full player  ->  detail page  ->  Home tab
 *   -> previous route (/admin, /login, …)  ->  leave the app (minimize, so
 *   music keeps playing — same as Android 12+ on a root activity).
 *
 * Two entry points call `handleBackPress`:
 *  - native (APK >= 1.1.0 build with the MainActivity callback):
 *    `window.__easvarafyHandleBack(canGoBack)` evaluated from Java; returning
 *    false makes the native side minimize the app.
 *  - `@capacitor/app` "backButton" event (older APKs): see BackButtonBridge.
 */
import { useEffect, useRef } from 'react';

/** Return `false` when there was nothing to close so lower layers get a turn. */
export type BackHandler = () => boolean | void;

type Entry = { id: number; priority: number; run: () => boolean | void };

/** Layers opened on top of the page (sheets, dialogs, menus). */
export const BACK_PRIORITY_OVERLAY = 100;
/** Page-level navigation (full player, detail page, tab -> Home). */
export const BACK_PRIORITY_PAGE = 0;

const entries: Entry[] = [];
let seq = 0;

export function registerBackHandler(run: BackHandler, priority: number = BACK_PRIORITY_OVERLAY): () => void {
  const entry: Entry = { id: ++seq, priority, run };
  entries.push(entry);
  return () => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
  };
}

/**
 * Registers `onBack` while `active` is true. The most recently opened layer
 * wins within the same priority, so a sheet opened inside the full player is
 * closed before the player itself.
 */
export function useBackHandler(active: boolean, onBack: BackHandler, priority: number = BACK_PRIORITY_OVERLAY) {
  const ref = useRef(onBack);
  useEffect(() => {
    ref.current = onBack;
  });
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => ref.current(), priority);
  }, [active, priority]);
}

/** Exposed for tests. */
export function backHandlerCount(): number {
  return entries.length;
}

/**
 * Runs the topmost handler. Returns true when the press was consumed, false
 * when the app should be left (minimized).
 */
export function handleBackPress(canGoBack?: boolean): boolean {
  const ordered = [...entries].sort((a, b) => b.priority - a.priority || b.id - a.id);
  for (const entry of ordered) {
    try {
      if (entry.run() !== false) return true;
    } catch {
      // A broken handler must never trap the user; try the next layer.
    }
  }
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/') {
    if (canGoBack ?? window.history.length > 1) window.history.back();
    else window.location.replace('/');
    return true;
  }
  return false;
}
