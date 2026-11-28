'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Capacitor } from '@capacitor/core';
import { useMusic } from '@/components/MusicProvider';
import { listenForAppLinks } from '@/lib/native/appLinks';

/** Kept inside MusicProvider so links dismiss the old detail/player without stopping audio. */
export function AppLinksBridge() {
  const router = useRouter();
  const { openDetail, setIsNowPlayingOpen } = useMusic();
  const actions = useRef({ openDetail, setIsNowPlayingOpen });
  useEffect(() => { actions.current = { openDetail, setIsNowPlayingOpen }; }, [openDetail, setIsNowPlayingOpen]);
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    return listenForAppLinks(
      import('@capacitor/app').then(module => module.App),
      path => {
        actions.current.openDetail(null, { keepRoute: true });
        actions.current.setIsNowPlayingOpen(false);
        router.push(path);
      },
      error => console.warn('Native content links unavailable', error),
    );
  }, [router]);
  return null;
}
