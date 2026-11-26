'use client';

import React, { useEffect, useRef } from 'react';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  bootNotifications,
  dismissIncoming,
  markNotificationsRead,
  onAuthIdentityChanged,
  openNotificationTarget,
  useNotifications,
} from '@/lib/notifications/client';
import { categoryMeta } from '@/lib/notifications/shared';

/**
 * Mounted once in the root layout: registers this device (guest or logged in),
 * keeps the inbox fresh, listens to realtime/FCM/native taps and shows a small
 * in-app banner when a broadcast arrives while the app is open.
 */
export function NotificationBootstrap() {
  const { ready, userId } = useAuth();
  const lastUser = useRef<string | null | undefined>(undefined);

  useEffect(() => bootNotifications(), []);

  useEffect(() => {
    if (!ready) return;
    if (lastUser.current === undefined) {
      lastUser.current = userId;
      return;
    }
    if (lastUser.current !== userId) {
      lastUser.current = userId;
      onAuthIdentityChanged();
    }
  }, [ready, userId]);

  return <IncomingBanner />;
}

function IncomingBanner() {
  const { incoming } = useNotifications();

  useEffect(() => {
    if (!incoming) return;
    const t = window.setTimeout(dismissIncoming, 7000);
    return () => window.clearTimeout(t);
  }, [incoming]);

  if (!incoming) return null;
  const meta = categoryMeta(incoming.category);
  return (
    <div className="fixed z-[95] left-1/2 -translate-x-1/2 top-[calc(64px+env(safe-area-inset-top))] w-[min(420px,calc(100vw-1.5rem))]">
      <div
        role="status"
        data-testid="notification-incoming"
        className="liquid-glass-elevated rounded-[22px] shadow-2xl p-3 flex items-start gap-3 animate-in fade-in slide-in-from-top-2"
      >
        <span
          className="w-10 h-10 shrink-0 rounded-2xl flex items-center justify-center text-white"
          style={{ background: `linear-gradient(135deg, ${meta.color}, #7C5CFF)` }}
        >
          <Bell className="w-[18px] h-[18px]" />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            void markNotificationsRead([incoming.id]);
            dismissIncoming();
            void openNotificationTarget(incoming.action_url);
          }}
        >
          <span className="block text-[11px] font-bold uppercase tracking-wide" style={{ color: meta.color }}>
            {meta.label}
          </span>
          <span className="block text-[14px] font-bold leading-snug truncate">{incoming.title}</span>
          <span className="block text-[12.5px] text-slate-600 dark:text-slate-300 line-clamp-2">{incoming.body}</span>
        </button>
        <button
          type="button"
          aria-label="Tutup"
          onClick={dismissIncoming}
          className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
