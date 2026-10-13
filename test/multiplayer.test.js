import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import {ROSTER} from '../src/roster.js';
import {Match,validParty} from '../server/match.js';
import {PROTOCOL,encodeBattle,applyBattleState,checkpointBattle,restoreBattle,STEP,predictMotion} from '../src/net-state.js';
const team=ROSTER.slice(0,6).map(m=>m.id);
function setup(){
  let time=100000;const messages=[[],[]];const match=new Match({now:()=>time,send:(seat,m)=>messages[seat].push(structuredClone(m))});
  for(let seat=0;seat<2;seat++){match.connect({v:PROTOCOL,newToken:'token'+seat,team,special:'haste'});match.welcome(seat);match.receive(seat,{type:'ready'});}
  for(let seat=0;seat<2;seat++)match.receive(seat,{type:'loaded',game:match.game});
  function advance(seconds){for(let t=0;t<seconds-.000001;t+=STEP){time+=STEP*1000;match.advance(STEP);}}
  const seq=[0,0],action=[0,0];
  function send(seat,commands=[],x=0,y=0){match.receive(seat,{type:'input',game:match.game,seq:++seq[seat],x,y,commands:commands.map(c=>({...c,id:++action[seat]}))});}
  advance(3.1);return {match,messages,advance,send,now:()=>time};
}
test('two parties must load before the authoritative three-second start',()=>{
  const match=new Match();for(let i=0;i<2;i++){match.connect({v:PROTOCOL,newToken:String(i),team,special:'haste'});match.receive(i,{type:'ready'});}
  assert.equal(match.phase,'loading');match.receive(0,{type:'loaded',game:match.game});assert.equal(match.battle,null);
  match.receive(1,{type:'loaded',game:match.game});assert.equal(match.battle.state,'countdown');assert.equal(match.battle.countdown,3);
});
test('human players have equal damage, movement, cooldown and projectile speed',()=>{
  const b=new Battle({mode:'pvp',difficulty:'master',playerId:'pikachu',enemyId:'pikachu'});b.state='playing';
  for(const side of ['player','enemy']){assert.equal(b.castFor(b[side],'q'),true);}
  assert.equal(b.player.cooldowns.q,b.enemy.cooldowns.q);assert.equal(b.tasks[0].delay,b.tasks[1].delay);
  b.tasks=[];const x=[b.player.x,b.enemy.x];b.update(STEP,{x:1,y:0},{x:1,y:0});
  assert.ok(Math.abs((b.player.x-x[0])-(b.enemy.x-x[1]))<.00001);
  b.damage(b.player,20,'enemy');b.damage(b.enemy,20,'player');assert.equal(b.player.hp,b.enemy.hp);
  assert.equal(b.projectileSpeed(b.player,500),b.projectileSpeed(b.enemy,500));assert.equal(b.hitStop,0);
});
test('remote player dodges in their own input direction',()=>{
  const b=new Battle({mode:'pvp'});b.state='playing';b.update(STEP,{x:1,y:0},{x:0,y:-1});
  b.castFor(b.enemy,'d');assert.equal(b.enemy.dash.dx,0);assert.equal(b.enemy.dash.dy,-1);
});
test('a human dodge breaks a basic attack tracking before the projectile launches',()=>{
  const b=new Battle({mode:'pvp',playerId:'pikachu',enemyId:'pikachu'});b.state='playing';b.player.x=400;b.enemy.x=650;
  assert.equal(b.tryBasic(b.player),true);const aim={...b.player.basicWindup.aim};
  b.inputs.enemy={x:0,y:-1};b.castFor(b.enemy,'d');b.enemy.y-=100;
  b.fireBasic(b.player);const shot=b.projectiles[0];assert.ok(shot);assert.equal(shot.homing,0);
  assert.ok(Math.abs(Math.atan2(shot.vy,shot.vx)-Math.atan2(aim.y-b.player.y,aim.x-b.player.x))<.000001);
});
test('pause freezes both players, projectiles, HP, cooldowns and clock for at most 60 seconds',()=>{
  const {match,send,advance}=setup();send(0,[{kind:'pause'}]);assert.equal(match.battle.state,'paused');
  const before=encodeBattle(match.battle);advance(59);assert.deepEqual(encodeBattle(match.battle),before);
  advance(1.1);assert.equal(match.battle.state,'countdown');assert.ok(match.battle.countdown>2.8);advance(3);assert.equal(match.battle.state,'playing');
});
test('either player can resume a pause and both see the same 3-2-1 state',()=>{
  const {match,send,advance,messages}=setup();send(1,[{kind:'pause'}]);send(0,[{kind:'resume'}]);
  assert.equal(match.battle.countdown,3);match.broadcastStates();assert.deepEqual(messages[0].at(-1).state,messages[1].at(-1).state);
  advance(2);assert.equal(match.battle.state,'countdown');advance(1.1);assert.equal(match.battle.state,'playing');
});
test('manual party selection pauses both sides and resumes with countdown after selection',()=>{
  const {match,send,advance}=setup();send(1,[{kind:'party'}]);const before=match.battle.time;
  assert.equal(match.pauseInfo.kind,'switch');advance(10);assert.equal(match.battle.time,before);
  send(0,[{kind:'switch',index:1}]);assert.equal(match.battle.activeIndices.player,0);
  send(1,[{kind:'switch',index:1}]);assert.equal(match.battle.activeIndices.enemy,1);assert.equal(match.battle.state,'countdown');assert.equal(match.battle.countdown,3);
});
test('unanswered manual selection automatically resumes at 15 seconds',()=>{
  const {match,send,advance}=setup();send(0,[{kind:'party'}]);advance(15.1);assert.equal(match.battle.state,'countdown');assert.equal(match.battle.activeIndices.player,0);
});
test('knockout pauses both sides and automatically chooses a living Pokemon after 15 seconds',()=>{
  const {match,advance}=setup();match.battle.damage(match.battle.player,99999,'enemy');match.collectEvents();
  assert.equal(match.battle.state,'paused');assert.deepEqual(match.pauseInfo.forced,[0]);const time=match.battle.time;
  advance(14);assert.equal(match.battle.time,time);advance(1.1);assert.equal(match.battle.activeIndices.player,1);assert.equal(match.battle.state,'countdown');
});
test('pause requests cannot extend the deadline and casts cannot damage a paused enemy',()=>{
  const {match,send,advance}=setup();send(0,[{kind:'pause'}]);const until=match.pauseInfo.until;advance(20);
  send(1,[{kind:'pause'},{kind:'cast',key:'q'}]);assert.equal(match.pauseInfo.until,until);assert.equal(match.battle.tasks.length,0);
});
test('resume token claims only its own seat; third player and forged credentials fail',()=>{
  const {match}=setup();assert.throws(()=>match.connect({v:PROTOCOL,newToken:'third',team,special:'haste'}));
  assert.throws(()=>match.connect({v:PROTOCOL,token:'wrong'}));match.disconnect(1);assert.equal(match.connect({v:PROTOCOL,token:'token1'}).seat,1);
});
test('disconnection stops movement and allows 30 seconds to reconnect before loss',()=>{
  const {match,send,advance}=setup();send(1,[],1,0);match.disconnect(1);const x=match.battle.enemy.x;advance(1);assert.equal(match.battle.enemy.x,x);
  advance(29.1);assert.equal(match.phase,'finished');assert.equal(match.battle.state,'won');
});
test('room hibernation preserves disconnect deadlines so empty rooms can be released',()=>{
  const {match,now}=setup();match.disconnect(0);const disconnectedAt=match.players[0].disconnectedAt;
  const restored=new Match({now:()=>now()+20000,saved:match.save()});
  assert.equal(restored.players[0].disconnectedAt,disconnectedAt);
  assert.equal(restored.players[1].disconnectedAt,now()+20000);
});
test('replayed actions, forged HP/position and invalid movement do not alter authority',()=>{
  const {match}=setup();const before=match.battle.player.hp;
  const message={type:'input',game:match.game,seq:1,x:0,y:0,hp:9999,xPosition:9999,commands:[{id:1,kind:'cast',key:'d'}]};
  match.receive(0,message);const used=match.battle.stats.movesUsed;match.receive(0,message);
  assert.equal(match.battle.stats.movesUsed,used);assert.equal(match.battle.player.hp,before);
  match.receive(0,{...message,seq:2,x:Infinity});assert.equal(match.controls[0].inputAck,1);
  assert.equal(validParty(Array(6).fill('pikachu')),false);assert.equal(validParty(['__proto__',...team.slice(1)]),false);
});
test('guest perspective swaps teams, utility cooldowns, result and damage statistics',()=>{
  const {match}=setup();match.battle.player.hp-=41;match.battle.utilityCooldowns.enemy.d=1.5;match.battle.stats.damageDealt=99;match.battle.rivalStats.damageTaken=99;
  const guest=applyBattleState(new Battle(),encodeBattle(match.battle),'enemy');
  assert.equal(guest.player.hp,match.battle.enemy.hp);assert.equal(guest.enemy.hp,match.battle.player.hp);assert.equal(guest.cooldowns.d,1.5);assert.equal(guest.stats.damageTaken,99);
  match.battle.finish(true);applyBattleState(guest,encodeBattle(match.battle),'enemy');assert.equal(guest.state,'lost');
});
test('checkpoint restores projectiles, queued attacks and party selection deadlines',()=>{
  const {match,send}=setup();send(0,[{kind:'cast',key:'q'}]);const saved=checkpointBattle(match.battle),restored=restoreBattle(saved);
  assert.deepEqual(restored.tasks,match.battle.tasks);assert.deepEqual(encodeBattle(restored),encodeBattle(match.battle));
  send(1,[{kind:'pause'}]);const copy=new Match({saved:match.save()});assert.deepEqual(copy.pauseInfo,match.pauseInfo);assert.equal(copy.battle.state,'paused');
});
test('client movement prediction matches server walk and dodge without predicting HP',()=>{
  const b=new Battle({mode:'pvp'});b.state='playing';b.player.x=300;b.enemy.x=950;
  for(const dodge of [false,true]){
    b.input={x:1,y:0};b.inputs.player=b.input;if(dodge)b.castFor(b.player,'d');
    const f=structuredClone(Object.fromEntries(Object.entries(b.player).filter(([k])=>k!=='def'))),hp=f.hp;
    for(let i=0;i<10;i++){b.update(STEP,{x:1,y:0});predictMotion(f,STEP,{x:1,y:0},b.enemy);}
    assert.ok(Math.abs(f.x-b.player.x)<.001);assert.equal(f.hp,hp);
  }
});

test('v1 room checkpoints keep cooldowns, MP, burn attribution and party indices after an upgrade',()=>{
  const {match}=setup();match.battle.player.mp=23;match.battle.player.burnSourceId='charizard';match.battle.player.cooldowns.q=4.2;
  const saved=match.save();saved.battle.state.v=1;
  for(const fighters of saved.battle.state.teams)for(const values of fighters)values.pop();
  for(const player of saved.players)delete player.protocol;
  const restored=new Match({saved});
  assert.equal(restored.battle.player.mp,23);assert.equal(restored.battle.player.cooldowns.q,4.2);
  assert.equal(restored.battle.player.burnSourceId,'charizard');assert.equal(restored.battle.player.blinkStrike,null);
  assert.deepEqual(restored.battle.activeIndices,match.battle.activeIndices);
});
test('legacy players may reconnect to finish their battle but cannot start a rematch until both refresh',()=>{
  const {match,messages}=setup();for(const player of match.players)player.protocol=1;
  match.disconnect(1);assert.equal(match.connect({v:1,token:'token1'}).seat,1);
  match.end(true,'test');match.receive(0,{type:'ready'});assert.equal(match.phase,'finished');
  assert.match(messages[0].at(-1).message,/새로고침/);
  match.connect({v:PROTOCOL,token:'token0'});match.connect({v:PROTOCOL,token:'token1'});
  match.receive(0,{type:'ready'});match.receive(1,{type:'ready'});assert.equal(match.phase,'loading');
  assert.throws(()=>new Match().connect({v:1,newToken:'old',team,special:'haste'}),/새로고침/);
});
