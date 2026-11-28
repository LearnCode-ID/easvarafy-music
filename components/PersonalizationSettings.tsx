"use client";
import { useState } from "react";
import { useMusic } from "./MusicProvider";

export function PersonalizationSettings({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { personalization, showToast, clearPlayHistory } = useMusic();
  const { store, state, ready, error } = personalization;
  const [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState(false);
  const available = ready && store.guestAvailable() && !dismissed;
  async function action(run: () => Promise<void>, message: string) {
    setBusy(true);
    try {
      await run();
      showToast(message);
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : "Perubahan belum tersimpan. Coba lagi."
      );
    } finally {
      setBusy(false);
    }
  }
  if (compact && !available) return null;
  return (
    <section
      aria-label="Privasi rekomendasi"
      className="metro-surface rounded-2xl p-4 space-y-3 text-sm"
    >
      {!compact && (
        <>
          <h3 className="font-semibold">Personalisasi musik</h3>
          <p className="text-xs opacity-65">
            {store.owner
              ? "Preferensi privat akun ini disinkronkan lewat Supabase, terpisah dari profil publik."
              : "Preferensi guest hanya disimpan di browser ini, maksimal 300 sinyal selama 90 hari. Tanpa fingerprint atau lokasi perangkat."}{" "}
            Saat dinonaktifkan, sinyal baru tidak dicatat dan rekomendasi hanya
            memakai konteks lagu/katalog.
          </p>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={state.enabled}
              disabled={!ready || busy}
              onChange={() =>
                void action(
                  () => store.control(!state.enabled),
                  "Preferensi personalisasi diperbarui"
                )
              }
            />
            Aktifkan personalisasi
          </label>
          <button
            type="button"
            disabled={!ready || busy}
            className="metro-surface rounded-full px-4 py-2 disabled:opacity-40"
            onClick={() => {
              if (
                window.confirm(
                  "Hapus riwayat rekomendasi, preferensi, dan blokir untuk identitas ini? Library dan playlist tidak dihapus."
                )
              )
                void action(async () => {
                  await store.control(state.enabled, true);
                  clearPlayHistory();
                }, "Riwayat rekomendasi dihapus");
            }}
          >
            Hapus riwayat & reset preferensi
          </button>
          {error && (
            <p role="status" className="text-xs opacity-65">
              {error}{" "}
              <button
                type="button"
                disabled={busy}
                onClick={() => void store.load()}
                className="underline"
              >
                Coba sinkronkan
              </button>
            </p>
          )}
        </>
      )}
      {available && (
        <div className="space-y-2">
          <h3 className="font-semibold">Gabungkan preferensi guest?</h3>
          <p className="text-xs opacity-65">
            Opsional: kirim ringkasan maksimal 30 lagu yang didengarkan guest ke
            akun ini. Riwayat mentah dan waktu putar guest tidak diunggah. Tidak
            ada penggabungan otomatis. Ringkasan lokal dihapus hanya setelah
            server mengonfirmasi.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !state.enabled}
              onClick={() =>
                void action(
                  () => store.mergeGuest(),
                  "Preferensi guest berhasil digabungkan"
                )
              }
              className="rounded-full px-4 py-2 bg-[var(--m3-primary)] text-[var(--m3-on-primary)] disabled:opacity-40"
            >
              Setuju, gabungkan
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="metro-surface rounded-full px-4 py-2"
            >
              Jangan sekarang
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
