import test from 'node:test';
import assert from 'node:assert/strict';

import {cappedCount,drawCombatVfx,elementFamily,pushCapped,vfxProfile,VFX_EVENT_CAP,VFX_PARTICLE_CAP} from '../src/combat-vfx.js';
import {Renderer} from '../src/renderer.js';
import {ROSTER} from '../src/roster.js';

const VALID_FAMILIES=new Set(['fire','water','electric','psychic','ice','physical','nature','toxic','wind','shadow','dragon']);

function mockContext(){
  const target={measureText:text=>({width:String(text).length*7})};
  return new Proxy(target,{get(object,key){if(key in object)return object[key];const fn=()=>{};object[key]=fn;return fn;},set(object,key,value){object[key]=value;return true;}});
}

function mockRenderer(){
  const ctx=mockContext(),player={id:'pikachu',team:'player',x:360,y:410,hp:680,radius:18,def:ROSTER[0]},enemy={id:'charizard',team:'enemy',x:780,y:410,hp:810,radius:26,def:ROSTER[1]};
  const battle={state:'playing',hitStop:0,lastStepDt:1/60,player,enemy,projectiles:[],hazards:[],windups:[],moves:player.def.moves};
  return {ctx,battle,renderer:new Renderer({getContext:()=>ctx},{},battle)};
}

test('all character kits resolve to finite kind and element VFX profiles',()=>{
  assert.equal(ROSTER.length,51);
  for(const mon of ROSTER){
    for(const [key,move] of Object.entries(mon.moves)){
      const profile=vfxProfile({kind:move.kind,element:move.element||mon.type,damage:move.damage,key,ultimate:key==='r'});
      assert.equal(profile.kind,move.kind,`${mon.id}.${key} kind`);
      assert.ok(VALID_FAMILIES.has(profile.family),`${mon.id}.${key} family`);
      assert.ok(profile.anticipation>0&&profile.release>0&&profile.impact>0,`${mon.id}.${key} phase durations`);
      assert.ok(Number.isFinite(profile.power)&&Number.isFinite(profile.shake)&&Number.isFinite(profile.recoil),`${mon.id}.${key} finite feedback`);
      assert.equal(profile.ultimate,key==='r'||['storm','nova'].includes(move.kind),`${mon.id}.${key} ultimate`);
    }
  }
});

test('unknown profile data falls back safely',()=>{
  const profile=vfxProfile({kind:'unimplemented',element:'mystery',damage:Number.NaN});
  assert.deepEqual({kind:profile.kind,element:profile.element,family:profile.family},{kind:'bolt',element:'normal',family:'physical'});
  assert.equal(elementFamily(), 'physical');
  assert.equal(elementFamily('missing'), 'physical');
});

test('event and particle cap helpers retain newest work without overflow',()=>{
  const events=[];
  for(let i=0;i<VFX_EVENT_CAP+35;i++)pushCapped(events,{i});
  assert.equal(events.length,VFX_EVENT_CAP);
  assert.equal(events[0].i,35);
  assert.equal(events.at(-1).i,VFX_EVENT_CAP+34);
  assert.equal(cappedCount(200, VFX_PARTICLE_CAP-12),12);
  assert.equal(cappedCount(20,0,VFX_PARTICLE_CAP,.45),9);
  assert.equal(cappedCount(-2,0),0);
});

test('combat effect drawing covers every elemental treatment without throwing',()=>{
  const ctx=mockContext(),families=[...VALID_FAMILIES],types=['castAnticipation','releaseStroke','dashTrail','elementImpact','ultimateFocus'];
  for(const family of families)for(const type of types){
    assert.equal(drawCombatVfx(ctx,{type,x:100,y:100,angle:.3,color:'#abcdef',family,power:1.1,r:54,length:80,width:20,life:.2,maxLife:.4},{time:1.2}),true,`${family} ${type}`);
  }
  assert.equal(drawCombatVfx(ctx,{type:'unknown'}),false);
  assert.equal(drawCombatVfx(null,{type:'elementImpact'}),false);
});

test('renderer integrates cast phases, capped impact feedback, recoil, and motion toggle',()=>{
  const {renderer}=mockRenderer();
  const inferredUltimate=renderer.profileForEvent({id:'dragonite',name:'Hyper Beam',kind:'beam',damage:315,element:'normal'},'beam');
  assert.equal(inferredUltimate.ultimate,true);
  renderer.event({type:'cast',team:'player',key:'r',id:'pikachu',element:'electric',color:'#f1d36e',x:360,y:410,targetX:780,targetY:410});
  assert.ok(renderer.effects.some(effect=>effect.type==='castAnticipation'));
  assert.ok(renderer.effects.some(effect=>effect.type==='ultimateFocus'));
  renderer.event({type:'hit',x:780,y:410,amount:120,team:'player',victimTeam:'enemy',angle:0,element:'electric',color:'#f1d36e',critical:true});
  assert.ok(renderer.effects.some(effect=>effect.type==='elementImpact'&&effect.family==='electric'));
  assert.ok(renderer.recoils.has('enemy'));
  assert.equal(renderer.getFeedbackDiagnostics().impactCount,1);
  renderer.update(1/60);
  assert.ok(renderer.getFeedbackDiagnostics().peakCameraImpulse>0);
  for(const effect of renderer.effects)renderer.drawEffect(effect);
  for(let i=0;i<400;i++)renderer.addEffect({type:'elementImpact',x:0,y:0,life:.2});
  renderer.burst(0,0,'#fff',VFX_PARTICLE_CAP*2,100,'ice');
  assert.equal(renderer.effects.length,VFX_EVENT_CAP);
  assert.equal(renderer.particles.length,VFX_PARTICLE_CAP);

  renderer.setMotionEnabled(false);
  const before=renderer.getFeedbackDiagnostics();
  renderer.event({type:'hit',x:780,y:410,amount:90,team:'player',victimTeam:'enemy',angle:0,element:'fire',color:'#ffa06a'});
  renderer.update(1/60);
  const after=renderer.getFeedbackDiagnostics();
  assert.equal(before.motionEnabled,false);
  assert.equal(after.motionEnabled,false);
  assert.equal(after.cameraImpulse,0);
  assert.equal(renderer.recoils.size,0);
});

test('all roster moves render layered cast, release and contact effects within mobile budgets',()=>{
 const {renderer}=mockRenderer();renderer.setViewport(400,570,{mobile:true,dpr:2,insets:{top:100}});
 for(const mon of ROSTER)for(const [key,move] of Object.entries(mon.moves)){
  renderer.event({type:'cast',id:mon.id,team:'player',key,kind:move.kind,element:move.element||mon.type,x:360,y:410,targetX:780,targetY:410});
  renderer.event({type:'hit',team:'player',victimTeam:'enemy',amount:move.damage||30,element:move.element||mon.type,x:780,y:410});
  for(const effect of renderer.effects)renderer.drawEffect(effect);
 }
 assert.ok(renderer.effects.some(e=>e.type==='skillSigil'));assert.ok(renderer.effects.some(e=>e.type==='impactBloom'));assert.ok(renderer.particles.length<=360);assert.ok(renderer.effects.length<=120);
});
