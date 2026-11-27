"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth/AuthProvider";
import { supabase } from "@/lib/supabase";

/** Only visible, authenticated foreground use counts. No client dates/counts
 * are submitted; the server owns the timezone, calendar and row lock. */
export function DailyActivityTracker() {
  const { userId, ready, configured } = useAuth();
  const [error, setError] = useState("");
  const busy = useRef(false);
  const lastSuccess = useRef(0);
  const record = useCallback(async () => {
    if (
      !userId ||
      !ready ||
      !configured ||
      document.visibilityState !== "visible" ||
      busy.current
    )
      return;
    if (!navigator.onLine) {
      setError("Offline. Aktivitas hari ini belum dapat disinkronkan.");
      return;
    }
    busy.current = true;
    try {
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const { error: err } = await supabase.rpc("record_daily_activity", {
        p_timezone: timezone,
      });
      if (err) throw new Error(err.message);
      lastSuccess.current = Date.now();
      setError("");
      window.dispatchEvent(new Event("easvarafy:activity"));
    } catch {
      setError("Streak belum tersimpan. Periksa koneksi lalu coba lagi.");
    } finally {
      busy.current = false;
    }
  }, [userId, ready, configured]);
  useEffect(() => {
    queueMicrotask(() => setError(""));
    lastSuccess.current = 0;
    if (!userId || !ready || !configured) return;
    // Reading/browsing in the foreground for 10s is activity; interactions also
    // schedule this dwell timer. Every minute handles local midnight while open.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState === "visible")
        timer = setTimeout(() => {
          timer = undefined;
          void record();
        }, 10000);
    };
    const interact = () => {
      if (Date.now() - lastSuccess.current > 60000 && !timer) schedule();
    };
    schedule();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void record();
    }, 60000);
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("online", schedule);
    window.addEventListener("pointerdown", interact);
    window.addEventListener("keydown", interact);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("online", schedule);
      window.removeEventListener("pointerdown", interact);
      window.removeEventListener("keydown", interact);
    };
  }, [record, userId, ready, configured]);
  if (!userId || !error) return null;
  return (
    <div
      className="m3-card p-3 mb-4 text-sm flex flex-wrap items-center gap-3"
      role="status"
    >
      <span>{error}</span>
      <button className="profile-button" onClick={() => void record()}>
        Coba sinkronkan streak
      </button>
    </div>
  );
}
