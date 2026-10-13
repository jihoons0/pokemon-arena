import {POKEDEX_HEIGHT_METERS} from './pokedex-sizes.js';

export const WORLD_PIXELS_PER_METER=42;
// Dex values for serpents describe their extended length. Their PMD idle poses
// fold that body back on itself; use an estimated unfolded silhouette length.
const FOLDED_BODY_LENGTH={steelix:2.2,gyarados:2};

export function spriteScaleFor(fighter,metrics){
  const legacy=fighter?.def?.scale??fighter?.scale??2;
  // Match the visible silhouette, not Yuna's larger source sprite cells.
  if(fighter?.id==='yuna'&&metrics?.height)return Math.max(22,POKEDEX_HEIGHT_METERS.pikachu*WORLD_PIXELS_PER_METER)*1.15/metrics.height;
  const meters=POKEDEX_HEIGHT_METERS[fighter?.id];
  if(!meters||!metrics?.height)return legacy;
  const nativeExtent=FOLDED_BODY_LENGTH[fighter.id]
    ?Math.max(metrics.width,metrics.height)*FOLDED_BODY_LENGTH[fighter.id]:metrics.height;
  return Math.max(22,meters*WORLD_PIXELS_PER_METER)/nativeExtent;
}

export function fighterVisualBounds(fighter,sprites){
  const metrics=sprites?.[fighter?.id]?.metrics;
  const scale=spriteScaleFor(fighter,metrics);
  if(!metrics){const r=fighter?.radius||22;return {left:-r-10,right:r+10,top:-Math.max(54,r*2.7),bottom:8,scale};}
  return {left:metrics.left*scale,right:metrics.right*scale,top:metrics.top*scale,bottom:metrics.bottom*scale,scale};
}

// Alpha bounds relative to the feet, not the padded dimensions of a sprite sheet.
export function measureSpritePixels(data,width,meta,anchors){
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(let row=0;row<meta.directionCount;row++)for(let col=0;col<meta.frameCount;col++){
    const anchor=anchors?.[row]?.[col]||{x:meta.frameWidth/2,y:meta.frameHeight-4};
    for(let y=0;y<meta.frameHeight;y++)for(let x=0;x<meta.frameWidth;x++){
      if(data[((row*meta.frameHeight+y)*width+col*meta.frameWidth+x)*4+3]<96)continue;
      left=Math.min(left,x-anchor.x);right=Math.max(right,x+1-anchor.x);
      top=Math.min(top,y-anchor.y);bottom=Math.max(bottom,y+1-anchor.y);
    }
  }
  return Number.isFinite(left)?{left,right,top,bottom,width:right-left,height:bottom-top}:null;
}
