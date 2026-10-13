// Original editable pixel artwork. Feet and ball anchors share one coordinate system.
export const TRAINER_POSITIONS=Object.freeze({player:{x:100,y:408},enemy:{x:1180,y:408}});
export function trainerBallPosition(team){const p=TRAINER_POSITIONS[team]||TRAINER_POSITIONS.player;return {x:p.x+(team==='enemy'?-1:1)*25,y:p.y-44};}
const palettes={
  player:{cap:'#da3549',capLight:'#ff6670',capShade:'#84283e',shirt:'#e74353',light:'#fc7973',pants:'#395a8b',pantsLight:'#6285b4'},
  enemy:{cap:'#e8b72e',capLight:'#ffe17a',capShade:'#9d7227',shirt:'#dc423d',light:'#ff8268',pants:'#28384d',pantsLight:'#52617a'},
};
function pixelCharacter(c,team,time,active,reducedMotion){
  const p=palettes[team],outline='#202b42',skin='#edb68b',skinLight='#ffe0ad',skinShade='#b47769';
  const box=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
  const poly=(points,color)=>{c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
  // Boots, knees, contrasting trouser seams.
  box(-9,-13,8,12,outline);box(2,-13,8,12,outline);box(-8,-13,6,9,p.pants);box(3,-13,6,9,p.pants);
  box(-8,-12,2,7,p.pantsLight);box(3,-12,2,6,p.pantsLight);
  if(team==='enemy'){box(-8,-8,5,4,skin);box(4,-8,4,4,skin);box(-8,-9,6,2,p.pantsLight);}
  box(-10,-4,10,4,outline);box(2,-4,11,4,outline);box(-9,-4,7,2,p.cap);box(4,-4,7,2,p.cap);box(-10,-1,10,1,'#f1e5d5');box(3,-1,10,1,'#f1e5d5');
  // Backpack with flap and straps.
  box(-13,-28,7,15,outline);box(-12,-27,5,12,'#ac782f');box(-12,-27,5,3,'#f9d566');box(-12,-21,2,5,'#e7b348');box(-11,-14,4,1,'#f7d470');
  poly([[-8,-29],[5,-30],[10,-25],[9,-13],[-9,-13],[-11,-24]],outline);
  box(-7,-28,12,14,p.shirt);box(-7,-27,3,12,p.light);box(4,-26,3,11,p.capShade);box(-2,-27,5,14,'#283847');
  box(-3,-27,7,3,'#fff0d1');box(-1,-24,3,9,'#182534');box(-7,-16,4,2,'#ffc794');box(4,-16,3,2,'#aa313d');box(-7,-13,14,2,'#243349');box(-1,-13,3,2,'#e6be64');
  // Back arm and fingerless glove.
  box(-12,-25,5,11,outline);box(-11,-25,3,5,p.light);box(-11,-20,3,4,skin);box(-11,-16,4,3,'#313747');box(-10,-14,3,1,skinLight);
  // Face in three-quarter profile, ear, shaded jaw, separated eyes.
  poly([[-8,-40],[6,-42],[10,-36],[11,-29],[6,-26],[-4,-27],[-8,-32]],outline);
  box(-5,-37,12,8,skin);box(-3,-35,10,7,skinLight);box(7,-34,3,4,skin);box(6,-29,3,2,skinShade);box(-5,-36,3,7,skinShade);box(-7,-33,3,4,skin);box(-6,-32,1,2,skinLight);
  box(1,-34,2,3,'#fff5dc');box(3,-34,2,3,outline);box(7,-34,1,2,outline);box(4,-28,3,1,'#975760');
  box(-7,-39,12,3,'#273143');box(-7,-36,3,4,'#263042');box(-5,-36,3,2,'#384455');box(-2,-37,3,2,'#1d2937');box(6,-37,3,2,'#222c39');
  // Red's forward cap versus Gold's backwards yellow/black cap.
  poly([[-9,-40],[-7,-45],[4,-47],[10,-43],[10,-38],[-7,-37]],outline);
  box(-7,-43,14,5,team==='enemy'?'#303b4d':p.cap);box(-5,-45,9,3,team==='enemy'?'#3f4b59':p.capLight);
  if(team==='player'){box(2,-43,6,5,'#fff3d6');box(4,-42,2,2,p.cap);box(-6,-39,7,1,p.capShade);box(6,-39,9,2,outline);box(7,-39,7,1,p.cap);}
  else{box(-7,-43,5,6,p.cap);box(-5,-45,4,2,p.capLight);box(-12,-40,7,3,outline);box(-12,-40,6,1,p.cap);box(4,-40,4,2,p.capLight);box(5,-41,2,1,'#967438');}
  // Forward arm raises slightly to command / recall, while feet stay planted.
  c.save();c.translate(7,-25);if(active&&!reducedMotion)c.rotate(-.12-Math.sin(time*8)*.06);
  box(0,-2,6,6,outline);box(0,-2,4,4,p.light);box(4,0,5,4,outline);box(4,0,4,2,skinLight);box(7,-2,3,4,skin);box(8,-2,2,2,skinLight);
  c.restore();
}
export function drawTrainers(ctx,time,{activeTeams=[],reducedMotion=false}={}){
  for(const team of ['player','enemy']){
    const p=TRAINER_POSITIONS[team],active=activeTeams.includes(team);
    ctx.save();ctx.fillStyle='#273c6459';ctx.beginPath();ctx.ellipse(p.x,p.y+3,21,7,0,0,Math.PI*2);ctx.fill();
    ctx.translate(p.x,p.y);ctx.scale(team==='enemy'?-1.65:1.65,1.65);
    if(!reducedMotion)ctx.translate(0,Math.sin(time*2.2+(team==='enemy'?2:0))*.35);
    pixelCharacter(ctx,team,time,active,reducedMotion);ctx.restore();
    const ball=trainerBallPosition(team);drawPokeball(ctx,ball.x,ball.y,4.4,0,active?1:.9);
  }
}
export function drawPokeball(ctx,x,y,r=7,rotation=0,alpha=1){
  ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha*=alpha;ctx.lineWidth=Math.max(1,r*.18);ctx.strokeStyle='#25334b';
  ctx.fillStyle='#f04a62';ctx.beginPath();ctx.arc(0,0,r,Math.PI,Math.PI*2);ctx.fill();ctx.fillStyle='#fff9e5';ctx.beginPath();ctx.arc(0,0,r,0,Math.PI);ctx.fill();
  ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.moveTo(-r,0);ctx.lineTo(r,0);ctx.stroke();ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(0,0,r*.27,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();
}
