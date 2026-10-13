import {Battle, BOUNDS, clamp, unit} from './battle.js';

// Yuna adds blink-strike state and a new roster ID; older clients must refresh.
export const PROTOCOL = 2;
export const STEP = 1 / 60;
export const SNAPSHOT_MS = 50;
export const SIDES = ['player', 'enemy'];
// Append fields only: live v1 clients and persisted checkpoints depend on these indices.
const FIELDS = ('id x y px py vx vy hp maxHp mp maxMp speed radius facing anim animTime animLock animDuration animHitAt pose dodgeRecovery dodgeGuard action castRoot castLock invul hurt stun burn burnTick slow boost haste hasteMultiplier weakened cleanseGuard ignite attackBoost attackMultiplier fainted shield shieldTime moving dash basicTimer basicWindup cooldowns index burnSourceId blinkStrike').split(' ');
const round = n => Math.round(n * 1000) / 1000;
const clean = value => typeof value === 'number' ? round(value) : value;
export const opposite = side => side === 'player' ? 'enemy' : 'player';

// Static roster definitions never travel over the socket. The server owns all state.
export function encodeBattle(battle) {
  return {
    v: PROTOCOL, options: battle.options, s: battle.state, t: round(battle.time), c: round(battle.countdown),
    a: {...battle.activeIndices}, u: structuredClone(battle.utilityCooldowns), sw: {...battle.switchCooldowns},
    pending: {...battle.pendingSwitch}, stats: [battle.stats, battle.rivalStats].map(s => structuredClone(s)),
    teams: SIDES.map(side => battle.teams[side].map(f => FIELDS.map(k => clean(f[k])))),
    p: battle.projectiles.map(e => ({...e})), h: battle.hazards.map(e => ({...e})), w: battle.windups.map(e => ({...e})),
  };
}

function sideValue(value, reverse) {
  if (!reverse || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(v => sideValue(v, reverse));
  return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,
    ['team','victimTeam'].includes(k) && SIDES.includes(v) ? opposite(v) : sideValue(v, reverse)]));
}

export function applyBattleState(battle, state, side = 'player') {
  const reverse = side === 'enemy';
  const options = {...state.options, mode: 'pvp'};
  if (reverse) for (const suffix of ['Team','Id','Special']) {
    [options['player'+suffix], options['enemy'+suffix]] = [options['enemy'+suffix], options['player'+suffix]];
  }
  const signature = JSON.stringify([options.playerTeam, options.enemyTeam, options.playerSpecial, options.enemySpecial]);
  if (battle.networkSignature !== signature) {
    battle.configure(options); battle.networkSignature = signature; battle.drainEvents();
  }
  battle.options = options;
  for (let localIndex = 0; localIndex < 2; localIndex++) {
    const local = SIDES[localIndex], remoteIndex = reverse ? 1-localIndex : localIndex, remote = SIDES[remoteIndex];
    Object.assign(battle.utilityCooldowns[local], state.u[remote]);
    state.teams[remoteIndex].forEach((values,index) => {
      const f = battle.teams[local][index];
      FIELDS.forEach((key,i) => {
        if (i >= values.length) return; // Older room checkpoints keep new-field defaults.
        if (key === 'cooldowns') Object.assign(f.cooldowns, values[i]);
        else f[key] = sideValue(structuredClone(values[i]), reverse);
      });
      f.team = local;
    });
    battle.activeIndices[local] = state.a[remote];
    battle[local] = battle.teams[local][state.a[remote]];
    battle.switchCooldowns[local] = state.sw[remote];
    battle.pendingSwitch[local] = state.pending[remote];
  }
  battle.cooldowns = battle.player.cooldowns;
  battle.state = reverse && ['won','lost'].includes(state.s) ? state.s === 'won' ? 'lost' : 'won' : state.s;
  battle.time = state.t; battle.countdown = state.c;
  battle.stats = {...state.stats[reverse ? 1 : 0]}; battle.rivalStats = {...state.stats[reverse ? 0 : 1]};
  battle.projectiles = sideValue(structuredClone(state.p), reverse);
  battle.hazards = sideValue(structuredClone(state.h), reverse);
  battle.windups = sideValue(structuredClone(state.w), reverse);
  battle.hitStop = 0;
  return battle;
}

export function localEvent(event, side) {
  const result = sideValue({...event}, side === 'enemy');
  if (event.type === 'end' && side === 'enemy') {
    result.won = !event.won; result.stats = event.rivalStats || {};
  }
  delete result.rivalStats;
  return result;
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
