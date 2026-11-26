import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { buildFcmMessage, buildServiceAccountAssertion, parseServiceAccount } from './fcm';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const saJson = JSON.stringify({
  type: 'service_account',
  project_id: 'easvarafy-music',
  client_email: 'fcm@easvarafy-music.iam.gserviceaccount.com',
  private_key: pem.replace(/\n/g, '\\n'),
});

test('parseServiceAccount accepts raw and base64 JSON, rejects junk', () => {
  const raw = parseServiceAccount(saJson);
  assert.ok(raw);
  assert.equal(raw.project_id, 'easvarafy-music');
  assert.ok(raw.private_key.includes('\n-----END'));
  assert.ok(parseServiceAccount(Buffer.from(saJson).toString('base64')));
  assert.equal(parseServiceAccount(''), null);
  assert.equal(parseServiceAccount('{"project_id":"x"}'), null);
  assert.equal(parseServiceAccount(undefined), null);
});

test('service-account assertion is a valid RS256 JWT', () => {
  const sa = parseServiceAccount(saJson)!;
  const jwt = buildServiceAccountAssertion(sa, 1_800_000_000);
  const [h, c, sig] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  assert.equal(claims.exp - claims.iat, 3600);
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${h}.${c}`);
  assert.equal(verifier.verify(publicKey, Buffer.from(sig, 'base64url')), true);
});

test('FCM message uses the broadcast channel + tag (dedupe with native poller)', () => {
  const msg = buildFcmMessage('tok', {
    id: '11111111-2222-3333-4444-555555555555',
    title: 'T',
    body: 'B',
    category: 'music',
    image_url: 'https://x.y/a.jpg',
    action_url: '/explore',
  });
  assert.equal(msg.message.token, 'tok');
  assert.equal(msg.message.android.notification.channel_id, 'easvarafy_broadcast_channel');
  assert.equal(msg.message.android.notification.tag, '11111111-2222-3333-4444-555555555555');
  assert.equal(msg.message.notification.image, 'https://x.y/a.jpg');
  assert.deepEqual(msg.message.data, {
    notification_id: '11111111-2222-3333-4444-555555555555',
    category: 'music',
    action_url: '/explore',
  });
});
