"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { useMusic } from "./MusicProvider";
import { ProfileAvatar } from "./ProfileAvatar";
import { FollowButton } from "./FollowControls";
import {
  FOLLOW_EVENT,
  fetchFollowingFeed,
  type FriendActivity,
} from "@/lib/social/follows";

export function FollowingFeed() {
  const { userId } = useAuth();
  return <FollowingFeedContent key={userId || "guest"} />;
}
function FollowingFeedContent() {
  const { userId } = useAuth();
  const { openDetail, playTrack } = useMusic();
  const router = useRouter();
  const [rows, setRows] = useState<FriendActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const load = useCallback(
    async (offset = 0) => {
      if (!userId) return;
      setLoading(true);
      try {
        const data = await fetchFollowingFeed(offset);
        setRows((previous) => (offset ? [...previous, ...data] : data));
        setMore(data.length === 30);
        setError("");
      } catch (e) {
        setRows([]);
        setError(
          e instanceof Error ? e.message : "Aktivitas teman belum tersedia."
        );
      } finally {
        setLoading(false);
      }
    },
    [userId]
  );
  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => void load();
    window.addEventListener(FOLLOW_EVENT, refresh);
    window.addEventListener("focus", refresh);
    const timer = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener(FOLLOW_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      clearInterval(timer);
    };
  }, [load]);
  if (!userId)
    return (
      <div className="m3-card p-6 space-y-3">
        <p>Masuk untuk melihat teman yang kamu ikuti.</p>
        <button
          className="profile-button"
          onClick={() => router.push("/login")}
        >
          Masuk
        </button>
      </div>
    );
  return (
    <section className="space-y-4" aria-label="Friend Activity">
      <header className="flex justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">
            Following · Aktivitas teman
          </h2>
          <p className="text-xs text-[var(--m3-on-surface-variant)]">
            Lagu terakhir hanya muncul jika teman mengizinkan berbagi aktivitas
            pada profil publik.
          </p>
        </div>
        <button
          className="profile-button"
          disabled={loading}
          onClick={() => void load()}
          aria-label="Muat ulang aktivitas teman"
        >
          <RefreshCw size={16} />
        </button>
      </header>
      {loading && (
        <p role="status" className="text-sm">
          Memuat aktivitas…
        </p>
      )}
      {error && (
        <div role="alert" className="m3-card p-4 text-sm">
          {error}{" "}
          <button className="underline p-2" onClick={() => void load()}>
            Coba lagi
          </button>
        </div>
      )}
      {!loading && !error && !rows.length && (
        <div className="m3-card p-8 text-sm text-[var(--m3-on-surface-variant)]">
          Belum mengikuti siapa pun. Temukan teman melalui Top Pendengar atau
          direktori pengguna.
        </div>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        {rows.map((p) => (
          <article key={p.user_id} className="m3-card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <button
                className="flex flex-1 min-w-0 items-center gap-3 text-left"
                onClick={() =>
                  openDetail({ kind: "user-profile", id: p.user_id })
                }
              >
                <ProfileAvatar
                  reference={p.avatar_url}
                  name={p.name}
                  className="h-11 w-11 rounded-full object-cover shrink-0"
                />
                <span className="truncate font-bold text-sm">{p.name}</span>
              </button>
              <FollowButton targetId={p.user_id} />
            </div>
            {p.is_private ? (
              <p className="text-xs text-[var(--m3-on-surface-variant)]">
                Profil ini privat.
              </p>
            ) : (
              <>
                {p.last_track ? (
                  <button
                    className="text-left text-sm w-full space-y-1 rounded-xl p-3 bg-[var(--m3-surface-high)]"
                    onClick={() => playTrack(p.last_track!)}
                  >
                    <span className="text-xs text-[var(--m3-on-surface-variant)] block">
                      Terakhir diputar
                      {p.last_played_at
                        ? ` · ${new Date(p.last_played_at).toLocaleString(
                            "id-ID"
                          )}`
                        : ""}
                    </span>
                    <span className="block truncate font-semibold">
                      {p.last_track.title}
                    </span>
                    <span className="text-xs block truncate">
                      {p.last_track.artist}
                    </span>
                  </button>
                ) : (
                  <p className="text-xs text-[var(--m3-on-surface-variant)]">
                    Belum ada aktivitas lagu yang dibagikan.
                  </p>
                )}
                {p.playlist && (
                  <button
                    className="w-full text-left text-sm p-3 rounded-xl bg-[var(--m3-surface-high)]"
                    onClick={() =>
                      openDetail({ kind: "user-profile", id: p.user_id })
                    }
                  >
                    <span className="text-xs block text-[var(--m3-on-surface-variant)]">
                      Playlist publik terbaru
                    </span>
                    <span className="block font-semibold truncate">
                      {p.playlist.name}
                    </span>
                  </button>
                )}
              </>
            )}
          </article>
        ))}
      </div>
      {more && !loading && !error && (
        <button
          className="profile-button"
          onClick={() => void load(rows.length)}
        >
          Muat lebih banyak
        </button>
      )}
    </section>
  );
}
