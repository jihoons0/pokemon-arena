import {BattleCamera} from './battle-camera.js';
import {drawArena,drawSnow} from './arena.js';
import {drawFighter} from './sprites.js';
import {fighterVisualBounds} from './fighter-size.js';
import {drawTrainers} from './trainers.js';
import {PokeballPresentation} from './pokeball-presentation.js';
import {drawCinematicVfx} from './cinematic-vfx.js';
import {ELEMENTS,ROSTER_BY_ID} from './roster.js';
import {cappedCount,drawCombatVfx,drawProjectileAura,elementVfxStyle,pushCapped,vfxProfile} from './combat-vfx.js';
import {t,getLocale} from './i18n/i18n.js';

const TAU=Math.PI*2,MAX_PARTICLES=900,MAX_EFFECTS=180,MAX_NUMBERS=80,MAX_GHOSTS=36;
const TEAM_COLORS={player:'#ead06f',enemy:'#e18468',ally:'#70d5f1',rival:'#dc94d4'};
const fightersOf=b=>b.fighters||[b.player,b.enemy].filter(Boolean);
const FALLBACK={color:'#d8e4ed',dark:'#70889b'};
function circle(ctx,x,y,r){ctx.beginPath();ctx.arc(x,y,Math.max(0,r),0,TAU);}
function rand(min,max){return min+Math.random()*(max-min);}
function clamp(n,min=0,max=1){return Math.max(min,Math.min(max,n));}
function elementOf(value,fallback='normal'){return ELEMENTS[value]?value:fallback;}
function palette(element,color){const p=ELEMENTS[elementOf(element)]||FALLBACK;return {color:color||p.color,dark:p.dark};}
function teamOf(fighter,battle){return fighter?.team||(fighter===battle.player?'player':'enemy');}
function label(ctx,text,x,y,color='#e9f3f7',size=12){ctx.font=`bold ${size}px ui-monospace,monospace`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=3;ctx.strokeStyle='#152938';ctx.strokeText(String(text),Math.round(x),Math.round(y));ctx.fillStyle=color;ctx.fillText(String(text),Math.round(x),Math.round(y));}
function lineToAngle(ctx,x,y,angle,length){ctx.lineTo(x+Math.cos(angle)*length,y+Math.sin(angle)*length);}
function fighterHeight(f,sprites){return Math.max(32,-fighterVisualBounds(f,sprites).top);}
function projectileElement(p){if(ELEMENTS[p.element])return p.element;return ({bolt:'electric',fire:'fire',flame:'fire',ember:'fire',leaf:'grass',rock:'rock',water:'water',jet:'water',orb:'ghost',steel:'steel'}[p.type]||'normal');}

export class Renderer {
  constructor(canvas,sprites,battle){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.sprites=sprites;this.battle=battle;
    this.particles=[];this.effects=[];this.numbers=[];this.ghosts=[];this.ghostTimers=new Map();this.shake=0;this.flash=0;this.time=0;this.preview=null;
    this.prefersReducedMotion=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;this.motionEnabled=true;this.reducedMotion=this.prefersReducedMotion;
    this.framing=new BattleCamera();this.mobile=false;this.particleCap=MAX_PARTICLES;this.effectCap=MAX_EFFECTS;this.camera={x:0,y:0,vx:0,vy:0};this.recoils=new Map();this.feedback={impactCount:0,peakCameraImpulse:0,lastImpactPower:0};
    this.pokeballs=new PokeballPresentation();
  }
  visualFighters(){return fightersOf(this.battle).filter(f=>f.hp>0||this.pokeballs.isRecalling(f.team)).map(f=>({...f,visualBounds:fighterVisualBounds(f,this.sprites)}));}
  setTrainerPerspective(reverse=false,seat=reverse?1:0,count=2){this.pokeballs.setPerspective(reverse,seat,count);}
  setViewport(width,height,{mobile=false,insets={},dpr=1}={}){
    if(!(width>0&&height>0))return;
    const density=mobile?Math.min(2,Math.max(1,dpr),Math.sqrt(1500000/(width*height))):1;
    const w=mobile?Math.round(width*density):1280,h=mobile?Math.round(height*density):720;
    if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
    this.mobile=mobile;this.particleCap=mobile?360:MAX_PARTICLES;this.effectCap=mobile?120:MAX_EFFECTS;
    this.framing.resize(w,h,{mobile,insets:Object.fromEntries(Object.entries(insets).map(([key,value])=>[key,value*density]))});
    this.framing.update(0,this.visualFighters(),{reducedMotion:this.reducedMotion,hazards:this.battle.hazards});
  }
  setMotionEnabled(enabled){this.motionEnabled=Boolean(enabled);this.reducedMotion=this.prefersReducedMotion||!this.motionEnabled;if(this.reducedMotion){this.camera={x:0,y:0,vx:0,vy:0};this.shake=0;this.flash=0;this.recoils.clear();}return !this.reducedMotion;}
  getFeedbackDiagnostics(){return Object.freeze({impactCount:this.feedback.impactCount,cameraImpulse:Number(Math.hypot(this.camera.x,this.camera.y).toFixed(2)),peakCameraImpulse:Number(this.feedback.peakCameraImpulse.toFixed(2)),lastImpactPower:Number(this.feedback.lastImpactPower.toFixed(2)),effects:this.effects.length,particles:this.particles.length,motionEnabled:!this.reducedMotion,camera:this.framing.frame(),particleCap:this.particleCap,effectCap:this.effectCap});}
  profileForEvent(e={},fallbackKind='bolt'){
    const def=ROSTER_BY_ID[e.id]||[this.battle?.player,this.battle?.enemy].find(f=>f?.id===e.id)?.def;let key=e.key,move=key==='s'&&this.battle?.getTrainerSkill?this.battle.getTrainerSkill(e.team):key==='basic'?def?.basic:def?.moves?.[key];
    if(!move&&def?.moves){const found=Object.entries(def.moves).find(([,candidate])=>(e.name&&candidate.name===e.name)||(e.ko&&candidate.ko===e.ko)||(e.kind&&candidate.kind===e.kind&&e.damage===candidate.damage));if(found)[key,move]=found;}
    return vfxProfile({kind:e.kind||move?.kind||fallbackKind,element:e.element||move?.element||def?.type,damage:e.damage??move?.damage,ultimate:e.ultimate||key==='r',key,basic:e.basic});
  }
  addCameraImpulse(angle,power=1){if(this.reducedMotion)return;const force=clamp(power,0,10),a=Number.isFinite(angle)?angle:0;this.camera.vx+=Math.cos(a)*force*16;this.camera.vy+=Math.sin(a)*force*11;this.feedback.lastImpactPower=force;this.feedback.peakCameraImpulse=Math.max(this.feedback.peakCameraImpulse,force);}
  addRecoil(team,angle,power=3){if(this.reducedMotion||!team)return;const state=this.recoils.get(team)||{x:0,y:0,vx:0,vy:0},force=clamp(power,0,9),a=Number.isFinite(angle)?angle:0;state.vx+=Math.cos(a)*force*22;state.vy+=Math.sin(a)*force*15;this.recoils.set(team,state);}
  addEffect(effect){const life=effect.life??.5;pushCapped(this.effects,{...effect,life,maxLife:effect.maxLife??life},this.effectCap);}
  addNumber(number){this.numbers.push(number);if(this.numbers.length>MAX_NUMBERS)this.numbers.splice(0,this.numbers.length-MAX_NUMBERS);}
  burst(x,y,color,count=16,speed=150,kind='spark'){
    count=cappedCount(count,this.particles.length,this.particleCap,this.reducedMotion?.45:1);
    for(let i=0;i<count;i++){const a=rand(0,TAU),v=rand(speed*.3,speed),life=rand(.22,.72);this.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-35,life,maxLife:life,color:ELEMENTS[kind]?(i%3===0?elementVfxStyle(kind).accent:elementVfxStyle(kind).primary):color,size:Math.random()>.58?4:2,kind});}
  }
  directionalDust(x,y,angle,color,count=10,speed=130){
    count=Math.ceil(count*(this.reducedMotion?.5:1));
    for(let i=0;i<count&&this.particles.length<this.particleCap;i++){
      const spread=rand(-.55,.55),v=rand(speed*.45,speed),life=rand(.18,.42);
      this.particles.push({x:x-Math.cos(angle)*rand(3,20),y:y-Math.sin(angle)*rand(3,20)+rand(-5,5),vx:-Math.cos(angle+spread)*v,vy:-Math.sin(angle+spread)*v-rand(5,28),life,maxLife:life,color,size:Math.random()>.55?4:2,kind:'dust'});
    }
  }
  typeFeedback(e){
    if(e.periodic||e.effectiveness===1)return;
    const immune=e.type==='immune',mult=immune?0:e.effectiveness;
    if(mult===undefined)return;
    this.typeNotices||=new Map();const key=e.victimTeam+':'+mult,time=this.battle.time||0;
    if(time-(this.typeNotices.get(key)??-10)<.9)return;
    this.typeNotices.set(key,time);
    const text=t('battle.'+(immune?'immune':mult>1?'superEffective':'notEffective'))+(immune?'':' ×'+mult);
    this.addNumber({x:e.x,y:e.y-82,value:text,color:immune?'#e9cbd0':mult>1?'#d7ff9b':'#f2d3a3',life:1.05,maxLife:1.05});
  }
  event(e){
    if(!e||!e.type)return;const element=elementOf(e.element),p=palette(element,e.color),teamColor=TEAM_COLORS[e.team]||p.color;
    this.pokeballs.event(e,this.battle);
    const projectileImpact=['bolt','orb','fire','leaf','rock','water','jet','steel'].includes(e.type)||(e.type==='basic'&&!e.team);
    if(projectileImpact){this.addEffect({type:'impact',x:e.x,y:e.y,element,color:p.color,life:.36});this.burst(e.x,e.y-12,p.color,13,110,element);return;}
    if(e.type==='immune'){this.typeFeedback(e);return;}
    if(e.type==='reset'){this.typeNotices?.clear();this.framing.reset();this.particles=[];this.effects=[];this.numbers=[];this.ghosts=[];this.ghostTimers.clear();this.recoils.clear();this.camera={x:0,y:0,vx:0,vy:0};this.feedback={impactCount:0,peakCameraImpulse:0,lastImpactPower:0};this.shake=0;this.flash=0;return;}
    if(e.type==='switch'){
      this.ghosts=[];this.ghostTimers.clear();return;
    }
    if(e.type==='faint')return;
    if(e.type==='trainer'){
      this.addEffect({...e,type:'supportAura',element:({heal:'grass',barrier:'steel',cleanse:'fairy',haste:'flying',exhaust:'dark',ignite:'fire'})[e.id]||element,heal:e.id==='heal',life:1});
      const kind={haste:'enrage',exhaust:'pulse',barrier:'shield',heal:'heal',cleanse:'heal',ignite:'fieldAttack'}[e.id]||'pulse';
      this.addEffect({type:kind,x:e.targetX??e.x,y:e.targetY??e.y,r:48,color:e.color||'#a1d6b6',element:'normal',life:.7});
      this.burst(e.x,e.y-20,e.color||'#a1d6b6',9,75,'spark');return;
    }
    if(e.type==='boost'){this.addEffect({...e,type:'supportAura',element,life:.9});this.addEffect({type:'enrage',x:e.x,y:e.y,r:38,color:e.color||'#e1c376',life:.7});}
    if(e.type==='dodge'){const angle=Number.isFinite(e.angle)?e.angle:Math.atan2(e.dy||0,e.dx||1),color=e.color||'#9ee8ff';this.addEffect({type:'dodge',x:e.x,y:e.y,angle,distance:Math.hypot(e.dx||0,e.dy||0)||155,color,life:e.duration||.3});this.directionalDust(e.x,e.y,angle,color,14,165);}
    if(e.type==='evade'){const color=e.color||'#b9f2ff';this.addEffect({type:'evade',x:e.x,y:e.y,angle:e.angle||0,color,life:.3});this.addNumber({x:e.x,y:e.y-52,value:t('renderer.evade')||'회피',color,life:.62,maxLife:.62});this.burst(e.x,e.y-14,color,8,92,'evade');}
    if(e.type==='trackingBreak'){const color=e.color||'#9ee8ff',count=Math.max(1,e.count||1),text=t('renderer.trackingBreak',{count})||`유도 해제${count>1?` ×${count}`:''}`;this.addEffect({type:'trackingBreak',x:e.x,y:e.y,color,count,life:.48});this.addEffect({type:'name',x:e.x,y:e.y-58,text,color,life:.72});this.directionalDust(e.x,e.y-10,Math.PI,color,Math.min(10,4+count*2),72);}
    if(e.type==='basicWindup'){this.addEffect({type:'basicWindup',x:e.x,y:e.y,angle:e.angle||0,element,color:e.color||teamColor,life:e.duration||.18});}
    if(e.type==='basicrelease'){this.addEffect({type:'muzzle',x:e.x,y:e.y,angle:e.angle||0,color:e.color||teamColor,life:.18});this.directionalDust(e.x,e.y-12,(e.angle||0)+Math.PI,e.color||teamColor,5,65);}
    if(e.type==='cast'){
      const profile=this.profileForEvent(e),angle=Math.atan2((e.targetY??e.y)-e.y,(e.targetX??e.x)-e.x),damaging=!['guard','boost','haste','barrier','trainerHeal','cleanse','dodge'].includes(profile.kind);
      this.addEffect({type:'castCorona',x:e.x,y:e.y,element:profile.element,angle,height:fighterHeight(this.battle.source?.(e.team)||this.battle[e.team],this.sprites),power:profile.power,r:profile.ultimate?72:43,ultimate:profile.ultimate,life:profile.anticipation});
      if(e.team==='player'||!e.team){const text=(getLocale()==='ko'?e.ko:e.name)||e.name||e.ko||(e.key?String(e.key).toUpperCase():'CAST');this.addEffect({type:'name',x:e.x,y:e.y-fighterHeight(this.battle.player,this.sprites),text,color:e.color||teamColor,life:.78});}
      this.addEffect({type:'skillSigil',x:e.x,y:e.y,element:profile.element,power:profile.power,ultimate:profile.ultimate,life:profile.ultimate?.8:.55});
      this.addEffect({type:'castAnticipation',x:e.x,y:e.y,angle,element,profileKind:profile.kind,family:profile.family,color:p.color,power:profile.power,life:profile.anticipation});
      if(profile.ultimate){this.addEffect({type:'ultimateFocus',x:e.x,y:e.y,angle,element,family:profile.family,color:p.color,power:profile.power,r:82,life:.72});this.addCameraImpulse(angle+Math.PI,2.2);if(!this.reducedMotion)this.flash=Math.max(this.flash,.035);}
      if(damaging&&['bolt','fan','volley'].includes(profile.kind))this.addEffect({type:'releaseStroke',x:e.x,y:e.y,angle,element,family:profile.family,color:p.color,power:profile.power,length:54,spread:10,life:profile.release});
      this.burst(e.x,e.y-16,p.color,profile.particles,profile.ultimate?125:90,element);
    }
    if(e.type==='basic'&&e.team){
      const angle=Math.atan2((e.targetY??e.y)-e.y,(e.targetX??e.x)-e.x),profile=this.profileForEvent({...e,key:'basic',basic:true},'basic');
      this.addEffect({type:'muzzle',x:e.x,y:e.y,angle,color:e.color||p.color,element,life:.18});
      this.addEffect({type:'releaseStroke',x:e.x,y:e.y,angle,color:e.color||p.color,element,family:profile.family,power:profile.power,length:e.melee?42:58,spread:e.melee?16:8,life:.2});
      if(e.melee)this.addEffect({type:'slash',x:e.targetX??e.x,y:e.targetY??e.y,angle,r:58,color:p.color,element,life:.24});
      else this.directionalDust(e.x,e.y-10,angle+Math.PI,p.color,4,55);
    }
    if(e.type==='hit'){this.typeFeedback(e);
      const angle=Number.isFinite(e.angle)?e.angle:0,profile=vfxProfile({kind:e.basic?'basic':'bolt',element,damage:e.amount,basic:e.basic}),periodic=Boolean(e.periodic),impactPower=periodic?.42:profile.power*(e.critical?1.15:1);
      this.addNumber({x:e.x+rand(-12,12),y:e.y-48,value:`−${Math.round(e.amount)}`,color:e.color||teamColor,life:.85,maxLife:.85,critical:e.critical});
      if(!periodic&&!e.basic){
        this.addEffect({type:'impactBloom',x:e.x,y:e.y,angle,element,power:impactPower,r:e.critical?64:46,ultimate:e.critical,life:e.critical?.6:.45});
        this.addEffect({type:'cinematicImpact',x:e.x,y:e.y,angle,element,power:impactPower,r:e.critical?82:58,ultimate:e.critical,life:e.critical?.9:.7});
        this.addEffect({type:'groundAfterglow',x:e.x,y:e.y,element,power:impactPower,r:e.critical?80:52,life:1.1});
      }
      if(!periodic)this.addEffect({type:'contact',x:e.x,y:e.y-14,angle,color:e.color||p.color,critical:e.critical,life:e.critical?.3:.22});
      this.addEffect({type:'elementImpact',x:e.x,y:e.y,angle,color:e.color||p.color,element,family:profile.family,power:impactPower,r:e.critical?42:e.basic?25:34,life:periodic?.2:profile.impact});
      this.burst(e.x,e.y-16,p.color,periodic?3:e.critical?profile.particles+7:e.basic?5:profile.particles,e.critical?185:120,element);
      if(!periodic){this.feedback.impactCount++;this.addCameraImpulse(angle,profile.shake*(e.critical?1.12:1));this.addRecoil(e.victimTeam,angle,profile.recoil*(e.critical?1.08:1));this.shake=Math.max(this.shake,this.reducedMotion?0:e.critical?2.6:1.15);}
    }
    if(e.type==='impact'){const profile=vfxProfile({kind:e.projectileType||'bolt',element,damage:e.damage});this.addEffect({type:'impact',...e,element,color:p.color,life:.3});this.addEffect({type:'elementImpact',x:e.x,y:e.y,angle:e.angle||0,element,family:profile.family,color:p.color,power:.62,r:24,life:.24});this.burst(e.x,e.y-12,p.color,9,110,element);}
    if(e.type==='slash'){if(!e.basic)this.addEffect({...e,type:'slashRibbon',element,life:.42});const profile=this.profileForEvent(e,'slash');this.addEffect({...e,type:'slash',element,color:p.color,life:e.life??.38});this.addEffect({type:'releaseStroke',x:e.x,y:e.y,angle:e.angle||0,element,family:profile.family,color:p.color,power:profile.power,length:Math.min(105,e.r||70),spread:19,life:.28});this.burst(e.x+Math.cos(e.angle||0)*(e.r||60),e.y+Math.sin(e.angle||0)*(e.r||60),p.color,13,190,element);}
    if(e.type==='beam'){this.addEffect({...e,type:'beamRibbon',element,life:.55});const profile=this.profileForEvent(e,'beam');this.addEffect({...e,type:'beam',element,color:p.color,life:e.life??.45});this.addEffect({type:'releaseStroke',x:e.x,y:e.y,angle:e.angle||0,element,family:profile.family,color:p.color,power:profile.power,length:profile.ultimate?112:95,spread:(e.width||55)*.32,life:profile.release});this.addCameraImpulse((e.angle||0)+Math.PI,profile.shake*.45);this.shake=Math.max(this.shake,this.reducedMotion?0:2);}
    if(e.type==='pulse'){const profile=this.profileForEvent(e,'pulse');this.addEffect({...e,type:'pulse',element,color:p.color,life:e.life??.5});this.addEffect({type:'elementImpact',x:e.x,y:e.y,angle:e.angle||0,element,family:profile.family,color:p.color,power:profile.power*.8,r:Math.min(54,(e.r||90)*.45),life:.34});}
    if(e.type==='fieldAttack'){const profile=this.profileForEvent(e,e.kind||'bolt'),fan=e.kind==='fan';this.addEffect({...e,type:'fieldAttack',element,color:p.color,life:e.life??.65});this.addEffect({type:'releaseStroke',x:e.x,y:e.y,angle:e.angle||0,element,family:profile.family,color:p.color,power:profile.power*.72,length:fan?64:52,spread:fan?24:12,life:profile.release});}
    if(e.type==='detonate'){this.addEffect({...e,type:'impactBloom',element,power:e.ultimate?1.4:1,r:Math.min(120,e.r||70),life:.68});const profile=vfxProfile({kind:e.ultimate?'nova':'field',element,damage:e.damage,ultimate:e.ultimate});this.addEffect({...e,type:'detonate',element,color:p.color,life:e.life??.58});this.addEffect({type:'elementImpact',x:e.x,y:e.y,angle:e.angle||-Math.PI/2,element,family:profile.family,color:p.color,power:e.ultimate?1.45:1.05,r:Math.min(78,(e.r||120)*.48),life:e.ultimate?.5:.38});if(e.ultimate&&element==='electric')this.addEffect({...e,type:'lightning',element,color:p.color,life:.46});this.burst(e.x,e.y-8,p.color,e.ultimate?36:22,e.ultimate?245:180,element);this.feedback.impactCount++;this.addCameraImpulse(e.angle||-Math.PI/2,e.ultimate?8:4);this.shake=Math.max(this.shake,this.reducedMotion?0:e.ultimate?5.5:2.6);if(e.ultimate&&!this.reducedMotion)this.flash=Math.max(this.flash,.055);}
    if(e.type==='lightning'){this.addEffect({...e,type:'lightning',element:'electric',color:e.color||ELEMENTS.electric.color,life:e.life??.42});this.addEffect({type:'ring',x:e.x,y:e.y,r:e.r||145,color:e.color||ELEMENTS.electric.color,element:'electric',life:.45});this.addEffect({type:'elementImpact',x:e.x,y:e.y,angle:-Math.PI/2,element:'electric',family:'electric',color:e.color||ELEMENTS.electric.color,power:1.5,r:68,life:.46});this.burst(e.x,e.y-12,e.color||'#ead0ff',32,260,'electric');this.feedback.impactCount++;this.addCameraImpulse(-Math.PI/2,9);this.shake=Math.max(this.shake,this.reducedMotion?0:6);if(!this.reducedMotion)this.flash=Math.max(this.flash,.06);}
    if(e.type==='eruption'){this.addEffect({...e,type:'detonate',element:'fire',color:e.color||ELEMENTS.fire.color,life:e.life??.52});this.addEffect({type:'elementImpact',x:e.x,y:e.y,angle:-Math.PI/2,element:'fire',family:'fire',color:e.color||ELEMENTS.fire.color,power:1.25,r:62,life:.46});this.burst(e.x,e.y-5,e.color||'#f7a255',28,210,'fire');this.feedback.impactCount++;this.addCameraImpulse(-Math.PI/2,4.5);this.shake=Math.max(this.shake,this.reducedMotion?0:2.8);}
    if(e.type==='blink'){
      const color=e.color||'#ffe6a7',points=[e.from,e.to].filter(Boolean);for(const point of points){this.burst(point.x,point.y-12,color,24,170,'psychic');this.addEffect({type:'ring',x:point.x,y:point.y,color,element:'psychic',r:60,life:.48});}
      if(e.from&&e.to)this.addEffect({type:'blinkLine',from:e.from,to:e.to,color,life:.24});
    }
    if(e.type==='heal'){
      const color=e.color||'#9af8c5';this.addEffect({...e,type:'supportAura',element:'grass',heal:true,life:1.1});this.addEffect({type:'heal',x:e.x,y:e.y,color,life:1.25});if(e.value!=null)this.addNumber({x:e.x,y:e.y-45,value:`+${Math.round(e.value)}`,color,life:1,maxLife:1});
      const count=this.reducedMotion?10:25;for(let i=0;i<count&&this.particles.length<this.particleCap;i++){const life=rand(.4,1);this.particles.push({x:e.x+rand(-40,40),y:e.y+rand(-10,15),vx:rand(-15,15),vy:rand(-85,-30),life,maxLife:life,color,size:4,kind:'heal'});}
    }
    if(e.type==='shield'){this.addEffect({...e,type:'shield',color:e.color||'#bfe8fa',life:e.life??.75});this.addEffect({...e,type:'supportAura',element:'steel',life:.85});}
    if(e.type==='enemyCast')this.addEffect({type:'name',x:e.x,y:e.y-fighterHeight(this.battle.source?.(e.team)||this.battle.enemy,this.sprites),text:e.displayName||(getLocale()==='ko'?e.ko:e.name)||e.name||e.ko||'ATTACK',color:e.color||TEAM_COLORS.enemy,life:1.05});
    if(e.type==='ultimate'){const profile=vfxProfile({kind:e.kind||'nova',element,ultimate:true});this.addEffect({...e,type:'ultimate',element,color:p.color,r:e.r||180,life:e.life??.85});this.addEffect({type:'ultimateFocus',x:e.x,y:e.y,angle:e.angle||0,element,family:profile.family,color:p.color,power:profile.power,r:94,life:.7});if(!this.reducedMotion)this.flash=Math.max(this.flash,.03);}
    if(e.type==='flame')this.burst(e.x,e.y-30,e.color||ELEMENTS.fire.color,18,120,'fire');
    if(e.type==='interrupted')this.addEffect({type:'name',x:e.x,y:e.y-90,text:t('battle.interrupted')||(getLocale()==='ko'?'공격 중단':'INTERRUPTED'),color:e.color||'#debeff',life:1});
    if(e.type==='enrage'){const target=this.battle.source?.(e.team)||this.battle.enemy;this.addEffect({type:'enrage',x:e.x??target?.x,y:e.y??target?.y,color:e.color||'#f08962',r:e.r||55,life:e.life??1.1});}
    if(e.type==='end'){
      const loser=e.team?([this.battle.player,this.battle.enemy].find(f=>teamOf(f,this.battle)!==e.team)):(e.won?this.battle.enemy:this.battle.player);
      if(loser)this.burst(loser.x,loser.y,'#f9ece0',42,170,'normal');
    }
  }
  update(dt){
    this.framing.update(dt,this.visualFighters(),{reducedMotion:this.reducedMotion,hazards:this.battle.hazards});
    this.pokeballs.update(dt,{paused:this.battle.state==='paused'&&this.battle.player?.hp>0&&this.battle.enemy?.hp>0});
    if(this.battle.state==='paused')return;
    const hitStopped=(this.battle.hitStop||0)>0,visualDt=hitStopped?dt*.2:dt,simDt=Number.isFinite(this.battle.lastStepDt)?this.battle.lastStepDt:(hitStopped?0:dt);
    this.time+=visualDt;this.shake=Math.max(0,this.shake-visualDt*34);this.flash=Math.max(0,this.flash-visualDt);
    if(!this.reducedMotion){const spring=115,damping=20;this.camera.vx+=(-this.camera.x*spring-this.camera.vx*damping)*visualDt;this.camera.vy+=(-this.camera.y*spring-this.camera.vy*damping)*visualDt;this.camera.x=clamp(this.camera.x+this.camera.vx*visualDt,-12,12);this.camera.y=clamp(this.camera.y+this.camera.vy*visualDt,-8,8);}
    for(const [team,state] of this.recoils){const spring=150,damping=23;state.vx+=(-state.x*spring-state.vx*damping)*visualDt;state.vy+=(-state.y*spring-state.vy*damping)*visualDt;state.x=clamp(state.x+state.vx*visualDt,-13,13);state.y=clamp(state.y+state.vy*visualDt,-9,9);if(Math.hypot(state.x,state.y,state.vx*.02,state.vy*.02)<.08)this.recoils.delete(team);}
    for(const p of this.particles){p.life-=visualDt;p.x+=p.vx*visualDt;p.y+=p.vy*visualDt;p.vy+=(p.kind==='heal'?-5:95)*visualDt;p.vx*=Math.max(0,1-visualDt*2);}
    this.particles=this.particles.filter(p=>p.life>0).slice(-this.particleCap);
    for(const list of [this.effects,this.numbers,this.ghosts])for(const item of list)item.life-=visualDt;
    this.effects=this.effects.filter(e=>e.life>0).slice(-this.effectCap);this.numbers=this.numbers.filter(e=>e.life>0).slice(-MAX_NUMBERS);this.ghosts=this.ghosts.filter(e=>e.life>0).slice(-MAX_GHOSTS);
    for(const f of fightersOf(this.battle)){
      const key=`${teamOf(f,this.battle)}:${f.id}`;
      if(f.dash&&f.hp>0&&simDt>0){
        const dodge=f.dash.kind==='dodge',interval=dodge?.035:.055,elapsed=(this.ghostTimers.get(key)??interval)+simDt;
        if(elapsed>=interval){this.ghostTimers.set(key,elapsed%interval);this.ghosts.push({...f,life:dodge?.2:.14,maxLife:dodge?.2:.14,ghostKind:dodge?'dodge':'dash'});if(this.ghosts.length>MAX_GHOSTS)this.ghosts.shift();if(!dodge){const angle=Math.atan2(f.dash.dy||0,f.dash.dx||1),dashElement=elementOf(f.dash.element||f.def?.type),colors=palette(dashElement,f.dash.color),profile=vfxProfile({kind:'dash',element:dashElement,damage:f.dash.damage});this.addEffect({type:'dashTrail',x:f.x,y:f.y,angle,element:dashElement,family:profile.family,color:colors.color,power:profile.power,length:58+profile.power*18,width:(f.radius||22)*.65,life:.2});this.directionalDust(f.x,f.y,angle,colors.color,3,65);}}
        else this.ghostTimers.set(key,elapsed);
      }else{
        this.ghostTimers.delete(key);
        if(f.moving&&simDt>0&&Math.random()<.3&&this.particles.length<this.particleCap)this.particles.push({x:f.x,y:f.y+4,vx:rand(-12,12),vy:rand(-15,0),life:.25,maxLife:.25,color:'#f1f4eb',size:3,kind:'snow'});
      }
      if(f.burn>0&&simDt>0&&Math.random()<.12)this.burst(f.x,f.y-8,ELEMENTS.fire.color,1,35,'fire');
    }
  }
  draw(){
    const c=this.ctx,b=this.battle,t=this.time;if(!c||!b)return;const frame=this.framing.frame();c.save();c.clearRect(0,0,frame.width,frame.height);c.imageSmoothingEnabled=false;c.save();c.translate(frame.offsetX,frame.offsetY);c.scale(frame.scale,frame.scale);
    if(!this.reducedMotion)c.translate(Math.round(this.camera.x+rand(-this.shake,this.shake)),Math.round(this.camera.y+rand(-this.shake*.7,this.shake*.7)));
    drawArena(c,t*1000,{preserveTransform:true,bounds:frame.world});drawTrainers(c,t,{teamSize:b.options.teamSize,activeTeams:[...this.pokeballs.transitions.keys()].map(team=>this.pokeballs.trainerSides[team]),reducedMotion:this.reducedMotion});this.drawGroundMarkers();
    for(const h of b.hazards||[])this.drawHazard(h);for(const w of b.windups||[])this.drawWindup(w);
    for(const e of this.effects)if(['ring','heal','pulse','fieldAttack','impact','detonate','ultimate','blinkLine','enrage','basicWindup','dodge','castAnticipation','releaseStroke','dashTrail','ultimateFocus','skillSigil','groundAfterglow'].includes(e.type))this.drawEffect(e);
    for(const ghost of this.ghosts)drawFighter(c,this.sprites,ghost,{alpha:ghost.life/ghost.maxLife*(ghost.ghostKind==='dodge'?.24:.18),ghost:true,worldScale:true});
    for(const f of fightersOf(b).sort((a,d)=>a.y-d.y)){
      const appearance=this.pokeballs.appearance(f);if(appearance.hidden)continue;
      const recoil=this.recoils.get(teamOf(f,b));c.save();if(recoil)c.translate(Math.round(recoil.x),Math.round(recoil.y));drawFighter(c,this.sprites,f,{worldScale:true,...appearance});this.drawFighterStatus(f);c.restore();
    }
    this.pokeballs.draw(c,this.sprites,{reducedMotion:this.reducedMotion});
    for(const p of b.projectiles||[])this.drawProjectile(p);
    for(const e of this.effects)if(['slash','beam','lightning','shield','contact','muzzle','evade','trackingBreak','elementImpact','impactBloom','supportAura','beamRibbon','slashRibbon','cinematicImpact','castCorona'].includes(e.type))this.drawEffect(e);
    for(const p of this.particles){c.save();c.globalAlpha=Math.min(1,p.life/p.maxLife*2);c.fillStyle=p.color;if(p.kind==='water'){c.beginPath();c.ellipse(p.x,p.y,p.size*1.4,p.size*.55,Math.atan2(p.vy,p.vx),0,TAU);c.fill();}else if(p.kind==='fire'){c.translate(p.x,p.y);c.rotate(Math.atan2(p.vy,p.vx));c.beginPath();c.moveTo(p.size*1.8,0);c.lineTo(-p.size,p.size*.65);c.lineTo(-p.size,-p.size*.65);c.closePath();c.fill();}else if(p.kind==='electric'){c.strokeStyle=p.color;c.lineWidth=Math.max(1,p.size*.55);c.beginPath();c.moveTo(p.x-p.size*2,p.y-p.size);c.lineTo(p.x,p.y+p.size);c.lineTo(p.x+p.size*2,p.y-p.size*.4);c.stroke();}else if(p.kind==='ice'){c.translate(p.x,p.y);c.rotate(Math.atan2(p.vy,p.vx));c.beginPath();c.moveTo(p.size*1.7,0);c.lineTo(0,p.size*.7);c.lineTo(-p.size*1.2,0);c.lineTo(0,-p.size*.7);c.closePath();c.fill();}else if(p.kind==='psychic'||p.kind==='ghost'){c.strokeStyle=p.color;c.lineWidth=1.5;circle(c,p.x,p.y,p.size*(1.1+p.life/p.maxLife));c.stroke();}else{c.fillRect(Math.round(p.x/2)*2,Math.round(p.y/2)*2,p.size,p.size);}c.restore();}
    drawSnow(c,t*1000,{preserveTransform:true});
    for(const e of this.effects)if(e.type==='name')this.drawEffect(e);
    for(const n of this.numbers){const progress=1-n.life/n.maxLife;c.save();c.globalAlpha=Math.min(1,n.life*3);label(c,n.value,n.x,n.y-progress*38,n.color,n.critical?24:18);c.restore();}
    for(const enemy of fightersOf(b))if(enemy.hp>0&&enemy.action&&b.state==='playing'&&!(enemy.stun>0))this.drawEnemyAction(enemy,fighterHeight(enemy,this.sprites));
    c.restore();
    if(b.state==='countdown'){const text=b.options.mode==='pvp'?String(Math.max(1,Math.ceil(b.countdown))):b.countdown>1.5?'3':b.countdown>.7?'2':'1',a=frame.area,x=a.x+a.width/2,y=a.y+a.height/2,size=this.mobile?Math.min(frame.width/8,72):54;c.save();c.fillStyle='#182d4688';circle(c,x,y,size*.9);c.fill();label(c,text,x,y,'#fff4cd',size);c.restore();}
    if(this.flash>0&&!this.reducedMotion){c.fillStyle=`rgba(236,225,255,${Math.min(.22,this.flash*1.8)})`;c.fillRect(0,0,frame.width,frame.height);}c.restore();
  }

  drawFighterStatus(f){
    if(f.blinkStrike?.hidden)return;
    const c=this.ctx,b=this.battle,height=fighterHeight(f,this.sprites),team=teamOf(f,b),color=TEAM_COLORS[team]||'#d8e4ed';
    if(f.stun>0){c.save();c.strokeStyle='#e6caff';c.lineWidth=2;c.beginPath();c.ellipse(f.x,f.y-height,20,5,this.time*5,0,TAU);c.stroke();for(let i=0;i<3;i++){const a=this.time*4+i*TAU/3;c.fillStyle='#f3dcff';circle(c,f.x+Math.cos(a)*18,f.y-height+Math.sin(a)*5,2);c.fill();}c.restore();}
    if(f.shield>0){c.save();c.globalAlpha=.3+.08*Math.sin(this.time*7);c.strokeStyle=f.shieldColor||'#bfe8fa';c.lineWidth=3;circle(c,f.x,f.y-12,(f.radius||24)+13);c.stroke();c.restore();}
    const dodgeInvul=!!f.dodgeGuard;if(dodgeInvul){const r=(f.radius||24)+9;c.save();c.strokeStyle='#b9f3ff';c.globalAlpha=.42+.12*Math.sin(this.time*28);c.lineWidth=1.5;c.beginPath();c.ellipse(f.x,f.y-8,r,r*.72,0,-.8,1.05);c.stroke();c.beginPath();c.ellipse(f.x,f.y-8,r+3,(r+3)*.72,0,Math.PI-.8,Math.PI+1.05);c.stroke();c.restore();}
    const enraged=f.enraged||f.enrage>0||(team==='enemy'&&b.enraged);if(enraged&&f.hp>0){c.save();c.strokeStyle=f.enrageColor||'#e38258';c.globalAlpha=.28+Math.sin(this.time*7)*.08;c.lineWidth=3;c.beginPath();c.ellipse(f.x,f.y+2,(f.radius||24)+17,((f.radius||24)+17)*.58,0,0,TAU);c.stroke();c.restore();}
    if(f.slow>0){c.save();c.strokeStyle='#9edcf3aa';c.setLineDash([3,6]);c.beginPath();c.ellipse(f.x,f.y+4,(f.radius||24)+10,8,0,0,TAU);c.stroke();c.restore();}
    if(b.options.teamSize===2&&f.hp>0){
      const name=b.options.controllers?.[team]?.name||f.def.displayName,selected=f===b.enemy;
      c.save();const y=f.y-height-20;c.fillStyle='#102535df';c.fillRect(f.x-40,y-10,80,16);label(c,(team==='player'?'▼ ':selected?'◎ ':'')+name,f.x,y-2,color,10);
      c.fillStyle='#273f4f';c.fillRect(f.x-30,y+8,60,4);c.fillStyle=color;c.fillRect(f.x-30,y+8,60*Math.max(0,f.hp/f.maxHp),4);c.restore();
    }
    if(f.hp>0&&team==='player'){c.save();c.fillStyle=color;c.strokeStyle='#4f5960';c.lineWidth=1;c.beginPath();c.moveTo(f.x-5,f.y-height-12);c.lineTo(f.x+5,f.y-height-12);c.lineTo(f.x,f.y-height-6);c.closePath();c.fill();c.stroke();c.restore();}
  }
  drawEnemyAction(f,height){
    const c=this.ctx,a=f.action,elapsed=Math.max(0,a.elapsed||0),windup=Math.max(0,a.windup||0),attackEnd=Math.max(windup,a.attackEnd??windup),duration=Math.max(attackEnd,a.duration??attackEnd),barW=52,barH=4,x=Math.round(f.x-barW/2),y=Math.round(f.y-height-27);
    let phase='attack',remaining=Math.max(0,attackEnd-elapsed),ratio=1,color='#efb071',text=t('renderer.attack')||'공격';
    if(elapsed<windup){phase='windup';remaining=windup-elapsed;ratio=windup?clamp(elapsed/windup):1;color='#f0b36f';text=t('battle.phaseWindup',{sec:remaining.toFixed(1)})||`예고 ${remaining.toFixed(1)}`;}
    else if(elapsed>=attackEnd){phase='recovery';remaining=Math.max(0,duration-elapsed);ratio=duration>attackEnd?clamp(remaining/(duration-attackEnd)):0;color='#8ed7a6';text=(t('battle.phaseRecovery')||'반격')+' '+remaining.toFixed(1);}
    c.save();c.font='bold 8px ui-monospace,monospace';c.textAlign='center';c.textBaseline='bottom';c.lineWidth=2;c.strokeStyle='#102231';c.strokeText(text,Math.round(f.x),y-3);c.fillStyle=color;c.fillText(text,Math.round(f.x),y-3);c.fillStyle='#10202dcc';c.fillRect(x,y,barW,barH);c.fillStyle=color;c.globalAlpha=phase==='attack'?.7+.2*Math.sin(this.time*16):.86;c.fillRect(x,y,Math.max(2,barW*ratio),barH);c.globalAlpha=.8;c.strokeStyle='#dce7eb55';c.lineWidth=1;c.strokeRect(x+.5,y+.5,barW-1,barH-1);c.restore();
  }
  drawGroundMarkers(){
    const c=this.ctx,b=this.battle;this.drawPreview();
    for(const f of fightersOf(b)){if(f.hp<=0)continue;const color=TEAM_COLORS[teamOf(f,b)]||'#b5c7d4';c.save();c.globalAlpha=.62;c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.ellipse(f.x,f.y+5,(f.radius||22)+8,((f.radius||22)+8)*.42,0,0,TAU);c.stroke();c.globalAlpha=.11;c.fillStyle=color;c.fill();c.restore();}
  }
  drawPreview(){
    const c=this.ctx,b=this.battle,key=this.preview,p=b.player;if(!key||!p||p.hp<=0||b.state!=='playing')return;
    const move=key==='basic'?p.def?.basic:(b.moves?.[key]||p.def?.moves?.[key]);if(!move)return;
    const element=move.element||p.def?.type||'normal',colors=palette(element,move.color),enemy=b.enemy;
    const angle=enemy?.hp>0?Math.atan2(enemy.y-p.y,enemy.x-p.x):(Number.isFinite(p.facing)?p.facing:0);
    const range=move.range||move.distance||move.radius||p.def?.basic?.range||180,kind=key==='basic'?'basic':move.kind;
    c.save();c.globalAlpha=key==='basic'?.25:.34;c.strokeStyle=colors.color;c.fillStyle=colors.color;c.lineWidth=2;c.setLineDash([7,8]);
    if(['basic','slash','pulse','guard','boost','barrier','haste','trainerHeal','cleanse','exhaust','ignite'].includes(kind)){circle(c,p.x,p.y,range);c.stroke();c.globalAlpha*=.18;c.fill();}
    else if(['field','storm','nova'].includes(kind)){c.beginPath();c.ellipse(p.x,p.y,range,range*.7,0,0,TAU);c.stroke();c.globalAlpha*=.18;c.fill();}
    else if(kind==='fan'){const spread=(move.spread||.14)*Math.max(2,(move.count||5)-1)/2+.12;c.beginPath();c.moveTo(p.x,p.y);c.arc(p.x,p.y,move.range||360,angle-spread,angle+spread);c.closePath();c.stroke();c.globalAlpha*=.18;c.fill();}
    else if(kind==='dash'||kind==='blink'||kind==='blinkStrike'){const length=move.distance||range,half=(p.radius||22)+7,dx=Math.sin(angle)*half,dy=-Math.cos(angle)*half;c.beginPath();c.moveTo(p.x+dx,p.y+dy);c.lineTo(p.x+Math.cos(angle)*length+dx,p.y+Math.sin(angle)*length+dy);c.lineTo(p.x+Math.cos(angle)*length-dx,p.y+Math.sin(angle)*length-dy);c.lineTo(p.x-dx,p.y-dy);c.closePath();c.stroke();c.globalAlpha*=.14;c.fill();}
    else if(kind==='beam'){const half=(move.width||70)/2,dx=Math.sin(angle)*half,dy=-Math.cos(angle)*half;c.beginPath();c.moveTo(p.x+dx,p.y+dy);c.lineTo(p.x+Math.cos(angle)*range+dx,p.y+Math.sin(angle)*range+dy);c.lineTo(p.x+Math.cos(angle)*range-dx,p.y+Math.sin(angle)*range-dy);c.lineTo(p.x-dx,p.y-dy);c.closePath();c.stroke();c.globalAlpha*=.12;c.fill();}
    else{circle(c,p.x,p.y,range);c.stroke();c.beginPath();c.moveTo(p.x,p.y);lineToAngle(c,p.x,p.y,angle,range);c.stroke();}
    c.restore();
  }
  drawHazard(h){
    const legacyElement={thunder:'electric',eruption:'fire'}[h.type],element=elementOf(h.element,legacyElement||(h.type==='storm'?'electric':h.type==='field'?'fire':'normal')),c=this.ctx,p=palette(element,h.color),progress=h.delay>0?clamp(1-h.delay/Math.max(.001,h.initialDelay||h.delay)):1,active=h.delay<=0,warningColor=['enemy','rival'].includes(h.team)?'#f0a15d':p.color;
    c.save();c.translate(h.x,h.y);c.scale(1,.7);c.globalAlpha=active?clamp((h.life??1)/(h.maxLife||1))*.58:.85;c.fillStyle=active?p.color:warningColor;c.strokeStyle=active?p.dark:warningColor;c.lineWidth=2;
    circle(c,0,0,h.r);c.globalAlpha*=active?.18:.12;c.fill();c.globalAlpha=active?.62:.85;c.setLineDash(active?[]:[7,6]);circle(c,0,0,h.r);c.stroke();c.setLineDash([]);
    if(!active){c.lineWidth=4;c.strokeStyle=warningColor;c.fillStyle=warningColor;c.beginPath();c.arc(0,0,h.r,-Math.PI/2,-Math.PI/2+TAU*progress);c.stroke();c.globalAlpha=.14+.18*progress;circle(c,0,0,h.r*progress);c.fill();}
    this.drawElementGround(element,h.r,progress,active);c.restore();
  }
  drawElementGround(element,r,progress,active){
    const c=this.ctx,t=this.time;if(element==='electric'){c.strokeStyle='#fff2a4';c.lineWidth=3;c.beginPath();c.moveTo(-r*.25,-r*.55);c.lineTo(-r*.05,-r*.12);c.lineTo(-r*.2,-r*.12);c.lineTo(r*.2,r*.52);c.lineTo(r*.06,r*.08);c.lineTo(r*.25,r*.08);c.stroke();}
    if(element==='fire'){c.fillStyle='#a7462c55';for(let i=0;i<5;i++){const a=i*1.9+t*.25,rr=r*(.25+(i%3)*.18);circle(c,Math.cos(a)*rr,Math.sin(a)*rr,7+(i%2)*5);c.fill();}}
    if(element==='water'){c.strokeStyle='#d6f7ff99';for(let i=1;i<=3;i++){c.lineWidth=2;circle(c,0,0,r*(.2+i*.2)*(active?1:.5+progress*.5));c.stroke();}}
    if(element==='grass'){c.strokeStyle='#d9f4b0aa';c.lineWidth=3;for(let i=0;i<5;i++){const a=i*TAU/5+t*.12;c.beginPath();c.moveTo(0,0);c.quadraticCurveTo(Math.cos(a+.5)*r*.45,Math.sin(a+.5)*r*.45,Math.cos(a)*r*.72,Math.sin(a)*r*.72);c.stroke();}}
    if(element==='ghost'){c.fillStyle='#e2c8ff55';for(let i=0;i<5;i++){const a=t*.5+i*1.4,rr=r*(.25+(i%2)*.27);circle(c,Math.cos(a)*rr,Math.sin(a)*rr,7+i%3*3);c.fill();}}
    if(element==='psychic'){c.strokeStyle='#ffd0edaa';for(let i=0;i<3;i++){c.lineWidth=2;circle(c,0,0,r*(.3+i*.22));c.stroke();}}
    if(element==='dragon'){c.strokeStyle='#ddd9ff99';c.lineWidth=3;for(let i=0;i<6;i++){const a=i*TAU/6+t*.2;c.beginPath();c.moveTo(Math.cos(a)*r*.2,Math.sin(a)*r*.2);lineToAngle(c,0,0,a,r*.82);c.stroke();}}
    if(element==='steel'){c.strokeStyle='#effaffaa';c.lineWidth=3;c.beginPath();c.moveTo(-r*.65,-r*.35);c.lineTo(r*.65,r*.35);c.moveTo(-r*.55,r*.45);c.lineTo(r*.55,-r*.45);c.stroke();}
    if(element==='rock'){c.fillStyle='#675d4f77';for(let i=0;i<6;i++){const a=i*TAU/6+.4,rr=r*.62;circle(c,Math.cos(a)*rr,Math.sin(a)*rr,5+i%3*3);c.fill();}}
  }
  drawWindup(w){
    const c=this.ctx,element=elementOf(w.element),p=palette(element,w.color||TEAM_COLORS[w.team]),warningColor=['enemy','rival'].includes(w.team)?'#f0a15d':p.color,progress=clamp(1-w.life/Math.max(.001,w.maxLife||w.life||1)),targetX=w.targetX??w.endX,targetY=w.targetY??w.endY,angle=Number.isFinite(w.angle)?w.angle:Math.atan2((targetY??w.y)-(w.y||0),(targetX??w.x)-(w.x||0)),length=w.length||Math.hypot((targetX??w.x)-w.x,(targetY??w.y)-w.y)||160;
    c.save();c.fillStyle=warningColor;c.strokeStyle=warningColor;c.globalAlpha=.12+progress*.16;c.lineWidth=2;c.setLineDash([8,6]);
    if(w.type==='aim'&&!w.melee){
      const endX=targetX??w.x+Math.cos(angle)*length,endY=targetY??w.y+Math.sin(angle)*length,near=8,far=15,dx=Math.sin(angle),dy=-Math.cos(angle);
      c.setLineDash([]);c.globalAlpha=.1+progress*.12;c.beginPath();c.moveTo(w.x+dx*near,w.y+dy*near);c.lineTo(endX+dx*far,endY+dy*far);c.lineTo(endX-dx*far,endY-dy*far);c.lineTo(w.x-dx*near,w.y-dy*near);c.closePath();c.fill();
      c.globalAlpha=.48+progress*.34;c.lineWidth=2;c.setLineDash([8,6]);c.beginPath();c.moveTo(w.x,w.y);c.lineTo(endX,endY);c.stroke();c.setLineDash([]);circle(c,endX,endY,12+progress*5);c.stroke();c.beginPath();c.moveTo(endX-22,endY);c.lineTo(endX-7,endY);c.moveTo(endX+7,endY);c.lineTo(endX+22,endY);c.moveTo(endX,endY-22);c.lineTo(endX,endY-7);c.moveTo(endX,endY+7);c.lineTo(endX,endY+22);c.stroke();
    }
    else if(w.type==='melee'||(w.type==='aim'&&w.melee)){
      const r=w.radius||w.range||length||70;c.setLineDash([7,5]);c.globalAlpha=.18+progress*.18;circle(c,w.x,w.y,r);c.fill();c.globalAlpha=.62+progress*.25;c.lineWidth=2;circle(c,w.x,w.y,r);c.stroke();c.setLineDash([]);c.lineWidth=4;c.beginPath();c.arc(w.x,w.y,r,-Math.PI/2,-Math.PI/2+TAU*progress);c.stroke();
    }
    else if(w.type==='charge'){c.setLineDash([]);c.globalAlpha=.25+.2*progress;c.lineWidth=3;circle(c,w.x,w.y,18+progress*34);c.stroke();circle(c,w.x,w.y,8+progress*12);c.fill();}
    else if(w.type==='cone'){const width=w.width??.45;c.beginPath();c.moveTo(w.x,w.y);c.arc(w.x,w.y,length,angle-width,angle+width);c.closePath();c.fill();c.globalAlpha=.72;c.stroke();}
    else{const half=w.type==='beam'?(w.width||60)/2:(w.width||32),endX=w.endX??w.x+Math.cos(angle)*length,endY=w.endY??w.y+Math.sin(angle)*length,dx=Math.sin(angle)*half,dy=-Math.cos(angle)*half;c.beginPath();c.moveTo(w.x+dx,w.y+dy);c.lineTo(endX+dx,endY+dy);c.lineTo(endX-dx,endY-dy);c.lineTo(w.x-dx,w.y-dy);c.closePath();c.fill();c.globalAlpha=.72;c.stroke();}
    c.restore();
  }
  drawProjectile(p){
    const c=this.ctx,element=projectileElement(p),colors=palette(element,p.color),dx=Number.isFinite(p.vx)?p.vx:Number.isFinite(p.px)?p.x-p.px:1,dy=Number.isFinite(p.vy)?p.vy:Number.isFinite(p.py)?p.y-p.py:0,angle=Math.atan2(dy,dx),r=p.radius||9,t=this.time,projectileAlpha=p.trackingBroken?.55:1;
    drawProjectileAura(c,{...p,element},{time:t,reducedMotion:this.reducedMotion});
    c.save();c.globalAlpha=projectileAlpha;c.translate(p.x,p.y-12);c.rotate(angle);c.shadowColor=colors.color;c.shadowBlur=this.reducedMotion?4:12;c.lineCap='round';
    if(p.type==='vomit'){c.shadowBlur=0;c.fillStyle=colors.color;c.strokeStyle='#657237';c.lineWidth=2;c.beginPath();c.ellipse(0,0,r*1.35,r*.65,0,0,TAU);c.fill();c.stroke();for(let i=0;i<3;i++){circle(c,-r*(1.6+i*.7),Math.sin(t*8+i)*r*.45,r*(.35-i*.07));c.fill();}}
    else if(element==='electric'){c.strokeStyle=colors.dark;c.lineWidth=r*.8;c.beginPath();c.moveTo(-r*3,0);c.lineTo(-r*2,-r*.7);c.lineTo(-r*.9,r*.45);c.lineTo(0,-r*.35);c.lineTo(r*.9,0);c.stroke();c.strokeStyle='#fff8c6';c.lineWidth=Math.max(2,r*.28);c.stroke();}
    else if(element==='fire'){c.fillStyle=colors.dark;c.beginPath();c.moveTo(-r*3,0);c.lineTo(-r*1.4,-r);c.lineTo(r,-r*.7);c.lineTo(r*1.45,0);c.lineTo(r,r*.7);c.lineTo(-r*1.4,r);c.closePath();c.fill();c.fillStyle='#ffe0a0';circle(c,r*.35,0,r*.55);c.fill();}
    else if(element==='water'){c.fillStyle=colors.color;c.beginPath();c.moveTo(-r*3,-r*.45);c.quadraticCurveTo(-r, -r*1.1,r*1.3,0);c.quadraticCurveTo(-r,r*1.1,-r*3,r*.45);c.closePath();c.fill();c.strokeStyle='#e8fbff';c.lineWidth=2;c.beginPath();c.moveTo(-r*2.4,0);c.lineTo(r*.7,0);c.stroke();}
    else if(element==='grass'){c.fillStyle=colors.color;c.strokeStyle=colors.dark;c.lineWidth=2;c.beginPath();c.moveTo(-r*1.4,0);c.quadraticCurveTo(0,-r*1.45,r*1.5,0);c.quadraticCurveTo(0,r*1.45,-r*1.4,0);c.fill();c.stroke();c.beginPath();c.moveTo(-r,0);c.lineTo(r,0);c.stroke();}
    else if(element==='ghost'){c.globalAlpha=projectileAlpha*.82;c.fillStyle=colors.dark;circle(c,0,0,r*1.25);c.fill();c.fillStyle=colors.color;circle(c,r*.1,-r*.1,r*.78);c.fill();for(let i=0;i<3;i++){c.globalAlpha=projectileAlpha*.28;c.fillStyle=colors.color;circle(c,-r*(1.5+i*.65),Math.sin(t*6+i)*r*.45,r*(.65-i*.12));c.fill();}}
    else if(element==='psychic'){c.fillStyle=colors.color;circle(c,0,0,r*.72);c.fill();c.strokeStyle='#ffe8fa';c.lineWidth=2;for(let i=1;i<=2;i++){c.beginPath();c.ellipse(0,0,r*(.75+i*.48),r*(.35+i*.2),t*2+i,0,TAU);c.stroke();}}
    else if(element==='dragon'){c.fillStyle=colors.color;c.beginPath();c.moveTo(r*1.5,0);c.lineTo(0,-r);c.lineTo(-r*2,0);c.lineTo(0,r);c.closePath();c.fill();c.fillStyle='#f4efff';circle(c,r*.35,0,r*.38);c.fill();}
    else if(element==='steel'){c.strokeStyle='#f4fbff';c.lineWidth=Math.max(3,r*.55);c.beginPath();c.moveTo(-r*2,-r*.65);c.lineTo(r*1.5,r*.45);c.stroke();c.strokeStyle=colors.dark;c.lineWidth=2;c.beginPath();c.moveTo(-r*1.4,r*.65);c.lineTo(r*1.1,-r*.4);c.stroke();}
    else if(element==='rock'){c.fillStyle=colors.dark;c.strokeStyle=colors.color;c.lineWidth=2;c.beginPath();for(let i=0;i<7;i++){const a=i*TAU/7,rr=r*(i%2?1.15:.82);const x=Math.cos(a)*rr,y=Math.sin(a)*rr;i?c.lineTo(x,y):c.moveTo(x,y);}c.closePath();c.fill();c.stroke();}
    else{c.fillStyle=colors.color;circle(c,0,0,r);c.fill();c.fillStyle='#fff';circle(c,r*.25,-r*.25,r*.32);c.fill();}
    c.restore();
  }
  drawEffect(e){
    const c=this.ctx;if(drawCinematicVfx(c,e,{time:this.time,reducedMotion:this.reducedMotion,mobile:this.mobile})||drawCombatVfx(c,e,{time:this.time,reducedMotion:this.reducedMotion}))return;
    const progress=clamp(1-e.life/e.maxLife),fade=clamp(e.life*5),element=elementOf(e.element),p=palette(element,e.color);c.save();c.globalAlpha=fade;
    if(e.type==='ring'){c.translate(e.x,e.y);c.scale(1,.58);c.strokeStyle=p.color;c.lineWidth=4*(1-progress)+1;circle(c,0,0,(e.r||60)*progress);c.stroke();}
    if(e.type==='basicWindup'){
      const angle=e.angle||0,pull=8+progress*13;c.translate(e.x,e.y-14);c.rotate(angle);c.strokeStyle=p.color;c.fillStyle=p.color;c.globalAlpha=fade*(.22+progress*.32);c.lineWidth=2;c.beginPath();c.arc(0,0,pull,-.65,.65);c.stroke();c.beginPath();c.moveTo(2,0);c.lineTo(18+progress*13,0);c.stroke();c.globalAlpha=fade*(.12+progress*.16);circle(c,0,0,5+progress*8);c.fill();
    }
    if(e.type==='dodge'){
      const angle=e.angle||0,length=Math.min(155,e.distance||155);c.translate(e.x,e.y-8);c.rotate(angle);c.strokeStyle=e.color||'#9ee8ff';c.lineCap='round';for(let i=0;i<4;i++){const y=(i-1.5)*7,lead=16+i*9;c.globalAlpha=fade*(.42-i*.06);c.lineWidth=Math.max(1,4-i*.7);c.beginPath();c.moveTo(-lead,y);c.lineTo(-Math.min(length,48+progress*length),y*.55);c.stroke();}c.globalAlpha=fade*.3;c.lineWidth=2;c.beginPath();c.arc(0,8,20+progress*20,.2,2.8);c.stroke();
    }
    if(e.type==='muzzle'){
      const angle=e.angle||0,r=10+progress*18;c.translate(e.x,e.y-15);c.rotate(angle);c.strokeStyle='#f8fdff';c.fillStyle=p.color;c.lineWidth=2;c.globalAlpha=fade*(1-progress*.35);c.beginPath();c.moveTo(5,0);c.lineTo(22+progress*18,-8*(1-progress));c.lineTo(16+progress*11,0);c.lineTo(22+progress*18,8*(1-progress));c.closePath();c.fill();c.stroke();c.globalAlpha=fade*.65;circle(c,4,0,r);c.stroke();
    }
    if(e.type==='contact'){
      const angle=e.angle||0,r=(e.critical?27:20)*(1-progress*.22);c.translate(e.x,e.y);c.rotate(angle);c.strokeStyle=e.color||p.color;c.fillStyle='#fffdf0';c.lineJoin='miter';c.lineWidth=e.critical?4:3;c.globalAlpha=fade;c.beginPath();for(let i=0;i<16;i++){const a=i*TAU/16,rr=i%2===0?r:r*.26;i?c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):c.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);}c.closePath();c.fill();c.stroke();c.globalAlpha=fade*.7;c.scale(1,.52);c.lineWidth=2;c.beginPath();c.arc(0,0,(e.critical?54:40)*(.45+progress*.75),-.72,.72);c.stroke();
    }
    if(e.type==='evade'){
      c.translate(e.x,e.y-15);c.rotate(e.angle||0);c.strokeStyle=e.color||'#b9f2ff';c.lineCap='round';for(let i=0;i<3;i++){c.globalAlpha=fade*(.75-i*.18);c.lineWidth=3-i*.6;c.beginPath();c.moveTo(-18-i*7,-10+i*9);c.lineTo(17+i*5,-2+i*3);c.stroke();}c.globalAlpha=fade*.65;c.lineWidth=1.5;circle(c,0,0,14+progress*18);c.stroke();
    }
    if(e.type==='trackingBreak'){
      c.translate(e.x,e.y-12);c.strokeStyle=e.color||'#9ee8ff';c.lineCap='round';c.lineWidth=2;for(let i=0;i<5;i++){const a=i*TAU/5+progress*.7,r1=12+progress*7,r2=22+progress*20;c.globalAlpha=fade*(.6-i*.06);c.beginPath();c.moveTo(Math.cos(a)*r1,Math.sin(a)*r1*.65);c.lineTo(Math.cos(a)*r2,Math.sin(a)*r2*.65);c.stroke();}c.globalAlpha=fade*.3;c.setLineDash([3,5]);circle(c,0,0,18+progress*24);c.stroke();
    }
    if(e.type==='impact'){c.translate(e.x,e.y);c.scale(1,.7);c.strokeStyle=p.color;c.lineWidth=4*(1-progress)+1;circle(c,0,0,(e.r||42)*(.25+progress));c.stroke();this.drawElementGround(element,e.r||35,progress,true);}
    if(e.type==='slash'){c.translate(e.x,e.y-10);c.rotate(e.angle||0);c.scale(1,.85);const r=e.r||110;c.strokeStyle=p.color;c.lineWidth=10*(1-progress)+2;c.shadowColor=p.color;c.shadowBlur=this.reducedMotion?3:10;c.beginPath();c.arc(0,0,r,-1.45+progress*.75,1.45+progress*.45);c.stroke();c.strokeStyle='#f3fbff';c.lineWidth=2;c.beginPath();c.arc(0,0,r+9,-1.1+progress*.55,1.1+progress*.4);c.stroke();if(element==='steel'){c.rotate(Math.PI/2);c.beginPath();c.arc(0,0,r*.85,-1.2,1.2);c.stroke();}}
    if(e.type==='beam'){
      const angle=e.angle||0,length=e.length||500,width=e.width||55;c.translate(e.x,e.y-12);c.rotate(angle);c.globalAlpha*=1-progress*.75;c.fillStyle=p.dark;c.fillRect(0,-width/2,length,width);c.fillStyle=p.color;c.fillRect(0,-width*.28,length,width*.56);c.fillStyle='#ffffffbb';c.fillRect(0,-Math.max(2,width*.07),length,Math.max(4,width*.14));
      c.strokeStyle='#f8fdffdd';c.lineWidth=2;
      if(element==='electric'){c.beginPath();c.moveTo(0,0);for(let x=20,i=0;x<length;x+=20,i++)c.lineTo(x,(i%2?1:-1)*width*.22);c.stroke();}
      if(element==='fire'){c.fillStyle='#ffe0a0aa';for(let x=35;x<length;x+=70){c.beginPath();c.moveTo(x-width*.25,0);c.lineTo(x,width*.42);c.lineTo(x+width*.3,0);c.lineTo(x,-width*.42);c.closePath();c.fill();}}
      if(element==='water'){for(let x=20;x<length;x+=48){c.beginPath();c.arc(x,0,width*.35,0,TAU);c.stroke();}}
      if(element==='grass'){c.strokeStyle='#eaffc9';c.lineWidth=3;c.beginPath();c.moveTo(0,0);for(let x=25;x<=length;x+=25)c.lineTo(x,Math.sin(x*.045+this.time*6)*width*.22);c.stroke();}
      if(element==='ghost'){c.fillStyle='#ead5ff77';for(let x=35;x<length;x+=62){circle(c,x,Math.sin(x*.07+this.time*5)*width*.2,width*.16);c.fill();}}
      if(element==='psychic'){for(let x=35;x<length;x+=65){c.beginPath();c.ellipse(x,0,width*.2,width*.42,0,0,TAU);c.stroke();}}
      if(element==='dragon'){c.strokeStyle='#f0edff';for(let x=25;x<length;x+=55){c.beginPath();c.moveTo(x-width*.18,-width*.3);c.lineTo(x,0);c.lineTo(x-width*.18,width*.3);c.stroke();}}
      if(element==='steel'){c.strokeStyle='#fff';for(let x=15;x<length;x+=80){c.beginPath();c.moveTo(x,-width*.42);c.lineTo(x+width*.7,width*.42);c.stroke();}}
      if(element==='rock'){c.fillStyle='#75675088';for(let x=40;x<length;x+=75){c.fillRect(x,-width*.28,Math.max(5,width*.16),Math.max(5,width*.16));}}
    }
    if(e.type==='pulse'){c.translate(e.x,e.y);c.scale(1,.7);c.strokeStyle=p.color;for(let i=0;i<3;i++){c.globalAlpha=fade*(1-i*.22);c.lineWidth=4-i;circle(c,0,0,(e.r||90)*clamp(progress-i*.13));c.stroke();}this.drawElementGround(element,e.r||80,progress,true);}
    if(e.type==='fieldAttack'){c.translate(e.x,e.y);c.scale(1,.7);c.globalAlpha=fade*(1-progress)*.4;c.fillStyle=p.color;circle(c,0,0,(e.r||90)*(.7+progress*.35));c.fill();this.drawElementGround(element,e.r||90,progress,true);}
    if(e.type==='detonate'||e.type==='ultimate'){const r=(e.r||120)*(.2+progress*.8);c.translate(e.x,e.y);c.scale(1,.7);c.globalAlpha=fade*(1-progress*.72);c.fillStyle=p.dark;c.globalAlpha*=.18;circle(c,0,0,r);c.fill();c.globalAlpha=fade*(1-progress*.5);c.strokeStyle=p.color;c.lineWidth=e.ultimate||e.type==='ultimate'?8:5;circle(c,0,0,r*.82);c.stroke();this.drawElementGround(element,r,progress,true);}
    if(e.type==='blinkLine'){c.strokeStyle=e.color||'#f5d98b';c.globalAlpha=fade*.55;c.lineWidth=2;c.setLineDash([6,12]);c.beginPath();c.moveTo(e.from.x,e.from.y);c.lineTo(e.to.x,e.to.y);c.stroke();}
    if(e.type==='heal'){c.translate(e.x,e.y);c.scale(1,.55);c.strokeStyle=e.color||'#9af8c5';c.lineWidth=3;circle(c,0,0,25+progress*45);c.stroke();c.globalAlpha=.14*(1-progress);c.fillStyle=e.color||'#66dca1';circle(c,0,0,44);c.fill();c.globalAlpha=fade;c.lineWidth=5;c.beginPath();c.moveTo(-9,0);c.lineTo(9,0);c.moveTo(0,-9);c.lineTo(0,9);c.stroke();}
    if(e.type==='shield'){c.translate(e.x,e.y-12);c.strokeStyle=e.color||'#bfe8fa';c.fillStyle=e.color||'#bfe8fa';c.globalAlpha=fade*(1-progress)*.3;c.lineWidth=4;circle(c,0,0,e.r||45);c.fill();c.globalAlpha=fade;circle(c,0,0,(e.r||45)*(1+progress*.2));c.stroke();if(e.value!=null)label(c,`+${Math.round(e.value)}`,0,-55,e.color||'#bfe8fa',13);}
    if(e.type==='enrage'){c.translate(e.x,e.y);c.scale(1,.65);c.strokeStyle=e.color||'#f08962';c.lineWidth=5;c.globalAlpha=fade*(1-progress*.5);for(let i=0;i<3;i++){c.beginPath();c.arc(0,0,(e.r||55)*(progress+i*.16),-Math.PI*.9,-Math.PI*.1);c.stroke();}}
    if(e.type==='lightning'){c.shadowBlur=this.reducedMotion?4:22;c.shadowColor=p.color;const segments=[];let x=e.x+Math.sin(this.time*43)*18,y=54;segments.push([x,y]);for(let i=1;i<9;i++){y=54+(e.y-54)*i/8;x=i===8?e.x:e.x+Math.sin(this.time*37+i*8.3)*35;segments.push([x,y]);}for(const [width,color] of [[12,p.dark],[6,p.color],[2,'#fffce8']]){c.lineWidth=width;c.strokeStyle=color;c.beginPath();segments.forEach(([px,py],i)=>i?c.lineTo(px,py):c.moveTo(px,py));c.stroke();}c.fillStyle='#fff8dd';circle(c,e.x,e.y-8,20*(1-progress));c.fill();}
    if(e.type==='name'){const y=e.y-progress*10,text=e.text||'';c.font='bold 9px ui-monospace,monospace';const width=c.measureText(text).width+16;c.fillStyle='#142739d9';c.fillRect(Math.round(e.x-width/2),Math.round(y-9),width,18);c.fillStyle=e.color||'#fff';c.textAlign='center';c.textBaseline='middle';c.fillText(text,Math.round(e.x),Math.round(y));}
    c.restore();
  }
}
