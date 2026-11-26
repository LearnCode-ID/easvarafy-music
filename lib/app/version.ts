/**
 * Pure helpers for the in-app update check (no React / Capacitor imports so
 * they can be unit-tested with node:test and used by the API route).
 */

export const APP_UPDATE_URL = 'https://easvarafy.learncode.web.id';

export interface AppVersionInfo {
  /** Latest published version name, e.g. "1.2.0". */
  latestVersion: string;
  /** Latest published build number (Android versionCode), null when unknown. */
  latestBuild: number | null;
  /** Oldest version that may keep running without updating (optional). */
  minVersion: string | null;
  /** Oldest build that may keep running without updating (optional). */
  minBuild: number | null;
  updateUrl: string;
  releaseNotes: string[];
  /** Update is mandatory for every installed version older than latest. */
  forceUpdate: boolean;
  publishedAt: string | null;
}

export interface InstalledAppInfo {
  version: string;
  build: number | null;
}

export type UpdateStatus =
  | { kind: 'up-to-date' }
  | { kind: 'available'; force: boolean };

/** Splits "1.2.3", "v1.2.3", "1.2.3-beta+45" into numeric parts. */
export function parseVersion(input: string | null | undefined): number[] {
  if (!input) return [];
  const core = String(input).trim().replace(/^v/i, '').split(/[-+\s]/)[0];
  if (!core) return [];
  return core.split('.').map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  });
}

/** -1 when a < b, 0 when equal, 1 when a > b (missing parts count as 0). */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export function toBuildNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** True when `installed` is strictly older than (version, build). */
function isOlder(
  installed: InstalledAppInfo,
  version: string | null | undefined,
  build: number | null | undefined
): boolean {
  if (version) {
    const cmp = compareVersions(installed.version, version);
    if (cmp < 0) return true;
    if (cmp > 0) return false;
  }
  // Same version name (or none given): fall back to the build number.
  if (build && installed.build) return installed.build < build;
  return false;
}

/**
 * Decides whether the installed APK should be offered an update.
 * - newer version name, or same name with a higher build -> available
 * - force when the server says so, or the install is below minVersion/minBuild
 */
export function evaluateUpdate(installed: InstalledAppInfo, latest: AppVersionInfo): UpdateStatus {
  const available = isOlder(installed, latest.latestVersion, latest.latestBuild);
  if (!available) return { kind: 'up-to-date' };
  const belowMinimum =
    (latest.minVersion || latest.minBuild) &&
    isOlder(installed, latest.minVersion, latest.minBuild);
  return { kind: 'available', force: Boolean(latest.forceUpdate || belowMinimum) };
}

/** Normalises release notes from an array, a multi-line string or "a | b". */
export function normalizeReleaseNotes(input: unknown): string[] {
  const items: string[] = Array.isArray(input)
    ? input.map((x) => String(x ?? ''))
    : typeof input === 'string'
      ? input.split(/\r?\n|\s\|\s|\\n/)
      : [];
  return items
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 12);
}

/** Safely coerces an unknown JSON payload from /api/app/version. */
export function parseVersionPayload(input: unknown): AppVersionInfo | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const latestVersion = typeof o.latestVersion === 'string' ? o.latestVersion.trim() : '';
  if (!latestVersion || parseVersion(latestVersion).length === 0) return null;
  const updateUrl =
    typeof o.updateUrl === 'string' && /^https:\/\//i.test(o.updateUrl) ? o.updateUrl : APP_UPDATE_URL;
  return {
    latestVersion,
    latestBuild: toBuildNumber(o.latestBuild),
    minVersion: typeof o.minVersion === 'string' && o.minVersion.trim() ? o.minVersion.trim() : null,
    minBuild: toBuildNumber(o.minBuild),
    updateUrl,
    releaseNotes: normalizeReleaseNotes(o.releaseNotes),
    forceUpdate: o.forceUpdate === true || o.forceUpdate === 'true',
    publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt : null,
  };
}

/** "1.2.0 (45)" */
export function formatVersionLabel(version: string | null | undefined, build?: number | null): string {
  const v = version ? String(version).replace(/^v/i, '') : '—';
  return build ? `${v} (${build})` : v;
}
