import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAINER_SKILLS,resolveTrainerSkillChoice} from '../src/trainer-skills.js';
import {selectionToSave} from '../src/party-draft.js';
import {ROSTER} from '../src/roster.js';
import {Battle} from '../src/battle.js';

test('random CPU skills cover all six choices without changing the saved choice or player skill',()=>{
  const choices=TRAINER_SKILLS.map(skill=>skill.id);
  const selection={enemySpecial:'random',playerSpecial:'barrier'};
  const saved=selectionToSave(selection,{},ROSTER);
  const counts=Object.fromEntries(choices.map(id=>[id,0]));
  for(let sample=0;sample<600;sample++){
    const resolved=resolveTrainerSkillChoice(saved.enemySpecial,()=>(sample+.5)/600);
    counts[resolved]++;
  }
  assert.deepEqual(Object.values(counts),[100,100,100,100,100,100]);
  const battle=new Battle({...saved,enemySpecial:resolveTrainerSkillChoice(saved.enemySpecial,()=>0)});
  assert.equal(battle.getTrainerSkill('enemy').id,'haste');
  battle.configure({...saved,enemySpecial:resolveTrainerSkillChoice(saved.enemySpecial,()=>.999)});
  assert.equal(battle.getTrainerSkill('enemy').id,'ignite');
  assert.equal(battle.getTrainerSkill('player').id,'barrier');
  assert.equal(saved.enemySpecial,'random');
});

test('explicit trainer choices stay fixed without drawing a random value',()=>{
  for(const skill of TRAINER_SKILLS){
    assert.equal(resolveTrainerSkillChoice(skill.id,()=>{throw new Error('explicit choices do not reroll');}),skill.id);
  }
  assert.equal(resolveTrainerSkillChoice('invalid'),'haste');
});
