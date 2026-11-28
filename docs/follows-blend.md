# Follow & two-person Blend (2026-11-27)

> Rollout update: production activation was subsequently approved. Database migrations are now applied and Vercel production is READY/PROMOTED; see `production-rollout-20261127.md` for the release status and migration-version mapping. The pre-rollout status below is retained as implementation history.

## Deployment status and order

Implemented in the existing Next/Capacitor app, **not deployed**. The read-only live schema audit found only legacy profile columns; neither the previous privacy migration nor this social migration is installed. Do not advertise production availability until staging verification and a separately approved database rollout.

1. Back up the database and review existing policies/functions against the audited schema.
2. Apply `20261127010000_private_profiles_streak_playlists.sql` first (see `profile-privacy-playlists.md`).
3. Apply `20261127020000_follows_blends.sql` in staging. It is a transaction, and intentionally fails if the expected profile RPC body has changed; re-audit rather than bypass its guard.
4. Run the two-real-account matrix below, then arrange an approved production migration and matching web/APK release. No migration was applied by this work.

No service-role credential is used by the frontend. No playlist deletion, data cleanup, live database write, deployment or push was performed.

## Follow

- `user_follows` has two profile UUID FKs, composite PK, no-self constraint, inbound index, public read RLS and follower-only insert/delete RLS. Banned/missing users cannot create edges. Only authenticated users mutate their own edges.
- `get_follow_counts`, `get_follow_list`, `get_following_feed` supply counts, viewer-relative status, paginated lists and activity. Follow relationships/counts are public by design, **not** a grant to private profile content. Lists mask private names, avatars and badges.
- Shared `ProfileView` displays controls even on the private-profile placeholder. Follow state is server-confirmed, unfollow asks for confirmation, stats open a navigable modal. Listeners top cards, ranked rows and directory use sibling controls (no nested buttons). Guests are sent to login.
- Listeners has a Following / Friend Activity view. Latest public playlist links to the owner's public profile. Last-song data is separate from aggregate stats: `share_friend_activity` defaults false, editable in profile privacy, and requires the profile to also be public. Poll/focus refresh is 30 seconds, not real-time delivery.

## Blend consent & data access

- `/blend?code=<32 hex characters>` is the canonical invitation; `/blend?id=<uuid>` is participant detail. Both use the persistent app shell/player and a static-export-compatible route.
- Creating a link requires a sharing checkbox; a direct profile invite requires an explanatory confirmation. Direct invites stay pending until the addressed recipient opens/accepts. Pending participants cannot call the taste RPC. Opening a valid code **while logged in accepts it automatically**, per product behavior; share this URL only with the intended friend. The landing page and in-app invite explain this behavior. Use direct invites when recipient binding is important.
- Codes use UUID randomness (128 bits), expire after 7 days, bind atomically to the first non-creator claimant for open links, and bind to the chosen partner for direct invites. Re-opening an accepted invitation is idempotent for that partner. A third user cannot read/redeem it. Creation is serialized and limited to 20/day/creator. No preview endpoint exposes a pending user's taste.
- Both participants explicitly consent to a bounded sample from likes, playlist songs (including private playlists) and monthly last-song records. Names are shared under that consent. Playlist names/descriptions, email, account settings and full history are not queried by the taste RPC. Private profile images retain their original Storage authorization and may show initials rather than bypassing media privacy.
- Active user may contribute up to 30 local-history tracks when refreshing; another user's local history is never accessed. Server samples are capped at 200 unique tracks per person. Leaving/declining revokes future taste access for both and clears stored mix/shared artists. It cannot retract data already received/copied by a participant.
- Blend writes are RPC-only, row-locked for acceptance and versioned for refresh. Client actor ID must equal the JWT user ID. A stale version fails instead of silently overwriting another refresh. RLS permits only participants to select rows; no public/user-playlist conversion occurs.

## Matching and mix

`lib/social/blend.ts` is a pure tested module. Score is rounded 0–100, using Jaccard overlap: songs 50%, normalized artists 35%, metadata genre/vibe 15%. When either side lacks genre/vibe, the other weights are normalized over 85%; missing data is not invented. Empty taste is 0, not 100. This is an explainable sample-based heuristic, **not audio analysis** or an objective compatibility metric.

Mixes target 32 unique tracks (bounded 24–40), alternate A/B/shared and include related recommendation slots for each participant. Each song has `addedByUserId`, `tasteOwnerIds`, and `source` (`favorite`, `shared`, `related`). Related calls use the existing API with `mode=related&strict=true`: strict requests do not insert demo/seed discovery fallback. If the API fails or there are too few unique songs, the available mix can be shorter than 24; the UI explains this instead of fabricating songs. Refresh persists before claiming success and preserves the previous stored mix on failure.

Detail provides two avatar slots, match score, shared artists, attributed tracks, existing TrackContextMenu, Play/Shuffle/Refresh, timestamps, invite copying and leave/cancel. OAuth login uses a short-lived, tab-local invitation return intent to accommodate the app's existing Google/native return flow. `NEXT_PUBLIC_APP_URL` must be the canonical deployed HTTPS origin (not the preview or Capacitor origin).

## Notifications

New private `social_notifications` rows are generated in the database for direct invitations and accepted Blends. Existing bell merges them with device broadcast inbox rows; read acknowledgements use the appropriate RPC and wait for persistence. User-change generation guards clear personal inbox data and discard stale async responses. Blend notification navigation uses the Next router to preserve playback. Foreground bell refresh is every 30 seconds/focus; **native/background push for social notifications is not implemented**. Existing broadcast push remains unchanged.

## Verification

Commands executed successfully for this implementation:

- `npx tsc --noEmit`
- `npm test`: 78/78 (8 new Blend cases)
- `npm run test:database`: 3/3, including actual migration execution in isolated PGlite with anonymous/three-user role switching
- `npm run lint`: 0 errors, 15 existing image-optimization warnings
- `npm run build` and `npm run build:static` (contains `/blend`)
- `npm run test:browser` and `npm run test:browser:social` against controlled Supabase/music fixtures: 320/390/1280, reduced motion, follow persistence + confirmation, list modal, private-profile controls, automatic invite acceptance, detail, refresh persistence, overflow/runtime errors; previous profile/editor/player regression checks also passed.

Browser fixtures require `NEXT_PUBLIC_SUPABASE_URL=https://fixture.supabase.co`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-key`, `NEXT_PUBLIC_APP_URL=https://easvarafy.example` on a local dev server, plus Playwright Chromium. They do not prove real Supabase HTTP/Auth/Storage, production concurrency, or device behavior. PGlite fixtures use representative legacy schema/functions; they do not apply anything remotely.

### Required staging / device checks

- Two real accounts + anonymous + third user: follow, unfollow, counts/lists, guest login, direct/open/expired/reused invite, private profile transitions, activity opt-in/revoke, banned user, participant-only Storage/media behavior.
- Real likes/private playlists/monthly song samples; refresh from both devices concurrently (one stale version must fail), offline failures and identity switch while requests run; neither account may see previous user's inbox/history.
- Recipient acceptance creates exactly one creator notification; read persists across devices; third user cannot select/acknowledge it. Leave removes notifications/mix and blocks taste RPC.
- Canonical link from browser and Android, email/Google/native login return, APK static routing, hardware back, player persistence, safe areas and reduced-motion behavior. App-link OS association follows existing app configuration and has not been device-verified here.
