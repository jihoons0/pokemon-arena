import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {WebSocket} from 'ws';
import {Battle,BATTLE_SIDES} from '../src/battle.js';
import {PROTOCOL,applyBattleState} from '../src/net-state.js';
const endpoint=(process.argv[2]||'http://127.0.0.1:8790').replace(/\/$/,'');
const team=['snorlax','blastoise','venusaur','charizard','pikachu','dragonite'],peers=[];
async function until(check,label,ms=10000){const end=Date.now()+ms;while(Date.now()<end){const value=check();if(value)return value;await delay(20);}throw new Error('Timed out: '+label);}
async function peer(code,token){
  const p={seq:0,cmd:0,commands:[],errors:[],rtts:[],frames:new Map(),move:{x:0,y:0},bytes:0,count:0};peers.push(p);
  p.ws=new WebSocket(endpoint.replace(/^http/,'ws')+'/rooms/'+code+'/socket');p.send=data=>{if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify(data));};
  p.ws.on('open',()=>p.send({type:'hello',v:PROTOCOL,teamSize:2,team,special:'haste',token,name:'Team test'}));
  p.ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome'){p.welcome=m;p.seat=m.seat;}if(m.type==='seat')p.seat=m.seat;if(m.type==='lobby')p.lobby=m;if(m.type==='prepare')p.send({type:'loaded',game:m.game});if(m.type==='pong')p.rtts.push(performance.now()-m.at);if(m.type==='error')p.errors.push(m);if(m.type==='state'){p.state=m;p.bytes+=raw.length;p.count++;p.commands=p.commands.filter(c=>c.id>m.actionAck);p.frames.set(m.frame,JSON.stringify(m.state));if(p.frames.size>30)p.frames.delete(p.frames.keys().next().value);}});
  p.ws.on('error',error=>p.errors.push({message:error.message}));p.timer=setInterval(()=>{if(p.state&&p.lobby?.phase==='playing')p.send({type:'input',game:p.state.game,seq:++p.seq,...p.move,commands:p.commands,eventAck:p.state.events.at(-1)?.eventId||0});},50);
  p.command=(kind,extra={})=>p.commands.push({kind,...extra,id:++p.cmd});await until(()=>p.welcome||p.errors.length,'join');return p;
}
async function scenario(humans){
  const response=await fetch(endpoint+'/rooms',{method:'POST'}),room=await response.json();assert.equal(response.status,201,room.error);
  const clients=[];for(let i=0;i<humans;i++)clients.push(await peer(room.code));
  const host=clients[0];
  if(humans===3){host.send({type:'bot',seat:3,difficulty:'master'});await until(()=>host.lobby?.players[3]?.bot,'bot added');assert.equal(host.lobby.players[3].difficulty,'master');}
  // Swapping the host proves socket attachments and reconnect credentials follow their trainer.
  host.send({type:'swap',a:0,b:1});await until(()=>host.seat===1&&clients[1].seat===0,'team swap');
  for(const p of clients)p.send({type:'ready'});
  await until(()=>clients.every(p=>p.state?.state.s==='playing'),'all clients loaded and countdown');
  for(const p of clients){const local=applyBattleState(new Battle(),p.state.state,p.seat);assert.equal(local.player.team,'player');assert.equal(local.fighters.length,4);assert.equal(local.options.controllers.player.bot,false);}
  const before=clients.map(p=>p.state.state.teams[p.seat][0][1]);
  for(const p of clients){p.move={x:p.seat%2?-1:1,y:0};p.send({type:'ping',at:performance.now()});}
  await delay(500);for(const p of clients)p.move={x:0,y:0};
  for(const [i,p]of clients.entries())assert.ok(Math.abs(p.state.state.teams[p.seat][0][1]-before[i])>30);
  const partner=clients.find(p=>p.seat===2);partner.command('target',{seat:3});await until(()=>host.state.state.targets.ally==='rival','seat 2 target');
  for(const p of clients)p.command('cast',{key:'q'});
  await delay(350);partner.command('pause');await until(()=>clients.every(p=>p.state?.pause?.kind==='pause'),'four-player pause');
  const frozen=host.state.state.t;await delay(250);for(const p of clients)assert.equal(p.state.state.t,frozen);
  host.command('resume');await until(()=>clients.every(p=>p.state.state.s==='countdown'),'shared countdown');await until(()=>clients.every(p=>p.state.state.s==='playing'),'resume');
  partner.command('party');await until(()=>clients.every(p=>p.state.pause?.kind==='switch'),'four-player switch');assert.ok(host.state.pause.remainingMs>14000);partner.command('switch',{index:1});
  await until(()=>clients.every(p=>p.state.state.a.ally===1&&p.state.state.s==='countdown'),'seat 2 switch');await until(()=>host.state.state.s==='playing','switch resume');
  const common=[...host.frames.keys()].find(frame=>clients.every(p=>p.frames.has(frame)));assert.ok(common);for(const p of clients)assert.equal(p.frames.get(common),host.frames.get(common));
  partner.ws.close();clearInterval(partner.timer);await until(()=>host.lobby.players[2].connected===false,'disconnect seat 2');const restored=await peer(room.code,partner.welcome.token);assert.equal(restored.seat,2);await until(()=>restored.state,'resume seat 2');assert.equal(restored.state.state.a.ally,1);
  restored.send({type:'leave'});await until(()=>host.state.state.teams[2].every(f=>f[7]===0),'one trainer eliminated');assert.equal(host.state.state.s,'playing');
  const captain=clients.find(p=>p.seat===0);captain.send({type:'leave'});await until(()=>host.state.state.s==='lost','opposing team wins'); // Raw state is always team A's perspective.
  const local=applyBattleState(new Battle(),host.state.state,host.seat);assert.equal(local.state,'won');
  for(const p of [...clients,restored])assert.equal(p.errors.length,0,JSON.stringify(p.errors));
  console.log(JSON.stringify({ok:true,humans,bots:4-humans,checks:['four fighters','independent parties','host team swap','four-seat perspectives','simultaneous movement','manual target','shared pause','switch countdown','identical snapshots','seat 2 reconnect','team elimination'],rttMs:clients.flatMap(p=>p.rtts).map(Math.round),averageSnapshotBytes:Math.round(host.bytes/host.count)}));
  for(const p of [...clients,restored]){clearInterval(p.timer);p.send({type:'leave'});p.ws.close();}
}
async function load(){
  const clients=[];
  for(const humans of [4,4,2]){
    const response=await fetch(endpoint+'/rooms',{method:'POST'}),room=await response.json();assert.equal(response.status,201,room.error);
    const group=[];for(let i=0;i<humans;i++)group.push(await peer(room.code));
    for(let seat=humans;seat<4;seat++)group[0].send({type:'bot',seat,difficulty:'master'});
    if(humans<4)await until(()=>group[0].lobby?.players.every(Boolean),'fill bots');
    for(const p of group)p.send({type:'ready'});clients.push(...group);
  }
  await until(()=>clients.every(p=>p.state?.state.s==='playing'),'10 humans loaded');
  const start=Date.now(),frames=clients.map(p=>p.state.frame);
  for(let tick=0;tick<15;tick++){
    for(const p of clients){p.move={x:Math.sin(tick)*.6,y:Math.cos(tick)*.6};p.send({type:'ping',at:performance.now()});if(tick%3===0)p.command('cast',{key:'q'});if(tick%4===0)p.command('cast',{key:'d'});}
    await delay(1000);
  }
  const hz=clients.map((p,i)=>Math.round((p.state.frame-frames[i])/((Date.now()-start)/1000))),rtts=clients.flatMap(p=>p.rtts).sort((a,b)=>a-b);
  for(const p of clients)assert.equal(p.errors.length,0,JSON.stringify(p.errors));assert.ok(hz.every(rate=>rate>=55&&rate<=65),JSON.stringify(hz));
  console.log(JSON.stringify({ok:true,humans:10,bots:2,rooms:3,seconds:15,simulationHz:hz,rttMedianMs:Math.round(rtts[Math.floor(rtts.length/2)]),rttP95Ms:Math.round(rtts[Math.floor(rtts.length*.95)])}));
}
try{if(process.argv.includes('--load'))await load();else{await scenario(4);await scenario(3);}}finally{for(const p of peers){clearInterval(p.timer);p.send({type:'leave'});p.ws.close();}}
