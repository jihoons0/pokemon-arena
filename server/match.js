import {Battle} from '../src/battle.js';
import {ROSTER_BY_ID} from '../src/roster.js';
import {TRAINER_SKILLS} from '../src/trainer-skills.js';
import {PROTOCOL, STEP, SIDES, encodeBattle, checkpointBattle, restoreBattle} from '../src/net-state.js';

export const RECONNECT_MS = 30000;
export const ROOM_IDLE_MS = 15 * 60 * 1000;
export const MAX_BATTLE_SECONDS = 15 * 60;
const neutral = () => ({x:0,y:0});
const stats = () => ({inputAck:0,actionAck:0,eventAck:0,input:neutral(),inputAt:0});
export function validParty(team) {
  return Array.isArray(team) && team.length === 6 && new Set(team).size === 6 && team.every(id => typeof id === 'string' && Object.hasOwn(ROSTER_BY_ID,id));
}
export function validSpecial(id) { return TRAINER_SKILLS.some(skill => skill.id === id); }

// Transport-independent authoritative room; the same class is exercised by tests
// and by Cloudflare's Durable Object. Client messages contain intentions only.
export class Match {
  constructor({now=Date.now,send=()=>{},saved}={}) {
    this.now=now;this.send=send;this.phase='waiting';this.players=[null,null];this.battle=null;
    this.createdAt=now();this.expiresAt=now()+ROOM_IDLE_MS;this.game=0;this.eventId=0;this.events=[];
    this.controls=[stats(),stats()];this.accumulator=0;this.frame=0;this.finishReason=null;this.pauseInfo=null;
    if(saved){
      Object.assign(this,saved);this.now=now;this.send=send;this.battle=saved.battle?restoreBattle(saved.battle):null;
      this.events=[];this.accumulator=0;
      for(const p of this.players)if(p){if(p.connected)p.disconnectedAt=now();p.connected=false;}
      this.controls=[stats(),stats()];
    }
  }
  publicLobby() {
    return {type:'lobby',v:PROTOCOL,phase:this.phase,game:this.game,expiresAt:this.expiresAt,
      players:this.players.map(p=>p?{team:p.team,special:p.special,ready:p.ready,connected:p.connected,loaded:p.loaded}:null),reason:this.finishReason};
  }
  broadcast(message) { for(let seat=0;seat<2;seat++) if(this.players[seat]?.connected)this.send(seat,message); }
  lobby() { this.broadcast(this.publicLobby()); }
  connect({token,newToken,team,special,v}) {
    if(v!==PROTOCOL)throw new Error('게임을 새로고침해 주세요.');
    if(this.now()>this.expiresAt || this.phase==='closed')throw new Error('만료된 방입니다. 새 방을 만들어 주세요.');
    let seat=token?this.players.findIndex(p=>p?.token===token):-1;
    if(token&&seat<0)throw new Error('재접속 정보가 만료됐습니다.');
    if(seat<0){
      if(this.phase!=='waiting')throw new Error('이미 전투 중인 방입니다.');
      seat=this.players.findIndex(p=>!p);
      if(seat<0)throw new Error('방이 가득 찼습니다.');
      if(!validParty(team)||!validSpecial(special))throw new Error('서로 다른 포켓몬 6마리를 선택해 주세요.');
      this.players[seat]={token:newToken,team:[...team],special,connected:true,ready:false,loaded:false,disconnectedAt:0};
    }else{
      this.players[seat].connected=true;this.players[seat].disconnectedAt=0;
      this.controls[seat]=stats();
    }
    return {seat,token:this.players[seat].token};
  }
  welcome(seat) {
    this.send(seat,{type:'welcome',v:PROTOCOL,seat,token:this.players[seat].token,game:this.game});
    this.lobby();
    if(this.phase==='loading')this.send(seat,{type:'prepare',game:this.game,players:this.publicLobby().players});
    if(this.battle)this.sendState(seat);
  }
  disconnect(seat) {
    const p=this.players[seat];if(!p)return;
    p.connected=false;p.disconnectedAt=this.now();this.controls[seat].input=neutral();
    if(this.phase==='waiting')p.ready=false;
    this.lobby();
  }
  receive(seat,message) {
    const p=this.players[seat];if(!p?.connected || !message || typeof message!=='object')return;
    if(message.type==='ping'){
      if(Number.isFinite(message.at))this.send(seat,{type:'pong',at:message.at,server:this.now()});
      return;
    }
    if(message.type==='leave'){
      if(this.phase==='playing')this.end(seat!==0,'상대가 방을 나갔습니다.');
      p.connected=false;p.disconnectedAt=this.now()-RECONNECT_MS;
      if(this.phase==='waiting')this.players[seat]=null;
      this.lobby();return;
    }
    if(message.type==='unready'&&this.phase==='waiting'){p.ready=false;this.lobby();return;}
    if(message.type==='ready' && ['waiting','finished'].includes(this.phase)) {
      if(this.phase==='finished'){
        this.phase='waiting';this.finishReason=null;this.battle=null;
        for(const player of this.players)if(player){player.ready=false;player.loaded=false;}
      }
      if(validParty(message.team)&&validSpecial(message.special)){p.team=[...message.team];p.special=message.special;}
      p.ready=true;this.expiresAt=this.now()+ROOM_IDLE_MS;this.lobby();
      if(this.players.every(player=>player?.connected&&player.ready)){
        this.phase='loading';this.game++;this.expiresAt=this.now()+60000;
        for(const player of this.players)player.loaded=false;
        this.broadcast({type:'prepare',game:this.game,players:this.publicLobby().players});this.lobby();
      }
      return;
    }
    if(message.type==='loaded'&&this.phase==='loading'&&message.game===this.game){
      p.loaded=true;
      if(this.players.every(player=>player?.connected&&player.loaded)){
        this.battle=new Battle({mode:'pvp',playerTeam:this.players[0].team,enemyTeam:this.players[1].team,playerSpecial:this.players[0].special,enemySpecial:this.players[1].special});
        this.battle.start();this.battle.countdown=3;this.pauseInfo=null;this.phase='playing';this.finishReason=null;this.controls=[stats(),stats()];
        this.events=[];this.accumulator=0;this.frame=0;this.expiresAt=this.now()+(MAX_BATTLE_SECONDS+60)*1000;
        this.collectEvents();this.lobby();this.broadcastStates();
      }else this.lobby();
      return;
    }
    if(message.type!=='input'||this.phase!=='playing'||message.game!==this.game)return;
    const control=this.controls[seat];
    if(Number.isSafeInteger(message.eventAck))control.eventAck=Math.min(this.eventId,Math.max(control.eventAck,message.eventAck));
    if(!Number.isSafeInteger(message.seq)||message.seq<=control.inputAck||message.seq>control.inputAck+10000)return;
    if(!Number.isFinite(message.x)||!Number.isFinite(message.y)||Math.abs(message.x)>1||Math.abs(message.y)>1)return;
    const length=Math.max(1,Math.hypot(message.x,message.y));
    control.input={x:message.x/length,y:message.y/length};control.inputAt=this.now();control.inputAck=message.seq;
    this.battle.inputs[SIDES[seat]]=control.input;
    if(seat===0)this.battle.input=control.input;
    const commands=Array.isArray(message.commands)?message.commands.slice(0,8):[];
    for(const command of commands){
      if(!command||typeof command!=='object')continue;
      if(!Number.isSafeInteger(command.id)||command.id<=control.actionAck||command.id>control.actionAck+10000)continue;
      control.actionAck=command.id;
      const side=SIDES[seat],before=this.battle.events.length;
      if(command.kind==='cast'&&['q','w','e','r','s','d'].includes(command.key))this.battle.castFor(this.battle.source(side),command.key);
      else if(command.kind==='pause')this.pause(seat,'pause');
      else if(command.kind==='party')this.pause(seat,'switch');
      else if(command.kind==='resume'&&this.pauseInfo?.kind==='pause')this.resume();
      else if(command.kind==='cancelSwitch'&&this.pauseInfo?.kind==='switch'&&this.pauseInfo.by===seat&&!this.pauseInfo.forced.length)this.resume();
      else if(command.kind==='switch')this.choose(seat,command.index);
      for(const event of this.battle.events.slice(before))event.command={seat,id:command.id};
    }
    this.collectEvents();
  }
  collectEvents() {
    if(!this.battle)return;
    for(const event of this.battle.drainEvents()){
      this.events.push({...event,eventId:++this.eventId});
      if(event.type==='end'){this.phase='finished';this.pauseInfo=null;this.expiresAt=this.now()+ROOM_IDLE_MS;}
    }
    this.events=this.events.slice(-160);
    if(this.phase==='playing'&&this.battle.state==='playing'){
      const forced=[0,1].filter(seat=>this.battle.source(SIDES[seat]).hp<=0&&this.battle.teams[SIDES[seat]].some(f=>f.hp>0));
      if(forced.length)this.pause(forced[0],'switch',forced);
    }
  }
  pause(seat,kind,forced=[]) {
    if(this.phase!=='playing'||this.battle.state!=='playing'||this.pauseInfo)return false;
    const side=SIDES[seat];
    if(kind==='switch'&&!forced.length&&(this.battle.source(side).blinkStrike||this.battle.switchCooldowns[side]>0||!this.battle.teams[side].some((f,i)=>f.hp>0&&i!==this.battle.activeIndices[side])))return false;
    this.pauseInfo={kind,by:seat,forced,chosen:[],until:this.now()+(kind==='switch'?15000:60000)};
    this.battle.state='paused';this.battle.hitStop=0;this.accumulator=0;
    for(const c of this.controls)c.input=neutral();
    return true;
  }
  choose(seat,index) {
    const pause=this.pauseInfo;if(!pause||pause.kind!=='switch'||(pause.by!==seat&&!pause.forced.includes(seat))||pause.chosen.includes(seat))return false;
    this.battle.state='playing';const accepted=this.battle.switchFor(SIDES[seat],index);this.battle.state='paused';
    if(!accepted)return false;
    pause.chosen.push(seat);
    if((pause.forced.length?pause.forced:[pause.by]).every(s=>pause.chosen.includes(s)))this.resume();
    return true;
  }
  resume() {
    if(!this.pauseInfo||this.phase!=='playing')return;
    const pause=this.pauseInfo;
    for(const seat of pause.forced)if(!pause.chosen.includes(seat)){
      const side=SIDES[seat],index=this.battle.teams[side].findIndex(f=>f.hp>0);
      this.battle.state='playing';this.battle.switchFor(side,index);
    }
    this.pauseInfo=null;this.battle.state='countdown';this.battle.countdown=3;this.accumulator=0;
    this.expiresAt+=Math.max(0,this.now()-(pause.until-(pause.kind==='switch'?15000:60000)))+3000;
    for(const c of this.controls)c.input=neutral();
    this.battle.emit('resumeCountdown');
  }
  end(playerWon,reason) {
    if(this.phase!=='playing')return;
    this.finishReason=reason;this.battle.finish(playerWon);this.collectEvents();this.lobby();this.broadcastStates();
  }
  advance(seconds) {
    const now=this.now();
    if(this.phase==='playing'){
      if(this.pauseInfo&&now>=this.pauseInfo.until)this.resume();
      for(let seat=0;seat<2;seat++){
        const p=this.players[seat];
        if(!p.connected&&now-p.disconnectedAt>=RECONNECT_MS){this.end(seat!==0,'재접속 시간이 끝났습니다.');break;}
      }
      this.accumulator+=Math.min(.25,Math.max(0,seconds));
      let steps=0;
      while(this.accumulator>=STEP&&this.phase==='playing'&&steps++<15){
        const inputs=this.controls.map(c=>now-c.inputAt<=250?c.input:neutral());
        this.battle.update(STEP,inputs[0],inputs[1]);this.accumulator-=STEP;this.frame++;this.collectEvents();
        if(this.battle.time>=MAX_BATTLE_SECONDS){
          const hp=SIDES.map(side=>this.battle.teams[side].reduce((sum,f)=>sum+f.hp/f.maxHp,0));
          this.end(hp[0]>=hp[1],'시간 종료 · 남은 체력으로 결정');
        }
      }
    }
    if(now>this.expiresAt){
      this.phase='closed';this.broadcast({type:'error',fatal:true,message:'방이 만료됐습니다. 새 방을 만들어 주세요.'});
    }
  }
  sendState(seat,encoded) {
    if(!this.battle||!this.players[seat]?.connected)return;
    this.send(seat,{type:'state',game:this.game,frame:this.frame,server:this.now(),state:encoded||encodeBattle(this.battle),
      pause:this.pauseInfo?{...this.pauseInfo,remainingMs:Math.max(0,this.pauseInfo.until-this.now())}:null,
      ack:this.controls[seat].inputAck,actionAck:this.controls[seat].actionAck,events:this.events.filter(e=>e.eventId>this.controls[seat].eventAck),reason:this.finishReason});
  }
  broadcastStates() {if(this.battle){const state=encodeBattle(this.battle);for(let seat=0;seat<2;seat++)this.sendState(seat,state);}}
  save() {
    return {phase:this.phase,players:structuredClone(this.players),createdAt:this.createdAt,expiresAt:this.expiresAt,game:this.game,eventId:this.eventId,
      controls:structuredClone(this.controls),frame:this.frame,finishReason:this.finishReason,pauseInfo:this.pauseInfo,battle:this.battle?checkpointBattle(this.battle):null};
  }
}
