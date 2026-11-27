'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, BellOff, CheckCheck, ChevronRight, Loader2, RefreshCw, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  dismissIncoming,
  markNotificationsRead,
  openNotificationTarget,
  refreshInbox,
  unreadCount,
  useNotifications,
} from '@/lib/notifications/client';
import { categoryMeta, formatRelativeTime, type InboxItem } from '@/lib/notifications/shared';
import { useBackHandler } from '@/lib/native/backButton';

/** Bell icon with unread badge + inbox panel of past broadcasts. */
export function NotificationBell({ variant = 'mobile' }: { variant?: 'mobile' | 'sidebar' }) {
  const { items } = useNotifications();
  const [open, setOpen] = useState(false);
  const unread = unreadCount(items);
  useBackHandler(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        data-testid={`notification-bell-${variant}`}
        onClick={() => {
          setOpen((v) => !v);
          if (!open) {
            // The inbox already lists the newest item; hide the arrival toast.
            dismissIncoming();
            void refreshInbox();
          }
        }}
        aria-label={unread > 0 ? `Notifikasi, ${unread} belum dibaca` : 'Notifikasi'}
        title="Notifikasi"
        className={cn(
          'relative min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full transition-colors',
          open
            ? 'text-[var(--m3-primary)] bg-[var(--m3-primary-soft)]'
            : 'text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10'
        )}
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute top-1 right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#7C5CFF] text-white text-[10px] font-bold leading-[17px] text-center ring-2 ring-[var(--m3-bg)]"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && <InboxPanel variant={variant} onClose={() => setOpen(false)} />}
    </>
  );
}

function InboxPanel({ variant, onClose }: { variant: 'mobile' | 'sidebar'; onClose: () => void }) {
  const { items, loading, loaded, error } = useNotifications();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const unread = unreadCount(items);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onItem = (item: InboxItem) => {
    void markNotificationsRead([item.id]);
    if (item.action_url) {
      onClose();
      void openNotificationTarget(item.action_url);
    }
  };

  const panel = (
    <div className="fixed inset-0 z-[90]" onClick={onClose} data-testid="notification-inbox">
      <div className="absolute inset-0 bg-black/30 lg:bg-transparent" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Notifikasi"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          // Opaque surface: a long scrolling list over artwork must stay readable
          // (translucent glass let the page text bleed through).
          'absolute rounded-[24px] shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-200',
          'bg-white/[0.98] dark:bg-[#18191f]/[0.98] backdrop-blur-xl border border-black/10 dark:border-white/[0.12]',
          variant === 'sidebar'
            ? 'left-[17.5rem] top-6 w-[400px] max-h-[min(640px,calc(100vh-3rem))]'
            : 'left-2 right-2 top-[calc(56px+env(safe-area-inset-top))] max-h-[calc(100vh-140px)]'
        )}
      >
        <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-black/5 dark:border-white/10">
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold">Notifikasi</h2>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              {unread > 0 ? `${unread} belum dibaca` : 'Semua sudah dibaca'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshInbox()}
            aria-label="Muat ulang"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          {unread > 0 && (
            <button
              type="button"
              data-testid="notification-mark-all"
              onClick={() => void markNotificationsRead()}
              className="h-9 px-3 rounded-full text-[12px] font-semibold text-[#7C5CFF] hover:bg-[#7C5CFF]/10 inline-flex items-center gap-1.5"
            >
              <CheckCheck className="w-4 h-4" />
              Tandai dibaca
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain">
          {items.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <span className="mx-auto w-12 h-12 rounded-2xl bg-[#7C5CFF]/12 text-[#7C5CFF] flex items-center justify-center">
                {loaded ? <BellOff className="w-6 h-6" /> : <Loader2 className="w-6 h-6 animate-spin" />}
              </span>
              <p className="mt-3 text-[14px] font-semibold">{loaded ? 'Belum ada notifikasi' : 'Memuat…'}</p>
              <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">
                {error && loaded
                  ? 'Tidak dapat memuat notifikasi. Periksa koneksi kamu.'
                  : 'Pengumuman, story, dan rilis baru dari Easvarafy akan muncul di sini.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/[0.06]">
              {items.map((item) => (
                <InboxRow key={item.id} item={item} onClick={() => onItem(item)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? null : createPortal(panel, document.body);
}

function InboxRow({ item, onClick }: { item: InboxItem; onClick: () => void }) {
  const meta = categoryMeta(item.category);
  const unread = !item.read_at;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        data-testid="notification-item"
        className={cn(
          'w-full text-left px-4 py-3.5 flex gap-3 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors',
          unread && 'bg-[#7C5CFF]/[0.06]'
        )}
      >
        <span className="relative mt-0.5 shrink-0">
          <span
            className="w-10 h-10 rounded-2xl flex items-center justify-center text-white"
            style={{ background: `linear-gradient(135deg, ${meta.color}, #7C5CFF)` }}
          >
            <Bell className="w-[18px] h-[18px]" />
          </span>
          {unread && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#7C5CFF] ring-2 ring-[var(--m3-bg)]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span
              className="px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
            >
              {meta.label}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatRelativeTime(item.created_at)}</span>
          </span>
          <span className={cn('block mt-1 text-[14px] leading-snug', unread ? 'font-bold' : 'font-semibold')}>
            {item.title}
          </span>
          <span className="block mt-0.5 text-[13px] leading-snug text-slate-600 dark:text-slate-300 whitespace-pre-line line-clamp-4">
            {item.body}
          </span>
          {item.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              loading="lazy"
              className="mt-2.5 w-full max-h-44 object-cover rounded-2xl border border-black/5 dark:border-white/10"
            />
          )}
        </span>
        {item.action_url && <ChevronRight className="w-4 h-4 mt-1 shrink-0 text-slate-400" />}
      </button>
    </li>
  );
}
