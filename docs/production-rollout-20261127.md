# Production rollout — 2026-11-27

User explicitly approved production activation in this session.

## Targets and safeguards

- Supabase: Easvarafy / `kxvckczujvwvfkykofzc`.
- Existing Vercel project: `easvarafy-music` / `prj_dy5IO5jtt78rRhS8yjdmeuVuHxEV`.
- Existing production domain: `https://easvarafy-music.vercel.app`.
- Previous production deployment: `dpl_8K1B9ncRNSCjCn16DmepPdNirNwb` (base commit `6ce7247bf65274becda7abf4ae6090574989da16`).
- Before changes: private database snapshot `arena_private.release_snapshots`, release `20261127_profiles_follows_blend`, created 2026-11-27 14:04:56 UTC. No schema usage or table permissions for public/anon/authenticated; RLS enabled. Contains affected profile/playlist/like/monthly rows, function definitions/ACLs, policies and bucket configuration. This is an in-database operator snapshot, not an external disaster-recovery backup. Storage object bytes were not changed or deleted.

## Database changes completed

- `private_profiles_streak_playlists`: recorded remotely as `20261127140555`.
- `follows_blends`: recorded remotely as `20261127140709`.
- `social_rpc_privileges`: applied after production ACL inspection revealed creation-time direct `anon` EXECUTE grants. Explicitly revokes anonymous/private RPC execution and blanket follow table privileges. Local regression test now reproduces Supabase-style default function/table grants before applying migrations.
- Local migration timestamps are deterministic development names; remote connector assigns application-time versions. Do not re-apply the local files blindly because their filename versions differ from remote history. Reconcile these mappings in any future Supabase CLI migration-history workflow.
- The social migration request included a transient unused `save_blend_mix(...,jsonb)` overload which was immediately dropped inside the same transaction. The final function is the tested actor-UUID signature only; no unused overload remains.
- Post-migration counts: 6 profiles, 10 playlists, 24 likes. All 10 original playlist rows compare equal to the pre-rollout snapshot after excluding the two added columns (`version`, `cover_url`). All existing profiles now default private; aggregate stats, streaks, badges and friend activity remain opt-in. Listeners directory/rankings may be empty until owners opt in.
- Both `avatars` and `profile-media` buckets are private. Existing image references retained; the new client performs authorized media reads.

## Application release

`NEXT_PUBLIC_APP_URL` added for production and preview with the verified existing production origin. Existing Supabase/API credentials were not replaced or exposed; sensitive Vercel variables remain masked by the provider.

Application deployment is requested from the current Arena branch, not by pushing or switching to main. See the follow-up release-result section for Vercel deployment ID and final outcome.

## Verification and operational limits

Before release: 78 unit tests, 3 isolated database tests, Next web build and diff checks passed again. Earlier static build and browser-fixture tests also passed (see `follows-blend.md`). No test follows/invites were inserted for real users and no accounts were impersonated to manufacture consent. Two-real-account authentication/Storage and physical Android verification remain outstanding; no new APK is distributed by this web release.

Rollback: retain the private defaults and access controls. Reverting to the old web deployment alone will not restore prior public avatars or profile exposure and may not understand new playlist versions. Prefer a forward fix; review the private snapshot with an authorized database operator before any schema/data restore. Never globally restore the snapshot over newer user edits.

## Release result — completed

- Vercel production deployment **READY / PROMOTED**: `dpl_78hbXcGK1H3RZ1LWb94NyMnH7iqi`.
- Deployed application commit: `292f990aa334dcb6c16d0455fb54cd9af4bbd493`.
- Production alias assigned successfully, with no alias error: `https://easvarafy-music.vercel.app`.
- Immutable deployment URL: `https://easvarafy-music-prmj2zzr1-learn-code1.vercel.app` (Vercel protection may require account access).
- Final ACL migration remote version: `20261127140809` (`social_rpc_privileges`).
- Supabase auth/database/REST/Storage all reported healthy after migrations.
- Production catalog verification: authenticated direct Blend table updates denied; anonymous private RPC execution denied; follow UPDATE and created_at INSERT denied; exactly one actor-UUID `save_blend_mix` signature remains. Original profile base fields and all original likes still match the pre-rollout snapshot; playlist comparison also passed.
- Read-only production transaction under `anon`: profile DTO returns `private`; raw profiles, likes, stats and playlists expose zero rows; directory/ranking expose zero entries until users opt in; count RPC works with zero followers/following. No real-user mutation/consent was simulated.
- Public home page retrieved successfully by the page-fetch tool. The same tool could not retrieve `/blend`; the Vercel build manifest confirms `/blend` was built, but this is **not** a live authenticated browser smoke pass. Client-side invitation/login playback and real account/physical APK tests remain explicitly unverified.
- The release used an explicit production deployment of the current Arena branch commit. `main` was not modified or merged; a future unrelated deployment from the old main branch could overwrite this application release. Reconcile via the normal review/merge workflow before the next main release.

No playlists, likes, accounts, or Storage objects were deleted. No new APK release or background social push delivery was claimed.
