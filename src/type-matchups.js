import {TYPE_CHART} from './type-data.js';

export const FIELD_DAMAGE_INTERVAL=.55;
export const pokemonTypes=def=>def?.types?.length?def.types:def?.type?[def.type]:[];

// Immunities multiply with dual types too: 2 × 0 remains zero.
export function effectiveness(element,defender){
  return [...new Set(pokemonTypes(defender))].reduce((mult,type)=>mult*(TYPE_CHART[element]?.[type]??1),1);
}

export function attackMatchup(move,attacker,defender){
  if(!move?.element||move.trainer||move.fixed||!(move.damage>0))return {effectiveness:1,stab:1,multiplier:1};
  const effect=effectiveness(move.element,defender),stab=pokemonTypes(attacker).includes(move.element)?1.5:1;
  return {effectiveness:effect,stab,multiplier:effect*stab};
}
