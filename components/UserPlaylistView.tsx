"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Check,
  CircleArrowDown,
  Globe2,
  ListMusic,
  Loader2,
  LockKeyhole,
  MoreVertical,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Share2,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { useMusic } from "./MusicProvider";
import { ArtworkImage } from "./ArtworkImage";
import { ProfileAvatar } from "./ProfileAvatar";
import { TrackContextMenu } from "./TrackContextMenu";
import { OfflineAvailability } from "./DownloadButton";
import { PlaylistEditor } from "./PlaylistEditor";
import {
  filterTracksByQuery,
  computeTotalDurationSec,
  formatLongDuration,
} from "@/lib/metrolist/statsEngine";
import {
  downloadTrack,
  isOfflineDownloadSupported,
} from "@/lib/metrolist/offlineAudio";
import {
  sortPlaylistTracks,
  playlistShareText,
  type PlaylistSort,
} from "@/lib/ui/playlist";
import type { UserPlaylist } from "@/lib/metrolist/types";
import { useBackHandler } from "@/lib/native/backButton";
import { cn } from "@/lib/utils";

export function UserPlaylistView({ playlist }: { playlist: UserPlaylist }) {
  const auth = useAuth();
  const {
    openDetail,
    playTrack,
    currentTrack,
    queueState,
    isPlaying,
    togglePlayPause,
    toggleShuffle,
    removeTrackFromPlaylist,
    editPlaylist,
    librarySaving,
    showToast,
    likedTracks,
    history,
    addTrackToPlaylist,
    setActiveTab,
  } = useMusic();
  const [sort, setSort] = useState<PlaylistSort>("custom");
  const [filter, setFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<
    "details" | "add" | "menu" | "download" | null
  >(null);
  const [downloading, setDownloading] = useState(false);
  useBackHandler(Boolean(panel), () => setPanel(null));
  const tracks = useMemo(
    () =>
      filterTracksByQuery(sortPlaylistTracks(playlist.tracks, sort), filter),
    [playlist.tracks, sort, filter]
  );
  const candidates = useMemo(() => {
    const seen = new Set(playlist.tracks.map((track) => track.videoId));
    return [...likedTracks, ...history.map((item) => item.track)].filter(
      (track) => {
        if (seen.has(track.videoId)) return false;
        seen.add(track.videoId);
        return true;
      }
    );
  }, [likedTracks, history, playlist.tracks]);
  const name = auth.profile?.name || "Kamu";
  const cover = playlist.coverUrl || playlist.tracks[0]?.thumbnail || "";
  const active =
    !!currentTrack &&
    playlist.tracks.some((track) => track.videoId === currentTrack.videoId);
  const togglePanel = (next: typeof panel) =>
    setPanel((previous) => (previous === next ? null : next));
  const move = (index: number, delta: number) => {
    const next = [...playlist.tracks];
    if (index + delta < 0 || index + delta >= next.length) return;
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    editPlaylist(playlist.id, { tracks: next });
  };
  const share = async () => {
    const text = playlistShareText(playlist.name, playlist.tracks);
    try {
      if (navigator.share)
        await navigator.share({ title: playlist.name, text });
      else {
        await navigator.clipboard.writeText(text);
        showToast("Daftar lagu disalin. Privasi playlist tidak berubah.");
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        showToast("Belum bisa membagikan daftar lagu. Coba lagi.");
    }
  };
  const download = async () => {
    setPanel(null);
    if (!isOfflineDownloadSupported()) {
      showToast("Penyimpanan offline belum didukung di perangkat ini.");
      return;
    }
    if (!navigator.onLine) {
      showToast("Hubungkan internet untuk mengunduh playlist.");
      return;
    }
    setDownloading(true);
    try {
      const results = await Promise.allSettled(
        playlist.tracks.map((track) => downloadTrack(track))
      );
      const saved = results.filter(
        (result) => result.status === "fulfilled"
      ).length;
      showToast(
        `${saved}/${results.length} lagu tersimpan offline${
          saved < results.length
            ? ". Sebagian unduhan gagal; periksa daftar Unduhan."
            : "."
        }`
      );
    } finally {
      setDownloading(false);
    }
  };
  return (
    <div data-testid="detail-view" className="user-playlist pb-8">
      <section className="user-playlist-hero" aria-label="Detail playlist kamu">
        <div className="user-playlist-toolbar">
          <button
            className="playlist-icon playlist-icon-scrim"
            aria-label="Kembali dari playlist"
            onClick={() => openDetail(null)}
          >
            <ArrowLeft />
          </button>
          <span className="sr-only">Playlist kamu</span>
          <button
            className="playlist-icon playlist-icon-scrim"
            aria-label="Opsi playlist"
            aria-expanded={panel === "menu"}
            onClick={() => togglePanel("menu")}
          >
            <MoreVertical />
          </button>
        </div>
        <ArtworkImage
          src={cover}
          alt={`Cover ${playlist.name}`}
          sizeHint="lg"
          rounded="rounded-lg"
          className="user-playlist-cover"
        />
        <div className="mt-6 space-y-3">
          <h1 className="text-3xl sm:text-5xl font-bold break-words leading-tight">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="text-sm text-[var(--glass-muted)] break-words">
              {playlist.description}
            </p>
          )}
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ProfileAvatar
              reference={auth.profile?.avatar_url || null}
              name={name}
              className="h-7 w-7 rounded-full shrink-0"
            />
            <span className="truncate">{name}</span>
          </div>
          <p className="flex items-center gap-2 text-sm text-[var(--glass-muted)]">
            {playlist.isPublic ? (
              <Globe2 className="w-4 h-4" />
            ) : (
              <LockKeyhole className="w-4 h-4" />
            )}
            <span>
              {playlist.isPublic ? "Publik" : "Privat"} ·{" "}
              {playlist.tracks.length} lagu ·{" "}
              {formatLongDuration(computeTotalDurationSec(playlist.tracks))}
            </span>
          </p>
          {!!playlist.tags?.length && (
            <p className="text-xs text-[var(--glass-muted)] break-words">
              {playlist.tags.map((tag) => `#${tag}`).join("  ")}
            </p>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 mt-5">
          <div className="flex items-center gap-1">
            <span aria-hidden="true" className="playlist-mini-cover">
              <ArtworkImage
                src={cover}
                alt=""
                className="w-full h-full"
                rounded="rounded"
                sizeHint="sm"
              />
            </span>
            <button
              className="playlist-icon"
              aria-label="Unduh playlist"
              disabled={!playlist.tracks.length || downloading}
              onClick={() => setPanel("download")}
            >
              {downloading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <CircleArrowDown />
              )}
            </button>
            <button
              className="playlist-icon"
              aria-label="Bagikan daftar lagu"
              onClick={() => void share()}
            >
              <Share2 />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={cn(
                "playlist-icon",
                queueState.shuffle && "text-[var(--m3-primary)]"
              )}
              aria-label="Acak playlist"
              aria-pressed={queueState.shuffle}
              disabled={!playlist.tracks.length}
              onClick={toggleShuffle}
            >
              <Shuffle />
            </button>
            <button
              className="playlist-play"
              aria-label={
                active && isPlaying ? "Jeda playlist" : "Putar playlist"
              }
              disabled={!tracks.length}
              onClick={() => {
                if (active) togglePlayPause();
                else if (tracks[0]) playTrack(tracks[0], tracks);
              }}
            >
              {active && isPlaying ? (
                <Pause className="fill-current" />
              ) : (
                <Play className="fill-current ml-1" />
              )}
            </button>
          </div>
        </div>
      </section>

      <div className="playlist-chip-row" aria-label="Kelola playlist">
        <button
          className="playlist-chip"
          onClick={() => togglePanel("add")}
          aria-expanded={panel === "add"}
        >
          <Plus />
          Tambahkan
        </button>
        <button
          className="playlist-chip"
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing);
            setSort("custom");
            setFilter("");
            setShowFilter(false);
          }}
        >
          <ListMusic />
          {editing ? "Selesai" : "Edit"}
        </button>
        <button
          className="playlist-chip"
          aria-expanded={panel === "details"}
          onClick={() => togglePanel("details")}
        >
          <Pencil />
          Nama &amp; detail
        </button>
        <label className="playlist-chip">
          <ArrowUpDown />
          <span className="sr-only">Urutkan lagu playlist</span>
          <select
            aria-label="Urutkan lagu playlist"
            value={sort}
            disabled={editing}
            onChange={(event) => setSort(event.target.value as PlaylistSort)}
            className="bg-transparent min-w-0 outline-none"
          >
            <option value="custom">Urutan saya</option>
            <option value="title">Judul A–Z</option>
            <option value="artist">Artis A–Z</option>
            <option value="duration">Durasi</option>
          </select>
        </label>
        <button
          className="playlist-chip"
          aria-expanded={showFilter}
          disabled={editing}
          onClick={() => {
            setShowFilter(!showFilter);
            setFilter("");
          }}
        >
          <Search />
          Cari
        </button>
      </div>

      {panel && (
        <section
          className="m3-card p-4 my-4 space-y-4"
          aria-label="Pengaturan playlist"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-bold">
              {panel === "add"
                ? "Tambahkan lagu"
                : panel === "download"
                ? "Unduh playlist?"
                : "Kelola playlist"}
            </h2>
            <button
              className="playlist-icon"
              aria-label="Tutup pengaturan playlist"
              onClick={() => setPanel(null)}
            >
              <X />
            </button>
          </div>
          {panel === "details" && (
            <PlaylistEditor playlist={playlist} initiallyOpen />
          )}
          {panel === "menu" && (
            <div className="flex flex-wrap gap-2">
              <button
                className="profile-button"
                onClick={() => setPanel("details")}
              >
                <Pencil size={16} />
                Edit nama &amp; detail
              </button>
              <button className="profile-button" onClick={() => void share()}>
                <Share2 size={16} />
                Bagikan daftar lagu
              </button>
            </div>
          )}
          {panel === "download" && (
            <>
              <p className="text-sm">
                {playlist.tracks.length} lagu akan masuk antrean unduhan. Proses
                memakai internet dan ruang penyimpanan; lagu baru tersedia
                offline setelah unduhan berhasil.
              </p>
              <button
                className="profile-button"
                onClick={() => void download()}
              >
                Unduh {playlist.tracks.length} lagu
              </button>
            </>
          )}
          {panel === "add" && (
            <>
              <p className="text-sm text-[var(--glass-muted)]">
                Pilih dari lagu disukai dan riwayatmu. Untuk lagu lain, buka
                Pencarian lalu gunakan menu lagu → Add to playlist.
              </p>
              <button
                className="profile-button"
                onClick={() => {
                  openDetail(null);
                  setActiveTab("search");
                }}
              >
                Cari lagu lain
              </button>
              {!candidates.length && (
                <p className="text-sm">Belum ada kandidat dari library kamu.</p>
              )}
              <ul className="max-h-80 overflow-y-auto">
                {candidates.slice(0, 30).map((track) => (
                  <li
                    key={track.videoId}
                    className="flex items-center gap-3 py-2"
                  >
                    <ArtworkImage
                      src={track.thumbnail}
                      alt=""
                      className="w-10 h-10"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {track.title}
                      <span className="block text-xs text-[var(--glass-muted)] truncate">
                        {track.artist}
                      </span>
                    </span>
                    <button
                      className="playlist-icon"
                      disabled={librarySaving}
                      aria-label={`Tambahkan ${track.title} ke playlist ini`}
                      onClick={() => addTrackToPlaylist(playlist.id, track)}
                    >
                      <Plus />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {showFilter && (
        <label className="relative block mt-3 mb-2 max-w-md">
          <Search className="absolute left-3 top-3 w-4 h-4 text-[var(--glass-muted)]" />
          <input
            className="profile-input !rounded-full !pl-10 !mt-0"
            aria-label="Filter playlist tracks"
            placeholder="Cari di playlist ini"
            value={filter}
            disabled={editing}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      )}
      {!playlist.tracks.length ? (
        <p className="py-10 text-sm text-[var(--glass-muted)]">
          Playlist ini masih kosong. Tambahkan lagu untuk mulai mendengarkan.
        </p>
      ) : !tracks.length ? (
        <p className="py-10 text-sm">Tidak ada lagu yang cocok.</p>
      ) : (
        <div data-testid="user-playlist-tracks" className="playlist-track-list">
          {tracks.map((track) => {
            const selected = currentTrack?.videoId === track.videoId;
            const index = playlist.tracks.indexOf(track);
            return (
              <div
                key={track.videoId}
                className="playlist-track-row"
                data-track-id={track.videoId}
              >
                <button
                  className="flex flex-1 min-w-0 items-center gap-3 text-left"
                  aria-label={`Putar ${track.title}`}
                  onClick={() => playTrack(track, tracks)}
                >
                  <ArtworkImage
                    src={track.thumbnail}
                    alt={track.title}
                    className="h-12 w-12 shrink-0"
                    rounded="rounded-md"
                    sizeHint="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-sm font-semibold truncate",
                        selected && "text-[var(--m3-primary)]"
                      )}
                    >
                      {track.title}
                    </span>
                    <span className="block text-xs text-[var(--glass-muted)] truncate mt-1">
                      {track.artist}
                    </span>
                  </span>
                </button>
                <OfflineAvailability track={track} />
                {editing ? (
                  <div className="flex shrink-0">
                    <button
                      className="playlist-icon !w-8 !min-w-8"
                      disabled={librarySaving || index === 0}
                      aria-label={`Naikkan ${track.title}`}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={18} />
                    </button>
                    <button
                      className="playlist-icon !w-8 !min-w-8"
                      disabled={
                        librarySaving || index === playlist.tracks.length - 1
                      }
                      aria-label={`Turunkan ${track.title}`}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={18} />
                    </button>
                    <button
                      className="playlist-icon !w-8 !min-w-8"
                      disabled={librarySaving}
                      aria-label={`Remove ${track.title} from playlist`}
                      onClick={() =>
                        removeTrackFromPlaylist(playlist.id, track.videoId)
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ) : (
                  <TrackContextMenu track={track} vertical />
                )}
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <p className="text-xs text-[var(--glass-muted)] mt-4 flex items-center gap-2">
          <Check size={14} />
          Urutan dan penghapusan berubah hanya setelah penyimpanan server
          berhasil.
        </p>
      )}
    </div>
  );
}
