import test from 'node:test';
import assert from 'node:assert/strict';
import {Battle} from '../src/battle.js';
import {ROSTER} from '../src/roster.js';
import {PokeballPresentation} from '../src/pokeball-presentation.js';
import {POKEDEX_HEIGHT_METERS} from '../src/pokedex-sizes.js';
import {spriteScaleFor,measureSpritePixels,fighterVisualBounds,WORLD_PIXELS_PER_METER} from '../src/fighter-size.js';
import {BattleCamera,combatBounds} from '../src/battle-camera.js';
import {drawCinematicVfx} from '../src/cinematic-vfx.js';
import {trainerBallPosition} from '../src/trainers.js';
const fixture=()=>new Battle({playerTeam:['charizard','pikachu'],enemyTeam:['blastoise','eevee']});

test('guest perspective recalls to Gold on the right; reset preserves the current seat',()=>{
  const v=new PokeballPresentation();assert.deepEqual(v.ballFor('player'),trainerBallPosition('player'));
  v.setPerspective(true);assert.deepEqual(v.ballFor('player'),trainerBallPosition('enemy'));assert.deepEqual(v.ballFor('enemy'),trainerBallPosition('player'));
  v.reset();assert.deepEqual(v.ballFor('player'),trainerBallPosition('enemy'));v.setPerspective(false);assert.deepEqual(v.ballFor('player'),trainerBallPosition('player'));
});

test('cached dex heights cover every canonical species and normalize padded sheets',()=>{
  assert.equal(Object.keys(POKEDEX_HEIGHT_METERS).length,50);
  for(const def of ROSTER.filter(m=>m.dex))assert.ok(POKEDEX_HEIGHT_METERS[def.id]>0,def.id);
  assert.equal(POKEDEX_HEIGHT_METERS.pikachu,.4);assert.equal(POKEDEX_HEIGHT_METERS.lugia,5.2);assert.equal(POKEDEX_HEIGHT_METERS.steelix,9.2);
  for(const id of ['charizard','mewtwo','lugia'])for(const height of [20,80])assert.equal(spriteScaleFor({id},{height,width:height})*height,POKEDEX_HEIGHT_METERS[id]*WORLD_PIXELS_PER_METER);
  assert.equal(spriteScaleFor({id:'yuna',def:{scale:1.75}},{height:40,width:30}),1.75*.84);
  assert.equal(spriteScaleFor({id:'eevee'},{height:20,width:20})*20,22,'readability floor for tiny species');
});
test('alpha measurement excludes padding and remains relative to each frame foot anchor',()=>{
  const pixels=new Uint8ClampedArray(8*4*4);for(const [x,y]of [[1,1],[2,2],[5,0],[6,2]])pixels[(y*8+x)*4+3]=255;
  const meta={directionCount:1,frameCount:2,frameWidth:4,frameHeight:4},anchors=[[{x:2,y:3},{x:2,y:3}]];
  assert.deepEqual(measureSpritePixels(pixels,8,meta,anchors),{left:-1,right:1,top:-3,bottom:0,width:2,height:3});
  assert.equal(measureSpritePixels(new Uint8ClampedArray(128),8,meta,anchors),null);
});
test('faint recall completes during forced selection, hides the corpse, and does not mutate battle',()=>{
  const b=fixture(),v=new PokeballPresentation();b.state='playing';b.faint(b.player);
  const checkpoint=JSON.stringify(b);for(const event of b.drainEvents())v.event(event,b);
  const afterEvents=JSON.stringify(b);assert.equal(b.state,'switching');assert.ok(v.isRecalling('player'));assert.deepEqual(v.appearance(b.player),{hidden:true});
  v.update(.4);assert.ok(v.isRecalling('player'));v.update(.5);assert.equal(v.isRecalling('player'),false);assert.equal(v.transitions.size,0);assert.equal(JSON.stringify(b),afterEvents);assert.ok(checkpoint.length>0);
});
test('manual switch recalls the old member then reveals the live incoming member within protection',()=>{
  const b=fixture(),v=new PokeballPresentation();b.state='playing';assert.ok(b.requestSwitch());assert.ok(b.switchPokemon(1));
  for(const e of b.drainEvents())v.event(e,b);assert.ok(v.isRecalling('player'));assert.ok(v.appearance(b.player).hidden);
  v.update(.34);assert.equal(v.isRecalling('player'),false);assert.ok(v.appearance(b.player).appearScale>0);v.update(.21);assert.deepEqual(v.appearance(b.player),{});assert.ok(b.player.invul>=.55);
});
test('forced send-out does not replay recall, user pause freezes intros, reset removes timelines',()=>{
  const b=fixture(),v=new PokeballPresentation();v.event({type:'start'},b);v.update(.2);const before=v.transitions.get('player').elapsed;v.update(5,{paused:true});assert.equal(v.transitions.get('player').elapsed,before);
  b.state='playing';b.faint(b.player);b.drainEvents();b.switchPokemon(1);for(const e of b.drainEvents())v.event(e,b);assert.equal(v.isRecalling('player'),false);v.update(.41);assert.deepEqual(v.appearance(b.player),{});v.event({type:'reset'},b);assert.equal(v.transitions.size,0);
});
test('portrait and landscape cameras frame giant silhouettes as well as small fighters',()=>{
  const sprites={lugia:{metrics:{left:-52,right:52,top:-70,bottom:5,height:75,width:104}},pikachu:{metrics:{left:-12,right:12,top:-28,bottom:2,height:30,width:24}}};
  const fs=[{id:'lugia',x:200,y:260,radius:28},{id:'pikachu',x:1050,y:520,radius:18}].map(f=>({...f,visualBounds:fighterVisualBounds(f,sprites)}));
  for(const [w,h]of [[390,620],[844,390],[1280,720]]){
    const camera=new BattleCamera();camera.resize(w,h,{mobile:w!==1280,insets:{top:105,bottom:20}});camera.update(0,fs);const f=camera.frame(),b=combatBounds(fs,{anticipate:false}),a=f.area;
    assert.ok(b.left*f.scale+f.offsetX>=a.x-.01);assert.ok(b.right*f.scale+f.offsetX<=a.x+a.width+.01);assert.ok(b.top*f.scale+f.offsetY>=a.y-.01);assert.ok(b.bottom*f.scale+f.offsetY<=a.y+a.height+.01);
  }
});
test('every elemental impact has finite geometry on mobile and reduced-motion settings',()=>{
  const ctx=new Proxy({globalAlpha:1},{get:(o,k)=>k in o?o[k]:(...args)=>{for(const arg of args)if(typeof arg==='number')assert.ok(Number.isFinite(arg),String(k));},set:(o,k,v)=>(o[k]=v,true)});
  for(const element of new Set(ROSTER.flatMap(m=>[m.type,...Object.values(m.moves).map(x=>x.element)]).filter(Boolean)))for(const p of [0,.2,.65,1])for(const reducedMotion of [false,true])for(const type of ['cinematicImpact','groundAfterglow','castCorona']){
    assert.ok(drawCinematicVfx(ctx,{type,element,x:450,y:420,life:1-p,maxLife:1,power:1.5,ultimate:true},{time:2,mobile:true,reducedMotion}));
  }
});
