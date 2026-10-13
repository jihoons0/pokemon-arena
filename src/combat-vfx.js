const TAU=Math.PI*2;
export const VFX_EVENT_CAP=180;
export const VFX_PARTICLE_CAP=900;

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
const FAMILY_BY_ELEMENT={
  fire:'fire',water:'water',electric:'electric',psychic:'psychic',ice:'ice',
  normal:'physical',fighting:'physical',steel:'physical',rock:'physical',ground:'physical',
  grass:'nature',bug:'nature',poison:'toxic',flying:'wind',ghost:'shadow',dark:'shadow',dragon:'dragon',fairy:'psychic',
};
const KIND_PROFILES={
  basic:{anticipation:.16,release:.18,impact:.22,weight:.55},bolt:{anticipation:.26,release:.28,impact:.34,weight:.78},
  volley:{anticipation:.3,release:.25,impact:.3,weight:.7},fan:{anticipation:.3,release:.34,impact:.32,weight:.76},
  blinkStrike:{anticipation:.18,release:.3,impact:.38,weight:1},
  dash:{anticipation:.24,release:.38,impact:.38,weight:1},slash:{anticipation:.25,release:.32,impact:.4,weight:1.08},
  pulse:{anticipation:.34,release:.42,impact:.42,weight:1.05},field:{anticipation:.38,release:.42,impact:.45,weight:1.02},
  storm:{anticipation:.56,release:.52,impact:.5,weight:1.25},nova:{anticipation:.58,release:.52,impact:.56,weight:1.35},
  beam:{anticipation:.62,release:.55,impact:.5,weight:1.3},guard:{anticipation:.34,release:.28,impact:.24,weight:.48},
  boost:{anticipation:.4,release:.32,impact:.24,weight:.52},dodge:{anticipation:.08,release:.3,impact:.16,weight:.35},
  haste:{anticipation:.24,release:.3,impact:.2,weight:.42},barrier:{anticipation:.34,release:.3,impact:.24,weight:.5},
  trainerHeal:{anticipation:.34,release:.34,impact:.22,weight:.42},cleanse:{anticipation:.3,release:.3,impact:.2,weight:.4},
  exhaust:{anticipation:.3,release:.3,impact:.28,weight:.5},ignite:{anticipation:.3,release:.34,impact:.34,weight:.68},
};

export function elementFamily(element='normal'){
  return FAMILY_BY_ELEMENT[element]||'physical';
}

export function vfxProfile(input={}){
  const kind=KIND_PROFILES[input.kind]?input.kind:(input.basic?'basic':'bolt');
  const base=KIND_PROFILES[kind];
  const damage=Math.max(0,finite(input.damage));
  const ultimate=Boolean(input.ultimate||input.key==='r'||['storm','nova'].includes(kind));
  const power=clamp(base.weight+(damage/320),.35,ultimate?1.65:1.35);
  return Object.freeze({
    kind,
    element:FAMILY_BY_ELEMENT[input.element]?input.element:'normal',
    family:elementFamily(input.element),
    ultimate,
    anticipation:base.anticipation*(ultimate?1.15:1),
    release:base.release*(ultimate?1.08:1),
    impact:base.impact*(ultimate?1.12:1),
    power,
    particles:Math.round((kind==='dash'||kind==='slash'?14:10)*power+(ultimate?12:0)),
    shake:clamp((damage/38+.8)*base.weight,0,ultimate?10:6),
    recoil:clamp(2.2+damage/28,2.2,ultimate?10:7),
  });
}

export function cappedCount(requested,current=0,cap=VFX_PARTICLE_CAP,scale=1){
  return Math.max(0,Math.min(Math.ceil(Math.max(0,finite(requested))*clamp(finite(scale,1),0,1)),Math.max(0,finite(cap)-Math.max(0,finite(current)))));
}

export function pushCapped(list,item,cap=VFX_EVENT_CAP){
  if(!Array.isArray(list))return item;
  list.push(item);
  const overflow=list.length-Math.max(0,finite(cap,VFX_EVENT_CAP));
  if(overflow>0)list.splice(0,overflow);
  return item;
}

function circle(ctx,x,y,r){ctx.beginPath();ctx.arc(x,y,Math.max(0,r),0,TAU);}
function strokeRay(ctx,angle,inner,outer){ctx.beginPath();ctx.moveTo(Math.cos(angle)*inner,Math.sin(angle)*inner);ctx.lineTo(Math.cos(angle)*outer,Math.sin(angle)*outer);ctx.stroke();}
function diamond(ctx,x,y,w,h){ctx.beginPath();ctx.moveTo(x,y-h);ctx.lineTo(x+w,y);ctx.lineTo(x,y+h);ctx.lineTo(x-w,y);ctx.closePath();}
function branch(ctx,seed,length,width){
  let x=0,y=0;ctx.beginPath();ctx.moveTo(0,0);
  for(let i=1;i<=5;i++){x=length*i/5;y=Math.sin(seed*7+i*4.7)*width*(1-i/7);ctx.lineTo(x,y);}ctx.stroke();
}
function familyColor(family,color){
  return {fire:'#ffe0a0',water:'#e5fbff',electric:'#fff8bd',psychic:'#ffe5f8',ice:'#effeff',physical:'#fff4d8',nature:'#efffd2',toxic:'#f0d8ff',wind:'#eef8ff',shadow:'#ead9ff',dragon:'#eeeaff'}[family]||color||'#fff';
}

export function drawCombatVfx(ctx,e,{time=0,reducedMotion=false}={}){
  if(!ctx||!e)return false;
  if(drawSkillBloom(ctx,e,{time,reducedMotion}))return true;
  if(!['castAnticipation','releaseStroke','dashTrail','elementImpact','ultimateFocus'].includes(e.type))return false;
  const life=Math.max(.001,e.maxLife||e.life||1),progress=clamp(1-e.life/life),fade=clamp(e.life*6),family=e.family||elementFamily(e.element),color=elementVfxStyle(e.element).primary,accent=elementVfxStyle(e.element).accent,power=clamp(finite(e.power,1),.35,1.8);
  ctx.save();ctx.globalAlpha=fade;ctx.lineCap='round';ctx.lineJoin='round';
  if(e.type==='castAnticipation'){
    const angle=finite(e.angle),r=(12+progress*25)*power,pull=(1-progress)*34+8;
    ctx.translate(e.x,e.y-16);ctx.rotate(angle);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
    ctx.globalAlpha=fade*(.28+progress*.36);
    for(let i=-2;i<=2;i++){const a=Math.PI+i*.43;ctx.beginPath();ctx.arc(0,0,r+i*2,a-.22,a+.22);ctx.stroke();}
    ctx.globalAlpha=fade*(.2+progress*.35);for(let i=0;i<5;i++){const y=(i-2)*6;ctx.beginPath();ctx.moveTo(-pull-i*3,y);ctx.lineTo(-8-progress*5,y*.35);ctx.stroke();}
    ctx.globalAlpha=fade*.3;circle(ctx,0,0,5+progress*8);ctx.fill();
    if(family==='electric'){ctx.strokeStyle=accent;ctx.lineWidth=1.5;for(const s of [-1,1]){ctx.save();ctx.rotate(s*.8);branch(ctx,time+s,r*.7,5);ctx.restore();}}
    if(family==='psychic'||family==='shadow'){ctx.strokeStyle=accent;ctx.globalAlpha=fade*.55;for(let i=0;i<2;i++){ctx.beginPath();ctx.ellipse(0,0,r*(.7+i*.28),r*(.25+i*.11),time*(i?-.8:1)+i,0,TAU);ctx.stroke();}}
    if(family==='fire'){ctx.fillStyle=accent;ctx.globalAlpha=fade*.45;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(-5+i*5,5);ctx.quadraticCurveTo(-10+i*6,-r*.7,2+i*4,-r);ctx.quadraticCurveTo(10+i*3,-r*.35,6+i*3,5);ctx.fill();}}
  }
  if(e.type==='releaseStroke'){
    const angle=finite(e.angle),length=(finite(e.length,70))*(.45+progress*.55),spread=finite(e.spread,12)*power;
    ctx.translate(e.x,e.y-14);ctx.rotate(angle);ctx.strokeStyle=color;ctx.lineWidth=3+power*2;ctx.globalAlpha=fade*(1-progress*.45);
    if(family==='water'){for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(2,side*3);ctx.bezierCurveTo(length*.25,side*spread,length*.62,-side*spread*.55,length,side*2);ctx.stroke();}ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(4,0);ctx.lineTo(length,0);ctx.stroke();}
    else if(family==='electric'){ctx.strokeStyle=color;branch(ctx,time,length,spread*.55);ctx.strokeStyle=accent;ctx.lineWidth=1.5;branch(ctx,time+.3,length,spread*.3);}
    else if(family==='fire'){ctx.fillStyle=color;ctx.globalAlpha=fade*(1-progress*.5);ctx.beginPath();ctx.moveTo(0,0);ctx.quadraticCurveTo(length*.32,-spread*1.2,length,0);ctx.quadraticCurveTo(length*.35,spread*.8,0,0);ctx.fill();ctx.fillStyle=accent;ctx.globalAlpha*=.7;ctx.beginPath();ctx.moveTo(5,0);ctx.quadraticCurveTo(length*.42,-spread*.45,length*.78,0);ctx.quadraticCurveTo(length*.42,spread*.38,5,0);ctx.fill();}
    else{for(let i=-1;i<=1;i++){ctx.globalAlpha=fade*(.65-Math.abs(i)*.14);ctx.lineWidth=Math.max(1,4-Math.abs(i));ctx.beginPath();ctx.moveTo(0,i*spread*.4);ctx.quadraticCurveTo(length*.45,i*spread,length,i*spread*.18);ctx.stroke();}}
  }
  if(e.type==='dashTrail'){
    const angle=finite(e.angle),length=finite(e.length,64)*(1-progress*.45),width=finite(e.width,18)*power;
    ctx.translate(e.x,e.y-10);ctx.rotate(angle);ctx.strokeStyle=color;ctx.globalAlpha=fade*.55;
    for(let i=-2;i<=2;i++){ctx.lineWidth=Math.max(1,4-Math.abs(i));ctx.beginPath();ctx.moveTo(-length,i*width*.28);ctx.quadraticCurveTo(-length*.45,i*width*.12,8,i*width*.05);ctx.stroke();}
    if(family==='fire'){ctx.fillStyle=color;for(let i=0;i<3;i++){ctx.globalAlpha=fade*(.34-i*.07);ctx.beginPath();ctx.moveTo(-length*(.35+i*.2),-width*.3);ctx.lineTo(-length*(.65+i*.13),0);ctx.lineTo(-length*(.35+i*.2),width*.3);ctx.fill();}}
    if(family==='water'){ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-length,0);ctx.bezierCurveTo(-length*.7,-width,-length*.3,width,5,0);ctx.stroke();}
    if(family==='electric'){ctx.strokeStyle=accent;ctx.lineWidth=1.5;ctx.save();ctx.translate(-length,0);branch(ctx,time,length,width*.45);ctx.restore();}
  }
  if(e.type==='elementImpact'){
    const angle=finite(e.angle),r=finite(e.r,34)*(.45+progress*.7)*power;
    ctx.translate(e.x,e.y-12);ctx.rotate(angle);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=Math.max(1.5,4*(1-progress));ctx.globalAlpha=fade*(1-progress*.25);
    if(family==='fire'){
      for(let i=0;i<5;i++){const a=-1.18+i*.59,rr=r*(.72+(i%2)*.28);ctx.save();ctx.rotate(a);ctx.fillStyle=i%2?color:accent;ctx.globalAlpha=fade*(.62-i*.055);ctx.beginPath();ctx.moveTo(0,4);ctx.quadraticCurveTo(rr*.48,-rr*.34,rr,0);ctx.quadraticCurveTo(rr*.45,rr*.22,0,-4);ctx.fill();ctx.restore();}
    }else if(family==='water'){
      ctx.strokeStyle=color;for(let i=0;i<5;i++){const a=-1.35+i*.67;ctx.save();ctx.rotate(a);ctx.lineWidth=3-i*.25;ctx.beginPath();ctx.moveTo(4,0);ctx.bezierCurveTo(r*.3,-r*.25,r*.7,r*.25,r,0);ctx.stroke();ctx.restore();}ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,r*.68,-2.8,-.35);ctx.stroke();
    }else if(family==='electric'){
      for(let i=0;i<7;i++){ctx.save();ctx.rotate(i*TAU/7+time*.08);ctx.strokeStyle=i%2?color:accent;ctx.lineWidth=i%2?3:1.5;branch(ctx,time+i,r,8);ctx.restore();}
    }else if(family==='psychic'||family==='shadow'){
      ctx.strokeStyle=color;for(let i=0;i<3;i++){ctx.globalAlpha=fade*(.72-i*.14);ctx.lineWidth=3-i*.55;ctx.beginPath();ctx.ellipse(0,0,r*(.45+i*.28),r*(.18+i*.12),time*(i%2?-.7:.9)+i,0,TAU);ctx.stroke();}ctx.fillStyle=accent;ctx.globalAlpha=fade*.25;circle(ctx,0,0,r*.3*(1-progress));ctx.fill();
    }else if(family==='ice'){
      for(let i=0;i<7;i++){const a=i*TAU/7,rr=r*(.62+(i%3)*.16);ctx.save();ctx.rotate(a);ctx.fillStyle=i%2?color:accent;diamond(ctx,rr*.45,0,rr*.42,3+i%2*2);ctx.fill();ctx.restore();}
    }else if(family==='nature'||family==='toxic'){
      for(let i=0;i<7;i++){const a=i*TAU/7+time*.15,rr=r*(.55+(i%2)*.3);ctx.save();ctx.rotate(a);ctx.fillStyle=i%2?color:accent;ctx.beginPath();ctx.ellipse(rr*.55,0,rr*.32,rr*.12,.25,0,TAU);ctx.fill();ctx.restore();}
    }else if(family==='wind'||family==='dragon'){
      ctx.strokeStyle=color;for(let i=0;i<4;i++){ctx.globalAlpha=fade*(.72-i*.12);ctx.lineWidth=4-i*.65;ctx.beginPath();ctx.arc(0,0,r*(.4+i*.2),-1.35+i*.18,1.1+i*.2);ctx.stroke();}for(let i=0;i<4;i++)strokeRay(ctx,-.8+i*.53,r*.55,r*1.12);
    }else{
      ctx.strokeStyle=color;for(let i=0;i<8;i++){const a=i*TAU/8+(i%2)*.12;ctx.lineWidth=i%2?2:4;strokeRay(ctx,a,r*.25,r*(.72+(i%3)*.18));}ctx.strokeStyle=accent;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-r*.7,r*.2);ctx.lineTo(-r*.28,r*.08);ctx.lineTo(-r*.06,r*.55);ctx.moveTo(r*.62,r*.08);ctx.lineTo(r*.2,r*.02);ctx.lineTo(r*.05,r*.48);ctx.stroke();
    }
    ctx.strokeStyle=accent;ctx.globalAlpha=fade*.75;ctx.lineWidth=1.5;circle(ctx,0,0,r*(.28+progress*.3));ctx.stroke();
  }
  if(e.type==='ultimateFocus'){
    const r=finite(e.r,78)*(1-progress*.45),angle=finite(e.angle);
    ctx.translate(e.x,e.y-15);ctx.strokeStyle=color;ctx.globalAlpha=fade*(.28+Math.sin(progress*Math.PI)*.22);ctx.lineWidth=2;
    for(let i=0;i<3;i++){ctx.save();ctx.rotate((i%2?1:-1)*time*.7+i);ctx.beginPath();ctx.ellipse(0,0,r*(.65+i*.2),r*(.24+i*.08),0,0,TAU);ctx.stroke();ctx.restore();}
    ctx.rotate(angle);ctx.strokeStyle=accent;ctx.globalAlpha=fade*.5;for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(-r*(1.05+Math.abs(i)*.08),i*7);ctx.lineTo(-r*.45,i*3);ctx.stroke();}
    if(!reducedMotion){ctx.globalAlpha=fade*.1;ctx.fillStyle=color;circle(ctx,0,0,r*.52);ctx.fill();}
  }
  ctx.restore();return true;
}

// Each element has a separate palette AND silhouette, shared by every move phase.
const ELEMENT_STYLES={
  normal:['#ffe0a1','#fff8df','#90705e','spark'],fire:['#ff713d','#ffe76b','#b62455','flame'],
  water:['#29bbff','#b6fff1','#285ec5','drop'],electric:['#ffe52f','#fffbd2','#9b63ff','bolt'],
  grass:['#63e778','#e3ff8b','#178772','leaf'],ice:['#6beaff','#f2ffff','#6178ed','crystal'],
  fighting:['#ff9765','#fff0a5','#cb3e53','impact'],poison:['#d567ff','#ffb4ee','#7842cc','bubble'],
  ground:['#e9a367','#ffe1a3','#936643','stone'],flying:['#a0edff','#fffaff','#729be0','feather'],
  psychic:['#ff72c6','#ffdbf3','#8664ff','orbit'],bug:['#c4f354','#fff3a0','#4aab70','wing'],
  rock:['#e2c495','#fff0ca','#986e65','stone'],ghost:['#ba83ff','#e0caff','#6a4dc7','wisp'],
  dragon:['#af83ff','#71f9f1','#6351c8','fang'],dark:['#a293d9','#fba6e7','#473c74','crescent'],
  steel:['#bce7f5','#ffffff','#6e92b4','blade'],fairy:['#ff9ee7','#fff3a9','#b281e8','star'],
};
export function elementVfxStyle(element='normal'){
  const [primary,accent,shadow,motif]=ELEMENT_STYLES[element]||ELEMENT_STYLES.normal;
  return {primary,accent,shadow,motif};
}
function star(ctx,r,points=4){ctx.beginPath();for(let i=0;i<points*2;i++){const a=i*Math.PI/points,rr=i%2?r*.3:r;i?ctx.lineTo(Math.cos(a)*rr,Math.sin(a)*rr):ctx.moveTo(Math.cos(a)*rr,Math.sin(a)*rr);}ctx.closePath();}
function elementalGlyph(ctx,motif,size,phase=0){
  const s=size;ctx.beginPath();
  if(motif==='flame'||motif==='wisp'){
    ctx.moveTo(-s*.55,s*.5);ctx.bezierCurveTo(-s,-s*.25,s*.3,-s*.5,s*.18,-s*1.5);ctx.bezierCurveTo(s*1.2,-s*.5,s*.8,s*.7,0,s*.7);ctx.closePath();ctx.fill();
  }else if(motif==='drop'||motif==='leaf'||motif==='feather'){
    ctx.moveTo(-s,0);ctx.quadraticCurveTo(0,-s*.8,s*1.4,-s*.2);ctx.quadraticCurveTo(s*.6,s,-s,0);ctx.fill();ctx.beginPath();ctx.moveTo(-s*.4,0);ctx.lineTo(s*.65,-s*.1);ctx.stroke();
  }else if(motif==='bolt'){
    ctx.moveTo(-s,-s*.2);ctx.lineTo(-s*.1,-s*.65);ctx.lineTo(-s*.25,s*.05);ctx.lineTo(s,-s*.2);ctx.lineTo(s*.1,s*.7);ctx.lineTo(s*.2,s*.2);ctx.closePath();ctx.fill();
  }else if(motif==='crystal'||motif==='blade'||motif==='fang'){
    diamond(ctx,0,0,s*(motif==='fang'?.5:.32),s*1.4);ctx.fill();ctx.stroke();
  }else if(motif==='bubble'||motif==='orbit'){
    ctx.ellipse(0,0,s,s*(motif==='orbit'?.4:1),phase,0,TAU);ctx.stroke();circle(ctx,-s*.25,-s*.3,s*.18);ctx.fill();
  }else if(motif==='crescent'){
    ctx.arc(0,0,s,-1.3,1.3);ctx.quadraticCurveTo(-s*.6,0,Math.cos(-1.3)*s,Math.sin(-1.3)*s);ctx.fill();
  }else if(motif==='stone'){
    ctx.moveTo(-s,-s*.2);ctx.lineTo(-s*.3,-s);ctx.lineTo(s*.8,-s*.55);ctx.lineTo(s,s*.5);ctx.lineTo(-s*.4,s*.75);ctx.closePath();ctx.fill();ctx.stroke();
  }else if(motif==='wing'){
    for(const side of [-1,1]){ctx.beginPath();ctx.ellipse(side*s*.45,0,s*.38,s,side*.55,0,TAU);ctx.fill();}
  }else{star(ctx,s,motif==='impact'?6:4);ctx.fill();}
}
export function drawSkillBloom(ctx,e,{time=0,reducedMotion=false}={}){
  if(!['skillSigil','impactBloom','supportAura','beamRibbon','slashRibbon'].includes(e.type))return false;
  const style=elementVfxStyle(e.element),p=clamp(1-e.life/Math.max(.001,e.maxLife||e.life)),fade=Math.sin(Math.PI*Math.min(1,p+.08))*(1-p*.45),power=clamp(e.power||1,.4,1.8),count=reducedMotion?4:e.ultimate?12:8;
  ctx.save();ctx.translate(e.x,e.y-(e.type==='skillSigil'?0:14));ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=style.primary;ctx.fillStyle=style.primary;
  if(e.type==='skillSigil'){
    const r=(e.ultimate?62:38)*power*(.7+p*.35);ctx.save();ctx.scale(1,.45);
    ctx.globalAlpha=fade*.16;circle(ctx,0,0,r);ctx.fill();ctx.globalAlpha=fade*.8;ctx.lineWidth=2;circle(ctx,0,0,r);ctx.stroke();
    ctx.strokeStyle=style.accent;ctx.lineWidth=1;circle(ctx,0,0,r*.76);ctx.stroke();
    for(let i=0;i<count;i++){ctx.save();ctx.rotate(i*TAU/count+(reducedMotion?0:p*.5));ctx.translate(r,0);ctx.globalAlpha=fade*.85;star(ctx,4,4);ctx.fill();ctx.restore();}ctx.restore();
    for(let i=0;i<count;i++){const a=i*TAU/count,d=(1-p)*40+12;ctx.save();ctx.translate(Math.cos(a)*d,Math.sin(a)*d*.4-16-p*20);ctx.rotate(a);ctx.globalAlpha=fade*.85;ctx.fillStyle=i%2?style.primary:style.accent;elementalGlyph(ctx,style.motif,3+p*3,a);ctx.restore();}
  }else if(e.type==='impactBloom'){
    const r=(e.r||52)*power,out=r*(.35+Math.sqrt(p)*.9);
    // Translucent halo, crisp expanding shock ring, and hot core; no full-screen whiteout.
    ctx.globalAlpha=(1-p)*.13;circle(ctx,0,0,out);ctx.fill();
    ctx.globalAlpha=fade*.85;ctx.lineWidth=3*(1-p)+1;ctx.strokeStyle=style.primary;circle(ctx,0,0,out);ctx.stroke();
    ctx.globalAlpha=fade*.55;ctx.strokeStyle=style.accent;ctx.lineWidth=1.5;circle(ctx,0,0,out*.78);ctx.stroke();
    for(let i=0;i<count;i++){const a=i*TAU/count+(e.angle||0),distance=out*(.55+(i%3)*.17);ctx.save();ctx.translate(Math.cos(a)*distance,Math.sin(a)*distance*.78);ctx.rotate(a+p*.4);ctx.globalAlpha=fade*(i%2?.9:.7);ctx.fillStyle=i%2?style.primary:style.accent;ctx.strokeStyle=style.accent;ctx.lineWidth=1.25;elementalGlyph(ctx,style.motif,(5+(i%3)*2)*power*(1-p*.45),a);ctx.restore();}
    ctx.globalAlpha=Math.max(0,1-p*3)*.8;ctx.fillStyle=style.accent;star(ctx,r*.5*(1-p),6);ctx.fill();ctx.globalAlpha=Math.max(0,1-p*4);ctx.fillStyle='#fffdf2';circle(ctx,0,0,r*.14);ctx.fill();
  }else if(e.type==='supportAura'){
    const r=44*power;ctx.strokeStyle=style.accent;ctx.globalAlpha=fade*.65;ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,10,r,r*.35,0,0,TAU);ctx.stroke();
    for(let i=0;i<count;i++){const a=i*TAU/count+(reducedMotion?0:p),lift=(p*64+i*9)%72;ctx.save();ctx.translate(Math.cos(a)*r*.7,14-lift);ctx.globalAlpha=fade*(.5+Math.sin(a)*.2);ctx.fillStyle=i%2?style.primary:style.accent;if(e.heal){ctx.fillRect(-2,-6,4,12);ctx.fillRect(-6,-2,12,4);}else elementalGlyph(ctx,style.motif,5,a);ctx.restore();}
  }else if(e.type==='beamRibbon'){
    ctx.rotate(e.angle||0);const length=e.length||400,width=e.width||45;ctx.globalAlpha=fade*.65;
    for(const side of [-1,1]){ctx.strokeStyle=side===1?style.primary:style.accent;ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<=24;i++){const x=length*i/24,y=Math.sin(i*.7-p*9)*width*.4*side;i?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}
    for(let i=1;i<=4;i++){ctx.globalAlpha=fade*(.6-i*.07);ctx.strokeStyle=style.accent;ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(length*(i/5),0,width*.18,width*.7,0,0,TAU);ctx.stroke();}
  }else if(e.type==='slashRibbon'){
    ctx.rotate(e.angle||0);const r=(e.r||75)*(1+p*.18);
    for(let i=0;i<3;i++){ctx.globalAlpha=fade*(.8-i*.18);ctx.strokeStyle=i%2?style.accent:style.primary;ctx.lineWidth=(7-i*2)*(1-p*.5);ctx.beginPath();ctx.arc(0,0,r+i*9,-1.25+p*.9,1.15+p*.7);ctx.stroke();}
    ctx.save();ctx.translate(Math.cos(p*2-1)*r,Math.sin(p*2-1)*r);ctx.globalAlpha=fade;ctx.fillStyle=style.accent;star(ctx,11*(1-p)+3);ctx.fill();ctx.restore();
  }
  ctx.restore();return true;
}
export function drawProjectileAura(ctx,p,{time=0,reducedMotion=false}={}){
  if(p.basic||p.trackingBroken)return;
  const style=elementVfxStyle(p.element),r=p.radius||9,angle=Math.atan2(p.vy||0,p.vx||1),length=r*(reducedMotion?4:7);
  ctx.save();ctx.translate(p.x,p.y-12);ctx.rotate(angle);ctx.lineCap='round';
  ctx.fillStyle=style.primary;ctx.globalAlpha=.17;ctx.beginPath();ctx.moveTo(r*1.5,0);ctx.quadraticCurveTo(-r,-r*2,-length,0);ctx.quadraticCurveTo(-r,r*2,r*1.5,0);ctx.fill();
  for(const side of [-1,1]){ctx.globalAlpha=.6;ctx.strokeStyle=side===1?style.primary:style.accent;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-length,0);ctx.bezierCurveTo(-length*.65,side*r*Math.sin(time*14)*1.5,-length*.25,-side*r*.9,r*.5,0);ctx.stroke();}
  for(let i=0;i<(reducedMotion?1:3);i++){ctx.save();ctx.translate(-r*(1.8+i*1.6),Math.sin(time*10+i*2)*r);ctx.rotate(time*2+i);ctx.globalAlpha=.65-i*.15;ctx.fillStyle=i%2?style.primary:style.accent;ctx.strokeStyle=style.accent;ctx.lineWidth=1;elementalGlyph(ctx,style.motif,r*(.35-i*.06),time);ctx.restore();}
  ctx.restore();
}
