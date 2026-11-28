import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProfilePage, isUserId, publicProfileUrl, validateProfileFile } from './profilePage';

const id = '11111111-1111-4111-8111-111111111111';
test('profile UUID validation rejects arbitrary route and injection input before querying', async () => {
  assert.equal(isUserId(id),true);
  for (const bad of ['invalid','../../admin',"' or true --",'','%2f']) {
    assert.equal(isUserId(bad),false);
    assert.deepEqual(await getProfilePage(bad),{status:'not_found'});
  }
});
test('profile upload validates explicit MIME allowlist and input size', () => {
  validateProfileFile(new File(['image'],'banner.webp',{type:'image/webp'}));
  assert.throws(()=>validateProfileFile(new File(['<svg/>'],'unsafe.svg',{type:'image/svg+xml'})),/JPG/);
  assert.throws(()=>validateProfileFile(new File([],'empty.jpg',{type:'image/jpeg'})),/10 MB/);
  assert.throws(()=>validateProfileFile(new File([new Uint8Array(10*1024*1024+1)],'huge.png',{type:'image/png'})),/10 MB/);
});
test('sharing uses configured canonical HTTPS origin, never Capacitor/localhost', () => {
  const previous=process.env.NEXT_PUBLIC_APP_URL;
  try {
    process.env.NEXT_PUBLIC_APP_URL='https://music.example.org/ignored';
    assert.equal(publicProfileUrl(id),`https://music.example.org/profile/${id}`);
    for (const origin of ['capacitor://localhost','http://localhost:3000','https://localhost']) {
      process.env.NEXT_PUBLIC_APP_URL=origin;
      assert.throws(()=>publicProfileUrl(id));
    }
  } finally { if(previous===undefined) delete process.env.NEXT_PUBLIC_APP_URL; else process.env.NEXT_PUBLIC_APP_URL=previous; }
});
