import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APP_LINKS_HOST,
  DEFAULT_APP_LINKS_PACKAGE,
  DEFAULT_APP_LINKS_PATHS,
  PLACEHOLDER_FINGERPRINT,
  appLinksHost,
  appLinksIntentFilterXml,
  appLinksPaths,
  applyAppLinksIntentFilter,
  applyReleaseSigning,
  buildAssetlinks,
  gradleEscape,
  isLocalHostname,
  normalizeSha256,
  parseKeytoolSha256,
  parseSha256List,
  releaseSigningGradleSnippet,
  type SigningVars,
} from './app-links';

const FP_A = 'AA'.repeat(31) + 'AB'; // 32 byte berbeda di akhir
const FP_B = 'BB'.repeat(31) + 'BC';
const FP_LOWER = FP_A.toLowerCase();
const FP_COLONS = (FP_B.match(/.{2}/g) as string[]).join(':');

const signingVars: SigningVars = {
  keystorePath: '/absolute/path/easvarafy-release.keystore',
  storePassword: 's3cret',
  keyAlias: "easvarafy's key",
  keyPassword: 's3cret2',
};

// Template app/build.gradle Capacitor 8 (tidak punya signingConfigs / debug keystore).
const CAP_8_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace = "com.easvarafy.app"
    compileSdk = rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.easvarafy.app"
        versionCode 1
        versionName "1.0"
    }
    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
}
`;

// Bentuk template lama (Capacitor ≤5): signingConfigs.debug sudah ada.
const LEGACY_GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

const KEYTOOL_OUTPUT = `Keystore type: PKCS12
Keystore provider: SUN

Your keystore contains 1 entry

Alias name: easvarafy
Creation date: 28 Nov 2026
Entry type: PrivateKeyEntry
Certificate chain length: 1
Certificate[1]:
Owner: CN=Easvarafy, OU=Mobile, O=LearnCode, C=ID
Issuer: CN=Easvarafy, OU=Mobile, O=LearnCode, C=ID
Serial number: 1a2b
Valid from: Sat Nov 28 00:00:00 WIB 2026 until: Wed Nov 28 00:00:00 WIB 2051
Certificate fingerprints:
         SHA1: 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44
         SHA256: ${FP_COLONS}
Signature algorithm name: SHA256withRSA
Subject Public Key Algorithm: 3072-Bit RSA key
`;

test('normalizeSha256 strips separators and uppercases', () => {
  assert.equal(normalizeSha256(FP_COLONS), FP_B);
  assert.equal(normalizeSha256(FP_LOWER), FP_A);
  assert.equal(normalizeSha256(` ${FP_A} `), FP_A);
  assert.equal(normalizeSha256('not-a-fingerprint'), null);
  assert.equal(normalizeSha256(FP_A.slice(1)), null); // 63 karakter
  assert.equal(normalizeSha256(''), null);
});

test('parseSha256List dedupes and skips invalid entries', () => {
  assert.deepEqual(parseSha256List(`${FP_COLONS}, ${FP_LOWER} ;garbage  ${FP_B}`), [FP_B, FP_A]);
  assert.deepEqual(parseSha256List(undefined), []);
  assert.deepEqual(parseSha256List('   '), []);
});

test('parseKeytoolSha256 extracts SHA256 (not SHA1) from keytool -list -v', () => {
  assert.deepEqual(parseKeytoolSha256(KEYTOOL_OUTPUT), [FP_B]);
  assert.deepEqual(parseKeytoolSha256('no fingerprints here'), []);
  assert.deepEqual(parseKeytoolSha256(`SHA256: ${FP_A}`), [FP_A]);
});

test('isLocalHostname rejects hosts that must not be claimed', () => {
  for (const host of ['localhost', '127.0.0.1', '10.0.0.1', 'machine.local', 'sb.e2b.app', '0.0.0.0', '::1']) {
    assert.equal(isLocalHostname(host), true, host);
  }
  for (const host of [DEFAULT_APP_LINKS_HOST, 'music.example.com', 'app.mydomain.id']) {
    assert.equal(isLocalHostname(host), false, host);
  }
});

test('appLinksHost: explicit env wins, URL fields are parsed, local values skipped', () => {
  assert.equal(
    appLinksHost({ EASVARAFY_APP_LINKS_HOST: 'App.Example.com/' }),
    'app.example.com'
  );
  assert.equal(
    appLinksHost({ NEXT_PUBLIC_APP_URL: 'https://easvarafy-music.vercel.app' }),
    'easvarafy-music.vercel.app'
  );
  // Host di-deploy berpindah: NEXT_PUBLIC_API_BASE dipakai sebagai fallback.
  assert.equal(
    appLinksHost({ NEXT_PUBLIC_API_BASE: 'https://music.mydomain.id' }),
    'music.mydomain.id'
  );
  // Localhost (dev) dan "bundled" tidak boleh diklaim → default.
  assert.equal(appLinksHost({ NEXT_PUBLIC_APP_URL: 'http://localhost:3000' }), DEFAULT_APP_LINKS_HOST);
  assert.equal(appLinksHost({ CAPACITOR_SERVER_URL: 'bundled' }), DEFAULT_APP_LINKS_HOST);
  assert.equal(appLinksHost({}), DEFAULT_APP_LINKS_HOST);
});

test('appLinksPaths: default, custom parse, invalid -> default', () => {
  assert.deepEqual(appLinksPaths({}), DEFAULT_APP_LINKS_PATHS);
  assert.deepEqual(appLinksPaths({ EASVARAFY_APP_LINKS_PATHS: '/auth/callback, /' }), [
    '/auth/callback',
    '/',
  ]);
  assert.deepEqual(appLinksPaths({ EASVARAFY_APP_LINKS_PATHS: 'callback nope' }), DEFAULT_APP_LINKS_PATHS);
});

test('appLinksIntentFilterXml: autoVerify, https, host, semua pathPrefix', () => {
  const xml = appLinksIntentFilterXml(DEFAULT_APP_LINKS_HOST, DEFAULT_APP_LINKS_PATHS);
  assert.match(xml, /<intent-filter android:autoVerify="true">/);
  for (const path of DEFAULT_APP_LINKS_PATHS) {
    assert.match(xml, new RegExp(`<data android:scheme="https" android:host="${DEFAULT_APP_LINKS_HOST}" android:pathPrefix="${path.replace('/', '\\/')}" />`));
  }
  // Karakter XML aman.
  assert.match(appLinksIntentFilterXml(DEFAULT_APP_LINKS_HOST, ['/a&b']), /pathPrefix="\/a&amp;b"/);
});

test('applyAppLinksIntentFilter: insert, idempotent, update host, biarkan blok asing', () => {
  const manifest = (extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application>
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
${extra}        </activity>
    </application>
</manifest>
`;

  const first = applyAppLinksIntentFilter(manifest(), DEFAULT_APP_LINKS_HOST, ['/auth/callback']);
  assert.equal(first.changed, true);
  assert.match(first.text, /autoVerify="true"/);
  assert.ok(first.text.indexOf('android:autoVerify') < first.text.indexOf('</activity>'));

  // Re-run persis sama → tidak berubah.
  assert.equal(applyAppLinksIntentFilter(first.text, DEFAULT_APP_LINKS_HOST, ['/auth/callback']).changed, false);

  // Host berubah (pindah domain) → blok milik kita diganti, tidak diduplikasi.
  const updated = applyAppLinksIntentFilter(first.text, 'music.mydomain.id', ['/auth/callback']);
  assert.equal(updated.changed, true);
  assert.match(updated.text, /android:host="music.mydomain.id"/);
  assert.equal((updated.text.match(/autoVerify/g) ?? []).length, 1);

  // autoVerify milik orang lain (tanpa marker kita) → tidak disentuh.
  const foreign = manifest().replace('<intent-filter>', '<intent-filter android:autoVerify="true">');
  assert.equal(applyAppLinksIntentFilter(foreign, DEFAULT_APP_LINKS_HOST, ['/auth/callback']).changed, false);
});

test('buildAssetlinks: statement tunggal, placeholder bila kosong', () => {
  const doc = buildAssetlinks(DEFAULT_APP_LINKS_PACKAGE, [FP_A, FP_B]);
  assert.deepEqual(doc, [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: DEFAULT_APP_LINKS_PACKAGE,
        sha256_cert_fingerprints: [FP_A, FP_B],
      },
    },
  ]);
  const empty = buildAssetlinks(DEFAULT_APP_LINKS_PACKAGE, []);
  assert.deepEqual(empty[0].target.sha256_cert_fingerprints, [PLACEHOLDER_FINGERPRINT]);
});

test('gradleEscape: backslash jadi slash, kutip di-escape', () => {
  assert.equal(gradleEscape('C:\\keystores\\my.jks'), 'C:/keystores/my.jks');
  assert.equal(gradleEscape("it's"), "it\\'s");
});

test('releaseSigningGradleSnippet memuat path, password, alias, keyPassword', () => {
  const snippet = releaseSigningGradleSnippet(signingVars);
  assert.match(snippet, /storeFile file\('\/absolute\/path\/easvarafy-release\.keystore'\)/);
  assert.match(snippet, /storePassword 's3cret'/);
  assert.match(snippet, /keyAlias 'easvarafy\\'s key'/);
  assert.match(snippet, /keyPassword 's3cret2'/);
});

test('applyReleaseSigning pada template Capacitor 8: signingConfigs baru + release pakai itu', () => {
  const result = applyReleaseSigning(CAP_8_GRADLE, signingVars);
  assert.equal(result.changed, true);
  assert.equal(result.note, undefined);
  assert.match(result.text, /    signingConfigs \{\n        easvarafyRelease \{/);
  assert.match(result.text, /    buildTypes \{\n        release \{\n            signingConfig signingConfigs\.easvarafyRelease\n            minifyEnabled false/);
  // Struktur valid: kurung seimbang.
  assert.equal(
    (result.text.match(/\{/g) ?? []).length,
    (result.text.match(/\}/g) ?? []).length
  );
});

test('applyReleaseSigning pada template lama: disisip di signingConfigs eksisting', () => {
  const result = applyReleaseSigning(LEGACY_GRADLE, signingVars);
  assert.equal(result.changed, true);
  const idxDebug = result.text.indexOf('debug {');
  const idxReleaseConfig = result.text.indexOf('easvarafyRelease {');
  const idxClose = result.text.indexOf('    }\n    buildTypes');
  assert.ok(idxDebug >= 0 && idxReleaseConfig > idxDebug && idxClose > idxReleaseConfig);
  assert.match(result.text, /release \{\n            signingConfig signingConfigs\.easvarafyRelease\n/);
  // buildType debug tidak disentuh.
  assert.match(result.text, /debug \{\n            signingConfig signingConfigs\.debug\n/);
});

test('applyReleaseSigning idempotent', () => {
  const once = applyReleaseSigning(CAP_8_GRADLE, signingVars);
  const twice = applyReleaseSigning(once.text, signingVars);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});
