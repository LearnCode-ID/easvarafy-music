'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, WifiOff } from 'lucide-react';
import { useMusic } from './MusicProvider';
import { useOnlineStatus } from '@/lib/metrolist/useOfflineLibrary';

/**
 * Thin banner on top of the app:
 *  - offline: "Mode Offline" + shortcut to the downloaded songs
 *  - back online after being offline: "Muat ulang" to get the live version
 *    (in the APK this swaps the bundled offline copy for the live site).
 */
export function OfflineStatusBanner() {
  const online = useOnlineStatus();
  const { setActiveTab } = useMusic();
  const wasOfflineRef = useRef(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true;
      return;
    }
    if (!wasOfflineRef.current) return;
    wasOfflineRef.current = false;
    const show = setTimeout(() => setShowReconnected(true), 0);
    const hide = setTimeout(() => setShowReconnected(false), 15000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [online]);

  if (online && !showReconnected) return null;

  return (
    <div
      role="status"
      data-testid="offline-status-banner"
      className={`sticky top-0 z-[60] w-full px-4 py-2 text-[12.5px] font-semibold flex items-center justify-center gap-2 pt-[max(0.5rem,env(safe-area-inset-top))] ${
        online ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-black'
      }`}
    >
      {online ? (
        <>
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Koneksi kembali.</span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="underline underline-offset-2"
          >
            Muat ulang
          </button>
        </>
      ) : (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          <span>Mode Offline — hanya lagu tersimpan yang bisa diputar.</span>
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className="underline underline-offset-2"
          >
            Buka
          </button>
        </>
      )}
    </div>
  );
}
