'use client';

import { useEffect } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { handleBackPress } from '@/lib/native/backButton';

declare global {
  interface Window {
    /** Called from MainActivity's OnBackPressedCallback (native >= 1.1.0). */
    __easvarafyHandleBack?: (canGoBack?: boolean) => boolean;
  }
}

/**
 * Wires the Android back button to the in-app back stack
 * (lib/native/backButton.ts). Renders nothing.
 */
export function BackButtonBridge() {
  useEffect(() => {
    let isNative = false;
    try {
      isNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
    } catch {
      isNative = false;
    }
    if (!isNative) return;

    // Native path: Java evaluates this and minimizes the app on `false`.
    window.__easvarafyHandleBack = (canGoBack?: boolean) => handleBackPress(canGoBack);

    // Fallback for APKs without the native callback: @capacitor/app only
    // emits "backButton" once a listener exists, and otherwise does nothing.
    let handle: PluginListenerHandle | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const { App } = await import('@capacitor/app');
        const h = await App.addListener('backButton', ({ canGoBack }) => {
          if (!handleBackPress(canGoBack)) void App.minimizeApp().catch(() => undefined);
        });
        if (cancelled) void h.remove();
        else handle = h;
      } catch {
        // Plugin unavailable: the native callback (if any) still works.
      }
    })();

    return () => {
      cancelled = true;
      void handle?.remove();
      if (window.__easvarafyHandleBack) delete window.__easvarafyHandleBack;
    };
  }, []);

  return null;
}
