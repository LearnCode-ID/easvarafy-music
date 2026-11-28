# Owned playlist layout and first-play regressions

## UI

`UserPlaylistView` renders only `user-playlist` detail targets. Remote albums, artists, catalog playlists and Blend retain their existing views. The owned view follows the reference's centered square cover, overlaid back/overflow controls, owner avatar, privacy/count/duration, outlined download/share/shuffle controls, theme-colored circular play button, horizontal management pills and artwork/title/artist rows with vertical overflow.

- Reuses ArtworkImage, ProfileAvatar, TrackContextMenu, PlaylistEditor, theme tokens, real offline engine and MusicProvider actions.
- Add from liked/history candidates or navigate to existing search and playlist picker.
- Edit mode reorders/removes tracks using existing server-confirmed playlist persistence. Detail editor retains name, description, HTTPS cover URL, tags and privacy. No database/schema changes.
- View sorting/filtering do not change persisted order. Search is expandable to keep the default track list uncluttered.
- Share sends only the canonical playlist URL via system share/clipboard; it never changes privacy or includes auth credentials.
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

## Playlist popup presentation

Owned-playlist options now use `PlaylistActionDialog`: a solid centered portal with a dimmed backdrop, internal scroll area, safe-area padding, focus containment/restoration, Escape/outside-click dismissal and native-back handling. Add, edit tracks/order, name/details, sort, search and download confirmation no longer insert panels into the playlist page. Switching options keeps one dialog mounted and retains the original opener for focus restoration. Persistence errors and pending status are visible within that popup; existing confirmed-save semantics remain unchanged. Sharing still uses the native share popup/clipboard without changing privacy. The add popup retains liked/history candidates and the explicit link to the existing catalogue Search page.

Song three-dot actions inside owned playlists use the same centered popup via `TrackContextMenu`'s optional `popup` presentation. Other music screens retain the fixed anchored portal from the clipping fix. Both presentations share the exact action content, avoiding divergent playback/like/download behavior.

The playlist browser test now covers modal geometry at 320/390/1280px and 460px height, portaling outside transformed/clipped ancestors, no inserted inline panel, focus trapping and restoration across view switches, song actions, header options, add, details, reorder/failure handling, sorting and search. These use controlled fixtures, not production writes.

## Consolidated options and photo covers

The owned-playlist page now leaves only its primary play/pause action outside the three-dot popup. Shuffle, add songs, edit tracks/order, details (including tags/privacy/cover), sorting, filtering, downloads and sharing are reached from that popup. The old management-chip row and separate download/share controls are removed. Song-specific menus are unchanged.

Details accepts JPEG/PNG/WebP photos up to 10 MB using the existing profile validator and centered square crop/compression helper (512px WebP, output at most 5 MB). Selection shows a cancellable local preview; **Simpan detail** first uploads the immutable object, then awaits the versioned playlist RPC. Upload failure never updates the playlist. RPC failure leaves the previous server cover intact and keeps the successful upload available for retry without re-uploading. Offline attempts never report success. Existing HTTPS URL covers remain supported.

New migration `20261127050000_playlist_cover_uploads.sql` creates private `playlist-covers` Storage and owner-prefixed insert/delete policies. Persisted `playlist-covers:<owner>/cover-<uuid>.webp` references are resolved by ArtworkImage with authenticated, uncached downloads across detail, Library, Search and profile cards. Public reads require **both** a public playlist and a public non-banned profile, plus matching object/playlist ownership. Publishing another owner's reference cannot expose it. There are no public URLs or long-lived signed URLs. Blob URLs are revoked on replacement/unmount; auth changes discard the prior image, focus/privacy events refresh access, and visible online views revalidate every minute. Already delivered pixels cannot be remotely recalled. Old/abandoned objects remain private to the owner unless explicitly referenced by an eligible public playlist; automatic orphan deletion is deliberately not attempted after uncertain RPC responses.

Apply this **new migration only**, before releasing the upload UI; historical migrations must not be replayed. Production rollout: this new migration was applied to Easvarafy (`kxvckczujvwvfkykofzc`) as remote version `20261128090230` (`playlist_cover_uploads`). Post-apply inspection confirmed the bucket remains private, has a 5 MB raster-image limit, and has only the intended SELECT/INSERT/DELETE policies. The earlier migrations were not replayed. Browser checks use intercepted Storage/RPC responses, including delayed persistence, upload failure, RPC failure/retry, preview validation, and saved-cover rendering after reload at 320/390/1280px. The isolated PostgreSQL test executes the actual new migration and verifies read/write boundaries and privacy revocation. These do not claim live production upload or physical-device verification.

## Restored quick actions and direct playlist URLs

Shuffle, Share, Download and Search are again directly accessible next to Play on the playlist hero. Search and download confirmation still use the centered popup. The three-dot popup contains only add songs, edit tracks/order, name/cover/details and sorting (editing actions are owner-only). Shuffle, Share, Download and Search are not duplicated inside it; the former management-chip row stays removed.

Opening a saved playlist from Library, Search or a profile now navigates to `/playlist/<id>`, with `/playlist/?id=<id>` as the static Capacitor equivalent. The persistent user layout keeps the existing iframe/audio host and player mounted across navigation. Refreshing/directly visiting a playlist URL loads the same view; tabs and Android back leave the route normally. Web route documents contain no server-rendered private playlist data, and the service worker does not cache playlist route documents.

Route data uses the ordinary Supabase client and existing `user_playlists` RLS (no new migration/service key). Owners see their loaded library playlist with editor actions; guests/other accounts can only load a public playlist under a public, non-banned owner profile. Public views show the actual owner, not the visitor, and never render owner management controls. Missing/private/ambiguous legacy IDs produce the same unavailable state; invalid IDs are rejected before querying. Public data revalidates on focus, online and a 30-second visible-page interval and is cleared on failed revalidation or auth identity change. UUIDs created by the app are unique; ambiguous legacy owner/id collisions are not guessed.

Sharing sends only the canonical HTTPS `/playlist/<id>` URL, without a title, track list, or extra message. The system share payload is `{ url }`; clipboard fallback copies exactly that URL. It does not publish the playlist or profile, so existing owner-only/public access rules remain unchanged. `NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_API_BASE` must use the production HTTPS origin, as for profile sharing.

Browser fixtures cover each restored quick action, persistent player host across route navigation, direct URLs/reload, query fallback, tab exit, guest public access without editor controls, revoked/private access and malformed URLs. Authorization remains covered separately by the PostgreSQL RLS tests. No live production writes or deployment are performed by these local tests.

Regression guard: with the three-dot popup open, browser tests assert each quick action has exactly one entry point on the page and zero entries in the popup, and check the exact remaining owner-menu action list at 320/390/1280px.
