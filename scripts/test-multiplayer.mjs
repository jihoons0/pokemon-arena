import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {PROTOCOL} from '../src/net-state.js';

// Exercises the real Worker / Durable Object / WebSocket path, with no browser hooks.
const endpoint=(process.argv[2]||'http://127.0.0.1:8787').replace(/\/$/,'');
const team=['pikachu','charizard','blastoise','venusaur','gengar','dragonite'];
const peers=[];
async function until(check,label,ms=8000){
  const end=Date.now()+ms;
  while(Date.now()<end){const value=check();if(value)return value;await delay(20);}
  throw new Error('Timed out: '+label);
}
async function peer(code,token){
  const p={seq:0,cmd:0,commands:[],state:null,errors:[],rtts:[],bytes:0,frames:new Map(),move:{x:0,y:0}};
  peers.push(p);
  p.ws=new WebSocket(endpoint.replace(/^http/,'ws')+'/rooms/'+code+'/socket');
  p.send=data=>{if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify(data));};
  p.ws.on('open',()=>p.send({type:'hello',v:PROTOCOL,team,special:'haste',token}));
  p.ws.on('message',raw=>{
    p.bytes+=raw.length;const m=JSON.parse(raw);
    if(m.type==='welcome')p.welcome=m;
    if(m.type==='lobby')p.lobby=m;
    if(m.type==='prepare')p.send({type:'loaded',game:m.game});
    if(m.type==='pong')p.rtts.push(performance.now()-m.at);
    if(m.type==='error')p.errors.push(m);
    if(m.type==='state'){
      p.state=m;p.commands=p.commands.filter(c=>c.id>m.actionAck);
      p.frames.set(m.frame,JSON.stringify(m.state));if(p.frames.size>20)p.frames.delete(p.frames.keys().next().value);
    }
  });
  p.ws.on('error',error=>p.errors.push({message:error.message}));
  p.timer=setInterval(()=>{
    if(p.state&&p.lobby?.phase==='playing')p.send({type:'input',game:p.state.game,seq:++p.seq,...p.move,commands:p.commands,eventAck:p.state.events.at(-1)?.eventId||0});
  },50);
  p.command=(kind,extra={})=>p.commands.push({kind,...extra,id:++p.cmd});
  await until(()=>p.welcome||p.errors.length,'join');
  return p;
}

async function smoke(){
  const health=await fetch(endpoint+'/health').then(r=>r.json());assert.equal(health.maxPlayersPerRoom,4);assert.equal(health.protocol,PROTOCOL);
  const response=await fetch(endpoint+'/rooms',{method:'POST'}),room=await response.json();assert.equal(response.status,201,room.error);
  const a=await peer(room.code),b=await peer(room.code);
  assert.equal(a.welcome.seat,0);assert.equal(b.welcome.seat,1);
  a.send({type:'ready',team,special:'haste'});b.send({type:'ready',team,special:'haste'});
  await until(()=>a.state?.state.s==='playing'&&b.state?.state.s==='playing','both loaded and countdown');
  for(let i=0;i<5;i++){a.send({type:'ping',at:performance.now()});b.send({type:'ping',at:performance.now()});await delay(100);}
  a.move={x:1,y:0};b.move={x:-1,y:0};await delay(600);a.move={x:0,y:0};b.move={x:0,y:0};
  a.command('cast',{key:'q'});b.command('cast',{key:'d'});await delay(250);
  a.command('pause');await until(()=>a.state?.pause?.kind==='pause'&&b.state?.pause?.kind==='pause','global pause');
  assert.ok(a.state.pause.remainingMs>59000);const frozen=a.state.state.t;
  await delay(300);assert.equal(a.state.state.t,frozen);assert.equal(b.state.state.t,frozen);
  b.command('resume');await until(()=>a.state.state.s==='countdown'&&b.state.state.s==='countdown','global resume countdown');
  assert.ok(a.state.state.c>2.7);
  await until(()=>a.state.state.s==='playing'&&b.state.state.s==='playing','resume');
  b.command('party');await until(()=>a.state.pause?.kind==='switch'&&b.state.pause?.kind==='switch','global switch pause');
  assert.ok(b.state.pause.remainingMs>14000);b.command('switch',{index:1});
  await until(()=>a.state.state.a.enemy===1&&b.state.state.a.enemy===1,'server accepted switch');
  assert.equal(a.state.state.s,'countdown');
  await until(()=>a.state.state.s==='playing','second countdown');
  const common=[...a.frames.keys()].find(frame=>b.frames.has(frame));assert.ok(common);assert.equal(a.frames.get(common),b.frames.get(common));
  const resumeToken=b.welcome.token;b.ws.close();clearInterval(b.timer);
  await until(()=>a.lobby?.players[1]?.connected===false,'disconnect');
  const restored=await peer(room.code,resumeToken);assert.equal(restored.welcome.seat,1);
  await until(()=>restored.state?.state.s==='playing','reconnected battle');
  const extra=await peer(room.code);assert.equal(extra.errors[0]?.fatal,true);
  a.send({type:'leave'});
  await until(()=>restored.state?.state.s==='lost','forfeit propagated');
  assert.equal(restored.state.reason,'상대가 방을 나갔습니다.');
  assert.equal(a.errors.length,0);assert.equal(b.errors.length,0);assert.equal(restored.errors.length,0);
  console.log(JSON.stringify({ok:true,checks:['two peers','asset readiness','3s countdown','20Hz inputs','cast/dodge','global pause','resume','15s switch limit','switch countdown','identical state','reconnect','third player rejected','forfeit'],rttMs:a.rtts.map(Math.round),averageSnapshotBytes:Math.round(a.bytes/Math.max(1,a.seq))}));
}
async function load(){
  const all=[];
  for(let i=0;i<5;i++){
    const response=await fetch(endpoint+'/rooms',{method:'POST'}),room=await response.json();assert.equal(response.status,201,room.error);
    const a=await peer(room.code),b=await peer(room.code);all.push(a,b);
    a.send({type:'ready',team,special:'haste'});b.send({type:'ready',team,special:'haste'});
  }
  await until(()=>all.every(p=>p.state?.state.s==='playing'),'10 players in battle');
  const start=Date.now(),frames=all.map(p=>p.state.frame);
  for(let tick=0;tick<20;tick++){
    for(const p of all){
      p.move={x:Math.sin(tick)*.5,y:Math.cos(tick)*.5};p.send({type:'ping',at:performance.now()});
      if(tick%3===0)p.command('cast',{key:'q'});if(tick%4===0)p.command('cast',{key:'d'});
    }
    await delay(1000);
  }
  for(const p of all)assert.equal(p.errors.length,0,p.errors[0]?.message);
  const rates=all.map((p,i)=>Math.round((p.state.frame-frames[i])/((Date.now()-start)/1000)));
  assert.ok(rates.every(hz=>hz>=55&&hz<=65),JSON.stringify(rates));
  const rtts=all.flatMap(p=>p.rtts).sort((a,b)=>a-b);
  console.log(JSON.stringify({ok:true,players:all.length,rooms:5,seconds:20,simulationHz:rates,rttMedianMs:Math.round(rtts[Math.floor(rtts.length/2)]),rttP95Ms:Math.round(rtts[Math.floor(rtts.length*.95)])}));
}
try{if(process.argv.includes('--load'))await load();else await smoke();}finally{
  for(const p of peers){clearInterval(p.timer);p.send({type:'leave'});p.ws.close();}
}
