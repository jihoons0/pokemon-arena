import {buildCuePlan,hapticForCue,normalizeVibrationPattern} from './feedback.js';

const clamp01=value=>Math.max(0,Math.min(1,Number(value)||0));
const silentMedia=()=>({loop:false,preload:'none',volume:0,muted:false,currentTime:0,paused:true,addEventListener(){},play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}});

export class AudioManager {
  constructor(options={}){
    this._window=options.window??globalThis.window;
    this._navigator=options.navigator??globalThis.navigator;
    this._Audio=options.Audio??globalThis.Audio;
    this._audioContextFactory=options.audioContextFactory||null;
    this._now=options.now||(()=>globalThis.performance?.now?.()??Date.now());
    this.music=this._createMedia('/assets/audio/pokemon-hgss-battle-champion.mp3');
    this.music.loop=true;this.music.preload='auto';
    this.resultTracks={won:this._createMedia('/assets/audio/arena-victory.wav'),lost:this._createMedia('/assets/audio/arena-defeat.wav')};for(const track of Object.values(this.resultTracks))track.preload='auto';this.resultMusic=null;this.resultOutcome=null;
    this.muted=false;this.started=false;this.ctx=null;this.volume=.32;this.sfxVolume=.86;this.music.volume=this.volume;
    this.failed=false;this.blocked=false;this.feedbackPaused=false;this.hapticsEnabled=true;this.reducedMotion=!!this._window?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    this.sfxGain=null;this.compressor=null;this.emittedSoundCount=0;this.hapticRequestCount=0;this.hapticEmissionCount=0;this.lastCue=null;this.lastHaptic=null;this.lastCryDex=null;this.lastCryId=null;
    this._cueTimes=new Map();this._pendingUltimates=new Map();this._hapticAt=-Infinity;this._hapticPriority=0;this._hapticUntil=0;this._musicDucked=false;this._duckTimer=null;this._tabInactive=!!this._window?.document?.hidden;this._cry=null;this._cryToken=0;
    this.music.addEventListener?.('error',()=>{this.failed=true;});
    this._onBlur=()=>{this._tabInactive=true;this.stopHaptics();};
    this._onFocus=()=>{this._tabInactive=!!this._window?.document?.hidden;};
    this._onVisibility=()=>{this._tabInactive=!!this._window?.document?.hidden;if(this._tabInactive)this.stopHaptics();};
    this._window?.addEventListener?.('blur',this._onBlur);this._window?.addEventListener?.('focus',this._onFocus);this._window?.document?.addEventListener?.('visibilitychange',this._onVisibility);
  }
  _createMedia(src){
    if(!this._Audio)return Object.assign(silentMedia(),{src});
    try{return new this._Audio(src);}catch{return Object.assign(silentMedia(),{src});}
  }
  _contextConstructor(){return this._window?.AudioContext||this._window?.webkitAudioContext||globalThis.AudioContext||globalThis.webkitAudioContext;}
  _initGraph(){
    const ac=this.ctx;if(!ac||this.sfxGain)return;
    this.sfxGain=ac.createGain();this.sfxGain.gain.value=this.muted?0:this.sfxVolume;
    if(ac.createDynamicsCompressor){
      this.compressor=ac.createDynamicsCompressor();
      const settings={threshold:-18,knee:16,ratio:8,attack:.003,release:.18};
      for(const [key,value] of Object.entries(settings))if(this.compressor[key])this.compressor[key].value=value;
      this.sfxGain.connect(this.compressor);this.compressor.connect(ac.destination);
    }else this.sfxGain.connect(ac.destination);
  }
  async unlock(){
    try{
      if(!this.ctx){
        if(this._audioContextFactory)this.ctx=this._audioContextFactory();
        else {const Context=this._contextConstructor();if(!Context)return false;this.ctx=new Context();}
        this._initGraph();
      }
      if(this.ctx.state==='suspended')await this.ctx.resume();
      return this.ctx.state==='running';
    }catch{this.blocked=true;return false;}
  }
  async start(){
    this.stopResultMusic();
    this.started=true;this.feedbackPaused=false;
    const unlocked=await this.unlock();
    if(!this.muted){try{await this.music.play();}catch{this.blocked=true;}}
    return unlocked;
  }
  toggle(){
    this.muted=!this.muted;this.music.muted=this.muted;if(this.resultMusic)this.resultMusic.muted=this.muted;if(this.sfxGain)this.sfxGain.gain.value=this.muted?0:this.sfxVolume;
    if(this._cry)this._cry.muted=this.muted;
    if(this.muted){this.stopHaptics();this._stopCry(false);}else if(this.resultMusic)this.resultMusic.play().catch(()=>{this.blocked=true;});else if(this.started&&!this.feedbackPaused)this.music.play().catch(()=>{this.blocked=true;});
    return this.muted;
  }
  setVolume(v){this.volume=clamp01(v);this._applyMusicVolume();return this.volume;}
  setSfxVolume(v){this.sfxVolume=clamp01(v);if(this.sfxGain)this.sfxGain.gain.value=this.muted?0:this.sfxVolume;if(this._cry)this._cry.volume=this._cryVolume();return this.sfxVolume;}
  setHapticsEnabled(enabled){this.hapticsEnabled=!!enabled;if(!this.hapticsEnabled)this.stopHaptics();return this.hapticsEnabled;}
  pause(){this.resultMusic?.pause();this.feedbackPaused=true;this.music.pause();this.stopHaptics();this._stopCry(true);}
  resume(){if(this.resultMusic)return;this.feedbackPaused=false;this._tabInactive=!!this._window?.document?.hidden;if(this.started&&!this.muted)this.music.play().catch(()=>{this.blocked=true;});}
  _applyMusicVolume(){for(const track of Object.values(this.resultTracks))track.volume=this.volume;this.music.volume=clamp01(this.volume*(this._musicDucked?.36:1));}
  stopResultMusic(){for(const track of Object.values(this.resultTracks)){track.pause();track.currentTime=0;}this.resultMusic=null;this.resultOutcome=null;}
  playResult(won){
    this.stopResultMusic();this.music.pause();this._stopCry(false);this.resultOutcome=won?'won':'lost';const track=this.resultMusic=this.resultTracks[this.resultOutcome];track.currentTime=0;track.loop=false;track.volume=this.volume;track.muted=this.muted;
    if(!this.muted)track.play().catch(()=>{this.blocked=true;});
  }
  _duckMusic(duration=900){
    if(!this.started||this.muted)return;this._musicDucked=true;this._applyMusicVolume();
    if(this._duckTimer)clearTimeout(this._duckTimer);
    this._duckTimer=setTimeout(()=>{this._musicDucked=false;this._duckTimer=null;this._applyMusicVolume();},Math.max(120,Math.min(1800,duration)));this._duckTimer?.unref?.();
  }
  _clearDuck(){if(this._duckTimer)clearTimeout(this._duckTimer);this._duckTimer=null;this._musicDucked=false;this._applyMusicVolume();}
  tone({from=500,to=200,duration=.12,type='triangle',volume=.06,delay=0,attack=.008,lowpass=0}){
    const ac=this.ctx;if(!ac||!this.sfxGain||this.muted||this.sfxVolume<=0)return false;
    try{
      const now=ac.currentTime+Math.max(0,delay),gain=ac.createGain(),osc=ac.createOscillator(),peak=Math.max(.0001,Math.min(.22,volume));let tail=gain;
      if(lowpass&&ac.createBiquadFilter){const filter=ac.createBiquadFilter();filter.type='lowpass';filter.frequency.value=lowpass;osc.connect(filter);filter.connect(gain);tail=filter;}else osc.connect(gain);
      gain.connect(this.sfxGain);osc.type=type;osc.frequency.setValueAtTime(Math.max(20,from),now);osc.frequency.exponentialRampToValueAtTime(Math.max(20,to),now+duration);
      gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(peak,now+Math.min(attack,duration*.25));gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
      osc.start(now);osc.stop(now+duration+.025);osc.onended=()=>{try{osc.disconnect();tail!==gain&&tail.disconnect();gain.disconnect();}catch{}};return true;
    }catch{return false;}
  }
  noise({duration=.18,volume=.035,highpass=80,lowpass=0,delay=0}){
    const ac=this.ctx;if(!ac||!this.sfxGain||this.muted||this.sfxVolume<=0)return false;
    try{
      duration=Math.max(.015,Math.min(.8,duration));const now=ac.currentTime+Math.max(0,delay),length=Math.max(1,Math.ceil(ac.sampleRate*duration)),buffer=ac.createBuffer(1,length,ac.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/length,1.25);
      const source=ac.createBufferSource(),high=ac.createBiquadFilter(),gain=ac.createGain();source.buffer=buffer;high.type='highpass';high.frequency.value=Math.max(20,highpass);source.connect(high);let tail=high;
      if(lowpass&&ac.createBiquadFilter){const low=ac.createBiquadFilter();low.type='lowpass';low.frequency.value=lowpass;high.connect(low);tail=low;}tail.connect(gain);gain.connect(this.sfxGain);
      gain.gain.setValueAtTime(Math.max(.0001,Math.min(.16,volume)),now);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);source.start(now);source.stop(now+duration+.015);source.onended=()=>{try{source.disconnect();high.disconnect();tail!==high&&tail.disconnect();gain.disconnect();}catch{}};return true;
    }catch{return false;}
  }
  _emitCue(cue,details={},throttle=0){
    if(!this.ctx||this.muted||this.sfxVolume<=0)return false;const now=this._now(),last=this._cueTimes.get(cue)??-Infinity;if(now-last<throttle)return false;
    const plan=buildCuePlan(cue,details);let emitted=false;
    for(const voice of plan)emitted=(voice.source==='noise'?this.noise(voice):this.tone(voice))||emitted;
    if(emitted){this._cueTimes.set(cue,now);this.emittedSoundCount++;this.lastCue=cue;}
    return emitted;
  }
  sfx(kind,details={}){
    const aliases={q:'cast',w:'cast',e:'cast',r:'cast:ultimate',lightning:'detonate',flame:'release',eruption:'detonate',beam:'release',pulse:'release',slash:'release',impact:'impact',hit:'hit',basic:'basic',d:'dodge',dodge:'dodge',evade:'evade',fight:'fight'};
    const cue=aliases[kind]||kind||'hit';const next={...details};if(['beam','pulse','slash'].includes(kind))next.kind=kind;if(kind==='lightning')next.element='electric';if(kind==='flame'||kind==='eruption')next.element='fire';
    return this._emitCue(cue,next,kind==='hit'?28:0);
  }
  ui(kind,mon=null){
    const normalized={select:'pick',add:'pick',delete:'remove',back:'cancel'}[kind]||kind;const throttle=normalized==='hover'?85:normalized==='error'?90:35;
    const emitted=this._emitCue('ui:'+normalized,{},throttle);
    if(normalized==='pick')this._playCry(mon);
    const haptic=hapticForCue('ui:'+normalized);if(haptic)this._requestHaptic(haptic,'ui:'+normalized);
    return emitted;
  }
  _cryVolume(){return this.muted?0:Math.min(.72,.18+this.sfxVolume*.52);}
  _stopCry(fade=true){
    const cry=this._cry;if(!cry)return;this._cry=null;this._cryToken++;
    if(!fade||cry.paused){try{cry.pause();cry.currentTime=0;}catch{}return;}
    const start=Number(cry.volume)||this._cryVolume(),steps=3;let step=0;
    const timer=setInterval(()=>{step++;try{cry.volume=Math.max(0,start*(1-step/steps));}catch{}if(step>=steps){clearInterval(timer);try{cry.pause();cry.currentTime=0;}catch{}}},18);timer?.unref?.();
  }
  _playCry(mon){
    const dex=Math.trunc(Number(mon?.dex)),src=mon?.cryUrl||(Number.isFinite(dex)&&dex>0?'/assets/audio/cries/'+dex+'.ogg':null);
    if(!src||this.muted||this.sfxVolume<=0)return false;
    this._stopCry(true);const cry=this._createMedia(src);this._cry=cry;this.lastCryDex=dex>0?dex:null;this.lastCryId=mon?.id||null;cry.preload='auto';cry.volume=this._cryVolume();cry.muted=this.muted;
    const token=++this._cryToken;cry.addEventListener?.('ended',()=>{if(token===this._cryToken)this._cry=null;});cry.addEventListener?.('error',()=>{if(token===this._cryToken)this._cry=null;});
    try{const result=cry.play();result?.catch?.(()=>{if(token===this._cryToken)this._cry=null;});return true;}catch{if(token===this._cryToken)this._cry=null;return false;}
  }
  _actorFor(event,battle){
    const team=event.team||event.victimTeam;let actor=null;
    try{actor=battle?.source?.(team);}catch{}
    actor=actor||battle?.[team]||battle?.teams?.[team]?.find(member=>member.id===event.id)||null;
    if(event.id&&actor?.id!==event.id)actor=battle?.teams?.[team]?.find(member=>member.id===event.id)||actor;
    return actor;
  }
  _moveFor(event,battle){
    if(!event.key)return null;if(event.key==='s'){try{return battle?.getTrainerSkill?.(event.team)||null;}catch{return null;}}
    return this._actorFor(event,battle)?.def?.moves?.[event.key]||battle?.moves?.[event.key]||null;
  }
  _releaseCue(event,details){
    const pending=this._pendingUltimates.get(event.team);if(pending&&this._now()-pending.at<3500){this._pendingUltimates.delete(event.team);this._duckMusic(420);return ['ultimate:release',{...pending,...details}];}
    if(event.ultimate||details.ultimate){this._duckMusic(420);return ['ultimate:release',details];}
    return ['release',details];
  }
  handleBattleEvent(event,battle){
    if(!event?.type)return false;const type=event.type,actor=this._actorFor(event,battle),move=this._moveFor(event,battle),details={...event,kind:move?.kind||event.kind||type,element:event.element||move?.element||actor?.def?.type||'normal'};let cue=null,throttle=0,hapticDetails=details;
    if(type==='cast'){
      if(event.key==='s'||event.key==='d')return false;
      if(event.key==='r'||event.ultimate){cue='cast:ultimate';this._pendingUltimates.set(event.team,{at:this._now(),kind:event.kind||move?.kind||'nova',element:details.element});this._duckMusic(1050);}else cue='cast';
    }else if(type==='basic'){cue='basic';throttle=28;}
    else if(['beam','slash','pulse','fieldAttack'].includes(type)){[cue,hapticDetails]=this._releaseCue(event,{...details,kind:type==='fieldAttack'?(event.kind||move?.kind||'bolt'):(event.kind||type)});throttle=type==='fieldAttack'?35:0;}
    else if(type==='impact'){cue='impact';throttle=24;}
    else if(type==='hit'){if(event.periodic){cue='hit';throttle=115;hapticDetails={...details,power:.45};}else {cue='hit';throttle=24;}}
    else if(type==='detonate'){if(event.ultimate)[cue,hapticDetails]=this._releaseCue(event,{...details,kind:'detonate'});else cue='detonate';throttle=event.strike?75:25;}
    else if(type==='dodge'||type==='evade')cue=type;
    else if(type==='trainer')cue='trainer:'+(event.id||move?.id||'haste');
    else if(['fight','shield','heal','switch','faint','enrage','trackingBreak','interrupted'].includes(type))cue=type;
    else if(type==='pause'){this.feedbackPaused=true;this.stopHaptics();return false;}
    else if(type==='resume'){this.feedbackPaused=false;return false;}
    else if(type==='reset'){this.stopResultMusic();this.stopHaptics();this._pendingUltimates.clear();this._clearDuck();return false;}
    else if(type==='end'){this.feedbackPaused=true;this.stopHaptics();this._pendingUltimates.clear();this._clearDuck();this.playResult(!!event.won);return false;}
    else if(type==='start'){this.feedbackPaused=false;return false;}
    else return false;
    const emitted=this._emitCue(cue,hapticDetails,throttle);
    const haptic=hapticForCue(cue,hapticDetails);if(haptic&&(!event.team||event.team==='player'||event.victimTeam==='player'))this._requestHaptic(haptic,cue);
    if(type==='switch'&&actor?.def)this._playCry(actor.def);
    return emitted;
  }
  _gamepadActuators(){
    let pads=[];try{pads=Array.from(this._navigator?.getGamepads?.()||[]).filter(Boolean);}catch{}
    const actuators=[];for(const pad of pads){if(pad.vibrationActuator)actuators.push(pad.vibrationActuator);for(const actuator of pad.hapticActuators||[])if(actuator)actuators.push(actuator);}return [...new Set(actuators)];
  }
  _capabilities(){const vibrationSupported=typeof this._navigator?.vibrate==='function',gamepadHapticsSupported=this._gamepadActuators().some(a=>typeof a.playEffect==='function'||typeof a.pulse==='function');return {vibrationSupported,gamepadHapticsSupported,hapticsSupported:vibrationSupported||gamepadHapticsSupported};}
  _requestHaptic(spec,cue){
    if(!spec||!this.hapticsEnabled||this.reducedMotion||this.feedbackPaused||this._tabInactive)return false;const capabilities=this._capabilities();if(!capabilities.hapticsSupported)return false;
    const now=this._now(),priority=spec.priority||1;if(priority<=this._hapticPriority&&now-this._hapticAt<(spec.throttle||45))return false;if(priority<this._hapticPriority&&now<this._hapticUntil)return false;const pattern=normalizeVibrationPattern(spec.pattern);let requested=false,successful=false;
    if(capabilities.vibrationSupported){requested=true;try{successful=this._navigator.vibrate(pattern)===true||successful;}catch{}}
    const duration=pattern.reduce((sum,value)=>sum+value,0),trackResult=result=>{if(result&&typeof result.then==='function')result.then(value=>{if(value===true||value==='complete')this.hapticEmissionCount++;}).catch(()=>{});else if(result===true||result==='complete')successful=true;};
    for(const actuator of this._gamepadActuators()){
      try{if(typeof actuator.playEffect==='function'){requested=true;trackResult(actuator.playEffect('dual-rumble',{startDelay:0,duration,strongMagnitude:clamp01(spec.strong),weakMagnitude:clamp01(spec.weak)}));}else if(typeof actuator.pulse==='function'){requested=true;trackResult(actuator.pulse(Math.max(clamp01(spec.strong),clamp01(spec.weak)),duration));}}catch{}
    }
    if(requested){this.hapticRequestCount++;this._hapticAt=now;this._hapticPriority=priority;this._hapticUntil=now+duration;this.lastHaptic={cue,pattern:[...pattern],at:now};}if(successful)this.hapticEmissionCount++;return successful;
  }
  stopHaptics(){
    this._hapticPriority=0;this._hapticUntil=0;this._hapticAt=-Infinity;
    try{if(typeof this._navigator?.vibrate==='function')this._navigator.vibrate(0);}catch{}
    for(const actuator of this._gamepadActuators())try{if(typeof actuator.reset==='function')actuator.reset();else if(typeof actuator.playEffect==='function')actuator.playEffect('dual-rumble',{startDelay:0,duration:0,strongMagnitude:0,weakMagnitude:0})?.catch?.(()=>{});else actuator.pulse?.(0,0)?.catch?.(()=>{});}catch{}
  }
  getFeedbackState(){
    const capabilities=this._capabilities();return {...capabilities,audioSupported:!!(this.ctx||this._audioContextFactory||this._contextConstructor()),unlocked:this.ctx?.state==='running',contextState:this.ctx?.state||'uninitialized',cryPlaying:!!this._cry&&!this._cry.paused,cryReadyState:this._cry?.readyState||0,cryTime:Number((this._cry?.currentTime||0).toFixed(3)),started:this.started,paused:this.feedbackPaused,muted:this.muted,musicVolume:this.volume,sfxVolume:this.sfxVolume,hapticsEnabled:this.hapticsEnabled,effectiveHapticsEnabled:this.hapticsEnabled&&!this.reducedMotion&&!this.feedbackPaused&&!this._tabInactive&&capabilities.hapticsSupported,reducedMotion:this.reducedMotion,tabInactive:this._tabInactive,musicDucked:this._musicDucked,emittedSoundCount:this.emittedSoundCount,hapticRequestCount:this.hapticRequestCount,hapticEmissionCount:this.hapticEmissionCount,lastCue:this.lastCue,lastHaptic:this.lastHaptic,lastCryDex:this.lastCryDex,lastCryId:this.lastCryId,resultOutcome:this.resultOutcome,resultMusicPlaying:!!this.resultMusic&&!this.resultMusic.paused};
  }
}
