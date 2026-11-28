import { androidAssetLinks } from '@/lib/native/appLinks';

// Also emitted at this exact path by the Capacitor static export.
export const dynamic = 'force-static';
export function GET() {
  return Response.json(androidAssetLinks(process.env.ANDROID_APP_LINKS_SHA256_FINGERPRINTS), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
