import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { Battle, BOUNDS } from '../src/battle.js';
import { controlKey, inputFromKeys } from '../src/controls.js';
import { DIFFICULTIES, ROSTER, ROSTER_BY_ID } from '../src/roster.js';
import {
  DEFAULT_TRAINER_SKILL,
  TRAINER_SKILLS,
  TRAINER_SKILL_BY_ID,
} from '../src/trainer-skills.js';

const EPSILON = 1e-7;
const STEP = 0.05;
const SIX = ['pikachu', 'charizard', 'blastoise', 'venusaur', 'gengar', 'dragonite'];
const OTHER_SIX = ['mewtwo', 'typhlosion', 'feraligatr', 'ampharos', 'scizor', 'tyranitar'];

function closeTo(actual, expected, epsilon = EPSILON, message) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    message ?? `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function teamIds(view) {
  return [...view].map((member) => typeof member === 'string' ? member : member.id);
}

function fighters(battle) {
  return [...battle.teams.player, ...battle.teams.enemy];
}

function quietBattle(options = {}) {
  const battle = new Battle({ random: () => 0.5, ...options });
  battle.state = 'playing';
  battle.updateAI = () => {};
  for (const fighter of fighters(battle)) fighter.basicTimer = 1_000_000;
  battle.drainEvents();
  return battle;
}

function controlledAI(options = {}) {
  const battle = new Battle({ random: () => 0.5, ...options });
  battle.state = 'playing';
  battle.player.basicTimer = 1_000_000;
  battle.enemy.basicTimer = 1_000_000;
  battle.enemy.mp = battle.enemy.maxMp;
  for (const key of ['q', 'w', 'e', 'r', 's', 'd']) battle.enemy.cooldowns[key] = 99;
  battle.drainEvents();
  return battle;
}

function advance(battle, seconds, input = { x: 0, y: 0 }) {
  let elapsed = 0;
  let frames = 0;
  while (elapsed < seconds - EPSILON) {
    const dt = Math.min(STEP, seconds - elapsed);
    const currentInput = typeof input === 'function' ? input(elapsed, battle) : input;
    battle.update(dt, currentInput);
    elapsed += dt;
    assert.ok(frames++ < 20_000, 'time advance stalled');
  }
}

function finishDash(battle, input = { x: 1, y: 0 }) {
  let frames = 0;
  while (battle.player.dash) {
    battle.update(STEP, input);
    assert.ok(frames++ < 100, 'dash failed to finish');
  }
}

function ready(battle, fighter, key) {
  fighter.cooldowns[key] = 0;
  fighter.mp = fighter.maxMp;
}

function lethalDamage(battle, victim, attackerTeam) {
  let attempts = 0;
  while (victim.hp > 0) {
    if (!battle.damage(victim, victim.maxHp * 2, attackerTeam)) battle.update(STEP);
    assert.ok(attempts++ < 100, `lethal damage never reached ${victim.id}`);
  }
}

function assertSafeTeam(team, label) {
  assert.ok(team.length >= 1 && team.length <= 6, `${label} length ${team.length}`);
  assert.equal(new Set(team.map((fighter) => fighter.id)).size, team.length, `${label} contains duplicates`);
  for (const fighter of team) assert.ok(ROSTER_BY_ID[fighter.id], `${label} contains invalid id ${fighter.id}`);
}

function walkFiles(root, found = []) {
  if (!existsSync(root)) return found;
  for (const name of readdirSync(root)) {
    const fullPath = join(root, name);
    if (statSync(fullPath).isDirectory()) walkFiles(fullPath, found);
    else found.push(fullPath);
  }
  return found;
}

test('legacy playerId/enemyId configuration remains a one-member battle', () => {
  const battle = new Battle({ playerId: 'gengar', enemyId: 'ampharos', difficulty: 'expert', random: () => 0.5 });
  assert.deepEqual(teamIds(battle.playerTeam), ['gengar']);
  assert.deepEqual(teamIds(battle.enemyTeam), ['ampharos']);
  assert.equal(battle.teams.player.length, 1);
  assert.equal(battle.teams.enemy.length, 1);
  assert.deepEqual(battle.activeIndices, { player: 0, enemy: 0 });
  assert.equal(battle.player, battle.teams.player[0]);
  assert.equal(battle.enemy, battle.teams.enemy[0]);
  assert.equal(battle.difficulty, DIFFICULTIES.expert);
});

test('constructor and configure accept persistent unique teams plus trainer selections', () => {
  const battle = new Battle({
    playerTeam: SIX,
    enemyTeam: OTHER_SIX,
    playerSpecial: 'barrier',
    enemySpecial: 'ignite',
    difficulty: 'expert',
    random: () => 0.5,
  });
  assert.deepEqual(teamIds(battle.playerTeam), SIX);
  assert.deepEqual(teamIds(battle.enemyTeam), OTHER_SIX);
  assert.deepEqual(battle.teams.player.map((fighter) => fighter.id), SIX);
  assert.deepEqual(battle.teams.enemy.map((fighter) => fighter.id), OTHER_SIX);
  assert.equal(battle.player, battle.teams.player[0]);
  assert.equal(battle.enemy, battle.teams.enemy[0]);
  const firstPlayerTeam = battle.teams.player;

  battle.configure({
    playerTeam: ['tyranitar', 'pikachu'],
    enemyTeam: ['scizor', 'gengar', 'venusaur'],
    playerSpecial: 'heal',
    enemySpecial: 'cleanse',
    difficulty: 'standard',
  });
  assert.notEqual(battle.teams.player, firstPlayerTeam);
  assert.deepEqual(teamIds(battle.playerTeam), ['tyranitar', 'pikachu']);
  assert.deepEqual(teamIds(battle.enemyTeam), ['scizor', 'gengar', 'venusaur']);
  assert.equal(battle.player, battle.teams.player[0]);
  assert.equal(battle.enemy, battle.teams.enemy[0]);
  assert.equal(battle.difficulty, DIFFICULTIES.standard);
});

test('invalid, duplicate, empty, and oversized team inputs are sanitized safely', () => {
  let battle;
  assert.doesNotThrow(() => {
    battle = new Battle({
      playerTeam: ['pikachu', 'pikachu', 'missing', null, 'charizard', ...SIX],
      enemyTeam: [],
      playerSpecial: 'not-a-skill',
      enemySpecial: 'also-invalid',
      difficulty: 'not-a-mode',
      random: () => 0.5,
    });
  });
  assertSafeTeam(battle.teams.player, 'player');
  assertSafeTeam(battle.teams.enemy, 'enemy');
  assert.equal(battle.difficulty, DIFFICULTIES.standard);

  assert.doesNotThrow(() => battle.configure({
    playerTeam: ['missing', 'missing'],
    enemyTeam: ['gengar', 'gengar', 'bad'],
  }));
  assertSafeTeam(battle.teams.player, 'configured player');
  assertSafeTeam(battle.teams.enemy, 'configured enemy');
});

test('team fighters persist independently and active refs follow activeIndices', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['gengar', 'tyranitar'] });
  const first = battle.player;
  const bench = battle.teams.player[1];
  first.hp -= 123;
  first.mp = 41;
  first.cooldowns.q = 7;
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(1), true);
  assert.equal(battle.activeIndices.player, 1);
  assert.equal(battle.player, bench);
  assert.equal(battle.teams.player[0], first);
  assert.equal(first.hp, first.maxHp - 123);
  assert.equal(first.mp, 41);
  assert.equal(first.cooldowns.q, 7);
});

test('manual switch request is gated by play state and the eight-second switch cooldown', () => {
  const battle = new Battle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['gengar'], random: () => 0.5 });
  assert.equal(battle.requestSwitch(), false);
  battle.state = 'playing';
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.state, 'switching');
  assert.equal(battle.switchReason, 'manual');
  assert.equal(battle.cancelSwitch(), true);
  assert.equal(battle.state, 'playing');
  battle.switchCooldowns.player = 0.25;
  assert.equal(battle.requestSwitch(), false);
  advance(battle, 0.3);
  assert.equal(battle.requestSwitch(), true);
});

test('switchPokemon rejects invalid choices, preserves combat state, clamps radius, and grants a brief guard', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'charizard', 'tyranitar'], enemyTeam: ['gengar'] });
  const outgoing = battle.player;
  const faintedBench = battle.teams.player[1];
  faintedBench.hp = 0;
  outgoing.hp -= 80;
  outgoing.mp = 37;
  outgoing.cooldowns.q = 6;
  outgoing.cooldowns.w = 5;
  outgoing.cooldowns.e = 4;
  outgoing.cooldowns.r = 63;
  battle.place(outgoing, BOUNDS.right - outgoing.radius, BOUNDS.bottom - outgoing.radius);

  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(-1), false);
  assert.equal(battle.switchPokemon(0), false);
  assert.equal(battle.switchPokemon(1), false);
  assert.equal(battle.switchPokemon(99), false);
  assert.equal(battle.switchPokemon(2), true);
  assert.equal(battle.state, 'playing');
  assert.equal(battle.player, battle.teams.player[2]);
  assert.equal(battle.switchCooldowns.player, 8);
  assert.ok(battle.player.x <= BOUNDS.right - battle.player.radius + EPSILON);
  assert.ok(battle.player.y <= BOUNDS.bottom - battle.player.radius + EPSILON);
  assert.deepEqual(
    { hp: outgoing.hp, mp: outgoing.mp, q: outgoing.cooldowns.q, w: outgoing.cooldowns.w, e: outgoing.cooldowns.e, r: outgoing.cooldowns.r },
    { hp: outgoing.maxHp - 80, mp: 37, q: 6, w: 5, e: 4, r: 63 },
  );

  const incoming = battle.player;
  const hp = incoming.hp;
  assert.equal(battle.damage(incoming, 25, 'enemy'), false, 'sendout guard must block immediate damage');
  let elapsed = 0;
  while (incoming.hp === hp && elapsed < 2) {
    battle.update(STEP);
    battle.damage(incoming, 25, 'enemy');
    elapsed += STEP;
  }
  assert.ok(elapsed > 0 && elapsed < 2, 'sendout guard was not brief');
  assert.equal(incoming.hp, hp - 25);
});

test('cancelSwitch works only for a manual request and never cancels a faint replacement', () => {
  const manual = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['gengar'] });
  assert.equal(manual.requestSwitch(), true);
  assert.equal(manual.cancelSwitch(), true);
  assert.equal(manual.state, 'playing');
  assert.equal(manual.cancelSwitch(), false);

  const fainted = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['gengar'] });
  lethalDamage(fainted, fainted.player, 'enemy');
  assert.equal(fainted.state, 'switching');
  assert.equal(fainted.switchReason, 'fainted');
  assert.equal(fainted.cancelSwitch(), false);
  assert.equal(fainted.switchPokemon(1), true);
  assert.equal(fainted.state, 'playing');
});

test('enemy fainting starts a transition and automatically selects the next living member', () => {
  const battle = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['gengar', 'tyranitar', 'charizard'] });
  const first = battle.enemy;
  lethalDamage(battle, first, 'player');
  assert.notEqual(battle.state, 'won');
  assert.equal(first.hp, 0);
  assert.equal(battle.enemy, first, 'the replacement should wait for the transition');
  advance(battle, 1.35);
  assert.equal(battle.state, 'playing');
  assert.equal(battle.activeIndices.enemy, 1);
  assert.equal(battle.enemy, battle.teams.enemy[1]);
  assert.ok(battle.enemy.hp > 0);
});

test('battle result waits for the entire side and six KOs progress deterministically to a win', () => {
  const battle = quietBattle({ playerTeam: SIX, enemyTeam: OTHER_SIX });
  for (let index = 0; index < 6; index++) {
    const victim = battle.enemy;
    lethalDamage(battle, victim, 'player');
    assert.equal(victim.hp, 0);
    if (index < 5) {
      assert.notEqual(battle.state, 'won', `won after only ${index + 1} enemy KOs`);
      advance(battle, 1.3);
      assert.equal(battle.state, 'playing');
      assert.notEqual(battle.enemy, victim);
    }
  }
  assert.equal(battle.state, 'won');
  assert.ok(battle.teams.enemy.every((fighter) => fighter.hp === 0));
});

test('battle result waits for the entire side and six KOs progress deterministically to a loss', () => {
  const battle = quietBattle({ playerTeam: SIX, enemyTeam: OTHER_SIX });
  for (let count = 0; count < 6; count++) {
    const victim = battle.player;
    lethalDamage(battle, victim, 'enemy');
    assert.equal(victim.hp, 0);
    if (count < 5) {
      assert.notEqual(battle.state, 'lost', `lost after only ${count + 1} player KOs`);
      assert.equal(battle.state, 'switching');
      assert.equal(battle.switchReason, 'fainted');
      const next = battle.teams.player.findIndex((fighter) => fighter.hp > 0);
      assert.ok(next >= 0);
      assert.equal(battle.switchPokemon(next), true);
      advance(battle, 0.6);
    }
  }
  assert.equal(battle.state, 'lost');
  assert.ok(battle.teams.player.every((fighter) => fighter.hp === 0));
});

test('QWER cooldowns, including the initial R timer, tick for active and bench fighters', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'charizard', 'blastoise'], enemyTeam: ['gengar', 'tyranitar'] });
  for (const fighter of fighters(battle)) assert.equal(fighter.cooldowns.r, 30, `${fighter.team} ${fighter.id} initial R`);
  battle.teams.player[0].cooldowns.q = 4;
  battle.teams.player[1].cooldowns.q = 7;
  battle.teams.enemy[1].cooldowns.e = 5;
  advance(battle, 1);
  closeTo(battle.teams.player[0].cooldowns.q, 3);
  closeTo(battle.teams.player[1].cooldowns.q, 6);
  closeTo(battle.teams.enemy[1].cooldowns.e, 4);
  for (const fighter of fighters(battle)) closeTo(fighter.cooldowns.r, 29, 1e-6, `${fighter.team} ${fighter.id} bench R tick`);
});

test('ultimate recharge remains 60-70 seconds on its owner across switching', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['tyranitar'] });
  ready(battle, battle.player, 'r');
  assert.equal(battle.cast('r'), true);
  const recharge = battle.player.cooldowns.r;
  assert.ok(recharge >= 60 && recharge <= 70, `ultimate cooldown ${recharge}`);
  const owner = battle.player;
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(1), true);
  assert.equal(owner.cooldowns.r, recharge);
  battle.switchCooldowns.player = 0;
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(0), true);
  assert.equal(battle.player, owner);
  assert.equal(battle.player.cooldowns.r, recharge);
});

test('trainer S and Dodge D cooldowns are teamwide and cannot be reset by switching', () => {
  const special = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['tyranitar'], playerSpecial: 'haste' });
  assert.equal(special.cast('s'), true);
  const specialCooldown = special.player.cooldowns.s;
  assert.ok(specialCooldown > 17);
  assert.equal(special.requestSwitch(), true);
  assert.equal(special.switchPokemon(1), true);
  closeTo(special.player.cooldowns.s, specialCooldown);
  assert.equal(special.cast('s'), false);

  const dodge = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['tyranitar'] });
  dodge.input = { x: 1, y: 0 };
  assert.equal(dodge.cast('d'), true);
  finishDash(dodge);
  const dodgeCooldown = dodge.player.cooldowns.d;
  assert.ok(dodgeCooldown > 0);
  assert.equal(dodge.requestSwitch(), true);
  assert.equal(dodge.switchPokemon(1), true);
  closeTo(dodge.player.cooldowns.d, dodgeCooldown);
  assert.equal(dodge.cast('d'), false);
});

test('pause freezes every team member clock and switch cooldown', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'charizard', 'blastoise'], enemyTeam: ['gengar', 'tyranitar'], playerSpecial: 'haste' });
  battle.teams.player[0].cooldowns.q = 6;
  battle.teams.player[1].cooldowns.w = 7;
  battle.teams.player[2].cooldowns.r = 21;
  battle.teams.enemy[1].cooldowns.e = 8;
  battle.teams.player[1].mp = 22;
  battle.switchCooldowns.player = 4;
  battle.switchCooldowns.enemy = 3;
  assert.equal(battle.cast('s'), true);
  assert.equal(battle.pause(), true);
  const before = structuredClone({
    time: battle.time,
    teams: battle.teams,
    switchCooldowns: battle.switchCooldowns,
    projectiles: battle.projectiles,
    hazards: battle.hazards,
    windups: battle.windups,
    tasks: battle.tasks,
  });
  advance(battle, 2, { x: 1, y: 1 });
  const after = structuredClone({
    time: battle.time,
    teams: battle.teams,
    switchCooldowns: battle.switchCooldowns,
    projectiles: battle.projectiles,
    hazards: battle.hazards,
    windups: battle.windups,
    tasks: battle.tasks,
  });
  assert.deepEqual(after, before);
});

test('pause also freezes the enemy replacement transition', () => {
  const battle = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['gengar', 'tyranitar'] });
  lethalDamage(battle, battle.enemy, 'player');
  assert.notEqual(battle.state, 'won');
  assert.equal(battle.pause(), true);
  const index = battle.activeIndices.enemy;
  const time = battle.time;
  advance(battle, 2);
  assert.equal(battle.activeIndices.enemy, index);
  assert.equal(battle.time, time);
  battle.resume();
  advance(battle, 1.35);
  assert.equal(battle.state, 'playing');
  assert.equal(battle.activeIndices.enemy, 1);
});

test('substitution cancels the outgoing fighter pending tasks and hazards', () => {
  const tasks = quietBattle({ playerTeam: ['blastoise', 'gengar'], enemyTeam: ['tyranitar'] });
  assert.equal(tasks.cast('q'), true);
  assert.ok(tasks.tasks.some((task) => task.team === 'player'));
  assert.equal(tasks.requestSwitch(), true);
  assert.equal(tasks.switchPokemon(1), true);
  assert.equal(tasks.tasks.some((task) => task.team === 'player'), false);
  assert.equal(tasks.windups.some((windup) => windup.team === 'player'), false);

  const hazards = quietBattle({ playerTeam: ['charizard', 'gengar'], enemyTeam: ['tyranitar'] });
  assert.equal(hazards.cast('e'), true);
  assert.ok(hazards.hazards.some((hazard) => hazard.team === 'player'));
  assert.equal(hazards.requestSwitch(), true);
  assert.equal(hazards.switchPokemon(1), true);
  assert.equal(hazards.hazards.some((hazard) => hazard.team === 'player'), false);
});

test('substitution erases own released projectiles but preserves opponent released projectiles', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'gengar'], enemyTeam: ['typhlosion', 'blastoise'] });
  battle.place(battle.player, BOUNDS.left + battle.player.radius, 400);
  battle.place(battle.enemy, BOUNDS.right - battle.enemy.radius, 400);
  ready(battle, battle.player, 'q');
  ready(battle, battle.enemy, 'q');
  assert.equal(battle.cast('q'), true);
  assert.equal(battle.castFor(battle.enemy, 'q', { ai: true }), true);
  advance(battle, DIFFICULTIES.standard.reaction + 0.02);
  const playerShots = battle.projectiles.filter((shot) => shot.team === 'player');
  const enemyShots = battle.projectiles.filter((shot) => shot.team === 'enemy');
  assert.ok(playerShots.length > 0, 'player projectile was not released');
  assert.ok(enemyShots.length > 0, 'enemy projectile was not released');
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(1), true);
  assert.equal(battle.projectiles.some((shot) => shot.team === 'player'), false);
  assert.ok(enemyShots.every((shot) => battle.projectiles.includes(shot)), 'opponent projectiles were erased');
});

test('enemy substitution clears the previous fighter action and resets AI action state', () => {
  const battle = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['blastoise', 'tyranitar'] });
  ready(battle, battle.enemy, 'q');
  assert.equal(battle.castFor(battle.enemy, 'q', { ai: true }), true);
  assert.ok(battle.enemy.action);
  const oldEnemy = battle.enemy;
  lethalDamage(battle, oldEnemy, 'player');
  advance(battle, 1.3);
  assert.notEqual(battle.enemy, oldEnemy);
  assert.equal(battle.enemy.action, null);
  assert.equal(battle.enemy.basicWindup, null);
  assert.equal(battle.tasks.some((task) => task.team === 'enemy'), false);
  assert.equal(battle.windups.some((windup) => windup.team === 'enemy'), false);
});

test('team stats count player switches, enemy knockouts, and player losses', () => {
  const switched = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['gengar'] });
  assert.equal(switched.stats.switches, 0);
  assert.equal(switched.requestSwitch(), true);
  assert.equal(switched.switchPokemon(1), true);
  assert.equal(switched.stats.switches, 1);

  const knockout = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['gengar', 'tyranitar'] });
  assert.equal(knockout.stats.knockouts, 0);
  lethalDamage(knockout, knockout.enemy, 'player');
  assert.equal(knockout.stats.knockouts, 1);

  const loss = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['gengar'] });
  assert.equal(loss.stats.losses, 0);
  lethalDamage(loss, loss.player, 'enemy');
  assert.equal(loss.stats.losses, 1);
});

test('AI selects its only ready W field or pulse when the target is in range', () => {
  for (const { id, kind, gap } of [
    { id: 'gengar', kind: 'field', gap: 300 },
    { id: 'articuno', kind: 'field', gap: 300 },
    { id: 'venusaur', kind: 'pulse', gap: 190 },
    { id: 'bulbasaur', kind: 'pulse', gap: 170 },
  ]) {
    const battle = controlledAI({ playerId: 'pikachu', enemyId: id });
    battle.place(battle.player, 400, 400);
    battle.place(battle.enemy, 400 + gap, 400);
    battle.enemy.cooldowns.w = 0;
    battle.aiDecision = 0;
    battle.update(0.01);
    assert.ok(battle.enemy.action, `${id} did not start W`);
    assert.equal(battle.enemy.action.key, 'w', `${id} selected another action`);
    assert.equal(battle.enemy.action.kind, kind, `${id}.w kind`);
    assert.ok(battle.enemy.cooldowns.w > 0, `${id}.w cooldown was not spent`);
    closeTo(battle.enemy.cooldowns.s, 98.99, 1e-6, `${id} trainer S was not disabled`);
    assert.equal(battle.enemy.basicWindup, null, `${id} started a basic instead of W`);
  }
});

test('AI does not cast a native Q slash far outside its range', () => {
  const battle = controlledAI({ playerId: 'pikachu', enemyId: 'snorlax' });
  const slash = battle.enemy.def.moves.q;
  assert.equal(slash.kind, 'slash');
  battle.enemy.cooldowns.q = 0;
  battle.place(battle.player, 400, 400);
  battle.place(battle.enemy, 400 + slash.range + 80, 400);
  battle.aiDecision = 0;
  battle.update(0.01);
  assert.equal(battle.enemy.action, null);
  assert.equal(battle.enemy.cooldowns.q, 0);
  assert.equal(battle.drainEvents().some((event) => event.type === 'cast' && event.team === 'enemy'), false);

  battle.place(battle.enemy, 400 + slash.range, 400);
  battle.aiDecision = 0;
  battle.update(0.01);
  assert.ok(battle.enemy.action);
  assert.equal(battle.enemy.action.key, 'q');
  assert.equal(battle.enemy.action.kind, 'slash');
});

test('enemy Cleanse escapes stun when S is ready and no action is active', () => {
  const battle = controlledAI({ playerId: 'pikachu', enemyId: 'snorlax', enemySpecial: 'cleanse' });
  battle.enemy.cooldowns.s = 0;
  assert.equal(battle.enemy.action, null);
  assert.equal(battle.damage(battle.enemy, 1, 'player', { stun: 1, periodic: true }), true);
  assert.ok(battle.enemy.stun > 0);
  battle.update(0.01);
  assert.equal(battle.enemy.stun, 0);
  assert.ok(battle.enemy.action);
  assert.equal(battle.enemy.action.kind, 'cleanse');
  assert.equal(battle.enemy.cooldowns.s, TRAINER_SKILL_BY_ID.cleanse.cooldown);
  assert.ok(battle.drainEvents().some((event) => event.type === 'trainer' && event.id === 'cleanse'));
});

test('fresh burn after Cleanse or natural expiry waits a full initial tick', () => {
  function assertFreshBurnDelay(battle, label) {
    const hp = battle.player.hp;
    assert.equal(battle.damage(battle.player, 0, 'enemy', { burn: 2, periodic: true }), true);
    advance(battle, 0.65);
    assert.equal(battle.player.hp, hp, `${label} burn ticked from a stale timer`);
    advance(battle, 0.1);
    assert.equal(battle.player.hp, hp - 4, `${label} burn did not tick after the normal delay`);
  }

  const cleansed = quietBattle({ playerId: 'pikachu', enemyId: 'typhlosion', playerSpecial: 'cleanse' });
  assert.equal(cleansed.damage(cleansed.player, 0, 'enemy', { burn: 2, periodic: true }), true);
  advance(cleansed, 0.65);
  assert.equal(cleansed.cast('s'), true);
  advance(cleansed, TRAINER_SKILL_BY_ID.cleanse.duration + 0.1);
  assertFreshBurnDelay(cleansed, 'post-Cleanse');

  const expired = quietBattle({ playerId: 'pikachu', enemyId: 'typhlosion' });
  assert.equal(expired.damage(expired.player, 0, 'enemy', { burn: 0.1, periodic: true }), true);
  advance(expired, 0.15);
  assertFreshBurnDelay(expired, 'post-expiry');
});

test('trainer skill catalog exposes the exact selectable contract and defaults to haste', () => {
  assert.equal(DEFAULT_TRAINER_SKILL, 'haste');
  assert.deepEqual(TRAINER_SKILLS.map((skill) => skill.id), ['haste', 'exhaust', 'barrier', 'heal', 'cleanse', 'ignite']);
  assert.deepEqual(
    Object.fromEntries(TRAINER_SKILLS.map((skill) => [skill.id, {
      cooldown: skill.cooldown,
      duration: skill.duration,
      range: skill.range,
      damage: skill.damage,
      multiplier: skill.multiplier,
      shieldPercent: skill.shieldPercent,
      healPercent: skill.healPercent,
    }])),
    {
      haste: { cooldown: 18, duration: 4, range: undefined, damage: 0, multiplier: 1.5, shieldPercent: undefined, healPercent: undefined },
      exhaust: { cooldown: 20, duration: 3, range: 450, damage: 0, multiplier: undefined, shieldPercent: undefined, healPercent: undefined },
      barrier: { cooldown: 22, duration: 3, range: undefined, damage: 0, multiplier: undefined, shieldPercent: 0.2, healPercent: undefined },
      heal: { cooldown: 26, duration: undefined, range: undefined, damage: 0, multiplier: undefined, shieldPercent: undefined, healPercent: 0.16 },
      cleanse: { cooldown: 16, duration: 3, range: undefined, damage: 0, multiplier: undefined, shieldPercent: undefined, healPercent: undefined },
      ignite: { cooldown: 20, duration: 4, range: 430, damage: 144, multiplier: undefined, shieldPercent: undefined, healPercent: undefined },
    },
  );
  assert.ok(TRAINER_SKILLS.every((skill) => !['blink', 'dash', 'dodge'].includes(skill.kind)), 'S must not be a second mobility skill');
  for (const skill of TRAINER_SKILLS) assert.equal(TRAINER_SKILL_BY_ID[skill.id], skill);
});

test('default S is haste: no teleport, 1.5x movement for four seconds, then normal speed', () => {
  const baseline = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'] });
  baseline.place(baseline.player, 350, 400);
  const baselineX = baseline.player.x;
  advance(baseline, 1, { x: 1, y: 0 });
  const normalDistance = baseline.player.x - baselineX;

  const haste = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'] });
  haste.place(haste.player, 350, 400);
  const startX = haste.player.x;
  assert.equal(haste.cast('s'), true);
  assert.equal(haste.player.x, startX, 'haste must not teleport');
  advance(haste, 1, { x: 1, y: 0 });
  closeTo(haste.player.x - startX, normalDistance * 1.5, 1e-5);

  const expired = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'], playerSpecial: 'haste' });
  assert.equal(expired.cast('s'), true);
  advance(expired, 4.05);
  expired.place(expired.player, 350, 400);
  const expiredX = expired.player.x;
  advance(expired, 0.5, { x: 1, y: 0 });
  closeTo(expired.player.x - expiredX, normalDistance * 0.5, 1e-5);
});

test('exhaust enforces 450 range and weakens outgoing damage for three seconds', () => {
  const far = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'], playerSpecial: 'exhaust' });
  far.place(far.player, BOUNDS.left + far.player.radius, 400);
  far.place(far.enemy, BOUNDS.right - far.enemy.radius, 400);
  assert.equal(far.cast('s'), false);

  const battle = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'], playerSpecial: 'exhaust' });
  battle.place(battle.player, 400, 400);
  battle.place(battle.enemy, 800, 400);
  assert.equal(battle.cast('s'), true);
  const firstHp = battle.player.hp;
  assert.equal(battle.damage(battle.player, 100, 'enemy'), true);
  const weakenedDamage = firstHp - battle.player.hp;
  assert.ok(weakenedDamage > 0 && weakenedDamage < 100, `weakened damage ${weakenedDamage}`);
  advance(battle, 3.2);
  const secondHp = battle.player.hp;
  assert.equal(battle.damage(battle.player, 100, 'enemy'), true);
  assert.equal(secondHp - battle.player.hp, 100);
});

test('barrier absorbs exactly 20% max HP for three seconds', () => {
  const battle = quietBattle({ playerTeam: ['blastoise'], enemyTeam: ['tyranitar'], playerSpecial: 'barrier' });
  const shield = Math.round(battle.player.maxHp * 0.2);
  assert.equal(battle.cast('s'), true);
  const hp = battle.player.hp;
  assert.equal(battle.damage(battle.player, shield + 17, 'enemy'), true);
  assert.equal(battle.player.hp, hp - 17);

  const expired = quietBattle({ playerTeam: ['blastoise'], enemyTeam: ['tyranitar'], playerSpecial: 'barrier' });
  assert.equal(expired.cast('s'), true);
  advance(expired, 3.05);
  const expiredHp = expired.player.hp;
  assert.equal(expired.damage(expired.player, 25, 'enemy'), true);
  assert.equal(expired.player.hp, expiredHp - 25);
});

test('heal restores 16% max HP without overheal and never revives a teammate', () => {
  const battle = quietBattle({ playerTeam: ['blastoise', 'gengar'], enemyTeam: ['tyranitar'], playerSpecial: 'heal' });
  const amount = Math.round(battle.player.maxHp * 0.16);
  battle.player.hp = battle.player.maxHp - amount - 10;
  battle.teams.player[1].hp = 0;
  const before = battle.player.hp;
  assert.equal(battle.cast('s'), true);
  assert.equal(battle.player.hp, before + amount);
  assert.equal(battle.teams.player[1].hp, 0);

  const capped = quietBattle({ playerTeam: ['blastoise'], enemyTeam: ['tyranitar'], playerSpecial: 'heal' });
  capped.player.hp = capped.player.maxHp - 5;
  assert.equal(capped.cast('s'), true);
  assert.equal(capped.player.hp, capped.player.maxHp);
});

test('cleanse clears control and damage-over-time, blocks new status for three seconds, but not damage', () => {
  const battle = quietBattle({
    playerTeam: ['pikachu'],
    enemyTeam: ['tyranitar'],
    playerSpecial: 'cleanse',
    enemySpecial: 'exhaust',
  });
  battle.place(battle.player, 400, 400);
  battle.place(battle.enemy, 750, 400);
  assert.equal(battle.damage(battle.player, 1, 'enemy', { stun: 1.5, slow: 1.5, burn: 1.5 }), true);
  assert.equal(battle.cast('s'), true, 'cleanse must be usable while stunned');
  const cleansedHp = battle.player.hp;
  advance(battle, 0.9);
  assert.equal(battle.player.hp, cleansedHp, 'cleared burn still dealt periodic damage');

  assert.equal(battle.damage(battle.player, 11, 'enemy', { stun: 1, slow: 1, burn: 1 }), true);
  assert.equal(battle.player.hp, cleansedHp - 11, 'cleanse incorrectly granted damage immunity');
  ready(battle, battle.player, 'q');
  assert.equal(battle.cast('q'), true, 'status guard did not block stun');

  ready(battle, battle.enemy, 's');
  assert.equal(battle.castFor(battle.enemy, 's', { ai: true }), true);
  const enemyHp = battle.enemy.hp;
  assert.equal(battle.damage(battle.enemy, 100, 'player'), true);
  assert.equal(enemyHp - battle.enemy.hp, 100, 'status guard did not block weakened');
});

test('ignite requires 430 range and deals exactly 144 total damage over four seconds', () => {
  const far = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'], playerSpecial: 'ignite' });
  far.place(far.player, BOUNDS.left + far.player.radius, 400);
  far.place(far.enemy, BOUNDS.right - far.enemy.radius, 400);
  assert.equal(far.cast('s'), false);

  const battle = quietBattle({ playerTeam: ['pikachu'], enemyTeam: ['tyranitar'], playerSpecial: 'ignite' });
  battle.place(battle.player, 400, 400);
  battle.place(battle.enemy, 800, 400);
  const hp = battle.enemy.hp;
  assert.equal(battle.cast('s'), true);
  advance(battle, 4.1);
  assert.equal(hp - battle.enemy.hp, 144);
});

test('native attack boosts multiply outgoing damage for their duration without changing movement', () => {
  const boostUsers = ROSTER.filter((pokemon) => Object.values(pokemon.moves).some((move) => move.kind === 'boost'));
  assert.ok(boostUsers.length > 0);
  for (const pokemon of boostUsers) {
    const move = Object.values(pokemon.moves).find((candidate) => candidate.kind === 'boost');
    assert.equal(move.damage, 0, `${pokemon.id} boost damage`);
    assert.ok(move.duration > 0, `${pokemon.id} boost duration`);
    assert.ok(move.attackMultiplier > 1, `${pokemon.id} boost multiplier`);
  }

  const battle = quietBattle({ playerTeam: ['eevee'], enemyTeam: ['tyranitar'] });
  battle.place(battle.player, 400, 400);
  battle.place(battle.enemy, 800, 400);
  const move = battle.moves.w;
  assert.equal(move.kind, 'boost');
  const start = { x: battle.player.x, y: battle.player.y, playerHp: battle.player.hp, enemyHp: battle.enemy.hp };
  assert.equal(battle.cast('w'), true);
  assert.deepEqual(
    { x: battle.player.x, y: battle.player.y, playerHp: battle.player.hp, enemyHp: battle.enemy.hp },
    start,
    'boost cast must not teleport, dash, heal, or deal immediate damage',
  );
  advance(battle, 0.5, { x: 1, y: 0 });
  closeTo(battle.player.x - start.x, battle.player.speed * 0.5, 1e-5, 'boost changed movement speed');
  const hp = battle.enemy.hp;
  assert.equal(battle.damage(battle.enemy, 100, 'player'), true);
  assert.equal(hp - battle.enemy.hp, Math.round(100 * move.attackMultiplier));

  const expired = quietBattle({ playerTeam: ['eevee'], enemyTeam: ['tyranitar'] });
  assert.equal(expired.cast('w'), true);
  advance(expired, expired.moves.w.duration + 0.1);
  const expiredHp = expired.enemy.hp;
  assert.equal(expired.damage(expired.enemy, 100, 'player'), true);
  assert.equal(expiredHp - expired.enemy.hp, 100);
});

test('attack boost belongs to its fighter, survives a switch, and expires while benched', () => {
  const battle = quietBattle({ playerTeam: ['eevee', 'pikachu'], enemyTeam: ['tyranitar'] });
  const eevee = battle.player;
  const multiplier = battle.moves.w.attackMultiplier;
  assert.equal(battle.cast('w'), true);
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(1), true);
  ready(battle, eevee, 'w');
  assert.equal(battle.castFor(eevee, 'w'), false, 'a benched fighter cast a native skill');

  let hp = battle.enemy.hp;
  assert.equal(battle.damage(battle.enemy, 100, 'player'), true);
  assert.equal(hp - battle.enemy.hp, 100, 'bench boost leaked onto the active teammate');

  battle.switchCooldowns.player = 0;
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(0), true);
  hp = battle.enemy.hp;
  assert.equal(battle.damage(battle.enemy, 100, 'player'), true);
  assert.equal(hp - battle.enemy.hp, Math.round(100 * multiplier), 'owner lost boost on switching');

  battle.switchCooldowns.player = 0;
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(1), true);
  advance(battle, eevee.def.moves.w.duration + 0.2);
  battle.switchCooldowns.player = 0;
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(0), true);
  hp = battle.enemy.hp;
  assert.equal(battle.damage(battle.enemy, 100, 'player'), true);
  assert.equal(hp - battle.enemy.hp, 100, 'bench boost clock did not expire');
});

test('physical KeyP reliably maps to party without contributing movement input', () => {
  assert.equal(controlKey({ code: 'KeyP', key: 'ㅔ' }), 'p');
  assert.equal(controlKey({ code: 'KeyP', key: 'P' }), 'p');
  assert.deepEqual(inputFromKeys(new Set(['p'])), { x: 0, y: 0 });
  assert.deepEqual(inputFromKeys(new Set(['p', 'ArrowRight'])), { x: 1, y: 0 });
});

test('D remains the single evasion action with its guard and tracking semantics after team switching', () => {
  const battle = quietBattle({ playerTeam: ['pikachu', 'charizard'], enemyTeam: ['typhlosion'] });
  battle.place(battle.player, 500, 410);
  battle.place(battle.enemy, 830, 410);
  battle.enemy.basicTimer = 0;
  assert.equal(battle.tryBasic(battle.enemy), true);
  battle.input = { x: 0, y: -1 };
  assert.equal(battle.cast('d'), true);
  assert.equal(battle.damage(battle.player, 37, 'enemy'), false);
  assert.equal(battle.stats.dodges, 1);
  assert.equal(battle.stats.avoidedDamage, 37);
  assert.equal(battle.stats.trackingBreaks, 1);
  finishDash(battle, { x: 0, y: -1 });
  assert.equal(battle.requestSwitch(), true);
  assert.equal(battle.switchPokemon(1), true);
  assert.equal(battle.cast('d'), false, 'switch reset the shared Dodge cooldown');
});

test('every roster character has an animation manifest and portrait', () => {
  const root = join(process.cwd(), 'public', 'assets', 'pokemon');
  const files = walkFiles(root);
  const manifests = files.filter((file) => basename(file).toLowerCase() === 'animations.json');
  assert.equal(ROSTER.length, 51);
  assert.equal(manifests.length, ROSTER.length);
  const pokemonIds = new Set();
  for (const manifest of manifests) {
    assert.ok(statSync(manifest).size > 100, `${manifest} is empty`);
    const data = JSON.parse(readFileSync(manifest, 'utf8'));
    const pokemonDir = dirname(manifest);
    const id = basename(pokemonDir);
    pokemonIds.add(id);
    assert.equal(data.pokemon?.slug, id, `${manifest} slug mismatch`);
    const portraitDir = join(pokemonDir, 'portrait');
    const portraits = walkFiles(portraitDir).filter((file) => ['.png', '.webp', '.jpg', '.jpeg'].includes(extname(file).toLowerCase()));
    assert.ok(portraits.length > 0, `${pokemonDir} has no portrait`);
    assert.ok(portraits.some((file) => statSync(file).size > 100), `${pokemonDir} portraits are empty placeholders`);
  }
  assert.deepEqual([...pokemonIds].sort(), ROSTER.map((pokemon) => pokemon.id).sort());
});
