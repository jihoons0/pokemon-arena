import test from 'node:test';
import assert from 'node:assert/strict';
import {TYPE_CHART,POKEMON_TYPES} from '../src/type-data.js';
import {attackMatchup,effectiveness,FIELD_DAMAGE_INTERVAL} from '../src/type-matchups.js';
import {ROSTER_BY_ID,getMoves} from '../src/roster.js';
import {Battle} from '../src/battle.js';
import {encodeBattle,applyBattleState,localEvent} from '../src/net-state.js';
import {moveReadout} from '../src/move-readout.js';

const def=types=>({types});
const game=(playerId,enemyId)=>{const b=new Battle({playerId,enemyId,mode:'pvp'});b.state='playing';return b;};

test('modern 18-type table includes every immunity and the updated Steel/Fairy relations',()=>{
  assert.equal(Object.keys(TYPE_CHART).length,18);
  for(const [attack,target] of [['normal','ghost'],['fighting','ghost'],['ghost','normal'],['electric','ground'],['ground','flying'],['psychic','dark'],['poison','steel'],['dragon','fairy']])assert.equal(effectiveness(attack,def([target])),0);
  assert.equal(effectiveness('ghost',def(['steel'])),1);
  assert.equal(effectiveness('dark',def(['steel'])),1);
  assert.equal(effectiveness('steel',def(['fairy'])),2);
  assert.equal(effectiveness('fairy',def(['fire'])),.5);
});

test('dual types multiply weaknesses, resistances and immunity without counting duplicates',()=>{
  assert.equal(effectiveness('electric',ROSTER_BY_ID.gyarados),4);
  assert.equal(effectiveness('fire',ROSTER_BY_ID.scizor),4);
  assert.equal(effectiveness('grass',ROSTER_BY_ID.charizard),.25);
  assert.equal(effectiveness('electric',ROSTER_BY_ID.dragonite),1);
  assert.equal(effectiveness('ground',ROSTER_BY_ID.charizard),0);
  assert.equal(effectiveness('fire',def(['grass','grass'])),2);
});

test('all 50 Pokemon have canonical dual types and named coverage moves keep their own types',()=>{
  assert.equal(Object.keys(POKEMON_TYPES).length,50);
  assert.deepEqual(ROSTER_BY_ID.charizard.types,['fire','flying']);
  assert.deepEqual(ROSTER_BY_ID.gengar.types,['ghost','poison']);
  assert.deepEqual(ROSTER_BY_ID.togepi.types,['fairy']);
  assert.equal(getMoves('pikachu').w.element,'normal');
  assert.equal(getMoves('pikachu').e.element,'steel');
  assert.equal(getMoves('meganium').e.element,'normal');
  assert.equal(getMoves('nidoking').e.element,'ground');
  assert.equal(ROSTER_BY_ID.celebi.basic.element,'grass');
});

test('STAB uses either attacker type once and trainer/utility damage stays untyped',()=>{
  assert.deepEqual(attackMatchup({element:'fire',damage:100},ROSTER_BY_ID.charizard,ROSTER_BY_ID.venusaur),{effectiveness:2,stab:1.5,multiplier:3});
  assert.equal(attackMatchup({element:'flying',damage:100},ROSTER_BY_ID.charizard,def(['normal'])).stab,1.5);
  assert.equal(attackMatchup(getMoves('pikachu').e,ROSTER_BY_ID.pikachu,def(['normal'])).stab,1);
  assert.equal(attackMatchup({element:'fire',damage:144,trainer:true},ROSTER_BY_ID.charizard,ROSTER_BY_ID.scizor).multiplier,1);
  assert.equal(attackMatchup({element:'psychic',damage:0},ROSTER_BY_ID.mewtwo,ROSTER_BY_ID.umbreon).effectiveness,1);
});

test('actual damage applies effectiveness and STAB before shield absorption, for both PvP seats',()=>{
  const b=game('charizard','venusaur');b.enemy.shield=40;
  const hp=b.enemy.hp;b.damage(b.enemy,100,'player',{element:'fire'});
  assert.equal(hp-b.enemy.hp,260);assert.equal(b.enemy.shield,0);
  const hit=b.drainEvents().find(e=>e.type==='hit');assert.equal(hit.effectiveness,2);assert.equal(hit.stab,1.5);
  const pHp=b.player.hp;b.damage(b.player,100,'enemy',{element:'grass'});
  assert.equal(pHp-b.player.hp,38); // 100 × 1.5 × 0.25, rounded once.
});

test('immune hits do not consume shields, apply debuffs, grant lifesteal or record landed damage',()=>{
  const b=game('pikachu','steelix');b.enemy.shield=70;b.player.hp-=100;
  const before={hp:b.enemy.hp,attacker:b.player.hp};
  assert.equal(b.damage(b.enemy,100,'player',{element:'electric',stun:2,burn:3,slow:4,lifesteal:1}),false);
  assert.equal(b.enemy.hp,before.hp);assert.equal(b.enemy.shield,70);assert.equal(b.enemy.stun,0);assert.equal(b.enemy.burn,0);assert.equal(b.enemy.slow,0);assert.equal(b.player.hp,before.attacker);assert.equal(b.stats.hitsLanded,0);
  const immune=b.drainEvents().find(e=>e.type==='immune');assert.equal(immune.victimTeam,'enemy');
  assert.equal(localEvent(immune,'enemy').victimTeam,'player');
});

test('type immunity survives a projectile collision; fixed trainer damage and residual burn are not multiplied',()=>{
  const b=game('pikachu','steelix');b.addProjectile({x:b.enemy.x-10,y:b.enemy.y,dir:{x:1,y:0},speed:100,damage:50,element:'electric',team:'player'});const hp=b.enemy.hp;b.updateProjectiles(.01);assert.equal(b.enemy.hp,hp);
  b.damage(b.enemy,18,'player',{element:'fire',fixed:true,periodic:true});assert.equal(hp-b.enemy.hp,18);
  b.damage(b.enemy,4,'player',{element:'fire',typeModifiers:false,periodic:true});assert.equal(hp-b.enemy.hp,22);
  const fire=game('pikachu','charizard');fire.damage(fire.enemy,10,'player',{element:'normal',burn:3});assert.equal(fire.enemy.burn,0);
});

test('opponent switches change the matchup and both network views preserve the authoritative result',()=>{
  const b=new Battle({playerTeam:['pikachu'],enemyTeam:['gyarados','steelix'],mode:'pvp'});b.state='playing';
  const hp=b.enemy.hp;b.damage(b.enemy,40,'player',{element:'electric'});assert.equal(hp-b.enemy.hp,240);
  const remote=new Battle();applyBattleState(remote,encodeBattle(b),'enemy');assert.equal(remote.player.hp,b.enemy.hp);assert.deepEqual(remote.player.def.types,['water','flying']);
  b.sendOut('enemy',1);b.enemy.invul=0;const next=b.enemy.hp;b.damage(b.enemy,40,'player',{element:'electric'});assert.equal(b.enemy.hp,next);
});

test('periodic damage readout names the exact shared time interval instead of a tick',()=>{
  const move=getMoves('meganium').e,readout=moveReadout(move);
  assert.equal(readout.value,'30');assert.equal(readout.periodic,`${FIELD_DAMAGE_INTERVAL}초마다 +7`);
  const b=game('meganium','snorlax');b.cast('e');assert.equal(b.hazards[0].dotTimer,FIELD_DAMAGE_INTERVAL);
});
