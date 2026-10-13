import {ROSTER} from './roster.js';
import {measureSpritePixels,spriteScaleFor} from './fighter-size.js';

const spritePromises=new Map();
const DEFAULT_IDS=ROSTER.map(({id})=>id);
const ACTION_EXEMPT=new Set(['idle','walk']);
const tintedSheets=[];
const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));

const loadImage=url=>new Promise((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>resolve(image);
  image.onerror=()=>reject(new Error(`Could not load ${url}`));
  image.src=url;
});

function canvasFor(width,height){
  if(typeof OffscreenCanvas!=='undefined')return new OffscreenCanvas(width,height);
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;return canvas;
}

function tintedSheet(image,tint){
  const cached=tintedSheets.find(entry=>entry.image===image&&entry.tint===tint);if(cached)return cached.canvas;
  if(!image?.width||!image?.height||(typeof OffscreenCanvas==='undefined'&&typeof document==='undefined'))return image;
  const canvas=canvasFor(image.width,image.height),ctx=canvas.getContext('2d');
  ctx.drawImage(image,0,0);ctx.globalCompositeOperation='source-in';ctx.fillStyle=tint==='recall'?'#ff527c':'#fff9e9';ctx.fillRect(0,0,canvas.width,canvas.height);
  tintedSheets.push({image,tint,canvas});if(tintedSheets.length>12)tintedSheets.shift();return canvas;
}

function readAnchors(shadow,meta){
  const canvas=canvasFor(shadow.width,shadow.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(shadow,0,0);
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  return Array.from({length:meta.directionCount},(_,row)=>Array.from({length:meta.frameCount},(_,col)=>{
    let sx=0,sy=0,count=0;
    const left=col*meta.frameWidth,top=row*meta.frameHeight;
    for(let y=0;y<meta.frameHeight;y++)for(let x=0;x<meta.frameWidth;x++){
      const i=((top+y)*canvas.width+left+x)*4;
      if(pixels[i]>=250&&pixels[i+1]>=250&&pixels[i+2]>=250&&pixels[i+3]>100){sx+=x;sy+=y;count++;}
    }
    return count?{x:sx/count,y:sy/count}:{x:meta.frameWidth/2,y:meta.frameHeight-4};
  }));
}

async function loadSet(id){
  const response=await fetch(`/assets/pokemon/${id}/animations.json`);
  if(!response.ok)throw new Error(`${id} manifest not found`);
  const manifest=await response.json();
  const animations=await Promise.all(Object.entries(manifest.animations).map(async([key,meta])=>{
    const [image,shadow]=await Promise.all([loadImage(meta.image),loadImage(meta.shadowImage)]);
    return [key,{...meta,image,anchors:readAnchors(shadow,meta),totalFrames:meta.durationsFrames.reduce((sum,n)=>sum+n,0)}];
  }));
  const byName=Object.fromEntries(animations),idle=byName.idle||animations[0][1];
  const canvas=canvasFor(idle.image.width,idle.image.height),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(idle.image,0,0);
  const metrics=measureSpritePixels(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,idle,idle.anchors);
  return {id,animations:byName,metrics,portrait:await loadImage(manifest.portrait.normal.url)};
}

function promiseFor(id){
  if(!spritePromises.has(id)){
    const promise=loadSet(id).catch(error=>{spritePromises.delete(id);throw error;});
    spritePromises.set(id,promise);
  }
  return spritePromises.get(id);
}

export async function loadSprites(ids=DEFAULT_IDS){
  const requested=[...new Set(Array.isArray(ids)?ids:[ids])].filter(Boolean);
  const entries=await Promise.all(requested.map(async id=>[id,await promiseFor(id)]));
  return Object.fromEntries(entries);
}

export function frameFor(anim,time,loop=true){
  const frameCount=Math.max(1,anim?.frameCount||1);
  const durations=anim?.durationsFrames||[1];
  const total=Math.max(1,anim?.totalFrames||durations.reduce((sum,n)=>sum+n,0)||1);
  let tick=Math.max(0,Number.isFinite(time)?time*60:0);
  if(loop)tick%=total;else tick=Math.min(tick,total-.01);
  let frame=0;
  while(frame<frameCount-1&&tick>=(durations[frame]||1))tick-=durations[frame++]||1;
  return frame;
}

export function directionFor(angle){
  const safe=Number.isFinite(angle)?angle:Math.PI/2;
  return ((Math.round((Math.PI/2-safe)/(Math.PI/4))%8)+8)%8;
}

function frameStart(anim,index){
  const durations=anim?.durationsFrames||[1],last=Math.max(0,durations.length-1),safe=clamp(Number.isFinite(index)?Math.floor(index):0,0,last);
  let ticks=0;for(let i=0;i<safe;i++)ticks+=durations[i]||1;return ticks/60;
}

/** Pure helper exported for tests: native PMD action markers in seconds. */
export function animationMarkers(anim){
  const durations=anim?.durationsFrames||[1],nativeDuration=Math.max(1,anim?.totalFrames||durations.reduce((sum,n)=>sum+n,0)||1)/60;
  let rush=Number.isFinite(anim?.rushFrame)?frameStart(anim,anim.rushFrame):0;
  let hit=Number.isFinite(anim?.hitFrame)?frameStart(anim,anim.hitFrame):null;
  let recover=Number.isFinite(anim?.returnFrame)?frameStart(anim,anim.returnFrame):nativeDuration;
  if(hit==null){
    if(Number.isFinite(anim?.returnFrame))hit=Math.max(rush,Math.min(recover,nativeDuration)*.72);
    else hit=nativeDuration*.48;
  }
  rush=clamp(rush,0,hit);recover=clamp(recover,hit,nativeDuration);
  return {rush,hit,recover,duration:nativeDuration};
}

function segmentMap(value,fromA,fromB,toA,toB){
  if(fromB-fromA<=1e-6)return toB;
  return toA+(toB-toA)*clamp((value-fromA)/(fromB-fromA));
}

/**
 * Pure helper exported for tests. Maps gameplay action time onto the complete
 * native sheet, pinning hitFrame to animHitAt and retaining rush/return phases.
 */
export function mappedAnimationTime(anim,elapsed,animDuration,animHitAt=null){
  const markers=animationMarkers(anim),duration=Math.max(1/60,Number.isFinite(animDuration)?animDuration:markers.duration),gameTime=clamp(Number.isFinite(elapsed)?elapsed:0,0,duration);
  const proportionalHit=duration*(markers.hit/markers.duration);
  const hitAt=clamp(Number.isFinite(animHitAt)?animHitAt:proportionalHit,0,duration);
  const preStrike=Math.min(.105,hitAt*.42),postStrike=Math.min(.11,(duration-hitAt)*.46);
  const rushAt=markers.rush<markers.hit?Math.max(0,hitAt-preStrike):hitAt;
  const recoverAt=markers.recover>markers.hit?Math.min(duration,hitAt+postStrike):hitAt;
  if(gameTime<=rushAt)return segmentMap(gameTime,0,rushAt,0,markers.rush);
  if(gameTime<=hitAt)return segmentMap(gameTime,rushAt,hitAt,markers.rush,markers.hit);
  if(gameTime<=recoverAt)return segmentMap(gameTime,hitAt,recoverAt,markers.hit,markers.recover);
  return segmentMap(gameTime,recoverAt,duration,markers.recover,markers.duration-.0001);
}

function easeOut(t){return 1-(1-t)*(1-t);}
function pulse(t,peak=.32){return t<peak?t/Math.max(.001,peak):1-(t-peak)/Math.max(.001,1-peak);}

/** Pure helper exported for tests: subtle foot-anchored pose deformation. */
export function poseTransformFor(fighter){
  const source=fighter?.pose||(fighter?.dash?.kind==='dodge'?{kind:'dodge',elapsed:fighter.dash.elapsed,duration:fighter.dash.duration,angle:Math.atan2(fighter.dash.dy||0,fighter.dash.dx||1),power:1}:null);
  if(!source)return {x:0,y:0,rotation:0,axis:0,scaleAlong:1,scaleAcross:1};
  const duration=Math.max(.001,source.duration||.2),t=clamp((source.elapsed||0)/duration),angle=Number.isFinite(source.angle)?source.angle:(Number.isFinite(fighter?.facing)?fighter.facing:0),power=clamp(source.power??1,.45,1.6);
  let travel=0,rotation=0,scaleAlong=1,scaleAcross=1;
  if(source.kind==='windup'){
    const amount=easeOut(t);travel=-5.5*power*amount;scaleAlong=1-.035*amount;scaleAcross=1+.045*amount;
  }else if(source.kind==='strike'){
    const amount=Math.max(0,pulse(t,.27));travel=(-2.5+(14.5*amount))*power;scaleAlong=1+.11*amount;scaleAcross=1-.075*amount;
  }else if(source.kind==='cast'){
    const amount=Math.sin(Math.PI*t);travel=-2.5*power*amount;scaleAlong=1-.045*amount;scaleAcross=1+.075*amount;
  }else if(source.kind==='recoil'){
    const amount=(1-t)*(1-t);travel=-7*power*amount;scaleAlong=1-.055*amount;scaleAcross=1+.04*amount;rotation=Math.sin(angle)*.025*amount;
  }else if(source.kind==='dodge'){
    const amount=Math.sin(Math.PI*t),side=Math.sign(Math.cos(angle))||1;travel=2.5*amount;scaleAlong=1+.16*amount;scaleAcross=1-.14*amount;rotation=side*.085*amount;
  }
  return {x:Math.cos(angle)*travel,y:Math.sin(angle)*travel,rotation,axis:angle,scaleAlong,scaleAcross};
}

function selectedAnimation(set,fighter){
  if(fighter.hp<=0)return set.animations.faint||set.animations.pain||set.animations.hurt||set.animations.idle||Object.values(set.animations)[0];
  return set.animations[fighter.anim]||set.animations.idle||Object.values(set.animations)[0];
}

export function drawFighter(ctx,sprites,fighter,{alpha=1,ghost=false,worldScale=false,appearScale=1,tint=null}={}){
  if(!fighter||fighter.blinkStrike?.hidden)return;
  const set=sprites?.[fighter.id];if(!ctx||!set)return;
  const anim=selectedAnimation(set,fighter);if(!anim)return;
  const row=Math.min(anim.directionCount-1,directionFor(fighter.facing));
  const dead=fighter.hp<=0,action=!dead&&!ACTION_EXEMPT.has(fighter.anim);
  const loop=dead?false:action?false:anim.loop!==false;
  const sheetTime=action&&Number.isFinite(fighter.animDuration)?mappedAnimationTime(anim,fighter.animTime,fighter.animDuration,fighter.animHitAt):fighter.animTime;
  const frame=frameFor(anim,sheetTime,loop);
  const anchor=anim.anchors?.[row]?.[frame]||{x:anim.frameWidth/2,y:anim.frameHeight-4};
  const scale=(worldScale?spriteScaleFor(fighter,set.metrics):fighter.def?.scale??fighter.scale??2)*appearScale;
  const radius=fighter.radius??fighter.def?.radius??20;
  const pose=poseTransformFor(fighter),opacity=Math.max(0,alpha);
  if(opacity<=0)return;
  ctx.save();ctx.globalAlpha*=opacity;
  const shadowRadius=worldScale&&set.metrics?Math.max(8,Math.min(80,set.metrics.width*scale*.38)):radius+5;
  if(!ghost){ctx.fillStyle='#172d3b52';ctx.beginPath();ctx.ellipse(Math.round(fighter.x+pose.x*.35),Math.round(fighter.y)+4,shadowRadius*(2-pose.scaleAcross),Math.max(3,shadowRadius*.28),0,0,Math.PI*2);ctx.fill();}
  if(fighter.hurt>0&&!ghost)ctx.filter='brightness(1.9) saturate(.35)';
  ctx.imageSmoothingEnabled=false;
  ctx.translate(Math.round(fighter.x+pose.x),Math.round(fighter.y+pose.y));
  if(pose.scaleAlong!==1||pose.scaleAcross!==1){ctx.rotate(pose.axis);ctx.scale(pose.scaleAlong,pose.scaleAcross);ctx.rotate(-pose.axis);}
  if(pose.rotation)ctx.rotate(pose.rotation);
  ctx.drawImage(tint?tintedSheet(anim.image,tint):anim.image,frame*anim.frameWidth,row*anim.frameHeight,anim.frameWidth,anim.frameHeight,Math.round(-anchor.x*scale),Math.round(-anchor.y*scale),anim.frameWidth*scale,anim.frameHeight*scale);
  ctx.restore();
}
