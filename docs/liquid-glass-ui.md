# Liquid Glass UI implementation

## Stack and UI map

Existing stack, without a new runtime dependency: Next.js 16 App Router, React 19, TypeScript 5.9, Tailwind CSS 4/PostCSS, Motion 12, Lucide, Supabase and Capacitor 8. Local Jakarta/DM Sans/JetBrains fonts remain bundled; music screens prefer the platform's Apple/system font with DM Sans fallback. No remote font request was introduced.

| Layer | Files |
| --- | --- |
| Application/layout | `app/layout.tsx`, `app/(user)/layout.tsx`, `components/EasvarafyShell.tsx` |
| Theme/material | `app/globals.css`, **`app/liquid-glass.css`**, `lib/metrolist/theme.ts`, `components/LiquidGlassSurface.tsx` |
| Artwork ambiance | **`components/ArtworkAmbient.tsx`**, **`lib/liquid-glass/palette.ts`** |
| Navigation/transport | `Sidebar.tsx`, `MobileNav.tsx`, `MiniPlayer.tsx` |
| Full player | `NowPlayingSheet.tsx`, `PlayerBackground.tsx`, `PlayerSlider.tsx`, `AudioToolsModals.tsx`, lyrics/queue children |
| Browsing/library | `HomeView.tsx`, `HomeEditorialSections.tsx`, `LibraryView.tsx`, `DetailView.tsx`, `PlaylistEditor.tsx`, `SearchView.tsx` |
| Account/settings | `SettingsView.tsx`, `ProfileView.tsx`, `components/auth/AuthUI.tsx`, existing profile/dialog controls |

The shared material is scoped to the music application and auth shell, not the operational admin dashboard. Existing profile, search, library, settings and playlist surfaces inherit it via their reusable surface/control classes. Playback, persistence, routing, API, RLS and storage contracts are unchanged.

## Implementation sequence

1. Centralized tint/ink/secondary color, 20px blur/180% saturation, hairline/specular edge, shadow, 28px outer/20px inner radii, capsule and spring timing tokens in `app/liquid-glass.css`. Existing Material accent/settings remain authoritative for action colors.
2. Application ambient layer, translucent sidebar/header, floating inset default mobile navigation. The optional optical/refraction dock keeps its existing slide/compact behaviors; its CSS fallback also consumes the material tokens.
3. Floating desktop/mobile mini-player capsules; existing playback/progress/like/popup/open-player handlers retained.
4. Spring full-screen player opening/closing; rounded artwork with palette glow, glass progress/volume/transport groups. Fixed top-clipped artwork when the short/narrow viewport needs scrolling. Native range controls and their keyboard/seek semantics remain intact.
5. Lightweight transparent Home/playlist cards, concentric song rows, hairlines and consistent typography. The restored **large Easvarafy editorial collage covers** are deliberately untouched; ranked song grouping and queues are unchanged. Auth uses the shared glass material and a restrained static mesh wash.

## Actual artwork colors and fallbacks

`ArtworkAmbient` samples a 32×32 canvas only on artwork URL changes, anonymously and without credentials. Quantized dominant clusters produce up to three actual RGB colors; near-black letterboxes and transparent pixels are ignored. Cache is bounded to 32 palettes. No per-frame sampling, color library, artwork proxy, or guessed artist/track-ID color is used for the ambient palette.

Sampling failure (CORS, image error, canvas unavailable) immediately leaves an artwork-URL blurred visual fallback; a missing/unloadable image safely leaves the base theme behind it. If dynamic color is disabled, ambient falls back to theme colors and extracted root overrides are removed. Pure Black hides the application ambient layer. The existing foreground accent selection algorithm is retained independently; the extracted palette only controls ambient/glow/background colors.

One shared mesh drifts slowly using transforms, pauses when playback pauses, and is disabled under reduced motion. Solid/blurred/gradient/liquid player-background choices still work; gradient/orb colors now share the artwork palette. Browsing cards do **not** get individual backdrop filters. Standard floating chrome uses CSS blur, while the existing opt-in SVG optical engine remains opt-in.

## Accessibility and compatibility

- Strong theme-specific ink/secondary colors, sufficiently opaque floating tints, visible keyboard focus, native range inputs, existing labels/tab semantics and safe-area offsets retained.
- Shared ink/secondary token contrast is tested at >=4.5:1 even against a conservative worst-case black/white ambient image. This is a material-token guarantee, **not** a claim that every legacy screen has received a complete WCAG audit.
- MotionConfig honors reduced-motion preferences; CSS also disables mesh/entry animation and press scaling. Reduced-transparency/high-contrast/forced-color fallbacks are provided; unsupported backdrop filtering gets an opaque surface.
- Prefix ordering matters: put `-webkit-backdrop-filter` before the standard declaration. The Next CSS pipeline otherwise retained only the prefixed declaration in browser QA, disabling blur on modern Chromium. The browser test checks the computed 20px/180% filter, not merely the source CSS.

## Verification

- `npm test`: 117 tests including three artwork-pixel tests and two conservative material-contrast tests.
- `npm run test:database`: 4 local database tests (no remote mutations).
- `npm run test:browser:glass`: controlled artwork/provider/player fixtures; 320/390/1366 widths, light/dark, default/optical dock, dynamic-color disabled, reduced motion, failed artwork fallback, no page overflow/runtime exceptions. Exercises actual UI handlers for play/pause, previous/next, seek, volume and queue; verifies pixel palette changes and artwork/header geometry.
- Existing Home, recommendation and Library browser suites passed with fixtures. Large editorial covers and real disjoint ranked queues remain protected.
- `npm run lint`: 0 errors, 15 existing image warnings.
- `npm run build`, `npm run build:static`, `npm run typecheck`, and `git diff --check`: passed. Final Liquid Glass browser rerun passed after the last animation/compatibility adjustments.

Browser fixtures are not production authentication or live YouTube tests. Real iOS Safari/Android WebView optical rendering, device battery/scroll profiling, and physical APK playback still need device QA. No merge, deployment, database/schema migration or credential changes are part of this UI work.
