import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAudioFormat, validateAudioTransfer, MAX_AUDIO_BYTES } from './audioValidation';
import { isPublicDownloadAddress, downloadFetch } from '../server/downloadFetch';
import { downloadKey, enqueueDownload, createDownloadQueue, upsertDownloadRecord, type DownloadedTrack } from './offlineQueue';
import type { Track } from './types';

test('file signatures, not MIME claims, define format; manifests and fake audio rejected', () => {
  const head = new TextEncoder().encode('RIFF0000WAVE00000000000000');
  assert.equal(validateAudioTransfer(head,1000,1000,'application/octet-stream').extension,'wav');
  for (const payload of ['<html>error</html>', '{"error":"no"}', '#EXTM3U\n0000000000'])
    assert.equal(detectAudioFormat(new TextEncoder().encode(payload)),null);
  assert.throws(() => validateAudioTransfer(head,1000,1001,'audio/wav'),/tidak lengkap/);
  assert.throws(() => validateAudioTransfer(head,0,null,'audio/wav'));
  assert.throws(() => validateAudioTransfer(head,MAX_AUDIO_BYTES+1,null,'audio/wav'));
  assert.throws(() => validateAudioTransfer(head,1000,null,'text/html'));
});
test('provider identity separates queue and record keys', () => {
  const a: Track = {videoId:'sameid1',provider:'youtube', title:'Fixture', artist:'Test', artists:[], duration:1, thumbnail:'',type:'SONG'};
  const b = {...a,provider:'other'};
  let queue = enqueueDownload(createDownloadQueue(),a);
  queue = enqueueDownload(queue,b);
  assert.deepEqual(queue.order,['youtube:sameid1','other:sameid1']);
  assert.equal(downloadKey('sameid1'),'youtube:sameid1');
  const record = (track: Track): DownloadedTrack => ({ ...track, album:null, track, localUri:'idb://audio/fixture', localThumbUri:null,mimeType:'audio/wav',fileSizeBytes:1000,downloadedAt:1,lyrics:null });
  assert.equal(upsertDownloadRecord([record(a)],record(b)).length,2);
});
test('SSRF: local, reserved, mapped and link-local networks are never downloadable', async () => {
  for (const ip of ['127.0.0.1','0.0.0.0','10.1.2.3','100.100.100.200','169.254.169.254','172.16.1.1','192.168.1.1','224.0.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1'])
    assert.equal(isPublicDownloadAddress(ip),false,ip);
  assert.equal(isPublicDownloadAddress('8.8.8.8'),true);
  assert.equal(isPublicDownloadAddress('2606:4700:4700::1111'),true);
  await assert.rejects(downloadFetch('https://127.0.0.1/audio.mp3'),/Non-public/);
  await assert.rejects(downloadFetch('http://example.com/audio.mp3'),/Invalid/);
  await assert.rejects(downloadFetch('https://user:token@example.com/audio.mp3'),/Invalid/);
});
