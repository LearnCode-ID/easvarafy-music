"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBackHandler } from "@/lib/native/backButton";

/** Solid, viewport-level popup: never inserts management panels into the page. */
export function PlaylistActionDialog({
  title,
  label = title,
  id,
  onClose,
  children,
  closeLabel = "Tutup pengaturan playlist",
}: {
  title: string;
  label?: string;
  id?: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useBackHandler(true, () => closeRef.current());
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, summary, [tabindex="0"]'
        ),
      ].filter(
        (item) => !item.matches(":disabled") && item.getClientRects().length > 0
      );
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0],
        last = items[items.length - 1];
      const outside = !items.includes(document.activeElement as HTMLElement);
      if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || outside)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", keys);
    return () => {
      dialog.removeEventListener("keydown", keys);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  // Switching from the options view must not leave focus on a removed button.
  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true });
  }, [title]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="playlist-dialog-backdrop"
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label === title ? titleId : undefined}
        aria-label={label === title ? undefined : label}
        tabIndex={-1}
        className="playlist-action-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="playlist-dialog-heading">
          <h2
            id={titleId}
            title={title}
            className="font-bold text-lg min-w-0 break-words line-clamp-2"
          >
            {title}
          </h2>
          <button
            type="button"
            className="playlist-icon shrink-0"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X />
          </button>
        </header>
        <div className="playlist-dialog-content space-y-4">{children}</div>
      </div>
    </div>,
    document.body
  );
}
