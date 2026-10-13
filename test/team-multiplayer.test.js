import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle,BATTLE_SIDES,allied} from '../src/battle.js';
import {ROSTER,DIFFICULTIES} from '../src/roster.js';
import {Match} from '../server/match.js';
import {PROTOCOL,STEP,encodeBattle,applyBattleState,checkpointBattle,restoreBattle,localEvent} from '../src/net-state.js';
const team=ROSTER.slice(0,6).map(p=>p.id);
function room(humans=4,difficulty='standard'){
  let time=100000;const messages=Array.from({length:4},()=>[]),match=new Match({teamSize:2,now:()=>time,send:(seat,m)=>messages[seat].push(structuredClone(m))});
  for(let seat=0;seat<humans;seat++)match.connect({v:PROTOCOL,newToken:'token'+seat,team,special:'haste',name:'Trainer '+seat});
  for(let seat=humans;seat<4;seat++)match.receive(0,{type:'bot',seat,difficulty});
  for(let seat=0;seat<humans;seat++)match.receive(seat,{type:'ready'});
  for(let seat=0;seat<humans;seat++)match.receive(seat,{type:'loaded',game:match.game});
  const advance=seconds=>{for(let t=0;t<seconds-.00001;t+=STEP){time+=STEP*1000;match.advance(STEP);}};
  const seq=[0,0,0,0],action=[0,0,0,0],send=(seat,commands=[],x=0,y=0)=>match.receive(seat,{type:'input',game:match.game,seq:++seq[seat],x,y,commands:commands.map(c=>({...c,id:++action[seat]}))});
  advance(3.1);return {match,messages,advance,send};
}
function arena(){const b=new Battle({mode:'pvp',teamSize:2,playerTeam:team,enemyTeam:team,allyTeam:team,rivalTeam:team});b.state='playing';return b;}
test('four humans load into four independent parties and simultaneous movement',()=>{
  const {match,send,advance}=room();assert.equal(match.battle.fighters.length,4);assert.equal(Object.values(match.battle.teams).flat().length,24);
  const before=match.battle.fighters.map(f=>f.x);for(let seat=0;seat<4;seat++)send(seat,[],seat%2?-1:1,0);advance(.15);
  for(let i=0;i<4;i++)assert.ok((match.battle.source(BATTLE_SIDES[i]).x-before[i])*(i%2?-1:1)>10);
  assert.throws(()=>match.connect({v:PROTOCOL,newToken:'fifth',team,special:'haste'}));
});
test('allied attacks cannot damage, debuff or consume shields; opponents can both be hit',()=>{
  const b=arena(),ally=b.source('ally');ally.shield=80;const hp=ally.hp;assert.equal(b.damage(ally,100,'player',{burn:2,stun:1}),false);assert.equal(ally.hp,hp);assert.equal(ally.shield,80);assert.equal(ally.burn,0);
  for(const f of b.opponents('player')){f.x=700;f.y=400;}
  b.hazards=[{team:'player',x:700,y:400,r:180,delay:0,damage:100,life:1,triggered:false}];const targets=b.opponents('player'),before=targets.map(f=>f.hp);b.updateHazards(.02);
  assert.deepEqual(targets.map((f,i)=>before[i]-f.hp),[100,100]);assert.equal(ally.hp,hp);
});
test('beam strikes both enemies and projectile collisions ignore an intervening ally',()=>{
  const b=arena();b.player.x=350;b.player.y=400;
  b.source('ally').x=450;b.source('ally').y=400;b.source('enemy').x=600;b.source('enemy').y=400;b.source('rival').x=750;b.source('rival').y=400;
  const hp=b.opponents('player').map(f=>f.hp);b.resolveTask({kind:'beam',team:'player',x:350,y:400,angle:0,m:{damage:25,width:50,range:700}});assert.deepEqual(b.opponents('player').map((f,i)=>hp[i]-f.hp),[25,25]);
  b.source('enemy').stun=0;b.source('rival').stun=0;
  b.addProjectile({x:350,y:400,dir:{x:1,y:0},speed:1000,damage:20,team:'player',element:null});
  for(let i=0;i<6;i++)b.updateProjectiles(.05);
  assert.equal(b.source('ally').hp,b.source('ally').maxHp);assert.equal(b.source('enemy').hp,hp[0]-45);assert.equal(b.source('rival').hp,hp[1]-25);
});
test('manual target selection follows that enemy and retargets when it faints',()=>{
  const b=arena();assert.equal(b.selectTarget('player','ally'),false);assert.equal(b.selectTarget('player','rival'),true);assert.equal(b.target('player').team,'rival');
  b.source('rival').hp=0;b.faint(b.source('rival'));b.refreshTargets();assert.equal(b.enemy.team,'enemy');
});
test('one trainer eliminated does not end the team match; both trainers eliminated does',()=>{
  const b=arena();for(const f of b.teams.enemy)f.hp=0;b.faint(b.source('enemy'));assert.equal(b.state,'playing');assert.equal(b.target('player').team,'rival');
  for(const f of b.teams.rival)f.hp=0;b.faint(b.source('rival'));assert.equal(b.state,'won');
  const end=b.drainEvents().find(e=>e.type==='end');assert.equal(localEvent(end,2,4).won,true);assert.equal(localEvent(end,3,4).won,false);
});
test('every seat receives its own party, opponent target, cooldowns and statistics',()=>{
  const b=arena();b.selectTarget('ally','rival');for(const [i,side]of BATTLE_SIDES.entries()){b.source(side).mp=20+i*10;b.utilityCooldowns[side].s=i+1;b.statsFor(side).damageDealt=i*100;}
  const state=encodeBattle(b);
  for(let seat=0;seat<4;seat++){
    const local=applyBattleState(new Battle(),state,seat);assert.equal(local.player.mp,20+seat*10);assert.equal(local.cooldowns.s,seat+1);assert.equal(local.stats.damageDealt,seat*100);assert.equal(local.fighters.length,4);
    assert.equal(local.source('ally').mp,20+((seat+2)%4)*10);assert.equal(local.opponents('player').length,2);
    const event=localEvent({type:'hit',team:BATTLE_SIDES[seat],victimTeam:BATTLE_SIDES[1-seat%2]},seat,4);assert.equal(event.team,'player');assert.equal(event.victimTeam,'enemy');
  }
  assert.deepEqual(encodeBattle(restoreBattle(checkpointBattle(b))),state);
});
test('three humans plus AI use selected difficulty; only host can configure seats',()=>{
  const match=new Match({teamSize:2});for(let i=0;i<3;i++)match.connect({v:PROTOCOL,newToken:'token'+i,team,special:'haste'});
  match.receive(1,{type:'bot',seat:3,difficulty:'master'});assert.equal(match.players[3],null);
  match.receive(0,{type:'bot',seat:3,difficulty:'master'});assert.equal(match.players[3].difficulty,'master');
  match.receive(0,{type:'bot',seat:1,difficulty:'master'});assert.equal(match.players[1].bot,undefined);
  for(let i=0;i<3;i++)match.receive(i,{type:'ready'});assert.equal(match.phase,'loading');for(let i=0;i<2;i++)match.receive(i,{type:'loaded',game:match.game});assert.equal(match.battle,null);match.receive(2,{type:'loaded',game:match.game});
  assert.equal(match.battle.isCPU(match.battle.source('rival')),true);assert.equal(match.battle.difficultyFor(match.battle.source('rival')),DIFFICULTIES.master);
});
test('each AI level fights with independent state on either team',()=>{
  for(const difficulty of Object.keys(DIFFICULTIES)){
    const {match,advance}=room(1,difficulty),b=match.battle;for(const f of b.fighters){f.hp=f.maxHp=100000;f.x=500+(BATTLE_SIDES.indexOf(f.team)%2)*150;}
    advance(12);for(const side of ['enemy','ally','rival'])assert.ok(b.statsFor(side).movesUsed+b.statsFor(side).basicsFired>2,`${difficulty} ${side} acts`);
    assert.notEqual(b.botStates.ally.masterAI,b.botStates.rival.masterAI);
  }
});
test('pause and switch freeze all four and resume after the shared countdown',()=>{
  const {match,send,advance,messages}=room(3);send(2,[{kind:'pause'}]);const before=encodeBattle(match.battle);advance(10);assert.deepEqual(encodeBattle(match.battle),before);
  send(1,[{kind:'resume'}]);assert.equal(match.battle.countdown,3);advance(3.1);
  send(2,[{kind:'party'}]);assert.equal(match.pauseInfo.until-match.now(),15000);send(0,[{kind:'switch',index:1}]);assert.equal(match.battle.activeIndices.ally,0);send(2,[{kind:'switch',index:1}]);assert.equal(match.battle.activeIndices.ally,1);assert.equal(match.battle.state,'countdown');
  match.broadcastStates();assert.deepEqual(messages[0].at(-1).state,messages[2].at(-1).state);
});
test('AI knockout shares the switch countdown and does not wait for a nonexistent client',()=>{
  const {match}=room(3);const f=match.battle.source('rival');f.hp=0;match.battle.faint(f);match.collectEvents();assert.equal(match.battle.activeIndices.rival,1);assert.equal(match.pauseInfo,null);assert.equal(match.battle.state,'countdown');
});
test('swap changes socket seats through the transport callback and preserves host ownership',()=>{
  const swapped=[],match=new Match({teamSize:2,onSwap:(a,b)=>swapped.push([a,b])});for(let i=0;i<3;i++)match.connect({v:PROTOCOL,newToken:'token'+i,team,special:'haste'});
  match.receive(0,{type:'swap',a:0,b:1});assert.deepEqual(swapped,[[0,1]]);assert.equal(match.host,1);assert.equal(match.players[0].token,'token1');
  assert.equal(match.connect({token:'token0',v:PROTOCOL}).seat,1);match.receive(0,{type:'bot',seat:3,difficulty:'easy'});assert.equal(match.players[3],null);match.receive(1,{type:'bot',seat:3,difficulty:'easy'});assert.equal(match.players[3].bot,true);
});
test('disconnect can reconnect for 30 seconds; forfeiting one seat leaves their ally in play',()=>{
  const {match,advance}=room();match.disconnect(2);advance(2);assert.equal(match.connect({v:PROTOCOL,token:'token2'}).seat,2);
  match.disconnect(2);advance(30.1);assert.equal(match.phase,'playing');assert.ok(match.battle.teams.ally.every(f=>f.hp===0));assert.ok(match.battle.player.hp>0);
  match.receive(0,{type:'leave'});assert.equal(match.phase,'finished');assert.equal(match.battle.state,'lost');
});
test('hibernated four-seat room retains parties, bot settings, pause deadline and target selection',()=>{
  const {match,send}=room(3,'expert');send(2,[{kind:'target',seat:3},{kind:'pause'}]);const saved=match.save(),restored=new Match({saved,now:match.now});
  assert.equal(restored.players.length,4);assert.equal(restored.players[3].bot,true);assert.equal(restored.players[3].connected,true);assert.equal(restored.battle.target('ally').team,'rival');assert.deepEqual(restored.pauseInfo,match.pauseInfo);assert.deepEqual(encodeBattle(restored.battle),encodeBattle(match.battle));
});
test('dodge breaks both opponents tracking without erasing a shot aimed at the ally',()=>{
  const b=arena();b.player.x=600;b.player.y=400;b.source('enemy').x=700;b.source('enemy').y=340;b.source('rival').x=700;b.source('rival').y=460;
  for(const side of ['enemy','rival']){b.selectTarget(side,'player');assert.equal(b.tryBasic(b.source(side)),true);}
  b.addProjectile({team:'enemy',targetSide:'ally',x:700,y:340,dir:{x:-1,y:0},speed:200,damage:1,homing:10});
  b.breakTracking(b.player);for(const side of ['enemy','rival'])assert.equal(b.source(side).basicWindup.trackingBroken,true);assert.equal(b.projectiles[0].homing,10);
});
test('waiting disconnect releases that seat and transfers host after the reconnect window',()=>{
  let now=0;const match=new Match({teamSize:2,now:()=>now});for(let i=0;i<2;i++)match.connect({v:PROTOCOL,newToken:'token'+i,team,special:'haste'});
  match.disconnect(0);now=30001;match.advance(0);assert.equal(match.players[0],null);assert.equal(match.host,1);assert.equal(match.connect({v:PROTOCOL,newToken:'replacement',team,special:'haste'}).seat,0);
});
test('leaving during asset loading returns other players to a usable lobby',()=>{
  const match=new Match({teamSize:2});for(let i=0;i<4;i++){match.connect({v:PROTOCOL,newToken:'token'+i,team,special:'haste'});match.receive(i,{type:'ready'});}
  assert.equal(match.phase,'loading');match.receive(2,{type:'leave'});assert.equal(match.phase,'waiting');assert.equal(match.players[2],null);assert.equal(match.players[0].ready,false);
});
test('team results aggregate both trainers and choose MVP from the full allied party',async()=>{
  const {teamResult,pickMvp}=await import('../src/results.js');const b=arena();b.stats.damageDealt=100;b.stats.byPokemon.pikachu={damage:100,knockouts:1};b.stats.knockouts=1;b.statsFor('ally').damageDealt=900;b.statsFor('ally').knockouts=3;b.statsFor('ally').byPokemon.charizard={damage:900,knockouts:3};
  const result=teamResult(b);assert.equal(result.party.length,12);assert.equal(result.stats.damageDealt,1000);assert.equal(result.stats.knockouts,4);assert.equal(pickMvp(result.party,result.stats).id,'charizard');
});
