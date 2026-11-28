/**
 * Android App Links helpers — certificate/signing + assetlinks.json.
 *
 * App Links (https://deep links dengan autoVerify) butuh dua hal yang berpasangan:
 *  1. Intent filter `android:autoVerify="true"` di AndroidManifest.xml (dipatch ke
 *     project Android hasil `cap add/sync` oleh scripts/app-links.ts).
 *  2. `https://<host>/.well-known/assetlinks.json` yang memuat SHA-256 fingerprint
 *     dari sertifikat yang benar-benar menandatangani APK.
 *
 * Karena itu APK release HARUS ditandatangani keystore yang stabil (bukan debug
 * keystore yang berubah tiap mesin/runner). Semua logika murni (string/JSON) ada
 * di modul ini agar bisa diuji tanpa filesystem — scripts/app-links.ts yang
 * membaca env, memanggil keytool, dan menulis file.
 *
 * Referensi: https://developer.android.com/training/app-links/verify-android-applinks
 */

/** Host production default (sama dengan capacitor.config.ts DEFAULT_SERVER_URL). */
export const DEFAULT_APP_LINKS_HOST = 'easvarafy-music.vercel.app';

/** Package name APK default (sama dengan capacitor.config.ts appId). */
export const DEFAULT_APP_LINKS_PACKAGE = 'com.easvarafy.app';

/** Path yang diklaim sebagai App Links: callback OAuth + halaman share. */
export const DEFAULT_APP_LINKS_PATHS = ['/auth/callback', '/profile', '/playlist'];

/**
 * Fingerprint placeholder untuk assetlinks.json sebelum keystore release
 * disiapkan. Sengaja bukan hex valid: verifikasi akan gagal sampai
 * `npm run app-links` dijalankan dengan keystore/secrets yang benar.
 */
export const PLACEHOLDER_FINGERPRINT = 'REPLACE_WITH_RELEASE_KEY_SHA256_RUN_NPM_RUN_APP_LINKS';

/** Komentar penanda blok intent-filter App Links di AndroidManifest.xml. */
export const APP_LINKS_FILTER_MARKER = 'Android App Links: verified via /.well-known/assetlinks.json';

export type AppLinksEnv = Record<string, string | undefined>;

export type AssetlinksStatement = {
  relation: string[];
  target: {
    namespace: 'android_app';
    package_name: string;
    sha256_cert_fingerprints: string[];
  };
};

export type SigningVars = {
  /** Path absolut ke file keystore (.jks/.keystore). */
  keystorePath: string;
  storePassword: string;
  keyAlias: string;
  keyPassword: string;
};

const SHA256_RE = /^[A-Fa-f0-9]{64}$/;

/**
 * Normalisasi fingerprint: buang pemisah `:`/spasi/`-`, uppercase.
 * `AA:bb:cc…` (output keytool) dan `aabbcc…` (Play Console) sama-sama diterima.
 */
export function normalizeSha256(raw: string): string | null {
  const hex = raw.trim().replace(/[:\s-]/g, '').toUpperCase();
  return SHA256_RE.test(hex) ? hex : null;
}

/** Parse daftar fingerprint dari env (koma/spasi/titik-koma sebagai pemisah). */
export function parseSha256List(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const sha = normalizeSha256(part);
    if (sha && !out.includes(sha)) out.push(sha);
  }
  return out;
}

/**
 * Ekstrak semua SHA-256 dari output `keytool -list -v`.
 * JDK 9+ mencetak `SHA256: AA:BB:…`; helper ini juga menerima format tanpa
 * pemisah dan mengabaikan SHA1/MD5.
 */
export function parseKeytoolSha256(keytoolOutput: string): string[] {
  const out: string[] = [];
  const re = /SHA-?256\s*:?[\s]*([A-Fa-f0-9: ]{64,127})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(keytoolOutput)) !== null) {
    const sha = normalizeSha256(match[1]);
    if (sha && !out.includes(sha)) out.push(sha);
  }
  return out;
}

function hostnameFromUrl(value: string): string | null {
  let v = value.trim().replace(/\/+$/, '');
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^\/+/, '')}`;
  try {
    const url = new URL(v);
    return url.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Host lokal/preview tidak boleh diklaim (verifikasi App Links hanya berlaku
 * untuk domain publik yang benar-benar menyajikan assetlinks.json).
 */
export function isLocalHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(h) ||
    h.endsWith('.local') ||
    h.endsWith('.e2b.app')
  );
}

/**
 * Host yang diklaim sebagai App Links.
 * Urutan: EASVARAFY_APP_LINKS_HOST → NEXT_PUBLIC_APP_URL → NEXT_PUBLIC_API_BASE
 * → CAPACITOR_SERVER_URL (skip nilai "bundled"/lokal) → DEFAULT_APP_LINKS_HOST.
 */
export function appLinksHost(env: AppLinksEnv): string {
  const explicit = env.EASVARAFY_APP_LINKS_HOST?.trim();
  const candidates = explicit
    ? [explicit]
    : ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_API_BASE', 'CAPACITOR_SERVER_URL'].map(
        (key) => env[key]?.trim() ?? ''
      );
  for (const candidate of candidates) {
    if (!candidate || /^(bundled|local|none|off)$/i.test(candidate)) continue;
    const host = hostnameFromUrl(candidate);
    if (host && !isLocalHostname(host)) return host;
  }
  return DEFAULT_APP_LINKS_HOST;
}

/**
 * Path prefix yang diklaim (EASVARAFY_APP_LINKS_PATHS, dipisah koma).
 * Setiap entri harus diawali `/`. Nilai kosong/tidak valid → default.
 */
export function appLinksPaths(env: AppLinksEnv): string[] {
  const raw = env.EASVARAFY_APP_LINKS_PATHS?.trim();
  if (!raw) return [...DEFAULT_APP_LINKS_PATHS];
  const paths = [...new Set(raw.split(',').map((p) => p.trim()).filter(Boolean))];
  const valid = paths.filter((p) => p.startsWith('/') && !/\s/.test(p));
  return valid.length > 0 ? valid : [...DEFAULT_APP_LINKS_PATHS];
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Blok intent-filter App Links (indent 12 spasi, mengikuti AndroidManifest). */
export function appLinksIntentFilterXml(host: string, paths: string[]): string {
  const data = paths
    .map(
      (p) =>
        `                <data android:scheme="https" android:host="${escapeXml(host)}" android:pathPrefix="${escapeXml(p)}" />`
    )
    .join('\n');
  return [
    `            <!-- ${APP_LINKS_FILTER_MARKER} -->`,
    '            <intent-filter android:autoVerify="true">',
    '                <action android:name="android.intent.action.VIEW" />',
    '                <category android:name="android.intent.category.DEFAULT" />',
    '                <category android:name="android.intent.category.BROWSABLE" />',
    data,
    '            </intent-filter>',
  ].join('\n');
}

const APP_LINKS_BLOCK_RE = new RegExp(
  `<!-- ${APP_LINKS_FILTER_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?<intent-filter android:autoVerify="true">[\\s\\S]*?<\\/intent-filter>`
);

/**
 * Sisipkan intent-filter App Links ke AndroidManifest (sebelum `</activity>`).
 * Idempotent: blok milik kita diperbarui jika host/path berubah; blok
 * autoVerify buatan lain tidak disentuh.
 */
export function applyAppLinksIntentFilter(
  manifest: string,
  host: string,
  paths: string[]
): { text: string; changed: boolean } {
  const existing = manifest.match(APP_LINKS_BLOCK_RE);
  const filter = appLinksIntentFilterXml(host, paths);
  if (existing) {
    // Bandingkan tanpa indentasi agar stabil terhadap format manifest.
    if (existing[0].trim() === filter.trim()) return { text: manifest, changed: false };
    return { text: manifest.replace(APP_LINKS_BLOCK_RE, filter), changed: true };
  }
  // Intent-filter autoVerify milik pengguna lain: biarkan, jangan duplikat.
  if (manifest.includes('android:autoVerify="true"')) return { text: manifest, changed: false };
  const anchor = '</activity>';
  if (!manifest.includes(anchor)) return { text: manifest, changed: false };
  return { text: manifest.replace(anchor, `${filter}\n        ${anchor}`), changed: true };
}

/** assetlinks.json: satu statement, multi-fingerprint (release + Play App Signing + debug). */
export function buildAssetlinks(packageName: string, fingerprints: string[]): AssetlinksStatement[] {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints.length > 0 ? fingerprints : [PLACEHOLDER_FINGERPRINT],
      },
    },
  ];
}

/** Escape untuk string literal Groovy: backslash → `/` (gradle path), kutip → `\'`. */
export function gradleEscape(value: string): string {
  return value.replace(/\\/g, '/').replace(/'/g, "\\'");
}

/** Blok `easvarafyRelease { … }` (indent 8/12, di dalam signingConfigs). */
export function releaseSigningGradleSnippet(vars: SigningVars): string {
  return [
    '        easvarafyRelease {',
    `            storeFile file('${gradleEscape(vars.keystorePath)}')`,
    `            storePassword '${gradleEscape(vars.storePassword)}'`,
    `            keyAlias '${gradleEscape(vars.keyAlias)}'`,
    `            keyPassword '${gradleEscape(vars.keyPassword)}'`,
    '        }',
  ].join('\n');
}

/** Index `{` penutup yang cocok dengan `openIdx` (-1 bila tidak seimbang). */
function findMatchingBrace(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function braceIndexOf(text: string, headerRe: RegExp, from = 0): number | null {
  const match = headerRe.exec(text.slice(from));
  if (!match) return null;
  const openIdx = from + match.index + match[0].length - 1;
  return text[openIdx] === '{' ? openIdx : null;
}

/**
 * Injeksi signing config release ke `android/app/build.gradle` hasil template
 * Capacitor (yang TIDAK punya signingConfigs dan release-nya unsigned).
 *
 * Idempotent: jika `signingConfigs.easvarafyRelease` sudah ada, teks
 * dikembalikan tanpa perubahan.
 */
export function applyReleaseSigning(
  gradle: string,
  vars: SigningVars
): { text: string; changed: boolean; note?: string } {
  if (gradle.includes('signingConfigs.easvarafyRelease')) {
    return { text: gradle, changed: false };
  }

  const snippet = releaseSigningGradleSnippet(vars);
  let text = gradle;

  // 1) Sisipkan config keystore.
  const androidOpen = braceIndexOf(text, /(?:^|\n)(?:    )?android\s*\{/);
  if (androidOpen === null) return { text, changed: false, note: 'android { } block not found' };
  const androidClose = findMatchingBrace(text, androidOpen);
  if (androidClose < 0) return { text, changed: false, note: 'unbalanced braces in android { }' };

  const existingSigningOpen = braceIndexOf(text, /(?:^|\n)    signingConfigs\s*\{/);
  if (existingSigningOpen !== null && existingSigningOpen < androidClose) {
    const signingClose = findMatchingBrace(text, existingSigningOpen);
    if (signingClose < 0 || signingClose > androidClose) {
      return { text, changed: false, note: 'unbalanced braces in signingConfigs { }' };
    }
    let insertAt = signingClose;
    while (insertAt > 0 && /\s/.test(text[insertAt - 1])) insertAt--;
    text =
      text.slice(0, insertAt) +
      `\n\n${snippet}` +
      text.slice(insertAt);
  } else {
    // Template Capacitor 8: belum ada signingConfigs sama sekali.
    const afterOpen = androidOpen + 1;
    text =
      text.slice(0, afterOpen) +
      `\n\n    signingConfigs {\n${snippet}\n    }` +
      text.slice(afterOpen);
  }

  // 2) Pakai config di buildType release.
  const buildTypesOpen = braceIndexOf(text, /(?:^|\n)    buildTypes\s*\{/);
  if (buildTypesOpen === null) {
    return { text, changed: true, note: 'buildTypes { } not found — set signingConfig manually' };
  }
  const buildTypesClose = findMatchingBrace(text, buildTypesOpen);
  const releaseOpen = braceIndexOf(text, /(?:^|\n)(?:        )?release\s*\{/, buildTypesOpen);
  if (releaseOpen === null || releaseOpen > buildTypesClose) {
    return { text, changed: true, note: 'release buildType not found — set signingConfig manually' };
  }
  const releaseClose = findMatchingBrace(text, releaseOpen);
  const releaseBody = text.slice(releaseOpen + 1, releaseClose);
  if (/signingConfig\s+signingConfigs\.\w+/.test(releaseBody)) {
    text =
      text.slice(0, releaseOpen + 1) +
      text.slice(releaseOpen + 1, releaseClose).replace(
        /signingConfig\s+signingConfigs\.\w+/,
        'signingConfig signingConfigs.easvarafyRelease'
      ) +
      text.slice(releaseClose);
  } else {
    text =
      text.slice(0, releaseOpen + 1) +
      `\n            signingConfig signingConfigs.easvarafyRelease` +
      text.slice(releaseOpen + 1);
  }

  return { text, changed: true };
}
