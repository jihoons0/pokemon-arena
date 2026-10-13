import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Battle,BOUNDS} from '../src/battle.js';
import {ROSTER_BY_ID} from '../src/roster.js';
import {PROTOCOL,encodeBattle,applyBattleState,checkpointBattle,restoreBattle,predictMotion} from '../src/net-state.js';
import {Match,validParty} from '../server/match.js';
import {setLocale} from '../src/i18n/i18n.js';

const step=1/60;
function fixture(side='player'){
  const battle=new Battle({mode:'pvp',playerId:side==='player'?'yuna':'snorlax',enemyId:side==='enemy'?'yuna':'snorlax'});
  battle.state='playing';battle.place(battle.player,300,400);battle.place(battle.enemy,650,400);
  for(const fighter of [battle.player,battle.enemy])fighter.basicTimer=100;
  battle.drainEvents();return {battle,yuna:battle.source(side),target:battle.target(side)};
}
function advance(battle,seconds){for(let t=0;t<seconds-1e-8;t+=step)battle.update(step);}

test('Yuna is an original Siamese guest with the requested four independent skills',()=>{
  const yuna=ROSTER_BY_ID.yuna;
  assert.equal(yuna.name,'Yuna');assert.equal(yuna.ko,'유나');assert.equal(yuna.custom,true);assert.equal(yuna.dex,null);
  assert.deepEqual(['q','w','e','r'].map(key=>yuna.moves[key].ko),['토하기','할퀴기','전광석화','파괴광선']);
  assert.deepEqual(['q','w','e','r'].map(key=>yuna.moves[key].kind),['bolt','slash','blinkStrike','beam']);
  assert.equal(yuna.moves.r.initialCooldown,30);
  assert.equal(validParty(['yuna','pikachu','charizard','blastoise','venusaur','gengar']),true);
});
test('Yuna names, roles and skill descriptions work in every supported language',async()=>{
  try{
    for(const [locale,name] of [['ko','유나'],['en','Yuna'],['ja','ユナ'],['es','Yuna'],['zh','尤娜']]){
      await setLocale(locale);const yuna=ROSTER_BY_ID.yuna;
      assert.equal(yuna.displayName,name);assert.doesNotMatch(yuna.displayRole,/roles\./);assert.doesNotMatch(yuna.basic.displayName,/basics\./);
      for(const key of ['q','w','e','r']){
        assert.ok(yuna.moves[key].displayName);assert.ok(yuna.moves[key].description);
        assert.doesNotMatch(yuna.moves[key].displayName,/guestMoves\./);assert.doesNotMatch(yuna.moves[key].description,/guestMoves\.|\{range\}|\{charge\}/);
      }
    }
  }finally{await setLocale('ko');}
});
test('multiplayer rejects clients with the previous roster and snapshot protocol',()=>{
  assert.throws(()=>new Match().connect({v:PROTOCOL-1,newToken:'old-client',team:['yuna','pikachu','charizard','blastoise','venusaur','gengar'],special:'haste'}),/새로고침/);
});
test('Yuna has attributed original artwork and complete transparent directional sheets',()=>{
  const base=new URL('../public/assets/pokemon/yuna/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('animations.json',base),'utf8'));
  assert.equal(manifest.source.name,'Original Yuna artwork');assert.equal(manifest.pokemon.custom,true);
  const portrait=readFileSync(new URL('portrait/Normal.png',base));assert.equal(portrait.readUInt32BE(16),96);assert.equal(portrait.readUInt32BE(20),96);
  for(const key of ['idle','walk','attack','shoot','charge','quickstrike','hurt','faint']){
    const animation=manifest.animations[key],bytes=readFileSync(new URL('sprite/'+key+'-Anim.png',base));
    assert.equal(animation.directionCount,8);assert.equal(bytes.readUInt32BE(16),animation.frameWidth*animation.frameCount);
    assert.equal(bytes.readUInt32BE(20),animation.frameHeight*8);assert.equal(bytes[25],6,'RGBA transparency');
    assert.equal(animation.durationsFrames.length,animation.frameCount);
  }
  const credits=JSON.parse(readFileSync(new URL('../public/assets/sprite-credits.json',import.meta.url),'utf8'));
  assert.equal(credits.assets.yuna.custom,true);assert.match(credits.assets.yuna.suggestedDisplayCredit,/Not from PMD SpriteCollab/);
});
test('vomit travels as a projectile, deals damage and slows only on contact',()=>{
  const {battle,yuna,target}=fixture();battle.place(target,570,400);const hp=target.hp;
  assert.equal(battle.cast('q'),true);advance(battle,.15);
  assert.equal(battle.projectiles[0].type,'vomit');assert.equal(battle.projectiles[0].color,'#b4c46c');assert.equal(target.hp,hp);
  advance(battle,.5);assert.ok(target.hp<hp);assert.ok(target.slow>0);assert.equal(yuna.mp>0,true);
});
test('claws hit in melee range and do not damage a distant opponent',()=>{
  for(const gap of [90,300]){
    const {battle,yuna,target}=fixture();battle.place(target,yuna.x+gap,yuna.y);const hp=target.hp;
    assert.equal(battle.cast('w'),true);advance(battle,.15);assert.equal(target.hp<hp,gap===90);
  }
});
test('blink strike hides, hits exactly once beside the target and returns to its original position for either player',()=>{
  for(const side of ['player','enemy']){
    const {battle,yuna,target}=fixture(side),origin={x:yuna.x,y:yuna.y},hp=target.hp;
    assert.equal(battle.castFor(yuna,'e'),true);advance(battle,.1);
    assert.equal(yuna.blinkStrike.hidden,true);assert.deepEqual({x:yuna.x,y:yuna.y},origin);
    advance(battle,.12);assert.equal(yuna.blinkStrike.hidden,false);assert.ok(Math.hypot(yuna.x-target.x,yuna.y-target.y)<80);
    assert.equal(hp-target.hp,yuna.def.moves.e.damage);advance(battle,.45);
    assert.equal(hp-target.hp,yuna.def.moves.e.damage);assert.equal(yuna.blinkStrike,null);
    assert.deepEqual({x:yuna.x,y:yuna.y},origin);
    const events=battle.drainEvents();assert.equal(events.filter(event=>event.type==='blink').length,2);assert.equal(events.filter(event=>event.type==='slash').length,1);
  }
});
test('blink strike locks its target position and can miss an opponent who escapes',()=>{
  const {battle,target,yuna}=fixture(),hp=target.hp,origin={x:yuna.x,y:yuna.y};
  assert.equal(battle.cast('e'),true);battle.place(target,930,250);advance(battle,.7);
  assert.equal(target.hp,hp);assert.deepEqual({x:yuna.x,y:yuna.y},origin);assert.equal(yuna.blinkStrike,null);
});
test('out-of-range blink requests consume no MP or cooldown',()=>{
  const {battle,yuna,target}=fixture();battle.place(target,1000,400);
  assert.equal(battle.cast('e'),false);assert.equal(yuna.mp,100);assert.equal(yuna.cooldowns.e,0);assert.equal(battle.tasks.length,0);
});
test('other casts and manual replacement cannot cancel a blink before the return',()=>{
  const {battle}=fixture();battle.configure({playerTeam:['yuna','pikachu']});battle.state='playing';
  battle.place(battle.player,400,400);battle.place(battle.enemy,650,400);battle.player.basicTimer=battle.enemy.basicTimer=100;
  assert.equal(battle.cast('e'),true);advance(battle,.22);const current=battle.player;
  assert.equal(battle.cast('q'),false);assert.equal(battle.cast('d'),false);assert.equal(battle.requestSwitch(),false);assert.equal(battle.switchFor('player',1),false);
  advance(battle,.45);assert.equal(current.x,400);assert.equal(current.y,400);assert.equal(current.blinkStrike,null);
  assert.equal(battle.requestSwitch(),true);assert.equal(battle.switchPokemon(1),true);
});
test('online party menus cannot freeze an in-progress blink before Yuna returns',()=>{
  const {battle}=fixture();battle.cast('e');advance(battle,.22);
  const match=new Match();match.battle=battle;match.phase='playing';
  assert.equal(match.pause(0,'switch'),false);assert.equal(battle.state,'playing');assert.equal(match.pauseInfo,null);
});
test('blink positions respect arena bounds, including an opponent against a wall',()=>{
  for(const [x,y] of [[BOUNDS.right-31,400],[BOUNDS.left+31,400],[600,BOUNDS.top+31],[600,BOUNDS.bottom-31]]){
    const {battle,yuna,target}=fixture();battle.place(target,x,y);battle.place(yuna,x<600?x+250:x-250,y);
    const origin={x:yuna.x,y:yuna.y};assert.equal(battle.cast('e'),true);
    for(let i=0;i<45;i++){
      battle.update(step);assert.ok(yuna.x>=BOUNDS.left+yuna.radius&&yuna.x<=BOUNDS.right-yuna.radius);assert.ok(yuna.y>=BOUNDS.top+yuna.radius&&yuna.y<=BOUNDS.bottom-yuna.radius);
    }
    assert.deepEqual({x:yuna.x,y:yuna.y},origin);
  }
});
test('pausing freezes the blink and a final knockout cannot strand Yuna at the target',()=>{
  const {battle,yuna,target}=fixture(),origin={x:yuna.x,y:yuna.y};assert.equal(battle.cast('e'),true);advance(battle,.1);
  battle.pause();const before=structuredClone(yuna.blinkStrike);advance(battle,2);assert.deepEqual(yuna.blinkStrike,before);
  battle.state='playing';target.hp=1;advance(battle,.2);assert.equal(battle.state,'won');assert.equal(yuna.blinkStrike,null);assert.deepEqual({x:yuna.x,y:yuna.y},origin);
});
test('beam charges before damage and keeps its 30-second initial ultimate cooldown',()=>{
  const {battle,yuna,target}=fixture(),hp=target.hp;assert.equal(battle.cast('r'),false);
  yuna.cooldowns.r=0;assert.equal(battle.cast('r'),true);advance(battle,.7);assert.equal(target.hp,hp);advance(battle,.2);assert.ok(target.hp<hp);
});
test('knocking out a CPU partner restores the origin before the next-opponent transition',()=>{
  const battle=new Battle({playerId:'yuna',enemyTeam:['snorlax','pikachu']});battle.state='playing';
  battle.place(battle.player,400,400);battle.place(battle.enemy,650,400);battle.player.basicTimer=battle.enemy.basicTimer=100;
  battle.enemy.hp=1;assert.equal(battle.cast('e'),true);advance(battle,.25);
  assert.equal(battle.state,'transition');assert.equal(battle.player.blinkStrike,null);assert.equal(battle.player.x,400);assert.equal(battle.player.y,400);
});
test('network snapshots and checkpoints preserve a blink without client-side damage or movement',()=>{
  const {battle,yuna}=fixture();assert.equal(battle.cast('e'),true);advance(battle,.22);
  const state=encodeBattle(battle),guest=applyBattleState(new Battle(),state,'enemy'),restored=restoreBattle(checkpointBattle(battle));
  assert.deepEqual(guest.enemy.blinkStrike,yuna.blinkStrike);assert.deepEqual(restored.player.blinkStrike,yuna.blinkStrike);
  const predicted=structuredClone(Object.fromEntries(Object.entries(yuna).filter(([key])=>key!=='def'))),position={x:predicted.x,y:predicted.y},hp=predicted.hp;
  predictMotion(predicted,step,{x:1,y:0},battle.enemy);assert.deepEqual({x:predicted.x,y:predicted.y},position);assert.equal(predicted.hp,hp);
  advance(restored,.5);assert.equal(restored.player.blinkStrike,null);assert.equal(restored.player.x,300);assert.equal(restored.player.y,400);
});
