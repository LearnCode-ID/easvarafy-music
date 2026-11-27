"use client";

import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { DailyActivityTracker } from "@/components/DailyActivityTracker";
import { BlendLanding, BlendReturnBridge } from '@/components/BlendLanding';
import { ProfileView } from "@/components/ProfileView";
import { ChartsView } from "@/components/ChartsView";
import { DetailView } from "@/components/DetailView";
import { DynamicIsland } from "@/components/DynamicIsland";
import { DynamicIslandPopup } from "@/components/DynamicIslandPopup";
import { HomeView } from "@/components/HomeView";
import { LibraryView } from "@/components/LibraryView";
import { ListenersView } from "@/components/ListenersView";
import { LiquidGlassFilterDefs } from "@/components/LiquidGlassSurface";
import { MiniPlayer } from "@/components/MiniPlayer";
import { MobileBottomTabs, MobileTopBar } from "@/components/MobileNav";
import { useMusic } from "@/components/MusicProvider";
import { NowPlayingSheet } from "@/components/NowPlayingSheet";
import { NotificationTabRouter } from "@/components/notifications/NotificationTabRouter";
import { OfflineStatusBanner } from "@/components/OfflineStatusBanner";
import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { SearchView } from "@/components/SearchView";
import { SettingsView } from "@/components/SettingsView";
import { Sidebar } from "@/components/Sidebar";

export function EasvarafyShell() {
  const auth = useAuth();
  const pathname = usePathname();
  const query = useSearchParams();
  const profileId = pathname.startsWith("/profile/")
    ? pathname.split("/")[2] || query.get("id") || auth.userId
    : pathname === "/profile"
    ? query.get("id") || auth.userId
    : null;
  const {
    activeTab,
    detailTarget,
    ytContainerRef,
    showVideoStage,
    isNowPlayingOpen,
    currentTrack,
    settings,
    libraryError,
    libraryLoading,
    librarySaving,
    reloadLibrary,
  } = useMusic();

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip flex flex-col lg:flex-row relative bg-[var(--m3-bg)] transition-colors duration-200">
      {settings.dockStyle === "liquid-glass" && <LiquidGlassFilterDefs />}
      {/* In-Viewport Non-Occluded Video Stage for YouTube IFrame Player API (prevents Android Chrome offscreen iframe audio suspension) */}
      <div
        className={
          showVideoStage && isNowPlayingOpen
            ? "fixed top-20 left-1/2 -translate-x-1/2 z-[55] w-[92vw] max-w-lg aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-black"
            : "fixed bottom-2 right-2 w-[220px] h-[124px] opacity-[0.015] pointer-events-none z-0 overflow-hidden"
        }
        aria-hidden={!showVideoStage || !isNowPlayingOpen}
      >
        <div ref={ytContainerRef} data-testid="youtube-stage" className="w-full h-full" />
      </div>

      {/* iPhone 17 / 18 Dynamic Island & Background Popup Engine */}
      <DynamicIsland />
      <DynamicIslandPopup />
      <NotificationTabRouter />
      <BlendReturnBridge />

      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col">
        <OfflineStatusBanner />
        <MobileTopBar />

        <main
          className={`flex-1 px-4 sm:px-8 pt-5 lg:pt-14 max-w-7xl w-full mx-auto pb-[calc(10rem+env(safe-area-inset-bottom))] ${
            currentTrack ? "lg:pb-32" : "lg:pb-14"
          }`}
        >
          <DailyActivityTracker />
          {(libraryLoading || librarySaving) && (
            <p
              role="status"
              className="text-xs mb-3 text-[var(--m3-on-surface-variant)]"
            >
              {librarySaving
                ? "Menyimpan ke Supabase…"
                : "Menyinkronkan library…"}
            </p>
          )}
          {libraryError && (
            <div
              role="alert"
              className="m3-card p-3 mb-4 text-sm flex flex-wrap gap-3 items-center"
            >
              <span>{libraryError}</span>
              <button
                className="profile-button"
                onClick={() => void reloadLibrary()}
              >
                Muat ulang / coba lagi
              </button>
            </div>
          )}
          {detailTarget ? (
            <DetailView />
          ) : pathname.startsWith('/blend') ? (
            <BlendLanding code={query.get('code')} id={query.get('id')} />
          ) : profileId ? (
            <ProfileView key={profileId} userId={profileId} />
          ) : pathname.startsWith("/profile") ? (
            <section className="m3-card p-8 text-center space-y-4">
              <h1 className="font-bold text-xl">Profil kamu</h1>
              <p>
                {auth.ready
                  ? "Masuk untuk membuka profil kamu."
                  : "Memuat sesi…"}
              </p>
              {auth.ready && (
                <button
                  className="profile-button"
                  onClick={() => auth.openLoginPrompt()}
                >
                  Masuk
                </button>
              )}
            </section>
          ) : activeTab === "home" ? (
            <HomeView />
          ) : activeTab === "search" ? (
            <SearchView />
          ) : activeTab === "charts" ? (
            <ChartsView />
          ) : activeTab === "library" ? (
            <LibraryView />
          ) : activeTab === "listeners" ? (
            <ListenersView />
          ) : (
            <SettingsView />
          )}
        </main>
      </div>

      <MiniPlayer />
      <MobileBottomTabs />
      <NowPlayingSheet />
      <PlaylistPickerModal />
    </div>
  );
}
