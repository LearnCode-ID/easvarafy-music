"use client";
import { AppLinksBridge } from '@/components/native/AppLinksBridge';
import { Suspense } from "react";
import { MusicProvider } from "@/components/MusicProvider";
import { EasvarafyShell } from "@/components/EasvarafyShell";
// Keep the iframe, audio state, mini-player and navigation mounted across routes.
export default function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MusicProvider>
      <Suspense fallback={null}>
        <AppLinksBridge />
        <EasvarafyShell />
      </Suspense>
      {children}
    </MusicProvider>
  );
}
