import {t,getLocale} from './i18n/i18n.js';

// One selectable S-slot skill per team. Shared cooldowns cannot be reset by switching Pokémon.
export const TRAINER_SKILLS=[
 {id:'haste',name:'Ghost',ko:'가속',kind:'haste',cooldown:18,cost:0,damage:0,duration:4,multiplier:1.5,color:'#7dcfc1',animation:'charge',trainer:true,description:'4초 동안 이동 속도가 50% 증가합니다. 순간이동이 아닌 지속 가속입니다.'},
 {id:'exhaust',name:'Exhaust',ko:'위압',kind:'exhaust',cooldown:20,cost:0,damage:0,duration:3,range:450,color:'#c2a0e5',animation:'charge',trainer:true,description:'상대를 3초 동안 둔화시키고 주는 피해를 35% 줄입니다. 사거리 450.'},
 {id:'barrier',name:'Barrier',ko:'배리어',kind:'barrier',cooldown:22,cost:0,damage:0,duration:3,shieldPercent:.2,color:'#91d6ec',animation:'charge',trainer:true,description:'3초 동안 최대 체력의 20%만큼 피해를 흡수하는 보호막을 얻습니다.'},
 {id:'heal',name:'Heal',ko:'회복',kind:'trainerHeal',cooldown:26,cost:0,damage:0,healPercent:.16,color:'#a0d47f',animation:'charge',trainer:true,description:'현재 포켓몬의 최대 체력 16%를 회복합니다. 기절한 포켓몬은 되살리지 않습니다.'},
 {id:'cleanse',name:'Cleanse',ko:'정화',kind:'cleanse',cooldown:16,cost:0,damage:0,duration:3,color:'#f5dc8a',animation:'charge',trainer:true,description:'행동 불가·둔화·화상·위압을 해제하고 3초 동안 상태 이상을 막습니다. 피해를 막는 무적은 아닙니다.'},
 {id:'ignite',name:'Ignite',ko:'점화',kind:'ignite',cooldown:20,cost:0,damage:144,duration:4,range:430,color:'#f2a06d',animation:'shoot',trainer:true,description:'상대에게 4초 동안 총 144의 지속 피해를 줍니다. 사거리 430.'},
].map(skill=>({
 ...skill,
 icon:`/assets/ui/trainer/${skill.id}.png`,
 get displayName(){return t('skills.'+skill.id+'.name')||(getLocale()==='ko'?skill.ko:skill.name);},
 get displayDescription(){return t('skills.'+skill.id+'.desc')||skill.description;}
}));
export const TRAINER_SKILL_BY_ID=Object.fromEntries(TRAINER_SKILLS.map(skill=>[skill.id,skill]));
export const DEFAULT_TRAINER_SKILL='haste';
export const getTrainerSkill=id=>TRAINER_SKILL_BY_ID[id]||TRAINER_SKILL_BY_ID[DEFAULT_TRAINER_SKILL];
// Resolve the CPU's saved choice only when a battle starts, including rematches.
export const resolveTrainerSkillChoice=(id,random=Math.random)=>id==='random'
 ? TRAINER_SKILLS[Math.floor(random()*TRAINER_SKILLS.length)].id
 : getTrainerSkill(id).id;
export const DEFAULT_PLAYER_TEAM=['pikachu','charizard','blastoise','venusaur','lapras','snorlax'];
export const DEFAULT_ENEMY_TEAM=['typhlosion','feraligatr','meganium','ampharos','heracross','tyranitar'];
