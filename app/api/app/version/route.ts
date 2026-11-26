import { NextResponse } from 'next/server';
import { resolveAppVersion } from '@/lib/server/appRelease';

/**
 * GET /api/app/version
 *
 * Used by the APK (components/AppUpdateModal.tsx) to compare the installed
 * versionName / versionCode with the latest published build.
 *
 * {
 *   latestVersion: "1.1.0",
 *   latestBuild: 45,            // Android versionCode (GitHub run number)
 *   minVersion: null, minBuild: null,
 *   updateUrl: "https://easvarafy.learncode.web.id",
 *   releaseNotes: ["…"],
 *   forceUpdate: false,
 *   publishedAt: "2026-11-27T…"
 * }
 *
 * Env overrides: APP_LATEST_VERSION, APP_LATEST_BUILD, APP_MIN_VERSION,
 * APP_MIN_BUILD, APP_FORCE_UPDATE, APP_RELEASE_NOTES (lines or "a | b"),
 * APP_UPDATE_URL, APP_RELEASE_REPO, APP_RELEASE_SOURCE=off.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export async function GET() {
  const info = await resolveAppVersion({
    APP_LATEST_VERSION: process.env.APP_LATEST_VERSION,
    APP_LATEST_BUILD: process.env.APP_LATEST_BUILD,
    APP_MIN_VERSION: process.env.APP_MIN_VERSION,
    APP_MIN_BUILD: process.env.APP_MIN_BUILD,
    APP_FORCE_UPDATE: process.env.APP_FORCE_UPDATE,
    APP_RELEASE_NOTES: process.env.APP_RELEASE_NOTES,
    APP_UPDATE_URL: process.env.APP_UPDATE_URL,
    APP_RELEASE_REPO: process.env.APP_RELEASE_REPO,
    APP_RELEASE_SOURCE: process.env.APP_RELEASE_SOURCE,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    APP_RELEASE_GITHUB_TOKEN: process.env.APP_RELEASE_GITHUB_TOKEN,
  });
  return NextResponse.json(info, {
    headers: {
      ...CORS,
      'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
