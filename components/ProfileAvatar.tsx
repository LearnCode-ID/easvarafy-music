"use client";
import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { releaseImage, resolveProfileImage } from "@/lib/social/profilePage";

/** Legacy/community consumers can pass either stored references or owner blobs. */
export function ProfileAvatar({
  reference,
  name,
  className,
}: {
  reference: string | null;
  name: string;
  className?: string;
}) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let owned: string | null = null;
    const load = async () => {
      const direct = reference?.startsWith("blob:");
      const next = direct ? reference : await resolveProfileImage(reference);
      if (!active) {
        if (!direct) releaseImage(next);
        return;
      }
      releaseImage(owned);
      owned = direct ? null : next;
      setSource(next);
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
      releaseImage(owned);
    };
  }, [reference]);
  return source ? (
    <img
      src={source}
      alt={name}
      referrerPolicy="no-referrer"
      className={className}
    />
  ) : (
    <span
      className={`${
        className || ""
      } inline-flex items-center justify-center bg-[var(--m3-primary-container)]`}
      aria-label={name}
    >
      <UserRound className="h-1/2 w-1/2" />
    </span>
  );
}
