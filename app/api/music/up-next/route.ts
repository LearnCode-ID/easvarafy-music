import { NextRequest, NextResponse } from "next/server";
import { corsOptionsResponse } from "@/lib/server/cors";
import {
  getYTMusicClient,
  normalizeHomeSections,
  normalizeSong,
} from "@/lib/server/ytmusic";
import { cleanTrack, type Candidate } from "@/lib/recommendation/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function OPTIONS() {
  return corsOptionsResponse();
}

/** Public catalogue only: no user history or user identifiers enter this route.
 * Provider order is evidence, not invented audio similarity. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const videoId = params.get("videoId") || "";
  const artistId = params.get("artistId") || "";
  const gl = (params.get("gl") || "ID").toUpperCase();
  const strict = params.get("strict") === "true";
  if (
    (videoId && !/^[\w-]{1,128}$/.test(videoId)) ||
    !/^[A-Z]{2}$/.test(gl) ||
    (artistId && !/^[\w-]{1,128}$/.test(artistId))
  ) {
    return NextResponse.json({ tracks: [], candidates: [] }, { status: 400 });
  }
  try {
    const yt = await getYTMusicClient({
      gl,
      hl: "en",
      cookies: req.headers.get("x-yt-cookie") || undefined,
    });
    const candidates: Candidate[] = [];
    let failures = 0;
    if (videoId && params.get("mode") !== "discover") {
      try {
        (await yt.getUpNexts(videoId))
          .slice(0, 50)
          .forEach((s, order) =>
            candidates.push({
              track: normalizeSong(s),
              source: "related",
              order,
            })
          );
      } catch {
        failures++;
      }
    }
    // Artist endpoint is a genuine provider relationship, not a text/genre guess.
    if (
      !strict &&
      (candidates.length < 18 || params.get("expand") === "true") &&
      artistId
    ) {
      try {
        (await yt.getArtistSongs(artistId))
          .slice(0, 30)
          .forEach((s, order) =>
            candidates.push({
              track: normalizeSong(s),
              source: "artist",
              order,
            })
          );
      } catch {
        failures++;
      }
    }
    if (
      !strict &&
      (candidates.length < 18 || params.get("expand") === "true")
    ) {
      try {
        for (const shelf of normalizeHomeSections(await yt.getHomeSections())) {
          for (const item of shelf.items)
            if (item.kind === "TRACK")
              candidates.push({
                track: item,
                source: "catalog",
                order: candidates.length,
              });
        }
      } catch {
        failures++;
      }
    }
    const seen = new Set<string>([videoId]);
    const valid = candidates
      .filter((c) => {
        const t = cleanTrack(c.track);
        if (!t || seen.has(t.videoId)) return false;
        c.track = t;
        seen.add(t.videoId);
        return true;
      })
      .slice(0, 70);
    return NextResponse.json(
      {
        tracks: valid.map((c) => c.track),
        candidates: valid,
        degraded: failures > 0,
      },
      { status: !valid.length && failures ? 502 : 200 }
    );
  } catch {
    return NextResponse.json(
      { tracks: [], candidates: [], degraded: true },
      { status: 502 }
    );
  }
}
