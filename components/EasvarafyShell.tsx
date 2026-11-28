"use client";

import React, { Profiler } from "react";
import dynamic from "next/dynamic";
import { useLiteEffects, usePageVisible } from "@/lib/ui/useLiteEffects";
import { MotionConfig } from "motion/react";
import { ArtworkAmbient } from "./ArtworkAmbient";
import { usePathname, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { DailyActivityTracker } from "@/components/DailyActivityTracker";
import { BlendLanding, BlendReturnBridge } from '@/components/BlendLanding';
import { LibrarySyncIndicator } from "@/components/LibrarySkeleton";
import { DynamicIsland } from "@/components/DynamicIsland";
import { DynamicIslandPopup } from "@/components/DynamicIslandPopup";
import { HomeView } from "@/components/HomeView";
import { LiquidGlassFilterDefs } from "@/components/LiquidGlassSurface";
import { MiniPlayer } from "@/components/MiniPlayer";
import { MobileBottomTabs, MobileTopBar } from "@/components/MobileNav";
import { useMusic } from "@/components/MusicProvider";
import { NotificationTabRouter } from "@/components/notifications/NotificationTabRouter";
import { OfflineStatusBanner } from "@/components/OfflineStatusBanner";
import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { Sidebar } from "@/components/Sidebar";

function ScreenLoading() {
  return <p role="status" className="m3-card p-5 text-sm">Memuat tampilan…</p>;
}

const PlaylistLanding = dynamic(() => import("@/components/PlaylistLanding").then(module => module.PlaylistLanding), { loading: ScreenLoading });
const ProfileView = dynamic(() => import("@/components/ProfileView").then(module => module.ProfileView), { loading: ScreenLoading });
const ChartsView = dynamic(() => import("@/components/ChartsView").then(module => module.ChartsView), { loading: ScreenLoading });
const DetailView = dynamic(() => import("@/components/DetailView").then(module => module.DetailView), { loading: ScreenLoading });
const LibraryView = dynamic(() => import("@/components/LibraryView").then(module => module.LibraryView), { loading: ScreenLoading });
const ListenersView = dynamic(() => import("@/components/ListenersView").then(module => module.ListenersView), { loading: ScreenLoading });
// A loading callback gives next/dynamic its own Suspense boundary. Without
// it, the first track suspends the whole shell up to the route loading screen.
const NowPlayingSheet = dynamic(() => import("@/components/NowPlayingSheet").then(module => module.NowPlayingSheet), { loading: () => null });
const SearchView = dynamic(() => import("@/components/SearchView").then(module => module.SearchView), { loading: ScreenLoading });
const SettingsView = dynamic(() => import("@/components/SettingsView").then(module => module.SettingsView), { loading: ScreenLoading });

function BrowseContent({ children }: { children: React.ReactNode }) {
  // Bounded development instrumentation for render-budget regression tests.
  if (process.env.NODE_ENV === 'production') return children;
  return <Profiler id="music-browse" onRender={() => {
    performance.clearMarks('easvarafy:browse-render');
    performance.mark('easvarafy:browse-render');
  }}>{children}</Profiler>;
}

export function EasvarafyShell() {
  const lite = useLiteEffects();
  const visible = usePageVisible();
  const auth = useAuth();
  const pathname = usePathname();
  const query = useSearchParams();
  const playlistRoute = pathname === "/playlist" || pathname.startsWith("/playlist/");
  const playlistId = pathname.split("/")[2] || query.get("id") || "";
  const profileId = pathname.startsWith("/profile/")
    ? pathname.split("/")[2] || query.get("id") || auth.userId
    : pathname === "/profile"
    ? query.get("id") || auth.userId
    : null;
  const {
    activeTab,
    detailTarget,
    attachYouTubeHost,
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
    <MotionConfig reducedMotion={lite ? "always" : "user"}>
    <div data-effects={lite ? "lite" : "full"} data-page-visible={visible} data-player-open={isNowPlayingOpen} className="glass-app min-h-screen w-full max-w-full overflow-x-clip flex flex-col lg:flex-row relative bg-[var(--m3-bg)] transition-colors duration-200">
      <ArtworkAmbient />
      {!lite && settings.dockStyle === "liquid-glass" && <LiquidGlassFilterDefs />}
      {/* In-Viewport Non-Occluded Video Stage for YouTube IFrame Player API (prevents Android Chrome offscreen iframe audio suspension) */}
      <div
        className={
          showVideoStage && isNowPlayingOpen
            ? "fixed top-20 left-1/2 -translate-x-1/2 z-[55] w-[92vw] max-w-lg aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/20 bg-black"
            : "fixed bottom-2 right-2 w-[220px] h-[124px] opacity-[0.015] pointer-events-none z-0 overflow-hidden"
        }
        aria-hidden={!showVideoStage || !isNowPlayingOpen}
      >
        <div ref={attachYouTubeHost} data-testid="youtube-stage" className="w-full h-full" />
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
          {librarySaving ? (
            <p role="status" className="text-xs mb-3 text-[var(--m3-on-surface-variant)]">Menyimpan ke Supabase…</p>
          ) : libraryLoading && activeTab !== 'library' ? <LibrarySyncIndicator className="mb-3" /> : null}
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
          <BrowseContent><div className="glass-content" key={`${activeTab}:${detailTarget?.id || ""}:${pathname}`}>
          {detailTarget ? (
            <DetailView />
          ) : playlistRoute ? (
            <PlaylistLanding id={playlistId} />
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
          </div></BrowseContent>
        </main>
      </div>

      <MiniPlayer />
      <MobileBottomTabs />
      {currentTrack && <NowPlayingSheet />}
      <PlaylistPickerModal />
    </div>
    </MotionConfig>
  );
}
