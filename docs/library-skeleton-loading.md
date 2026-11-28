# Library skeleton loading

Implemented soft, theme-aware iOS-style shimmer using the existing skeleton blocks, surface colors and rounded cards. No database migration or data changes.

- `components/LibrarySkeleton.tsx`: grid playlist cards, list song rows, two-avatar Blend cards, and a compact background-sync indicator. Decorative shapes are hidden from accessibility APIs; one status announces the load. No fake buttons, counts, titles or artwork.
- `components/LibraryView.tsx`: initial cloud loads replace empty playlist/liked content with the relevant skeleton, including placeholder counts instead of misleading zeros. Tabs remain usable. Cached data stays visible during refresh. History/saved/offline views do not wait for unrelated cloud loads.
- `components/BlendLibrarySection.tsx`: skeleton cards replace the plain loading paragraph. Existing cards remain visible during refresh.
- `components/EasvarafyShell.tsx`: cloud synchronization uses the compact indicator rather than a text-only loading paragraph. The separate server-save message and error/retry behavior remain intact; skeletons never claim a successful save.
- `app/globals.css`: scoped moving highlight uses theme tokens and transform-only animation; `prefers-reduced-motion: reduce` disables it. Other existing skeleton styles are unchanged.

Verification: 83 unit tests passed, including accessible server-rendered skeleton markup. Typecheck, Next web build and static Android export passed. Full lint has 0 errors and 15 existing image optimization warnings.

`npm run test:browser:library` passed with controlled Supabase/music responses held until explicitly released: 320/390/1280 widths, light/dark, both motion preferences, grid and song-row skeletons, removal on completion, no false empty state, cached-content preservation during background sync, Blend transition, no horizontal overflow or browser runtime errors. The fixture music response must include `shelves: []` to match HomePayload. This test is not real production Auth/Storage/device testing.

Browser setup: a dev server with `NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-key`, `NEXT_PUBLIC_APP_URL=https://easvarafy.example`; Playwright Chromium, optionally specified with `CHROMIUM_EXECUTABLE_PATH`. Screenshots/tooling are under ignored `.cache/` and are not shipped.

This UI change was not deployed to production during implementation.
