"use client";

import { useEffect, useState } from "react";
import { useAuth } from "./auth/AuthProvider";
import { useMusic } from "./MusicProvider";
import { UserPlaylistView } from "./UserPlaylistView";
import {
  getPlaylistPage,
  isPlaylistId,
  type PlaylistPageData,
} from "@/lib/social/playlistPage";

export function PlaylistLanding({ id }: { id: string }) {
  const { userId } = useAuth();
  // Never retain the previous account's private route data across auth changes.
  return <PlaylistLandingContent key={`${userId}:${id}`} id={id} />;
}
function PlaylistLandingContent({ id }: { id: string }) {
  const auth = useAuth();
  const { playlists, libraryLoading, libraryError, openDetail } = useMusic();
  const own = playlists.find((p) => p.id === id);
  const [result, setResult] = useState<PlaylistPageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!auth.ready || libraryLoading || own) return;
    let active = true,
      request = 0;
    const load = async () => {
      const sequence = ++request;
      try {
        const data = await getPlaylistPage(id);
        if (active && sequence === request) {
          setResult(data);
          setError("");
        }
      } catch (cause) {
        if (active && sequence === request) {
          setResult(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Playlist belum dapat dimuat."
          );
        }
      } finally {
        if (active && sequence === request) setLoading(false);
      }
    };
    void load();
    const focus = () => {
      if (navigator.onLine) void load();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") focus();
    }, 30000);
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
    };
  }, [auth.ready, id, libraryLoading, own, retry]);
  if (!isPlaylistId(id))
    return <p className="m3-card p-6">Tautan playlist tidak valid.</p>;
  if (auth.ready && own) return <UserPlaylistView playlist={own} />;
  if (!auth.ready || libraryLoading || loading)
    return (
      <p role="status" className="m3-card p-6">
        Memuat playlist…
      </p>
    );
  if (result)
    return (
      <UserPlaylistView
        playlist={result.playlist}
        canEdit={false}
        owner={{ name: result.ownerName, avatar: result.ownerAvatar }}
      />
    );
  return (
    <section className="m3-card p-6 space-y-4">
      <h1 className="text-xl font-bold">Playlist tidak tersedia</h1>
      <p>
        Playlist tidak ditemukan atau tidak dibagikan untuk akun ini. Playlist
        dan profil pemilik harus publik agar dapat dibuka orang lain.
      </p>
      {(error || libraryError) && <p role="alert">{error || libraryError}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="profile-button" onClick={() => openDetail(null)}>
          Kembali
        </button>
        {!auth.userId && (
          <button
            className="profile-button"
            onClick={() => auth.openLoginPrompt()}
          >
            Masuk sebagai pemilik
          </button>
        )}
        <button
          className="profile-button"
          onClick={() => setRetry((value) => value + 1)}
        >
          Coba lagi
        </button>
      </div>
    </section>
  );
}
