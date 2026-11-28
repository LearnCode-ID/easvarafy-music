import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { configureAppLinks } from '../scripts/android-app-links.mjs';

test('generated manifest verifies HTTPS playlist/profile links, preserves OAuth, and is idempotent', () => {
  const original = '<manifest><application><activity android:name=".MainActivity"><intent-filter><data android:scheme="com.easvarafy.app" android:host="auth" /></intent-filter></activity></application></manifest>';
  const result = configureAppLinks(original);
  assert.match(result, /android:autoVerify="true"/);
  assert.match(result, /android:host="easvarafy-music.vercel.app"/);
  for (const path of ['/profile/', '/playlist/']) assert.ok(result.includes(`android:pathPrefix="${path}"`));
  assert.match(result, /android:scheme="com.easvarafy.app"/);
  assert.equal(configureAppLinks(result), result);
  assert.throws(() => configureAppLinks('<manifest/>'));
});
test('APK workflow requires persistent signing and never publishes a random debug certificate', () => {
  const workflow = readFileSync('.github/workflows/build-apk.yml', 'utf8');
  assert.match(workflow, /assembleRelease/);
  assert.match(workflow, /verify-android-signing.mjs/);
  assert.doesNotMatch(workflow, /assembleDebug|outputs\/apk\/debug/);
  for (const key of ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    assert.ok(workflow.includes(`secrets.${key}`));
  }
});
