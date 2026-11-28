"use client";

import React, { useEffect, useState } from "react";
import { Music2 } from "lucide-react";
import { useOnlineStatus } from "@/lib/metrolist/useOfflineLibrary";
import {
  PLAYLIST_COVER_PREFIX,
  resolvePlaylistCover,
} from "@/lib/social/playlistCover";
import { releaseImage } from "@/lib/social/profilePage";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  findDownloadedByArtwork,
  resolveOfflineArtworkUrl,
} from "@/lib/metrolist/offlineAudio";

interface ArtworkImageProps {
  src?: string | null;
  alt: string;
  className?: string;
  rounded?: string;
  sizeHint?: "sm" | "md" | "lg";
}

const GRADIENT_FALLBACKS = [
  "from-rose-500/30 via-amber-500/20 to-slate-800/40",
  "from-indigo-500/30 via-sky-500/20 to-slate-900/40",
  "from-emerald-500/25 via-teal-500/20 to-slate-900/40",
  "from-fuchsia-500/25 via-rose-500/20 to-slate-900/40",
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export const ArtworkImage = React.memo(function ArtworkImage({
  src: rawSrc,
  alt,
  className,
  rounded = "rounded-xl",
  sizeHint = "md",
}: ArtworkImageProps) {
  const online = useOnlineStatus();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const [privateArt, setPrivateArt] = useState<{
    reference: string;
    url: string | null;
  } | null>(null);
  const isPrivateCover = !!rawSrc?.startsWith(PLAYLIST_COVER_PREFIX);
  useEffect(() => {
    if (!isPrivateCover || !rawSrc) return;
    let active = true,
      owned: string | null = null,
      request = 0;
    const load = async () => {
      const id = ++request;
      let next: string | null = null;
      try {
        next = await resolvePlaylistCover(rawSrc);
      } catch {
        /* honest artwork fallback */
      }
      if (!active || id !== request) {
        releaseImage(next);
        return;
      }
      releaseImage(owned);
      owned = next;
      setPrivateArt({ reference: rawSrc, url: next });
    };
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void load();
    }, 60000);
    const refresh = () => {
      void load();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("easvarafy:privacy", refresh);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      queueMicrotask(() => {
        if (active) {
          releaseImage(owned);
          owned = null;
          setPrivateArt(null);
          void load();
        }
      });
    });
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("easvarafy:privacy", refresh);
      subscription.unsubscribe();
      releaseImage(owned);
    };
  }, [rawSrc, isPrivateCover]);

  const gradientClass =
    GRADIENT_FALLBACKS[hashString(alt || "sonora") % GRADIENT_FALLBACKS.length];

  // Offline fallback: when the network artwork fails and the song was
  // downloaded, show the artwork saved with the download instead.
  const [offlineArt, setOfflineArt] = useState<{
    for: string;
    url: string;
  } | null>(null);
  const remoteFailed = !!rawSrc && failedSrc === rawSrc;
  useEffect(() => {
    if ((!remoteFailed && online) || !rawSrc) return;
    const record = findDownloadedByArtwork(rawSrc);
    if (!record?.localThumbUri) return;
    let cancelled = false;
    resolveOfflineArtworkUrl(record)
      .then((url) => {
        if (!cancelled && url && url !== rawSrc)
          setOfflineArt({ for: rawSrc, url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [remoteFailed, rawSrc, online]);
  const src: string | null | undefined =
    (remoteFailed || !online) && offlineArt && offlineArt.for === rawSrc
      ? offlineArt.url
      : isPrivateCover
      ? privateArt?.reference === rawSrc
        ? privateArt?.url ?? null
        : null
      : !online && /^https?:\/\//i.test(rawSrc || "")
      ? null
      : rawSrc;

  const isFailed = !src || failedSrc === src;
  const isLoaded = !!src && loadedSrc === src;
  const isLetterboxedYtThumb =
    !!src && src.includes("i.ytimg.com") && src.includes("hqdefault.jpg");

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-slate-200 dark:bg-white/[0.06] shrink-0 select-none",
        rounded,
        className
      )}
    >
      {/* Persistent gradient + note under-layer while loading or on error */}
      <div
        className={cn(
          "absolute inset-0 flex items-center justify-center bg-gradient-to-br",
          gradientClass
        )}
        aria-hidden={!isFailed}
      >
        <Music2
          className={cn(
            "text-slate-600/60 dark:text-white/40",
            sizeHint === "sm"
              ? "w-4 h-4"
              : sizeHint === "lg"
              ? "w-12 h-12"
              : "w-6 h-6"
          )}
        />
      </div>

      {!isFailed && (
        <img
          key={src}
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          decoding="async"
          onLoad={() => setLoadedSrc(src)}
          onError={() => {
            if (offlineArt && src === offlineArt.url) {
              // Local copy is broken too: stay on the placeholder.
              setOfflineArt(null);
              setFailedSrc(rawSrc ?? null);
              return;
            }
            setFailedSrc(src);
          }}
          className={cn(
            "relative z-10 w-full h-full object-cover transition-opacity duration-200",
            isLoaded ? "opacity-100" : "opacity-0",
            isLetterboxedYtThumb && "scale-[1.35]"
          )}
        />
      )}
    </div>
  );
});
