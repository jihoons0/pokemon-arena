// MVP uses server-recorded HP damage and knockouts. Stable roster-order tie breaks.
export function pickMvp(team,stats={}){
  return team.map((fighter,index)=>{
    const value=stats.byPokemon?.[fighter.id]||{},damage=Math.max(0,Number(value.damage)||0),knockouts=Math.max(0,Number(value.knockouts)||0);
    return {id:fighter.id,index,damage,knockouts,score:damage+knockouts*300};
  }).filter(entry=>entry.score>0).sort((a,b)=>b.score-a.score||b.damage-a.damage||a.index-b.index)[0]||null;
}

export class VictoryConfetti {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.pieces=[];this.elapsed=0;this.width=0;this.height=0;}
  start({won,reducedMotion=false,width=400,height=800}={}){
    this.stop();if(!won||reducedMotion)return;
    this.width=width;this.height=height;this.canvas.width=Math.round(width*1.5);this.canvas.height=Math.round(height*1.5);
    const colors=['#ffe17e','#75e9e0','#ff91ba','#ab98ff','#fff8dd'],count=width<600?72:110;
    this.pieces=Array.from({length:count},(_,i)=>({x:width/2,y:height*.23,vx:(Math.random()-.5)*width*1.15,vy:-100-Math.random()*280,angle:Math.random()*6.28,spin:(Math.random()-.5)*7,size:4+Math.random()*5,color:colors[i%colors.length],delay:(i%3)*.22}));
  }
  stop(){this.pieces=[];this.elapsed=0;this.ctx?.clearRect(0,0,this.canvas.width,this.canvas.height);}
  update(dt){
    if(!this.pieces.length||!this.ctx)return;this.elapsed+=dt;const c=this.ctx;c.save();c.setTransform(1.5,0,0,1.5,0,0);c.clearRect(0,0,this.width,this.height);
    for(const p of this.pieces){if(this.elapsed<p.delay)continue;p.vy+=210*dt;p.vx*=Math.max(0,1-dt*.12);p.x+=p.vx*dt;p.y+=p.vy*dt;p.angle+=p.spin*dt;c.save();c.translate(p.x,p.y);c.rotate(p.angle);c.globalAlpha=Math.min(1,Math.max(0,7-this.elapsed));c.fillStyle=p.color;c.fillRect(-p.size/2,-p.size/2,p.size,p.size*.5*Math.cos(p.angle));c.restore();}
    c.restore();if(this.elapsed>7)this.stop();
  }
}

// In a doubles match the celebration and MVP cover both allied trainers.
export function teamResult(battle){
  const sides=battle.sides.filter(side=>battle.isAllied('player',side)),stats={byPokemon:{}};
  for(const side of sides)for(const [key,value]of Object.entries(battle.statsFor(side))){
    if(typeof value==='number')stats[key]=(stats[key]||0)+value;
    else if(key==='byPokemon')for(const [id,contribution]of Object.entries(value||{})){
      const total=stats.byPokemon[id]||={damage:0,knockouts:0};total.damage+=contribution.damage||0;total.knockouts+=contribution.knockouts||0;
    }
  }
  return {party:sides.flatMap(side=>battle.teams[side]),stats};
}
