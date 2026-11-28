import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSeedState } from './seed';
import { loadAccountDeviceState,loadLibraryState,saveHistory } from './storage';

test('new account has no seeded personal playlist, history, or likes', () => {
  assert.deepEqual(createInitialSeedState(),{history:[],likedTracks:[],playlists:[]});
  assert.deepEqual(loadLibraryState().playlists,[]);
});
test('legacy unscoped personal data are not imported and device data are account-scoped', () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'window');
  const data=new Map<string,string>([['sonora_user_playlists_v1',JSON.stringify([{id:'unverified-old-record',name:'Favorit'}])]]);
  Object.defineProperty(globalThis,'window',{configurable:true,value:{localStorage:{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)}}});
  try {
    assert.deepEqual(loadLibraryState().playlists,[]);
    assert.ok(data.has('sonora_user_playlists_v1'),'legacy records retained for manual recovery');
    saveHistory([], 'owner-A');
    assert.deepEqual(loadAccountDeviceState('owner-B').history,[]);
    assert.ok(data.has('sonora_play_history_v1:owner-A'));
    assert.equal(data.has('sonora_play_history_v1:owner-B'),false);
  } finally { if(original) Object.defineProperty(globalThis,'window',original); else Reflect.deleteProperty(globalThis,'window'); }
});
