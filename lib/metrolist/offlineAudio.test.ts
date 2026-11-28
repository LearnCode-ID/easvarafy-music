import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as offline from './offlineAudio';
import { downloadKey } from './offlineQueue';
import type { Track } from './types';

Object.defineProperty(globalThis, 'window', { value: { location: { hostname: 'fixture.test', protocol: 'https:', port: '', href: 'https://fixture.test/' } }, configurable: true });
function track(id: string): Track {
  return { videoId: id, title: id, artist: 'Local fixture', artists: [], album: null, duration: 1, thumbnail: '', type: 'SONG' };
}
function audioBytes() {
  const out = new Uint8Array(16044);
  const view = new DataView(out.buffer);
  for (const [offset, text] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const)
    for (let i=0; i<text.length; i++) out[offset+i] = text.charCodeAt(i);
  view.setUint32(4, out.length-8, true); view.setUint32(16,16,true); view.setUint16(20,1,true);
  view.setUint16(22,1,true); view.setUint32(24,8000,true); view.setUint32(28,16000,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true); view.setUint32(40,16000,true);
  return out;
}
const bytes = audioBytes();
let transfers = 0;
let mode = 'ok';
let held: (() => void) | undefined;
globalThis.fetch = async (input, options) => {
  const url = new URL(String(input), 'https://fixture.test');
  if (url.pathname.includes('lyrics')) return Response.json({ lines: [], plainText: '' });
  const resolver = url.searchParams.has('resolve');
  if (mode === 'denied') return Response.json({ message: 'Sumber hanya mendukung streaming.' }, { status: 403 });
  if (mode === 'expired' && !resolver) return new Response(null, { status: 403 });
  if (resolver) return Response.json({ ok: true, downloadAllowed: true, source: 'test-owned', contentType: 'audio/wav' });
  transfers++;
  if (mode === 'held') {
    await new Promise<void>((resolve,reject) => {
      held = resolve;
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
  }
  if (mode === 'disconnected') throw new TypeError('Failed to fetch');
  const body = mode === 'html' ? new TextEncoder().encode('<html>not audio</html>'.repeat(20)) : bytes;
  return new Response(body, { headers: {
    'content-type': mode === 'html' ? 'application/octet-stream' : 'audio/wav',
    ...(mode === 'truncated' ? { 'content-length': String(bytes.length + 12) } : {}),
  } });
};
async function putBlob(key: string, value: Blob | null) {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('easvarafy-offline');
    req.onsuccess = () => {
      const db = req.result; const tx = db.transaction(['blobs'], 'readwrite');
      if (value) tx.objectStore('blobs').put(value,key); else tx.objectStore('blobs').delete(key);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  });
}

test('real web storage lifecycle: bytes, dedupe, integrity, errors, cancel, clear and concurrent commits', async () => {
  await offline.ensureOfflineLibraryLoaded();
  const t = track('fixture1');
  const [a,b] = await Promise.all([offline.downloadTrack(t), offline.downloadTrack(t)]);
  assert.equal(transfers,1, 'one actual transfer for duplicate requests');
  assert.equal(a.localUri,b.localUri);
  assert.equal(a.fileSizeBytes,bytes.length);
  assert.equal(a.mimeType,'audio/wav');
  assert.equal(a.provider,'youtube');
  assert.ok(a.sha256?.length === 64);
  const url = await offline.resolveOfflinePlaybackUrl(a);
  assert.ok(url?.startsWith('blob:'));
  assert.equal(offline.getOfflineSnapshot().totalBytes,bytes.length);
  await offline.downloadTrack(t);
  assert.equal(transfers,1);
  // Same-size tampering is detected by digest, not only file existence.
  const tampered = bytes.slice(); tampered[tampered.length-1] = 1;
  await putBlob('audio:youtube:fixture1', new Blob([tampered],{type:'audio/wav'}));
  assert.equal(await offline.resolveOfflinePlaybackUrl(a),null);
  assert.equal(offline.getDownloadedTrackSync(t),null);
  for (const failure of ['html','truncated','denied','expired','disconnected']) {
    mode = failure;
    await assert.rejects(offline.downloadTrack(track('failure1')));
    assert.equal(offline.getDownloadedTrackSync('failure1'),null);
    assert.equal(offline.getOfflineSnapshot().queue.jobs['youtube:failure1'].status,'error');
  }
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'blobs') throw new DOMException('quota', 'QuotaExceededError');
    return originalPut.apply(this,args);
  };
  mode = 'ok';
  await assert.rejects(offline.downloadTrack(track('quota001')), /penuh/);
  assert.equal(offline.getDownloadedTrackSync('quota001'),null);
  IDBObjectStore.prototype.put = originalPut;
  mode = 'held';
  const waiting = offline.downloadTrack(track('cancel11'));
  // Let the actual fetch begin, then cancel it.
  await new Promise(resolve => setTimeout(resolve,10));
  offline.cancelDownload('cancel11');
  await assert.rejects(waiting,/dibatalkan/);
  assert.equal(offline.getOfflineSnapshot().queue.jobs['youtube:cancel11'].status,'cancelled');
  mode = 'ok'; held?.();
  await Promise.all([offline.downloadTrack(track('fixture2')),offline.downloadTrack(track('fixture3'))]);
  assert.equal(offline.getOfflineSnapshot().records.length,2,'parallel finishing jobs preserve both records');
  IDBObjectStore.prototype.put = function(...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'tracks') throw new DOMException('quota', 'QuotaExceededError');
    return originalPut.apply(this,args);
  };
  await assert.rejects(offline.downloadTrack(track('indexerr')), /penuh/);
  assert.equal(offline.getDownloadedTrackSync('indexerr'),null);
  assert.equal(offline.getOfflineSnapshot().records.length,2,'index failure preserves previous records');
  IDBObjectStore.prototype.put = originalPut;
  const second = offline.getDownloadedTrackSync('fixture2')!;
  await putBlob('audio:youtube:fixture2', null);
  assert.equal(await offline.resolveOfflinePlaybackUrl(second),null);
  assert.equal(offline.getOfflineSnapshot().records.length,1);
  await offline.removeDownloadedTrack('fixture3');
  assert.equal(offline.getOfflineSnapshot().totalBytes,0);
  mode = 'ok';
  await offline.downloadTrack(t);
  await offline.clearAllDownloads();
  assert.equal(offline.getOfflineSnapshot().records.length,0);
  assert.equal(offline.getOfflineSnapshot().queue.order.length,0);
  mode = 'held';
  const pending = ['queue001','queue002','queue003','queue004'].map(id => offline.downloadTrack(track(id)));
  const outcomes = Promise.allSettled(pending);
  await new Promise(resolve => setTimeout(resolve,10));
  const jobs = Object.values(offline.getOfflineSnapshot().queue.jobs);
  assert.equal(jobs.filter(j => j.status === 'downloading').length,2);
  assert.equal(jobs.filter(j => j.status === 'queued').length,2);
  await offline.clearAllDownloads();
  assert.equal((await outcomes).filter(r => r.status === 'rejected').length,4,'clear settles active and queued callers');
  assert.equal(offline.getOfflineSnapshot().records.length,0);
  assert.equal(downloadKey({ ...t, provider:'other' }), 'other:fixture1');
});
