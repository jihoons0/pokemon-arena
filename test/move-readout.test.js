import test from 'node:test';
import assert from 'node:assert/strict';
import {moveReadout} from '../src/move-readout.js';
import {ROSTER,getMoves} from '../src/roster.js';
import {TRAINER_SKILLS,getTrainerSkill} from '../src/trainer-skills.js';
import {setLocale} from '../src/i18n/i18n.js';

test('Nidoking shows per-hit, periodic and scaled ultimate power with actual costs',()=>{
  const moves=getMoves('nidoking');
  assert.deepEqual(['q','w','e','r'].map(key=>moveReadout(moves[key])),[
    {label:'위력',value:'31×3',cost:'MP 18'},
    {label:'위력',value:'82',cost:'MP 22'},
    {label:'위력',value:'42+8/틱',cost:'MP 25'},
    {label:'위력',value:'397',cost:'MP 50'},
  ]);
});

test('fan hit caps and already-totaled storm/ignite damage are not overstated',()=>{
  assert.equal(moveReadout({kind:'fan',damage:18,count:7}).value,'18×3');
  assert.equal(moveReadout({kind:'fan',damage:18,count:2}).value,'18×2');
  assert.equal(moveReadout(getMoves('pikachu').r).value,'338');
  assert.equal(moveReadout(getTrainerSkill('ignite')).value,'144');
});

test('utility moves describe their effect rather than zero damage, including zero MP',()=>{
  assert.deepEqual(moveReadout(getMoves('mewtwo').w),{label:'보호막',value:'145',cost:'MP 24'});
  assert.deepEqual(moveReadout(getTrainerSkill('barrier')),{label:'보호막',value:'20%',cost:'MP 0'});
  assert.deepEqual(moveReadout(getTrainerSkill('heal')),{label:'회복',value:'16%',cost:'MP 0'});
  assert.deepEqual(moveReadout(getTrainerSkill('haste')),{label:'속도',value:'+50%',cost:'MP 0'});
  assert.deepEqual(moveReadout(getMoves('eevee').w),{label:'공격',value:'+28%',cost:'MP 22'});
  assert.deepEqual(moveReadout(getMoves('pikachu').d),{label:'무적',value:'0.5초',cost:'MP 0'});
  assert.equal(moveReadout(getTrainerSkill('cleanse')).value,'3초');
  assert.equal(moveReadout(getTrainerSkill('exhaust')).value,'3초');
});

test('every selectable move has a finite, localized readout in every language',async()=>{
  try{
    for(const locale of ['ko','en','ja','es','zh']){
      await setLocale(locale);
      for(const move of [...ROSTER.flatMap(mon=>Object.values(mon.moves)),...TRAINER_SKILLS]){
        const {label,value,cost}=moveReadout(move);
        assert.doesNotMatch([label,value,cost].join(' '),/undefined|NaN|battle\./);
        assert.ok(label.length>0&&value.length>0&&cost.length>0);
        if(!move.damage)assert.notEqual(value,'0',`${move.kind} must show its effect`);
      }
    }
  }finally{await setLocale('ko');}
});
