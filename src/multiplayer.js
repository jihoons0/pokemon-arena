import {Battle,BATTLE_SIDES} from './battle.js';
import {PROTOCOL,applyBattleState,localEvent,predictMotion,perspectiveSides} from './net-state.js';
import {MULTIPLAYER_URL} from './network-config.js';
import {t} from './i18n/i18n.js';
import {normalizeName} from './invite.js';

const SESSION_KEY='mt-silver-online-v1';
const now=()=>performance.now();
const copy=value=>structuredClone(value);
const visualKeys=['x','y','facing','anim','animTime','dash','moving','pose','dodgeGuard'];
export class Multiplayer {
  constructor(battle,handlers={}) {
    this.battle=battle;this.handlers=handlers;this.session=null;this.socket=null;this.connected=false;this.phase='waiting';
    this.seq=0;this.commandId=0;this.commands=[];this.predictedEvents=new Set();this.history=[];this.samples=[];
    this.prediction=new Battle({mode:'pvp'});this.ping=0;this.lastStateAt=0;this.lastEvent=0;this.startedGame=-1;this.generation=0;
    this.control={x:0,y:0};this.offset={x:0,y:0};this.game=0;this.lastPing=0;this.pauseInfo=null;this.assetsGame=-1;this.preparingState=false;
    this.timer=setInterval(()=>this.pump(),50);
  }
  get active(){return Boolean(this.session);}
  get endpoint(){const port=Number(new URLSearchParams(location.search).get('multiplayerPort'))||8787;return ['localhost','127.0.0.1'].includes(location.hostname)?'http://127.0.0.1:'+Math.max(1024,Math.min(65535,port)):MULTIPLAYER_URL;}
  status(text){this.handlers.status?.(text);}
  async create(team,special,name,teamSize=1){
    if(!this.endpoint)throw new Error(t('online.serverPreparing'));
    const response=await fetch(this.endpoint+'/rooms',{method:'POST',signal:AbortSignal.timeout(10000)});
    const body=await response.json();if(!response.ok)throw new Error(body.error||t('online.createFailed'));
    await this.join(body.code,team,special,null,name,teamSize);return body.code;
  }
  async join(code,team,special,resume=null,name='',teamSize=1){
    code=code.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))throw new Error(t('online.invalidCode'));
    if(!this.endpoint)throw new Error(t('online.serverPreparing'));
    this.leave(false);this.session={code,team:[...team],special,token:resume,name:normalizeName(name),teamSize};this.lastEvent=0;this.startedGame=-1;
    this.generation++;this.retries=0;this.fatal=false;this.status(t('online.connecting'));
    try{await this.open(this.generation);}catch(error){this.leave(false);throw error;}
  }
  savedSession(){try{return JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');}catch{return null;}}
  async restore(){const saved=this.savedSession();if(saved?.token)return this.join(saved.code,saved.team,saved.special,saved.token,saved.name,saved.teamSize);}
  open(generation){
    return new Promise((resolve,reject)=>{
      const url=this.endpoint.replace(/^http/,'ws')+'/rooms/'+this.session.code+'/socket';
      const socket=new WebSocket(url);this.socket=socket;let welcomed=false;
      const timeout=setTimeout(()=>{reject(new Error(t('online.serverTimeout')));socket.close();},10000);
      socket.addEventListener('open',()=>{
        if(generation!==this.generation){socket.close();return;}
        this.send({type:'hello',v:PROTOCOL,team:this.session.team,special:this.session.special,token:this.session.token,name:this.session.name,teamSize:this.session.teamSize});
      });
      socket.addEventListener('message',async event=>{
        if(generation!==this.generation)return;
        let data;try{data=JSON.parse(event.data);}catch{return;}
        if(data.type==='welcome'){
          welcomed=true;clearTimeout(timeout);this.connected=true;this.retries=0;this.seat=data.seat;this.game=data.game;
          this.seq=0;this.commandId=0;this.commands=[];this.session.token=data.token;this.history=[];
          try{sessionStorage.setItem(SESSION_KEY,JSON.stringify(this.session));}catch{}
          this.send({type:'ping',at:now()});this.lastPing=now();this.status(t('online.connected'));resolve();
        }else if(data.type==='seat'){this.seat=data.seat;
        }else if(data.type==='error'){
          this.status(data.message);this.handlers.error?.(data.message);
          if(data.fatal){this.fatal=true;clearTimeout(timeout);if(!welcomed)reject(new Error(data.message));this.handlers.fatal?.(data.message);socket.close();}
        }else if(data.type==='pong'){
          const measured=now()-data.at;if(measured>=0&&measured<5000)this.ping=this.ping?this.ping*.65+measured*.35:measured;
        }else if(data.type==='lobby'){
          this.phase=data.phase;this.game=data.game;this.lobby=data;this.handlers.lobby?.(data);
        }else if(data.type==='prepare'){
          this.game=data.game;this.seq=0;this.commandId=0;this.commands=[];this.history=[];this.samples=[];this.predictedEvents.clear();this.status(t('online.preparingPokemon'));
          try{await this.handlers.prepare?.(data);if(generation===this.generation){this.assetsGame=data.game;this.send({type:'loaded',game:data.game});}}
          catch{this.status(t('online.loadFailed'));}
        }else if(data.type==='state'){
          // A page reload resumes an existing battle without the original prepare event.
          if(this.assetsGame===data.game){this.acceptState(data);return;}
          this.pendingState=data;if(this.preparingState)return;this.preparingState=true;
          try{
            await this.handlers.prepare?.({players:BATTLE_SIDES.slice(0,data.state.teams.length).map(side=>({team:data.state.options[side+'Team']}))});
            if(generation===this.generation){this.assetsGame=data.game;this.preparingState=false;this.acceptState(this.pendingState);}
          }catch{if(generation===this.generation){this.preparingState=false;this.status(t('online.loadingResources'));}}
        }
      });
      socket.addEventListener('close',()=>{
        clearTimeout(timeout);if(generation!==this.generation)return;this.connected=false;this.handlers.metrics?.({ping:this.ping,stale:true});this.control={x:0,y:0};
        if(!welcomed)reject(new Error(t('online.connectionFailed')));
        if(!this.fatal&&this.session?.token){
          this.status(t('online.reconnecting'));const delay=Math.min(4000,500*2**this.retries++);
          clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>{if(generation===this.generation)this.open(generation).catch(()=>{});},delay);
        }
      });
      socket.addEventListener('error',()=>{});
    });
  }
  send(message){if(this.socket?.readyState===WebSocket.OPEN)this.socket.send(JSON.stringify(message));}
  ready(team,special){this.send({type:'ready',team,special});}
  configure(message){this.send(message);}
  target(side){const remote=perspectiveSides(this.seat,this.battle.sides.length)[BATTLE_SIDES.indexOf(side)];return this.queue({kind:'target',seat:BATTLE_SIDES.indexOf(remote)});}
  unready(){this.send({type:'unready'});}
  leave(notify=true){
    if(notify)this.send({type:'leave'});this.generation++;clearTimeout(this.retryTimer);this.socket?.close();
    this.socket=null;this.session=null;this.connected=false;this.phase='waiting';this.commands=[];this.history=[];this.samples=[];this.startedGame=-1;
    this.lastStateAt=0;this.lastEvent=0;this.ping=0;this.pauseInfo=null;this.lobby=null;this.finishReason=null;this.control={x:0,y:0};this.predictedEvents.clear();this.assetsGame=-1;this.preparingState=false;
    try{sessionStorage.removeItem(SESSION_KEY);}catch{}
  }
  pump(){
    if(!this.connected)return;
    if(this.phase==='playing')this.send({type:'input',game:this.game,seq:++this.seq,x:this.control.x,y:this.control.y,commands:this.commands.map(({at,...c})=>c),eventAck:this.lastEvent});
    if(now()-this.lastPing>1000){this.lastPing=now();this.send({type:'ping',at:this.lastPing});}
    this.handlers.metrics?.({ping:Math.round(this.ping),stale:this.phase==='playing'&&now()-this.lastStateAt>1500});
  }
  queue(command){if(!this.connected||this.phase!=='playing'||this.commands.length>=8)return null;const item={...command,id:++this.commandId,at:now()};this.commands.push(item);return item;}
  predictCast(command,emit){
    this.prediction.input=this.control;this.prediction.inputs.player=this.control;
    const success=this.prediction.cast(command.key);
    // A dash with zero wind-up can be shown immediately; no damage is simulated.
    if(success){const task=this.prediction.tasks.find(t=>t.team==='player'&&t.kind==='dash'&&t.delay===0);if(task)this.prediction.resolveTask(task);}
    const events=this.prediction.drainEvents();
    if(emit&&success)for(const event of events){
      if(['cast','dodge','shield','trainer','boost','trackingBreak'].includes(event.type)){
        this.predictedEvents.add(this.game+':'+command.id+':'+event.type);this.battle.events.push(event);
      }
    }
    return success;
  }
  cast(key){
    if(this.battle.state!=='playing'||!this.connected)return false;
    const command=this.queue({kind:'cast',key});if(!command)return false;
    this.predictCast(command,true);return true;
  }
  switch(index){return Boolean(this.queue({kind:'switch',index}));}
  pause(){return this.queue({kind:'pause'});}
  party(){return this.queue({kind:'party'});}
  resume(){return this.queue({kind:'resume'});}
  cancelSwitch(){return this.queue({kind:'cancelSwitch'});}
  acceptState(message){
    const at=now(),side=this.seat,first=this.startedGame!==message.game;
    const previous={id:this.battle.player.id,x:this.battle.player.x,y:this.battle.player.y};
    this.lastStateAt=at;this.game=message.game;this.finishReason=message.reason;this.commands=this.commands.filter(c=>c.id>message.actionAck);
    this.pauseInfo=message.pause?{...message.pause,deadline:at+message.pause.remainingMs}:null;
    applyBattleState(this.battle,message.state,side);applyBattleState(this.prediction,message.state,side);
    this.prediction.tasks=[];this.prediction.drainEvents();
    this.samples.push({at,fighters:Object.fromEntries(this.battle.sides.slice(1).map(side=>[side,copy(this.battle.source(side))]))});this.samples=this.samples.slice(-8);
    const start=at-Math.min(150,this.ping/2);let cursor=start;
    // Replay only movement and unacknowledged actions after this snapshot's time.
    const timeline=[...this.history.filter(h=>h.at>=start).map(h=>({...h,kind:'motion'})),...this.commands.filter(c=>c.kind==='cast').map(c=>({...c,at:Math.max(start,c.at)}))].sort((a,b)=>a.at-b.at);
    let control=this.history.findLast(h=>h.at<=start)?.input||this.control;
    for(const item of timeline){this.advancePrediction((item.at-cursor)/1000,control);cursor=item.at;if(item.kind==='motion')control=item.input;else this.predictCast(item,false);}
    this.advancePrediction((at-cursor)/1000,control);
    if(!first&&previous.id===this.battle.player.id&&Math.hypot(previous.x-this.prediction.player.x,previous.y-this.prediction.player.y)<100){this.offset={x:previous.x-this.prediction.player.x,y:previous.y-this.prediction.player.y};}
    else this.offset={x:0,y:0};
    if(first){this.startedGame=message.game;this.handlers.start?.(message);}
    this.handlers.state?.(message);
    for(const event of message.events){
      if(event.eventId<=this.lastEvent)continue;this.lastEvent=event.eventId;
      if(event.type==='hint'&&event.command?.seat!==this.seat)continue;
      const key=message.game+':'+event.command?.id+':'+event.type;
      if(event.command?.seat===this.seat&&this.predictedEvents.has(key))continue;
      this.battle.events.push(localEvent(event,side,this.battle.sides.length));
    }
    if(['won','lost'].includes(this.battle.state)){
      this.phase='finished';
      // A resumed socket may have missed the end event checkpoint.
      if(first&&!message.events.some(e=>e.type==='end'))this.battle.events.push({type:'end',won:this.battle.state==='won',stats:this.battle.stats,time:this.battle.time});
    }
    if(message.reason)this.status(message.reason);
  }
  advancePrediction(seconds,input){
    let remaining=Math.min(.2,Math.max(0,seconds));
    while(remaining>0){const dt=Math.min(1/60,remaining);if(this.prediction.state==='playing')predictMotion(this.prediction.player,dt,input,this.prediction.enemy);remaining-=dt;}
  }
  update(dt,input){
    this.control=this.connected?{x:input.x||0,y:input.y||0}:{x:0,y:0};
    if(!this.active||!this.lastStateAt)return;
    const at=now();this.history.push({at,input:{...this.control}});this.history=this.history.filter(h=>h.at>at-1000);
    if(this.battle.state==='playing'&&this.connected&&at-this.lastStateAt<1000){
      this.advancePrediction(dt,this.control);const f=this.prediction.player;
      for(const key of visualKeys)this.battle.player[key]=copy(f[key]);
      const decay=Math.exp(-dt*18);this.offset.x*=decay;this.offset.y*=decay;
      this.battle.player.x+=this.offset.x;this.battle.player.y+=this.offset.y;
    }
    const time=at-60,samples=this.samples;
    const next=samples.find(s=>s.at>=time),before=samples.findLast(s=>s.at<=time)||samples[0];
    for(const side of this.battle.sides.slice(1)){
      const f=this.battle.source(side),a=before?.fighters[side],b=next?.fighters[side];
      if(a&&b&&a.id===b.id&&a.id===f.id){const mix=Math.max(0,Math.min(1,(time-before.at)/(next.at-before.at||1)));for(const key of ['x','y','animTime'])f[key]=a[key]+(b[key]-a[key])*mix;}
      else if(this.battle.state!=='paused')f.animTime+=dt;
    }
    this.battle.refreshTargets();
    // Extrapolate rendered projectiles between snapshots, never their collisions.
    if(this.battle.state==='playing'&&at-this.lastStateAt<100)for(const p of this.battle.projectiles){p.x+=p.vx*dt;p.y+=p.vy*dt;p.age+=dt;}
    this.battle.lastStepDt=dt;
  }
  diagnostics(){return {active:this.active,connected:this.connected,code:this.session?.code,seat:this.seat,phase:this.phase,game:this.game,ping:Math.round(this.ping),snapshotAge:Math.round(now()-this.lastStateAt),pendingCommands:this.commands.length};}
}
