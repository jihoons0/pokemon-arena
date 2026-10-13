import {ROSTER_BY_ID, getMoves, DIFFICULTIES, ELEMENTS} from './roster.js';
import {getTrainerSkill as findTrainerSkill} from './trainer-skills.js';
import {t,getLocale} from './i18n/i18n.js';
const teamIds=(ids,fallback)=>{const valid=[...new Set((Array.isArray(ids)?ids:[ids]).filter(id=>ROSTER_BY_ID[id]))].slice(0,6);return valid.length?valid:[fallback];};
// A full skill rotation spends faster than regeneration; basic attacks and utilities stay free.
const MP_REGEN_PER_SECOND=3;
export const BOUNDS = Object.freeze({left:132,right:1148,top:218,bottom:570});
export const MOVES = getMoves('pikachu');
export const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
export const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export const unit=(x,y)=>{const d=Math.hypot(x,y)||1;return {x:x/d,y:y/d};};
export function segmentDistance(px,py,x1,y1,x2,y2){const dx=x2-x1,dy=y2-y1,t=clamp(((px-x1)*dx+(py-y1)*dy)/(dx*dx+dy*dy||1),0,1);return Math.hypot(px-x1-t*dx,py-y1-t*dy);}
function makeFighter(id,team,x,y){
  const def=ROSTER_BY_ID[id]||ROSTER_BY_ID.pikachu;
  return {id:def.id,team,def,x,y,px:x,py:y,vx:0,vy:0,hp:def.hp,maxHp:def.hp,mp:100,maxMp:100,speed:def.speed,radius:def.radius,facing:team==='player'?0:Math.PI,anim:'idle',animTime:0,animLock:0,animDuration:0,animHitAt:null,pose:null,dodgeRecovery:0,dodgeGuard:null,action:null,castRoot:0,castLock:0,invul:0,hurt:0,stun:0,burn:0,burnTick:.7,slow:0,boost:0,haste:0,hasteMultiplier:1.5,weakened:0,cleanseGuard:0,ignite:null,attackBoost:0,attackMultiplier:1,fainted:false,shield:0,shieldTime:0,moving:false,dash:null,basicTimer:team==='enemy'?.7:0,basicWindup:null,cooldowns:Object.fromEntries(Object.entries(def.moves).map(([key,m])=>[key,m.initialCooldown||0]))};
}
export class Battle {
  constructor({random=Math.random,playerId='pikachu',enemyId='typhlosion',playerTeam,enemyTeam,playerSpecial='haste',enemySpecial='haste',difficulty='standard',mode='cpu'}={}){
    this.random=random;this.options={mode:mode==='pvp'?'pvp':'cpu',playerId,enemyId,playerTeam:teamIds(playerTeam||[playerId],'pikachu'),enemyTeam:teamIds(enemyTeam||[enemyId],'typhlosion'),playerSpecial:findTrainerSkill(playerSpecial).id,enemySpecial:findTrainerSkill(enemySpecial).id,difficulty:DIFFICULTIES[difficulty]?difficulty:'standard'};this.reset();
  }
  get autoAttack(){return true;}
  isCPU(f){return this.options.mode!=='pvp'&&f.team==='enemy';}
  inputFor(f){return this.options.mode==='pvp'?(this.inputs?.[f.team]||{x:0,y:0}):this.input;}
  get playerTeam(){return this.teams.player;}
  get enemyTeam(){return this.teams.enemy;}
  get moves(){return this.movesFor(this.player);}
  movesFor(f){return {...f.def.moves,s:this.getTrainerSkill(f.team)};}
  getTrainerSkill(team='player'){return findTrainerSkill(this.options[team+'Special']);}
  get difficulty(){return DIFFICULTIES[this.options.difficulty]||DIFFICULTIES.standard;}
  configure(options={}){
    const next={...this.options,...options};
    for(const side of ['player','enemy']){
      const fallback=side==='player'?'pikachu':'typhlosion';
      const ids=Object.hasOwn(options,side+'Team')?options[side+'Team']:Object.hasOwn(options,side+'Id')?[options[side+'Id']]:next[side+'Team'];
      next[side+'Team']=teamIds(ids,fallback);next[side+'Id']=next[side+'Team'][0];next[side+'Special']=findTrainerSkill(next[side+'Special']).id;
    }
    if(!DIFFICULTIES[next.difficulty])next.difficulty='standard';this.options=next;this.reset();
  }
  reset(){
    this.networkSignature=null;
    this.state='ready';this.time=0;this.countdown=0;this.hitStop=0;this.lastStepDt=0;this.previousState=null;
    this.pendingSwitch={player:0,enemy:0};this.inputs={player:{x:0,y:0},enemy:{x:0,y:0}};
    this.activeIndices={player:0,enemy:0};this.utilityCooldowns={player:{s:0,d:0},enemy:{s:0,d:0}};this.switchCooldowns={player:0,enemy:0};this.switchReason=null;this.transition=null;
    this.teams={};
    for(const side of ['player','enemy']){
      this.teams[side]=this.options[side+'Team'].map((id,index)=>{
        const f=makeFighter(id,side,side==='player'?360:914,side==='player'?414:374);f.index=index;if(this.options.mode==='pvp')f.basicTimer=0;
        const shared=this.utilityCooldowns[side];
        for(const key of ['s','d'])Object.defineProperty(f.cooldowns,key,{enumerable:true,configurable:true,get:()=>shared[key],set:value=>{shared[key]=Math.max(0,Number(value)||0);}});
        return f;
      });
    }
    this.player=this.teams.player[0];this.enemy=this.teams.enemy[0];this.cooldowns=this.player.cooldowns;
    this.projectiles=[];this.hazards=[];this.windups=[];this.tasks=[];this.events=[];
    this.stats={damageDealt:0,damageTaken:0,movesUsed:0,hitsLanded:0,basicsFired:0,basicHits:0,dodges:0,avoidedDamage:0,trackingBreaks:0,knockouts:0,losses:0,switches:0};
    this.rivalStats={...this.stats,byPokemon:{}};this.stats.byPokemon={};
    this.masterAI={history:[],observed:null,nextSample:0,seen:new WeakMap(),threats:[],dodgeUntil:0,wasDodging:false};
    this.enraged=false;this.input={x:0,y:0};this.aiDecision=.75;this.aiDodgeTimer=1.5;this.aiComboTimer=0;this.groupId=0;this.hitGroups=new Map();this.lastHint=-10;this.emit('reset');
  }
  clearOutgoing(f){
    // A withdrawn Pokémon stops fighting, but never erases the opponent's released attacks.
    for(const key of ['projectiles','hazards','windups','tasks'])this[key]=this[key].filter(effect=>effect.team!==f.team);
    f.basicWindup=null;f.action=null;f.dash=null;f.pose=null;f.castRoot=0;f.castLock=0;f.dodgeGuard=null;f.dodgeRecovery=0;f.invul=0;f.hurt=0;f.moving=false;f.vx=0;f.vy=0;
  }
  requestSwitch(){
    if(this.state!=='playing')return false;
    if(this.switchCooldowns.player>0){this.hint(t('hints.switchCooldown',{sec:Math.ceil(this.switchCooldowns.player)}));return false;}
    if(!this.teams.player.some((f,i)=>i!==this.activeIndices.player&&f.hp>0)){this.hint(t('hints.noSwitchable'));return false;}
    this.state='switching';this.switchReason='manual';this.input={x:0,y:0};this.lastStepDt=0;this.emit('partyOpen',{forced:false});return true;
  }
  cancelSwitch(){if(this.state!=='switching'||this.switchReason!=='manual')return false;this.state='playing';this.switchReason=null;this.input={x:0,y:0};return true;}
  switchPokemon(index){
    if(this.state!=='switching'||!Number.isInteger(index)||index===this.activeIndices.player||!this.teams.player[index]||this.teams.player[index].hp<=0)return false;
    const forced=this.switchReason==='fainted';this.sendOut('player',index,forced);this.state='playing';this.switchReason=null;this.input={x:0,y:0};return true;
  }
  switchFor(team,index){
    const f=this.source(team),forced=f.hp<=0;
    if(this.options.mode!=='pvp'||this.state!=='playing'||!Number.isInteger(index)||index===this.activeIndices[team]||!this.teams[team][index]||this.teams[team][index].hp<=0||(!forced&&this.switchCooldowns[team]>0))return false;
    this.sendOut(team,index,forced);this.pendingSwitch[team]=0;return true;
  }
  sendOut(team,index,forced=false){
    const outgoing=this.source(team),incoming=this.teams[team][index],fromIndex=this.activeIndices[team],position={x:outgoing.x,y:outgoing.y};
    this.clearOutgoing(outgoing);this.activeIndices[team]=index;this[team]=incoming;this.place(incoming,position.x,position.y);
    incoming.px=incoming.x;incoming.py=incoming.y;incoming.vx=0;incoming.vy=0;incoming.basicWindup=null;incoming.action=null;incoming.dash=null;incoming.dodgeGuard=null;incoming.pose=null;incoming.stun=0;incoming.castRoot=0;incoming.castLock=.35;incoming.invul=.6;incoming.moving=false;incoming.basicTimer=Math.max(incoming.basicTimer,.35);
    this.animate(incoming,'idle',.35);this.hitStop=0;this.lastStepDt=0;this.switchCooldowns[team]=8;
    if(team==='player'){this.cooldowns=incoming.cooldowns;if(!forced)this.stats.switches++;}
    else {this.masterAI={history:[],observed:null,nextSample:0,seen:new WeakMap(),threats:[],dodgeUntil:0,wasDodging:false};this.aiDecision=.7;this.aiDodgeTimer=1.5;this.aiComboTimer=.4;this.enraged=incoming.hp/incoming.maxHp<.32;}
    if(team==='enemy'&&!forced)this.rivalStats.switches++;
    this.emit('switch',{team,fromId:outgoing.id,toId:incoming.id,fromIndex,index,x:incoming.x,y:incoming.y,forced});
  }
  faint(f){
    if(f.fainted)return;f.fainted=true;f.hp=0;this.clearOutgoing(f);f.stun=0;f.burn=0;f.ignite=null;f.shield=0;this.animate(f,'faint',99);
    if(f.team==='enemy'){this.stats.knockouts++;this.rivalStats.losses++;}else{this.stats.losses++;this.rivalStats.knockouts++;}
    const living=this.teams[f.team].filter(member=>member.hp>0);this.emit('faint',{team:f.team,index:f.index,id:f.id,name:f.def.ko,displayName:f.def.displayName||(getLocale()==='ko'?f.def.ko:f.def.name),x:f.x,y:f.y,remaining:living.length});
    if(!living.length){this.finish(f.team==='enemy');return;}
    if(f!==this.source(f.team))return;
    if(this.options.mode==='pvp'){this.pendingSwitch[f.team]=8;this.emit('partyOpen',{team:f.team,forced:true});return;}
    this.hitStop=0;this.lastStepDt=0;this.input={x:0,y:0};
    if(f.team==='player'){this.state='switching';this.switchReason='fainted';this.emit('partyOpen',{forced:true});}
    else {this.state='transition';this.transition={remaining:1.1,index:living[0].index};}
  }
  emit(type,data={}){this.events.push({...data,type});}
  drainEvents(){return this.events.splice(0);}
  start(options){if(options)this.configure(options);else this.reset();this.state='countdown';this.countdown=2.3;this.emit('start');}
  pause(){if(!['playing','countdown','transition'].includes(this.state))return false;this.previousState=this.state;this.state='paused';this.emit('pause');return true;}
  resume(){if(this.state==='paused'){this.state=this.previousState||'playing';this.emit('resume');}}
  animate(f,anim,duration,hitAt=null){f.anim=anim;f.animTime=0;f.animLock=duration;f.animDuration=duration;f.animHitAt=hitAt;}
  pose(f,kind,duration,angle=f.facing,power=1){f.pose={kind,elapsed:0,duration,angle,power};}
  schedule(delay,kind,data={}){this.tasks.push({createdAt:this.time,delay,kind,...data});}
  source(team){return team==='player'?this.player:this.enemy;}
  target(team){return team==='player'?this.enemy:this.player;}
  place(f,x,y){f.x=clamp(x,BOUNDS.left+f.radius,BOUNDS.right-f.radius);f.y=clamp(y,BOUNDS.top+f.radius,BOUNDS.bottom-f.radius);}
  hint(text){if(this.time-this.lastHint>.8){this.lastHint=this.time;this.emit('hint',{text});}}
  projectileSpeed(f,speed){return speed*(this.isCPU(f)?this.difficulty.projectileSpeed:1);}
  projectileFlight(f,speed,aim=this.target(f.team)){return clamp(distance(f,aim)/Math.max(1,this.projectileSpeed(f,speed)),.12,1.5);}
  commitEnemyAction(f,kind,key,windup,{sequence=0,flight=0,aim=null}={}){
    if(!this.isCPU(f))return;
    const attackEnd=windup+sequence+flight;
    f.action={kind,key,aim:aim?{...aim}:null,elapsed:0,windup,attackEnd,duration:attackEnd+this.difficulty.recovery};
  }
  breakTracking(f){
    let count=0;
    for(const shot of this.projectiles)if(shot.team!==f.team&&shot.homing>0){shot.homing=0;shot.trackingBroken=true;count++;}
    const foe=this.target(f.team);
    if(foe.basicWindup&&!foe.def.basic.melee&&!foe.basicWindup.trackingBroken){foe.basicWindup.trackingBroken=true;count++;}
    for(const task of this.tasks)if(task.team!==f.team&&['shot','fan','trainer'].includes(task.kind)&&!task.trackingBroken&&(task.tracked||task.m.homing>0||task.kind==='trainer')){
      task.aim=task.aim||foe.action?.aim||{x:f.x,y:f.y};task.tracked=false;task.trackingBroken=true;count++;
    }
    if(count){if(f.team==='player')this.stats.trackingBreaks+=count;this.emit('trackingBreak',{team:f.team,x:f.x,y:f.y,count,color:'#9ee8ff'});}
  }
  tryBasic(f){
    if(this.state!=='playing'||f.hp<=0||f.stun>0||(this.isCPU(f)&&f.action)||f.dash||f.dodgeRecovery>0||f.castRoot>0||f.castLock>0||f.basicWindup||f.basicTimer>0)return false;
    const target=this.target(f.team),basic=f.def.basic;
    if(distance(f,target)>basic.range)return false;
    const windup=this.isCPU(f)?Math.max(basic.windup,this.difficulty.basicWindup):basic.windup;
    const aim=this.isCPU(f)?this.aim(f,{speed:basic.projectileSpeed||600}):{x:target.x,y:target.y};
    f.facing=Math.atan2(aim.y-f.y,aim.x-f.x);f.basicWindup={startedAt:this.time,time:windup,duration:windup,aim,trackingBroken:false};
    this.animate(f,basic.melee?'attack':'shoot',windup+.24,windup);this.pose(f,'windup',windup,f.facing,.7);
    if(this.isCPU(f)){
      this.commitEnemyAction(f,'basic','basic',windup,{flight:basic.melee?0:this.projectileFlight(f,basic.projectileSpeed,aim),aim});
      this.windups.push({createdAt:this.time,type:basic.melee?'melee':'aim',basic:true,team:f.team,element:basic.element,color:basic.color,x:f.x,y:f.y,targetX:aim.x,targetY:aim.y,angle:f.facing,length:distance(f,aim),range:basic.range,radius:basic.range,life:windup,maxLife:windup});
    }
    this.emit('basicWindup',{team:f.team,x:f.x,y:f.y,angle:f.facing,duration:windup,color:basic.color,element:basic.element||f.def.type});return true;
  }
  fireBasic(f){
    const t=this.target(f.team),m=f.def.basic,pending=f.basicWindup,aim=this.isCPU(f)||pending?.trackingBroken?(pending?.aim||{x:t.x,y:t.y}):t;f.basicWindup=null;f.animTime=Math.max(f.animTime,pending?.duration||m.windup);
    // Enemy aim is committed during the visible wind-up. D breaks tracking instead of merely delaying a hit.
    if(t.hp<=0||distance(f,t)>m.range+38){f.basicTimer=.12;return;}
    f.basicTimer=m.cooldown*(this.isCPU(f)?(this.enraged?.88:1):1);
    f.facing=Math.atan2(aim.y-f.y,aim.x-f.x);this.pose(f,'strike',.2,f.facing,m.melee?1.2:.8);
    this.emit('basic',{team:f.team,id:f.id,name:m.name,element:m.element,color:m.color,x:f.x,y:f.y,targetX:aim.x,targetY:aim.y,melee:m.melee||false});
    if(f.team==='player')this.stats.basicsFired++;else this.rivalStats.basicsFired++;
    if(m.melee){this.damage(t,m.damage,f.team,{basic:true,element:m.element,color:m.color});this.emit('slash',{team:f.team,element:m.element,color:m.color,x:f.x,y:f.y,angle:f.facing,r:m.range*.8,basic:true});}
    else{const dir=unit(aim.x-f.x,aim.y-f.y);this.addProjectile({type:'basic',element:m.element,color:m.color,x:f.x+dir.x*22,y:f.y+dir.y*22,dir,speed:this.projectileSpeed(f,m.projectileSpeed),damage:m.damage,team:f.team,radius:7,life:1.8,homing:pending?.trackingBroken?0:(this.isCPU(f)?this.difficulty.basicHoming:15),trackingBroken:pending?.trackingBroken||false,basic:true});}
  }
  cast(key){return this.castFor(this.player,key);}
  castFor(f,key,{ai=false,direction=null}={}){
    ai=this.options.mode==='pvp'?false:(ai||f.team==='enemy');
    const m=key==='s'?this.getTrainerSkill(f.team):f.def.moves[key],target=this.target(f.team);if(!m||this.state!=='playing'||f!==this.source(f.team)||f.hp<=0||(f.stun>0&&!['dodge','cleanse'].includes(m.kind))||(ai&&f.action))return false;
    if(f.cooldowns[key]>.01){if(!ai)this.hint(key==='r'?t('hints.switchCooldown',{sec:Math.ceil(f.cooldowns[key])}):t('battle.reuse',{sec:Math.ceil(f.cooldowns[key])}));return false;}
    if(f.mp<m.cost){if(!ai)this.hint(t('hints.noEnergy'));return false;}
    if(f.castLock>0&&['q','w','e','r'].includes(key))return false;
    if(m.kind==='trainerHeal'&&f.hp>=f.maxHp){if(!ai)this.hint(t('hints.fullHp'));return false;}
    if(m.trainer&&m.range&&distance(f,target)>m.range){if(!ai)this.hint(t('hints.outOfRange'));return false;}
    const aim=this.aim(f,m),angle=Math.atan2(aim.y-f.y,aim.x-f.x),dir={x:Math.cos(angle),y:Math.sin(angle)};
    f.cooldowns[key]=m.cooldown*(ai&&['q','w','e'].includes(key)?this.difficulty.skillRate:1);f.mp-=m.cost;f.castLock=key==='r'?.55:.23;f.basicWindup=null;
    if(f.team==='player')this.stats.movesUsed++;else this.rivalStats.movesUsed++;
    f.facing=angle;this.animate(f,m.animation||'shoot',key==='r'?1:.42,key==='r'?.55:.15);this.pose(f,'cast',key==='r'?.65:.3,angle,key==='r'?1.5:1);
    const displayName=m.displayName||(getLocale()==='ko'?m.ko:m.name)||m.name||m.ko;
    this.emit('cast',{team:f.team,key,id:f.id,name:m.name,ko:m.ko,displayName,kind:m.kind,ultimate:key==='r',damage:m.damage||0,element:m.element||f.def.type,color:m.color,x:f.x,y:f.y,targetX:aim.x,targetY:aim.y});
    if(ai)this.emit('enemyCast',{name:m.name,ko:m.ko,displayName,color:m.color,x:f.x,y:f.y});
    const delay=ai?(key==='r'?this.difficulty.ultimateWindup:this.difficulty.reaction):.12;
    if(m.trainer){
      if(ai&&m.range){
        const warning=this.difficulty.reaction;f.castRoot=warning;this.commitEnemyAction(f,m.kind,key,warning,{aim});
        this.windups.push({createdAt:this.time,type:'aim',team:f.team,element:'normal',color:m.color,x:f.x,y:f.y,targetX:aim.x,targetY:aim.y,angle,length:distance(f,aim),range:m.range,life:warning,maxLife:warning});
        this.schedule(warning,'trainer',{team:f.team,m,trackingBroken:false});
      }else {if(ai)this.commitEnemyAction(f,m.kind,key,.2);this.applyTrainer(f,m);}
      return true;
    }
    if(m.kind==='dodge'){
      const control=this.inputFor(f),movement=control.x||control.y,evade=direction?unit(direction.x,direction.y):ai?unit(f.x-target.x,f.y-target.y):(movement?unit(control.x,control.y):unit(f.x-target.x,f.y-target.y));
      f.basicWindup=null;f.castRoot=0;f.castLock=.08;f.dodgeRecovery=0;f.stun=0;f.hurt=0;this.breakTracking(f);f.facing=Math.atan2(evade.y,evade.x);
      this.hitStop=0;f.invul=Math.max(f.invul,m.invulEnd);f.dodgeGuard={time:m.invulEnd,evaded:false};
      // Evasion cancels uncommitted attacks, but never erases already released projectiles.
      this.tasks=this.tasks.filter(task=>task.team!==f.team);this.windups=this.windups.filter(w=>w.team!==f.team);
      f.dash={kind:'dodge',dx:evade.x,dy:evade.y,time:m.duration,duration:m.duration,elapsed:0,distance:m.distance,speed:m.distance/m.duration,damage:0,hit:true,evaded:false,invulStart:m.invulStart,invulEnd:m.invulEnd,element:'normal',color:m.color};
      this.animate(f,'charge',m.duration);this.pose(f,'dodge',m.duration,f.facing,1);this.emit('dodge',{team:f.team,id:f.id,x:f.x,y:f.y,dx:evade.x,dy:evade.y,duration:m.duration,color:m.color});return true;
    }
    if(m.kind==='guard'){
      f.shield=Math.max(f.shield,m.shield);f.shieldTime=Math.max(f.shieldTime,m.duration);if(ai)this.commitEnemyAction(f,m.kind,key,.2);this.emit('shield',{x:f.x,y:f.y,value:m.shield,color:m.color});return true;
    }
    if(m.kind==='boost'){f.attackBoost=m.duration||5;f.attackMultiplier=m.attackMultiplier||1.4;if(ai)this.commitEnemyAction(f,m.kind,key,.2);this.emit('boost',{team:f.team,x:f.x,y:f.y,color:m.color,name:m.ko,duration:f.attackBoost});return true;}
    if(m.kind==='dash'){
      let d=direction?unit(direction.x,direction.y):dir;
      if(!ai&&(this.inputFor(f).x||this.inputFor(f).y))d=unit(this.inputFor(f).x,this.inputFor(f).y);
      const dashDelay=ai?this.difficulty.meleeWindup:0;f.castRoot=dashDelay;if(ai){this.animate(f,m.animation||'charge',dashDelay+.25,dashDelay);this.commitEnemyAction(f,m.kind,key,dashDelay,{sequence:m.distance/m.dashSpeed,aim});}
      if(ai)this.windups.push({createdAt:this.time,type:'dash',team:f.team,element:m.element,color:m.color,x:f.x,y:f.y,endX:clamp(f.x+d.x*m.distance,150,1130),endY:clamp(f.y+d.y*m.distance,236,552),life:dashDelay,maxLife:dashDelay});
      this.schedule(dashDelay,'dash',{team:f.team,m,dx:d.x,dy:d.y});return true;
    }
    if(m.kind==='slash'||m.kind==='pulse'){
      const castDelay=ai?this.difficulty.meleeWindup:.08;f.castRoot=castDelay;if(ai)this.commitEnemyAction(f,m.kind,key,castDelay,{aim});this.animate(f,m.animation||'attack',castDelay+.24,castDelay);
      if(ai)this.windups.push({createdAt:this.time,type:'charge',team:f.team,color:m.color,element:m.element,x:f.x,y:f.y,life:castDelay,maxLife:castDelay});
      this.schedule(castDelay,m.kind,{team:f.team,m});return true;
    }
    if(m.kind==='field'){
      // Main patch and a smaller predictive escape-route patch. Both are explicitly telegraphed.
      const d=ai?this.difficulty.fieldWindup:.45;
      if(ai){f.castRoot=d;this.animate(f,m.animation||'shoot',d+.25,d);this.commitEnemyAction(f,m.kind,key,d,{sequence:.22,aim});}
      const base={createdAt:this.time,type:'field',element:m.element,color:m.color,team:f.team,r:m.radius,delay:d,initialDelay:d,damage:m.damage,life:m.duration,maxLife:m.duration,dot:m.dot,dotTimer:.55,triggered:false,slow:m.slow||0,burn:m.burn||0,stun:m.stun||0};
      this.hazards.push({...base,x:aim.x,y:aim.y});
      if(ai){const v=Math.hypot(target.vx,target.vy)>20?unit(target.vx,target.vy):unit(target.x-f.x,target.y-f.y);const x=clamp(aim.x+v.x*108,156,1124),y=clamp(aim.y+v.y*76,238,550);this.hazards.push({...base,x,y,r:m.radius*.78,damage:Math.round(m.damage*.6),delay:d+.22,initialDelay:d+.22});}
      return true;
    }
    if(m.kind==='storm'){
      const total=m.strikes||3,first=ai?this.difficulty.ultimateWindup:.68;if(ai){this.animate(f,m.animation||'shoot',first+.3,first);this.commitEnemyAction(f,m.kind,key,first,{sequence:(total-1)*.25,aim});}const lead=unit(target.vx,target.vy);
      for(let i=0;i<total;i++)this.hazards.push({createdAt:this.time,type:'storm',team:f.team,element:m.element,color:m.color,x:clamp(aim.x+lead.x*i*10,155,1125),y:clamp(aim.y+lead.y*i*7,236,552),r:m.radius,delay:first+i*.25,initialDelay:first+i*.25,damage:Math.floor(m.damage/total)+(i<m.damage%total?1:0),life:.28,maxLife:.28,triggered:false,strike:i,stun:.18,burn:m.burn||0,lifesteal:m.lifesteal||0,ultimate:true});
      this.emit('ultimate',{team:f.team,x:aim.x,y:aim.y,color:m.color,element:m.element});f.castRoot=ai?first:.3;return true;
    }
    if(m.kind==='nova'){
      const center=f.def.basic.melee?{x:f.x,y:f.y}:aim,d=ai?this.difficulty.ultimateWindup:.58;if(ai){f.castRoot=d;this.animate(f,m.animation||'shoot',d+.3,d);this.commitEnemyAction(f,m.kind,key,d,{aim:center});}
      this.hazards.push({createdAt:this.time,type:'nova',team:f.team,element:m.element,color:m.color,x:center.x,y:center.y,r:m.radius,delay:d,initialDelay:d,damage:m.damage,life:.4,maxLife:.4,triggered:false,slow:m.slow||0,burn:m.burn||0,ultimate:true,novaCount:m.count||12});
      this.emit('ultimate',{team:f.team,x:center.x,y:center.y,color:m.color,element:m.element});return true;
    }
    if(m.kind==='beam'){
      const windup=Math.max(delay,m.charge||.6);f.castRoot=windup;if(ai)this.commitEnemyAction(f,m.kind,key,windup,{aim});this.animate(f,m.animation||'shoot',windup+.32,windup);
      this.windups.push({createdAt:this.time,type:'beam',team:f.team,element:m.element,color:m.color,x:f.x,y:f.y,angle,length:m.range||820,width:m.width||72,life:windup,maxLife:windup});
      this.schedule(windup,'beam',{team:f.team,m,x:f.x,y:f.y,angle});return true;
    }
    this.animate(f,m.animation||'shoot',delay+.25,delay);
    if(ai){f.castRoot=delay;this.windups.push({createdAt:this.time,type:'cone',team:f.team,element:m.element,color:m.color,x:f.x,y:f.y,angle,length:600,width:m.kind==='fan'?(m.count-1)*m.spread/2:.09,life:delay,maxLife:delay});}
    const interval=ai?Math.max(m.interval||0,this.difficulty.volleyInterval):(m.interval||0);
    if(ai)this.commitEnemyAction(f,m.kind,key,delay,{sequence:m.kind==='volley'?(m.count-1)*interval:0,flight:this.projectileFlight(f,m.speed||650,aim),aim});
    if(m.kind==='volley'){
      for(let i=0;i<m.count;i++)this.schedule(delay+i*interval,'shot',{team:f.team,m,aim:{...aim},tracked:!ai,sequence:i});
    }else this.schedule(delay,m.kind==='fan'?'fan':'shot',{team:f.team,m,aim,tracked:false});
    return true;
  }
  applyTrainer(f,m){
    const target=this.target(f.team);
    if(m.range){
      if(target.hp<=0||distance(f,target)>m.range||target.cleanseGuard>0)return false;
      if(target.invul>0||target.dodgeGuard){this.damage(target,m.damage||0,f.team,{fixed:true});return false;}
    }
    if(m.kind==='haste'){f.haste=m.duration;f.hasteMultiplier=m.multiplier;}
    else if(m.kind==='exhaust'){target.slow=Math.max(target.slow,m.duration);target.weakened=Math.max(target.weakened,m.duration);}
    else if(m.kind==='barrier'){const shield=Math.round(f.maxHp*m.shieldPercent);f.shield=Math.max(f.shield,shield);f.shieldTime=Math.max(f.shieldTime,m.duration);this.emit('shield',{team:f.team,x:f.x,y:f.y,value:shield,color:m.color});}
    else if(m.kind==='trainerHeal'){const healed=Math.min(f.maxHp-f.hp,Math.round(f.maxHp*m.healPercent));f.hp+=healed;this.emit('heal',{x:f.x,y:f.y,value:healed,color:m.color});}
    else if(m.kind==='cleanse'){f.stun=0;f.burn=0;f.burnTick=.7;f.slow=0;f.weakened=0;f.ignite=null;f.cleanseGuard=m.duration;}
    else if(m.kind==='ignite'){target.ignite={remaining:m.duration,tick:.5,ticks:8,damage:m.damage/8,team:f.team,sourceId:f.id};}
    const ts=this.getTrainerSkill(f.team);
    this.emit('trainer',{team:f.team,id:m.id,name:m.ko,displayName:ts.displayName,color:m.color,x:f.x,y:f.y,targetX:target.x,targetY:target.y});return true;
  }
  aim(f,m){if(this.isCPU(f)&&this.options.difficulty==='master'&&this.masterAI.observed)return this.masterAim(m);const target=this.target(f.team);let lead=0;if(this.isCPU(f)){const timing=this.difficulty,speed=this.projectileSpeed(f,m.speed||650),warning=m.kind==='field'?timing.fieldWindup:['storm','beam','nova'].includes(m.kind)?timing.ultimateWindup:['dash','slash','pulse'].includes(m.kind)?timing.meleeWindup:m.kind?timing.reaction:timing.basicWindup;lead=clamp((warning*.65+distance(f,target)/Math.max(1,speed)*.55)*timing.lead,0,1.0);if(['storm','field','nova'].includes(m.kind))lead=warning*.8*timing.lead;}
    return {x:clamp(target.x+target.vx*lead,BOUNDS.left+target.radius,BOUNDS.right-target.radius),y:clamp(target.y+target.vy*lead,BOUNDS.top+target.radius,BOUNDS.bottom-target.radius)};
  }
  addProjectile({type='orb',element='normal',color, x,y,dir,speed,damage,team,radius=11,life=1.8,homing=0,basic=false,burn=0,slow=0,group=null,maxHits=1,trackingBroken=false}){
    this.projectiles.push({type,element,color:color||ELEMENTS[element]?.color||'#e1e9ef',x,y,px:x,py:y,vx:dir.x*speed,vy:dir.y*speed,speed,damage,team,radius,life,age:0,homing,basic,burn,slow,group,maxHits,trackingBroken});
  }
  resolveTask(task){if(this.state!=='playing')return;const f=this.source(task.team),target=this.target(task.team),m=task.m;if(f.hp<=0)return;
    if(f.stun>0){this.emit('interrupted',{x:f.x,y:f.y});return;}
    if(task.kind==='trainer'){if(!task.trackingBroken)this.applyTrainer(f,m);return;}
    const common={team:f.team,id:f.id,name:m.name,ko:m.ko,kind:m.kind,ultimate:!!m.ultimate,element:m.element,color:m.color,damage:m.damage,burn:m.burn||0,slow:m.slow||0};
    if(task.kind==='dash'){
      f.dash={dx:task.dx,dy:task.dy,time:m.distance/m.dashSpeed,speed:m.dashSpeed,damage:m.damage,hit:false,element:m.element,color:m.color,burn:m.burn||0};f.invul=m.phase?.2:.1;f.facing=Math.atan2(task.dy,task.dx);this.animate(f,m.animation||'charge',f.dash.time+.15,.08);this.pose(f,'strike',f.dash.time+.12,f.facing,1.1);return;
    }
    if(task.kind==='slash'||task.kind==='pulse'){
      const range=m.range||165;this.pose(f,'strike',.25,f.facing,1.3);this.emit(task.kind,{...common,x:f.x,y:f.y,angle:f.facing,r:range});
      if(distance(f,target)<range+target.radius*.35){this.damage(target,m.damage,f.team,{...common,stun:m.stun||0});if(task.kind==='slash'){const away=unit(target.x-f.x,target.y-f.y);this.place(target,target.x+away.x*19,target.y+away.y*19);}}return;
    }
    if(task.kind==='beam'){
      const length=m.range||820,endX=task.x+Math.cos(task.angle)*length,endY=task.y+Math.sin(task.angle)*length;
      this.pose(f,'strike',.38,task.angle,1.5);this.emit('beam',{...common,x:task.x,y:task.y,angle:task.angle,length,width:m.width,life:.5});
      if(segmentDistance(target.x,target.y,task.x,task.y,endX,endY)<m.width/2+target.radius*.7)this.damage(target,m.damage,f.team,{...common,stun:.25});return;
    }
    const aim=task.tracked?this.aim(f,m):(task.aim||this.aim(f,m)),angle=Math.atan2(aim.y-f.y,aim.x-f.x),speed=this.projectileSpeed(f,m.speed||650);
    f.facing=angle;this.pose(f,'strike',.22,angle,.8);if(task.sequence>0)this.animate(f,m.animation||'shoot',.24,.03);else if(f.animHitAt!==null)f.animTime=Math.max(f.animTime,f.animHitAt);
    if(task.kind==='fan'){
      const group=++this.groupId,count=m.count||5;
      for(let i=0;i<count;i++){const a=angle+(i-(count-1)/2)*(m.spread||.13),dir={x:Math.cos(a),y:Math.sin(a)};this.addProjectile({...common,type:m.element==='fire'?'fire':m.element==='grass'?'leaf':'orb',x:f.x+dir.x*24,y:f.y+dir.y*24,dir,speed,damage:m.damage,radius:12,life:1.6,group,maxHits:3});}
    }else{const dir={x:Math.cos(angle),y:Math.sin(angle)};this.addProjectile({...common,type:m.element==='rock'?'rock':m.element==='electric'?'bolt':'orb',x:f.x+dir.x*23,y:f.y+dir.y*23,dir,speed,damage:m.damage,radius:m.kind==='bolt'?15:12,life:1.7,homing:task.trackingBroken?0:m.homing||0,trackingBroken:!!task.trackingBroken});}
    this.emit('fieldAttack',{...common,x:f.x,y:f.y,r:20,angle});
  }
  damage(who,amount,team,{stun=0,burn=0,slow=0,basic=false,element='normal',color,lifesteal=0,periodic=false,fixed=false,sourceId=null}={}){
    if(this.state!=='playing'||who.hp<=0)return false;
    if(who.invul>0||who.dodgeGuard){
      if(who.dodgeGuard&&!periodic){if(who.team==='player'){this.stats.avoidedDamage+=Math.round(amount);if(!who.dodgeGuard.evaded)this.stats.dodges++;}if(!who.dodgeGuard.evaded)this.emit('evade',{team:who.team,x:who.x,y:who.y,amount,kind:'dodge',color:'#b2efff'});who.dodgeGuard.evaded=true;}
      return false;
    }
    const source=this.source(team);amount=Math.max(0,Math.round(amount*(fixed?1:(this.isCPU(this.source(team))?this.difficulty.damage:1)*(source.attackBoost>0?source.attackMultiplier:1)*(source.weakened>0?.65:1))));
    const absorbed=Math.min(who.shield,amount);who.shield-=absorbed;const dealt=Math.min(who.hp,amount-absorbed);who.hp=Math.max(0,who.hp-dealt);
    who.hurt=periodic?.04:.13;if(who.cleanseGuard<=0){who.stun=Math.max(who.stun,stun);if(burn>0&&who.burn<=0)who.burnTick=.7;if(burn>0)who.burnSourceId=sourceId||source.id;who.burn=Math.max(who.burn,burn);who.slow=Math.max(who.slow,slow);}
    // Hit flashes do not grant free immunity. Only mobility abilities grant invulnerability.
    const attacker=this.source(team),hitAngle=Math.atan2(who.y-attacker.y,who.x-attacker.x);
    if(!periodic){if(this.options.mode!=='pvp')this.hitStop=Math.max(this.hitStop,basic?.028:amount>=100?.062:.042);this.pose(who,'recoil',basic?.14:.22,hitAngle,basic?.65:amount>=100?1.6:1);if(who.castRoot<=0&&!who.basicWindup&&!who.dash)this.animate(who,'hurt',.18,.025);}
    if(team==='player'){this.stats.damageDealt+=dealt;this.stats.hitsLanded++;if(basic)this.stats.basicHits++;}else this.stats.damageTaken+=dealt;
    if(team==='enemy'){this.rivalStats.damageDealt+=dealt;this.rivalStats.hitsLanded++;if(basic)this.rivalStats.basicHits++;}else this.rivalStats.damageTaken+=dealt;
    const credited=this.teams[team].find(f=>f.id===sourceId)||source,totals=team==='player'?this.stats:this.rivalStats;totals.byPokemon||={};const contribution=totals.byPokemon[credited.id]||={damage:0,knockouts:0};contribution.damage+=dealt;if(who.hp<=0)contribution.knockouts++;
    this.emit('hit',{sourceId:credited.id,x:who.x,y:who.y,amount:dealt||absorbed,absorbed,team,critical:amount>=75,basic,periodic,victimTeam:who.team,angle:hitAngle,element,color:color||ELEMENTS[element]?.color});
    if(lifesteal){const source=this.source(team),gain=Math.min(source.maxHp-source.hp,Math.round(dealt*lifesteal));source.hp+=gain;if(gain)this.emit('heal',{x:source.x,y:source.y,value:gain});}
    if(who.hp<=0)this.faint(who);return true;
  }
  finish(won){this.pendingSwitch={player:0,enemy:0};this.state=won?'won':'lost';this.hitStop=0;this.switchReason=null;this.transition=null;for(const f of [...this.teams.player,...this.teams.enemy]){f.hurt=0;f.invul=0;f.action=null;f.dodgeGuard=null;f.stun=0;f.burn=0;f.slow=0;f.boost=0;f.haste=0;f.weakened=0;f.cleanseGuard=0;f.ignite=null;f.attackBoost=0;f.shield=0;f.dash=null;f.pose=null;f.dodgeRecovery=0;f.moving=false;f.basicWindup=null;this.animate(f,f.hp<=0?'faint':'idle',99);}this.projectiles=[];this.hazards=[];this.windups=[];this.tasks=[];this.emit('end',{won,stats:{...this.stats},rivalStats:{...this.rivalStats},time:this.time});}
  update(dt,input={x:0,y:0},enemyInput={x:0,y:0}){
    dt=clamp(dt,0,.05);this.lastStepDt=0;this.input={x:input.x||0,y:input.y||0};
    this.inputs={player:this.input,enemy:{x:enemyInput.x||0,y:enemyInput.y||0}};
    if(this.options.mode==='pvp'&&this.state==='playing')for(const side of ['player','enemy']){if(this.pendingSwitch[side]>0){this.pendingSwitch[side]-=dt;if(this.pendingSwitch[side]<=0){const next=this.teams[side].findIndex(f=>f.hp>0);if(next>=0)this.switchFor(side,next);}}}
    if(this.state==='paused')return;
    if(this.state==='switching'){if(this.switchReason==='fainted')this.player.animTime+=dt;return;}
    if(this.state==='transition'){
      this.enemy.animTime+=dt;this.transition.remaining-=dt;
      if(this.transition.remaining<=.000001){const index=this.transition.index;this.transition=null;this.sendOut('enemy',index,true);this.state='playing';}
      return;
    }
    if(this.state==='ready'||this.state==='won'||this.state==='lost'){this.player.animTime+=dt;this.enemy.animTime+=dt;return;}
    if(this.state==='countdown'){this.countdown-=dt;this.player.animTime+=dt;this.enemy.animTime+=dt;if(this.countdown<=0){this.state='playing';this.emit('fight');}return;}
    if(this.hitStop>0){const frozen=Math.min(dt,this.hitStop);this.hitStop-=frozen;dt-=frozen;if(dt<.00001)return;}
    this.lastStepDt=dt;this.time+=dt;
    for(const side of ['player','enemy']){
      for(const key of ['s','d'])this.utilityCooldowns[side][key]=Math.max(0,this.utilityCooldowns[side][key]-dt);
      this.switchCooldowns[side]=Math.max(0,this.switchCooldowns[side]-dt);
      for(const member of this.teams[side]){
        for(const key of ['q','w','e','r'])member.cooldowns[key]=Math.max(0,member.cooldowns[key]-dt);
        if(member.hp>0)member.mp=Math.min(member.maxMp,member.mp+MP_REGEN_PER_SECOND*dt);
        if(member!==this.source(side)){
          for(const key of ['stun','burn','slow','boost','haste','weakened','cleanseGuard','attackBoost','invul','basicTimer'])member[key]=Math.max(0,member[key]-dt);
          member.shieldTime=Math.max(0,member.shieldTime-dt);if(!member.shieldTime)member.shield=0;
          if(member.ignite){member.ignite.remaining-=dt;if(member.ignite.remaining<=0)member.ignite=null;}
        }
      }
    }
    for(const f of [this.player,this.enemy]){
      if(f.action){f.action.elapsed+=dt;if(f.action.elapsed>=f.action.duration-.000001)f.action=null;}
      if(f.dodgeGuard){f.dodgeGuard.time=Math.max(0,f.dodgeGuard.time-dt);if(f.dodgeGuard.time<=.000001)f.dodgeGuard=null;}
      f.px=f.x;f.py=f.y;f.animTime+=dt;f.moving=false;if(f.pose){f.pose.elapsed+=dt;if(f.pose.elapsed>=f.pose.duration)f.pose=null;}
      for(const key of ['animLock','castLock','castRoot','invul','hurt','stun','boost','slow','haste','weakened','cleanseGuard','attackBoost','basicTimer','dodgeRecovery']){const remaining=f[key]-dt;f[key]=remaining<.000001?0:remaining;}
      if(f.shieldTime>0){f.shieldTime-=dt;if(f.shieldTime<=0)f.shield=0;}
      if(f.burn>0){f.burn-=dt;f.burnTick-=dt;if(f.burnTick<=0){f.burnTick=.75;this.damage(f,4,f.team==='player'?'enemy':'player',{element:'fire',periodic:true,sourceId:f.burnSourceId});}}
      if(f.ignite&&f.hp>0){const mark=f.ignite;mark.remaining-=dt;mark.tick-=dt;while(mark.tick<=.000001&&mark.ticks>0&&this.state==='playing'){mark.tick+=.5;mark.ticks--;this.damage(f,mark.damage,mark.team,{element:'fire',periodic:true,fixed:true,sourceId:mark.sourceId});}if(mark.ticks<=0||mark.remaining<-.00001||f.hp<=0)f.ignite=null;}
    }
    if(this.state!=='playing')return;
    const p=this.player,e=this.enemy,moving=this.input.x||this.input.y;
    // Basic attacks are always automatic and never take over or slow the player's movement.
    if(p.dash)this.moveDash(p,dt,e);
    else if(p.hp>0&&p.stun===0&&p.castRoot===0&&p.dodgeRecovery===0){
      if(moving)this.move(p,unit(this.input.x,this.input.y),dt);
    }
    if(p.basicWindup)p.facing=Math.atan2(e.y-p.y,e.x-p.x);
    p.vx=p.vx*.35+(p.x-p.px)/Math.max(.001,dt)*.65;p.vy=p.vy*.35+(p.y-p.py)/Math.max(.001,dt)*.65;
    if(this.options.mode==='pvp'){
      const control=this.inputs.enemy;
      if(e.dash)this.moveDash(e,dt,p);else if(e.hp>0&&e.stun===0&&e.castRoot===0&&e.dodgeRecovery===0&&(control.x||control.y))this.move(e,unit(control.x,control.y),dt);
      if(e.basicWindup)e.facing=Math.atan2(p.y-e.y,p.x-e.x);
    }else this.updateAI(dt);
    e.vx=e.vx*.35+(e.x-e.px)/Math.max(.001,dt)*.65;e.vy=e.vy*.35+(e.y-e.py)/Math.max(.001,dt)*.65;
    const sep=distance(p,e),min=p.radius+e.radius;
    if(sep<min&&p.hp>0&&e.hp>0&&!p.dash&&!e.dash){const n=sep<.001?{x:-1,y:0}:unit(p.x-e.x,p.y-e.y);this.place(p,p.x+n.x*(min-sep)*(this.options.mode==='pvp'?.5:.55),p.y+n.y*(min-sep)*(this.options.mode==='pvp'?.5:.55));this.place(e,e.x-n.x*(min-sep)*(this.options.mode==='pvp'?.5:.45),e.y-n.y*(min-sep)*(this.options.mode==='pvp'?.5:.45));}
    this.tryBasic(p);if(this.options.mode==='pvp')this.tryBasic(e);
    for(const f of [p,e]){
      if(f.basicWindup){if(f.stun>0){f.basicWindup=null;this.windups=this.windups.filter(w=>!(w.team===f.team&&w.basic));}else if(f.basicWindup.startedAt!==this.time){f.basicWindup.time-=dt;if(f.basicWindup.time<=.000001)this.fireBasic(f);}}
      if(f.animLock<=0&&!f.dash){const anim=f.moving?'walk':'idle';if(f.anim!==anim){f.anim=anim;f.animTime=0;}}
    }
    const queued=this.tasks;this.tasks=[];
    for(const task of queued){if(this.state!=='playing')break;if(task.createdAt!==this.time)task.delay-=dt;if(task.delay<=0)this.resolveTask(task);else this.tasks.push(task);}
    this.windups=this.windups.filter(w=>{if(w.createdAt!==this.time)w.life-=dt;return w.life>0;});
    this.updateProjectiles(dt);
    if(this.state==='playing')this.updateHazards(dt);
    if(this.hitGroups.size>250)this.hitGroups.clear();
  }
  move(f,dir,dt,mult=1){f.moving=true;f.facing=Math.atan2(dir.y,dir.x);const speed=f.speed*(f.boost>0?1.24:1)*(f.haste>0?f.hasteMultiplier:1)*(f.slow>0?.68:1)*mult;this.place(f,f.x+dir.x*speed*dt,f.y+dir.y*speed*dt);}
  moveDash(f,dt,target){const d=f.dash,old={x:f.x,y:f.y},step=Math.min(dt,d.time);
    if(d.kind==='dodge'){
      const before=d.elapsed/d.duration;d.elapsed=Math.min(d.duration,d.elapsed+step);const after=d.elapsed/d.duration,ease=t=>1-(1-t)*(1-t),travel=d.distance*(ease(after)-ease(before));
      this.place(f,f.x+d.dx*travel,f.y+d.dy*travel);f.moving=true;d.time-=step;
      if(d.time<=.00001){f.dash=null;f.dodgeRecovery=0;this.animate(f,'idle',.04);}
      return;
    }
    this.place(f,f.x+d.dx*d.speed*step,f.y+d.dy*d.speed*step);f.moving=true;d.time-=dt;
    if(!d.hit&&segmentDistance(target.x,target.y,old.x,old.y,f.x,f.y)<f.radius+target.radius+10){this.damage(target,d.damage,f.team,{stun:.12,burn:d.burn||0,element:d.element,color:d.color});d.hit=true;}
    if(d.time<=0)f.dash=null;
  }
  updateProjectiles(dt){const active=this.projectiles;
    for(const p of active){if(this.state!=='playing')break;p.px=p.x;p.py=p.y;p.life-=dt;p.age+=dt;const target=this.target(p.team);
      if(p.homing>0){const dir=unit(target.x-p.x,target.y-p.y),mix=1-Math.exp(-p.homing*dt);const heading=unit(p.vx*(1-mix)+dir.x*p.speed*mix,p.vy*(1-mix)+dir.y*p.speed*mix);p.vx=heading.x*p.speed;p.vy=heading.y*p.speed;}
      p.x+=p.vx*dt;p.y+=p.vy*dt;
      if(segmentDistance(target.x,target.y,p.px,p.py,p.x,p.y)<target.radius+p.radius){const hits=p.group?this.hitGroups.get(p.group)||0:0;if(!p.group||hits<p.maxHits){if(this.damage(target,p.damage,p.team,{basic:p.basic,burn:p.burn,slow:p.slow,element:p.element,color:p.color})&&p.group)this.hitGroups.set(p.group,hits+1);}p.life=0;this.emit('impact',{x:p.x,y:p.y,team:p.team,basic:p.basic,angle:Math.atan2(p.vy,p.vx),projectileType:p.type,element:p.element,color:p.color});}
    }
    if(this.state==='playing')this.projectiles=active.filter(p=>p.life>0&&p.x>20&&p.x<1260&&p.y>145&&p.y<650);
  }
  insideHazard(h,target){return Math.hypot(target.x-h.x,(target.y-h.y)/.7)<h.r+target.radius*.3;}
  updateHazards(dt){const active=this.hazards;
    for(const h of active){if(this.state!=='playing')break;if(h.createdAt===this.time)continue;h.delay-=dt;if(h.delay>0)continue;const target=this.target(h.team);
      if(!h.triggered){h.triggered=true;this.emit('detonate',{team:h.team,element:h.element,color:h.color,x:h.x,y:h.y,r:h.r,ultimate:h.ultimate||false,strike:h.strike||0});if(this.insideHazard(h,target))this.damage(target,h.damage,h.team,{stun:h.stun||0,burn:h.burn||0,slow:h.slow||0,lifesteal:h.lifesteal||0,element:h.element,color:h.color});
        if(h.novaCount&&this.state==='playing'){const group=++this.groupId;for(let i=0;i<h.novaCount;i++){const a=i*Math.PI*2/h.novaCount,dir={x:Math.cos(a),y:Math.sin(a)};this.addProjectile({type:'orb',element:h.element,color:h.color,x:h.x+dir.x*24,y:h.y+dir.y*24,dir,speed:460,damage:h.damage*.08,team:h.team,radius:12,life:1.15,group,maxHits:2});}}
      }
      if(h.dot){h.dotTimer-=dt;if(h.dotTimer<=0){h.dotTimer=.55;if(this.insideHazard(h,target))this.damage(target,h.dot,h.team,{slow:.8,element:h.element,color:h.color,periodic:true});}}
      h.life-=dt;
    }
    if(this.state==='playing')this.hazards=active.filter(h=>h.delay>0||h.life>0);
  }
  // Master reads delayed visible state, never input, queued player tasks or private cooldowns.
  observeMaster(){
    const a=this.masterAI,p=this.player,t=this.time;
    if(t>=a.nextSample){
      a.nextSample=t+.06;
      const speed=Math.hypot(p.vx,p.vy),cap=p.speed*1.6,scale=speed>cap?cap/speed:1;
      a.history.push({time:t,x:p.x,y:p.y,vx:p.vx*scale,vy:p.vy*scale,radius:p.radius,dodging:p.dash?.kind==='dodge'});
    }
    while(a.history.length&&a.history[0].time<=t-.18){
      const next=a.history.shift(),prev=a.observed,step=prev?next.time-prev.time:0;
      let turn=0;
      if(prev&&step>0&&Math.hypot(prev.vx,prev.vy)>40&&Math.hypot(next.vx,next.vy)>40&&!prev.dodging&&!next.dodging)
        turn=clamp(Math.atan2(prev.vx*next.vy-prev.vy*next.vx,prev.vx*next.vx+prev.vy*next.vy)/step,-2.4,2.4);
      next.turn=prev?(prev.turn||0)*.65+turn*.35:0;a.observed=next;
      if(next.dodging&&!a.wasDodging)a.dodgeUntil=next.time+p.def.moves.d.cooldown;
      a.wasDodging=next.dodging;
    }
    const visible=[...this.hazards,...this.windups,...this.projectiles].filter(h=>h.team==='player');
    if(p.basicWindup)visible.push(p.basicWindup);
    a.threats=[];
    for(const h of visible){if(!a.seen.has(h))a.seen.set(h,t);if(t-a.seen.get(h)>=.20)a.threats.push(h);}
  }
  masterPredict(seconds=0){
    const p=this.masterAI.observed||this.player,t=clamp(seconds+(p.time===undefined?0:this.time-p.time),0,1.65),turn=p.turn||0;
    let dx=p.vx*t,dy=p.vy*t;
    if(Math.abs(turn)>.12&&!p.dodging){const sn=Math.sin(turn*t)/turn,cs=(1-Math.cos(turn*t))/turn;dx=p.vx*sn-p.vy*cs;dy=p.vx*cs+p.vy*sn;}
    return {x:clamp(p.x+dx,BOUNDS.left+p.radius,BOUNDS.right-p.radius),y:clamp(p.y+dy,BOUNDS.top+p.radius,BOUNDS.bottom-p.radius)};
  }
  masterAim(m){
    const e=this.enemy,t=this.difficulty;
    const warning=m.kind==='field'?t.fieldWindup:['storm','nova'].includes(m.kind)?t.ultimateWindup:m.kind==='beam'?Math.max(t.ultimateWindup,m.charge||.6):['dash','slash','pulse'].includes(m.kind)?t.meleeWindup:m.kind?t.reaction:Math.max(e.def.basic.windup,t.basicWindup);
    let horizon=warning;
    if(!m.kind||['bolt','volley','fan'].includes(m.kind)){
      const speed=this.projectileSpeed(e,m.speed||e.def.basic.projectileSpeed||650);
      horizon+=distance(e,this.masterPredict(warning))/speed;
    }else if(m.kind==='dash')horizon+=Math.min(m.distance,distance(e,this.masterPredict()))/m.dashSpeed;
    return this.masterPredict(horizon*t.lead);
  }
  masterDanger(pos,horizon=.35){
    let risk=0;
    for(const h of this.masterAI.threats){
      if(h.r!==undefined){
        if(h.delay<=horizon&&(!h.triggered||h.dot)&&this.insideHazard({...h,r:h.r+12},pos))risk+=1+(h.ultimate?2:0);
      }else if(h.speed!==undefined){
        const flight=clamp(((pos.x-h.x)*h.vx+(pos.y-h.y)*h.vy)/(h.speed*h.speed||1),0,horizon);
        if(Math.hypot(pos.x-h.x-h.vx*flight,pos.y-h.y-h.vy*flight)<pos.radius+h.radius+18)risk+=h.basic?.6:1;
      }else if(h.type==='beam'&&h.life<=horizon){
        if(segmentDistance(pos.x,pos.y,h.x,h.y,h.x+Math.cos(h.angle)*h.length,h.y+Math.sin(h.angle)*h.length)<(h.width||72)/2+pos.radius)risk+=3;
      }else if(h===this.player.basicWindup&&this.player.def.basic.melee&&h.time<=horizon&&distance(pos,this.player)<this.player.def.basic.range+pos.radius)risk+=.7;
    }
    return risk;
  }
  masterRoute(ideal,travel=65,dodging=false){
    const e=this.enemy,p=this.masterPredict(),d=distance(e,p),melee=e.def.basic.melee;
    const intercept=this.masterPredict(clamp(d/(e.speed||1)*.5*this.difficulty.aggression,.12,1.15));
    let best=null,bestScore=Infinity;
    for(let i=0;i<16;i++){
      const angle=i*Math.PI/8,dir={x:Math.cos(angle),y:Math.sin(angle)},point={x:clamp(e.x+dir.x*travel,BOUNDS.left+e.radius,BOUNDS.right-e.radius),y:clamp(e.y+dir.y*travel,BOUNDS.top+e.radius,BOUNDS.bottom-e.radius),radius:e.radius};
      const middle={x:(point.x+e.x)/2,y:(point.y+e.y)/2,radius:e.radius};
      const range=distance(point,p),edge=Math.max(0,28-Math.min(point.x-BOUNDS.left-e.radius,BOUNDS.right-e.radius-point.x,point.y-BOUNDS.top-e.radius,BOUNDS.bottom-e.radius-point.y));
      const space=melee?distance(point,intercept):Math.abs(range-ideal)+(d>ideal+60?distance(point,intercept)*.6:0);
      const risk=this.masterDanger(point,dodging?.65:.5)+this.masterDanger(middle,dodging?.25:.3)*(dodging?.15:.7);
      const score=space+edge*.8+risk*1200+(travel-distance(e,point))*2;
      if(score<bestScore){bestScore=score;best=dir;}
    }
    return best;
  }
  masterDefend(ideal){
    const e=this.enemy;if(e.action||e.basicWindup||e.castRoot>0||e.dash)return false;
    const risk=this.masterDanger({...e},.38);if(risk<=0)return false;
    // A real D, with the exact player contract. No cancelling committed attacks to evade.
    if(e.cooldowns.d===0&&this.castFor(e,'d',{ai:true,direction:this.masterRoute(ideal,e.def.moves.d.distance,true)}))return true;
    const guard=Object.entries(e.def.moves).find(([key,m])=>m.kind==='guard'&&e.cooldowns[key]===0&&e.mp>=m.cost);
    if(guard&&e.shield<30&&this.castFor(e,guard[0],{ai:true}))return true;
    if(this.getTrainerSkill('enemy').kind==='barrier'&&e.cooldowns.s===0&&e.shield<30)return this.castFor(e,'s',{ai:true});
    return false;
  }
  masterChooseMove(){
    const e=this.enemy,p=this.masterPredict(),d=distance(e,p),t=this.difficulty,a=this.masterAI,spent=a.dodgeUntil-this.time;
    const punish=spent>.55;let best=null,score=0;
    for(const key of ['r','e','q','w']){
      const m=e.def.moves[key];if(e.cooldowns[key]>.01||e.mp<m.cost)continue;
      const aim=this.masterAim(m),future=distance(e,aim);let value=0;
      if(m.kind==='guard')continue; // shields answer observed danger instead of blocking pressure
      if(m.kind==='boost'){if(e.attackBoost===0&&d<e.def.basic.range+80&&e.mp>=m.cost+15)value=28;}
      else if(m.kind==='dash'){
        if(d>e.def.basic.range*.75&&future<m.distance+e.def.basic.range*.8&&future>m.distance*.48){
          const dir=unit(aim.x-e.x,aim.y-e.y),end={x:clamp(e.x+dir.x*m.distance,BOUNDS.left+e.radius,BOUNDS.right-e.radius),y:clamp(e.y+dir.y*m.distance,BOUNDS.top+e.radius,BOUNDS.bottom-e.radius),radius:e.radius};
          if(this.masterDanger(end,.65)===0)value=(e.def.basic.melee?90:42)+(punish?25:0);
        }
      }else if(['slash','pulse'].includes(m.kind)){if(future<m.range+this.player.radius*.2)value=70+(punish?30:0);}
      else if(m.kind==='nova'&&e.def.basic.melee){if(Math.hypot(aim.x-e.x,(aim.y-e.y)/.7)<m.radius*.88)value=145+(punish?30:0);}
      else if(['field','storm','nova'].includes(m.kind)){if(d<690)value=(key==='r'?135:75)+(punish?35:0);}
      else if(m.kind==='beam'){if(future<(m.range||820))value=125+(punish?30:0);}
      else if(d<Math.min(760,(m.speed||650)*t.projectileSpeed*1.15))value=55+(punish?25:0)+(m.slow?12:0);
      // Prefer landing after the observed 0.5s invulnerability, not dumping into D.
      if(value&&a.wasDodging&&!['field','storm','nova','boost'].includes(m.kind)){if(e.mp<50)continue;value*=.2;}
      if(value>score){best=key;score=value;}
    }
    return best;
  }
  updateMasterAI(dt){
    const e=this.enemy;if(e.hp<=0)return;this.observeMaster();
    if(!this.enraged&&e.hp/e.maxHp<.32){this.enraged=true;this.emit('enrage',{name:e.def.ko});}
    this.aiDecision-=dt;this.aiComboTimer=Math.max(0,this.aiComboTimer-dt);
    if(e.dash){this.moveDash(e,dt,this.player);return;}
    const p=this.masterPredict(),d=distance(e,p),spent=this.masterAI.dodgeUntil-this.time>.55;
    const ideal=e.def.basic.melee?e.def.basic.range*.60:e.def.basic.range*(spent?.58:.72);
    if(e.stun>0){if(!e.action&&e.cooldowns.s===0&&this.getTrainerSkill('enemy').kind==='cleanse')this.castFor(e,'s',{ai:true});return;}
    e.facing=e.action?.aim?Math.atan2(e.action.aim.y-e.y,e.action.aim.x-e.x):Math.atan2(p.y-e.y,p.x-e.x);
    if(this.masterDefend(ideal))return;
    if(e.castRoot===0&&!e.basicWindup){
      const motion=this.masterRoute(ideal),recovering=e.action&&e.action.elapsed>=e.action.attackEnd;
      if(motion)this.move(e,motion,dt,(this.enraged?1.08:1)*(recovering?.85:1));
    }
    // Keep pressure with free basics while rebuilding MP instead of interrupting them with every affordable skill.
    if(e.mp<50&&e.castRoot===0&&this.aiComboTimer===0&&!e.action&&this.tryBasic(e))return;
    if(this.aiDecision<=0&&e.castRoot===0&&e.castLock===0&&!e.basicWindup&&!e.action&&this.masterAI.observed){
      this.aiDecision=.10;const special=this.getTrainerSkill('enemy');
      const useSpecial=e.cooldowns.s===0&&(special.kind==='haste'&&d>(e.def.basic.melee?160:320)||special.kind==='exhaust'&&d<special.range||special.kind==='ignite'&&d<special.range&&spent||special.kind==='trainerHeal'&&e.hp<e.maxHp*.75||special.kind==='cleanse'&&(e.burn>0||e.slow>0||e.ignite));
      if(useSpecial&&this.castFor(e,'s',{ai:true}))return;
      const key=this.masterChooseMove();if(key&&this.castFor(e,key,{ai:true})){this.aiComboTimer=.10;return;}
    }
    if(e.castRoot===0&&this.aiComboTimer===0&&!e.action)this.tryBasic(e);
  }
  updateAI(dt){if(this.options.difficulty==='master')return this.updateMasterAI(dt);const e=this.enemy,p=this.player,d=distance(e,p);if(e.hp<=0)return;
    if(!this.enraged&&e.hp/e.maxHp<.32){this.enraged=true;this.emit('enrage',{name:e.def.ko});}
    this.aiDecision-=dt;this.aiDodgeTimer-=dt;this.aiComboTimer=Math.max(0,this.aiComboTimer-dt);
    if(e.dash){this.moveDash(e,dt,p);return;}if(e.stun>0){if(!e.action&&e.cooldowns.s===0&&this.getTrainerSkill('enemy').kind==='cleanse')this.castFor(e,'s',{ai:true});return;}
    const dir=unit(p.x-e.x,p.y-e.y);e.facing=e.action?.aim&&e.action.elapsed<e.action.attackEnd?Math.atan2(e.action.aim.y-e.y,e.action.aim.x-e.x):Math.atan2(dir.y,dir.x);
    let threat=null;for(const h of this.hazards)if(h.team==='player'&&h.delay<.6&&this.insideHazard({...h,r:h.r+25},e)){threat=h;break;}
    if(threat&&this.aiDodgeTimer<=0&&e.castRoot===0&&!e.action){const w=e.def.moves.w;if(w.kind==='dash'&&e.cooldowns.w===0&&e.mp>=w.cost){const away=unit(e.x-threat.x||1,(e.y-threat.y)||((this.time%2)>1?1:-1));if(this.castFor(e,'w',{ai:true,direction:away})){this.aiDodgeTimer=7.5;return;}}}
    if(e.castRoot===0&&!e.basicWindup){
      const melee=e.def.basic.melee,ideal=melee?e.def.basic.range*.77:e.def.basic.range*.79;
      const toward=d>ideal+20?1:d<ideal-45?(melee?0:-.7):0;
      // Cut across the runner's path rather than endlessly orbiting its previous position.
      const intercept=unit(p.x+p.vx*.42-e.x,p.y+p.vy*.42-e.y),strafe=(Math.sin(this.time*.72)>0?1:-1)*(melee?.12:.42);
      let motion={x:intercept.x*toward-dir.y*strafe,y:intercept.y*toward+dir.x*strafe};
      if(threat){const away=unit(e.x-threat.x||.5,e.y-threat.y||1);motion.x+=away.x*.8;motion.y+=away.y*.8;}
      // Turn inward at edges; avoid remaining stuck in a corner while the player kites.
      if(e.x<175)motion.x+=.8;if(e.x>1105)motion.x-=.8;if(e.y<255)motion.y+=.7;if(e.y>530)motion.y-=.7;
      if(Math.hypot(motion.x,motion.y)>.05)this.move(e,unit(motion.x,motion.y),dt,(this.enraged?1.08:1)*(e.action&&e.action.elapsed>=e.action.attackEnd?.42:1));
    }
    if(this.aiDecision<=0&&e.castRoot===0&&e.castLock===0&&!e.basicWindup&&!e.action){
      this.aiDecision=.18;const moves=this.movesFor(e);let key=null;
      const special=this.getTrainerSkill('enemy');
      const useSpecial=e.cooldowns.s===0&&(special.kind==='haste'&&d>290||special.kind==='exhaust'&&d<special.range||special.kind==='ignite'&&d<special.range||special.kind==='barrier'&&e.hp<e.maxHp*.7||special.kind==='trainerHeal'&&e.hp<e.maxHp*.75||special.kind==='cleanse'&&(e.burn>0||e.slow>0||e.ignite));
      if(useSpecial&&this.castFor(e,'s',{ai:true})){this.aiComboTimer=.32;return;}
      if(e.cooldowns.r===0&&e.mp>=moves.r.cost&&d<650)key='r';
      else if(moves.w.kind==='boost'&&e.cooldowns.w===0&&d<470)key='w';
      else if(moves.w.kind==='guard'&&e.cooldowns.w===0&&e.hp<e.maxHp*.86&&d<480)key='w';
      else if(moves.w.kind==='dash'&&e.cooldowns.w===0&&d>(e.def.basic.melee?150:300)&&d<620)key='w';
      else if(moves.w.kind==='field'&&e.cooldowns.w===0&&d<660)key='w';
      else if(['slash','pulse'].includes(moves.w.kind)&&e.cooldowns.w===0&&d<moves.w.range+15)key='w';
      else if(e.cooldowns.e===0&&d<(['slash','pulse'].includes(moves.e.kind)?moves.e.range+15:660))key='e';
      else if(e.cooldowns.q===0&&d<(['slash','pulse'].includes(moves.q.kind)?moves.q.range+15:moves.q.kind==='dash'?340:760))key='q';
      if(key&&e.mp>=moves[key].cost){this.castFor(e,key,{ai:true});this.aiComboTimer=.32;}
    }
    if(e.castRoot===0&&this.aiComboTimer===0&&!e.action&&d<e.def.basic.range)this.tryBasic(e);
  }
  snapshot(){const actor=f=>({id:f.id,name:f.def.ko,x:Math.round(f.x),y:Math.round(f.y),hp:Math.round(f.hp),maxHp:f.maxHp,mp:Math.round(f.mp),shield:Math.round(f.shield),anim:f.anim,basicCooldown:+f.basicTimer.toFixed(2),basicRange:f.def.basic.range,basicWindup:f.basicWindup?.time||0,inBasicRange:distance(f,this.target(f.team))<=f.def.basic.range,distanceToTarget:Math.round(distance(f,this.target(f.team))),dodging:f.dash?.kind==='dodge',invulnerable:f.invul>0||!!f.dodgeGuard,dodgeProtected:!!f.dodgeGuard,actionPhase:f.action?(f.action.elapsed<f.action.windup?'telegraph':f.action.elapsed<f.action.attackEnd?'attacking':'recovery'):null,actionRemaining:f.action?+Math.max(0,f.action.duration-f.action.elapsed).toFixed(2):0,warningRemaining:f.action?+Math.max(0,f.action.windup-f.action.elapsed).toFixed(2):0,pose:f.pose?.kind||null});return {state:this.state,time:+this.time.toFixed(2),player:actor(this.player),enemy:actor(this.enemy),cooldowns:{...this.cooldowns},enemyCooldowns:{...this.enemy.cooldowns},stats:{...this.stats},projectiles:this.projectiles.length,hazards:this.hazards.length,enraged:this.enraged,autoAttack:this.autoAttack,hitStop:+this.hitStop.toFixed(3),difficulty:this.options.difficulty,teams:Object.fromEntries(['player','enemy'].map(team=>[team,this.teams[team].map((f,index)=>({...actor(f),index,active:index===this.activeIndices[team],fainted:f.hp<=0,maxMp:f.maxMp,cooldowns:{...f.cooldowns}}))])),activeIndices:{...this.activeIndices},switchCooldowns:{...this.switchCooldowns},switchReason:this.switchReason,trainerSkills:{player:this.getTrainerSkill('player').id,enemy:this.getTrainerSkill('enemy').id}};}
}
