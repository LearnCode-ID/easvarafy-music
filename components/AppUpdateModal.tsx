'use client';

import React, { useEffect, useRef } from 'react';
import { ArrowUpCircle, CheckCircle2, ShieldAlert, Sparkles, X } from 'lucide-react';
import {
  checkForAppUpdate,
  dismissAppUpdate,
  isNativeApp,
  openUpdatePage,
  useAppUpdate,
} from '@/lib/app/updateCheck';
import { formatVersionLabel } from '@/lib/app/version';

/**
 * In-app "Update tersedia" popup for the Android APK.
 * Checks /api/app/version shortly after launch (native only) and whenever the
 * app comes back to the foreground (at most every 6 hours).
 */
export function AppUpdateModal() {
  const update = useAppUpdate();
  const lastAutoCheck = useRef(0);

  useEffect(() => {
    if (!isNativeApp()) return;
    const run = () => {
      if (Date.now() - lastAutoCheck.current < 6 * 60 * 60 * 1000) return;
      lastAutoCheck.current = Date.now();
      void checkForAppUpdate();
    };
    // Let the splash screen and first render settle first.
    const t = window.setTimeout(run, 2500);
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    if (!update.open || update.force) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissAppUpdate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [update.open, update.force]);

  if (!update.open || !update.latest) return null;
  const { latest, installed, force } = update;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-update-title"
      data-testid="app-update-modal"
      className="fixed inset-0 z-[120] bg-black/60 backdrop-blur-md flex items-end sm:items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
      onClick={() => {
        if (!force) dismissAppUpdate();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-[28px] liquid-glass-elevated overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative px-6 pt-6 pb-5 bg-gradient-to-br from-[#7C5CFF]/30 via-[#5B8CFF]/15 to-[#22D3C5]/20">
          {!force && (
            <button
              type="button"
              onClick={dismissAppUpdate}
              aria-label="Tutup"
              className="absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          )}
          <span className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#7C5CFF] via-[#5B8CFF] to-[#22D3C5] flex items-center justify-center shadow-lg shadow-[#7C5CFF]/30">
            {force ? <ShieldAlert className="w-7 h-7 text-white" /> : <Sparkles className="w-7 h-7 text-white" />}
          </span>
          <h2 id="app-update-title" className="mt-4 text-[21px] font-bold tracking-tight">
            {force ? 'Pembaruan wajib tersedia' : 'Easvarafy versi baru tersedia'}
          </h2>
          <p className="mt-1 text-[13px] text-slate-600 dark:text-slate-300">
            Versi <strong data-testid="app-update-latest">{formatVersionLabel(latest.latestVersion, latest.latestBuild)}</strong>
            {installed ? (
              <>
                {' '}
                · terpasang {formatVersionLabel(installed.version, installed.build)}
              </>
            ) : null}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {latest.releaseNotes.length > 0 && (
            <div>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                Yang baru
              </p>
              <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {latest.releaseNotes.map((note) => (
                  <li key={note} className="flex items-start gap-2.5 text-[13.5px] leading-snug">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[#7C5CFF]" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {force && (
            <p className="text-[12px] rounded-2xl bg-amber-500/10 text-amber-700 dark:text-amber-300 px-3 py-2">
              Versi aplikasi kamu sudah tidak didukung. Perbarui untuk terus memakai Easvarafy.
            </p>
          )}

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              data-testid="app-update-now"
              onClick={() => void openUpdatePage(latest.updateUrl)}
              className="min-h-[50px] rounded-full bg-[#7C5CFF] hover:bg-[#6B4BF0] text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2 shadow-lg shadow-[#7C5CFF]/30"
            >
              <ArrowUpCircle className="w-5 h-5" />
              Update Sekarang
            </button>
            {!force && (
              <button
                type="button"
                data-testid="app-update-later"
                onClick={dismissAppUpdate}
                className="min-h-[46px] rounded-full text-[14px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/[0.06]"
              >
                Nanti
              </button>
            )}
          </div>
          <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
            Halaman pembaruan dibuka di dalam aplikasi.
          </p>
        </div>
      </div>
    </div>
  );
}
