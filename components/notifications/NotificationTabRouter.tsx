'use client';

import { useEffect } from 'react';
import { useMusic } from '@/components/MusicProvider';
import { consumePendingTab, OPEN_TAB_EVENT } from '@/lib/notifications/client';
import { resolveNotificationTarget } from '@/lib/notifications/shared';
import type { NavTab } from '@/lib/metrolist/types';

/**
 * Applies notification deep links inside the single-page player shell:
 * "/?tab=charts" on first load, and taps on notifications while the app is open.
 */
export function NotificationTabRouter() {
  const { setActiveTab } = useMusic();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('tab');
    if (fromUrl) {
      const target = resolveNotificationTarget(`/?tab=${encodeURIComponent(fromUrl)}`);
      if (target.kind === 'tab') setActiveTab(target.tab);
      params.delete('tab');
      const qs = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    }
    const pending = consumePendingTab();
    if (pending) setActiveTab(pending);

    const onOpen = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: NavTab }>).detail?.tab;
      consumePendingTab();
      if (tab) setActiveTab(tab);
    };
    window.addEventListener(OPEN_TAB_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TAB_EVENT, onOpen);
  }, [setActiveTab]);

  return null;
}
