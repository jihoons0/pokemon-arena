import test from 'node:test';
import assert from 'node:assert/strict';

import { Battle, BOUNDS, clamp, distance, segmentDistance, unit } from '../src/battle.js';
import { DIFFICULTIES, ELEMENTS, ROSTER, ROSTER_BY_ID, getMoves } from '../src/roster.js';
import { controlKey, inputFromKeys } from '../src/controls.js';
import { animationMarkers, directionFor, frameFor, mappedAnimationTime } from '../src/sprites.js';

const EPSILON = 1e-8;
const STEP = 0.05;
const DIFFICULTY_IDS = ['beginner', 'easy', 'standard', 'expert', 'master'];

function closeTo(actual, expected, epsilon = EPSILON, message) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function isolatedBattle(options = {}) {
  const { suppressBasics = true, ...battleOptions } = options;
  const battle = new Battle({ random: () => 0.5, ...battleOptions });
  battle.state = 'playing';
  battle.updateAI = () => {};
  if (suppressBasics) battle.player.basicTimer = 1_000_000;
  battle.drainEvents();
  return battle;
}

function liveBattle(options = {}) {
  const battle = new Battle({ random: () => 0.5, ...options });
  battle.state = 'playing';
  battle.drainEvents();
  return battle;
}

test('casting keeps the facing, sprite animation, and cast pose in solo and PvP', () => {
  for (const mode of ['cpu', 'pvp']) {
    const battle = isolatedBattle({mode});
    for (const fighter of [battle.player, battle.enemy]) {
      fighter.facing = Math.PI / 2;
      const target = battle.target(fighter.team);
      const expectedAngle = Math.atan2(target.y - fighter.y, target.x - fighter.x);
      assert.equal(battle.castFor(fighter, 'q'), true);
      closeTo(fighter.facing, expectedAngle);
      assert.equal(fighter.anim, fighter.def.moves.q.animation);
      assert.ok(fighter.animLock > 0);
      assert.equal(fighter.pose.kind, 'cast');
      closeTo(fighter.pose.angle, expectedAngle);
    }
  }
});

function advance(battle, seconds, input = { x: 0, y: 0 }) {
  let elapsed = 0;
  while (elapsed < seconds - EPSILON) {
    const dt = Math.min(STEP, seconds - elapsed);
    const currentInput = typeof input === 'function' ? input(elapsed, battle) : input;
    battle.update(dt, currentInput);
    elapsed += dt;
  }
}

function advanceBattleTime(battle, seconds, input = { x: 0, y: 0 }) {
  const target = battle.time + seconds;
  let frames = 0;
  while (battle.time < target - EPSILON && battle.state === 'playing') {
    const currentInput = typeof input === 'function' ? input(battle.time, battle) : input;
    battle.update(Math.min(STEP, target - battle.time), currentInput);
    assert.ok(frames++ < 10000, 'combat time advance stalled');
  }
}

function finishDash(battle, input, step = STEP) {
  let frames = 0;
  while (battle.player.dash) {
    battle.update(step, input);
    assert.ok(frames++ < 100, 'dash failed to finish');
  }
}

function putInLine(battle, gap, x = 400, y = 400) {
  battle.place(battle.player, x, y);
  battle.place(battle.enemy, x + gap, y);
}

function makeReady(battle, key, team = 'player') {
  const fighter = team === 'player' ? battle.player : battle.enemy;
  fighter.cooldowns[key] = 0;
  fighter.mp = fighter.maxMp;
}

function numericValues(value, path = 'root', found = []) {
  if (typeof value === 'number') found.push([path, value]);
  else if (Array.isArray(value)) value.forEach((item, index) => numericValues(item, `${path}[${index}]`, found));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) numericValues(item, `${path}.${key}`, found);
  }
  return found;
}

function assertFiniteModel(battle, label) {
  for (const [path, value] of numericValues({
    player: battle.player,
    enemy: battle.enemy,
    projectiles: battle.projectiles,
    hazards: battle.hazards,
    windups: battle.windups,
    tasks: battle.tasks,
    time: battle.time,
  })) {
    assert.ok(Number.isFinite(value), `${label}: ${path} is ${value}`);
  }
  for (const fighter of [battle.player, battle.enemy]) {
    assert.ok(fighter.x >= BOUNDS.left + fighter.radius - EPSILON, `${label}: ${fighter.team} left bound`);
    assert.ok(fighter.x <= BOUNDS.right - fighter.radius + EPSILON, `${label}: ${fighter.team} right bound`);
    assert.ok(fighter.y >= BOUNDS.top + fighter.radius - EPSILON, `${label}: ${fighter.team} top bound`);
    assert.ok(fighter.y <= BOUNDS.bottom - fighter.radius + EPSILON, `${label}: ${fighter.team} bottom bound`);
    assert.ok(fighter.hp >= 0 && fighter.hp <= fighter.maxHp, `${label}: ${fighter.team} hp ${fighter.hp}`);
    assert.ok(fighter.mp >= 0 && fighter.mp <= fighter.maxMp, `${label}: ${fighter.team} mp ${fighter.mp}`);
  }
}

function enemyWarningFor(move, key, difficulty) {
  if (['guard', 'boost'].includes(move.kind)) return 0.2;
  if (move.kind === 'field') return difficulty.fieldWindup;
  if (['storm', 'beam', 'nova'].includes(move.kind) || key === 'r') return difficulty.ultimateWindup;
  if (['dash', 'slash', 'pulse', 'blinkStrike'].includes(move.kind)) return difficulty.meleeWindup;
  return difficulty.reaction;
}

function simulateThreat({ mode = 'idle', dodge = false, seconds = 20, difficulty = 'standard' } = {}) {
  const battle = liveBattle({ difficulty });
  const dt = 1 / 120;
  const attacks = [];
  const dodgeDelays = [];
  let warningObservedAt = null;
  battle.player.basicTimer = 1_000_000;

  while (battle.time < seconds && battle.state === 'playing') {
    const input = mode === 'circle'
      ? { x: Math.cos(battle.time * 1.2), y: Math.sin(battle.time * 1.2) }
      : { x: 0, y: 0 };
    const warning = battle.enemy.basicWindup
      || battle.windups.find((item) => item.team === 'enemy')
      || battle.hazards.find((item) => item.team === 'enemy' && item.delay > 0);
    if (warning && warningObservedAt === null) warningObservedAt = battle.time;
    else if (!warning) warningObservedAt = null;

    if (dodge && warningObservedAt !== null && battle.time - warningObservedAt >= 0.22 && battle.cooldowns.d <= 0) {
      battle.input = input;
      if (battle.cast('d')) dodgeDelays.push(battle.time - warningObservedAt);
    }

    battle.update(dt, input);
    for (const event of battle.drainEvents()) {
      if (event.team === 'enemy' && (event.type === 'cast' || event.type === 'basicWindup')) {
        attacks.push({ time: battle.time, key: event.type === 'cast' ? event.key : 'basic' });
      }
    }
  }
  return { battle, attacks, dodgeDelays };
}

test('roster exposes 50 Gen 1/2 Pokémon and Yuna with independent kits', () => {
  assert.equal(ROSTER.length, 51);
  assert.equal(ROSTER.filter(mon=>!mon.custom).length,50);
  assert.equal(ROSTER_BY_ID.yuna.custom,true);
  assert.equal(new Set(ROSTER.map(mon => mon.id)).size, 51);
  for (const id of ['pikachu','charizard','blastoise','venusaur','gengar','dragonite','mewtwo','typhlosion','feraligatr','ampharos','scizor','tyranitar']) assert.ok(ROSTER_BY_ID[id], id);
  assert.equal(ROSTER[0].id, 'pikachu');
  assert.deepEqual(
    Object.fromEntries([1, 2].map((gen) => [gen, ROSTER.filter((mon) => mon.gen === gen).length])),
    { 1: 30, 2: 20 },
  );
  assert.equal(Object.keys(ROSTER_BY_ID).length, 51);

  const signatures = new Set();
  for (const mon of ROSTER) {
    assert.equal(ROSTER_BY_ID[mon.id], mon);
    assert.equal(getMoves(mon.id), mon.moves);
    assert.ok(ELEMENTS[mon.type]);
    assert.ok(mon.hp > 0 && mon.speed > 0 && mon.radius > 0);
    assert.ok(mon.basic.name && mon.basic.damage > 0 && mon.basic.range > 0 && mon.basic.cooldown > 0 && mon.basic.windup > 0);
    assert.equal(mon.basic.element, mon.type);
    assert.equal(mon.basic.color, ELEMENTS[mon.type].color);
    assert.deepEqual(Object.keys(mon.moves), ['q', 'w', 'e', 'r', 's', 'd']);
    if (mon !== ROSTER[0]) {
      assert.notEqual(mon.moves, ROSTER[0].moves, `${mon.id} must not share a mutable move map`);
      assert.notEqual(mon.moves.s, ROSTER[0].moves.s, `${mon.id} must own its default trainer definition`);
      assert.notEqual(mon.moves.d, ROSTER[0].moves.d, `${mon.id} must own its Dodge definition`);
    }

    assert.deepEqual(
      { name: mon.moves.d.name, kind: mon.moves.d.kind, damage: mon.moves.d.damage, cooldown: mon.moves.d.cooldown, cost: mon.moves.d.cost, distance: mon.moves.d.distance, duration: mon.moves.d.duration, invulStart: mon.moves.d.invulStart, invulEnd: mon.moves.d.invulEnd },
      { name: 'Dodge', kind: 'dodge', damage: 0, cooldown: 2, cost: 0, distance: 175, duration: 0.28, invulStart: 0, invulEnd: 0.5 },
      `${mon.id}.d dodge contract`,
    );

    for (const [key, move] of Object.entries(mon.moves)) {
      assert.ok(move.name && move.ko && move.kind && move.cooldown > 0, `${mon.id}.${key}`);
      assert.ok(move.cost >= 0, `${mon.id}.${key} cost`);
      assert.ok(move.color, `${mon.id}.${key} color`);
    }
    const signature = [mon.basic.name, ...['q', 'w', 'e', 'r'].map((key) => `${mon.moves[key].name}:${mon.moves[key].kind}`)].join('|');
    assert.ok(!signatures.has(signature), `${mon.id} duplicates another complete kit`);
    signatures.add(signature);
  }
  assert.equal(getMoves('not-a-pokemon'), ROSTER_BY_ID.pikachu.moves);
});

test('every ultimate starts at 30 seconds and recharges in the advertised 60-70 second band', () => {
  for (const mon of ROSTER) {
    assert.equal(mon.moves.r.initialCooldown, 30, `${mon.id} initial R cooldown`);
    assert.ok(mon.moves.r.cooldown >= 60 && mon.moves.r.cooldown <= 70, `${mon.id} R cooldown ${mon.moves.r.cooldown}`);
    assert.equal(mon.moves.r.ultimate, true);

    const battle = new Battle({ playerId: mon.id, enemyId: mon.id, random: () => 0.5 });
    assert.equal(battle.player.cooldowns.r, 30);
    assert.equal(battle.enemy.cooldowns.r, 30);
  }
});

test('five difficulty levels are ordered, finite, sane, and preserve standard/expert tuning', () => {
  assert.deepEqual(Object.keys(DIFFICULTIES), DIFFICULTY_IDS);
  assert.deepEqual(DIFFICULTY_IDS.map((id) => DIFFICULTIES[id].name), ['입문', '쉬움', '도전', '챔피언', '마스터']);

  assert.deepEqual(DIFFICULTIES.standard, {
    name: '도전', description: '확실한 공격 예고 · 회피 후 반격', reaction: 0.7, basicWindup: 0.48,
    meleeWindup: 0.6, fieldWindup: 0.95, ultimateWindup: 1.1, recovery: 0.9, volleyInterval: 0.28,
    projectileSpeed: 0.8, basicHoming: 8, skillRate: 1, damage: 1, lead: 0.83, aggression: 1,
  });
  assert.deepEqual(DIFFICULTIES.expert, {
    name: '챔피언', description: '짧은 공격 예고 · 빠른 탄속 · 적극적 추격', reaction: 0.48, basicWindup: 0.36,
    meleeWindup: 0.44, fieldWindup: 0.78, ultimateWindup: 0.9, recovery: 0.65, volleyInterval: 0.21,
    projectileSpeed: 0.95, basicHoming: 10, skillRate: 0.9, damage: 1.12, lead: 0.96, aggression: 1.18,
  });
  assert.ok(DIFFICULTIES.standard.fieldWindup >= 0.9);
  assert.ok(DIFFICULTIES.standard.ultimateWindup >= 0.9);

  const ranges = {
    reaction: [0.25, 1.5], basicWindup: [0.2, 1], meleeWindup: [0.25, 1.2], fieldWindup: [0.5, 1.6],
    ultimateWindup: [0.6, 1.8], recovery: [0.4, 1.4], volleyInterval: [0.12, 0.5], projectileSpeed: [0.5, 1.2],
    basicHoming: [0, 15], skillRate: [0.75, 1.4], damage: [0.8, 1.25], lead: [0.4, 1.2], aggression: [0.6, 1.5],
  };
  for (const id of DIFFICULTY_IDS) {
    const difficulty = DIFFICULTIES[id];
    assert.ok(difficulty.name && difficulty.description, `${id} copy`);
    for (const [key, [min, max]] of Object.entries(ranges)) {
      assert.ok(Number.isFinite(difficulty[key]), `${id}.${key} must be finite`);
      assert.ok(difficulty[key] >= min && difficulty[key] <= max, `${id}.${key} ${difficulty[key]} outside ${min}-${max}`);
    }
  }

  for (let i = 1; i < DIFFICULTY_IDS.length; i++) {
    const easier = DIFFICULTIES[DIFFICULTY_IDS[i - 1]];
    const harder = DIFFICULTIES[DIFFICULTY_IDS[i]];
    for (const key of ['reaction', 'basicWindup', 'meleeWindup', 'fieldWindup', 'ultimateWindup', 'recovery', 'volleyInterval', 'skillRate']) {
      assert.ok(easier[key] > harder[key], `${key} must decrease from ${DIFFICULTY_IDS[i - 1]} to ${DIFFICULTY_IDS[i]}`);
    }
    for (const key of ['projectileSpeed', 'basicHoming', 'lead', 'aggression']) {
      assert.ok(easier[key] < harder[key], `${key} must increase from ${DIFFICULTY_IDS[i - 1]} to ${DIFFICULTY_IDS[i]}`);
    }
    assert.ok(easier.damage <= harder.damage, `damage must not decrease at ${DIFFICULTY_IDS[i]}`);
  }
  assert.ok(DIFFICULTIES.master.damage / DIFFICULTIES.beginner.damage < 1.35, 'damage scaling should stay secondary');
});

test('difficulty defaults to standard, rejects unknown IDs, and preserves every valid selection', () => {
  assert.equal(new Battle({ random: () => 0.5 }).difficulty, DIFFICULTIES.standard);
  assert.equal(new Battle({ difficulty: 'unknown', random: () => 0.5 }).difficulty, DIFFICULTIES.standard);
  const battle = new Battle({ random: () => 0.5 });
  for (const id of DIFFICULTY_IDS) {
    battle.configure({ difficulty: id });
    assert.equal(battle.options.difficulty, id);
    assert.equal(battle.difficulty, DIFFICULTIES[id]);
  }
  battle.configure({ difficulty: 'unknown' });
  assert.equal(battle.options.difficulty, 'standard');
  assert.equal(battle.difficulty, DIFFICULTIES.standard);
});

test('configuration, reset, and rematch preserve selections including mirror matches', () => {
  const battle = new Battle({ random: () => 0.5 });
  battle.configure({ playerId: 'gengar', enemyId: 'gengar', difficulty: 'expert' });
  assert.equal(battle.state, 'ready');
  assert.equal(battle.player.id, 'gengar');
  assert.equal(battle.enemy.id, 'gengar');
  assert.notEqual(battle.player, battle.enemy);
  assert.equal(battle.player.def, battle.enemy.def);
  assert.equal(battle.difficulty, DIFFICULTIES.expert);

  battle.player.hp = 1;
  battle.enemy.mp = 0;
  battle.projectiles.push({ x: 1 });
  battle.reset();
  assert.equal(battle.player.hp, ROSTER_BY_ID.gengar.hp);
  assert.equal(battle.enemy.mp, 100);
  assert.deepEqual(battle.projectiles, []);
  assert.equal(battle.cooldowns, battle.player.cooldowns);

  battle.start({ playerId: 'scizor', enemyId: 'scizor', difficulty: 'standard' });
  assert.equal(battle.state, 'countdown');
  assert.equal(battle.player.id, 'scizor');
  assert.equal(battle.enemy.id, 'scizor');
  advance(battle, 2.35);
  assert.equal(battle.state, 'playing');
});

test('movement normalizes diagonals, clamps every edge, and separates exact overlap', () => {
  const battle = isolatedBattle();
  putInLine(battle, 600, 400, 400);

  battle.update(STEP, { x: 1, y: 0 });
  const cardinal = battle.player.x - 400;
  closeTo(cardinal, battle.player.speed * STEP);

  battle.place(battle.player, 400, 400);
  battle.update(STEP, { x: 1, y: 1 });
  closeTo(Math.hypot(battle.player.x - 400, battle.player.y - 400), cardinal);
  closeTo(battle.player.x - 400, battle.player.y - 400);

  const r = battle.player.radius;
  for (const { x, y, input } of [
    { x: BOUNDS.left + r, y: 400, input: { x: -1, y: 0 } },
    { x: BOUNDS.right - r, y: 400, input: { x: 1, y: 0 } },
    { x: 500, y: BOUNDS.top + r, input: { x: 0, y: -1 } },
    { x: 500, y: BOUNDS.bottom - r, input: { x: 0, y: 1 } },
  ]) {
    battle.place(battle.player, x, y);
    battle.update(STEP, input);
    assert.ok(battle.player.x >= BOUNDS.left + r && battle.player.x <= BOUNDS.right - r);
    assert.ok(battle.player.y >= BOUNDS.top + r && battle.player.y <= BOUNDS.bottom - r);
  }

  battle.place(battle.player, 600, 400);
  battle.place(battle.enemy, 600, 400);
  battle.update(STEP);
  closeTo(distance(battle.player, battle.enemy), battle.player.radius + battle.enemy.radius);
  assert.ok(battle.player.x < 600 && battle.enemy.x > 600);
});

test('dash direction, exact final step, bounds, and one-hit crossing are deterministic', () => {
  const directional = isolatedBattle();
  putInLine(directional, 600, 400, 400);
  directional.input = { x: 3, y: -4 };
  assert.equal(directional.cast('w'), true);
  const task = directional.tasks.shift();
  directional.resolveTask(task);
  closeTo(directional.player.dash.dx, 0.6);
  closeTo(directional.player.dash.dy, -0.8);
  const start = { x: directional.player.x, y: directional.player.y };
  while (directional.player.dash) directional.moveDash(directional.player, STEP, directional.enemy);
  closeTo(directional.player.x, start.x + 0.6 * directional.moves.w.distance);
  closeTo(directional.player.y, start.y - 0.8 * directional.moves.w.distance);

  const crossing = isolatedBattle();
  putInLine(crossing, 120, 400, 400);
  crossing.input = { x: 1, y: 0 };
  assert.equal(crossing.cast('w'), true);
  crossing.resolveTask(crossing.tasks.shift());
  while (crossing.player.dash) crossing.moveDash(crossing.player, STEP, crossing.enemy);
  assert.equal(crossing.enemy.hp, crossing.enemy.maxHp - crossing.moves.w.damage);
  assert.equal(crossing.stats.hitsLanded, 1);

  const edge = isolatedBattle();
  edge.place(edge.player, BOUNDS.right - edge.player.radius - 5, 400);
  edge.place(edge.enemy, BOUNDS.left + edge.enemy.radius, 400);
  edge.input = { x: 1, y: 0 };
  assert.equal(edge.cast('w'), true);
  edge.resolveTask(edge.tasks.shift());
  while (edge.player.dash) edge.moveDash(edge.player, STEP, edge.enemy);
  closeTo(edge.player.x, BOUNDS.right - edge.player.radius);
});

test('standing and moving players always auto-attack with all 50 ranged and melee basics', () => {
  for (const mon of ROSTER) {
    for (const [mode, input] of [['standing', { x: 0, y: 0 }], ['moving', { x: 0, y: 1 }]]) {
      const battle = isolatedBattle({ playerId: mon.id, enemyId: 'tyranitar', suppressBasics: false });
      putInLine(battle, mon.basic.range * 0.55);
      advance(battle, 1.3, input);
      assert.ok(battle.stats.basicsFired >= 1, `${mon.id} fired no ${mode} basic`);
      assert.ok(battle.stats.basicHits >= 1, `${mon.id} landed no ${mode} basic`);
      assert.ok(battle.stats.damageDealt >= mon.basic.damage, `${mon.id} dealt no ${mode} basic damage`);
    }
  }
});

test('auto attack is read-only, old attack-mode APIs are absent, and reset keeps always-auto', () => {
  const battle = new Battle({ random: () => 0.5 });
  const descriptor = Object.getOwnPropertyDescriptor(Battle.prototype, 'autoAttack');
  assert.equal(battle.autoAttack, true);
  assert.equal(descriptor.get instanceof Function, true);
  assert.equal(descriptor.set, undefined);
  assert.throws(() => { battle.autoAttack = false; }, TypeError);
  for (const key of ['attack', 'toggleAutoAttack', 'attackCommand', 'attackBuffer']) {
    assert.equal(key in battle, false, key + ' should not exist');
  }
  battle.reset();
  assert.equal(battle.autoAttack, true);
  assert.equal(battle.snapshot().autoAttack, true);
  assert.equal('attackCommand' in battle.snapshot(), false);
  assert.equal('attackQueued' in battle.snapshot(), false);
});

test('A, Space, and T do not change movement input or disable automatic basics', () => {
  const movement = inputFromKeys(new Set(['ArrowRight']));
  assert.deepEqual(movement, { x: 1, y: 0 });
  for (const key of ['a', ' ', 't']) {
    assert.deepEqual(inputFromKeys(new Set([key])), { x: 0, y: 0 });
    assert.deepEqual(inputFromKeys(new Set(['ArrowRight', key])), movement);
    const battle = isolatedBattle({ suppressBasics: false });
    putInLine(battle, 250);
    advance(battle, 0.8, inputFromKeys(new Set([key])));
    assert.equal(battle.autoAttack, true);
    assert.equal(battle.stats.basicsFired, 1, JSON.stringify(key) + ' changed autofire');
    assert.equal(battle.stats.basicHits, 1, JSON.stringify(key) + ' prevented an automatic hit');
  }
});

test('arrow movement remains at full nominal speed during a basic windup', () => {
  const battle = isolatedBattle({ suppressBasics: false });
  putInLine(battle, 250);
  const input = { x: 0, y: 1 };
  battle.update(STEP, input);
  assert.ok(battle.player.basicWindup);
  const windupY = battle.player.y;
  battle.update(STEP, input);
  closeTo(battle.player.y - windupY, battle.player.speed * STEP);
});

test('skills still fire and movement stays at full speed while automatic basics remain enabled', () => {
  const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'typhlosion', suppressBasics: false });
  putInLine(battle, 300);
  battle.player.basicTimer = 0;
  assert.equal(battle.tryBasic(battle.player), true);
  assert.ok(battle.player.basicWindup);
  assert.equal(battle.cast('q'), true);
  assert.equal(battle.player.basicWindup, null, 'skill cast should replace only the pending basic windup');
  assert.equal(battle.autoAttack, true);
  const startX = battle.player.x;
  advance(battle, 0.12, { x: 1, y: 0 });
  closeTo(battle.player.x - startX, battle.player.speed * 0.12);
  assert.equal(battle.projectiles.length, 1);
  assert.equal(battle.projectiles[0].team, 'player');
  assert.equal(battle.stats.movesUsed, 1);
});

test('neutral input never auto-approaches an out-of-range target', () => {
  const battle = isolatedBattle({ playerId: 'dragonite', enemyId: 'pikachu', suppressBasics: false });
  putInLine(battle, battle.player.def.basic.range + 70);
  const start = { x: battle.player.x, y: battle.player.y };
  advance(battle, 0.8);
  closeTo(battle.player.x, start.x);
  closeTo(battle.player.y, start.y);
  assert.equal(battle.player.basicWindup, null);
  assert.equal(battle.stats.basicsFired, 0);
});

test('out-of-range always-auto state exposes the exact HUD snapshot without attack modes', () => {
  const battle = isolatedBattle({ playerId: 'dragonite', enemyId: 'pikachu', suppressBasics: false });
  putInLine(battle, 300);
  const {teams,activeIndices,switchCooldowns,switchReason,trainerSkills,...combatSnapshot}=battle.snapshot();
  assert.equal(teams.player.length,1);assert.equal(teams.enemy.length,1);
  assert.deepEqual(activeIndices,{player:0,enemy:0});assert.deepEqual(switchCooldowns,{player:0,enemy:0});
  assert.equal(switchReason,null);assert.deepEqual(trainerSkills,{player:'haste',enemy:'haste'});
  assert.deepEqual(combatSnapshot, {
    state: 'playing', time: 0,
    player: { id: 'dragonite', name: '망나뇽', x: 400, y: 400, hp: 1410, maxHp: 1410, mp: 100, shield: 0, anim: 'idle', basicCooldown: 0, basicRange: 125, basicWindup: 0, inBasicRange: false, distanceToTarget: 300, dodging: false, invulnerable: false, dodgeProtected: false, actionPhase: null, actionRemaining: 0, warningRemaining: 0, pose: null },
    enemy: { id: 'pikachu', name: '피카츄', x: 700, y: 400, hp: 1020, maxHp: 1020, mp: 100, shield: 0, anim: 'idle', basicCooldown: 0.7, basicRange: 360, basicWindup: 0, inBasicRange: true, distanceToTarget: 300, dodging: false, invulnerable: false, dodgeProtected: false, actionPhase: null, actionRemaining: 0, warningRemaining: 0, pose: null },
    cooldowns: { q: 0, w: 0, e: 0, r: 30, s: 0, d: 0 },
    enemyCooldowns: { q: 0, w: 0, e: 0, r: 30, s: 0, d: 0 },
    stats: { damageDealt: 0, damageTaken: 0, movesUsed: 0, hitsLanded: 0, basicsFired: 0, basicHits: 0, dodges: 0, avoidedDamage: 0, trackingBreaks: 0, knockouts: 0, losses: 0, switches: 0 },
    projectiles: 0, hazards: 0, enraged: false, autoAttack: true, hitStop: 0, difficulty: 'standard',
  });
});

test('ranged basics home toward a moving target and apply one hit of basic damage', () => {
  const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'typhlosion' });
  putInLine(battle, 300);
  battle.player.basicTimer = 0;
  assert.equal(battle.tryBasic(battle.player), true);
  advance(battle, battle.player.def.basic.windup + 0.01);
  assert.equal(battle.projectiles.length, 1);
  const projectile = battle.projectiles[0];
  closeTo(projectile.vy, 0);

  battle.place(battle.enemy, battle.enemy.x, battle.enemy.y + 110);
  battle.update(STEP);
  assert.ok(projectile.vy > 0, 'homing should bend toward the target’s new y position');
  advance(battle, 0.65);
  assert.equal(battle.enemy.hp, battle.enemy.maxHp - battle.player.def.basic.damage);
  assert.equal(battle.stats.basicsFired, 1);
  assert.equal(battle.stats.basicHits, 1);
  assert.equal(battle.projectiles.length, 0);
  const impact = battle.drainEvents().find((event) => event.type === 'impact');
  assert.ok(impact);
  assert.equal(impact.type, 'impact');
  assert.equal(impact.projectileType, 'basic');
});

test('melee basics enforce range, wait for windup, and whiff if the target escapes', () => {
  const hit = isolatedBattle({ playerId: 'dragonite', enemyId: 'pikachu' });
  putInLine(hit, hit.player.def.basic.range);
  hit.player.basicTimer = 0;
  assert.equal(hit.tryBasic(hit.player), true);
  advance(hit, hit.player.def.basic.windup - 0.01);
  assert.equal(hit.enemy.hp, hit.enemy.maxHp);
  advance(hit, 0.02);
  assert.equal(hit.enemy.hp, hit.enemy.maxHp - hit.player.def.basic.damage);
  assert.equal(hit.stats.basicHits, 1);

  const outOfRange = isolatedBattle({ playerId: 'dragonite', enemyId: 'pikachu' });
  putInLine(outOfRange, outOfRange.player.def.basic.range + 0.01);
  outOfRange.player.basicTimer = 0;
  assert.equal(outOfRange.tryBasic(outOfRange.player), false);
  assert.equal(outOfRange.player.basicWindup, null);

  const escaped = isolatedBattle({ playerId: 'dragonite', enemyId: 'pikachu' });
  putInLine(escaped, escaped.player.def.basic.range);
  escaped.player.basicTimer = 0;
  assert.equal(escaped.tryBasic(escaped.player), true);
  escaped.place(escaped.enemy, escaped.player.x + escaped.player.def.basic.range + 100, escaped.player.y);
  advance(escaped, escaped.player.def.basic.windup + 0.02);
  assert.equal(escaped.enemy.hp, escaped.enemy.maxHp);
  assert.equal(escaped.stats.basicHits, 0);
});

test('energy and cooldown gates preserve resources on rejection and recover over time', () => {
  const battle = isolatedBattle();
  const move = battle.moves.q;
  battle.player.mp = move.cost - 1;
  assert.equal(battle.cast('q'), false);
  assert.equal(battle.player.mp, move.cost - 1);
  assert.equal(battle.player.cooldowns.q, 0);
  assert.equal(battle.stats.movesUsed, 0);
  assert.match(battle.drainEvents().at(-1).text, /에너지가 부족/);

  battle.player.mp = move.cost;
  assert.equal(battle.cast('q'), true);
  assert.equal(battle.player.mp, 0);
  assert.equal(battle.player.cooldowns.q, move.cooldown);
  assert.equal(battle.stats.movesUsed, 1);
  assert.equal(battle.cast('q'), false);
  assert.equal(battle.stats.movesUsed, 1);

  advanceBattleTime(battle, move.cooldown);
  closeTo(battle.player.cooldowns.q, 0);
  closeTo(battle.player.mp, Math.min(100, 10.5 * move.cooldown), 1e-7);
});

test('bolt, fan, and volley create their distinct projectile patterns', () => {
  const bolt = isolatedBattle({ playerId: 'pikachu' });
  putInLine(bolt, 500, 300);
  assert.equal(bolt.cast('q'), true);
  advanceBattleTime(bolt, 0.12);
  assert.equal(bolt.projectiles.length, 1);
  assert.equal(bolt.projectiles[0].type, 'bolt');
  assert.equal(bolt.projectiles[0].homing, bolt.moves.q.homing);

  const fan = isolatedBattle({ playerId: 'charizard' });
  putInLine(fan, 650, 300);
  assert.equal(fan.cast('q'), true);
  advanceBattleTime(fan, 0.12);
  assert.equal(fan.projectiles.length, fan.moves.q.count);
  assert.ok(fan.projectiles.every((p) => p.group === fan.projectiles[0].group && p.maxHits === 3));
  assert.ok(new Set(fan.projectiles.map((p) => p.vy.toFixed(4))).size > 1);

  const volley = isolatedBattle({ playerId: 'blastoise' });
  putInLine(volley, 700, 300);
  assert.equal(volley.cast('q'), true);
  assert.equal(volley.tasks.length, volley.moves.q.count);
  advanceBattleTime(volley, 0.43);
  assert.equal(volley.projectiles.length, volley.moves.q.count);
  assert.ok(volley.projectiles.every((p) => p.type === 'orb'));
});

test('slash and pulse resolve after their windups with range, stun, knockback, and slow', () => {
  const slash = isolatedBattle({ playerId: 'pikachu' });
  putInLine(slash, 145);
  const oldEnemyX = slash.enemy.x;
  assert.equal(slash.cast('e'), true);
  assert.equal(slash.enemy.hp, slash.enemy.maxHp);
  advance(slash, 0.09);
  assert.equal(slash.enemy.hp, slash.enemy.maxHp - slash.moves.e.damage);
  assert.equal(slash.enemy.stun, slash.moves.e.stun);
  assert.ok(slash.enemy.x > oldEnemyX);

  const pulse = isolatedBattle({ playerId: 'venusaur' });
  putInLine(pulse, 200);
  assert.equal(pulse.cast('w'), true);
  advance(pulse, 0.09);
  assert.equal(pulse.enemy.hp, pulse.enemy.maxHp - pulse.moves.w.damage);
  assert.equal(pulse.enemy.slow, pulse.moves.w.slow);
});

test('field, storm, nova, and beam telegraph then resolve their area effects', () => {
  const field = isolatedBattle({ playerId: 'charizard' });
  putInLine(field, 250);
  assert.equal(field.cast('e'), true);
  assert.equal(field.hazards.length, 1);
  assert.equal(field.hazards[0].delay, 0.45);
  advance(field, 0.46);
  assert.equal(field.enemy.hp, field.enemy.maxHp - field.moves.e.damage);
  assert.ok(field.enemy.slow > 0);
  const afterInitial = field.enemy.hp;
  advance(field, 0.6);
  assert.ok(field.enemy.hp < afterInitial, 'field damage-over-time should tick');

  const storm = isolatedBattle({ playerId: 'pikachu' });
  putInLine(storm, 300);
  makeReady(storm, 'r');
  assert.equal(storm.cast('r'), true);
  assert.equal(storm.hazards.length, storm.moves.r.strikes);
  [0.68, 0.93, 1.18].forEach((delay, index) => closeTo(storm.hazards[index].delay, delay));
  advanceBattleTime(storm, 1.25);
  assert.equal(storm.stats.hitsLanded, storm.moves.r.strikes);
  assert.ok(storm.enemy.hp < storm.enemy.maxHp);

  const nova = isolatedBattle({ playerId: 'charizard' });
  putInLine(nova, 250);
  makeReady(nova, 'r');
  assert.equal(nova.cast('r'), true);
  assert.equal(nova.hazards[0].type, 'nova');
  advance(nova, 0.59);
  assert.ok(nova.enemy.hp < nova.enemy.maxHp);
  assert.ok(nova.projectiles.length > 0, 'nova should emit its outward projectile ring');

  const beam = isolatedBattle({ playerId: 'blastoise' });
  putInLine(beam, 350);
  makeReady(beam, 'r');
  assert.equal(beam.cast('r'), true);
  assert.equal(beam.windups[0].type, 'beam');
  assert.equal(beam.enemy.hp, beam.enemy.maxHp);
  advance(beam, 0.61);
  assert.equal(beam.enemy.hp, beam.enemy.maxHp - beam.moves.r.damage);
  assert.ok(beam.drainEvents().some((event) => event.type === 'beam'));
});

test('storm ultimate distributes integer strikes to deal exactly its advertised total damage', () => {
  const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'tyranitar' });
  putInLine(battle, 300);
  makeReady(battle, 'r');
  assert.equal(battle.cast('r'), true);
  advanceBattleTime(battle, 1.25);
  assert.equal(battle.stats.hitsLanded, battle.moves.r.strikes);
  assert.equal(battle.stats.damageDealt, battle.moves.r.damage);
});

test('native guard absorbs basic hits and trainer haste accelerates without teleport or invulnerability', () => {
  const guarded = isolatedBattle({ playerId: 'ampharos', enemyId: 'pikachu' });
  putInLine(guarded, 250);
  assert.equal(guarded.cast('w'), true);
  assert.equal(guarded.player.shield, guarded.moves.w.shield);
  assert.equal(guarded.player.shieldTime, guarded.moves.w.duration);
  guarded.enemy.basicTimer = 0;
  assert.equal(guarded.tryBasic(guarded.enemy), true);
  advance(guarded, 0.8);
  assert.equal(guarded.player.hp, guarded.player.maxHp);
  assert.equal(guarded.player.shield, guarded.moves.w.shield - guarded.enemy.def.basic.damage);
  const shieldHit = guarded.drainEvents().find((event) => event.type === 'hit' && event.team === 'enemy');
  assert.equal(shieldHit.absorbed, guarded.enemy.def.basic.damage);

  const haste = isolatedBattle();
  haste.place(haste.player, 350, 400);haste.place(haste.enemy, 700, 400);
  assert.equal(haste.cast('s'), true);
  assert.equal(haste.player.x, 350);assert.equal(haste.player.invul, 0);
  assert.equal(haste.damage(haste.player, 50, 'enemy'), true);
  haste.hitStop=0;haste.player.hurt=0;
  advance(haste,.1,{x:1,y:0});
  closeTo(haste.player.x-350,haste.player.speed*1.5*.1);

});

test('Dodge works in eight directions, travels exactly 175 independent of timestep, clamps at bounds, and has no recovery lock', () => {
  const directions = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0],            [1, 0],
    [-1, 1],  [0, 1],  [1, 1],
  ];
  for (const [x, y] of directions) {
    const battle = isolatedBattle();
    const startY = x === 0 && y < 0 ? 500 : x === 0 && y > 0 ? 260 : 394;
    battle.place(battle.player, 640, startY);
    battle.place(battle.enemy, 1000, startY);
    const input = { x, y };
    battle.input = input;
    assert.equal(battle.cast('d'), true);
    const start = { x: battle.player.x, y: battle.player.y };
    finishDash(battle, input);
    const direction = unit(x, y);
    closeTo(battle.player.x, start.x + direction.x * 175, 1e-7, x + ',' + y + ' x');
    closeTo(battle.player.y, start.y + direction.y * 175, 1e-7, x + ',' + y + ' y');
  }

  for (const step of [0.05, 0.03, 0.017]) {
    const battle = isolatedBattle();
    battle.place(battle.player, 400, 400);
    battle.place(battle.enemy, 900, 400);
    const input = { x: 1, y: 0 };
    battle.input = input;
    assert.equal(battle.cast('d'), true);
    const startX = battle.player.x;
    finishDash(battle, input, step);
    closeTo(battle.player.x - startX, 175, 1e-7, 'step ' + step);
  }

  for (const { x, y, input, axis, expected } of [
    { x: BOUNDS.left + 20, y: 400, input: { x: -1, y: 0 }, axis: 'x', expected: BOUNDS.left },
    { x: BOUNDS.right - 20, y: 400, input: { x: 1, y: 0 }, axis: 'x', expected: BOUNDS.right },
    { x: 500, y: BOUNDS.top + 20, input: { x: 0, y: -1 }, axis: 'y', expected: BOUNDS.top },
    { x: 500, y: BOUNDS.bottom - 20, input: { x: 0, y: 1 }, axis: 'y', expected: BOUNDS.bottom },
  ]) {
    const battle = isolatedBattle();
    battle.place(battle.player, x, y);
    battle.place(battle.enemy, 700, 400);
    battle.input = input;
    assert.equal(battle.cast('d'), true);
    finishDash(battle, input);
    const radius = battle.player.radius;
    closeTo(battle.player[axis], expected + (axis === 'x' ? (input.x < 0 ? radius : -radius) : (input.y < 0 ? radius : -radius)));
  }

  const recovery = isolatedBattle();
  recovery.place(recovery.player, 400, 400);
  recovery.place(recovery.enemy, 900, 400);
  recovery.input = { x: 1, y: 0 };
  assert.equal(recovery.cast('d'), true);
  advance(recovery, 0.28, { x: 1, y: 0 });
  assert.equal(recovery.player.dash, null);
  assert.equal(recovery.player.dodgeRecovery, 0);
  const endX = recovery.player.x;
  recovery.update(STEP, { x: 1, y: 0 });
  closeTo(recovery.player.x - endX, recovery.player.speed * STEP);
});

test('Dodge is non-healing, non-damaging, exactly 2-second gated, and repeatable', () => {
  for (const injured of [false, true]) {
    const battle = isolatedBattle();
    putInLine(battle, 80);
    if (injured) battle.player.hp -= 250;
    const hp = battle.player.hp;
    const enemyHp = battle.enemy.hp;
    for (let cast = 0; cast < 3; cast++) {
      battle.input = { x: 1, y: 0 };
      assert.equal(battle.cast('d'), true, 'cast ' + cast);
      assert.equal(battle.player.cooldowns.d, 2);
      assert.equal(battle.player.hp, hp, injured ? 'injured Dodge must not heal' : 'full-HP Dodge is allowed');
      assert.equal(battle.cast('d'), false);
      finishDash(battle, { x: 1, y: 0 });
      assert.equal(battle.enemy.hp, enemyHp);
      assert.equal(battle.stats.damageDealt, 0);
      assert.equal(battle.stats.hitsLanded, 0);
      if (cast < 2) {
        advanceBattleTime(battle, 2 - (battle.time % 2));
        closeTo(battle.player.cooldowns.d, 0);
      }
    }
    assert.equal(battle.stats.movesUsed, 3);
  }
});

test('Dodge blocks instantly, protects through the post-dash tail, counts one dodge per guard, and expires after 0.5s', () => {
  const instant = isolatedBattle();
  instant.input = { x: 1, y: 0 };
  assert.equal(instant.cast('d'), true);
  assert.equal(instant.player.invul, 0.5);
  assert.deepEqual(instant.player.dodgeGuard, { time: 0.5, evaded: false });
  assert.equal(instant.damage(instant.player, 37, 'enemy'), false, 'damage before the first update must be blocked');
  assert.equal(instant.stats.dodges, 1);
  assert.equal(instant.stats.avoidedDamage, 37);

  const tail = isolatedBattle();
  tail.input = { x: 1, y: 0 };
  assert.equal(tail.cast('d'), true);
  assert.equal(tail.stats.dodges, 0, 'casting alone is not a dodge statistic');
  advance(tail, 0.28, { x: 1, y: 0 });
  assert.equal(tail.player.dash, null, 'movement must end at 0.28s');
  assert.ok(tail.player.invul > 0);
  assert.ok(tail.player.dodgeGuard);
  assert.equal(tail.damage(tail.player, 13, 'enemy'), false, 'post-dash protection tail must block');
  assert.equal(tail.stats.dodges, 1, 'a protected tail hit counts as an actual dodge');
  assert.equal(tail.stats.avoidedDamage, 13);
  assert.equal(tail.damage(tail.player, 9, 'enemy'), false);
  assert.equal(tail.stats.dodges, 1, 'one guard counts only one dodge action');
  assert.equal(tail.stats.avoidedDamage, 22, 'every blocked attack contributes avoided damage');
  assert.equal(tail.damage(tail.player, 7, 'enemy', { periodic: true }), false);
  assert.equal(tail.stats.avoidedDamage, 22, 'periodic immunity is not an avoided incoming strike');

  const boundary = isolatedBattle();
  boundary.input = { x: 1, y: 0 };
  assert.equal(boundary.cast('d'), true);
  advance(boundary, 0.499, { x: 1, y: 0 });
  assert.equal(boundary.damage(boundary.player, 11, 'enemy'), false);
  advance(boundary, 0.0011, { x: 1, y: 0 });
  assert.equal(boundary.player.invul, 0);
  assert.equal(boundary.player.dodgeGuard, null);
  assert.equal(boundary.damage(boundary.player, 11, 'enemy'), true, 'protection must expire at the boundary plus a small step');
});

test('Dodge cancels own automatic basic and R charge work but preserves released projectiles', () => {
  const basic = isolatedBattle();
  putInLine(basic, 250);
  basic.player.basicTimer = 0;
  assert.equal(basic.tryBasic(basic.player), true);
  assert.ok(basic.player.basicWindup);
  basic.input = { x: 0, y: 1 };
  assert.equal(basic.cast('d'), true);
  assert.equal(basic.player.basicWindup, null);

  const charged = isolatedBattle({ playerId: 'blastoise' });
  putInLine(charged, 350);
  makeReady(charged, 'r');
  assert.equal(charged.cast('r'), true);
  assert.ok(charged.tasks.some((task) => task.team === 'player' && task.kind === 'beam'));
  assert.ok(charged.windups.some((windup) => windup.team === 'player' && windup.type === 'beam'));
  charged.input = { x: 0, y: 1 };
  assert.equal(charged.cast('d'), true);
  assert.equal(charged.tasks.some((task) => task.team === 'player'), false);
  assert.equal(charged.windups.some((windup) => windup.team === 'player'), false);
  assert.equal(charged.player.castRoot, 0);

  const released = isolatedBattle({ playerId: 'pikachu' });
  putInLine(released, 500);
  assert.equal(released.cast('q'), true);
  advanceBattleTime(released, 0.12);
  assert.equal(released.projectiles.length, 1);
  const projectile = released.projectiles[0];
  released.input = { x: 0, y: 1 };
  assert.equal(released.cast('d'), true);
  assert.equal(released.projectiles.length, 1);
  assert.equal(released.projectiles[0], projectile);
});

test('Dodge is usable during hit stun, clears stun, and does not heal or cleanse burn', () => {
  const battle = isolatedBattle();
  battle.player.hp -= 100;
  battle.player.stun = 0.8;
  battle.player.hurt = 0.6;
  battle.player.burn = 2;
  battle.input = { x: 0, y: -1 };
  const hp = battle.player.hp;
  assert.equal(battle.cast('d'), true);
  assert.equal(battle.player.stun, 0);
  assert.equal(battle.player.hurt, 0);
  assert.equal(battle.player.hp, hp);
  assert.equal(battle.player.burn, 2);
});

test('Dodge fixes the full homing-basic repro, permanently breaking tracking instead of delaying the hit', () => {
  function repro(dodge) {
    const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'typhlosion' });
    battle.place(battle.player, 500, 410);
    battle.place(battle.enemy, 840, 410);
    battle.fireBasic(battle.enemy);
    assert.equal(battle.projectiles.length, 1);
    const shot = battle.projectiles[0];
    if (dodge) {
      battle.input = { x: 0, y: -1 };
      assert.equal(battle.cast('d'), true);
      assert.equal(battle.projectiles[0], shot, 'Dodge must not delete a released projectile');
      assert.equal(shot.homing, 0);
      assert.equal(shot.trackingBroken, true);
      advance(battle, 0.55, { x: 0, y: -1 });
      assert.equal(battle.player.dodgeGuard, null);
      assert.equal(shot.homing, 0, 'homing must not return when the guard expires');
      assert.equal(shot.trackingBroken, true);
      advance(battle, 1.5);
    } else {
      advance(battle, 2.05);
    }
    return battle;
  }

  const withoutDodge = repro(false);
  const withDodge = repro(true);
  assert.equal(withoutDodge.stats.damageTaken, 27);
  assert.equal(withDodge.stats.damageTaken, 0);
  assert.equal(withDodge.stats.trackingBreaks, 1);
  assert.ok(withDodge.time >= 2, `repro only ran ${withDodge.time}s`);
});

test('Dodge during an enemy basic warning freezes the committed aim and releases a non-homing shot', () => {
  const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'typhlosion' });
  battle.place(battle.player, 500, 410);
  battle.place(battle.enemy, 840, 410);
  battle.enemy.basicTimer = 0;
  assert.equal(battle.tryBasic(battle.enemy), true);
  const committedAim = { ...battle.enemy.basicWindup.aim };
  assert.deepEqual(battle.enemy.action.aim, committedAim);
  assert.equal(battle.enemy.basicWindup.duration, DIFFICULTIES.standard.basicWindup);

  battle.input = { x: 0, y: -1 };
  assert.equal(battle.cast('d'), true);
  assert.equal(battle.enemy.basicWindup.trackingBroken, true);
  assert.deepEqual(battle.enemy.basicWindup.aim, committedAim);
  assert.deepEqual(battle.enemy.action.aim, committedAim);
  assert.equal(battle.stats.trackingBreaks, 1);

  advance(battle, DIFFICULTIES.standard.basicWindup + 0.01, { x: 0, y: -1 });
  assert.equal(battle.projectiles.length, 1);
  const shot = battle.projectiles[0];
  assert.equal(shot.homing, 0);
  assert.equal(shot.trackingBroken, true);
  closeTo(Math.atan2(shot.vy, shot.vx), Math.atan2(committedAim.y - battle.enemy.y, committedAim.x - battle.enemy.x));
});

test('Dodge breaks every queued homing-volley shot so later releases cannot reacquire', () => {
  const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'mewtwo' });
  battle.place(battle.player, 500, 410);
  battle.place(battle.enemy, 900, 410);
  makeReady(battle, 'q', 'enemy');
  assert.equal(battle.castFor(battle.enemy, 'q', { ai: true }), true);
  assert.equal(battle.tasks.length, battle.enemy.def.moves.q.count);
  assert.ok(battle.tasks.every((task) => task.m.homing > 0 && task.tracked === false));
  const committedAim = { ...battle.enemy.action.aim };

  battle.input = { x: 0, y: -1 };
  assert.equal(battle.cast('d'), true);
  assert.equal(battle.tasks.length, battle.enemy.def.moves.q.count, 'enemy queue must survive the player Dodge');
  assert.ok(battle.tasks.every((task) => task.trackingBroken && task.tracked === false));
  assert.ok(battle.tasks.every((task) => JSON.stringify(task.aim) === JSON.stringify(committedAim)));
  assert.equal(battle.stats.trackingBreaks, battle.enemy.def.moves.q.count);

  advanceBattleTime(battle, DIFFICULTIES.standard.reaction + (battle.enemy.def.moves.q.count - 1) * DIFFICULTIES.standard.volleyInterval + 0.02, { x: 0, y: -1 });
  assert.equal(battle.projectiles.length, battle.enemy.def.moves.q.count);
  assert.ok(battle.projectiles.every((shot) => shot.homing === 0 && shot.trackingBroken));
  advance(battle, 0.2, { x: 1, y: 0 });
  assert.ok(battle.projectiles.every((shot) => shot.homing === 0 && shot.trackingBroken), 'later updates restored tracking');
});

test('ordinary enemy volleys commit one cast-time aim for every subsequent shot', () => {
  const battle = isolatedBattle({ playerId: 'pikachu', enemyId: 'blastoise' });
  battle.place(battle.player, 500, 410);
  battle.place(battle.enemy, 900, 410);
  battle.player.vx = 95;
  battle.player.vy = -35;
  makeReady(battle, 'q', 'enemy');
  assert.equal(battle.castFor(battle.enemy, 'q', { ai: true }), true);
  const committedAim = { ...battle.enemy.action.aim };
  assert.ok(battle.tasks.every((task) => task.tracked === false));
  assert.ok(battle.tasks.every((task) => JSON.stringify(task.aim) === JSON.stringify(committedAim)));

  battle.place(battle.player, 500, BOUNDS.top + battle.player.radius);
  advanceBattleTime(battle, DIFFICULTIES.standard.reaction + 0.01);
  battle.place(battle.player, 500, BOUNDS.bottom - battle.player.radius);
  advanceBattleTime(battle, DIFFICULTIES.standard.volleyInterval);
  battle.place(battle.player, 300, BOUNDS.top + battle.player.radius);
  advanceBattleTime(battle, DIFFICULTIES.standard.volleyInterval);

  assert.equal(battle.projectiles.length, battle.enemy.def.moves.q.count);
  const expectedAngle = Math.atan2(committedAim.y - battle.enemy.y, committedAim.x - battle.enemy.x);
  for (const shot of battle.projectiles) {
    closeTo(Math.atan2(shot.vy, shot.vx), expectedAngle);
    assert.equal(shot.homing, 0);
  }
});

test('Dodge preserves broken bullets and damage applies after guard expiry when the player walks into one', () => {
  const battle = isolatedBattle();
  battle.place(battle.player, 500, 410);
  battle.place(battle.enemy, 900, 410);
  battle.addProjectile({ x: 500, y: 550, dir: { x: 0, y: -1 }, speed: 100, damage: 27, team: 'enemy', life: 4, homing: 4 });
  const shot = battle.projectiles[0];
  battle.input = { x: 0, y: -1 };
  assert.equal(battle.cast('d'), true);
  assert.equal(battle.projectiles.length, 1);
  assert.equal(battle.projectiles[0], shot);
  assert.equal(shot.homing, 0);
  assert.equal(shot.trackingBroken, true);

  advance(battle, 0.51, { x: 0, y: -1 });
  assert.equal(battle.player.dodgeGuard, null);
  assert.equal(battle.stats.damageTaken, 0);
  advance(battle, 1.2, { x: 0, y: 1 });
  assert.equal(battle.stats.damageTaken, 27);
  assert.equal(battle.player.hp, battle.player.maxHp - 27);
  assert.equal(battle.projectiles.length, 0);
});

test('hit-stop durations scale by impact, freeze world time, and resume movement plus automatic acquisition', () => {
  const basicImpact = isolatedBattle();
  assert.equal(basicImpact.damage(basicImpact.enemy, 24, 'player', { basic: true }), true);
  closeTo(basicImpact.hitStop, 0.028);
  const regularImpact = isolatedBattle();
  assert.equal(regularImpact.damage(regularImpact.enemy, 60, 'player'), true);
  closeTo(regularImpact.hitStop, 0.042);
  const heavyImpact = isolatedBattle();
  assert.equal(heavyImpact.damage(heavyImpact.enemy, 100, 'player'), true);
  closeTo(heavyImpact.hitStop, 0.062);

  const battle = isolatedBattle();
  putInLine(battle, battle.player.def.basic.range + 35);
  battle.player.basicTimer = 0;
  battle.player.cooldowns.q = 1;
  battle.hitStop = 0.04;
  const frozen = { time: battle.time, x: battle.player.x, cooldown: battle.player.cooldowns.q, basicTimer: battle.player.basicTimer };
  battle.update(0.03, { x: 1, y: 0 });
  assert.deepEqual(
    { time: battle.time, x: battle.player.x, cooldown: battle.player.cooldowns.q, basicTimer: battle.player.basicTimer },
    frozen,
  );
  battle.update(0.02, { x: 1, y: 0 });
  closeTo(battle.time, 0.01);
  closeTo(battle.player.cooldowns.q, 0.99);
  assert.ok(battle.player.x > frozen.x);
  advance(battle, 0.9, (elapsed) => elapsed < 0.2 ? { x: 1, y: 0 } : { x: 0, y: 0 });
  assert.equal(battle.stats.basicsFired, 1);
  assert.equal(battle.stats.basicHits, 1);
});

test('pause freezes countdown and all live combat timers, motion, regeneration, and effects', () => {
  const countdown = new Battle({ random: () => 0.5 });
  countdown.start();
  assert.equal(countdown.pause(), true);
  const countdownBefore = countdown.countdown;
  advance(countdown, 1);
  assert.equal(countdown.countdown, countdownBefore);
  countdown.resume();
  countdown.update(STEP);
  assert.ok(countdown.countdown < countdownBefore);

  const battle = isolatedBattle({ playerId: 'charizard' });
  putInLine(battle, 300);
  battle.player.mp = 50;
  assert.equal(battle.cast('q'), true);
  battle.player.cooldowns.r = 12;
  battle.hazards.push({ type: 'field', team: 'enemy', x: 500, y: 400, r: 65, delay: 1, life: 2, damage: 10, triggered: false });
  battle.windups.push({ type: 'charge', life: 1, maxLife: 1 });
  battle.schedule(1, 'shot', { team: 'player', m: battle.moves.q, aim: { x: 700, y: 400 } });
  makeReady(battle, 'q', 'enemy');
  assert.equal(battle.castFor(battle.enemy, 'q', { ai: true }), true);
  assert.ok(battle.enemy.action);
  assert.equal(battle.pause(), true);
  assert.equal(battle.autoAttack, true);
  assert.equal(battle.cast('d'), false);
  const before = structuredClone({
    time: battle.time,
    countdown: battle.countdown,
    player: battle.player,
    enemy: battle.enemy,
    projectiles: battle.projectiles,
    hazards: battle.hazards,
    windups: battle.windups,
    tasks: battle.tasks,
  });
  advance(battle, 2, { x: 1, y: 1 });
  const after = structuredClone({
    time: battle.time,
    countdown: battle.countdown,
    player: battle.player,
    enemy: battle.enemy,
    projectiles: battle.projectiles,
    hazards: battle.hazards,
    windups: battle.windups,
    tasks: battle.tasks,
  });
  assert.deepEqual(after, before);
  battle.resume();
  battle.update(STEP);
  assert.equal(battle.state, 'playing');
  assert.ok(battle.time > before.time);
  assert.ok(battle.player.cooldowns.r < before.player.cooldowns.r);
  assert.ok(battle.enemy.action.elapsed > before.enemy.action.elapsed);
});

test('all enemy kits expose all five difficulty-specific warnings and gated action state, including defensive W', () => {
  for (const difficultyName of DIFFICULTY_IDS) {
    const timing = DIFFICULTIES[difficultyName];
    for (const mon of ROSTER) {
      for (const key of ['q', 'w', 'e', 'r']) {
        const battle = isolatedBattle({ enemyId: mon.id, difficulty: difficultyName });
        makeReady(battle, key, 'enemy');
        const move = battle.enemy.def.moves[key];
        if(move.kind==='blinkStrike')putInLine(battle,move.range*.7);
        assert.equal(battle.castFor(battle.enemy, key, { ai: true }), true, `${difficultyName} ${mon.id}.${key}`);
        const action = battle.enemy.action;
        assert.ok(action, `${difficultyName} ${mon.id}.${key} has no action`);
        assert.deepEqual(Object.keys(action), ['kind', 'key', 'aim', 'elapsed', 'windup', 'attackEnd', 'duration']);
        assert.equal(action.kind, move.kind);
        assert.equal(action.key, key);
        assert.equal(action.elapsed, 0);
        closeTo(action.windup, enemyWarningFor(move, key, timing), EPSILON, `${difficultyName} ${mon.id}.${key} warning`);
        assert.ok(action.attackEnd >= action.windup, `${difficultyName} ${mon.id}.${key} attack end`);
        closeTo(action.duration - action.attackEnd, timing.recovery, EPSILON, `${difficultyName} ${mon.id}.${key} recovery`);
        assert.equal(battle.snapshot().enemy.actionPhase, 'telegraph');
        closeTo(battle.snapshot().enemy.warningRemaining, action.windup);
        assert.equal(battle.tryBasic(battle.enemy), false, `${difficultyName} ${mon.id}.${key} overlapped a basic`);
        const otherKey = key === 'q' ? 'e' : 'q';
        makeReady(battle, otherKey, 'enemy');
        assert.equal(battle.castFor(battle.enemy, otherKey, { ai: true }), false, `${difficultyName} ${mon.id}.${key} overlapped ${otherKey}`);
        const events = battle.drainEvents();
        assert.ok(events.some((event) => event.type === 'enemyCast' && event.ko === move.ko), `${difficultyName} ${mon.id}.${key} has no cast telegraph`);

        if (mon.id === 'ampharos' && key === 'w') {
          assert.equal(move.kind, 'guard');
          closeTo(action.windup, 0.2);
          assert.equal(battle.enemy.shield, move.shield);
          assert.equal(battle.snapshot().enemy.actionPhase, 'telegraph');
        }
      }
    }
  }
});

test('live AI never starts a skill during a basic action or a basic during a skill action', () => {
  function assertNoOverlap(firstKind) {
    const battle = liveBattle({ enemyId: firstKind === 'skill' ? 'blastoise' : 'typhlosion' });
    battle.player.basicTimer = 1_000_000;
    battle.player.invul = 999;
    putInLine(battle, 320, 500, 410);
    for (const key of ['q', 'w', 'e', 'r', 's']) battle.enemy.cooldowns[key] = 99;
    battle.enemy.basicTimer = firstKind === 'basic' ? 0 : 99;
    if (firstKind === 'skill') battle.enemy.cooldowns.q = 0;
    battle.aiDecision = 0;
    battle.update(0.01);
    const initialStarts = battle.drainEvents().filter((event) => event.team === 'enemy' && (event.type === 'cast' || event.type === 'basicWindup'));
    assert.equal(initialStarts.length, 1, `${firstKind} did not start exactly once`);
    assert.equal(initialStarts[0].type, firstKind === 'skill' ? 'cast' : 'basicWindup');
    const firstAction = battle.enemy.action;
    assert.ok(firstAction);
    const startedAt = battle.time;

    for (const key of ['q', 'w', 'e', 'r']) battle.enemy.cooldowns[key] = 0;
    battle.enemy.basicTimer = 0;
    assert.equal(battle.tryBasic(battle.enemy), false);
    assert.equal(battle.castFor(battle.enemy, 'e', { ai: true }), false);

    while (battle.time < startedAt + firstAction.duration - 0.015) {
      battle.aiDecision = 0;
      battle.aiComboTimer = 0;
      battle.update(0.01);
      const overlap = battle.drainEvents().filter((event) => event.team === 'enemy' && (event.type === 'cast' || event.type === 'basicWindup'));
      assert.deepEqual(overlap, [], `${firstKind} action overlapped at ${battle.time.toFixed(3)}`);
    }

    let nextStart = null;
    for (let frame = 0; frame < 10 && !nextStart; frame++) {
      battle.aiDecision = 0;
      battle.aiComboTimer = 0;
      battle.update(0.01);
      nextStart = battle.drainEvents().find((event) => event.team === 'enemy' && (event.type === 'cast' || event.type === 'basicWindup')) || null;
    }
    assert.ok(nextStart, `${firstKind} action never released the gate`);
    assert.ok(battle.time >= startedAt + firstAction.duration - EPSILON,
      `${firstKind} follow-up started at ${battle.time}, before ${startedAt + firstAction.duration}`);
  }

  assertNoOverlap('skill');
  assertNoOverlap('basic');
});

test('enemy basic and volley actions include warning, last release, projectile flight, and post-flight recovery', () => {
  const volley = isolatedBattle({ enemyId: 'blastoise' });
  volley.player.invul = 999;
  volley.place(volley.player, 500, 410);
  volley.place(volley.enemy, 900, 410);
  makeReady(volley, 'q', 'enemy');
  assert.equal(volley.castFor(volley.enemy, 'q', { ai: true }), true);
  const move = volley.enemy.def.moves.q;
  const action = { ...volley.enemy.action };
  const interval = Math.max(move.interval, DIFFICULTIES.standard.volleyInterval);
  const lastRelease = DIFFICULTIES.standard.reaction + (move.count - 1) * interval;
  const flight = volley.projectileFlight(volley.enemy, move.speed, action.aim);
  closeTo(action.windup, DIFFICULTIES.standard.reaction);
  closeTo(action.attackEnd, lastRelease + flight);
  closeTo(action.duration, lastRelease + flight + DIFFICULTIES.standard.recovery);

  advanceBattleTime(volley, lastRelease + 0.001);
  assert.equal(volley.tasks.filter((task) => task.team === 'enemy').length, 0);
  assert.equal(volley.snapshot().enemy.actionPhase, 'attacking', 'last release should still be inside estimated projectile flight');
  assert.equal(volley.tryBasic(volley.enemy), false);
  makeReady(volley, 'e', 'enemy');
  assert.equal(volley.castFor(volley.enemy, 'e', { ai: true }), false);

  advanceBattleTime(volley, action.attackEnd - volley.time + 0.001);
  assert.equal(volley.snapshot().enemy.actionPhase, 'recovery');
  closeTo(volley.enemy.action.duration - volley.enemy.action.attackEnd, DIFFICULTIES.standard.recovery);
  advanceBattleTime(volley, action.duration - volley.time - 0.01);
  assert.ok(volley.enemy.action);
  advanceBattleTime(volley, 0.02);
  assert.equal(volley.enemy.action, null);

  const basic = isolatedBattle({ enemyId: 'typhlosion' });
  basic.place(basic.player, 500, 410);
  basic.place(basic.enemy, 840, 410);
  basic.enemy.basicTimer = 0;
  assert.equal(basic.tryBasic(basic.enemy), true);
  const basicFlight = basic.projectileFlight(basic.enemy, basic.enemy.def.basic.projectileSpeed, basic.enemy.action.aim);
  closeTo(basic.enemy.action.windup, DIFFICULTIES.standard.basicWindup);
  closeTo(basic.enemy.action.attackEnd, DIFFICULTIES.standard.basicWindup + basicFlight);
  closeTo(basic.enemy.action.duration, DIFFICULTIES.standard.basicWindup + basicFlight + DIFFICULTIES.standard.recovery);
});

test('enemy aim leads moving targets and AI field adds a shorter telegraphed escape-route patch', () => {
  const aimed = isolatedBattle({ enemyId: 'blastoise', difficulty: 'standard' });
  aimed.place(aimed.player, 500, 400);
  aimed.place(aimed.enemy, 900, 400);
  aimed.player.vx = 120;
  aimed.player.vy = -40;
  const move = aimed.enemy.def.moves.q;
  const warning = DIFFICULTIES.standard.reaction;
  const speed = move.speed * DIFFICULTIES.standard.projectileSpeed;
  const lead = clamp((warning * 0.65 + distance(aimed.enemy, aimed.player) / speed * 0.55) * DIFFICULTIES.standard.lead, 0, 1);
  const prediction = aimed.aim(aimed.enemy, move);
  closeTo(prediction.x, aimed.player.x + aimed.player.vx * lead);
  closeTo(prediction.y, aimed.player.y + aimed.player.vy * lead);

  const standardCast = isolatedBattle({ enemyId: 'typhlosion', difficulty: 'standard' });
  makeReady(standardCast, 'q', 'enemy');
  assert.equal(standardCast.castFor(standardCast.enemy, 'q', { ai: true }), true);
  closeTo(standardCast.windups[0].life, DIFFICULTIES.standard.reaction);
  closeTo(standardCast.tasks[0].delay, DIFFICULTIES.standard.reaction);

  const expertCast = isolatedBattle({ enemyId: 'typhlosion', difficulty: 'expert' });
  makeReady(expertCast, 'q', 'enemy');
  assert.equal(expertCast.castFor(expertCast.enemy, 'q', { ai: true }), true);
  closeTo(expertCast.windups[0].life, DIFFICULTIES.expert.reaction);
  assert.ok(expertCast.windups[0].life < standardCast.windups[0].life);

  const field = isolatedBattle({ enemyId: 'typhlosion' });
  field.player.vx = 120;
  field.player.vy = 50;
  makeReady(field, 'e', 'enemy');
  assert.equal(field.castFor(field.enemy, 'e', { ai: true }), true);
  assert.equal(field.hazards.length, 2);
  const [main, escape] = field.hazards;
  closeTo(main.delay, DIFFICULTIES.standard.fieldWindup);
  closeTo(escape.delay, DIFFICULTIES.standard.fieldWindup + 0.22);
  closeTo(escape.r, main.r * 0.78);
  assert.equal(escape.damage, Math.round(main.damage * 0.6));
  assert.notDeepEqual({ x: escape.x, y: escape.y }, { x: main.x, y: main.y });
});

test('AI pressure is readable, still hurts a stationary player, and a 0.22s reaction Dodge materially helps', () => {
  const stationary = simulateThreat({ mode: 'idle' });
  assert.ok(stationary.attacks.length >= 7 && stationary.attacks.length <= 14, `stationary cadence ${stationary.attacks.length}`);
  assert.ok(stationary.battle.stats.damageTaken >= stationary.battle.enemy.def.basic.damage * 3, `stationary damage ${stationary.battle.stats.damageTaken}`);
  assert.equal(stationary.battle.stats.damageDealt, 0);
  assert.equal(stationary.battle.enemy.hp, stationary.battle.enemy.maxHp);

  const withoutDodge = simulateThreat({ mode: 'circle' });
  const withDodge = simulateThreat({ mode: 'circle', dodge: true });
  assert.ok(withoutDodge.attacks.length >= 7 && withoutDodge.attacks.length <= 14, `circling cadence ${withoutDodge.attacks.length}`);
  assert.ok(withoutDodge.battle.stats.damageTaken > 0, 'circling without Dodge should still take meaningful contact');
  assert.ok(withDodge.dodgeDelays.length >= 3, `only ${withDodge.dodgeDelays.length} reaction dodges`);
  assert.ok(withDodge.dodgeDelays.every((delay) => delay >= 0.22 - EPSILON), `early dodge ${Math.min(...withDodge.dodgeDelays)}`);
  assert.ok(withDodge.dodgeDelays.some((delay) => delay <= 0.22 + 1 / 120 + EPSILON), 'no Dodge occurred at human reaction timing');
  assert.ok(withDodge.battle.stats.trackingBreaks > 0, 'reaction Dodge never broke tracking');
  assert.ok(withDodge.battle.stats.damageTaken <= withoutDodge.battle.stats.damageTaken * 0.65,
    `Dodge damage ${withDodge.battle.stats.damageTaken} vs ${withoutDodge.battle.stats.damageTaken}`);
  assert.ok(withoutDodge.battle.stats.damageTaken - withDodge.battle.stats.damageTaken >= withoutDodge.battle.enemy.def.basic.damage,
    'Dodge did not prevent even one basic attack worth of damage');
});

test('lethal damage stops combat, clears transient state, and a rematch starts cleanly', () => {
  for (const won of [true, false]) {
    const battle = isolatedBattle();
    battle.projectiles.push({ x: 1, y: 1, life: 2 });
    battle.hazards.push({ x: 1, y: 1, life: 2 });
    battle.windups.push({ life: 2 });
    battle.tasks.push({ delay: 2, kind: 'shot' });
    battle.enemy.action = { kind: 'bolt', key: 'q', aim: { x: 1, y: 1 }, elapsed: 0.2, windup: 0.7, attackEnd: 1.4, duration: 2.3 };
    battle.player.burn = 2;
    battle.enemy.slow = 2;
    const victim = won ? battle.enemy : battle.player;
    victim.hp = 10;
    assert.equal(battle.damage(victim, 50, won ? 'player' : 'enemy'), true);
    assert.equal(battle.state, won ? 'won' : 'lost');
    assert.equal(victim.hp, 0);
    assert.deepEqual(battle.projectiles, []);
    assert.deepEqual(battle.hazards, []);
    assert.deepEqual(battle.windups, []);
    assert.deepEqual(battle.tasks, []);
    assert.equal(battle.player.burn, 0);
    assert.equal(battle.enemy.slow, 0);
    assert.equal(battle.player.action, null);
    assert.equal(battle.enemy.action, null);
    assert.ok(battle.drainEvents().some((event) => event.type === 'end' && event.won === won));

    const stoppedAt = { time: battle.time, playerHp: battle.player.hp, enemyHp: battle.enemy.hp };
    advance(battle, 2, { x: 1, y: 1 });
    assert.equal(battle.time, stoppedAt.time);
    assert.equal(battle.player.hp, stoppedAt.playerHp);
    assert.equal(battle.enemy.hp, stoppedAt.enemyHp);
    assert.equal(battle.cast('q'), false);

    battle.start();
    assert.equal(battle.state, 'countdown');
    assert.equal(battle.player.hp, battle.player.maxHp);
    assert.equal(battle.enemy.hp, battle.enemy.maxHp);
    assert.equal(battle.player.action, null);
    assert.equal(battle.enemy.action, null);
    assert.deepEqual(battle.stats, { damageDealt: 0, damageTaken: 0, movesUsed: 0, hitsLanded: 0, basicsFired: 0, basicHits: 0, dodges: 0, avoidedDamage: 0, trackingBreaks: 0, knockouts: 0, losses: 0, switches: 0 });
  }
});

test('all roster player/enemy combinations survive a deterministic 32-second simulation without invalid state', () => {
  for (let playerIndex = 0; playerIndex < ROSTER.length; playerIndex++) {
    for (let enemyIndex = 0; enemyIndex < ROSTER.length; enemyIndex++) {
      const playerId = ROSTER[playerIndex].id;
      const enemyId = ROSTER[enemyIndex].id;
      const label = `${playerId} vs ${enemyId}`;
      const battle = liveBattle({ playerId, enemyId });
      let ended = null;

      for (let frame = 0; frame < 32 / STEP; frame++) {
        const time = frame * STEP;
        const input = {
          x: Math.cos(time * 0.83 + playerIndex * 0.17),
          y: Math.sin(time * 1.07 + enemyIndex * 0.13),
        };
        try {
          if (battle.state === 'playing') {
            if (frame % 61 === 0) battle.cast('q');
            if (frame % 137 === 0) battle.cast('w');
            if (frame % 181 === 0) battle.cast('e');
            if (frame % 223 === 0) battle.cast('s');
            if (frame % 167 === 0 && battle.player.hp < battle.player.maxHp) battle.cast('d');
            if (battle.player.cooldowns.r <= 0.01) battle.cast('r');
          }
          battle.update(STEP, input);
        } catch (error) {
          assert.fail(`${label} threw at frame ${frame}: ${error.stack || error}`);
        }
        assertFiniteModel(battle, `${label} frame ${frame}`);

        if (!ended && ['won', 'lost'].includes(battle.state)) {
          ended = { state: battle.state, time: battle.time, playerHp: battle.player.hp, enemyHp: battle.enemy.hp };
          assert.deepEqual(battle.projectiles, [], `${label} projectiles after death`);
          assert.deepEqual(battle.hazards, [], `${label} hazards after death`);
          assert.deepEqual(battle.windups, [], `${label} windups after death`);
          assert.deepEqual(battle.tasks, [], `${label} tasks after death`);
        }
        if (ended) {
          assert.equal(battle.state, ended.state, `${label} post-death state`);
          assert.equal(battle.time, ended.time, `${label} post-death combat time`);
          assert.equal(battle.player.hp, ended.playerHp, `${label} post-death player hp`);
          assert.equal(battle.enemy.hp, ended.enemyHp, `${label} post-death enemy hp`);
        }
      }
    }
  }
});

test('basic and dodge actions expose hit-aligned animation and pose timing', () => {
  const basic = isolatedBattle();
  putInLine(basic, 250);
  basic.player.basicTimer = 0;
  assert.equal(basic.tryBasic(basic.player), true);
  assert.equal(basic.player.anim, 'shoot');
  closeTo(basic.player.animDuration, basic.player.def.basic.windup + 0.24);
  closeTo(basic.player.animHitAt, basic.player.def.basic.windup);
  assert.deepEqual(
    { kind: basic.player.pose.kind, elapsed: basic.player.pose.elapsed, duration: basic.player.pose.duration },
    { kind: 'windup', elapsed: 0, duration: basic.player.def.basic.windup },
  );
  advanceBattleTime(basic, basic.player.def.basic.windup + 0.001);
  assert.equal(basic.stats.basicsFired, 1);
  assert.ok(basic.player.animTime >= basic.player.def.basic.windup);
  assert.ok(basic.player.animTime <= basic.player.def.basic.windup + 0.002);
  assert.equal(basic.player.pose.kind, 'strike');
  closeTo(basic.player.pose.duration, 0.2);

  const dodge = isolatedBattle();
  dodge.input = { x: 1, y: 0 };
  assert.equal(dodge.cast('d'), true);
  assert.equal(dodge.player.anim, 'charge');
  closeTo(dodge.player.animDuration, 0.28);
  assert.equal(dodge.player.pose.kind, 'dodge');
  closeTo(dodge.player.pose.duration, 0.28);
});

test('controlKey keeps skill and arrow mappings while only arrows contribute to movement input', () => {
  const cases = [
    [{ code: 'KeyD', key: 'ㅇ' }, 'd'],
    [{ code: 'KeyQ', key: 'ㅂ' }, 'q'],
    [{ code: 'ArrowRight', key: 'ArrowRight' }, 'ArrowRight'],
  ];
  for (const [event, expected] of cases) assert.equal(controlKey(event), expected);

  const keys = new Set([
    controlKey({ code: 'KeyA', key: 'ㅁ' }),
    controlKey({ code: 'Space', key: ' ' }),
    controlKey({ code: 'KeyT', key: 'ㅅ' }),
    controlKey({ code: 'KeyQ', key: 'ㅂ' }),
    controlKey({ code: 'KeyD', key: 'ㅇ' }),
  ]);
  assert.deepEqual(inputFromKeys(keys), { x: 0, y: 0 });
  keys.add(controlKey({ code: 'ArrowRight', key: 'ArrowRight' }));
  assert.deepEqual(inputFromKeys(keys), { x: 1, y: 0 });
  keys.delete('ArrowRight');
  assert.deepEqual(inputFromKeys(keys), { x: 0, y: 0 });
});

test('math and sprite helpers are pure across edge cases, looping, and clamping', () => {
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
  assert.deepEqual(unit(0, 0), { x: 0, y: 0 });
  closeTo(Math.hypot(unit(3, 4).x, unit(3, 4).y), 1);
  closeTo(segmentDistance(5, 4, 0, 0, 10, 0), 4);
  closeTo(segmentDistance(-3, 4, 0, 0, 10, 0), 5);

  assert.equal(directionFor(Math.PI / 2), 0);
  assert.equal(directionFor(0), 2);
  assert.equal(directionFor(-Math.PI / 2), 4);
  assert.equal(directionFor(Math.PI), 6);
  assert.equal(directionFor(-Math.PI), 6);
  assert.equal(directionFor(Number.NaN), 0);

  const animation = { frameCount: 3, durationsFrames: [2, 3, 1], totalFrames: 6 };
  assert.equal(frameFor(animation, 0), 0);
  assert.equal(frameFor(animation, 1 / 60), 0);
  assert.equal(frameFor(animation, 2 / 60), 1);
  assert.equal(frameFor(animation, 5 / 60), 2);
  assert.equal(frameFor(animation, 6 / 60), 0);
  assert.equal(frameFor(animation, 100, false), 2);
  assert.equal(frameFor(animation, -1), 0);
  assert.equal(frameFor(undefined, Number.NaN), 0);

  const action = { frameCount: 4, durationsFrames: [3, 2, 4, 3], totalFrames: 12, rushFrame: 1, hitFrame: 2, returnFrame: 3 };
  assert.deepEqual(animationMarkers(action), { rush: 3 / 60, hit: 5 / 60, recover: 9 / 60, duration: 12 / 60 });
  const mappedHit = mappedAnimationTime(action, 0.16, 0.4, 0.16);
  closeTo(mappedHit, 5 / 60);
  assert.equal(frameFor(action, mappedHit, false), 2, 'gameplay hit time maps exactly to hitFrame');
  const mappedEnd = mappedAnimationTime(action, 0.4, 0.4, 0.16);
  assert.equal(frameFor(action, mappedEnd, false), 3, 'the native return/follow-through frame remains visible');
});
