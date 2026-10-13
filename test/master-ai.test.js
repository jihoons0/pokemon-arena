import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle, distance, unit} from '../src/battle.js';
import {ROSTER, DIFFICULTIES} from '../src/roster.js';
const DT=1/120;
// The untouched legacy decision path plus its old tuning is a reproducible baseline.
class PriorMaster extends Battle {
  get difficulty(){return {...DIFFICULTIES.master,reaction:.38,basicWindup:.30,meleeWindup:.36,fieldWindup:.66,ultimateWindup:.84,recovery:.50,volleyInterval:.17,projectileSpeed:1.08,basicHoming:12,skillRate:.82,damage:1.18,lead:1.08,aggression:1.32};}
  updateAI(dt){const original=this.options.difficulty;this.options.difficulty='expert';try{super.updateAI(dt);}finally{this.options.difficulty=original;}}
}
function live(enemyId='typhlosion',difficulty='master'){
  const Model=difficulty==='prior'?PriorMaster:Battle;const b=new Model({enemyId,difficulty:difficulty==='prior'?'master':difficulty,random:()=>.5});b.state='playing';b.player.basicTimer=1e6;b.drainEvents();return b;
}
function advance(b,t,input={x:0,y:0}){for(let i=0;i<Math.ceil(t/DT);i++)b.update(DT,input);}
function pressure(difficulty,mode,enemyId='typhlosion',phase=0){
  const b=live(enemyId,difficulty);let warningAt=null,attacks=0,dodges=0,elapsed=0;
  while(b.time<25&&b.state==='playing'&&elapsed++<120*35){
    const input=mode==='circle'?{x:Math.cos(b.time*1.2+phase),y:Math.sin(b.time*1.2+phase)}:unit(b.player.x-b.enemy.x,(b.player.y-b.enemy.y)+((b.time+phase)%4<2?65:-65));
    const warning=b.enemy.basicWindup||b.windups.find(w=>w.team==='enemy')||b.hazards.find(h=>h.team==='enemy'&&h.delay>0);
    if(warning&&warningAt===null)warningAt=b.time;else if(!warning)warningAt=null;
    if(warningAt!==null&&b.time-warningAt>=.22&&b.cooldowns.d===0){b.input=input;if(b.cast('d'))dodges++;}
    b.update(DT,input);
    for(const e of b.drainEvents())if(e.team==='enemy'&&(e.type==='basicWindup'||e.type==='cast'&&['q','w','e','r'].includes(e.key)))attacks++;
  }
  return {damage:b.stats.damageTaken,attacks,dodges,time:+b.time.toFixed(2)};
}
for(const mode of ['circle','kite'])test(`Master materially increases pressure against ${mode} plus 0.22s reaction D`,()=>{
  const champion=pressure('expert',mode),master=pressure('master',mode);
  console.log(JSON.stringify({strategy:mode,champion,master}));
  assert.ok(master.attacks>=champion.attacks*1.15,JSON.stringify({champion,master}));
  assert.ok(master.damage>=champion.damage*1.25,JSON.stringify({champion,master}));
  assert.ok(master.dodges>=3);
});
// Resource budgeting changes individual matchups. Sample four movement phases to guard
// overall difficulty without requiring one historical trajectory to improve for every kit.
for(const mode of ['circle','kite'])test(`Master sustains stronger pressure with limited MP across ranged and melee ${mode}+D`,()=>{
  let priorDamage=0,masterDamage=0,priorAttacks=0,masterAttacks=0;
  for(const enemy of ['typhlosion','scyther','feraligatr','ampharos']){
    const totals={prior:{damage:0,attacks:0},master:{damage:0,attacks:0}};
    for(const phase of [0,1,2,3])for(const difficulty of ['prior','master']){
      const result=pressure(difficulty,mode,enemy,phase);
      totals[difficulty].damage+=result.damage;totals[difficulty].attacks+=result.attacks;
    }
    const {prior,master}=totals;
    console.log(JSON.stringify({enemy,strategy:mode,phases:4,prior,master}));
    assert.ok(master.damage>=prior.damage*.9,enemy+' damage must remain competitive across phases');
    assert.ok(master.attacks>prior.attacks,enemy+' must retain more pressure');
    priorDamage+=prior.damage;masterDamage+=master.damage;priorAttacks+=prior.attacks;masterAttacks+=master.attacks;
  }
  assert.ok(masterDamage>priorDamage*1.15);assert.ok(masterAttacks>priorAttacks*1.15);
});
function idleEnemy(b){for(const k of ['q','w','e','r','s'])b.enemy.cooldowns[k]=100;b.enemy.basicTimer=100;b.aiDecision=100;}
function hazard(b,extra={}){const h={team:'player',type:'field',x:b.enemy.x,y:b.enemy.y,r:85,delay:.45,initialDelay:.45,life:2,maxLife:2,damage:50,dot:8,dotTimer:.55,triggered:false,...extra};b.hazards.push(h);return h;}
test('defense waits for a visible tell, uses real D, leaves danger, and cannot spam cooldown',()=>{
  const b=live();idleEnemy(b);const h=hazard(b);advance(b,.19);assert.equal(b.enemy.cooldowns.d,0);
  advance(b,.12);assert.ok(b.enemy.cooldowns.d>1.8);assert.equal(b.enemy.dash?.kind,'dodge');assert.equal(b.enemy.dash.distance,175);assert.equal(b.enemy.dash.invulEnd,.5);
  advance(b,.25);assert.ok(!b.insideHazard(h,b.enemy));const first=b.drainEvents().filter(e=>e.type==='dodge'&&e.team==='enemy');assert.equal(first.length,1);
  hazard(b);advance(b,.6);assert.equal(b.drainEvents().filter(e=>e.type==='dodge'&&e.team==='enemy').length,0);assert.ok(b.enemy.cooldowns.d>0);
});
test('Master guard reacts to danger when D is spent, not to hidden future tasks',()=>{
  const b=live('mewtwo');idleEnemy(b);b.enemy.cooldowns.w=0;b.enemy.cooldowns.d=1.8;
  b.schedule(1,'shot',{team:'player',m:b.player.def.moves.q,aim:{x:b.enemy.x,y:b.enemy.y}});
  advance(b,.3);assert.equal(b.enemy.shield,0);hazard(b);advance(b,.19);assert.equal(b.enemy.shield,0);advance(b,.1);assert.ok(b.enemy.shield>0);assert.equal(b.enemy.action?.kind,'guard');
});
test('defense does not cancel a committed attack or its explicit recovery',()=>{
  const b=live();idleEnemy(b);b.enemy.cooldowns.q=0;assert.ok(b.castFor(b.enemy,'q',{ai:true}));const action=b.enemy.action,aim={...action.aim};hazard(b);
  advance(b,.3);assert.equal(b.enemy.cooldowns.d,0);assert.equal(b.enemy.action,action);assert.deepEqual(action.aim,aim);assert.ok(action.duration-action.attackEnd>=.25);
  assert.equal(b.castFor(b.enemy,'d',{ai:true}),false);assert.equal(b.tryBasic(b.enemy),false);
});
test('visible beam direction triggers a delayed perpendicular dodge, not a cast-time read',()=>{
  const b=live('typhlosion');idleEnemy(b);b.place(b.player,430,395);b.place(b.enemy,740,395);
  const m={...b.player.def.moves.r,kind:'beam',range:900,width:80,charge:.7};
  b.player.def={...b.player.def,moves:{...b.player.def.moves,r:m}};b.player.cooldowns.r=0;assert.ok(b.cast('r'));
  advance(b,.19);assert.equal(b.enemy.cooldowns.d,0);advance(b,.2);assert.ok(b.enemy.cooldowns.d>0);advance(b,.4);assert.equal(b.stats.damageDealt,0);
});
test('safe routing avoids an active harmful zone rather than chasing through it',()=>{
  const b=live('scyther');idleEnemy(b);b.place(b.enemy,700,395);b.place(b.player,420,395);b.enemy.cooldowns.d=100;
  const h=hazard(b,{x:610,y:395,r:54,delay:0,triggered:true});advance(b,.25);const before=distance(b.enemy,h);advance(b,.5);
  assert.ok(!b.insideHazard(h,b.enemy));assert.ok(distance(b.enemy,h)>before-15);assert.equal(b.stats.damageDealt,0);
});
test('affordable moves are not stalled behind costly moves, and melee R is saved out of range',()=>{
  const b=live('heracross');b.place(b.enemy,650,400);b.place(b.player,470,400);b.enemy.cooldowns.r=0;b.enemy.mp=20;
  b.observeMaster();advance(b,.21);assert.notEqual(b.masterChooseMove(),'r');assert.equal(b.masterChooseMove(),'q');
  b.enemy.mp=100;b.place(b.player,180,400);b.masterAI.observed=null;assert.notEqual(b.masterChooseMove(),'r');
  b.place(b.player,600,400);assert.equal(b.masterChooseMove(),'r');
});
test('player dodge is learned from delayed visible movement, not private cooldown state',()=>{
  const b=live();idleEnemy(b);b.player.cooldowns.d=1.7;advance(b,.3);assert.equal(b.masterAI.dodgeUntil,0);
  b.player.cooldowns.d=0;b.input={x:1,y:0};b.cast('d');advance(b,.15);assert.equal(b.masterAI.dodgeUntil,0);advance(b,.13);assert.ok(b.masterAI.dodgeUntil>b.time+1);
});
test('Master uses a ready free basic to sustain pressure while recovering MP',()=>{
  const b=live('ampharos');b.place(b.enemy,650,400);b.place(b.player,350,400);
  b.enemy.mp=30;b.enemy.basicTimer=0;b.aiDecision=0;
  b.update(DT);
  assert.ok(b.enemy.basicWindup);
  assert.ok(b.enemy.mp>=30);
  assert.equal(b.drainEvents().filter(e=>e.type==='cast'&&e.team==='enemy').length,0);
});
test('Master saves scarce MP while a visible dodge is in progress, then attacks again',()=>{
  const b=live('ampharos');b.place(b.enemy,650,400);b.place(b.player,350,400);
  b.enemy.mp=35;b.masterAI.wasDodging=true;
  assert.equal(b.masterChooseMove(),null);
  b.masterAI.wasDodging=false;
  assert.equal(b.masterChooseMove(),'q');
});
test('all Master kits remain finite and retain HP, D and R contracts',()=>{
  for(const mon of ROSTER){const b=live(mon.id);b.player.basicTimer=0;let casts=0;
    for(let frame=0;frame<120*36&&b.state==='playing';frame++){
      if(frame%240===0){b.input={x:0,y:1};b.cast('d');}if(frame%360===0)b.cast('q');
      b.update(DT,{x:Math.cos(b.time),y:Math.sin(b.time)});
      for(const event of b.drainEvents())if(event.type==='cast'&&event.team==='enemy')casts++;
      if(frame%120===0){const check=v=>{if(typeof v==='number')assert.ok(Number.isFinite(v),mon.id);else if(v&&typeof v==='object')for(const x of Object.values(v))check(x);};check(b.snapshot());check(b.tasks);check(b.projectiles);check(b.hazards);}
    }
    assert.ok(casts>0,mon.id);assert.equal(b.enemy.maxHp,mon.hp);assert.equal(mon.moves.r.initialCooldown,30);assert.ok(mon.moves.r.cooldown>=60&&mon.moves.r.cooldown<=70);assert.equal(mon.moves.d.cooldown,2);assert.equal(mon.moves.d.distance,175);assert.equal(mon.moves.d.invulEnd,.5);
  }
  assert.ok(DIFFICULTIES.master.damage<=1.18);assert.ok(DIFFICULTIES.master.recovery>=.25);assert.ok(DIFFICULTIES.standard.recovery>=.9);
});

function activePressure(difficulty,enemyId){
  const b=live(enemyId,difficulty);b.player.basicTimer=0;
  let warningAt=null,attacks=0,enemyDodges=0,guards=0,frames=0;
  const skills={q:0,w:0,e:0,d:0};
  while(b.time<25&&b.state==='playing'&&frames++<120*35){
    const input={x:Math.cos(b.time*1.2),y:Math.sin(b.time*1.2)};
    const warning=b.enemy.basicWindup||b.windups.find(w=>w.team==='enemy')||b.hazards.find(h=>h.team==='enemy'&&h.delay>0);
    if(warning&&warningAt===null)warningAt=b.time;else if(!warning)warningAt=null;
    b.input=input;
    if(warningAt!==null&&b.time-warningAt>=.22&&b.cooldowns.d===0)b.cast('d');
    if(!b.player.dash&&b.player.castLock===0){
      for(const key of ['e','q','w']){
        const m=b.player.def.moves[key];
        if(b.cooldowns[key]===0&&b.player.mp>=m.cost&&(!['slash','pulse'].includes(m.kind)||distance(b.player,b.enemy)<m.range)&&b.cast(key))break;
      }
    }
    b.update(DT,input);
    for(const event of b.drainEvents()){
      if(event.team==='enemy'&&(event.type==='basicWindup'||event.type==='cast'&&['q','w','e','r'].includes(event.key)))attacks++;
      if(event.team==='enemy'&&event.type==='dodge')enemyDodges++;
      if(event.team==='enemy'&&event.type==='cast'&&event.kind==='guard')guards++;
      if(event.team==='player'&&event.type==='cast'&&event.key in skills)skills[event.key]++;
    }
  }
  return {damageTaken:b.stats.damageTaken,damageDealt:b.stats.damageDealt,attacks,enemyDodges,guards,skills,time:+b.time.toFixed(2)};
}
test('Master sustains stronger pressure against a circling player using basics, affordable Q/W/E and reactive D',()=>{
  const total={prior:{damage:0,attacks:0,dodges:0},master:{damage:0,attacks:0,dodges:0}};
  for(const enemy of ['typhlosion','scyther','feraligatr','ampharos']){
    const prior=activePressure('prior',enemy),master=activePressure('master',enemy);
    console.log(JSON.stringify({strategy:'circle+basics+QWE+D',enemy,prior,master}));
    for(const [name,result] of Object.entries({prior,master})){
      assert.ok(Object.values(result.skills).every(count=>count>0),`${name} ${enemy}: exercise all Q/W/E/D`);
      total[name].damage+=result.damageTaken;total[name].attacks+=result.attacks;total[name].dodges+=result.enemyDodges;
    }
    assert.ok(master.damageTaken>prior.damageTaken,enemy);
    assert.ok(master.enemyDodges>=1,enemy);
  }
  assert.ok(total.master.damage>total.prior.damage*1.5);
  assert.ok(total.master.attacks>total.prior.attacks*1.15);
  assert.equal(total.prior.dodges,0);assert.ok(total.master.dodges>=4);
});
