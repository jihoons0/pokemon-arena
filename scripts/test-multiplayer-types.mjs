import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {PROTOCOL,applyBattleState} from '../src/net-state.js';
import {Battle} from '../src/battle.js';

// Two real WebSocket clients; no server state or browser hooks are injected.
const endpoint=(process.argv[2]||'http://127.0.0.1:8790').replace(/\/$/,'');
const parties=[['pikachu','charizard','blastoise','venusaur','gengar','dragonite'],['gyarados','steelix','scizor','snorlax','umbreon','mewtwo']];
const peers=[];
async function until(check,label){const end=Date.now()+12000;while(Date.now()<end){const value=check();if(value)return value;await delay(25);}throw new Error('Timed out: '+label);}
async function connect(code,team){
  const p={seq:0,id:0,commands:[],events:new Map(),frames:new Map(),errors:[],move:{x:0,y:0},view:new Battle()};peers.push(p);
  p.ws=new WebSocket(endpoint.replace(/^http/,'ws')+'/rooms/'+code+'/socket');
  p.send=m=>{if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify(m));};
  p.ws.on('open',()=>p.send({type:'hello',v:PROTOCOL,team,special:'haste'}));
  p.ws.on('message',raw=>{
    const m=JSON.parse(raw);
    if(m.type==='welcome')p.welcome=m;
    if(m.type==='prepare')p.send({type:'loaded',game:m.game});
    if(m.type==='error')p.errors.push(m.message||m.error);
    if(m.type==='state'){
      p.state=m;p.commands=p.commands.filter(c=>c.id>m.actionAck);
      for(const e of m.events)p.events.set(e.eventId,e);
      p.frames.set(m.frame,JSON.stringify(m.state));if(p.frames.size>40)p.frames.delete(p.frames.keys().next().value);
      applyBattleState(p.view,m.state,p.welcome.seat===0?'player':'enemy');
    }
  });
  p.ws.on('error',e=>p.errors.push(e.message));
  p.timer=setInterval(()=>{if(p.state)p.send({type:'input',game:p.state.game,seq:++p.seq,...p.move,commands:p.commands,eventAck:Math.max(0,...p.events.keys())});},50);
  p.command=(kind,extra={})=>p.commands.push({kind,...extra,id:++p.id});
  await until(()=>p.welcome,'welcome');return p;
}
try{
  const response=await fetch(endpoint+'/rooms',{method:'POST'}),room=await response.json();assert.equal(response.status,201);
  const a=await connect(room.code,parties[0]),b=await connect(room.code,parties[1]);
  a.send({type:'ready',team:parties[0],special:'haste'});b.send({type:'ready',team:parties[1],special:'haste'});
  await until(()=>a.view.state==='playing'&&b.view.state==='playing','battle');
  a.move={x:1,y:0};b.move={x:-1,y:0};
  const hit=await until(()=>[...a.events.values()].find(e=>e.type==='hit'&&e.team==='player'&&e.basic&&e.effectiveness===4),'electric weakness');
  a.move=b.move={x:0,y:0};assert.equal(hit.stab,1.5);assert.equal(hit.amount,144);
  await until(()=>b.events.has(hit.eventId),'same damage on guest');assert.deepEqual(b.events.get(hit.eventId),hit);
  b.command('party');await until(()=>a.state.pause?.kind==='switch'&&b.state.pause?.kind==='switch','shared switch pause');
  b.command('switch',{index:1});await until(()=>a.view.enemy.id==='steelix'&&a.view.state==='playing','Steelix entered');
  const hp=a.view.enemy.hp;a.command('cast',{key:'q'});
  await until(()=>[...a.events.values()].find(e=>e.type==='immune'&&e.team==='player'&&e.element==='electric'),'electric immunity');
  await delay(300);assert.equal(a.view.enemy.hp,hp);assert.equal(b.view.player.hp,hp);
  const frame=[...a.frames.keys()].reverse().find(f=>b.frames.has(f));assert.ok(frame);assert.equal(a.frames.get(frame),b.frames.get(frame));
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  console.log(JSON.stringify({ok:true,checks:['electric 4x plus STAB = 144 basic damage','identical hit on both clients','shared switch pause','Steelix takes zero electric damage','identical authoritative snapshots']}));
}finally{for(const p of peers){clearInterval(p.timer);p.send({type:'leave'});p.ws.close();}}
