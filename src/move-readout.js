import {t} from './i18n/i18n.js';

// Use the battle's resolved move data, including the roster's ultimate scaling.
// Power is base damage before buffs/shields, not a promise that every hit lands.
export function moveReadout(move){
  let label='power',value=String(move.damage||0);
  if(move.damage>0){
    if(move.kind==='volley')value=`${move.damage}×${move.count}`;
    // A fan can hit one opponent at most three times, regardless of projectile count.
    if(move.kind==='fan')value=`${move.damage}×${Math.min(move.count||5,3)}`;
    if(move.kind==='field'&&move.dot)value=t('battle.powerWithTick',{power:move.damage,tick:move.dot});
    // Storm and ignite already store total damage across their hits/ticks.
  }else if(move.kind==='guard'){
    label='shieldPower';value=String(move.shield);
  }else if(move.kind==='barrier'){
    label='shieldPower';value=`${Math.round(move.shieldPercent*100)}%`;
  }else if(move.kind==='trainerHeal'){
    label='healPower';value=`${Math.round(move.healPercent*100)}%`;
  }else if(move.kind==='haste'||move.kind==='boost'){
    label=move.kind==='haste'?'speedPower':'attackPower';
    value=`+${Math.round(((move.kind==='haste'?move.multiplier:move.attackMultiplier)-1)*100)}%`;
  }else if(['dodge','cleanse','exhaust'].includes(move.kind)){
    label={dodge:'invulPower',cleanse:'cleansePower',exhaust:'weakenPower'}[move.kind];
    value=t('battle.effectSeconds',{sec:move.kind==='dodge'?move.invulEnd:move.duration});
  }
  return {label:t('battle.'+label),value,cost:t('battle.mpCost',{cost:move.cost||0})};
}
