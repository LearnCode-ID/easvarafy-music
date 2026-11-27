"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  Play,
  RefreshCw,
  Shuffle,
  Users,
} from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { useMusic } from "./MusicProvider";
import { ArtworkImage } from "./ArtworkImage";
import { ProfileAvatar } from "./ProfileAvatar";
import { TrackContextMenu } from "./TrackContextMenu";
import {
  blendInviteUrl,
  fetchBlend,
  joinBlend,
  leaveBlend,
  refreshBlend,
  type BlendMember,
  type BlendPlaylist,
} from "@/lib/social/blendClient";
import type { Track } from "@/lib/metrolist/types";

// React StrictMode/remounts share an in-flight initial refresh, not two writes.
const initialMixes = new Map<string, Promise<{ warning: string | null }>>();
function initialMix(
  b: BlendPlaylist,
  actor: string,
  history: Track[],
  region: string
) {
  const key = `${actor}:${b.id}`;
  let task = initialMixes.get(key);
  if (!task) {
    task = refreshBlend(b, actor, history, region);
    initialMixes.set(key, task);
    void task.finally(() => initialMixes.delete(key)).catch(() => {});
  }
  return task;
}
export function BlendDetailView({ blendId }: { blendId: string }) {
  const { userId } = useAuth();
  return <BlendDetailContent key={`${userId}:${blendId}`} blendId={blendId} />;
}
function BlendDetailContent({ blendId }: { blendId: string }) {
  const { userId, openLoginPrompt } = useAuth();
  const { openDetail, playTrack, history, settings, showToast, currentTrack } =
    useMusic();
  const [blend, setBlend] = useState<BlendPlaylist | null>(null);
  const [members, setMembers] = useState<BlendMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const epoch = useRef(0);
  const autoAttempted = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const localHistory = useRef(history);
  useEffect(() => {
    localHistory.current = history;
  }, [history]);
  const load = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const data = await fetchBlend(blendId);
      if (request !== epoch.current) return;
      setBlend(data.blend);
      setMembers(data.members);
      setError("");
    } catch (e) {
      if (request !== epoch.current) return;
      setBlend(null);
      setMembers([]);
      setError(e instanceof Error ? e.message : "Gagal memuat Blend.");
    } finally {
      if (request === epoch.current) setLoading(false);
    }
  }, [blendId]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => void load();
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      epoch.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (
      !blend ||
      blend.status !== "active" ||
      blend.last_refreshed_at ||
      autoAttempted.current ||
      !userId
    )
      return;
    autoAttempted.current = true;
    queueMicrotask(() => {
      if (mounted.current) setBusy(true);
    });
    void initialMix(
      blend,
      userId,
      localHistory.current.map((e) => e.track),
      settings.region
    )
      .then(async (res) => {
        if (mounted.current) {
          await load();
          setWarning(res.warning || "");
        }
      })
      .catch((e) => {
        if (mounted.current)
          setError(e instanceof Error ? e.message : "Racikan belum tersimpan.");
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }, [blend, userId, settings.region, load]);
  const refresh = async () => {
    if (!blend || !userId) return;
    setBusy(true);
    setError("");
    setWarning("");
    try {
      const result = await refreshBlend(
        blend,
        userId,
        history.map((e) => e.track),
        settings.region
      );
      await load();
      setWarning(result.warning || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan racikan.");
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (!blend) return;
    setBusy(true);
    try {
      await joinBlend(blend.invite_code);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menerima undangan.");
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    setBusy(true);
    try {
      await leaveBlend(blendId);
      setConfirmLeave(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal keluar dari Blend.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!blend) return;
    try {
      await navigator.clipboard.writeText(blendInviteUrl(blend));
      showToast("Tautan undangan disalin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tidak dapat menyalin.");
    }
  };
  const shuffle = () => {
    if (!blend?.tracks.length) return;
    const queue = [...blend.tracks];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    playTrack(queue[0], queue);
  };
  if (!userId)
    return (
      <div className="m3-card p-6 space-y-3">
        <p>Masuk untuk membuka Blend pribadi.</p>
        <button className="profile-button" onClick={() => openLoginPrompt()}>
          Masuk
        </button>
      </div>
    );
  return (
    <section className="space-y-5" aria-label="Detail Blend">
      <button className="profile-button" onClick={() => openDetail(null)}>
        <ArrowLeft size={16} />
        Kembali
      </button>
      {loading && <p role="status">Memuat Blend…</p>}
      {error && (
        <div role="alert" className="m3-card p-4 space-y-2">
          <p className="text-sm">{error}</p>
          <button
            className="profile-button"
            disabled={busy}
            onClick={() => void load()}
          >
            Muat ulang / coba lagi
          </button>
        </div>
      )}
      {blend && (
        <>
          <header className="m3-card bg-gradient-to-br from-[var(--m3-primary-container)] via-[var(--m3-surface-high)] to-[var(--m3-surface)] p-5 sm:p-8 space-y-4">
            <div className="flex -space-x-4">
              {members.map((m) => (
                <ProfileAvatar
                  key={m.id}
                  reference={m.avatar_url}
                  name={m.name}
                  className="h-20 w-20 rounded-full border-4 border-[var(--m3-surface)] object-cover"
                />
              ))}
              {!blend.partner_id && (
                <span className="h-20 w-20 rounded-full border-4 border-[var(--m3-surface)] bg-[var(--m3-surface-high)] flex items-center justify-center">
                  <Users />
                </span>
              )}
            </div>
            <h1 className="font-display font-bold text-2xl">
              Blend{" "}
              {members
                .map((m) => (m.id === userId ? "kamu" : m.name))
                .join(" × ")}
            </h1>
            {blend.status === "active" ? (
              <>
                <p>
                  {blend.last_refreshed_at ? (
                    <>
                      <strong className="text-4xl text-[var(--m3-primary)]">
                        {blend.match_percent}%
                      </strong>{" "}
                      kecocokan selera
                    </>
                  ) : (
                    "Belum ada racikan tersimpan."
                  )}
                </p>
                <p className="text-sm">
                  {blend.shared_artists.length
                    ? `Artis yang sama-sama disukai: ${blend.shared_artists.join(
                        ", "
                      )}`
                    : "Belum ada artis yang sama dalam cuplikan selera."}
                </p>
                <p className="text-xs text-[var(--m3-on-surface-variant)]">
                  Perkiraan dari irisan lagu, artis, dan metadata genre/vibe
                  yang tersedia; bukan analisis audio. Hanya peserta yang dapat
                  membuka Blend ini.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="profile-button"
                    disabled={!blend.tracks.length}
                    onClick={() => playTrack(blend.tracks[0], blend.tracks)}
                  >
                    <Play size={16} />
                    Play
                  </button>
                  <button
                    className="profile-button"
                    disabled={!blend.tracks.length}
                    onClick={shuffle}
                  >
                    <Shuffle size={16} />
                    Shuffle
                  </button>
                  <button
                    className="profile-button"
                    disabled={busy}
                    onClick={() => void refresh()}
                  >
                    {busy ? (
                      <Loader2
                        size={16}
                        className="animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <RefreshCw size={16} />
                    )}
                    Refresh Blend
                  </button>
                </div>
                <p className="text-xs text-[var(--m3-on-surface-variant)]">
                  {blend.last_refreshed_at
                    ? `Terakhir diracik ${new Date(
                        blend.last_refreshed_at
                      ).toLocaleString("id-ID")}`
                    : "Racikan pertama akan disimpan setelah kedua teman terhubung."}
                </p>
              </>
            ) : blend.status === "pending" ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Menunggu teman menerima undangan. Nama dan cuplikan selera
                  dari Lagu Disukai, playlist (termasuk privat), lagu terakhir
                  serta history yang digunakan saat refresh hanya dibagikan ke
                  peserta setelah diterima.
                </p>
                <p className="text-xs">
                  Berlaku hingga{" "}
                  {new Date(blend.invite_expires_at).toLocaleString("id-ID")}.
                </p>
                {blend.creator_id === userId ? (
                  <>
                    <code className="block text-sm break-all select-all">
                      {blend.invite_code}
                    </code>
                    <button
                      className="profile-button"
                      onClick={() => void copy()}
                    >
                      <Copy size={16} />
                      Salin tautan undangan
                    </button>
                  </>
                ) : (
                  <button
                    className="profile-button"
                    disabled={busy}
                    onClick={() => void accept()}
                  >
                    Terima & Buat Blend
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm">
                Blend telah diakhiri. Akses selera dihentikan dan racikan server
                telah dikosongkan.
              </p>
            )}
          </header>
          {warning && (
            <p role="status" className="m3-card p-4 text-sm">
              {warning}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm">
              Menyiapkan dan menyimpan Blend…
            </p>
          )}
          {blend.status === "active" && (
            <div className="m3-card p-3 sm:p-5">
              <h2 className="font-bold mb-3">
                Racikan bersama · {blend.tracks.length} lagu
              </h2>
              {!blend.tracks.length && !busy && (
                <p className="text-sm">
                  Belum ada lagu. Tambahkan Lagu Disukai atau playlist, lalu
                  Refresh Blend.
                </p>
              )}
              <ol className="space-y-2">
                {blend.tracks.map((track) => (
                  <li
                    key={track.videoId}
                    className={`flex items-center gap-2 sm:gap-3 p-2 rounded-xl ${
                      currentTrack?.videoId === track.videoId
                        ? "bg-[var(--m3-primary-container)]"
                        : ""
                    }`}
                  >
                    <ArtworkImage
                      src={track.thumbnail}
                      alt={track.title}
                      className="h-11 w-11"
                      sizeHint="sm"
                    />
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => playTrack(track, blend.tracks)}
                    >
                      <span className="block truncate text-sm font-semibold">
                        {track.title}
                      </span>
                      <span className="block truncate text-xs text-[var(--m3-on-surface-variant)]">
                        {track.artist}
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-[var(--m3-on-surface-variant)] mt-1">
                        {track.tasteOwnerIds.map((id) => (
                          <ProfileAvatar
                            key={id}
                            reference={
                              members.find((m) => m.id === id)?.avatar_url ||
                              null
                            }
                            name={
                              members.find((m) => m.id === id)?.name || "Teman"
                            }
                            className="h-4 w-4 rounded-full object-cover shrink-0"
                          />
                        ))}
                        <span className="truncate">
                          {track.source === "shared"
                            ? "Sama-sama suka"
                            : `${
                                track.source === "related"
                                  ? "Rekomendasi dari"
                                  : "Dari"
                              } selera ${
                                track.addedByUserId === userId
                                  ? "kamu"
                                  : members.find(
                                      (m) => m.id === track.addedByUserId
                                    )?.name || "teman"
                              }`}
                        </span>
                      </span>
                    </button>
                    <TrackContextMenu track={track} />
                  </li>
                ))}
              </ol>
            </div>
          )}
          {blend.status !== "declined" && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--m3-on-surface-variant)]">
                Keluar/membatalkan menghentikan akses selera untuk kedua
                peserta. Salinan lagu/data yang sudah diterima tidak dapat
                ditarik kembali.
              </p>
              <button
                className="profile-button"
                disabled={busy}
                onClick={() => {
                  if (confirmLeave) void leave();
                  else setConfirmLeave(true);
                }}
              >
                {confirmLeave
                  ? "Ya, akhiri Blend"
                  : blend.status === "pending"
                  ? "Batalkan / Tolak undangan"
                  : "Keluar dari Blend"}
              </button>
              {confirmLeave && (
                <button
                  className="profile-button ml-2"
                  disabled={busy}
                  onClick={() => setConfirmLeave(false)}
                >
                  Batal
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
