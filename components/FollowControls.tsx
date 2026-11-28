"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, UserCheck, UserPlus, X } from "lucide-react";
import { useAuth } from "./auth/AuthProvider";
import { useMusic } from "./MusicProvider";
import { ProfileAvatar } from "./ProfileAvatar";
import {
  FOLLOW_EVENT,
  fetchFollowStatus,
  fetchFollowersList,
  fetchFollowingList,
  followUser,
  unfollowUser,
  type FollowPerson,
  type FollowStatus,
} from "@/lib/social/follows";
import { createBlendInvite } from "@/lib/social/blendClient";
import type { UserRole } from "@/lib/auth/types";
import { followerDisplay } from "@/lib/social/followerDisplay";
import { useBackHandler } from "@/lib/native/backButton";

export function FollowButton({ targetId }: { targetId: string }) {
  const { userId } = useAuth();
  return (
    <FollowButtonContent key={`${userId}:${targetId}`} targetId={targetId} />
  );
}
function FollowButtonContent({ targetId }: { targetId: string }) {
  const { userId, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetchFollowStatus(targetId)
        .then((s) => {
          if (active) {
            setFollowing(s.is_following);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("Status follow gagal dimuat.");
        });
    void load();
    window.addEventListener(FOLLOW_EVENT, load);
    return () => {
      active = false;
      window.removeEventListener(FOLLOW_EVENT, load);
    };
  }, [targetId, userId, retry]);
  if (userId === targetId) return null;
  const mutate = async () => {
    if (!userId) {
      router.push(`/login?redirectTo=${encodeURIComponent(pathname)}`);
      return;
    }
    if (following && !confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (following) await unfollowUser(targetId);
      else await followUser(targetId);
      setFollowing(!following);
      setConfirm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Follow belum tersimpan.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="profile-button !px-3 !py-1.5 !text-xs"
        disabled={!ready || busy || (!!userId && following === null && !error)}
        onClick={() => {
          if (following === null && error && userId) {
            setError("");
            setRetry((v) => v + 1);
          } else void mutate();
        }}
        aria-label={
          confirm ? "Konfirmasi unfollow" : following ? "Following" : "Follow"
        }
      >
        {busy ? (
          <Loader2
            size={14}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : following ? (
          <UserCheck size={14} />
        ) : (
          <UserPlus size={14} />
        )}
        {busy
          ? "Menyimpan…"
          : following === null && error
          ? "Coba lagi"
          : confirm
          ? "Unfollow?"
          : following
          ? "Following"
          : "Follow"}
      </button>
      {confirm && (
        <button
          className="text-xs p-2"
          type="button"
          disabled={busy}
          onClick={() => setConfirm(false)}
        >
          Batal
        </button>
      )}
      {error && (
        <p
          className="w-full text-xs text-[var(--m3-on-surface-variant)]"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
type ProfileSocialProps = { targetId: string; visibleRole?: UserRole };
export function ProfileSocialControls({ targetId, visibleRole }: ProfileSocialProps) {
  const auth = useAuth();
  return (
    <ProfileSocialContent
      key={`${auth.userId}:${targetId}`}
      targetId={targetId}
      visibleRole={visibleRole}
    />
  );
}
function ProfileSocialContent({ targetId, visibleRole }: ProfileSocialProps) {
  const { userId } = useAuth();
  const { openDetail } = useMusic();
  const router = useRouter();
  const [status, setStatus] = useState<FollowStatus | null>(null);
  const followers = followerDisplay(status?.followers_count, visibleRole);
  const [error, setError] = useState("");
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setStatus(await fetchFollowStatus(targetId));
      setError("");
    } catch {
      setError("Statistik follow belum tersedia.");
    }
  }, [targetId]);
  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => void load();
    const timer = setInterval(refresh, 30000);
    window.addEventListener(FOLLOW_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(FOLLOW_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const invite = async () => {
    if (!userId) {
      router.push(
        `/login?redirectTo=${encodeURIComponent(`/profile/${targetId}`)}`
      );
      return;
    }
    setBusy(true);
    try {
      const id = await createBlendInvite(targetId);
      setConfirm(false);
      openDetail({ kind: "blend", id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal membuat undangan.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3" aria-label="Sosial profil">
      <div className="flex flex-wrap items-center gap-3">
        <button className="profile-button" title={followers.note} onClick={() => setList("followers")}>
          {followers.label} Followers
        </button>
        <button className="profile-button" onClick={() => setList("following")}>
          {status?.following_count ?? "…"} Following
        </button>
        {userId !== targetId && (
          <>
            <FollowButton targetId={targetId} />
            <button
              className="profile-button"
              onClick={() => {
                if (!userId)
                  router.push(
                    `/login?redirectTo=${encodeURIComponent(
                      `/profile/${targetId}`
                    )}`
                  );
                else setConfirm((v) => !v);
              }}
            >
              Buat Blend Bersama
            </button>
          </>
        )}
      </div>
      {confirm && (
        <div className="m3-card p-4 space-y-3">
          <p className="text-sm">
            Kirim undangan ke teman ini? Setelah ia menerima, nama dan cuplikan
            lagu disukai, playlist (termasuk privat), lagu terakhir serta
            history lokal yang dipakai saat refresh akan dibagikan hanya kepada
            peserta Blend. Kamu bisa keluar untuk menghentikan akses.
          </p>
          <div className="flex gap-2">
            <button
              className="profile-button"
              disabled={busy}
              onClick={() => void invite()}
            >
              {busy ? "Mengirim…" : "Kirim undangan Blend"}
            </button>
            <button
              className="profile-button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Batal
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="text-xs" role="alert">
          {error}{" "}
          <button className="underline p-2" onClick={() => void load()}>
            Coba lagi
          </button>
        </div>
      )}
      {list && (
        <FollowListModal
          userId={targetId}
          direction={list}
          onClose={() => setList(null)}
        />
      )}
    </section>
  );
}
function FollowListModal({
  userId,
  direction,
  onClose,
}: {
  userId: string;
  direction: "followers" | "following";
  onClose: () => void;
}) {
  const { openDetail } = useMusic();
  const [rows, setRows] = useState<FollowPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [more, setMore] = useState(true);
  useBackHandler(true, onClose);
  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError("");
      try {
        const data = await (direction === "followers"
          ? fetchFollowersList(userId, offset)
          : fetchFollowingList(userId, offset));
        setRows((prev) => (offset ? [...prev, ...data] : data));
        setMore(data.length === 30);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Gagal memuat daftar.");
      } finally {
        setLoading(false);
      }
    },
    [direction, userId]
  );
  useEffect(() => {
    queueMicrotask(() => void load(0));
  }, [load]);
  return (
    <div
      className="fixed inset-0 z-[75] bg-black/50 p-3 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={direction === "followers" ? "Followers" : "Following"}
    >
      <div className="m3-card w-full max-w-lg p-5 max-h-[80dvh] overflow-y-auto space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">
            {direction === "followers" ? "Followers" : "Following"}
          </h2>
          <button
            className="profile-button !p-2"
            aria-label="Tutup daftar follow"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {rows.map((p) => (
          <div key={p.id} className="flex gap-2 items-center">
            <button
              className="flex-1 min-w-0 flex items-center gap-3 text-left"
              onClick={() => {
                onClose();
                openDetail({ kind: "user-profile", id: p.id });
              }}
            >
              <ProfileAvatar
                reference={p.avatar_url}
                name={p.name}
                className="h-10 w-10 rounded-full object-cover shrink-0"
              />
              <span className="truncate text-sm">{p.name}</span>
            </button>
            <FollowButton targetId={p.id} />
          </div>
        ))}
        {loading ? (
          <p role="status">Memuat…</p>
        ) : !rows.length && !error ? (
          <p className="text-sm text-[var(--m3-on-surface-variant)]">
            Belum ada{" "}
            {direction === "followers" ? "pengikut" : "pengguna yang diikuti"}.
          </p>
        ) : null}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        {!loading && (more || error) && (
          <button
            className="profile-button"
            onClick={() => void load(error ? 0 : rows.length)}
          >
            {error ? "Coba lagi" : "Muat lebih banyak"}
          </button>
        )}
      </div>
    </div>
  );
}
