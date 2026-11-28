import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeDownloadCount,
  audioFileName,
  bytesToBase64,
  computeProgressPercent,
  concatChunks,
  createDownloadQueue,
  describeDownloadError,
  enqueueDownload,
  extensionForMime,
  formatBytes,
  markDownloadFailed,
  markDownloadSaving,
  markDownloadStarted,
  nextQueuedJob,
  parseOfflineIndex,
  removeDownloadJob,
  removeDownloadRecord,
  sanitizeVideoId,
  serializeOfflineIndex,
  totalDownloadedBytes,
  updateDownloadProgress,
  upsertDownloadRecord,
  type DownloadedTrack,
} from './offlineQueue';
import {
  buildAudioSourceCandidates,
  looksLikeAudio,
  resolveAudioSource,
} from '../server/audioSource';
import type { Track } from './types';

function track(id: string, title = `Song ${id}`): Track {
  return {
    videoId: id,
    provider: 'youtube',
    title,
    artist: 'Artist',
    artists: [{ artistId: null, name: 'Artist' }],
    album: null,
    duration: 200,
    thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    type: 'SONG',
  };
}

function record(id: string, downloadedAt: number, size = 1000): DownloadedTrack {
  const t = track(id);
  return {
    videoId: id,
    provider: 'youtube',
    title: t.title,
    artist: t.artist,
    album: null,
    duration: t.duration,
    thumbnail: t.thumbnail,
    localUri: `idb://audio/${id}`,
    localThumbUri: null,
    mimeType: 'audio/mpeg',
    fileSizeBytes: size,
    downloadedAt,
    lyrics: null,
    track: t,
  };
}

test('sanitizeVideoId accepts YouTube-style ids and rejects paths / junk', () => {
  assert.equal(sanitizeVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(sanitizeVideoId('  abc_DEF-12  '), 'abc_DEF-12');
  assert.equal(sanitizeVideoId('../../etc/passwd'), null);
  assert.equal(sanitizeVideoId('a b c d e f'), null);
  assert.equal(sanitizeVideoId('abc'), null);
  assert.equal(sanitizeVideoId(42), null);
});

test('download queue: FIFO, dedupe, concurrency limit and lifecycle', () => {
  let q = createDownloadQueue();
  q = enqueueDownload(q, track('aaaaaa1'), 1);
  q = enqueueDownload(q, track('bbbbbb2'), 2);
  q = enqueueDownload(q, track('cccccc3'), 3);
  q = enqueueDownload(q, track('aaaaaa1'), 4); // duplicate ignored
  assert.deepEqual(q.order, ['youtube:aaaaaa1', 'youtube:bbbbbb2', 'youtube:cccccc3']);
  assert.equal(q.jobs['youtube:aaaaaa1'].enqueuedAt, 1);

  assert.equal(nextQueuedJob(q, 2)?.videoId, 'aaaaaa1');
  q = markDownloadStarted(q, 'aaaaaa1');
  assert.equal(nextQueuedJob(q, 2)?.videoId, 'bbbbbb2');
  q = markDownloadStarted(q, 'bbbbbb2');
  assert.equal(activeDownloadCount(q), 2);
  assert.equal(nextQueuedJob(q, 2), null, 'respects max concurrency');

  q = updateDownloadProgress(q, 'aaaaaa1', 512, 1024);
  assert.equal(q.jobs['youtube:aaaaaa1'].progress, 50);
  q = markDownloadSaving(q, 'aaaaaa1');
  assert.equal(q.jobs['youtube:aaaaaa1'].status, 'saving');
  assert.equal(activeDownloadCount(q), 2, 'saving still counts as active');

  q = removeDownloadJob(q, 'aaaaaa1');
  assert.deepEqual(q.order, ['youtube:bbbbbb2', 'youtube:cccccc3']);
  assert.equal(nextQueuedJob(q, 2)?.videoId, 'cccccc3');
});

test('failed downloads keep their error and can be re-queued', () => {
  let q = enqueueDownload(createDownloadQueue(), track('dddddd4'), 1);
  q = markDownloadStarted(q, 'dddddd4');
  q = markDownloadFailed(q, 'dddddd4', 'Audio lagu ini belum tersedia untuk diunduh.');
  assert.equal(q.jobs['youtube:dddddd4'].status, 'error');
  assert.equal(q.jobs['youtube:dddddd4'].error, 'Audio lagu ini belum tersedia untuk diunduh.');
  assert.equal(activeDownloadCount(q), 0);
  assert.equal(nextQueuedJob(q), null, 'errors are not retried automatically');

  q = enqueueDownload(q, track('dddddd4'), 9);
  assert.equal(q.jobs['youtube:dddddd4'].status, 'queued');
  assert.equal(q.jobs['youtube:dddddd4'].error, null);
  assert.deepEqual(q.order, ['youtube:dddddd4'], 'retry keeps a single queue slot');
});

test('enqueue ignores tracks with invalid ids', () => {
  const q = createDownloadQueue();
  assert.equal(enqueueDownload(q, track('bad id!')), q);
});

test('computeProgressPercent is 0–100, floors, and is null when size unknown', () => {
  assert.equal(computeProgressPercent(0, 100), 0);
  assert.equal(computeProgressPercent(1, 3), 33);
  assert.equal(computeProgressPercent(999, 1000), 99, 'never shows 100 before the last byte');
  assert.equal(computeProgressPercent(1000, 1000), 100);
  assert.equal(computeProgressPercent(2000, 1000), 100);
  assert.equal(computeProgressPercent(500, null), null);
  assert.equal(computeProgressPercent(500, 0), null);
});

test('formatBytes and totals', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.50 KB');
  assert.equal(formatBytes(4.2 * 1024 * 1024), '4.20 MB');
  assert.equal(formatBytes(150 * 1024 * 1024), '150 MB');
  assert.equal(totalDownloadedBytes([record('aaaaaa1', 1, 100), record('bbbbbb2', 2, 250)]), 350);
});

test('file naming from MIME type', () => {
  assert.equal(extensionForMime('audio/mpeg'), 'mp3');
  assert.equal(extensionForMime('audio/mp4; codecs="mp4a.40.2"'), 'm4a');
  assert.equal(extensionForMime('audio/webm'), 'webm');
  assert.equal(extensionForMime('application/octet-stream'), 'audio');
  assert.equal(audioFileName('dQw4w9WgXcQ', 'audio/ogg'), 'dQw4w9WgXcQ.ogg');
});

test('offline index: upsert (newest first), remove, serialize round-trip', () => {
  let list: DownloadedTrack[] = [];
  list = upsertDownloadRecord(list, record('aaaaaa1', 10));
  list = upsertDownloadRecord(list, record('bbbbbb2', 30));
  list = upsertDownloadRecord(list, record('aaaaaa1', 50)); // re-download replaces
  assert.deepEqual(list.map((r) => r.videoId), ['aaaaaa1', 'bbbbbb2']);
  assert.equal(list[0].downloadedAt, 50);

  const parsed = parseOfflineIndex(JSON.parse(serializeOfflineIndex(list)));
  assert.deepEqual(parsed, list);

  list = removeDownloadRecord(list, 'aaaaaa1');
  assert.deepEqual(list.map((r) => r.videoId), ['bbbbbb2']);
});

test('parseOfflineIndex drops malformed / duplicate entries and fills defaults', () => {
  const parsed = parseOfflineIndex({
    version: 1,
    tracks: [
      { videoId: 'okokok1', localUri: 'file:///x/offline/audio/okokok1.mp3', title: 'A', artist: 'B', downloadedAt: 5 },
      { videoId: 'okokok1', localUri: 'file:///dup', downloadedAt: 6 },
      { videoId: '../../hack', localUri: 'file:///x' },
      { videoId: 'nouri12' },
      'garbage',
      null,
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].videoId, 'okokok1');
  assert.equal(parsed[0].mimeType, 'audio/mpeg');
  assert.equal(parsed[0].track.title, 'A');
  assert.equal(parsed[0].lyrics, null);
  assert.deepEqual(parseOfflineIndex(undefined), []);
});

test('describeDownloadError gives clear Indonesian messages', () => {
  assert.match(describeDownloadError(null), /internet/i);
  assert.match(describeDownloadError(404), /belum tersedia/);
  assert.match(describeDownloadError(503), /Server audio/);
  assert.equal(describeDownloadError(404, 'Pesan dari server'), 'Pesan dari server');
});

test('bytesToBase64 / concatChunks', () => {
  const merged = concatChunks([new Uint8Array([72, 105]), new Uint8Array([33])]);
  assert.deepEqual([...merged], [72, 105, 33]);
  assert.equal(bytesToBase64(merged), Buffer.from('Hi!').toString('base64'));
  const big = new Uint8Array(100_000).map((_, i) => i % 256);
  assert.equal(bytesToBase64(big), Buffer.from(big).toString('base64'));
});

test('audio source candidates: templates first, then Supabase Storage', () => {
  const list = buildAudioSourceCandidates(
    'dQw4w9WgXcQ',
    { title: 'Never Gonna', artist: 'Rick' },
    {
      AUDIO_SOURCE_URL_TEMPLATE: 'https://cdn.example.com/a/{videoId}.mp3, notaurl, https://m.example.com/{artist}/{title}.m4a',
      NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co/',
    }
  );
  assert.equal(list[0].url, 'https://cdn.example.com/a/dQw4w9WgXcQ.mp3');
  assert.equal(list[1].url, 'https://m.example.com/Rick/Never%20Gonna.m4a');
  assert.equal(list[2].url, 'https://proj.supabase.co/storage/v1/object/public/offline-audio/dQw4w9WgXcQ.mp3');
  assert.ok(list.every((c) => !c.url.includes('notaurl')));

  assert.deepEqual(buildAudioSourceCandidates('dQw4w9WgXcQ', {}, {}), [], 'nothing configured');
  assert.deepEqual(
    buildAudioSourceCandidates('dQw4w9WgXcQ', {}, {
      NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
      AUDIO_STORAGE_DISABLED: 'true',
    }),
    []
  );
  const custom = buildAudioSourceCandidates('dQw4w9WgXcQ', {}, {
    NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
    AUDIO_STORAGE_BUCKET: 'songs',
  });
  assert.ok(custom[0].url.includes('/public/songs/dQw4w9WgXcQ.mp3'));
});

test('looksLikeAudio', () => {
  assert.equal(looksLikeAudio('audio/mpeg', 'https://x/a'), true);
  assert.equal(looksLikeAudio('application/octet-stream', 'https://x/a.m4a?token=1'), true);
  assert.equal(looksLikeAudio('text/html', 'https://x/a.mp3'), false);
  assert.equal(looksLikeAudio('application/json', 'https://x/a'), false);
});

test('resolveAudioSource probes candidates in order and skips non-audio', async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? 'GET'} ${u}`);
    if (u.includes('missing')) return new Response(null, { status: 404 });
    if (u.includes('html')) return new Response(null, { status: 200, headers: { 'content-type': 'text/html' } });
    if (u.includes('nohead') && init?.method === 'HEAD') return new Response(null, { status: 405 });
    if (u.includes('nohead')) {
      return new Response('x', {
        status: 206,
        headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-0/4200' },
      });
    }
    return new Response(null, { status: 200, headers: { 'content-type': 'audio/mpeg', 'content-length': '1234' } });
  }) as typeof fetch;

  const found = await resolveAudioSource(
    [
      { url: 'https://a/missing.mp3', label: 'one' },
      { url: 'https://a/html', label: 'two' },
      { url: 'https://a/nohead.m4a', label: 'three' },
      { url: 'https://a/ok.mp3', label: 'four' },
    ],
    fakeFetch
  );
  assert.deepEqual(found, {
    url: 'https://a/nohead.m4a',
    label: 'three',
    contentType: 'audio/mp4',
    contentLength: 4200,
  });
  assert.ok(!calls.some((c) => c.includes('ok.mp3')), 'stops at first hit');

  const none = await resolveAudioSource([{ url: 'https://a/missing.mp3', label: 'x' }], fakeFetch);
  assert.equal(none, null);
});
