/** Server-only HTTPS fetch pinned to a validated public DNS answer; redirects are refused.
 * Used ONLY with operator-configured source candidates, never a URL from the request.
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { Readable } from 'node:stream';

const denied = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8],
  ['169.254.0.0',16], ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24],
  ['192.168.0.0',16], ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',3],
] as const) denied.addSubnet(ip, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
denied.addSubnet('2001::', 23, 'ipv6');
denied.addSubnet('2001:db8::', 32, 'ipv6');
denied.addSubnet('2002::', 16, 'ipv6');
export function isPublicDownloadAddress(address: string) {
  const family = isIP(address);
  return family === 4 ? !denied.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}
export const downloadFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Invalid audio source');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(a => !isPublicDownloadAddress(a.address))) throw new Error('Non-public audio source');
  const pinned = addresses[0];
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init?.headers);
    headers.set('Accept-Encoding', 'identity');
    const req = request(url, {
      method: init?.method || 'GET', headers: Object.fromEntries(headers),
      signal: init?.signal ?? AbortSignal.timeout(55_000),
      family: pinned.family,
      lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
    }, res => {
      const status = res.statusCode || 502;
      if (status >= 300 && status < 400) { res.destroy(); reject(new Error('Audio redirects not allowed; configure the final HTTPS URL')); return; }
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(', ') : value);
      if (init?.method === 'HEAD' || status === 204 || status === 304) {
        res.resume(); resolve(new Response(null, { status, headers: responseHeaders }));
      } else {
        resolve(new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers: responseHeaders }));
      }
    });
    req.on('error', reject);
    req.setTimeout(30_000, () => req.destroy(new Error('Audio source timeout')));
    req.end();
  });
};
