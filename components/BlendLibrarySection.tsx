"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2, RefreshCw, Shuffle } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { LibrarySkeleton, LibrarySyncIndicator } from "./LibrarySkeleton";
import { useMusic } from "./MusicProvider";
import {
  BLEND_EVENT,
  blendInviteUrl,
  createBlendInvite,
  fetchBlends,
  type BlendPlaylist,
} from "@/lib/social/blendClient";

export function BlendLibrarySection() {
  const { userId } = useAuth();
  return <BlendLibraryContent key={userId || "guest"} />;
}
function BlendLibraryContent() {
  const { userId } = useAuth();
  const router = useRouter();
  const { openDetail, showToast } = useMusic();
  const [rows, setRows] = useState<BlendPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [consent, setConsent] = useState(false);
  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      setRows(await fetchBlends());
      setError("");
    } catch (e) {
      setRows([]);
      setError(e instanceof Error ? e.message : "Gagal memuat Blend.");
    } finally {
      setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => void load();
    const timer = setInterval(refresh, 30000);
    window.addEventListener(BLEND_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(BLEND_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  if (!userId)
    return (
      <section className="m3-card p-6 space-y-3">
        <h2 className="font-bold text-xl">Blend bersama teman</h2>
        <p className="text-sm">
          Masuk untuk membuat atau menerima undangan Blend.
        </p>
        <button
          className="profile-button"
          onClick={() => router.push("/login?redirectTo=%2Fblend")}
        >
          Masuk
        </button>
      </section>
    );
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const id = await createBlendInvite();
      openDetail({ kind: "blend", id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Undangan belum tersimpan.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async (b: BlendPlaylist) => {
    try {
      await navigator.clipboard.writeText(blendInviteUrl(b));
      showToast("Tautan undangan Blend disalin");
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Tidak dapat menyalin tautan."
      );
    }
  };
  const openCode = () => {
    let value = code.trim();
    try {
      if (value.startsWith("https://"))
        value = new URL(value).searchParams.get("code") || "";
    } catch {
      value = "";
    }
    if (!/^[a-f0-9]{32}$/i.test(value)) {
      setError("Masukkan kode 32 karakter dari undangan Blend.");
      return;
    }
    router.push(`/blend?code=${encodeURIComponent(value.toLowerCase())}`);
  };
  return (
    <section className="space-y-4" aria-label="Blend Library">
      <div className="m3-card p-5 space-y-4 bg-gradient-to-br from-[var(--m3-primary-container)] to-[var(--m3-surface)]">
        <div className="flex items-center gap-2">
          <Shuffle className="text-[var(--m3-primary)]" />
          <h2 className="font-display font-bold text-xl">
            Blend bersama teman
          </h2>
        </div>
        <p className="text-sm">
          Dua selera, satu playlist pribadi. Undangan berlaku 7 hari dan hanya
          bisa digunakan satu teman.
        </p>
        <label className="flex items-start gap-2 text-xs">
          <input
            className="mt-1"
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            Saya mengizinkan nama dan cuplikan selera dari Lagu Disukai,
            playlist (termasuk privat), lagu terakhir, serta history lokal yang
            digunakan saat refresh dibagikan hanya dengan peserta setelah
            undangan diterima. Keluar dari Blend menghentikan akses baru, bukan
            menarik salinan yang sudah diterima.
          </span>
        </label>
        <button
          className="profile-button"
          disabled={busy || !consent}
          onClick={() => void create()}
        >
          {busy ? (
            <Loader2
              size={16}
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            <Shuffle size={16} />
          )}
          Buat Undangan Blend
        </button>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            openCode();
          }}
        >
          <input
            aria-label="Kode atau URL undangan Blend"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="profile-input flex-1 min-w-0 !mt-0"
            placeholder="Tempel kode / URL undangan"
            maxLength={2048}
          />
          <button
            className="profile-button"
            type="submit"
            disabled={!code.trim()}
          >
            Terima undangan
          </button>
        </form>
        <p className="text-xs">
          Membuka tautan/kode undangan saat login menerima undangan otomatis dan
          menyetujui berbagi cuplikan selera di atas.
        </p>
      </div>
      <div className="flex justify-between items-center">
        <h3 className="font-bold">Blend kamu</h3>
        <button
          className="profile-button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw size={14} />
          Muat ulang
        </button>
      </div>
      {error && (
        <p className="m3-card p-4 text-sm" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        rows.length ? <LibrarySyncIndicator /> : <LibrarySkeleton layout="blend" toolbar={false} label="Memuat Blend" />
      ) : !rows.length && !error ? (
        <div className="m3-card p-6 text-sm text-[var(--m3-on-surface-variant)]">
          Belum ada Blend. Buat undangan atau terima undangan teman untuk
          memulai.
        </div>
      ) : null}
      <div className="grid sm:grid-cols-2 gap-3">
        {rows.map((b) => (
          <article key={b.id} className="m3-card p-4 space-y-3">
            <button
              className="text-left w-full space-y-1"
              onClick={() => openDetail({ kind: "blend", id: b.id })}
            >
              <h4 className="font-bold">
                {b.status === "pending"
                  ? b.creator_id === userId
                    ? "Undangan Blend kamu"
                    : "Undangan dari teman"
                  : b.status === "declined"
                  ? "Blend diakhiri"
                  : "Blend dua selera"}
              </h4>
              <p className="text-xs text-[var(--m3-on-surface-variant)]">
                {b.status === "active"
                  ? `${b.tracks.length} lagu · ${
                      b.last_refreshed_at
                        ? `${b.match_percent}% cocok`
                        : "Menyiapkan racikan"
                    }`
                  : b.status === "pending"
                  ? "Menunggu penerimaan"
                  : "Akses selera sudah dihentikan"}
              </p>
            </button>
            {b.status === "pending" && b.creator_id === userId && (
              <div className="space-y-2">
                <code className="block text-xs break-all select-all">
                  {b.invite_code}
                </code>
                <button className="profile-button" onClick={() => void copy(b)}>
                  <Copy size={14} />
                  Salin tautan
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
