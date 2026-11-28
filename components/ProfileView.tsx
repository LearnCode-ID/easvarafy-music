"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Flame,
  Loader2,
  LockKeyhole,
  Pencil,
  Share2,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { ProfileSocialControls } from './FollowControls';
import { VerifiedBadge } from "./auth/VerifiedBadge";
import { useMusic } from "./MusicProvider";
import { supabase } from "@/lib/supabase";
import {
  cropProfileImage,
  getProfilePage,
  publicProfileUrl,
  releaseImage,
  resolveProfileImage,
  uploadProfileMedia,
  validateProfileFile,
  type ProfilePageData,
} from "@/lib/social/profilePage";
import type { PublicUserPlaylist } from "@/lib/social/community";
import {
  fetchPublicUserPlaylists,
  formatListenDuration,
} from "@/lib/social/community";
import { useBackHandler } from "@/lib/native/backButton";

export function ProfileView({ userId }: { userId: string }) {
  const { userId: viewer } = useAuth();
  return (
    <ProfileViewContent
      key={`${userId}:${viewer || "guest"}`}
      userId={userId}
    />
  );
}

function ProfileViewContent({ userId }: { userId: string }) {
  const auth = useAuth();
  const {
    playTrack,
    openDetail,
    setActiveTab,
    showToast,
    likedTracks,
    playlists: ownPlaylists,
  } = useMusic();
  const own = userId === auth.userId;
  const [data, setData] = useState<ProfilePageData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<PublicUserPlaylist[]>([]);
  const [editing, setEditing] = useState(false);
  const generation = useRef(0);
  const images = useRef<(string | null)[]>([]);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const page = await getProfilePage(userId);
      if (request !== generation.current) return;
      // Clear old private content immediately on revalidation, before image I/O.
      if (page.status !== "ok") {
        images.current.forEach(releaseImage);
        images.current = [];
        setAvatar(null);
        setBanner(null);
        setPlaylists([]);
        setData(page);
        setError("");
        return;
      }
      const [a, b, pl] = await Promise.all([
        resolveProfileImage(page.avatar_url),
        resolveProfileImage(page.banner_path, true),
        fetchPublicUserPlaylists(userId),
      ]);
      if (request !== generation.current) {
        releaseImage(a);
        releaseImage(b);
        return;
      }
      images.current.forEach(releaseImage);
      images.current = [a, b];
      setAvatar(a);
      setBanner(b);
      setPlaylists(pl);
      setData(page);
      setError("");
    } catch (err) {
      if (request !== generation.current) return;
      // Fail closed: never leave stale public data visible when authorization cannot be checked.
      setData(null);
      setPlaylists([]);
      setAvatar(null);
      setBanner(null);
      images.current.forEach(releaseImage);
      images.current = [];
      setError(err instanceof Error ? err.message : "Gagal memuat profil.");
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setData(null);
        setLoading(true);
        setEditing(false);
        void load();
      }
    });
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    window.addEventListener("easvarafy:activity", refresh);
    return () => {
      active = false;
      // Request serial invalidation is intentional; this ref is not a DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      window.removeEventListener("easvarafy:activity", refresh);
      images.current.forEach(releaseImage);
    };
  }, [load, auth.userId]);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(publicProfileUrl(userId));
      showToast("URL profil disalin");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Tidak dapat menyalin URL."
      );
    }
  };
  if (loading)
    return (
      <div className="m3-card p-10 flex justify-center" role="status">
        <Loader2 className="animate-spin motion-reduce:animate-none" />
        <span className="sr-only">Memuat profil</span>
      </div>
    );
  if (error)
    return (
      <div className="m3-card p-8 space-y-4" role="alert">
        <p>{error}</p>
        <button
          className="profile-button"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Coba lagi
        </button>
      </div>
    );
  if (!data || data.status !== "ok")
    return (
      <section className="m3-card p-12 text-center space-y-4">
        <UserRound className="mx-auto h-16 w-16 text-[var(--m3-on-surface-variant)]" />
        <h1 className="font-display text-xl font-bold">
          {data?.status === "private"
            ? "Profil ini privat"
            : "Profil tidak ditemukan"}
        </h1>
        <p className="text-sm text-[var(--m3-on-surface-variant)]">
          {data?.status === "private"
            ? "Pemilik membatasi akses ke profil dan playlistnya."
            : "Periksa kembali URL profil ini."}
        </p>
        {data?.status === "private" && <ProfileSocialControls targetId={userId} />}
      </section>
    );
  const visiblePlaylists = own
    ? ownPlaylists.map((p) => ({
        ...p,
        tracks: p.tracks,
        cover_url: p.coverUrl,
        is_public: p.isPublic,
      }))
    : playlists;
  return (
    <div className="mx-auto max-w-4xl space-y-6 text-[var(--m3-on-surface)]">
      <section className="overflow-hidden rounded-[var(--m3-radius-xl,1.5rem)]">
        <div className="relative aspect-[3/1] min-h-36 bg-gradient-to-br from-[var(--m3-primary-container)] via-[var(--m3-surface-container-high)] to-[var(--m3-secondary-container)]">
          {banner && (
            <img
              src={banner}
              alt="Banner profil"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[var(--m3-bg)] to-transparent" />
          {own && (
            <button
              aria-label="Ganti banner"
              className="profile-button absolute right-3 top-3"
              onClick={() => setEditing(true)}
            >
              <Camera size={18} />
              Banner
            </button>
          )}
        </div>
        <div className="relative px-2 sm:px-6 -mt-12 sm:-mt-16 space-y-4 pb-2">
          <div className="h-24 w-24 sm:h-32 sm:w-32 rounded-full border-4 border-[var(--m3-bg)] bg-[var(--m3-primary-container)] flex items-center justify-center overflow-hidden">
            {avatar ? (
              <img
                src={avatar}
                alt="Avatar"
                className="h-full w-full object-cover"
              />
            ) : (
              <UserRound className="h-12 w-12 text-[var(--m3-on-primary-container)]" />
            )}
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl sm:text-3xl font-bold break-words">
                  {data.name}
                </h1>
                <VerifiedBadge role={data.role} />
              </div>
              <p className="text-xs text-[var(--m3-on-surface-variant)]">
                Bergabung{" "}
                {new Date(data.created_at!).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </p>
              {data.bio && (
                <p className="text-sm whitespace-pre-wrap break-words">
                  {data.bio}
                </p>
              )}
              {own && (
                <p className="flex items-center gap-1 text-xs text-[var(--m3-on-surface-variant)]">
                  <LockKeyhole size={12} />
                  Profil {data.is_public ? "publik" : "privat"}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {own && (
                <button
                  className="profile-button"
                  onClick={() => setEditing(true)}
                >
                  <Pencil size={16} />
                  Edit Profil
                </button>
              )}
              <button className="profile-button" onClick={() => void share()}>
                <Share2 size={16} />
                Bagikan Profil
              </button>
            </div>
          </div>
        </div>
      </section>
      <ProfileSocialControls targetId={userId} visibleRole={data.role} />
      {data.stats && (
        <section className="m3-card p-5 grid grid-cols-2 gap-4 text-center">
          <div>
            <strong className="text-lg">
              {formatListenDuration(data.stats.seconds)}
            </strong>
            <p className="text-xs text-[var(--m3-on-surface-variant)]">
              Waktu dengar tercatat
            </p>
          </div>
          <div>
            <strong className="text-lg">{data.stats.plays}</strong>
            <p className="text-xs text-[var(--m3-on-surface-variant)]">
              Pemutaran tercatat
            </p>
          </div>
        </section>
      )}
      {data.streak && (
        <section
          className="m3-card p-5 sm:p-6 space-y-4"
          aria-label="Streak harian"
        >
          <div className="flex items-center gap-4">
            <Flame
              className={`h-14 w-14 shrink-0 text-[var(--m3-primary)] ${
                data.streak.active_today ? "profile-flame" : ""
              }`}
              fill={data.streak.active_today ? "currentColor" : "none"}
            />
            <div>
              <p>
                <strong className="text-3xl font-bold text-[var(--m3-primary)]">
                  {data.streak.current}
                </strong>{" "}
                hari berturut-turut
              </p>
              <p className="text-sm text-[var(--m3-on-surface-variant)]">
                {data.streak.active_today
                  ? "Aktivitas hari ini sudah tersimpan. Apinya menyala!"
                  : own
                  ? "Aktif hari ini untuk melanjutkan streak kamu."
                  : "Streak aktivitas"}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-7 sm:grid-cols-14 gap-2">
            {data.streak.days.map((day) => (
              <div
                key={day.date}
                title={`${day.date}: ${day.active ? "aktif" : "belum aktif"}`}
                aria-label={`${day.date}: ${
                  day.active ? "aktif" : "belum aktif"
                }`}
                className={`h-6 rounded-md ${
                  day.active
                    ? "bg-[var(--m3-primary)]"
                    : "bg-[var(--m3-surface-container-highest)]"
                }`}
              />
            ))}
          </div>
          <p className="text-xs text-[var(--m3-on-surface-variant)]">
            Terbaik: {data.streak.longest} hari
            {own && data.streak.timezone
              ? ` · Zona waktu: ${data.streak.timezone}`
              : ""}
          </p>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">
          {own ? "Playlist kamu" : "Playlist publik"}
        </h2>
        {!visiblePlaylists.length ? (
          <div className="m3-card p-8 text-center space-y-3">
            <p className="text-sm text-[var(--m3-on-surface-variant)]">
              {own
                ? "Belum ada playlist. Mulai koleksi musikmu sendiri."
                : "Belum ada playlist publik."}
            </p>
            {own && (
              <button
                className="profile-button mx-auto"
                onClick={() => setActiveTab("library")}
              >
                Buat playlist
              </button>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {visiblePlaylists.map((p) => (
              <article key={p.id} className="m3-card p-4 space-y-3">
                <div className="flex gap-3 items-center">
                  {(p.cover_url || p.tracks[0]?.thumbnail) && (
                    <img
                      src={p.cover_url || p.tracks[0].thumbnail}
                      alt=""
                      className="h-14 w-14 rounded-xl object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-bold truncate">{p.name}</h3>
                    <p className="text-xs text-[var(--m3-on-surface-variant)]">
                      {p.tracks.length} lagu ·{" "}
                      {p.is_public ? "Publik" : "Privat"}
                    </p>
                  </div>
                </div>
                <p className="text-sm line-clamp-2">{p.description}</p>
                <div className="flex gap-2">
                  {p.tracks.length > 0 && (
                    <button
                      className="profile-button"
                      onClick={() => playTrack(p.tracks[0], p.tracks)}
                    >
                      Putar
                    </button>
                  )}
                  {own && (
                    <button
                      className="profile-button"
                      onClick={() =>
                        openDetail({ kind: "user-playlist", id: p.id })
                      }
                    >
                      Buka playlist
                    </button>
                  )}
                </div>
                {p.tracks.length > 0 && (
                  <details>
                    <summary className="text-xs cursor-pointer">
                      Daftar lagu
                    </summary>
                    <ol className="mt-2 space-y-1">
                      {p.tracks.map((track, index) => (
                        <li key={`${track.videoId}-${index}`}>
                          <button
                            className="text-sm w-full text-left truncate p-2 rounded-lg hover:bg-[var(--m3-surface-high)]"
                            onClick={() => playTrack(track, p.tracks)}
                          >
                            {index + 1}. {track.title} · {track.artist}
                          </button>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      {own && (
        <section className="space-y-3">
          <h2 className="font-display text-lg font-bold">
            Lagu Disukai{" "}
            <span className="text-xs font-normal text-[var(--m3-on-surface-variant)]">
              · Hanya kamu
            </span>
          </h2>
          <div className="m3-card p-4 space-y-2">
            {!likedTracks.length ? (
              <p className="text-sm text-[var(--m3-on-surface-variant)]">
                Belum ada lagu disukai.
              </p>
            ) : (
              likedTracks.slice(0, 10).map((track) => (
                <button
                  key={track.videoId}
                  className="flex items-center gap-3 w-full text-left rounded-xl p-2 hover:bg-[var(--m3-surface-high)]"
                  onClick={() => playTrack(track, likedTracks)}
                >
                  <img
                    src={track.thumbnail}
                    alt=""
                    className="w-11 h-11 rounded-lg object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate">
                      {track.title}
                    </span>
                    <span className="block text-xs text-[var(--m3-on-surface-variant)] truncate">
                      {track.artist}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      )}
      {editing && own && (
        <ProfileEditor
          key={data.id}
          data={data}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
            await auth.refreshProfile();
            window.dispatchEvent(new Event("easvarafy:privacy"));
          }}
        />
      )}
    </div>
  );
}

function ProfileEditor({
  data,
  onClose,
  onSaved,
}: {
  data: ProfilePageData;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(data.name || "");
  const [bio, setBio] = useState(data.bio || "");
  const [privacy, setPrivacy] = useState({
    is_public: !!data.is_public,
    show_stats: !!data.show_stats,
    show_streak: !!data.show_streak,
    show_badges: !!data.show_badges,
    share_friend_activity: !!data.share_friend_activity,
  });
  const [source, setSource] = useState<string | null>(null);
  const [kind, setKind] = useState<"avatar" | "banner">("banner");
  const [position, setPosition] = useState({ x: 50, y: 50, zoom: 1 });
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [pendingMedia, setPendingMedia] = useState<{
    banner?: Blob;
    avatar?: Blob;
  }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useBackHandler(true, () => {
    if (!busy) onClose();
  });
  useEffect(() => () => releaseImage(source), [source]);
  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    queueMicrotask(() => {
      if (!cancelled) setBlob(null);
    });
    if (source)
      void cropProfileImage(
        source,
        kind === "banner" ? 3 : 1,
        position.x,
        position.y,
        position.zoom
      )
        .then((b) => {
          if (cancelled) return;
          url = URL.createObjectURL(b);
          setPreview(url);
          setBlob(b);
        })
        .catch((e) => {
          if (!cancelled) setError(String(e));
        });
    else
      queueMicrotask(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
      releaseImage(url);
    };
  }, [source, kind, position]);
  const choose = (
    event: React.ChangeEvent<HTMLInputElement>,
    target: "avatar" | "banner"
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      validateProfileFile(file);
      if (source && blob)
        setPendingMedia((previous) => ({ ...previous, [kind]: blob }));
      setKind(target);
      setSource(URL.createObjectURL(file));
      setPosition({ x: 50, y: 50, zoom: 1 });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "File tidak valid.");
    }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    const uploaded: string[] = [];
    try {
      if (!navigator.onLine)
        throw new Error(
          "Offline. Perubahan belum disimpan. Hubungkan internet lalu coba lagi."
        );
      const media = {
        ...pendingMedia,
        ...(source && blob ? { [kind]: blob } : {}),
      };
      if (source && !blob) throw new Error("Tunggu preview gambar selesai.");
      const patch: Record<string, unknown> = {
        name: name.trim(),
        bio: bio.trim(),
        ...privacy,
      };
      for (const target of ["banner", "avatar"] as const)
        if (media[target]) {
          const path = await uploadProfileMedia(
            data.id!,
            media[target]!,
            target
          );
          uploaded.push(path);
          patch[target === "banner" ? "banner_path" : "avatar_url"] =
            target === "banner" ? path : `profile-media:${path}`;
        }
      const { data: saved, error: err } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", data.id!)
        .select("id")
        .single();
      if (err || !saved)
        throw new Error(err?.message || "Profil belum disimpan.");
      await onSaved();
    } catch (e) {
      if (uploaded.length)
        await supabase.storage.from("profile-media").remove(uploaded);
      setError(e instanceof Error ? e.message : "Gagal menyimpan. Coba lagi.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Profil"
    >
      <form
        onSubmit={save}
        className="profile-editor m3-card w-full max-w-lg max-h-[85dvh] overflow-y-auto p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-xl">Edit Profil</h2>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Tutup"
          >
            <X />
          </button>
        </div>
        <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
          <label className="block text-sm">
            Username
            <input
              required
              maxLength={50}
              className="profile-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Bio
            <textarea
              maxLength={500}
              className="profile-input"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {(["banner", "avatar"] as const).map((target) => (
              <label key={target} className="profile-button cursor-pointer">
                <Camera size={16} />
                {pendingMedia[target] ? "✓ " : ""}Ganti {target}
                <input
                  type="file"
                  className="sr-only"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => choose(e, target)}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-[var(--m3-on-surface-variant)]">
            JPG, PNG, WebP · maksimal 10 MB. Gambar dikompres sebelum diunggah.
          </p>
          {source && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Sesuaikan crop {kind}</p>
              {preview && (
                <img
                  src={preview}
                  alt="Preview crop"
                  className={`w-full object-contain bg-[var(--m3-surface-container-high)] ${
                    kind === "avatar" ? "max-h-48" : "aspect-[3/1]"
                  }`}
                />
              )}
              {(["x", "y", "zoom"] as const).map((axis) => (
                <label key={axis} className="flex items-center gap-3 text-xs">
                  {axis === "x"
                    ? "Horizontal"
                    : axis === "y"
                    ? "Vertikal"
                    : "Zoom"}
                  <input
                    className="min-w-0 flex-1"
                    type="range"
                    min={axis === "zoom" ? 1 : 0}
                    max={axis === "zoom" ? 3 : 100}
                    step={axis === "zoom" ? 0.05 : 1}
                    value={position[axis]}
                    onChange={(e) =>
                      setPosition({
                        ...position,
                        [axis]: Number(e.target.value),
                      })
                    }
                  />
                </label>
              ))}
              <button
                className="profile-button"
                type="button"
                disabled={!blob}
                onClick={() => {
                  setPendingMedia({ ...pendingMedia, [kind]: blob! });
                  setSource(null);
                }}
              >
                Gunakan crop
              </button>
            </div>
          )}
          <label className="block text-sm">
            Visibilitas profil
            <select
              className="profile-input"
              value={privacy.is_public ? "public" : "private"}
              onChange={(e) =>
                setPrivacy({
                  ...privacy,
                  is_public: e.target.value === "public",
                })
              }
            >
              <option value="private">Profil privat</option>
              <option value="public">Profil publik</option>
            </select>
          </label>
          <p className="text-xs text-[var(--m3-on-surface-variant)]">
            Saat profil privat, semua playlist tersembunyi dari pengunjung.
            Status masing-masing playlist tetap tersimpan; hanya playlist publik
            yang kembali terlihat ketika profil dipublikasikan lagi. Gambar yang
            sudah diunduh atau disalin orang lain tidak dapat ditarik kembali.
          </p>
          <label className="flex gap-3 items-start text-sm"><input className="mt-1" type="checkbox" checked={privacy.share_friend_activity} onChange={e=>setPrivacy({...privacy,share_friend_activity:e.target.checked})} /><span>Bagikan lagu terakhir ke pengikut (hanya saat profil publik). Terpisah dari izin statistik agregat.</span></label>
          {(["show_stats", "show_streak", "show_badges"] as const).map(
            (key, index) => (
              <label key={key} className="flex gap-3 items-center text-sm">
                <input
                  type="checkbox"
                  checked={privacy[key]}
                  onChange={(e) =>
                    setPrivacy({ ...privacy, [key]: e.target.checked })
                  }
                />
                Tampilkan {["statistik", "streak", "badge"][index]} kepada
                publik
              </label>
            )
          )}
        </fieldset>
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <button
          className="profile-button w-full justify-center"
          disabled={busy || (!!source && !blob)}
          type="submit"
        >
          {busy && (
            <Loader2
              className="animate-spin motion-reduce:animate-none"
              size={16}
            />
          )}
          {busy
            ? "Menyimpan…"
            : error
            ? "Coba simpan lagi"
            : "Simpan perubahan"}
        </button>
      </form>
    </div>
  );
}
