"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth/AuthProvider";
import { BlendDetailView } from "./BlendDetailView";
import { BlendLibrarySection } from "./BlendLibrarySection";
import { joinBlend } from "@/lib/social/blendClient";
import { isUserId } from "@/lib/social/profilePage";

const INTENT_KEY = "easvarafy_blend_login_intent";
/** Re-enter invitation after Google/native OAuth's existing home redirect.
 * Only an explicit login click stores a short-lived tab-local intent. */
export function BlendReturnBridge() {
  const { ready, userId } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!ready || !userId) return;
    try {
      const raw = sessionStorage.getItem(INTENT_KEY);
      if (!raw) return;
      const intent = JSON.parse(raw);
      sessionStorage.removeItem(INTENT_KEY);
      if (
        typeof intent.code === "string" &&
        /^[a-f0-9]{32}$/.test(intent.code) &&
        Date.now() - intent.at < 15 * 60 * 1000
      )
        router.replace(`/blend?code=${intent.code}`);
    } catch {
      /* malformed or unavailable storage is non-fatal */
    }
  }, [ready, userId, router]);
  return null;
}
export function BlendLanding({
  code,
  id,
}: {
  code: string | null;
  id: string | null;
}) {
  const { userId } = useAuth();
  return (
    <BlendLandingContent key={`${userId}:${code}:${id}`} code={code} id={id} />
  );
}
function BlendLandingContent({
  code,
  id,
}: {
  code: string | null;
  id: string | null;
}) {
  const { ready, userId } = useAuth();
  const router = useRouter();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const normalized = code?.trim().toLowerCase();
  const valid = !!normalized && /^[a-f0-9]{32}$/.test(normalized);
  useEffect(() => {
    if (!ready || !userId || !valid || !normalized) return;
    let active = true;
    void joinBlend(normalized)
      .then((blendId) => {
        if (active) {
          try {
            sessionStorage.removeItem(INTENT_KEY);
          } catch {}
          router.replace(`/blend?id=${blendId}`);
        }
      })
      .catch((e) => {
        if (active)
          setError(e instanceof Error ? e.message : "Undangan gagal diterima.");
      });
    return () => {
      active = false;
    };
  }, [ready, userId, valid, normalized, router, retry]);
  if (code !== null) {
    if (!valid)
      return (
        <div className="m3-card p-8">
          <h1 className="font-bold text-xl">Undangan Blend tidak valid</h1>
          <p className="text-sm mt-2">
            Periksa kembali tautan atau kode undangan.
          </p>
        </div>
      );
    return (
      <div className="m3-card p-6 space-y-4">
        <h1 className="font-display font-bold text-2xl">Blend bersama teman</h1>
        <p className="text-sm">
          Membuka tautan ini saat login menerima undangan otomatis. Nama dan
          cuplikan selera dari Lagu Disukai, playlist (termasuk privat), lagu
          terakhir serta history lokal yang digunakan saat refresh akan
          dibagikan hanya ke peserta. Kamu dapat keluar untuk menghentikan akses
          baru.
        </p>
        {error ? (
          <div role="alert" className="space-y-3">
            <p>{error}</p>
            <button
              className="profile-button"
              onClick={() => {
                setError("");
                setRetry((v) => v + 1);
              }}
            >
              Coba lagi
            </button>
          </div>
        ) : !ready ? (
          <p role="status">Memuat sesi…</p>
        ) : !userId ? (
          <button
            className="profile-button"
            onClick={() => {
              try {
                sessionStorage.setItem(
                  INTENT_KEY,
                  JSON.stringify({ code: normalized, at: Date.now() })
                );
              } catch {}
              router.push(
                `/login?redirectTo=${encodeURIComponent(
                  `/blend?code=${normalized}`
                )}`
              );
            }}
          >
            Masuk & terima undangan
          </button>
        ) : (
          <p role="status">Menerima undangan dan menghubungkan Blend…</p>
        )}
      </div>
    );
  }
  if (id)
    return isUserId(id) ? (
      <BlendDetailView blendId={id} />
    ) : (
      <div className="m3-card p-6">Blend tidak ditemukan.</div>
    );
  return <BlendLibrarySection />;
}
