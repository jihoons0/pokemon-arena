import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {ROSTER} from '../src/roster.js';
import {TRAINER_SKILLS} from '../src/trainer-skills.js';
import {hapticForCue} from '../src/feedback.js';
import {iconFor} from '../src/icons.js';
const root=fileURLToPath(new URL('../public',import.meta.url));
test('six original trainer choices have distinct real icon assets, including battle HUD markup',()=>{
  const hashes=[];
  for(const skill of TRAINER_SKILLS){const bytes=readFileSync(resolve(root,'.'+skill.icon));assert.equal(bytes.toString('ascii',1,4),'PNG');assert.equal(bytes.readUInt32BE(16),256);assert.equal(bytes.readUInt32BE(20),256);hashes.push(createHash('sha256').update(bytes).digest('hex'));assert.ok(iconFor(skill).includes(skill.icon));}
  assert.equal(new Set(hashes).size,6);
});
test('all fifty Pokémon have an actual locally bundled Ogg cry and source attribution',()=>{
  const metadata=JSON.parse(readFileSync(resolve(root,'assets/audio/cries/credits.json'),'utf8'));
  assert.equal(metadata.assets.length,50);
  for(const mon of ROSTER.filter(mon=>!mon.custom)){const bytes=readFileSync(resolve(root,`assets/audio/cries/${mon.dex}.ogg`));assert.equal(bytes.toString('ascii',0,4),'OggS');assert.ok(bytes.length>500);const entry=metadata.assets.find(item=>item.id===mon.id);assert.equal(entry.dex,mon.dex);assert.ok(entry.sourceUrl.startsWith('https://raw.githubusercontent.com/PokeAPI/cries/'));}
});
test('ordinary skills as well as ultimates have restrained tactile feedback plans',()=>{
  for(const kind of ['bolt','fan','volley','slash','dash','guard','boost','pulse','field','beam'])for(const cue of ['cast','release']){const spec=hapticForCue(cue,{kind});assert.ok(spec);assert.ok(spec.pattern.reduce((sum,n)=>sum+n,0)<=50);assert.ok(spec.strong<=.4);}
});
