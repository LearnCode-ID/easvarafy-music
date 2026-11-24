import { NextResponse } from 'next/server';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-yt-cookie',
};

export function corsOptionsResponse() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
