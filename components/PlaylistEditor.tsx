"use client";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { UserPlaylist } from "@/lib/metrolist/types";
import { useMusic } from "./MusicProvider";

export function PlaylistEditor({ playlist }: { playlist: UserPlaylist }) {
  const { editPlaylist, librarySaving } = useMusic();
  const [description, setDescription] = useState(playlist.description || "");
  const [cover, setCover] = useState(playlist.coverUrl || "");
  useEffect(() => {
    queueMicrotask(() => {
      setDescription(playlist.description || "");
      setCover(playlist.coverUrl || "");
    });
  }, [playlist.id, playlist.description, playlist.coverUrl]);
  const move = (index: number, delta: number) => {
    const tracks = [...playlist.tracks];
    [tracks[index], tracks[index + delta]] = [
      tracks[index + delta],
      tracks[index],
    ];
    editPlaylist(playlist.id, { tracks });
  };
  return (
    <details className="m3-card p-4 text-[var(--m3-on-surface)]">
      <summary className="cursor-pointer font-semibold">
        Kelola playlist & urutan lagu
      </summary>
      <fieldset
        disabled={librarySaving}
        className="mt-4 space-y-4 disabled:opacity-60"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            editPlaylist(playlist.id, { description, coverUrl: cover });
          }}
        >
          <label className="text-sm block">
            Deskripsi
            <textarea
              className="profile-input"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="text-sm block">
            URL cover (opsional)
            <input
              className="profile-input"
              type="url"
              pattern="https://.*"
              value={cover}
              onChange={(e) => setCover(e.target.value)}
            />
          </label>
          <button className="profile-button" type="submit">
            Simpan detail
          </button>
        </form>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={!!playlist.isPublic}
            onChange={(e) =>
              editPlaylist(playlist.id, { isPublic: e.target.checked })
            }
          />
          Playlist publik
        </label>
        <p className="text-xs text-[var(--m3-on-surface-variant)]">
          Playlist publik hanya terlihat oleh pengunjung jika profil kamu juga
          publik. Playlist privat selalu hanya untuk kamu.
        </p>
        <ol className="space-y-1">
          {playlist.tracks.map((track, i) => (
            <li
              key={`${track.videoId}-${i}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                {i + 1}. {track.title}
              </span>
              <button
                className="profile-button !p-2"
                aria-label={`Naikkan ${track.title}`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowUp size={16} />
              </button>
              <button
                className="profile-button !p-2"
                aria-label={`Turunkan ${track.title}`}
                disabled={i === playlist.tracks.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowDown size={16} />
              </button>
            </li>
          ))}
        </ol>
      </fieldset>
    </details>
  );
}
