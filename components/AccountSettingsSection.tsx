'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Camera,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Trash2,
  User as UserIcon,
  UserPlus,
} from 'lucide-react';
import { useAuth } from './auth/AuthProvider';
import { AccountAvatar } from './auth/AccountMenu';
import { VerifiedBadge } from './auth/VerifiedBadge';
import { useMusic } from './MusicProvider';
import { displayNameOf, roleLabelOf } from '@/lib/auth/types';

export function AccountSettingsSection() {
  const router = useRouter();
  const {
    ready,
    configured,
    isAuthenticated,
    userId,
    profile,
    email,
    isAdmin,
    updateProfile,
    uploadAvatar,
    removeAvatar,
    updatePassword,
    sendPasswordReset,
    signOut,
  } = useAuth();
  const { showToast, openDetail } = useMusic();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentName = profile?.name?.trim() || '';
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [avatarBusy, setAvatarBusy] = useState(false);
  const [urlEditorOpen, setUrlEditorOpen] = useState(false);
  const [avatarUrlDraft, setAvatarUrlDraft] = useState('');

  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const effectiveNameDraft = nameDraft ?? currentName;
  const trimmedName = effectiveNameDraft.trim();
  const isNameChanged = trimmedName !== currentName;
  const displayLabel = displayNameOf(profile, email);

  const joinedLabel = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmedName) {
      showToast('Nama panggilan tidak boleh kosong');
      return;
    }
    if (trimmedName.length > 50) {
      showToast('Nama panggilan maksimal 50 karakter');
      return;
    }
    setSavingName(true);
    const res = await updateProfile({ name: trimmedName });
    setSavingName(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    setNameDraft(null);
    showToast('Nama panggilan berhasil diperbarui');
  };

  const handleAvatarFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAvatarBusy(true);
    const res = await uploadAvatar(file);
    setAvatarBusy(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    setUrlEditorOpen(false);
    showToast('Avatar berhasil diperbarui');
  };

  const handleSaveAvatarUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = avatarUrlDraft.trim();
    if (!raw) {
      showToast('Masukkan URL gambar terlebih dahulu');
      return;
    }
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        showToast('URL avatar harus diawali https:// atau http://');
        return;
      }
    } catch {
      showToast('Format URL tidak valid');
      return;
    }

    setAvatarBusy(true);
    const res = await updateProfile({ avatar_url: raw });
    setAvatarBusy(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    setAvatarUrlDraft('');
    setUrlEditorOpen(false);
    showToast('Avatar berhasil diperbarui');
  };

  const handleRemoveAvatar = async () => {
    setAvatarBusy(true);
    const res = await removeAvatar();
    setAvatarBusy(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    showToast('Avatar dihapus');
  };

  const handleCopyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      showToast('Email disalin ke clipboard');
    } catch {
      showToast('Tidak dapat menyalin email');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showToast('Password baru minimal 8 karakter');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Konfirmasi password tidak cocok');
      return;
    }
    setSavingPassword(true);
    const res = await updatePassword(newPassword);
    setSavingPassword(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    setNewPassword('');
    setConfirmPassword('');
    setPasswordOpen(false);
    showToast('Password berhasil diperbarui');
  };

  const handleSendResetEmail = async () => {
    if (!email) return;
    setSendingReset(true);
    const res = await sendPasswordReset(email);
    setSendingReset(false);
    if (res.error) {
      showToast(res.error);
      return;
    }
    showToast(`Link reset password dikirim ke ${email}`);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    router.refresh();
  };

  if (!configured) {
    return null;
  }

  return (
    <section data-testid="account-settings" className="space-y-2.5">
      <h2 className="px-1 text-[12px] font-bold uppercase tracking-wider text-[var(--m3-primary)]">
        Pengaturan Akun
      </h2>

      {!ready ? (
        <div className="rounded-[24px] metro-surface p-5 flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-full skeleton-block shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-4 w-40 rounded-full skeleton-block" />
            <div className="h-3 w-56 rounded-full skeleton-block" />
          </div>
        </div>
      ) : !isAuthenticated ? (
        <div className="rounded-[24px] metro-surface p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <span
              className="w-12 h-12 rounded-full flex items-center justify-center shrink-0"
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--m3-primary) 14%, transparent)',
                color: 'var(--m3-primary)',
              }}
            >
              <UserIcon className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold">Masuk ke Akun Easvarafy</p>
              <p className="text-[12.5px] opacity-65 mt-0.5 leading-snug">
                Login untuk ganti avatar, ubah nama panggilan, atur password, dan kelola profil kamu.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/login"
              className="h-9 px-4 rounded-full bg-[var(--m3-primary)] text-[var(--m3-on-primary)] text-[13px] font-semibold inline-flex items-center gap-1.5"
            >
              <LogIn className="w-3.5 h-3.5" />
              Masuk
            </Link>
            <Link
              href="/register"
              className="h-9 px-4 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-[13px] font-semibold inline-flex items-center gap-1.5 hover:bg-black/10 dark:hover:bg-white/15 transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Daftar
            </Link>
          </div>
        </div>
      ) : (
        <div className="rounded-[24px] metro-surface overflow-hidden divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {/* Avatar & Profile Overview */}
          <div className="px-4 py-4 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <div className="relative shrink-0">
                  <AccountAvatar size={68} />
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Ganti foto avatar"
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-[var(--m3-primary)] text-[var(--m3-on-primary)] flex items-center justify-center shadow-md ring-2 ring-[var(--m3-surface)] hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    {avatarBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleAvatarFileChange}
                    className="hidden"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[16px] font-bold truncate">{displayLabel}</p>
                    <VerifiedBadge role={profile?.role} size="md" />
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        profile?.role === 'developer'
                          ? 'bg-amber-500/15 text-amber-400'
                          : profile?.role === 'admin'
                          ? 'bg-sky-500/15 text-sky-400'
                          : 'bg-black/[0.06] dark:bg-white/[0.08] opacity-75'
                      }`}
                    >
                      <VerifiedBadge role={profile?.role} size="xs" />
                      {roleLabelOf(profile?.role)}
                    </span>
                  </div>
                  <p className="text-[12.5px] opacity-65 truncate mt-0.5">
                    {email ?? '—'}
                  </p>
                  <div className="flex items-center gap-3 flex-wrap mt-0.5">
                    {joinedLabel && (
                      <p className="text-[11.5px] opacity-50">
                        Bergabung {joinedLabel}
                      </p>
                    )}
                    {userId && (
                      <button
                        type="button"
                        onClick={() =>
                          openDetail({ kind: 'user-profile', id: userId, title: displayLabel })
                        }
                        className="text-[11.5px] font-semibold text-[var(--m3-primary)] hover:underline"
                      >
                        Lihat Profil Publik →
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap shrink-0">
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="h-9 px-3.5 rounded-full bg-[var(--m3-primary)]/14 text-[var(--m3-primary)] text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-[var(--m3-primary)]/22 disabled:opacity-50 transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" />
                  Ganti Avatar
                </button>
                <button
                  type="button"
                  disabled={avatarBusy}
                  onClick={() => {
                    setUrlEditorOpen((v) => !v);
                    setAvatarUrlDraft(profile?.avatar_url || '');
                  }}
                  className="h-9 px-3.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Pakai URL
                </button>
                {profile?.avatar_url && (
                  <button
                    type="button"
                    disabled={avatarBusy}
                    onClick={handleRemoveAvatar}
                    className="h-9 px-3 rounded-full bg-rose-500/12 text-rose-500 text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:bg-rose-500/20 disabled:opacity-50 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Hapus
                  </button>
                )}
              </div>
            </div>

            {urlEditorOpen && (
              <form
                onSubmit={handleSaveAvatarUrl}
                className="flex flex-col sm:flex-row gap-2 pt-1"
              >
                <input
                  type="url"
                  value={avatarUrlDraft}
                  onChange={(e) => setAvatarUrlDraft(e.target.value)}
                  placeholder="https://contoh.com/foto-profil.jpg"
                  aria-label="URL gambar avatar"
                  className="flex-1 h-10 px-3.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.07] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--m3-primary)]/45"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="submit"
                    disabled={avatarBusy}
                    className="h-10 px-4 rounded-xl bg-[var(--m3-primary)] text-[var(--m3-on-primary)] text-[13px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {avatarBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Simpan URL
                  </button>
                  <button
                    type="button"
                    onClick={() => setUrlEditorOpen(false)}
                    className="h-10 px-3.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.07] text-[13px] font-semibold"
                  >
                    Batal
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Edit Nama Panggilan */}
          <form onSubmit={handleSaveName} className="px-4 py-3.5 space-y-3">
            <div className="flex items-center gap-3.5">
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--m3-primary) 14%, transparent)',
                  color: 'var(--m3-primary)',
                }}
              >
                <UserIcon className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0">
                <p className="text-[14.5px] font-semibold">Nama Panggilan</p>
                <p className="text-[12.5px] opacity-60">
                  Ditampilkan di profil, sidebar, dan menu akun kamu
                </p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 pl-0 sm:pl-[54px]">
              <input
                type="text"
                maxLength={50}
                value={effectiveNameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Masukkan nama panggilan..."
                aria-label="Nama panggilan"
                className="flex-1 h-10 px-3.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.07] text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[var(--m3-primary)]/45"
              />
              <button
                type="submit"
                disabled={savingName || !trimmedName || !isNameChanged}
                className="h-10 px-4 rounded-xl bg-[var(--m3-primary)] text-[var(--m3-on-primary)] text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed shrink-0 transition-opacity"
              >
                {savingName ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Simpan
              </button>
            </div>
          </form>

          {/* Email Info */}
          <div className="px-4 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{
                  backgroundColor:
                    'color-mix(in srgb, var(--m3-primary) 14%, transparent)',
                  color: 'var(--m3-primary)',
                }}
              >
                <Mail className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">Alamat Email</p>
                <p className="text-[12.5px] opacity-60 truncate mt-0.5">
                  {email ?? 'Tidak tersedia'}
                </p>
              </div>
            </div>
            {email && (
              <button
                type="button"
                onClick={handleCopyEmail}
                className="h-8 px-3 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-[12px] font-semibold inline-flex items-center gap-1.5 hover:bg-black/10 dark:hover:bg-white/15 shrink-0 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                Salin
              </button>
            )}
          </div>

          {/* Security & Password */}
          <div className="px-4 py-3.5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0">
                <span
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor:
                      'color-mix(in srgb, var(--m3-primary) 14%, transparent)',
                    color: 'var(--m3-primary)',
                  }}
                >
                  <KeyRound className="w-[18px] h-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-semibold">Keamanan &amp; Password</p>
                  <p className="text-[12.5px] opacity-60">
                    Ubah password akun atau kirim tautan reset via email
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={() => setPasswordOpen((v) => !v)}
                  className="h-8 px-3.5 rounded-full bg-[var(--m3-primary)]/14 text-[var(--m3-primary)] text-[12px] font-semibold hover:bg-[var(--m3-primary)]/22 transition-colors"
                >
                  {passwordOpen ? 'Tutup' : 'Ubah Password'}
                </button>
                {email && (
                  <button
                    type="button"
                    disabled={sendingReset}
                    onClick={handleSendResetEmail}
                    className="h-8 px-3.5 rounded-full bg-black/[0.06] dark:bg-white/[0.08] text-[12px] font-semibold hover:bg-black/10 dark:hover:bg-white/15 disabled:opacity-50 transition-colors"
                  >
                    {sendingReset ? 'Mengirim…' : 'Reset via Email'}
                  </button>
                )}
              </div>
            </div>

            {passwordOpen && (
              <form
                onSubmit={handleUpdatePassword}
                className="pl-0 sm:pl-[54px] space-y-2.5 pt-1"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Password baru (min. 8 karakter)"
                      aria-label="Password baru"
                      className="w-full h-10 pl-3.5 pr-10 rounded-xl bg-black/[0.05] dark:bg-white/[0.07] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--m3-primary)]/45"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                      className="w-8 h-8 rounded-lg flex items-center justify-center absolute right-1 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ulangi password baru"
                    aria-label="Konfirmasi password baru"
                    className="w-full h-10 px-3.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.07] text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--m3-primary)]/45"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={savingPassword || !newPassword || !confirmPassword}
                    className="h-9 px-4 rounded-xl bg-[var(--m3-primary)] text-[var(--m3-on-primary)] text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
                  >
                    {savingPassword && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Simpan Password
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Admin Shortcut (only for admin) */}
          {isAdmin && (
            <Link
              href="/admin/dashboard"
              className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <span
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor:
                      'color-mix(in srgb, var(--m3-primary) 14%, transparent)',
                    color: 'var(--m3-primary)',
                  }}
                >
                  <LayoutDashboard className="w-[18px] h-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold">Admin Console</p>
                  <p className="text-[12.5px] opacity-60 mt-0.5">
                    Buka dashboard dan manajemen pengguna Easvarafy
                  </p>
                </div>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-[var(--m3-primary)]/14 text-[var(--m3-primary)] text-[12px] font-semibold shrink-0">
                Buka
              </span>
            </Link>
          )}

          {/* Sign Out */}
          <div className="px-4 py-3.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: '#F43F5E22', color: '#F43F5E' }}
              >
                <LogOut className="w-[18px] h-[18px]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold">Sesi Akun</p>
                <p className="text-[12.5px] opacity-60 mt-0.5">
                  Keluar dari akun ini di perangkat ini
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={signingOut}
              onClick={handleSignOut}
              className="h-9 px-4 rounded-full bg-rose-500/12 text-rose-500 text-[12.5px] font-semibold hover:bg-rose-500/20 disabled:opacity-50 shrink-0 transition-colors"
            >
              {signingOut ? 'Keluar…' : 'Keluar'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
