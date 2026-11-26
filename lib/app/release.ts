/**
 * Default release metadata for /api/app/version.
 *
 * The version name comes from package.json (the APK's versionName is set from
 * the same field in .github/workflows/build-apk.yml), so bumping
 * package.json "version" + deploying the web app is what makes installed APKs
 * show the "Update tersedia" popup. Every value can be overridden at runtime
 * with environment variables (see app/api/app/version/route.ts).
 */
import pkg from '../../package.json';

export const APP_PACKAGE_VERSION: string = (pkg as { version?: string }).version ?? '1.0.0';

/** Short changelog shown in the in-app update popup (Bahasa Indonesia). */
export const DEFAULT_RELEASE_NOTES: string[] = [
  'Popup pembaruan langsung di dalam aplikasi',
  'Notifikasi pengumuman & rilis baru dari tim Easvarafy (ikon lonceng)',
  'Notifikasi "Easvarafy has been updated" setelah aplikasi diperbarui',
  'Download lagu & putar offline',
];
