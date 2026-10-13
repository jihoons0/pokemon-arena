import {Battle, BOUNDS, BATTLE_SIDES, clamp, unit} from './battle.js';

// Four independent trainer seats; old two-player checkpoints still load.
export const PROTOCOL = 3;
export const STEP = 1 / 60;
export const SNAPSHOT_MS = 50;
export const SIDES = ['player', 'enemy'];
// Append fields only: live v1 clients and persisted checkpoints depend on these indices.
const FIELDS = ('id x y px py vx vy hp maxHp mp maxMp speed radius facing anim animTime animLock animDuration animHitAt pose dodgeRecovery dodgeGuard action castRoot castLock invul hurt stun burn burnTick slow boost haste hasteMultiplier weakened cleanseGuard ignite attackBoost attackMultiplier fainted shield shieldTime moving dash basicTimer basicWindup cooldowns index burnSourceId blinkStrike burnSourceTeam').split(' ');
const round = n => Math.round(n * 1000) / 1000;
const clean = value => typeof value === 'number' ? round(value) : value;
export const opposite = side => side === 'player' ? 'enemy' : 'player';

// Static roster definitions never travel over the socket. The server owns all state.
export function encodeBattle(battle) {
  return {
    v: PROTOCOL, options: battle.options, s: battle.state, t: round(battle.time), c: round(battle.countdown),
    a: {...battle.activeIndices}, u: structuredClone(battle.utilityCooldowns), sw: {...battle.switchCooldowns},
    pending: {...battle.pendingSwitch}, stats: battle.sides.map(side=>structuredClone(battle.statsFor(side))), targets:{...battle.targets},
    teams: battle.sides.map(side => battle.teams[side].map(f => FIELDS.map(k => clean(f[k])))),
    p: battle.projectiles.map(e => ({...e})), h: battle.hazards.map(e => ({...e})), w: battle.windups.map(e => ({...e})),
  };
}

export function perspectiveSides(side='player',count=2){
  const seat=typeof side==='number'?side:BATTLE_SIDES.indexOf(side),opponent=1-seat%2;
  return (count===4?[seat,opponent,(seat+2)%4,opponent+2]:[seat,1-seat]).map(i=>BATTLE_SIDES[i]);
}
function sideValue(value,mapping) {
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(v=>sideValue(v,mapping));
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,
    ['team','victimTeam','targetSide','burnSourceTeam'].includes(k)&&mapping[v]?mapping[v]:sideValue(v,mapping)]));
}
export function applyBattleState(battle,state,side='player') {
  const order=perspectiveSides(side,state.teams.length),mapping=Object.fromEntries(order.map((remote,i)=>[remote,BATTLE_SIDES[i]]));
  const reverse=BATTLE_SIDES.indexOf(order[0])%2===1,options={...state.options,mode:'pvp',teamSize:state.teams.length===4?2:1,controllers:{}};
  for(const [i,remote]of order.entries()){
    const local=BATTLE_SIDES[i];
    for(const suffix of ['Team','Id','Special'])if(state.options[remote+suffix]!==undefined)options[local+suffix]=state.options[remote+suffix];else delete options[local+suffix];
    if(state.options.controllers?.[remote])options.controllers[local]=state.options.controllers[remote];
  }
  const signature=JSON.stringify(options);
  if(battle.networkSignature!==signature){battle.configure(options);battle.networkSignature=signature;battle.drainEvents();}
  battle.options=options;
  for(const [i,remote]of order.entries()){
    const local=BATTLE_SIDES[i],remoteIndex=BATTLE_SIDES.indexOf(remote);
    Object.assign(battle.utilityCooldowns[local],state.u[remote]);
    state.teams[remoteIndex].forEach((values,index)=>{
      const f=battle.teams[local][index];
      FIELDS.forEach((key,j)=>{
        if(j>=values.length)return;
        if(key==='cooldowns')Object.assign(f.cooldowns,values[j]);
        else if(key==='burnSourceTeam')f[key]=mapping[values[j]]||values[j];
        else f[key]=sideValue(structuredClone(values[j]),mapping);
      });f.team=local;
    });
    battle.activeIndices[local]=state.a[remote];battle[local]=battle.source(local);
    battle.switchCooldowns[local]=state.sw[remote];battle.pendingSwitch[local]=state.pending[remote];
    battle.sideStats[local]=structuredClone(state.stats[remoteIndex]||{});
  }
  battle.stats=battle.sideStats.player;battle.rivalStats=battle.sideStats.enemy;
  battle.targets=Object.fromEntries(Object.entries(state.targets||{}).map(([owner,target])=>[mapping[owner],mapping[target]]));
  battle.refreshTargets();
  battle.state=reverse&&['won','lost'].includes(state.s)?state.s==='won'?'lost':'won':state.s;
  battle.time=state.t;battle.countdown=state.c;
  battle.projectiles=sideValue(structuredClone(state.p),mapping);battle.hazards=sideValue(structuredClone(state.h),mapping);battle.windups=sideValue(structuredClone(state.w),mapping);battle.hitStop=0;
  return battle;
}
export function localEvent(event,side,count=2){
  const order=perspectiveSides(side,count),mapping=Object.fromEntries(order.map((remote,i)=>[remote,BATTLE_SIDES[i]]));
  const result=sideValue({...event},mapping);
  if(event.type==='end'){
    result.won=BATTLE_SIDES.indexOf(order[0])%2?!event.won:event.won;
    result.stats=event.sideStats?.[order[0]]||(result.won===event.won?event.stats:event.rivalStats)||{};
  }
  delete result.rivalStats;delete result.sideStats;return result;
}

export function checkpointBattle(battle) {
  return {state:encodeBattle(battle),tasks:structuredClone(battle.tasks),groupId:battle.groupId,hitGroups:[...battle.hitGroups]};
}
export function restoreBattle(saved) {
  const battle = applyBattleState(new Battle({mode:'pvp'}), saved.state);
  battle.tasks = saved.tasks; battle.groupId = saved.groupId; battle.hitGroups = new Map(saved.hitGroups);
  return battle;
}

// Shared movement rules, without client-side damage, projectile hits or HP changes.
// Reconciliation always starts with a fresh authoritative fighter.
export function predictMotion(f, dt, control, target) {
  dt = clamp(dt, 0, .05);
  for (const key of ['stun','castRoot','castLock','dodgeRecovery','invul','haste','slow','boost','animLock']) f[key] = Math.max(0, f[key]-dt);
  if (f.cooldowns) for (const key of Object.keys(f.cooldowns)) f.cooldowns[key] = Math.max(0, f.cooldowns[key]-dt);
  f.animTime += dt; f.moving = false;
  if (f.hp <= 0 || f.blinkStrike) return;
  const place = (x,y) => { f.x=clamp(x,BOUNDS.left+f.radius,BOUNDS.right-f.radius);f.y=clamp(y,BOUNDS.top+f.radius,BOUNDS.bottom-f.radius); };
  if (f.dash) {
    const d=f.dash, step=Math.min(dt,d.time);
    let travel = d.speed*step;
    if (d.kind === 'dodge') {
      const before=d.elapsed/d.duration;d.elapsed=Math.min(d.duration,d.elapsed+step);
      const after=d.elapsed/d.duration;travel=d.distance*((1-(1-after)**2)-(1-(1-before)**2));
    }
    place(f.x+d.dx*travel,f.y+d.dy*travel);d.time-=step;f.moving=true;
    if(d.time<=.00001){f.dash=null;f.anim='idle';f.animTime=0;}
  } else if (!f.stun && !f.castRoot && !f.dodgeRecovery && (control.x || control.y)) {
    const d=unit(control.x,control.y),speed=f.speed*(f.boost>0?1.24:1)*(f.haste>0?f.hasteMultiplier:1)*(f.slow>0?.68:1);
    place(f.x+d.x*speed*dt,f.y+d.y*speed*dt);f.facing=Math.atan2(d.y,d.x);f.moving=true;
  }
  if (f.animLock <= 0 && !f.dash) f.anim=f.moving?'walk':'idle';
  if(target?.hp>0 && !f.dash && !target.dash) {
    const distance=Math.hypot(f.x-target.x,f.y-target.y),gap=f.radius+target.radius-distance;
    if(gap>0){const d=unit(f.x-target.x||-1,f.y-target.y);place(f.x+d.x*gap*.5,f.y+d.y*gap*.5);}
  }
}
