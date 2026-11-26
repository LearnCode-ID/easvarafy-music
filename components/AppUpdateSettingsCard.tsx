'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowUpCircle, CheckCircle2, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import {
  checkForAppUpdate,
  getInstalledAppInfo,
  isNativeApp,
  openUpdatePage,
  showAppUpdatePopup,
  useAppUpdate,
} from '@/lib/app/updateCheck';
import { formatVersionLabel, type InstalledAppInfo } from '@/lib/app/version';

const subscribeNoop = () => () => {};

/** Settings > About: installed version + "Cek Pembaruan" button. */
export function AppUpdateSettingsCard() {
  const update = useAppUpdate();
  const [installed, setInstalled] = useState<InstalledAppInfo | null>(null);
  // false during SSR/hydration, the real value on the client.
  const native = useSyncExternalStore(subscribeNoop, isNativeApp, () => false);

  useEffect(() => {
    void getInstalledAppInfo().then(setInstalled);
  }, []);

  const checking = update.status === 'checking';
  const current = update.installed ?? installed;

  let statusText: string;
  switch (update.status) {
    case 'checking':
      statusText = 'Memeriksa pembaruan…';
      break;
    case 'available':
      statusText = `Versi ${formatVersionLabel(update.latest?.latestVersion, update.latest?.latestBuild)} tersedia`;
      break;
    case 'up-to-date':
      statusText = 'Aplikasi sudah versi terbaru';
      break;
    case 'error':
      statusText = `Gagal memeriksa: ${update.error ?? 'coba lagi nanti'}`;
      break;
    case 'unsupported':
      statusText = 'Versi web selalu otomatis terbaru';
      break;
    default:
      statusText = native ? 'Ketuk untuk memeriksa versi terbaru' : 'Versi web selalu otomatis terbaru';
  }

  return (
    <div className="rounded-[24px] metro-surface p-4 flex items-center gap-3.5" data-testid="app-update-card">
      <span
        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: 'color-mix(in srgb, #7C5CFF 16%, transparent)', color: '#7C5CFF' }}
      >
        {update.status === 'up-to-date' ? <CheckCircle2 className="w-5 h-5" /> : <Smartphone className="w-5 h-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold">
          Versi Aplikasi {current ? formatVersionLabel(current.version, current.build) : native ? '' : '(Web)'}
        </p>
        <p className="text-[12.5px] opacity-65 mt-0.5 leading-relaxed" data-testid="app-update-status">
          {statusText}
        </p>
      </div>
      {update.status === 'available' ? (
        <button
          type="button"
          data-testid="open-app-update"
          onClick={() => (native ? showAppUpdatePopup() : void openUpdatePage())}
          className="px-3.5 py-2 rounded-full bg-[#7C5CFF] text-white text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0"
        >
          <ArrowUpCircle className="w-4 h-4" />
          Update
        </button>
      ) : (
        <button
          type="button"
          data-testid="check-app-update"
          disabled={checking}
          onClick={() => void checkForAppUpdate({ manual: true })}
          className="px-3.5 py-2 rounded-full bg-[var(--m3-primary)]/14 text-[var(--m3-primary)] text-[12px] font-semibold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60"
        >
          {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Cek Pembaruan
        </button>
      )}
    </div>
  );
}
