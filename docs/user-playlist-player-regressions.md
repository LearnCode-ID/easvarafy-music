# Owned playlist layout and first-play regressions

## UI

`UserPlaylistView` renders only `user-playlist` detail targets. Remote albums, artists, catalog playlists and Blend retain their existing views. The owned view follows the reference's centered square cover, overlaid back/overflow controls, owner avatar, privacy/count/duration, outlined download/share/shuffle controls, theme-colored circular play button, horizontal management pills and artwork/title/artist rows with vertical overflow.

- Reuses ArtworkImage, ProfileAvatar, TrackContextMenu, PlaylistEditor, theme tokens, real offline engine and MusicProvider actions.
- Add from liked/history candidates or navigate to existing search and playlist picker.
- Edit mode reorders/removes tracks using existing server-confirmed playlist persistence. Detail editor retains name, description, HTTPS cover URL, tags and privacy. No database/schema changes.
- View sorting/filtering do not change persisted order. Search is expandable to keep the default track list uncluttered.
- Share exports a text song list via system share/clipboard; it does not create a public URL, change privacy, or include auth credentials.
- Playlist download requires confirmation and uses the existing bounded download queue. Completion counts only fulfilled storage promises; enqueueing is not advertised as offline availability. Individual cancellation/status remain in Downloads.
- Empty/long playlists, mobile safe areas, reduced motion and adaptive lite effects retain the existing shell behavior. No extra canvas or per-row blur.

## Regressions

1. DynamicIsland used `AnimatePresence mode="wait"`: new content waited for the previous exit animation. It now uses `popLayout` with non-interactive exits, so the next state mounts immediately. A toast with an active track is itself an expand-player button, rather than blocking access until the notification expires.
2. The lazily mounted NowPlayingSheet lacked a loading component. In this version of Next's lazy-dynamic Loadable, `ssr: true` without a loading component does **not** add a local Suspense boundary. First playback mounted the lazy component and suspended the shell up to the user-layout `fallback={null}`, hiding the page while downloading its chunk. A local null loading callback now contains suspension to the still-closed player. The persistent iframe host and queue/provider architecture are unchanged.

## Validation

`npm run test:browser:playlist` uses intercepted auth/database/catalogue and a fake iframe player. It covers 320px light/reduced motion, 390px dark and 1280px light/full-effects, no horizontal overflow, sort without writes, playback/shuffle/share, rename/reorder only after delayed server confirmation, conflict retention, add-song, download confirmation, notification-player access, offline-save denial and empty/long-name layouts. It deliberately withholds the actual NowPlayingSheet JavaScript chunk and checks the shell stays visible across animation frames; island expansion must mount by the next frame without awaiting exit.

Use the fixture server environment documented in `profile-privacy-playlists.md`; do not deploy a fixture build. Browser binaries and screenshots are local/ignored. These checks do not prove live media-provider behavior, production Supabase writes, or physical Android device performance.

## Follow-up: clipped track actions and translucent profile editor

- Shared `TrackContextMenu` now portals to `document.body` instead of positioning absolutely inside a song card. A fixed, opaque theme surface escapes `overflow: hidden`, transforms and stacking contexts across every existing track-menu consumer. `positionTrackMenu` clamps to the visual viewport and flips up near its bottom; resize/content changes remeasure it. Menus support outside pointer dismissal, Escape/Tab, arrow/Home/End navigation, restored trigger focus and native Android back. Scrolling the underlying list dismisses the menu, while scrolling its own contents does not.
- The owner profile editor also portals outside the page stack. Its form and fields use opaque theme surfaces, with a dimmed scrim, sticky title/close controls, body scroll lock and keyboard focus containment/restoration. Existing upload/crop/privacy/save behavior and busy/error handling remain unchanged; no extra backdrop blur or database changes.
- Playlist browser coverage now deliberately clips/transforms song-card ancestors and raises a following sibling, then uses hit testing to verify actual menu buttons stay on top. It also covers a 460px-high resized viewport, dismissal, keyboard access and a real queue action. Profile smoke coverage checks portaled solid form/field colors, theme foregrounds, viewport bounds and focus/scroll restoration at 320/390/1280px in light and dark. Recommendation feedback lookup now uses the portaled dialog rather than searching inside the old card subtree.
