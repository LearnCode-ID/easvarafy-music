#!/usr/bin/env node
/**
 * Konfigurasi Android App Links + signing (sertifikat).
 *
 * Apa yang dilakukan script ini:
 *  1. Mengumpulkan SHA-256 fingerprint sertifikat APK dari (urutan prioritas):
 *       - env EASVARAFY_ANDROID_CERT_SHA256        (mis. sertifikat Play App Signing)
 *       - env EASVARAFY_ANDROID_KEYSTORE_PATH      (keystore release, dibaca via `keytool`)
 *       - debug keystore (~/.android/debug.keystore dan android/app/debug.keystore)
 *         agar build debug lokal ikut terverifikasi.
 *  2. Menulis `public/.well-known/assetlinks.json` → disajikan domain web
 *     (Vercel) di https://<host>/.well-known/assetlinks.json. FILE INI HARUS
 *     DI-COMMIT agar deploy web membawanya.
 *  3. Bila folder `android/` ada (hasil `cap add/sync`):
 *       - menambah intent-filter https `android:autoVerify="true"` di
 *         AndroidManifest.xml untuk host + path App Links;
 *       - menyuntik signingConfigs.release ke app/build.gradle bila env keystore
 *         diisi, lalu menggunakannya untuk buildType `release`.
 *
 * Pemakaian:
 *   npm run app-links                       # generate + patch android/ (jika ada)
 *   npm run app-links -- --check            # bandingkan hasil vs file yang di-commit (exit 1 bila beda)
 *   npm run app-links -- --print-fingerprints
 *
 * Env (lihat .env.example & docs/APP_LINKS.md):
 *   EASVARAFY_APP_LINKS_HOST, EASVARAFY_APP_LINKS_PATHS, EASVARAFY_APP_PACKAGE,
 *   EASVARAFY_ANDROID_CERT_SHA256, EASVARAFY_ANDROID_DEBUG_CERT_SHA256,
 *   EASVARAFY_ANDROID_KEYSTORE_PATH, EASVARAFY_ANDROID_KEYSTORE_PASSWORD,
 *   EASVARAFY_ANDROID_KEY_ALIAS, EASVARAFY_ANDROID_KEY_PASSWORD
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_APP_LINKS_PACKAGE,
  applyAppLinksIntentFilter,
  applyReleaseSigning,
  appLinksHost,
  appLinksPaths,
  buildAssetlinks,
  parseKeytoolSha256,
  parseSha256List,
  type SigningVars,
} from '../lib/app/app-links';

const root = process.cwd();
const env = process.env as NodeJS.ProcessEnv & Record<string, string | undefined>;

function warn(message: string): void {
  console.warn(`! ${message}`);
}

function ok(message: string): void {
  console.log(`✓ ${message}`);
}

/** Baca fingerprint SHA-256 dari satu keystore via `keytool -list -v`. */
function keystoreFingerprints(
  keystorePath: string,
  storePassword: string,
  alias?: string
): { fingerprints: string[]; error?: string } {
  const args = ['-list', '-v', '-keystore', keystorePath, '-storepass', storePassword];
  if (alias) args.push('-alias', alias);
  const result = spawnSync('keytool', args, { encoding: 'utf8' });
  if (result.error) {
    return { fingerprints: [], error: `keytool tidak bisa dijalankan (${result.error.message})` };
  }
  if (result.status !== 0) {
    const firstLine = (result.stderr || result.stdout || 'keytool gagal').split('\n')[0];
    return { fingerprints: [], error: `keytool gagal: ${firstLine}` };
  }
  const fingerprints = parseKeytoolSha256(result.stdout ?? '');
  return fingerprints.length > 0
    ? { fingerprints }
    : { fingerprints: [], error: 'SHA256 tidak ditemukan di output keytool' };
}

function signingVarsFromEnv(): SigningVars | null {
  const keystorePath = env.EASVARAFY_ANDROID_KEYSTORE_PATH?.trim();
  const storePassword = env.EASVARAFY_ANDROID_KEYSTORE_PASSWORD?.trim();
  const keyAlias = env.EASVARAFY_ANDROID_KEY_ALIAS?.trim();
  const keyPassword = env.EASVARAFY_ANDROID_KEY_PASSWORD?.trim() || storePassword;
  if (!keystorePath || !storePassword || !keyAlias || !keyPassword) return null;
  if (!existsSync(keystorePath)) {
    warn(`Keystore tidak ditemukan: ${keystorePath}`);
    return null;
  }
  return { keystorePath: path.resolve(keystorePath), storePassword, keyAlias, keyPassword };
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const printOnly = args.includes('--print-fingerprints') || args.includes('--print');

const host = appLinksHost(env);
const paths = appLinksPaths(env);
const packageName = env.EASVARAFY_APP_PACKAGE?.trim() || DEFAULT_APP_LINKS_PACKAGE;

// 1) Kumpulkan fingerprint (release dulu, debug terakhir).
const fingerprints: string[] = [];

const envCerts = parseSha256List(env.EASVARAFY_ANDROID_CERT_SHA256);
const debugCerts = parseSha256List(env.EASVARAFY_ANDROID_DEBUG_CERT_SHA256);
const releaseKeystore = signingVarsFromEnv();

for (const cert of envCerts) if (!fingerprints.includes(cert)) fingerprints.push(cert);

if (releaseKeystore) {
  const { fingerprints: found, error } = keystoreFingerprints(
    releaseKeystore.keystorePath,
    releaseKeystore.storePassword,
    releaseKeystore.keyAlias
  );
  if (error) warn(`${error} (${releaseKeystore.keystorePath})`);
  for (const cert of found) if (!fingerprints.includes(cert)) fingerprints.push(cert);
} else if (envCerts.length === 0) {
  warn(
    'Belum ada keystore release (EASVARAFY_ANDROID_KEYSTORE_PATH) atau ' +
      'EASVARAFY_ANDROID_CERT_SHA256 — assetlinks.json akan berisi placeholder.'
  );
}

for (const debugKeystore of [
  path.join(homedir(), '.android', 'debug.keystore'),
  path.join(root, 'android', 'app', 'debug.keystore'),
]) {
  if (!existsSync(debugKeystore)) continue;
  const { fingerprints: found, error } = keystoreFingerprints(debugKeystore, 'android', 'androiddebugkey');
  if (error) {
    warn(`${error} (${debugKeystore}) — build debug mungkin tidak terverifikasi sebagai App Links`);
    continue;
  }
  for (const cert of found) if (!fingerprints.includes(cert)) fingerprints.push(cert);
}

if (printOnly) {
  console.log(`Host App Links: https://${host}`);
  console.log(`Package: ${packageName}`);
  for (const cert of fingerprints) console.log(`SHA256 ${cert}`);
  if (fingerprints.length === 0) console.log('(tidak ada fingerprint — set env keystore/CERT_SHA256)');
  process.exit(0);
}

// 2) Tulis public/.well-known/assetlinks.json.
const assetlinksPath = path.join(root, 'public', '.well-known', 'assetlinks.json');
const json = `${JSON.stringify(buildAssetlinks(packageName, fingerprints), null, 2)}\n`;

if (checkOnly) {
  const committed = existsSync(assetlinksPath) ? readFileSync(assetlinksPath, 'utf8') : '';
  if (committed === json) {
    ok(`assetlinks.json sudah sesuai (host ${host}, ${fingerprints.length} fingerprint)`);
  } else {
    console.error(
      `✗ public/.well-known/assetlinks.json tidak sesuai.\n` +
        `  Diharapkan (host ${host}):\n${json}\n  Ter-commit:\n${committed}`
    );
    process.exit(1);
  }
} else {
  mkdirSync(path.dirname(assetlinksPath), { recursive: true });
  writeFileSync(assetlinksPath, json, 'utf8');
  ok(
    `Menulis public/.well-known/assetlinks.json (host ${host}, ${fingerprints.length} fingerprint)` +
      (fingerprints.length === 0 ? ' — PLACEHOLDER, isi keystore lalu jalankan ulang!' : '')
  );
}

// 3) Patch project Android hasil cap add/sync (jika ada).
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (existsSync(manifestPath)) {
  const manifest = readFileSync(manifestPath, 'utf8');
  const { text, changed } = applyAppLinksIntentFilter(manifest, host, paths);
  if (changed) {
    writeFileSync(manifestPath, text, 'utf8');
    ok(`Intent-filter App Links (${paths.join(', ')}) ditambahkan ke AndroidManifest.xml`);
  } else {
    console.log(`· Intent-filter App Links sudah ada di AndroidManifest.xml`);
  }
} else {
  console.log('· Folder android/ belum ada — intent-filter akan ditambahkan setelah `npx cap add android`');
}

const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
if (existsSync(gradlePath)) {
  const signing = signingVarsFromEnv();
  if (signing) {
    const { text, changed, note } = applyReleaseSigning(readFileSync(gradlePath, 'utf8'), signing);
    if (changed) {
      writeFileSync(gradlePath, text, 'utf8');
      ok(`signingConfigs.easvarafyRelease (${signing.keyAlias}) diaktifkan untuk buildType release`);
    } else {
      console.log('· signingConfigs.easvarafyRelease sudah ada di app/build.gradle');
    }
    if (note) warn(note);
  } else {
    warn(
      'Env keystore release tidak lengkap — build release akan PAKAI SIGNING DEBUG DEFAULT ' +
        '(fingerprint App Links tidak akan cocok). Set EASVARAFY_ANDROID_KEYSTORE_PATH/' +
        'EASVARAFY_ANDROID_KEYSTORE_PASSWORD/EASVARAFY_ANDROID_KEY_ALIAS.'
    );
  }
}

if (!checkOnly) {
  console.log(
    `\nVerifikasi setelah deploy web: curl https://${host}/.well-known/assetlinks.json\n` +
      'Docs lengkap: docs/APP_LINKS.md'
  );
}
