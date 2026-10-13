const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const finite=(n,fallback=0)=>Number.isFinite(n)?n:fallback;

// Render-only camera: world positions, aiming, and network state never change.
export function combatBounds(fighters,{anticipate=true,hazards=[]}={}){
  const active=fighters.filter(f=>f&&Number.isFinite(f.x)&&Number.isFinite(f.y));
  if(!active.length)return {left:160,right:1120,top:150,bottom:600};
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(const f of active){
    const radius=f.radius||f.def?.radius||24,pad=radius+32,height=Math.max(90,radius*3.2+30),v=f.visualBounds;
    const l=v?Math.min(-pad,v.left-24):-pad,r=v?Math.max(pad,v.right+24):pad,t=v?Math.min(-height,v.top-36):-height,bt=v?Math.max(radius+24,v.bottom+24):radius+24;
    const dx=anticipate?clamp(finite(f.vx)*.18,-65,65):0,dy=anticipate?clamp(finite(f.vy)*.18,-45,45):0;
    left=Math.min(left,f.x+l,f.x+dx+l);right=Math.max(right,f.x+r,f.x+dx+r);
    top=Math.min(top,f.y+t,f.y+dy+t);bottom=Math.max(bottom,f.y+bt,f.y+dy+bt);
  }
  for(const h of hazards){
    if(!Number.isFinite(h.x)||!Number.isFinite(h.y)||!(h.delay>0))continue;
    const r=Math.min(180,h.r||60);
    if(!active.some(f=>Math.hypot(f.x-h.x,f.y-h.y)<r+100))continue;
    left=Math.min(left,Math.max(30,h.x-r));right=Math.max(right,Math.min(1250,h.x+r));
    top=Math.min(top,Math.max(40,h.y-r*.7));bottom=Math.max(bottom,Math.min(690,h.y+r*.7));
  }
  return {left,right,top,bottom};
}

export class BattleCamera {
  constructor(){this.width=1280;this.height=720;this.mobile=false;this.insets={};this.ready=false;this.x=640;this.y=360;this.scale=1;}
  resize(width,height,{mobile=false,insets={}}={}){
    width=Math.max(1,finite(width,1280));height=Math.max(1,finite(height,720));
    if(width!==this.width||height!==this.height||mobile!==this.mobile)this.ready=false;
    this.width=width;this.height=height;this.mobile=mobile;this.insets=insets;
  }
  reset(){this.ready=false;}
  update(dt,fighters,{reducedMotion=false,hazards=[]}={}){
    const w=this.width,h=this.height;
    if(!this.mobile){
      const b=combatBounds(fighters,{anticipate:false}),hasVisual=fighters.some(f=>f?.visualBounds);
      const top=hasVisual?Math.min(0,b.top-105):0,left=hasVisual?Math.min(0,b.left):0,right=hasVisual?Math.max(1280,b.right):1280;
      this.x=(left+right)/2;this.y=(top+720)/2;this.scale=Math.min(w/(right-left),h/(720-top));this.area={x:0,y:0,width:w,height:h};this.ready=true;return this.frame();
    }
    const inset=this.insets,left=clamp(finite(inset.left,12),0,w*.32),right=clamp(finite(inset.right,12),0,w*.32);
    const top=clamp(finite(inset.top,100),0,h*.4),bottom=clamp(finite(inset.bottom,16),0,h*.25);
    const area=this.area={x:left,y:top,width:Math.max(1,w-left-right),height:Math.max(1,h-top-bottom)};
    const visual=fighters.map(f=>f?.visualBounds).filter(Boolean);
    const bounds=reducedMotion?{left:Math.min(45,...visual.map(v=>154+v.left-24)),right:Math.max(1235,...visual.map(v=>1126+v.right+24)),top:Math.min(70,...visual.map(v=>240+v.top-36)),bottom:Math.max(675,...visual.map(v=>548+v.bottom+24))}:combatBounds(fighters,{hazards});
    const targetScale=Math.min(area.width/Math.max(420,bounds.right-bounds.left+40),area.height/Math.max(240,bounds.bottom-bounds.top+30));
    const targetX=(bounds.left+bounds.right)/2,targetY=(bounds.top+bounds.bottom)/2;
    if(!this.ready||reducedMotion){this.x=targetX;this.y=targetY;this.scale=targetScale;this.ready=true;}
    else{
      const step=clamp(finite(dt),0,.1),pan=1-Math.exp(-7*step),zoom=1-Math.exp(-(targetScale<this.scale?12:2.2)*step);
      this.x+=(targetX-this.x)*pan;this.y+=(targetY-this.y)*pan;this.scale+=(targetScale-this.scale)*zoom;
      // A sudden dash / reconnect can outrun interpolation. Never crop a fighter.
      const required=combatBounds(fighters,{anticipate:false,hazards});
      this.scale=Math.min(this.scale,area.width/Math.max(1,required.right-required.left),area.height/Math.max(1,required.bottom-required.top));
      const halfW=area.width/(2*this.scale),halfH=area.height/(2*this.scale);
      this.x=clamp(this.x,required.right-halfW,required.left+halfW);
      this.y=clamp(this.y,required.bottom-halfH,required.top+halfH);
    }
    return this.frame();
  }
  frame(){
    const a=this.area||{x:0,y:0,width:this.width,height:this.height},offsetX=a.x+a.width/2-this.x*this.scale,offsetY=a.y+a.height/2-this.y*this.scale;
    return {x:this.x,y:this.y,scale:this.scale,offsetX,offsetY,width:this.width,height:this.height,zoom:this.scale/Math.min(this.width/1280,this.height/720),area:{...a},world:{left:-offsetX/this.scale,top:-offsetY/this.scale,right:(this.width-offsetX)/this.scale,bottom:(this.height-offsetY)/this.scale}};
  }
}
