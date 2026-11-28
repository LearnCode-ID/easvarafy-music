import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

const cert = new X509Certificate(readFileSync(process.argv[2]));
const fingerprints = (process.env.ANDROID_APP_LINKS_SHA256_FINGERPRINTS || '').toUpperCase().split(/[\s,]+/).filter(Boolean);
if (!fingerprints.length || fingerprints.some(value => !/^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value)) || !fingerprints.includes(cert.fingerprint256)) {
  throw new Error(`Signing certificate does not match ANDROID_APP_LINKS_SHA256_FINGERPRINTS. Certificate SHA-256: ${cert.fingerprint256}`);
}
console.log(`Verified APK signing certificate SHA-256: ${cert.fingerprint256}`);
