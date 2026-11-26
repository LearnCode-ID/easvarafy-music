'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCheck,
  Eye,
  Image as ImageIcon,
  Link2,
  Loader2,
  Megaphone,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  Trash2,
  Users,
  Wifi,
} from 'lucide-react';
import { Badge, ConfirmDialog, EmptyState, StatCard } from '@/components/admin/AdminUI';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  deleteBroadcast,
  getNotificationStats,
  listBroadcasts,
  resendBroadcastPush,
  sendBroadcast,
  type BroadcastRecord,
  type NotificationStats,
} from '@/lib/admin/notifications';
import {
  BODY_MAX,
  DEEP_LINK_PRESETS,
  NOTIFICATION_CATEGORIES,
  ROLE_LABELS,
  TITLE_MAX,
  audienceLabel,
  categoryMeta,
  formatRelativeTime,
  validateComposer,
  type ComposerInput,
  type NotificationTargetRole,
} from '@/lib/notifications/shared';
import { cn } from '@/lib/utils';

const EMPTY: ComposerInput = {
  title: '',
  body: '',
  category: 'info',
  imageUrl: '',
  actionUrl: '/',
  audience: 'all',
  targetRole: 'user',
};

const PUSH_LABEL: Record<string, { label: string; tone: 'neutral' | 'success' | 'danger' | 'admin' | 'developer' }> = {
  pending: { label: 'Mengirim…', tone: 'neutral' },
  sent: { label: 'Push terkirim', tone: 'success' },
  partial: { label: 'Push sebagian', tone: 'developer' },
  skipped: { label: 'Poller & realtime', tone: 'admin' },
  failed: { label: 'Push gagal', tone: 'danger' },
};

/** Admin-only broadcast notifications (role `admin`; developer/user denied). */
export default function AdminNotificationsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' && !profile?.is_banned;

  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [rows, setRows] = useState<BroadcastRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ComposerInput>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [toDelete, setToDelete] = useState<BroadcastRecord | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [serverFields, setServerFields] = useState<Partial<Record<keyof ComposerInput, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [s, list] = await Promise.all([getNotificationStats(), listBroadcasts(30)]);
    setStats(s.stats);
    setRows(list.rows);
    setError(s.error ?? list.error ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    void Promise.all([getNotificationStats(), listBroadcasts(30)]).then(([s, list]) => {
      if (!alive) return;
      setStats(s.stats);
      setRows(list.rows);
      setError(s.error ?? list.error ?? null);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const validation = useMemo(() => validateComposer(form), [form]);
  const fieldErrors = touched && !validation.ok ? validation.errors : serverFields;

  const estimatedRecipients = useMemo(() => {
    if (!stats) return null;
    if (form.audience === 'all') return stats.devices_total;
    if (form.audience === 'logged_in') return stats.logged_in;
    return null;
  }, [stats, form.audience]);

  if (!isAdmin) {
    return (
      <EmptyState
        title="Akses ditolak"
        description="Notifikasi massal hanya bisa dikelola oleh admin. Developer dan user tidak punya akses."
      />
    );
  }

  const set = <K extends keyof ComposerInput>(key: K, value: ComposerInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setServerFields((e) => ({ ...e, [key]: undefined }));
  };

  const doSend = async () => {
    setConfirmSend(false);
    setSending(true);
    setFlash(null);
    const result = await sendBroadcast(form);
    setSending(false);
    if (result.error || !result.notification) {
      setServerFields(result.fields ?? {});
      setFlash({ tone: 'error', text: result.error ?? 'Gagal mengirim notifikasi.' });
      return;
    }
    const n = result.notification;
    setRows((r) => [n, ...r]);
    setForm(EMPTY);
    setTouched(false);
    setFlash({
      tone: 'success',
      text:
        n.push_status === 'sent'
          ? `Terkirim ke ${n.recipient_count} perangkat (${n.push_sent_count} via push).`
          : `Terkirim ke ${n.recipient_count} perangkat target. Perangkat menerima lewat poller Android & realtime.`,
    });
    void getNotificationStats().then((s) => s.stats && setStats(s.stats));
  };

  const doDelete = async () => {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    const res = await deleteBroadcast(toDelete.id);
    setBusyId(null);
    if (res.error) {
      setFlash({ tone: 'error', text: res.error });
    } else {
      setRows((r) => r.filter((x) => x.id !== toDelete.id));
      setFlash({ tone: 'success', text: 'Notifikasi dihapus dari riwayat & inbox user.' });
    }
    setToDelete(null);
  };

  const doResend = async (row: BroadcastRecord) => {
    setBusyId(row.id);
    const res = await resendBroadcastPush(row.id);
    setBusyId(null);
    if (res.error || !res.notification) {
      setFlash({ tone: 'error', text: res.error ?? 'Gagal mengirim ulang push.' });
      return;
    }
    const updated = res.notification;
    setRows((r) => r.map((x) => (x.id === row.id ? { ...x, ...updated } : x)));
    setFlash({ tone: 'success', text: `Push: ${PUSH_LABEL[updated.push_status]?.label ?? updated.push_status}` });
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight inline-flex items-center gap-2">
            <BellRing className="w-6 h-6 text-[#7C5CFF]" />
            Notifikasi
          </h1>
          <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Kirim pengumuman, story, atau info rilis baru ke semua perangkat Easvarafy. Push FCM dipakai bila
            tersedia; tanpa FCM, aplikasi Android tetap menerimanya lewat poller latar belakang & realtime.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[40px] px-4 rounded-full border border-[var(--m3-border)] text-[12.5px] font-semibold inline-flex items-center gap-2 hover:bg-black/5 dark:hover:bg-white/[0.06]"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Muat ulang
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-800 dark:text-amber-200">
          {error}
        </div>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="notification-stats">
        <StatCard
          label="Perangkat aktif 24 jam"
          value={loading ? '—' : (stats?.active_24h ?? 0)}
          hint={`${stats?.active_7d ?? 0} aktif dalam 7 hari`}
          icon={<Wifi className="w-4 h-4" />}
          tone="primary"
        />
        <StatCard
          label="Total perangkat"
          value={loading ? '—' : (stats?.devices_total ?? 0)}
          hint={`${stats?.devices_android ?? 0} Android · ${stats?.devices_web ?? 0} Web`}
          icon={<Smartphone className="w-4 h-4" />}
        />
        <StatCard
          label="Login / Izin notif"
          value={loading ? '—' : `${stats?.logged_in ?? 0} / ${stats?.notifications_enabled ?? 0}`}
          hint={`${stats?.push_ready ?? 0} siap push FCM`}
          icon={<Users className="w-4 h-4" />}
          tone="success"
        />
        <StatCard
          label="Broadcast terkirim"
          value={loading ? '—' : (stats?.broadcasts_total ?? 0)}
          hint={`${stats?.broadcasts_7d ?? 0} dalam 7 hari`}
          icon={<Megaphone className="w-4 h-4" />}
        />
      </section>

      {flash && (
        <div
          role="status"
          data-testid="notification-flash"
          className={cn(
            'rounded-2xl px-4 py-3 text-[12.5px] font-medium',
            flash.tone === 'success'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25'
              : 'bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/25'
          )}
        >
          {flash.text}
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-5">
        {/* Composer */}
        <form
          className="lg:col-span-3 rounded-2xl border border-[var(--m3-border)] bg-[var(--m3-surface)] p-4 sm:p-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (validation.ok) setConfirmSend(true);
          }}
          data-testid="notification-composer"
        >
          <h2 className="text-[14px] font-bold inline-flex items-center gap-2">
            <Send className="w-4 h-4 text-[#7C5CFF]" /> Tulis notifikasi
          </h2>

          <div>
            <Label>Kategori</Label>
            <div className="flex flex-wrap gap-2">
              {NOTIFICATION_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => set('category', c.id)}
                  className={cn(
                    'px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-colors',
                    form.category === c.id ? 'text-white border-transparent' : 'border-[var(--m3-border)]'
                  )}
                  style={form.category === c.id ? { backgroundColor: c.color } : { color: c.color }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Judul" error={fieldErrors.title} counter={`${form.title.trim().length}/${TITLE_MAX}`}>
            <input
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              maxLength={TITLE_MAX + 20}
              placeholder="Mis. Lagu baru minggu ini 🎧"
              data-testid="notification-title"
              className={inputCls(!!fieldErrors.title)}
            />
          </Field>

          <Field label="Isi" error={fieldErrors.body} counter={`${form.body.trim().length}/${BODY_MAX}`}>
            <textarea
              value={form.body}
              onChange={(e) => set('body', e.target.value)}
              rows={4}
              placeholder="Tulis pesan untuk pendengar Easvarafy…"
              data-testid="notification-body"
              className={cn(inputCls(!!fieldErrors.body), 'py-2.5 min-h-[104px] resize-y')}
            />
          </Field>

          <Field label="Gambar (opsional, https)" error={fieldErrors.imageUrl} icon={<ImageIcon className="w-3.5 h-3.5" />}>
            <input
              value={form.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value)}
              placeholder="https://…/cover.jpg"
              inputMode="url"
              className={inputCls(!!fieldErrors.imageUrl)}
            />
          </Field>

          <Field label="Buka saat diketuk" error={fieldErrors.actionUrl} icon={<Link2 className="w-3.5 h-3.5" />}>
            <div className="flex flex-wrap gap-2 mb-2">
              {DEEP_LINK_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => set('actionUrl', p.value)}
                  className={cn(
                    'px-3 py-1 rounded-full text-[11.5px] font-semibold border',
                    form.actionUrl === p.value
                      ? 'bg-[#7C5CFF] text-white border-transparent'
                      : 'border-[var(--m3-border)] text-slate-600 dark:text-slate-300'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              value={form.actionUrl}
              onChange={(e) => set('actionUrl', e.target.value)}
              placeholder="/explore atau https://…"
              className={inputCls(!!fieldErrors.actionUrl)}
            />
          </Field>

          <div>
            <Label>Target</Label>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['all', 'Semua'],
                  ['logged_in', 'Login saja'],
                  ['role', 'Role'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => set('audience', id)}
                  className={cn(
                    'min-h-[40px] rounded-xl text-[12.5px] font-semibold border',
                    form.audience === id
                      ? 'bg-[var(--m3-primary-container)] text-[var(--m3-on-primary-container)] border-transparent'
                      : 'border-[var(--m3-border)]'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {form.audience === 'role' && (
              <select
                value={form.targetRole}
                onChange={(e) => set('targetRole', e.target.value as NotificationTargetRole)}
                className={cn(inputCls(!!fieldErrors.targetRole), 'mt-2')}
              >
                {(Object.keys(ROLE_LABELS) as NotificationTargetRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
            <p className="mt-1.5 text-[11.5px] text-slate-500 dark:text-slate-400">
              {form.audience === 'all'
                ? 'Semua perangkat, termasuk tamu yang belum login.'
                : form.audience === 'logged_in'
                  ? 'Hanya perangkat yang sedang login.'
                  : 'Hanya pengguna dengan role tertentu.'}
              {estimatedRecipients !== null && ` Perkiraan: ${estimatedRecipients} perangkat.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setForm(EMPTY);
                setTouched(false);
                setServerFields({});
              }}
              className="min-h-[44px] px-4 rounded-full text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/[0.06]"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={sending}
              data-testid="notification-send"
              className="min-h-[44px] px-5 rounded-full bg-[#7C5CFF] hover:bg-[#6B4BF0] text-white text-[13px] font-semibold inline-flex items-center gap-2 disabled:opacity-60"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Kirim notifikasi
            </button>
          </div>
        </form>

        {/* Live preview */}
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-2xl border border-[var(--m3-border)] bg-[var(--m3-surface)] p-4">
            <h2 className="text-[14px] font-bold mb-3 inline-flex items-center gap-2">
              <Eye className="w-4 h-4 text-[#7C5CFF]" /> Pratinjau Android
            </h2>
            <AndroidPreview form={form} />
          </div>
          <div className="rounded-2xl border border-[var(--m3-border)] bg-[var(--m3-surface)] p-4 text-[12px] text-slate-500 dark:text-slate-400 space-y-1.5 leading-relaxed">
            <p className="font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[#7C5CFF]" /> Jalur pengiriman
            </p>
            <p>1. Push FCM (bila FIREBASE_SERVICE_ACCOUNT_JSON diset & perangkat punya token).</p>
            <p>2. Poller Android di latar belakang (±15 menit), tanpa FCM, saat aplikasi ditutup.</p>
            <p>3. Realtime saat aplikasi terbuka / memutar musik di latar belakang.</p>
            <p>4. Inbox lonceng di aplikasi untuk riwayat.</p>
          </div>
        </div>
      </section>

      {/* History */}
      <section className="rounded-2xl border border-[var(--m3-border)] bg-[var(--m3-surface)] p-4">
        <h2 className="text-[14px] font-bold mb-3 inline-flex items-center gap-2">
          <Megaphone className="w-4 h-4 text-[#7C5CFF]" /> Riwayat pengiriman
        </h2>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-xl bg-black/5 dark:bg-white/[0.06] animate-pulse" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Belum ada notifikasi" description="Notifikasi yang kamu kirim akan tercatat di sini." />
        ) : (
          <ul className="divide-y divide-[var(--m3-border)]" data-testid="notification-history">
            {rows.map((row) => {
              const meta = categoryMeta(row.category);
              const push = PUSH_LABEL[row.push_status] ?? PUSH_LABEL.pending;
              return (
                <li key={row.id} className="py-3 flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wide"
                        style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
                      >
                        {meta.label}
                      </span>
                      <Badge tone="neutral">{audienceLabel(row.target_audience, row.target_role)}</Badge>
                      <span title={row.push_error ?? undefined}>
                        <Badge tone={push.tone}>{push.label}</Badge>
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatRelativeTime(row.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-[13.5px] font-semibold truncate">{row.title}</p>
                    <p className="text-[12px] text-slate-500 dark:text-slate-400 line-clamp-2">{row.body}</p>
                    {row.push_error && row.push_status !== 'sent' && (
                      <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 line-clamp-2">{row.push_error}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Metric label="Target" value={row.recipient_count} />
                    <Metric label="Diterima" value={row.delivered_count} />
                    <Metric label="Dibaca" value={row.read_count} icon={<CheckCheck className="w-3 h-3" />} />
                    {row.push_sent_count > 0 && <Metric label="Push" value={row.push_sent_count} />}
                    <button
                      type="button"
                      onClick={() => void doResend(row)}
                      disabled={busyId === row.id}
                      title="Kirim ulang push FCM"
                      aria-label="Kirim ulang push"
                      className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 hover:bg-black/5 dark:hover:bg-white/[0.06] disabled:opacity-50"
                    >
                      {busyId === row.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setToDelete(row)}
                      title="Hapus"
                      aria-label="Hapus notifikasi"
                      className="w-9 h-9 rounded-full flex items-center justify-center text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirmSend}
        title="Kirim notifikasi sekarang?"
        description={`"${form.title.trim()}" akan dikirim ke ${audienceLabel(form.audience, form.targetRole).toLowerCase()}${
          estimatedRecipients !== null ? ` (±${estimatedRecipients} perangkat)` : ''
        }. Notifikasi yang sudah terkirim tidak bisa ditarik dari perangkat.`}
        confirmLabel="Kirim"
        loading={sending}
        onCancel={() => setConfirmSend(false)}
        onConfirm={() => void doSend()}
      />
      <ConfirmDialog
        open={!!toDelete}
        title="Hapus notifikasi?"
        description="Notifikasi dihapus dari riwayat dan inbox user. Notifikasi yang sudah tampil di perangkat tidak ikut terhapus."
        confirmLabel="Hapus"
        danger
        loading={!!toDelete && busyId === toDelete.id}
        onCancel={() => setToDelete(null)}
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}

function inputCls(error: boolean) {
  return cn(
    'w-full min-h-[44px] rounded-xl px-3.5 text-[13.5px] bg-black/[0.03] dark:bg-white/[0.04] border outline-none focus:ring-2 focus:ring-[#7C5CFF]/40',
    error ? 'border-red-500/60' : 'border-[var(--m3-border)]'
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">{children}</p>;
}

function Field({
  label,
  error,
  counter,
  icon,
  children,
}: {
  label: string;
  error?: string;
  counter?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[12px] font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5">
          {icon}
          {label}
        </span>
        {counter && <span className="text-[11px] text-slate-400">{counter}</span>}
      </span>
      {children}
      {error && <span className="block mt-1 text-[11.5px] text-red-500">{error}</span>}
    </label>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="text-center min-w-[44px]">
      <p className="text-[14px] font-bold tabular-nums inline-flex items-center gap-0.5">
        {icon}
        {value}
      </p>
      <p className="text-[10px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  );
}

/** Android 14-style expanded notification preview. */
function AndroidPreview({ form }: { form: ComposerInput }) {
  const meta = categoryMeta(form.category);
  const title = form.title.trim() || 'Judul notifikasi';
  const body = form.body.trim() || 'Isi notifikasi akan tampil di sini.';
  const image = /^https:\/\//i.test(form.imageUrl.trim()) ? form.imageUrl.trim() : null;
  return (
    <div className="rounded-[28px] bg-gradient-to-b from-[#1b1530] to-[#0d0d12] p-3 pt-4" data-testid="notification-preview">
      <div className="flex items-center justify-between px-3 text-[11px] text-white/70 mb-3">
        <span>09.41</span>
        <span className="inline-flex items-center gap-1">
          <Wifi className="w-3 h-3" /> 100%
        </span>
      </div>
      <div className="rounded-[22px] bg-[#2a2833] text-white p-3.5 shadow-lg">
        <div className="flex items-center gap-2 text-[11px] text-white/70">
          <span className="w-5 h-5 rounded-full bg-gradient-to-br from-[#7C5CFF] to-[#22D3C5] flex items-center justify-center">
            <BellRing className="w-3 h-3 text-white" />
          </span>
          <span className="font-medium text-white/90">Easvarafy</span>
          <span>· {meta.label}</span>
          <span>· sekarang</span>
        </div>
        <p className="mt-2 text-[14px] font-semibold leading-snug break-words">{title}</p>
        <p className="mt-0.5 text-[13px] text-white/80 leading-snug whitespace-pre-line break-words line-clamp-6">{body}</p>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="mt-2.5 w-full max-h-44 object-cover rounded-2xl" />
        )}
        {form.actionUrl.trim() && (
          <p className="mt-2 text-[11px] text-[#B8A6FF] truncate">Buka: {form.actionUrl.trim()}</p>
        )}
      </div>
    </div>
  );
}
