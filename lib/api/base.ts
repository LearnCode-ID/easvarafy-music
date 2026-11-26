/**
 * The music catalog (songs, banners, covers, lyrics) keeps using the exact same
 * `/api/music/*` routes as before. The only difference is that the Android APK
 * build is a static export and has no server, so in that build the calls are
 * pointed at the deployed web build via NEXT_PUBLIC_API_BASE (or the native
 * Capacitor runtime fallback).
 *
 * Nothing about the data source changed — no scraping, no new music service.
 */
const DEFAULT_NATIVE_API_BASE = 'https://easvarafy-music.vercel.app';
const ENV_API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? '').replace(/\/+$/, '');

function resolveApiBase(): string {
  if (ENV_API_BASE) return ENV_API_BASE;
  if (typeof window !== 'undefined') {
    const cap = (window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    }).Capacitor;
    const isNative = Boolean(cap?.isNativePlatform?.());
    const isCapacitorLocalhost =
      window.location.hostname === 'localhost' && window.location.port === '';
    // APK loading the live site (capacitor server.url): the API is same-origin.
    if (isNative && !isCapacitorLocalhost && window.location.protocol === 'https:') {
      return '';
    }
    if (isNative || isCapacitorLocalhost) {
      return DEFAULT_NATIVE_API_BASE;
    }
  }
  return '';
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  const base = resolveApiBase();
  if (!base) return path;
  return `${base}${path}`;
}
