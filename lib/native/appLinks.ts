import config from '../../config/android-app-links.json';

/** Only canonical HTTPS content URLs can drive native navigation, never auth or arbitrary URLs. */
export function nativeAppLinkPath(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== config.host || url.port || url.username || url.password) return null;
    const match = /^\/(playlist|profile)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;
    const [, kind, id] = match;
    const valid = kind === 'profile'
      ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      : /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(id);
    // Use the APK's static-compatible routes for remote AND bundled modes.
    return valid ? `/${kind}/?id=${encodeURIComponent(id)}` : null;
  } catch {
    return null;
  }
}

export function androidAssetLinks(fingerprints: string | undefined) {
  const hashes = [...new Set((fingerprints || '').split(/[\s,]+/).filter(Boolean).map(value => value.toUpperCase()))];
  if (hashes.some(value => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value))) {
    throw new Error('ANDROID_APP_LINKS_SHA256_FINGERPRINTS must contain colon-separated SHA-256 certificate fingerprints.');
  }
  // Fail closed: no invented certificate or trust in arbitrary APKs.
  return hashes.length ? [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: config.packageName,
      sha256_cert_fingerprints: hashes,
    },
  }] : [];
}

interface NativeLinksApp {
  addListener(event: 'appUrlOpen', handler: (event: { url: string }) => void): Promise<{ remove(): Promise<void> }>;
  getLaunchUrl(): Promise<{ url: string } | undefined>;
}

/** Subscribe before reading launch URL; never replay a stale cold link over a newer intent. */
export function listenForAppLinks(
  appPromise: Promise<NativeLinksApp>,
  navigate: (path: string) => void,
  report: (error: unknown) => void,
): () => void {
  let disposed = false;
  let remove: (() => Promise<void>) | undefined;
  let receivedLiveLink = false;
  const deliver = (url: string) => {
    const path = nativeAppLinkPath(url);
    if (disposed || !path) return false;
    navigate(path);
    return true;
  };
  void (async () => {
    try {
      const app = await appPromise;
      if (disposed) return;
      const listener = await app.addListener('appUrlOpen', event => {
        if (deliver(event.url)) receivedLiveLink = true;
      });
      if (disposed) { await listener.remove(); return; }
      remove = () => listener.remove();
      const launch = await app.getLaunchUrl();
      if (!receivedLiveLink && launch?.url) deliver(launch.url);
    } catch (error) {
      if (!disposed) report(error);
    }
  })();
  return () => { disposed = true; void remove?.().catch(report); };
}
