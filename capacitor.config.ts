import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The APK loads the live web app from the production server, so every UI /
 * feature update deployed to the web shows up in the APK immediately — no new
 * .apk download needed. Change the host (e.g. a custom domain) with
 * CAPACITOR_SERVER_URL at `npx cap sync` time.
 *
 * Offline safety net (see native/android/java/.../OfflineWebViewClient.java):
 * the Next.js static export (`out/`) is still bundled into the APK. Without a
 * connection the app is served from that bundled copy (Library + downloaded
 * songs keep working), and a native retry screen replaces Chrome's
 * net::ERR_INTERNET_DISCONNECTED page.
 *
 * Set CAPACITOR_SERVER_URL=bundled to build a fully local APK (old behaviour).
 */
const DEFAULT_SERVER_URL = 'https://easvarafy-music.vercel.app';
const rawServerUrl = (process.env.CAPACITOR_SERVER_URL || DEFAULT_SERVER_URL).trim();
const useBundledOnly = /^(bundled|local|none|off)$/i.test(rawServerUrl);
const serverUrl = rawServerUrl.replace(/\/+$/, '');

if (!useBundledOnly && !/^https:\/\//i.test(serverUrl)) {
  throw new Error(`CAPACITOR_SERVER_URL must be an https:// URL (got "${rawServerUrl}")`);
}

const config: CapacitorConfig = {
  appId: 'com.easvarafy.app',
  appName: 'Easvarafy',
  webDir: 'out',
  server: useBundledOnly
    ? { androidScheme: 'https' }
    : {
        url: serverUrl,
        cleartext: false,
        androidScheme: 'https',
      },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Google OAuth is opened in the system browser sheet; Supabase then
    // redirects to com.easvarafy.app://auth/callback which is captured by
    // @capacitor/app (see lib/auth/native.ts).
    Browser: {
      presentationStyle: 'popover',
    },
  },
};

export default config;
