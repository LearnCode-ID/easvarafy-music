# Low-end phone performance pass

## Scope and preserved behavior

Keep the restored large Easvarafy Home editorial covers, theme-colored player/navigation actions, actual artwork palette, playlists, queue, sync, online/offline playback and the mounted audio/iframe host. This pass changes rendering budgets, not backend contracts. No runtime dependency, database migration or credential change.

## Changes

- **Clock isolation:** `MusicProvider` publishes stable shallow-equal music snapshots separately from its 250ms progress clock. Only `usePlaybackProgress` subscribers receive time changes; Home, library, settings, shell and other music consumers no longer receive progress-only broadcasts. The provider's watchdog/listening-session/native/background logic still runs with the existing clock. Stable empty-library arrays prevent false updates while switching accounts.
- **Correct actions:** previous-track and Media Session seek handlers read the latest time ref. Metadata and lockscreen action handlers are no longer re-registered every 250ms. Progress position sync remains active.
- **Visibility/layout subscriptions:** closed full-player/AOD and inactive PiP controller do not subscribe to progress. Desktop-only mini-player and mobile-only dock subscribe only on their visible layout, and stop while the full player is open.
- **Hydration/host readiness:** external stores retain the initial SSR snapshot for delayed Suspense hydration. A stable iframe-host callback explicitly starts engine initialization after the host mounts; playback is not left waiting if the shell hydrated later than its provider.
- **Adaptive effects:** mobile (<=767px or coarse pointer), <=4GB reported RAM, <=4 reported CPU cores, Save-Data or reduced-motion use lite effects. Missing memory/connection APIs are supported; mobile detection does not depend on them. Desktop devices without constrained hints retain full effects.
- **Lite visuals:** retain colors, translucent tints, borders, capsules and large artwork. No optical SVG displacement maps are generated or applied; no navigation backdrop blur; no moving ambient mesh; non-solid player backgrounds use static palette gradients instead of stacked full-screen artwork/orb blurs. The artwork itself is unchanged. CSS glass remains on capable desktops. No user's stored dock/background/theme preference is overwritten.
- **Animation work:** slider/lrc interpolation RAF loops do not run in lite mode or hidden documents; slider also stops while paused/scrubbing. Lite lyrics retain 250ms synchronization without depth blur or smooth scrolling. Settings lyric demo runs at 4Hz on lite/20Hz on full instead of 60Hz, and stops in hidden tabs. Application ambient stops when hidden or covered by Now Playing.
- **Render/bundle budget:** memoized artwork/background components skip progress-driven rerenders. Secondary screens (Search, Charts, Library, Profile, Settings, Listeners, Detail) and the full-screen player are separate dynamic imports. Navigation screens display a small accessible loading label while their chunk loads. Playback host remains outside lazy screens and survives route changes.

## Verification and limits

- Unit suite: 120 tests. New cases verify clock/state separation, stable snapshot references, unsubscribe, fixed SSR snapshots and constrained hardware detection.
- Browser glass suite: 320/390/1366, light/dark, classic/expressive, colored actions, dynamic color on/off, failed artwork, low-memory/two-core hints, lite optical fallback, native seek/volume UI, previous/next, queue, no page overflow or runtime/hydration exceptions.
- **Render budget regression:** at 320px with CDP CPU throttled 6x, after startup/queue settlement, an advancing controlled player caused **zero browse-area React Profiler commits during a two-second sample**. A separate unit test simulates 40 clock ticks and expects zero music-state broadcasts. This is not a measured FPS/battery improvement or a guarantee for every physical phone.
- Development-only bounded performance marks (`easvarafy:browse-render`, `easvarafy:music-change`) support regression diagnosis; no production per-tick analytics or private state values are recorded.
- Existing Home, recommendations, Library, general UI smoke and offline-download browser suites passed with controlled fixtures. Download suite includes actual browser bytes/decoder and offline audio; streaming suites use a controlled player, not live YouTube.
- Final checks passed: web build, static Capacitor export, TypeScript, 120 unit tests, 4 local DB tests and diff whitespace checks. Lint: zero errors, 15 existing image warnings.

Still required on real hardware: sustained scroll/FPS/thermal/memory testing on low-end Android, live streaming, native PiP/background playback and physical APK testing. Very old WebViews or insufficient RAM for the external video player can still impose limits; this work cannot guarantee all devices.
