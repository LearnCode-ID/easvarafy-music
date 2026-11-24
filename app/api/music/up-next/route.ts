import { NextRequest, NextResponse } from 'next/server';
import { SEED_TRACKS } from '@/lib/metrolist/seed';
import type { Track } from '@/lib/metrolist/types';
import { corsOptionsResponse } from '@/lib/server/cors';
import {
  getYTMusicClient,
  normalizeHomeSections,
  normalizeSong,
} from '@/lib/server/ytmusic';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function OPTIONS() {
  return corsOptionsResponse();
}

type UpNextMode = 'mixed' | 'related' | 'discover';

const DISCOVERY_QUERIES_ID = [
  'top hits indonesia terbaru',
  'pop indonesia viral',
  'indie indonesia chill',
  'global top hits 2025',
  'r&b soul chill hits',
  'acoustic pop favorites',
];

const DISCOVERY_QUERIES_GLOBAL = [
  'global top hits 2025',
  'indie pop chill hits',
  'r&b soul favorites',
  'electronic dance pop hits',
  'feel good pop classics',
  'lofi acoustic grooves',
];

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dedupeTracks(tracks: Track[], excludeVideoId: string): Track[] {
  const seen = new Set<string>([excludeVideoId]);
  const out: Track[] = [];
  for (const t of tracks) {
    if (!t?.videoId || seen.has(t.videoId)) continue;
    seen.add(t.videoId);
    out.push(t);
  }
  return out;
}

/**
 * Interleaves related songs with diverse discovery/trending tracks
 * so Up Next isn't dominated solely by similar/related songs.
 */
function buildMixedUpNext(
  related: Track[],
  discovery: Track[],
  excludeVideoId: string,
  limit = 24
): Track[] {
  const cleanRelated = dedupeTracks(related, excludeVideoId);
  const relatedIds = new Set(cleanRelated.map((t) => t.videoId));
  const cleanDiscovery = shuffleArray(
    dedupeTracks(discovery, excludeVideoId).filter((t) => !relatedIds.has(t.videoId))
  );

  const mixed: Track[] = [];
  let rIdx = 0;
  let dIdx = 0;

  while (mixed.length < limit && (rIdx < cleanRelated.length || dIdx < cleanDiscovery.length)) {
    if (rIdx < cleanRelated.length) {
      mixed.push(cleanRelated[rIdx++]);
    }
    // Add 2 discovery/cross-genre tracks for every 1 related track
    for (let step = 0; step < 2 && dIdx < cleanDiscovery.length && mixed.length < limit; step++) {
      mixed.push(cleanDiscovery[dIdx++]);
    }
  }

  return mixed.slice(0, limit);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const videoId = (searchParams.get('videoId') || '').trim();
  const gl = searchParams.get('gl') || 'ID';
  const rawMode = (searchParams.get('mode') || 'mixed').toLowerCase();
  const mode: UpNextMode =
    rawMode === 'related' || rawMode === 'discover' ? rawMode : 'mixed';
  const cookie = req.headers.get('x-yt-cookie') || undefined;

  if (!videoId) {
    return NextResponse.json({ tracks: [] }, { status: 400 });
  }

  try {
    const yt = await getYTMusicClient({ gl, hl: 'en', cookies: cookie });

    const queryPool = gl === 'ID' ? DISCOVERY_QUERIES_ID : DISCOVERY_QUERIES_GLOBAL;
    const randomQuery = queryPool[Math.floor(Math.random() * queryPool.length)];

    const [relatedRes, homeRes, discoverSearchRes] = await Promise.allSettled([
      mode === 'discover' ? Promise.resolve([]) : yt.getUpNexts(videoId),
      mode === 'related' ? Promise.resolve([]) : yt.getHomeSections(),
      mode === 'related' ? Promise.resolve([]) : yt.searchSongs(randomQuery),
    ]);

    const relatedTracks: Track[] =
      relatedRes.status === 'fulfilled'
        ? relatedRes.value.map(normalizeSong)
        : [];

    const homeShelfTracks: Track[] = [];
    if (homeRes.status === 'fulfilled' && Array.isArray(homeRes.value)) {
      const shelves = normalizeHomeSections(homeRes.value);
      for (const shelf of shelves) {
        for (const item of shelf.items) {
          if (item.kind === 'TRACK') {
            homeShelfTracks.push(item);
          }
        }
      }
    }

    const searchDiscoveryTracks: Track[] =
      discoverSearchRes.status === 'fulfilled'
        ? discoverSearchRes.value.slice(0, 18).map(normalizeSong)
        : [];

    const discoveryPool = dedupeTracks(
      [...searchDiscoveryTracks, ...homeShelfTracks, ...SEED_TRACKS],
      videoId
    );

    if (mode === 'related') {
      const cleanRelated = dedupeTracks(relatedTracks, videoId);
      const tracks =
        cleanRelated.length > 0 ? cleanRelated : shuffleArray(discoveryPool).slice(0, 20);
      return NextResponse.json({ tracks, mode });
    }

    if (mode === 'discover') {
      const tracks = shuffleArray(discoveryPool).slice(0, 24);
      return NextResponse.json({ tracks, mode });
    }

    const tracks = buildMixedUpNext(relatedTracks, discoveryPool, videoId, 24);
    return NextResponse.json({ tracks, mode });
  } catch (error) {
    console.error('UpNext API error:', error);
    return NextResponse.json({
      tracks: shuffleArray(SEED_TRACKS.filter((t) => t.videoId !== videoId)),
      mode,
    });
  }
}
