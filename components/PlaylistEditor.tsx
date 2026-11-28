"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, Loader2, X } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { ArtworkImage } from "./ArtworkImage";
import {
  cropProfileImage,
  validateProfileFile,
  releaseImage,
} from "@/lib/social/profilePage";
import {
  PLAYLIST_COVER_PREFIX,
  uploadPlaylistCover,
} from "@/lib/social/playlistCover";
import type { UserPlaylist } from "@/lib/metrolist/types";
import { useMusic } from "./MusicProvider";

export function PlaylistEditor({
  playlist,
  initiallyOpen = false,
}: {
  playlist: UserPlaylist;
  initiallyOpen?: boolean;
}) {
  const auth = useAuth();
  const { editPlaylist, updatePlaylistTags, librarySaving } = useMusic();
  const [name, setName] = useState(playlist.name);
  const [tags, setTags] = useState((playlist.tags || []).join(", "));
  const [description, setDescription] = useState(playlist.description || "");
  const [cover, setCover] = useState(playlist.coverUrl || "");
  const [photo, setPhoto] = useState<{
    blob: Blob;
    preview: string;
    uploaded?: string;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selection = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      selection.current++;
    },
    []
  );
  useEffect(() => () => releaseImage(photo?.preview), [photo?.preview]);
  const choosePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const id = ++selection.current;
    let source: string | null = null;
    setError("");
    setPhoto(null);
    setCover(playlist.coverUrl || "");
    try {
      validateProfileFile(file);
      setPreparing(true);
      source = URL.createObjectURL(file);
      const blob = await cropProfileImage(source, 1, 50, 50, 1);
      if (id !== selection.current) return;
      setPhoto({ blob, preview: URL.createObjectURL(blob) });
    } catch (cause) {
      if (id === selection.current)
        setError(
          cause instanceof Error ? cause.message : "Foto tidak dapat dibaca."
        );
    } finally {
      releaseImage(source);
      if (id === selection.current) setPreparing(false);
    }
  };
  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || preparing || librarySaving || !name.trim()) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      if (!navigator.onLine)
        throw new Error(
          "Offline. Perubahan belum disimpan. Hubungkan internet lalu coba lagi."
        );
      let reference = cover;
      if (photo) {
        if (!auth.userId)
          throw new Error("Masuk untuk mengunggah cover playlist.");
        reference =
          photo.uploaded ||
          (await uploadPlaylistCover(auth.userId, photo.blob));
        // Retain a completed upload for retry if the subsequent RPC fails or its
        // response is lost. Never delete bytes that might already be referenced.
        setPhoto({ ...photo, uploaded: reference });
        setCover(reference);
      }
      const saved = await editPlaylist(playlist.id, {
        name: name.trim(),
        description,
        coverUrl: reference,
      });
      if (!saved)
        throw new Error(
          "Detail belum dikonfirmasi tersimpan. Coba simpan lagi."
        );
      setPhoto(null);
      setCover(saved.coverUrl || "");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Detail belum tersimpan. Coba lagi."
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  useEffect(() => {
    queueMicrotask(() => {
      setName(playlist.name);
      setTags((playlist.tags || []).join(", "));
      setDescription(playlist.description || "");
      setCover(playlist.coverUrl || "");
    });
  }, [
    playlist.id,
    playlist.name,
    playlist.tags,
    playlist.description,
    playlist.coverUrl,
  ]);
  const move = (index: number, delta: number) => {
    const tracks = [...playlist.tracks];
    [tracks[index], tracks[index + delta]] = [
      tracks[index + delta],
      tracks[index],
    ];
    editPlaylist(playlist.id, { tracks });
  };
  return (
    <details
      open={initiallyOpen || undefined}
      className="m3-card p-4 text-[var(--m3-on-surface)]"
    >
      <summary className="cursor-pointer font-semibold">
        Nama, cover & privasi playlist
      </summary>
      <fieldset
        disabled={librarySaving || preparing || saving}
        className="mt-4 space-y-4 disabled:opacity-60"
      >
        <form className="space-y-3" onSubmit={saveDetails}>
          <label className="text-sm block">
            Nama playlist
            <input
              className="profile-input"
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="text-sm block">
            Deskripsi
            <textarea
              className="profile-input"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="space-y-3">
            <ArtworkImage
              src={photo?.preview || cover || playlist.tracks[0]?.thumbnail}
              alt="Preview cover playlist"
              className="w-36 h-36"
              sizeHint="md"
            />
            <label className="profile-button cursor-pointer">
              <Camera size={16} />
              Unggah foto cover
              <input
                type="file"
                className="sr-only"
                aria-label="Unggah foto cover playlist"
                accept="image/jpeg,image/png,image/webp"
                onChange={choosePhoto}
              />
            </label>
            <p className="text-xs text-[var(--glass-muted)]">
              JPG, PNG, WebP · maksimal 10 MB. Foto dipotong persegi dan
              dikompres. Preview belum tersimpan sebelum Simpan detail berhasil.
            </p>
            {photo && (
              <button
                className="profile-button"
                type="button"
                onClick={() => {
                  selection.current++;
                  setPhoto(null);
                  setCover(playlist.coverUrl || "");
                }}
              >
                <X size={16} />
                Batalkan foto pilihan
              </button>
            )}
            {!photo && !cover.startsWith(PLAYLIST_COVER_PREFIX) && (
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
            )}
            {cover.startsWith(PLAYLIST_COVER_PREFIX) && !photo && (
              <button
                className="profile-button"
                type="button"
                onClick={() => setCover("")}
              >
                Gunakan cover lagu pertama
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm">
              {error}
            </p>
          )}
          {preparing && (
            <p role="status" className="text-sm">
              Menyiapkan foto…
            </p>
          )}
          <button className="profile-button" type="submit">
            {saving && <Loader2 size={16} className="animate-spin" />}Simpan
            detail
          </button>
        </form>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            updatePlaylistTags(
              playlist.id,
              tags
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean)
            );
          }}
        >
          <label className="text-sm block">
            Tag (pisahkan dengan koma)
            <input
              className="profile-input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          <button className="profile-button" type="submit">
            Simpan tag
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
        {!initiallyOpen && (
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
        )}
      </fieldset>
    </details>
  );
}
