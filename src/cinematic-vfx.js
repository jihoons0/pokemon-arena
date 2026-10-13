import {elementVfxStyle,elementFamily} from './combat-vfx.js';
const TAU=Math.PI*2,clamp=n=>Math.max(0,Math.min(1,n));
const glows=new Map();
const circle=(c,x,y,r)=>{c.beginPath();c.arc(x,y,Math.max(.01,r),0,TAU);};
function glow(c,color,r,alpha){
  // Reuse small light textures; no per-frame gradients, blur filters or allocations.
  if(typeof OffscreenCanvas!=='undefined'&&!glows.has(color)){
    const canvas=new OffscreenCanvas(128,128),g=canvas.getContext('2d'),gradient=g.createRadialGradient(64,64,0,64,64,64);
    gradient.addColorStop(0,color+'c0');gradient.addColorStop(.3,color+'60');gradient.addColorStop(1,color+'00');g.fillStyle=gradient;g.fillRect(0,0,128,128);glows.set(color,canvas);
  }
  c.save();c.globalAlpha*=alpha;
  if(glows.has(color)){c.globalCompositeOperation='lighter';c.drawImage(glows.get(color),-r,-r,r*2,r*2);}
  else{c.fillStyle=color;circle(c,0,0,r*.5);c.fill();}c.restore();
}
function shard(c,x,y,r,angle,color){c.save();c.translate(x,y);c.rotate(angle);c.fillStyle=color;c.beginPath();c.moveTo(0,-r*1.8);c.lineTo(r*.43,0);c.lineTo(0,r*.6);c.lineTo(-r*.43,0);c.closePath();c.fill();c.fillStyle='#f5ffff';c.globalAlpha*=.65;c.beginPath();c.moveTo(0,-r*1.8);c.lineTo(r*.17,0);c.lineTo(0,r*.6);c.closePath();c.fill();c.restore();}
function spark(c,x,y,r,color){c.fillStyle=color;c.beginPath();c.moveTo(x-r,y);c.lineTo(x-r*.15,y-r*.15);c.lineTo(x,y-r);c.lineTo(x+r*.15,y-r*.15);c.lineTo(x+r,y);c.lineTo(x+r*.15,y+r*.15);c.lineTo(x,y+r);c.lineTo(x-r*.15,y+r*.15);c.closePath();c.fill();}
export function drawCinematicVfx(c,e,{time=0,reducedMotion=false,mobile=false}={}){
  if(!['cinematicImpact','groundAfterglow','castCorona'].includes(e.type))return false;
  const p=clamp(1-e.life/Math.max(.001,e.maxLife||e.life)),fade=(1-p)*(1-p),rise=Math.sin(Math.PI*p),style=elementVfxStyle(e.element),family=elementFamily(e.element),power=Math.min(1.7,e.power||1),r=(e.r||64)*power,count=reducedMotion?4:mobile?7:e.ultimate?14:10;
  c.save();c.translate(e.x,e.y);c.lineCap='round';c.lineJoin='round';
  if(e.type==='groundAfterglow'){
    c.scale(1,.45);c.globalAlpha=fade*.45;glow(c,style.primary,r*1.65,.6);
    c.strokeStyle=style.shadow;c.lineWidth=2;c.globalAlpha=fade*.48;
    for(let i=0;i<6;i++){const a=i*TAU/6+.2,d=r*(.4+(i%3)*.15);c.beginPath();c.moveTo(Math.cos(a)*r*.16,Math.sin(a)*r*.16);c.lineTo(Math.cos(a+.13)*d*.6,Math.sin(a+.13)*d*.6);c.lineTo(Math.cos(a)*d,Math.sin(a)*d);c.stroke();}
    c.strokeStyle=style.primary;c.lineWidth=2;c.globalAlpha=fade*.45;c.setLineDash([5,7]);circle(c,0,0,r*(.55+p*.55));c.stroke();
  }else if(e.type==='castCorona'){
    const charge=1-p;c.translate(0,-(e.height||42)*.46);c.globalAlpha=Math.sin(Math.PI*p)*.75;glow(c,style.primary,r*1.7,.7);
    for(let i=0;i<count;i++){const a=i*TAU/count+(reducedMotion?0:p*.75),d=10+charge*r,x=Math.cos(a)*d,y=Math.sin(a)*d*.7;c.strokeStyle=i%2?style.primary:style.accent;c.lineWidth=i%3?2:3;c.beginPath();c.moveTo(x,y);c.lineTo(x+Math.cos(a)*14*charge,y+Math.sin(a)*14*charge);c.stroke();spark(c,x,y,2+3*p,style.accent);}
    c.strokeStyle=style.accent;c.lineWidth=2;c.beginPath();c.ellipse(0,0,8+p*14,5+p*7,e.angle||0,0,TAU);c.stroke();
  }else{
    c.translate(0,-14);c.globalAlpha=fade;glow(c,style.primary,r*2.2,e.ultimate?.85:.65);
    // Ground shock front stays readable beneath the silhouette of the impact.
    c.save();c.translate(0,14);c.scale(1,.4);c.globalAlpha=(1-p)*.7;c.strokeStyle=style.accent;c.lineWidth=3;circle(c,0,0,r*(.35+Math.sqrt(p)*1.25));c.stroke();c.strokeStyle=style.primary;c.lineWidth=6*(1-p)+1;circle(c,0,0,r*(.2+Math.sqrt(p)));c.stroke();c.restore();
    for(let i=0;i<count;i++){
      const a=i*TAU/count+(e.angle||0),speed=.65+(i%3)*.2,d=r*(.15+Math.sqrt(p)*speed),x=Math.cos(a)*d,y=Math.sin(a)*d*.72,size=(10+(i%3)*4)*power*(1-p*.6);
      c.save();c.globalAlpha=(1-p)*.85;c.fillStyle=i%2?style.primary:style.accent;c.strokeStyle=style.accent;c.lineWidth=1.5;
      if(family==='fire'){
        c.translate(x,y-p*r*.35);c.rotate(a*.18);c.beginPath();c.moveTo(-size*.6,size*.3);c.bezierCurveTo(-size*1.1,-size*.6,size*.2,-size*.9,Math.sin(i+p*6)*size*.4,-size*2.5);c.bezierCurveTo(size*1.4,-size*.7,size*.6,size*.5,0,size*.5);c.closePath();c.fill();
        c.fillStyle='#fff3a6';c.beginPath();c.moveTo(-size*.2,size*.2);c.quadraticCurveTo(-size*.3,-size*.8,size*.12,-size*1.3);c.quadraticCurveTo(size*.5,-size*.3,size*.2,size*.2);c.fill();
      }else if(family==='water'){
        c.strokeStyle=i%2?style.accent:style.primary;c.lineWidth=(6+i%3)*power*(1-p*.4);c.beginPath();c.moveTo(Math.cos(a)*12,Math.sin(a)*8);c.quadraticCurveTo(x*.55,y-r*rise*.7,x,y-p*r*.1);c.stroke();c.fillStyle=style.accent;c.beginPath();c.ellipse(x,y-p*r*.1,size*.28,size*.55,a,0,TAU);c.fill();
      }else if(family==='electric'){
        c.rotate(a);for(const [w,color]of [[7,style.shadow],[3,style.primary],[1.3,style.accent]]){c.strokeStyle=color;c.lineWidth=w*power;c.beginPath();c.moveTo(5,0);for(let j=1;j<=6;j++)c.lineTo(d*j/6,Math.sin(i*3+j*5+(reducedMotion?0:Math.floor(time*18)))*size*(j%2?.65:.2));c.stroke();}
      }else if(family==='ice'){
        shard(c,x,y-rise*r*.45,size,a*.3,style.primary);c.globalAlpha*=.5;shard(c,x*.5,y*.8,size*.45,-a,style.accent);
      }else if(family==='physical'){
        if(['rock','ground','steel'].includes(e.element))shard(c,x,y-rise*r*.4,size,a*.45,style.primary);
        else{c.translate(x,y);c.rotate(a);c.fillStyle=i%2?style.accent:style.primary;c.beginPath();c.moveTo(-size*1.2,-size*.14);c.lineTo(size*1.4,0);c.lineTo(-size*.7,size*.3);c.closePath();c.fill();}
      }else if(family==='nature'){
        c.translate(x,y-p*r*.3);c.rotate(a+p*1.8);c.beginPath();c.moveTo(-size,0);c.bezierCurveTo(-size,-size,size,-size,size*1.5,0);c.bezierCurveTo(size,size,-size,size,-size,0);c.fill();c.beginPath();c.moveTo(-size*.6,0);c.lineTo(size,0);c.stroke();
      }else if(family==='toxic'){
        c.globalAlpha*=.6;c.fillStyle=style.shadow;circle(c,x,y-rise*r*.4,size);c.fill();c.strokeStyle=style.primary;c.lineWidth=3;c.stroke();spark(c,x-size*.3,y-rise*r*.4-size*.3,size*.25,style.accent);
      }else if(family==='psychic'||family==='shadow'||family==='dragon'){
        c.rotate(a);c.strokeStyle=i%2?style.primary:style.accent;c.lineWidth=(family==='shadow'?7:4)*power;c.beginPath();c.moveTo(d*.25,0);c.bezierCurveTo(d*.4,-size*2,d,-size*1.7,d,size*.4);c.stroke();spark(c,d,size*.4,size*.6,style.accent);
      }else{
        c.rotate(a);c.strokeStyle=i%2?style.primary:style.accent;c.lineWidth=3;c.beginPath();c.arc(0,0,d,-.55,.15);c.stroke();c.lineWidth=1;c.beginPath();c.arc(0,0,d+5,-.65,.05);c.stroke();
      }
      c.restore();
    }
    c.globalAlpha=Math.max(0,1-p*4)*.9;spark(c,0,0,r*.65*(1-p),'#fff8df');
  }
  c.restore();return true;
}
