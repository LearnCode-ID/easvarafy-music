import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { GET } from './route';

test('download API fails closed without rights, rejects unsupported providers, arbitrary URLs and private sources', async () => {
  const original = { ...process.env };
  try {
    delete process.env.AUDIO_DOWNLOADS_ENABLED;
    let res = await GET(new NextRequest('https://app.test/api/music/audio?videoId=fixture1&resolve=1'));
    assert.equal(res.status,403);
    assert.equal((await res.json()).error,'streaming_only');
    process.env.AUDIO_DOWNLOADS_ENABLED = 'true';
    res = await GET(new NextRequest('https://app.test/api/music/audio?videoId=fixture1&provider=other'));
    assert.equal(res.status,422);
    res = await GET(new NextRequest('https://app.test/api/music/audio?videoId=../../etc/passwd'));
    assert.equal(res.status,400);
    process.env.AUDIO_STORAGE_DISABLED = 'true';
    delete process.env.AUDIO_SOURCE_URL_TEMPLATE;
    res = await GET(new NextRequest('https://app.test/api/music/audio?videoId=fixture1&url=https://attacker.test/audio.mp3'));
    assert.equal(res.status,404,'request URL cannot configure a source');
    process.env.AUDIO_SOURCE_URL_TEMPLATE = 'https://127.0.0.1/{videoId}.mp3';
    res = await GET(new NextRequest('https://app.test/api/music/audio?videoId=fixture1'));
    assert.equal(res.status,404,'private source refused before connecting');
    res = await GET(new NextRequest('https://app.test/api/music/audio?videoId=fixture1',{headers:{range:'bytes=1-10'}}));
    assert.equal(res.status,416);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env,original);
  }
});
