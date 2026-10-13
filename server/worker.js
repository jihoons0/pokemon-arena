import {DurableObject} from 'cloudflare:workers';
import {Match, ROOM_IDLE_MS} from './match.js';
import {PROTOCOL} from '../src/net-state.js';

const ACCOUNT_ROOM_LIMIT=5;
const CODE_ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>CODE_ALPHABET[n%CODE_ALPHABET.length]).join('');
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');
const json=(body,status=200,headers={})=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...headers}});

export class ArenaDirectory extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.records={};this.attempts=new Map();ctx.blockConcurrencyWhile(async()=>{this.records=await ctx.storage.get('rooms')||{};});}
  async reserve(ip){
    const now=Date.now();
    for(const [key,record]of Object.entries(this.records))if(record.expires<now)delete this.records[key];
    const attempts=this.attempts.get(ip)||[];const recent=attempts.filter(t=>t>now-60000);
    if(recent.length>=5)return {error:'잠시 후 방을 만들어 주세요.',status:429};
    recent.push(now);this.attempts.set(ip,recent);
    if(this.attempts.size>500)this.attempts.clear();
    if(Object.keys(this.records).length>=ACCOUNT_ROOM_LIMIT)return {error:'현재 5개 방이 사용 중입니다. 잠시 후 다시 시도해 주세요.',status:429};
    let id;do{id=code();}while(this.records[id]);
    this.records[id]={expires:now+ROOM_IDLE_MS};await this.ctx.storage.put('rooms',this.records);
    await this.ctx.storage.setAlarm(now+ROOM_IDLE_MS);
    return {code:id};
  }
  async renew(id,expires){if(this.records[id]){this.records[id].expires=expires;await this.ctx.storage.put('rooms',this.records);}}
  async release(id){delete this.records[id];await this.ctx.storage.put('rooms',this.records);}
  async alarm(){const now=Date.now();for(const [id,r]of Object.entries(this.records))if(r.expires<now)delete this.records[id];await this.ctx.storage.put('rooms',this.records);if(Object.keys(this.records).length)await this.ctx.storage.setAlarm(now+ROOM_IDLE_MS);}
}

export class ArenaRoom extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.ctx=ctx;this.env=env;this.sockets=new Map();this.buckets=new WeakMap();this.loop=null;this.lastPersist=0;this.lastBroadcast=0;this.lastRenew=0;
    ctx.blockConcurrencyWhile(async()=>{
      const saved=await ctx.storage.get('match');this.code=await ctx.storage.get('code');
      this.match=new Match({saved,send:(seat,data)=>this.send(seat,data)});
      for(const ws of ctx.getWebSockets()){
        const attachment=ws.deserializeAttachment();
        if(attachment&&Number.isInteger(attachment.seat)&&this.match.players[attachment.seat]){
          this.sockets.set(attachment.seat,ws);this.match.players[attachment.seat].connected=true;this.match.players[attachment.seat].disconnectedAt=0;
        }else ws.close(4000,'Reconnect');
      }
      if(this.match.phase==='playing')this.startLoop();
    });
  }
  async initialize(id){if(this.code)return;this.code=id;await this.persist();await this.ctx.storage.put('code',id);}
  async fetch(request){
    if(!this.code||this.match.phase==='closed'||Date.now()>this.match.expiresAt)return json({error:'방을 찾을 수 없거나 만료됐습니다.'},404);
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'WebSocket required'},426);
    // Two players plus at most two sockets completing/replacing a reconnect.
    if(this.ctx.getWebSockets().length>=4)return json({error:'방이 가득 찼습니다.'},429);
    const pair=new WebSocketPair(),[client,server]=Object.values(pair);
    this.ctx.acceptWebSocket(server);server.serializeAttachment({pending:true,at:Date.now()});
    await this.ctx.storage.setAlarm(Math.min(this.match.expiresAt,Date.now()+10000));
    return new Response(null,{status:101,webSocket:client});
  }
  send(seat,data){const ws=this.sockets.get(seat);if(ws)try{ws.send(JSON.stringify(data));}catch{this.onClose(ws);}}
  async webSocketMessage(ws,raw){
    if(typeof raw!=='string'||raw.length>4096){ws.close(1009,'Message too large');return;}
    const now=Date.now(),bucket=this.buckets.get(ws)||{at:now,tokens:40};
    bucket.tokens=Math.min(40,bucket.tokens+(now-bucket.at)*.026);bucket.at=now;
    if(bucket.tokens<1){ws.close(1008,'Too many messages');return;}bucket.tokens--;this.buckets.set(ws,bucket);
    let message;try{message=JSON.parse(raw);}catch{ws.close(1007,'Invalid JSON');return;}
    if(!message||typeof message!=='object'||Array.isArray(message)){ws.close(1008,'Invalid message');return;}
    const attachment=ws.deserializeAttachment();
    if(attachment?.pending){
      if(message?.type!=='hello'){ws.close(1008,'Hello required');return;}
      try{
        const {seat}=this.match.connect({...message,newToken:token()});
        const previous=this.sockets.get(seat);this.sockets.set(seat,ws);ws.serializeAttachment({seat});
        if(previous&&previous!==ws)previous.close(4001,'Connection replaced');
        this.match.welcome(seat);await this.persist();
      }catch(error){ws.send(JSON.stringify({type:'error',fatal:true,message:error.message}));ws.close(1008,'Join rejected');}
      return;
    }
    const seat=attachment?.seat;if(this.sockets.get(seat)!==ws)return;
    const previousPhase=this.match.phase;
    this.match.receive(seat,message);
    if(this.match.phase==='playing')this.startLoop();
    if(message.type!=='input'&&message.type!=='ping'||previousPhase!==this.match.phase)await this.persist();
    if(message.type==='leave'){this.sockets.delete(seat);ws.close(1000,'Left room');}
    if(this.match.phase==='finished'){this.stopLoop();this.match.broadcastStates();}
  }
  startLoop(){if(this.loop)return;this.lastTick=Date.now();this.loop=setInterval(()=>this.tick(),1000/60);}
  stopLoop(){if(this.loop){clearInterval(this.loop);this.loop=null;}}
  tick(){
    const now=Date.now(),dt=(now-this.lastTick)/1000;this.lastTick=now;this.match.advance(dt);
    if(now-this.lastBroadcast>=50||this.match.phase!=='playing'){this.lastBroadcast=now;this.match.broadcastStates();}
    if(now-this.lastPersist>=5000){this.lastPersist=now;this.ctx.waitUntil(this.persist());}
    if(this.match.phase!=='playing'){this.stopLoop();this.ctx.waitUntil(this.persist());}
  }
  onClose(ws){const seat=ws.deserializeAttachment()?.seat;if(this.sockets.get(seat)!==ws)return;this.sockets.delete(seat);this.match.disconnect(seat);this.ctx.waitUntil(this.persist());}
  async webSocketClose(ws){this.onClose(ws);try{ws.close();}catch{}}
  async webSocketError(ws){this.onClose(ws);}
  async persist(){
    await this.ctx.storage.put('match',this.match.save());
    await this.ctx.storage.setAlarm(Math.min(this.match.expiresAt,Date.now()+30000));
    if(this.code&&Date.now()-this.lastRenew>60000){this.lastRenew=Date.now();await this.env.DIRECTORY.getByName('rooms').renew(this.code,this.match.expiresAt+30000);}
  }
  async alarm(){
    for(const ws of this.ctx.getWebSockets()){const a=ws.deserializeAttachment();if(a?.pending&&Date.now()-a.at>10000)ws.close(1008,'Join timeout');}
    this.match.advance(0);
    const abandoned=!this.sockets.size&&(this.match.players.some(Boolean)?this.match.players.every(p=>!p||!p.connected&&Date.now()-p.disconnectedAt>=30000):Date.now()-this.match.createdAt>=30000);
    if(this.match.phase==='closed'||abandoned){
      this.stopLoop();this.match.phase='closed';for(const ws of this.ctx.getWebSockets())ws.close(1000,'Room expired');
      await this.env.DIRECTORY.getByName('rooms').release(this.code);await this.ctx.storage.deleteAll();return;
    }
    await this.persist();
  }
}

export default {
  async fetch(request,env){
    const url=new URL(request.url),origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS||'').split(',');
    const headers={'Access-Control-Allow-Origin':allowed.includes(origin)?origin:allowed[0]||'', 'Vary':'Origin','Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};
    if(origin&&!allowed.includes(origin))return json({error:'Origin not allowed'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(url.pathname==='/health')return json({ok:true,protocol:PROTOCOL,service:'pokemon-arena',maxPlayers:10},200,headers);
    try{
      if(request.method==='POST'&&url.pathname==='/rooms'){
        const result=await env.DIRECTORY.getByName('rooms').reserve(request.headers.get('CF-Connecting-IP')||'local');
        if(result.error)return json(result,result.status,headers);
        const hint=request.cf?.continent==='NA'?(request.cf.longitude < -100?'wnam':'enam'):'enam';
        const room=env.ROOMS.get(env.ROOMS.idFromName(result.code),{locationHint:hint});
        await room.initialize(result.code);return json({code:result.code},201,headers);
      }
      const match=url.pathname.match(/^\/rooms\/([A-HJ-NP-Z2-9]{6})\/socket$/);
      if(match&&request.method==='GET')return env.ROOMS.getByName(match[1]).fetch(request);
      return json({error:'Not found'},404,headers);
    }catch{return json({error:'서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'},503,headers);}
  }
};
