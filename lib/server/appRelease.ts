import { APP_PACKAGE_VERSION, DEFAULT_RELEASE_NOTES } from '@/lib/app/release';
import {
  APP_UPDATE_URL,
  normalizeReleaseNotes,
  parseVersion,
  toBuildNumber,
  type AppVersionInfo,
} from '@/lib/app/version';

/** Release tags created by .github/workflows/build-apk.yml: v1.2.0-build.45 */
export function parseReleaseTag(tag: string | null | undefined): { version: string; build: number | null } | null {
  if (!tag) return null;
  const m = /^v?(\d+(?:\.\d+){0,3})(?:-build\.(\d+))?$/i.exec(tag.trim());
  if (!m) return null;
  return { version: m[1], build: toBuildNumber(m[2]) };
}

interface GithubRelease {
  tag: string;
  publishedAt: string | null;
}

async function fetchLatestGithubRelease(env: Record<string, string | undefined>): Promise<GithubRelease | null> {
  if (env.APP_RELEASE_SOURCE === 'off') return null;
  const repo = env.APP_RELEASE_REPO || 'LearnCode-ID/easvarafy-music';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'easvarafy-version-check',
  };
  const token = env.GITHUB_TOKEN || env.APP_RELEASE_GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers,
      signal: AbortSignal.timeout(4000),
      // Cached on the server for 5 minutes (GitHub's unauthenticated limit is 60/h).
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: string; published_at?: string };
    if (!body.tag_name) return null;
    return { tag: body.tag_name, publishedAt: body.published_at ?? null };
  } catch {
    return null;
  }
}

/**
 * Latest app version, resolved in this order:
 *  1. APP_LATEST_VERSION / APP_LATEST_BUILD env (manual control)
 *  2. the latest GitHub Release published by the APK workflow
 *  3. package.json "version"
 */
export async function resolveAppVersion(
  env: Record<string, string | undefined>
): Promise<AppVersionInfo> {
  const release = env.APP_LATEST_VERSION ? null : await fetchLatestGithubRelease(env);
  const fromTag = parseReleaseTag(release?.tag);

  const latestVersion =
    (env.APP_LATEST_VERSION && parseVersion(env.APP_LATEST_VERSION).length > 0
      ? env.APP_LATEST_VERSION.replace(/^v/i, '')
      : null) ??
    fromTag?.version ??
    APP_PACKAGE_VERSION;
  const latestBuild = toBuildNumber(env.APP_LATEST_BUILD) ?? fromTag?.build ?? null;
  const notesFromEnv = normalizeReleaseNotes(env.APP_RELEASE_NOTES);

  return {
    latestVersion,
    latestBuild,
    minVersion: env.APP_MIN_VERSION ? env.APP_MIN_VERSION.replace(/^v/i, '') : null,
    minBuild: toBuildNumber(env.APP_MIN_BUILD),
    updateUrl:
      env.APP_UPDATE_URL && /^https:\/\//i.test(env.APP_UPDATE_URL) ? env.APP_UPDATE_URL : APP_UPDATE_URL,
    releaseNotes: notesFromEnv.length > 0 ? notesFromEnv : DEFAULT_RELEASE_NOTES,
    forceUpdate: /^(1|true|yes)$/i.test(env.APP_FORCE_UPDATE ?? ''),
    publishedAt: release?.publishedAt ?? null,
  };
}
