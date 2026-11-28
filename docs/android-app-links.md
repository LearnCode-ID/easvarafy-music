# Verified Android content links

## Implementation

- Canonical host/package: `config/android-app-links.json` (must match the app ID and shared HTTPS origin).
- `scripts/configure-android.mjs` installs an idempotent, `autoVerify` HTTPS intent filter on MainActivity, restricted to `/playlist/` and `/profile/`. The custom OAuth callback filter is unchanged.
- `AppLinksBridge` handles cold launches (`getLaunchUrl`) and live intents (`appUrlOpen`), validates host/protocol/IDs, then navigates to the existing static-compatible query routes. It dismisses the old detail/player without interrupting audio or unmounting MusicProvider. RLS/privacy still applies; links do not grant access.
- The web serves `/.well-known/assetlinks.json` as static JSON with a five-minute cache and no redirect. Certificate hashes come from **build-time** `ANDROID_APP_LINKS_SHA256_FINGERPRINTS`. Missing configuration produces `[]` (trust nobody); invalid hashes fail the build. Do not call this enabled until the live association and installed APK verify.
- CI now builds a **signed release APK**, not a debug APK signed by a potentially different ephemeral key on each runner. Missing signing configuration intentionally blocks release early.

## Required operator configuration (before merge/release)

The coding session cannot manage GitHub Actions secrets (GitHub returned 403). No signing key has been created, uploaded, changed, or committed, and no real certificate fingerprint is assumed. Do not send passwords or private keys in chat.

1. Reuse the existing distribution keystore if one exists and is safely available. Back it up securely. Do not rotate a key silently. If the old APK was signed with a lost ephemeral debug key, a new stable release key cannot update that installed APK in place. Plan migration first: app-local downloads/preferences may be lost on uninstall; verified Supabase data remains in the account. Never uninstall automatically.
2. If there is no reusable key, an authorized operator creates a release keystore **outside this repository**, with `keytool -genkeypair -v -keystore /secure/path/easvarafy-release.jks -alias easvarafy -keyalg RSA -keysize 3072 -validity 10000`. Let keytool prompt for passwords; do not put them in shell history. Store this key and passwords in a secure backup for all future updates.
3. In repository Settings → Secrets and variables → Actions, set these **secrets**:
   - `ANDROID_KEYSTORE_BASE64`: base64 of that keystore (this is private key material).
   - `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
4. Obtain the **certificate** SHA-256 fingerprint using `keytool -list -v -keystore /secure/path/easvarafy-release.jks -alias easvarafy` (not the APK file's SHA-256). Set the public colon-separated hash as the Actions repository **variable** `ANDROID_APP_LINKS_SHA256_FINGERPRINTS`. Multiple trusted certificate hashes can be comma-separated for a deliberate rotation/Play App Signing; do not authorize generic Android debug keys.
5. Set the **same** `ANDROID_APP_LINKS_SHA256_FINGERPRINTS` in the Vercel production environment. Set `NEXT_PUBLIC_APP_URL=https://easvarafy-music.vercel.app`. Redeploy web because the JSON is statically generated. A custom domain requires updating the canonical config and APK intent filter, not just an environment variable.
6. Merge/deploy only after configuration. CI restores the keystore with restrictive permissions in runner temp, checks the cert against the hash variable, assembles release, publishes the existing `easvarafy-music.apk` asset name, and removes temporary signing material. The key is never part of web bundles or artifacts. Install the newly signed APK after resolving the migration concern above.

## Checks

Automated:

```sh
npm run typecheck
npx tsx --test lib/native/appLinks.test.ts
node --test tests/android-app-links.test.mjs
npm run build
npm run build:static
```

Deployment/device (not replaced by unit tests):

```sh
curl -i https://easvarafy-music.vercel.app/.well-known/assetlinks.json
adb shell pm verify-app-links --re-verify com.easvarafy.app
adb shell pm get-app-links com.easvarafy.app
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://easvarafy-music.vercel.app/playlist/REAL_PLAYLIST_ID'
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d 'https://easvarafy-music.vercel.app/profile/REAL_USER_UUID'
```

Expect HTTP 200 JSON, the actual cert hash, and domain status `verified`. Test both force-stopped and foreground APKs, consecutive different/repeated links, a currently open detail/player, private/not-found resources, guest login, and OAuth callback. Test a link tapped from WhatsApp/Chrome, not just explicit component launches. Without the APK, HTTPS continues to open the web. Some messaging apps use an embedded browser instead of sending an Android VIEW intent; users may need its “Open externally” action. Users who disabled supported links must enable Easvarafy in Android Settings → Apps → Easvarafy → Open by default. Do not promise every in-app browser will auto-open the APK.
