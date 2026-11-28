// Test-owned generated PCM audio; no provider extraction or copyrighted fixtures.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
const bundle = await build({ entryPoints:['lib/metrolist/offlineAudio.ts'], bundle:true, write:false,
  format:'iife', globalName:'Offline', platform:'browser', define:{'process.env.NEXT_PUBLIC_API_BASE':'""'} });
const js = bundle.outputFiles[0].text;
const wav = Buffer.alloc(32044);
wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22);
wav.writeUInt32LE(16000,24); wav.writeUInt32LE(32000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34);
wav.write('data',36); wav.writeUInt32LE(32000,40);
for (let i=0;i<16000;i++) wav.writeInt16LE(Math.round(Math.sin(i/16000*440*2*Math.PI)*1000),44+i*2);
const browser = await chromium.launch({ executablePath:process.env.CHROMIUM_EXECUTABLE_PATH, headless:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext();
let mode = 'ok', requests = 0;
try {
  const page = await context.newPage();
  await page.route('https://offline.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Offline storage integration</title>'});
    if (url.pathname.includes('lyrics')) return route.fulfill({json:{lines:[],plainText:''}});
    if (url.searchParams.has('resolve')) return route.fulfill({json:{ok:true,downloadAllowed:true,source:'test-owned',contentType:'audio/wav'}});
    requests++;
    if (mode === 'expired') return route.fulfill({status:403});
    if (mode === 'html') return route.fulfill({contentType:'application/octet-stream',body:'<html>error</html>'.repeat(100)});
    if (mode === 'fake-container') return route.fulfill({contentType:'audio/mp4',body:'0000ftyp'+'0000'.repeat(100)});
    if (mode === 'denied') return route.fulfill({status:403});
    return route.fulfill({contentType:'application/octet-stream',body:wav});
  });
  await page.goto('https://offline.test/');
  await page.addScriptTag({content:js});
  const result = await page.evaluate(async () => {
    const track = {videoId:'ownwav01',title:'Owned PCM fixture',artist:'Test',artists:[],duration:1,thumbnail:'',type:'SONG'};
    const [a,b] = await Promise.all([Offline.downloadTrack(track),Offline.downloadTrack(track)]);
    const url = await Offline.resolveOfflinePlaybackUrl(a);
    const blob = await (await fetch(url)).blob();
    return {size:a.fileSizeBytes, mime:a.mimeType, same:a.localUri===b.localUri, blobSize:blob.size, hash:a.sha256};
  });
  assert.equal(result.size,wav.length); assert.equal(result.blobSize,wav.length);
  assert.equal(result.same,true); assert.equal(result.mime,'audio/wav'); assert.equal(result.hash.length,64);
  assert.equal(requests,1);
  for (const failure of ['expired','html','fake-container','denied']) {
    mode = failure;
    const saved = await page.evaluate(async () => {
      try { await Offline.downloadTrack({videoId:'badwav01',title:'Bad',artist:'Test',artists:[],duration:1,thumbnail:'',type:'SONG'}); return true; }
      catch { return Boolean(Offline.getDownloadedTrackSync('badwav01')); }
    });
    assert.equal(saved,false,failure);
  }
  // Restart the JS module/page: index is read from real browser IndexedDB.
  await page.reload(); await page.addScriptTag({content:js});
  await page.evaluate(() => Offline.ensureOfflineLibraryLoaded());
  const before = requests;
  await context.setOffline(true);
  const played = await page.evaluate(async () => {
    const record = Offline.getDownloadedTrackSync('ownwav01');
    const url = await Offline.resolveOfflinePlaybackUrl(record);
    const audio = document.createElement('audio'); audio.src = url; document.body.append(audio);
    await audio.play();
    await new Promise(resolve => setTimeout(resolve,250));
    const out = {time:audio.currentTime,source:audio.currentSrc,count:Offline.getOfflineSnapshot().records.length};
    audio.pause(); return out;
  });
  assert.equal(played.count,1); assert.ok(played.time>0); assert.ok(played.source.startsWith('blob:'));
  assert.equal(requests,before,'offline playback never requested streaming API');
  await page.evaluate(() => Offline.removeDownloadedTrack('ownwav01'));
  assert.equal(await page.evaluate(() => Offline.getOfflineSnapshot().totalBytes),0);
  console.log('PASS: real browser bytes + decoder, dedupe, non-audio/expired errors, restart, offline playback, deletion.');
} finally { await context.close(); await browser.close(); }
