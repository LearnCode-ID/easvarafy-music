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
} from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { useMusic } from "./MusicProvider";
import { ArtworkImage } from "./ArtworkImage";
import { ProfileAvatar } from "./ProfileAvatar";
import { TrackContextMenu } from "./TrackContextMenu";
import { OfflineAvailability } from "./DownloadButton";
import { PlaylistActionDialog } from "./PlaylistActionDialog";
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
import { sortPlaylistTracks, type PlaylistSort } from "@/lib/ui/playlist";
import type { UserPlaylist } from "@/lib/metrolist/types";
import { publicPlaylistUrl } from "@/lib/social/playlistPage";
import { cn } from "@/lib/utils";

export function UserPlaylistView({
  playlist,
  canEdit = true,
  owner,
}: {
  playlist: UserPlaylist;
  canEdit?: boolean;
  owner?: { name: string; avatar: string | null };
}) {
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
    libraryError,
    showToast,
    likedTracks,
    history,
    addTrackToPlaylist,
    setActiveTab,
  } = useMusic();
  const [sort, setSort] = useState<PlaylistSort>("custom");
  const [filter, setFilter] = useState("");
  const [panel, setPanel] = useState<
    "details" | "add" | "menu" | "download" | "edit" | "sort" | "search" | null
  >(null);
  const [downloading, setDownloading] = useState(false);
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
  const name = owner?.name || auth.profile?.name || "Kamu";
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
    try {
      const url = publicPlaylistUrl(playlist.id);
      if (navigator.share) await navigator.share({ url });
      else {
        await navigator.clipboard.writeText(url);
        showToast("Tautan playlist disalin. Privasi playlist tidak berubah.");
      }
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError"))
        showToast("Belum bisa membagikan tautan playlist. Coba lagi.");
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
  const renderRows = (isEditing: boolean) =>
    (isEditing ? playlist.tracks : tracks).map((track) => {
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
            onClick={() =>
              playTrack(track, isEditing ? playlist.tracks : tracks)
            }
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
          {isEditing ? (
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
                disabled={librarySaving || index === playlist.tracks.length - 1}
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
            <TrackContextMenu track={track} vertical popup />
          )}
        </div>
      );
    });
  const panelTitle =
    panel === "add"
      ? "Tambahkan lagu"
      : panel === "download"
      ? "Unduh playlist?"
      : panel === "details"
      ? "Nama & detail"
      : panel === "edit"
      ? "Edit lagu playlist"
      : panel === "sort"
      ? "Urutkan playlist"
      : panel === "search"
      ? "Cari di playlist"
      : "Opsi playlist";
  return (
    <div data-testid="detail-view" className="user-playlist pb-8">
      <section
        className="user-playlist-hero"
        aria-label={canEdit ? "Detail playlist kamu" : "Detail playlist publik"}
      >
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
            aria-haspopup="dialog"
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
              reference={
                owner ? owner.avatar : auth.profile?.avatar_url || null
              }
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
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Aksi cepat playlist"
          >
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
              <Shuffle size={21} />
            </button>
            <button
              className="playlist-icon"
              aria-label="Bagikan playlist"
              onClick={() => void share()}
            >
              <Share2 size={21} />
            </button>
            <button
              className="playlist-icon"
              aria-label="Unduh playlist"
              aria-haspopup="dialog"
              disabled={!playlist.tracks.length || downloading}
              onClick={() => setPanel("download")}
            >
              <CircleArrowDown size={21} />
            </button>
            <button
              className="playlist-icon"
              aria-label="Cari di playlist"
              aria-haspopup="dialog"
              onClick={() => setPanel("search")}
            >
              <Search size={21} />
            </button>
          </div>
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
      </section>

      {panel && (
        <PlaylistActionDialog title={panelTitle} onClose={() => setPanel(null)}>
          {librarySaving && (
            <p role="status" className="text-sm">
              Menyimpan ke Supabase…
            </p>
          )}
          {libraryError && (
            <p role="alert" className="text-sm">
              {libraryError}
            </p>
          )}
          {panel === "sort" && (
            <div
              className="space-y-2"
              role="group"
              aria-label="Urutkan lagu playlist"
            >
              {(
                [
                  ["custom", "Urutan saya"],
                  ["title", "Judul A–Z"],
                  ["artist", "Artis A–Z"],
                  ["duration", "Durasi"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  className="profile-button w-full justify-between"
                  aria-pressed={sort === value}
                  onClick={() => {
                    setSort(value);
                    setPanel(null);
                  }}
                >
                  {label}
                  {sort === value && <Check size={18} />}
                </button>
              ))}
            </div>
          )}
          {panel === "search" && (
            <>
              <label className="block text-sm">
                Cari judul atau artis
                <input
                  className="profile-input"
                  aria-label="Filter playlist tracks"
                  placeholder="Cari di playlist ini"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                />
              </label>
              <p className="text-sm text-[var(--glass-muted)]">
                {tracks.length} lagu cocok
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  className="profile-button"
                  onClick={() => setPanel(null)}
                >
                  Tampilkan hasil
                </button>
                <button
                  className="profile-button"
                  onClick={() => setFilter("")}
                >
                  Hapus pencarian
                </button>
              </div>
            </>
          )}
          {canEdit && panel === "edit" && (
            <>
              <p className="text-sm text-[var(--glass-muted)]">
                Atur urutan aslimu atau hapus lagu dari playlist.
              </p>
              {!playlist.tracks.length ? (
                <p className="text-sm">Playlist ini masih kosong.</p>
              ) : (
                <div data-testid="playlist-edit-tracks">{renderRows(true)}</div>
              )}
              <p className="text-xs text-[var(--glass-muted)] flex items-start gap-2">
                <Check size={16} className="shrink-0" />
                Urutan dan penghapusan berubah hanya setelah penyimpanan server
                berhasil.
              </p>
              <button
                className="profile-button w-full justify-center"
                onClick={() => setPanel(null)}
              >
                Selesai
              </button>
            </>
          )}
          {canEdit && panel === "details" && (
            <PlaylistEditor playlist={playlist} initiallyOpen />
          )}
          {panel === "menu" && (
            <div className="space-y-2">
              {canEdit && (
                <>
                  <button
                    className="profile-button w-full"
                    onClick={() => setPanel("add")}
                  >
                    <Plus size={18} />
                    Tambahkan lagu
                  </button>
                  <button
                    className="profile-button w-full"
                    onClick={() => setPanel("edit")}
                  >
                    <ListMusic size={18} />
                    Edit lagu & urutan
                  </button>
                  <button
                    className="profile-button w-full"
                    onClick={() => setPanel("details")}
                  >
                    <Pencil size={18} />
                    Edit nama & detail
                  </button>
                </>
              )}
              <button
                className="profile-button w-full"
                onClick={() => setPanel("sort")}
              >
                <ArrowUpDown size={18} />
                Urutkan lagu
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
          {canEdit && panel === "add" && (
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
        </PlaylistActionDialog>
      )}

      {!playlist.tracks.length ? (
        <p className="py-10 text-sm text-[var(--glass-muted)]">
          Playlist ini masih kosong. Tambahkan lagu untuk mulai mendengarkan.
        </p>
      ) : !tracks.length ? (
        <p className="py-10 text-sm">Tidak ada lagu yang cocok.</p>
      ) : (
        <div data-testid="user-playlist-tracks" className="playlist-track-list">
          {renderRows(false)}
        </div>
      )}
    </div>
  );
}
