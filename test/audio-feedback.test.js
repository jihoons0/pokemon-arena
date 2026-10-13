import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioManager} from '../src/audio.js';
import {buildCuePlan,normalizeVibrationPattern} from '../src/feedback.js';
import {ROSTER_BY_ID} from '../src/roster.js';

class FakeParam{
  constructor(value=0){this.value=value;}
  setValueAtTime(value){this.value=value;}
  exponentialRampToValueAtTime(value){this.value=value;}
}
class FakeNode{
  connect(target){this.target=target;return target;}
  disconnect(){}
}
class FakeAudioContext{
  constructor(){this.state='running';this.currentTime=1;this.sampleRate=1000;this.destination=new FakeNode();}
  resume(){this.state='running';return Promise.resolve();}
  createGain(){const node=new FakeNode();node.gain=new FakeParam(1);return node;}
  createOscillator(){const node=new FakeNode();node.type='sine';node.frequency=new FakeParam(440);node.start=()=>{};node.stop=()=>{};return node;}
  createBuffer(channels,length){return {getChannelData:()=>new Float32Array(length)};}
  createBufferSource(){const node=new FakeNode();node.start=()=>{};node.stop=()=>{};return node;}
  createBiquadFilter(){const node=new FakeNode();node.type='highpass';node.frequency=new FakeParam(0);return node;}
  createDynamicsCompressor(){const node=new FakeNode();for(const key of ['threshold','knee','ratio','attack','release'])node[key]=new FakeParam();return node;}
}
class FakeAudio{
  static instances=[];
  constructor(src){this.src=src;this.loop=false;this.preload='';this.volume=1;this.muted=false;this.currentTime=0;this.paused=true;this.playCount=0;this.listeners={};FakeAudio.instances.push(this);}
  addEventListener(type,handler){this.listeners[type]=handler;}
  play(){this.paused=false;this.playCount++;return Promise.resolve();}
  pause(){this.paused=true;}
}
const fakeWindow=(reduced=false)=>({
  document:{hidden:false,addEventListener(){}},addEventListener(){},matchMedia:()=>({matches:reduced})
});
const makeManager=({navigator={},reduced=false,now=()=>1000}={})=>new AudioManager({window:fakeWindow(reduced),navigator,Audio:FakeAudio,audioContextFactory:()=>new FakeAudioContext(),now});

const signature=plan=>plan.map(({source,from,to,duration,type,highpass})=>[source,from,to,duration,type,highpass]);

test('all six trainer skills have distinct layered procedural cues',()=>{
  const ids=['haste','exhaust','barrier','heal','cleanse','ignite'];
  const plans=ids.map(id=>buildCuePlan(`trainer:${id}`));
  assert.equal(new Set(plans.map(plan=>JSON.stringify(signature(plan)))).size,ids.length);
  assert.ok(plans.every(plan=>plan.length>=3));
  assert.notDeepEqual(signature(buildCuePlan('cast',{kind:'beam',element:'electric'})),signature(buildCuePlan('cast',{kind:'pulse',element:'water'})));
});

test('vibration patterns are bounded by entries, pulse duration, and total duration',()=>{
  const pattern=normalizeVibrationPattern([500,250,180,160,140,130,120,110,100]);
  assert.ok(pattern.length<=7);
  assert.ok(pattern.every(value=>value>=0&&value<=120));
  assert.ok(pattern.reduce((sum,value)=>sum+value,0)<=420);
  assert.deepEqual(normalizeVibrationPattern(-50),[0]);
});

test('unsupported haptics stay truthful and never create fake requests',async()=>{
  const audio=makeManager();await audio.unlock();
  assert.doesNotThrow(()=>audio.handleBattleEvent({type:'evade',team:'player'},{}));
  const state=audio.getFeedbackState();
  assert.equal(state.vibrationSupported,false);
  assert.equal(state.gamepadHapticsSupported,false);
  assert.equal(state.hapticsSupported,false);
  assert.equal(state.effectiveHapticsEnabled,false);
  assert.equal(state.hapticRequestCount,0);
  assert.equal(state.hapticEmissionCount,0);
});

test('disabled, reduced-motion, and paused states suppress haptic requests',async()=>{
  const calls=[];const nav={vibrate:pattern=>{calls.push(pattern);return true;}};
  const audio=makeManager({navigator:nav});await audio.unlock();
  audio.setHapticsEnabled(false);audio.handleBattleEvent({type:'evade',team:'player'},{});
  audio.setHapticsEnabled(true);audio.pause();const afterPause=calls.length;audio.handleBattleEvent({type:'hit',victimTeam:'player',critical:true,amount:100},{});
  assert.equal(calls.length,afterPause);assert.equal(audio.getFeedbackState().hapticRequestCount,0);
  const reduced=makeManager({navigator:nav,reduced:true});await reduced.unlock();const beforeReduced=calls.length;reduced.handleBattleEvent({type:'dodge',team:'player'},{});
  assert.equal(calls.length,beforeReduced);assert.equal(reduced.getFeedbackState().effectiveHapticsEnabled,false);
});

test('gamepad rumble is only reported when a real actuator exists and resolves',async()=>{
  const effects=[];const actuator={playEffect:(type,options)=>{effects.push({type,options});return Promise.resolve('complete');}};
  const audio=makeManager({navigator:{getGamepads:()=>[{vibrationActuator:actuator}]}});await audio.unlock();
  assert.equal(audio.getFeedbackState().gamepadHapticsSupported,true);
  audio.handleBattleEvent({type:'dodge',team:'player'},{});await Promise.resolve();
  assert.equal(effects.length,1);assert.equal(effects[0].type,'dual-rumble');assert.equal(audio.getFeedbackState().hapticRequestCount,1);assert.equal(audio.getFeedbackState().hapticEmissionCount,1);
});

test('ultimate feedback emits audible anticipation, bounded hardware vibration, and diagnostics',async()=>{
  const calls=[];const nav={vibrate:pattern=>{calls.push(pattern);return true;}};let now=1000;
  const audio=makeManager({navigator:nav,now:()=>now});await audio.unlock();
  const battle={player:{id:'pikachu',def:{type:'electric',moves:{r:{kind:'beam',element:'electric'}}}}};
  assert.equal(audio.handleBattleEvent({type:'cast',team:'player',key:'r',id:'pikachu'},battle),true);
  const state=audio.getFeedbackState();
  assert.equal(state.lastCue,'cast:ultimate');assert.equal(state.emittedSoundCount,1);assert.equal(state.hapticRequestCount,1);assert.equal(state.hapticEmissionCount,1);
  assert.ok(Array.isArray(calls[0]));assert.ok(calls[0].every(value=>value<=120));assert.ok(calls[0].reduce((sum,value)=>sum+value,0)<=420);
  now+=500;audio.handleBattleEvent({type:'beam',team:'player',element:'electric'},battle);assert.equal(audio.getFeedbackState().lastCue,'ultimate:release');
});

test('enriched event kind and ultimate fields drive feedback without battle lookup',async()=>{
  const audio=makeManager();await audio.unlock();
  audio.handleBattleEvent({type:'cast',team:'player',key:'q',kind:'field',element:'grass'},null);assert.equal(audio.getFeedbackState().lastCue,'cast');
  audio.handleBattleEvent({type:'fieldAttack',team:'enemy',kind:'fan',element:'fire'},null);assert.equal(audio.getFeedbackState().lastCue,'release');
  audio.handleBattleEvent({type:'beam',team:'enemy',kind:'beam',element:'ice',ultimate:true},null);assert.equal(audio.getFeedbackState().lastCue,'ultimate:release');
});

test('music unlock/start and independent music/SFX mute-volume behavior remain compatible',async()=>{
  FakeAudio.instances.length=0;const audio=makeManager();
  assert.equal(await audio.unlock(),true);assert.equal(audio.music.playCount,0,'unlock must not start music');
  audio.setVolume(.7);audio.setSfxVolume(.4);assert.equal(audio.music.volume,.7);assert.equal(audio.sfxGain.gain.value,.4);
  audio.ui('confirm');assert.equal(audio.getFeedbackState().emittedSoundCount,1);
  assert.equal(audio.toggle(),true);assert.equal(audio.sfxGain.gain.value,0);audio.ui('error');assert.equal(audio.getFeedbackState().emittedSoundCount,1);
  assert.equal(audio.toggle(),false);assert.equal(audio.sfxGain.gain.value,.4);await audio.start();assert.ok(audio.music.playCount>=1);
  const state=audio.getFeedbackState();assert.equal(state.musicVolume,.7);assert.equal(state.sfxVolume,.4);assert.equal(state.muted,false);
});

test('ui pick supports local cries and fades the previous cry instead of stacking it',async()=>{
  FakeAudio.instances.length=0;const audio=makeManager();await audio.unlock();
  audio.ui('pick',{dex:25});const firstCry=FakeAudio.instances.find(item=>item.src.endsWith('/25.ogg'));assert.ok(firstCry);assert.equal(firstCry.paused,false);
  audio.ui('pick',{dex:6});const secondCry=FakeAudio.instances.find(item=>item.src.endsWith('/6.ogg'));assert.ok(secondCry);assert.equal(audio.getFeedbackState().lastCryDex,6);
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(firstCry.paused,true);assert.equal(secondCry.paused,false);
});

test('Yuna selection plays her own meow and fades between guest and Pokémon cries',async()=>{
  FakeAudio.instances.length=0;const audio=makeManager();await audio.unlock();
  audio.ui('pick',ROSTER_BY_ID.pikachu);const pikachu=audio._cry;
  audio.ui('pick',ROSTER_BY_ID.yuna);const meow=audio._cry;
  assert.equal(meow.src,'/assets/audio/cries/yuna.wav');assert.equal(meow.paused,false);
  assert.equal(audio.getFeedbackState().lastCryDex,null);assert.equal(audio.getFeedbackState().lastCryId,'yuna');
  audio.ui('pick',ROSTER_BY_ID.yuna);const repeated=audio._cry;
  meow.listeners.ended();assert.equal(audio._cry,repeated,'an older clip ending must not clear the new cry');
  await new Promise(resolve=>setTimeout(resolve,75));assert.equal(pikachu.paused,true);assert.equal(meow.paused,true);assert.equal(repeated.paused,false);
  audio.toggle();assert.equal(repeated.paused,true);const before=FakeAudio.instances.length;
  audio.ui('pick',ROSTER_BY_ID.yuna);assert.equal(FakeAudio.instances.length,before,'muted selection stays silent');
  audio.toggle();audio.setSfxVolume(0);audio.ui('pick',ROSTER_BY_ID.yuna);assert.equal(FakeAudio.instances.length,before,'zero SFX volume stays silent');
});

test('Yuna uses the same cry playback on switch and stops when battle audio pauses',async()=>{
  const audio=makeManager();await audio.unlock();
  audio.handleBattleEvent({type:'switch',team:'player',id:'yuna'},{player:{id:'yuna',def:ROSTER_BY_ID.yuna}});
  const meow=audio._cry;assert.equal(meow.src,'/assets/audio/cries/yuna.wav');assert.equal(meow.playCount,1);
  audio.pause();await new Promise(resolve=>setTimeout(resolve,75));assert.equal(meow.paused,true);assert.equal(audio.getFeedbackState().cryPlaying,false);
});

test('failed or preempted gamepad effects do not count as successful hardware feedback',async()=>{
  for(const outcome of [false,'preempted']){const audio=makeManager({navigator:{getGamepads:()=>[{vibrationActuator:{playEffect:()=>Promise.resolve(outcome)}}]}});await audio.unlock();audio.handleBattleEvent({type:'dodge',team:'player'},{});await Promise.resolve();assert.equal(audio.getFeedbackState().hapticRequestCount,1);assert.equal(audio.getFeedbackState().hapticEmissionCount,0);}
});
test('suspended audio contexts are not reported as unlocked',async()=>{
  const audio=makeManager();await audio.unlock();audio.ctx.state='suspended';assert.equal(audio.getFeedbackState().unlocked,false);assert.equal(audio.getFeedbackState().contextState,'suspended');
});

test('confirmed skill contact preempts cast rumble and is not cut short by release or periodic damage',async()=>{
 let now=1000;const calls=[],audio=makeManager({navigator:{vibrate:p=>{calls.push(p);return true;}},now:()=>now});await audio.unlock();audio.handleBattleEvent({type:'cast',team:'player',key:'q',kind:'slash'},{});now+=20;audio.handleBattleEvent({type:'hit',team:'player',victimTeam:'enemy',amount:90,critical:true},{});assert.equal(calls.length,2);assert.equal(audio.lastHaptic.cue,'hit');now+=20;audio.handleBattleEvent({type:'slash',team:'player'},{});audio.handleBattleEvent({type:'hit',team:'player',periodic:true},{});audio.handleBattleEvent({type:'hit',team:'player',basic:true},{});assert.equal(calls.length,2);now+=100;audio.handleBattleEvent({type:'hit',team:'player',amount:40},{});assert.equal(calls.length,3);
});
test('victory and defeat replace battle music, honor volume and mute, and stop on rematch',async()=>{
 const audio=makeManager();await audio.start();audio.setVolume(.4);audio.handleBattleEvent({type:'end',won:true},{});assert.equal(audio.music.paused,true);assert.match(audio.resultMusic.src,/arena-victory.wav$/);assert.equal(audio.resultMusic.volume,.4);assert.equal(audio.resultMusic.paused,false);audio.toggle();assert.equal(audio.resultMusic.muted,true);audio.toggle();const victory=audio.resultMusic;await audio.start();assert.equal(victory.paused,true);assert.equal(audio.resultMusic,null);assert.equal(audio.music.paused,false);audio.handleBattleEvent({type:'end',won:false},{});assert.match(audio.resultMusic.src,/arena-defeat.wav$/);audio.handleBattleEvent({type:'reset'},{});assert.equal(audio.resultMusic,null);
});
