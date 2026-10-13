import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeName,inviteFromURL,inviteURL,SITE_ORIGIN} from '../src/invite.js';
import {inviteHTML,shareInfo} from '../server/share.js';
import {shareImage} from '../server/share-image.js';
import {Match} from '../server/match.js';
import {PROTOCOL} from '../src/net-state.js';
import {ROSTER} from '../src/roster.js';

test('invites round-trip multilingual names and retain legacy room-code links',()=>{
  const url=inviteURL(SITE_ORIGIN,'ABCDEF','  호재 & 친구  ','ko');
  assert.deepEqual(inviteFromURL(url),{code:'ABCDEF',name:'호재 & 친구',lang:'ko'});
  assert.equal(inviteFromURL('/?room=abcdef').code,'ABCDEF');
  assert.equal(inviteFromURL('/invite/INVALID'),null);
  assert.equal(normalizeName('a\u0000\u202Eb'),'ab');
  assert.equal(Array.from(normalizeName('가'.repeat(100))).length,20);
});
test('crawler HTML has escaped, complete invitation metadata and preserves the game entry point',async()=>{
  const template=await readFile('index.html','utf8');
  const invite={code:'ABCDEF',name:'<img src=x>" & 호재',lang:'ko'};
  const html=inviteHTML(template,invite);
  assert.ok(html.includes('&lt;img src=x&gt;&quot; &amp; 호재님이 배틀에 초대했어요!'));
  assert.ok(!html.includes('<img src=x>'));
  assert.equal((html.match(/property="og:title"/g)||[]).length,1);
  assert.match(html,/property="og:image" content="https:\/\/pokemon-arena-rosy.vercel.app\/api\/og\?/);
  assert.ok(html.includes('/src/app.js'));
  assert.match(template,/property="og:image" content="https:\/\/pokemon-arena-rosy.vercel.app\/assets\/brand\/social-card.png"/);
  assert.notEqual(shareInfo({...invite,name:'One'}).image,shareInfo({...invite,name:'Two'}).image);
});
test('share images render real 1200x630 PNGs for Korean and English invitations',async()=>{
  for(const [name,lang] of [['호재','ko'],['Hojae','en']]){
    const response=await shareImage({code:'ABCDEF',name,lang});
    const png=Buffer.from(await response.arrayBuffer());
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
    assert.ok(png.length>10000);
  }
});
test('lobbies expose bounded names without exposing reconnection tokens or allowing impersonation on reconnect',()=>{
  const match=new Match(),team=ROSTER.slice(0,6).map(p=>p.id);
  match.connect({v:PROTOCOL,newToken:'private-token',team,special:'haste',name:' 호재 '});
  match.disconnect(0);match.connect({v:PROTOCOL,token:'private-token',name:'Changed'});
  assert.equal(match.publicLobby().players[0].name,'호재');
  assert.ok(!JSON.stringify(match.publicLobby()).includes('private-token'));
});
