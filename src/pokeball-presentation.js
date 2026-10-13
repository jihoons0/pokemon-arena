import {drawFighter} from './sprites.js';
import {fighterVisualBounds} from './fighter-size.js';
import {drawPokeball,trainerBallPosition} from './trainers.js';
const clamp=n=>Math.max(0,Math.min(1,n)),TAU=Math.PI*2;
const key=f=>`${f.team}:${f.index??0}:${f.id}`;
const circle=(c,x,y,r)=>{c.beginPath();c.arc(x,y,Math.max(.01,r),0,TAU);};

// Cosmetic timeline only: never delays authoritative combat, switches or countdowns.
export class PokeballPresentation{
  constructor(){this.transitions=new Map();this.setPerspective(false);}
  setPerspective(reverse,seat=reverse?1:0,count=2){
    const sides=['player','enemy','ally','rival'],opponent=1-seat%2;this.teamSize=count/2;
    this.trainerSides=count===4?Object.fromEntries([seat,opponent,(seat+2)%4,opponent+2].map((remote,i)=>[sides[i],sides[remote]])):reverse?{player:'enemy',enemy:'player'}:{player:'player',enemy:'enemy'};
  }
  ballFor(team){return trainerBallPosition(this.trainerSides[team]||team,this.teamSize);}
  reset(){this.transitions.clear();}
  event(e,battle){
    if(e.type==='reset'){this.reset();return;}
    if(e.type==='start')for(const team of battle.sides||['player','enemy']){const f=battle.source?.(team)||battle[team];if(f)this.transitions.set(team,{team,incoming:{...f},elapsed:0,releaseAt:0,duration:1.05});}
    if(e.type==='faint'){
      const f=battle.teams?.[e.team]?.[e.index]||battle[e.team];
      if(f)this.transitions.set(e.team,{team:e.team,outgoing:{...f,x:e.x,y:e.y},elapsed:0,recallDuration:.85,duration:.85});
    }
    if(e.type==='switch'){
      const f=battle.source?.(e.team)||battle[e.team],old=battle.teams?.[e.team]?.[e.fromIndex];if(!f)return;
      const recall=!e.forced&&old?.hp>0;
      this.transitions.set(e.team,{team:e.team,incoming:{...f},outgoing:recall?{...old,x:e.x,y:e.y}:null,elapsed:0,recallDuration:recall?.18:0,releaseAt:recall?.18:0,duration:recall?.54:.4});
    }
  }
  update(dt,{paused=false}={}){if(paused)return;for(const [team,t]of this.transitions){t.elapsed+=Math.max(0,dt);if(t.elapsed>=t.duration)this.transitions.delete(team);}}
  isRecalling(team){const t=this.transitions.get(team);return !!(t?.outgoing&&t.elapsed<t.recallDuration);}
  appearance(f){
    if(f.hp<=0)return {hidden:true};
    const t=this.transitions.get(f.team);if(!t?.incoming||key(t.incoming)!==key(f))return {};
    const p=clamp((t.elapsed-t.releaseAt)/Math.max(.01,t.duration-t.releaseAt));
    if(p<.34)return {hidden:true};
    const reveal=clamp((p-.34)/.34);return {appearScale:.08+.92*reveal,alpha:Math.min(1,reveal*2),tint:reveal<.8?'release':null};
  }
  draw(ctx,sprites,{reducedMotion=false}={}){
    for(const t of this.transitions.values()){
      const ball=this.ballFor(t.team);
      if(t.outgoing&&t.elapsed<t.recallDuration){
        const p=clamp(t.elapsed/t.recallDuration),f=t.outgoing,bounds=fighterVisualBounds(f,sprites),center={x:f.x,y:f.y+bounds.top*.48};
        const shrink=clamp((p-.15)/.6),travel=shrink*shrink;
        if(p<.79)drawFighter(ctx,sprites,{...f,x:f.x+(ball.x-f.x)*travel,y:f.y+(ball.y-f.y)*travel,animTime:t.elapsed},{worldScale:true,ghost:true,appearScale:Math.max(.025,1-shrink),alpha:1-clamp((p-.64)/.18),tint:p>.14?'recall':null});
        ctx.save();const beamAlpha=Math.sin(Math.PI*clamp((p-.08)/.88));ctx.globalAlpha=Math.max(0,beamAlpha);ctx.lineCap='round';
        const end={x:center.x+(ball.x-center.x)*travel,y:center.y+(ball.y-center.y)*travel};
        if(!reducedMotion){ctx.fillStyle='#ff496d';ctx.globalAlpha*=.13;ctx.beginPath();ctx.moveTo(ball.x,ball.y);ctx.lineTo(center.x-16*(1-shrink),center.y+14);ctx.lineTo(center.x+16*(1-shrink),center.y-14);ctx.closePath();ctx.fill();ctx.globalAlpha=beamAlpha;}
        for(const [w,color,a]of [[14,'#ff2e64',.16],[6,'#ff436a',.65],[2,'#fff0e7',1]]){ctx.strokeStyle=color;ctx.lineWidth=w;ctx.globalAlpha=beamAlpha*a;ctx.beginPath();ctx.moveTo(ball.x,ball.y);ctx.lineTo(end.x,end.y);ctx.stroke();}
        ctx.fillStyle='#ffb4c0';ctx.globalAlpha=beamAlpha;circle(ctx,end.x,end.y,5+10*(1-shrink));ctx.fill();
        for(let i=0;i<(reducedMotion?3:8);i++){const q=(p*2+i/8)%1,x=center.x+(ball.x-center.x)*q,y=center.y+(ball.y-center.y)*q;ctx.fillStyle=i%2?'#fff7e9':'#ff7697';circle(ctx,x,y,1.5+(1-q)*2);ctx.fill();}
        ctx.restore();
      }
      if(t.incoming&&t.elapsed>=t.releaseAt){
        const f=t.incoming,p=clamp((t.elapsed-t.releaseAt)/(t.duration-t.releaseAt));
        const target={x:f.x,y:f.y-18},flight=clamp(p/.34),x=ball.x+(target.x-ball.x)*flight,y=ball.y+(target.y-ball.y)*flight-(reducedMotion?0:Math.sin(flight*Math.PI)*74);
        if(p<.36)drawPokeball(ctx,x,y,7,flight*TAU*1.5);
        else{
          const q=clamp((p-.34)/.66),fade=1-q,r=20+Math.sqrt(q)*64;
          ctx.save();ctx.translate(target.x,target.y);ctx.lineCap='round';
          for(const [radius,color,a]of [[r*1.4,'#79ddff',.1],[r,'#bdeeff',.2],[r*.57,'#fff4c7',.7]]){ctx.globalAlpha=fade*a;ctx.fillStyle=color;circle(ctx,0,0,radius);ctx.fill();}
          ctx.globalAlpha=fade;ctx.strokeStyle='#fffbe3';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,18,r,r*.35,0,0,TAU);ctx.stroke();
          for(let i=0;i<(reducedMotion?5:12);i++){const a=i*TAU/12,inner=12+q*35,outer=inner+22*fade;ctx.globalAlpha=fade;ctx.strokeStyle=i%2?'#5dcfff':'#fff8c8';ctx.lineWidth=i%3?2:4;ctx.beginPath();ctx.moveTo(Math.cos(a)*inner,Math.sin(a)*inner);ctx.lineTo(Math.cos(a)*outer,Math.sin(a)*outer);ctx.stroke();const sx=Math.cos(a)*r,sy=Math.sin(a)*r;ctx.fillStyle='#fffcef';ctx.fillRect(sx-2,sy-5,4,10);ctx.fillRect(sx-5,sy-2,10,4);}
          ctx.restore();
        }
      }
    }
  }
}
