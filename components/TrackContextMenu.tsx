"use client";

import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { positionTrackMenu } from "@/lib/ui/overlayPosition";
import {
  Heart,
  Ban,
  ListEnd,
  ListPlus,
  MoreHorizontal,
  MoreVertical,
  Play,
  Radio,
  User,
} from "lucide-react";
import { useMusic } from "./MusicProvider";
import { DownloadMenuItem } from "./DownloadButton";
import type { Track } from "@/lib/metrolist/types";
import { useBackHandler } from "@/lib/native/backButton";

interface TrackContextMenuProps {
  track: Track;
  vertical?: boolean;
}

export function TrackContextMenu({
  track,
  vertical = false,
}: TrackContextMenuProps) {
  const {
    personalization,
    showToast,
    playNextInQueue,
    addTrackToQueue,
    startRadio,
    openPlaylistPicker,
    isLiked,
    toggleLike,
    openDetail,
  } = useMusic();

  const [open, setOpen] = useState(false);
  useBackHandler(open, () => setOpen(false));
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;
    const updatePosition = () => {
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft || 0,
        top: viewport?.offsetTop || 0,
        width: viewport?.width || window.innerWidth,
        height: viewport?.height || window.innerHeight,
      };
      const position = positionTrackMenu(
        trigger.getBoundingClientRect(),
        { width: 240, height: menu.scrollHeight + 2 },
        bounds
      );
      Object.assign(menu.style, {
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
      });
    };
    updatePosition();
    // Let the trigger's native pointer-focus finish before moving focus.
    const focusFrame = requestAnimationFrame(() => {
      menu
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus({ preventScroll: true });
    });
    const outside = (event: PointerEvent) => {
      if (
        !menu.contains(event.target as Node) &&
        !trigger.contains(event.target as Node)
      )
        setOpen(false);
    };
    // Scrolling the list dismisses the anchored menu; scrolling inside it does not.
    const scroll = (event: Event) => {
      if (!menu.contains(event.target as Node)) setOpen(false);
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Tab") {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        trigger.focus({ preventScroll: true });
        setOpen(false);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        const items = [
          ...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        if (!items.length) return;
        event.preventDefault();
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement
        );
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
            ? items.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
              items.length;
        items[next].focus({ preventScroll: true });
        items[next].scrollIntoView({ block: "nearest" });
      }
    };
    const observer = new ResizeObserver(updatePosition);
    observer.observe(menu);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    menu.addEventListener("keydown", keys);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      cancelAnimationFrame(focusFrame);
      observer.disconnect();
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      menu.removeEventListener("keydown", keys);
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
      if (menu.contains(document.activeElement))
        trigger.focus({ preventScroll: true });
    };
  }, [open]);

  const liked = isLiked(track.videoId);
  const primaryArtistId = track.artists?.[0]?.artistId;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={`More actions for ${track.title}`}
        aria-expanded={open}
        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
      >
        {vertical ? (
          <MoreVertical className="w-5 h-5" />
        ) : (
          <MoreHorizontal className="w-4 h-4" />
        )}
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="dialog"
            aria-label={`Actions for ${track.title}`}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 240 }}
            className="track-context-menu fixed z-[100] rounded-2xl p-1.5 text-sm shadow-2xl overflow-y-auto overscroll-contain"
          >
            {personalization.state.enabled && (
              <>
                <button
                  type="button"
                  disabled={!personalization.ready}
                  onClick={() => {
                    personalization.store.record(track, "not_interested");
                    showToast("Lagu dikecualikan dari rekomendasi");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Ban className="w-4 h-4" />
                  Tidak tertarik
                </button>
                <button
                  type="button"
                  disabled={!personalization.ready}
                  onClick={() => {
                    personalization.store.record(track, "block_artist");
                    showToast("Artis dikecualikan dari rekomendasi");
                    setOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <Ban className="w-4 h-4" />
                  Jangan sarankan artis ini
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                playNextInQueue(track);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Play className="w-4 h-4 text-[var(--m3-primary)]" />
              <span>Play Next</span>
            </button>

            <button
              type="button"
              onClick={() => {
                addTrackToQueue(track);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <ListEnd className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Add to Queue</span>
            </button>

            <button
              type="button"
              onClick={() => {
                void startRadio(track);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Radio className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Start Radio</span>
            </button>

            <button
              type="button"
              onClick={() => {
                openPlaylistPicker(track);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <ListPlus className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Add to Playlist</span>
            </button>

            <DownloadMenuItem track={track} onDone={() => setOpen(false)} />

            <button
              type="button"
              onClick={() => {
                toggleLike(track);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              <Heart
                className={`w-4 h-4 ${
                  liked
                    ? "fill-[var(--m3-primary)] text-[var(--m3-primary)]"
                    : "text-slate-500 dark:text-slate-400"
                }`}
              />
              <span>{liked ? "Remove Like" : "Like Song"}</span>
            </button>

            {primaryArtistId && (
              <button
                type="button"
                onClick={() => {
                  openDetail({
                    kind: "artist",
                    id: primaryArtistId,
                    title: track.artists[0].name,
                  });
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors whitespace-nowrap"
              >
                <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>View Artist</span>
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
