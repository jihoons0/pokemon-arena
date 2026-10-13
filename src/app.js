import {Battle} from './battle.js';
import {pickMvp,VictoryConfetti} from './results.js';
import {Multiplayer} from './multiplayer.js';
import {controlKey,inputFromKeys} from './controls.js';
import {bindBattleTouch,mergeMovement,canTrackStick} from './touch-controls.js';
import {ROSTER,ROSTER_BY_ID,getMoves,DIFFICULTIES} from './roster.js';
import {TRAINER_SKILLS,getTrainerSkill,resolveTrainerSkillChoice} from './trainer-skills.js';
import {loadSprites,drawFighter} from './sprites.js';
import {Renderer} from './renderer.js';
import {AudioManager} from './audio.js';
import {iconFor,elementGlyph} from './icons.js';
import {emptyDraft,normalizeDraft,restoreDraft,selectionToSave,togglePick,isComplete,randomFill,generateCpuTeam} from './party-draft.js';
import {t,initLocale,setLocale,getLocale,onChange,applyDOM} from './i18n/i18n.js';
const $=id=>document.getElementById(id);
const getTypeLabel=type=>t('types.'+type)||type;
const getStateLabel=state=>t('states.'+state)||state;
const STORAGE_KEY='mt-silver-party-v4';
const mon=id=>ROSTER_BY_ID[id]||ROSTER[0];
const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
const formatTime=n=>`${String(Math.floor((n||0)/60)).padStart(2,'0')}:${String(Math.floor((n||0)%60)).padStart(2,'0')}`;
let saved={};try{saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||localStorage.getItem('mt-silver-party-v3')||'{}')||{};}catch{}
const selected={draftVersion:4,intentionalDraft:false,playerTeam:emptyDraft(),enemyTeam:emptyDraft(),rivalMode:'auto',playerSpecial:getTrainerSkill(saved.playerSpecial||'haste').id,enemySpecial:saved.enemySpecial==='random'?'random':getTrainerSkill(saved.enemySpecial||'exhaust').id,difficulty:DIFFICULTIES[saved.difficulty]?saved.difficulty:'standard',musicVolume:clamp(saved.musicVolume??.32),sfxVolume:clamp(saved.sfxVolume??.75),motionEnabled:saved.motionEnabled??!window.matchMedia('(prefers-reduced-motion: reduce)').matches,hapticsEnabled:saved.hapticsEnabled??true};
const battle=new Battle(),audio=new AudioManager(),keys=new Set(),moveButtons={};
const heldPhysicalKeys=new Set(),heldTouchKeys=new Map();
const mobileControls=window.matchMedia('(max-width: 900px), (pointer: coarse)');
let touchControls,viewportWidth=0,viewportHeight=0;
let playMode='solo',networkBusy=false,previousOnlinePause=false;
const network=new Multiplayer(battle,{
  status:setNetworkStatus,error:toast,
  fatal:message=>setTimeout(()=>{if(network.active){returnToSelect();setNetworkStatus(message);}},0),
  lobby:data=>{renderOnlineLobby(data);refreshStart();},
  prepare:async data=>{await ensureSprites(data.players.flatMap(p=>p.team));},
  start:startOnlineBattle,state:syncOnlinePause,
  metrics:({ping,stale})=>{const badge=$('online-badge');badge.textContent=network.connected?(stale?t('online.connDelay'):t('online.pingLabel',{ms:ping})):t('online.reconnecting');badge.dataset.quality=!network.connected||stale?'bad':ping<=80?'good':ping<=150?'fair':'bad';badge.setAttribute('aria-label',network.connected?t('online.pingAria',{ms:ping}):t('online.reconnectAria'));}
});
function setNetworkStatus(text){$('online-status').textContent=text;}
function renderOnlineLobby(data){
  if(!data)return;
  const peer=data.players[network.seat===0?1:0],me=data.players[network.seat];
  $('online-connect').hidden=network.active;$('online-room').hidden=!network.active;
  $('room-code').textContent=network.session?.code||'';
  $('online-opponent').replaceChildren();
  if(peer){const label=document.createElement('strong');label.textContent=!peer.connected?t('online.opponentReconnecting'):peer.ready?t('online.opponentReady'):t('online.opponentPreparing');$('online-opponent').append(label);for(const id of peer.team){const img=document.createElement('img');img.src=mon(id).portrait;img.alt=mon(id).displayName;$('online-opponent').append(img);}}
  else $('online-opponent').textContent=t('online.sendInvite');
  if(data.phase==='waiting')setNetworkStatus(me?.ready?t('online.waitingForFriend'):peer?t('online.pressReady'):t('online.waitingForPeer'));
}
function setPlayMode(mode){
  if(mode===playMode)return;if(network.active)network.leave();playMode=mode;selected.rivalMode='auto';activeSide='player';
  $('mode-solo').setAttribute('aria-pressed',String(mode==='solo'));$('mode-online').setAttribute('aria-pressed',String(mode==='online'));
  $('online-panel').hidden=mode!=='online';$('opponent-settings').hidden=mode==='online';document.querySelector('.difficulty-select').hidden=mode==='online';
  $('online-connect').hidden=false;$('online-room').hidden=true;$('online-opponent').replaceChildren();
  renderSlots();refreshStart();
}
async function connectOnline(create){
  if(networkBusy||!isComplete(selected.playerTeam,ROSTER))return;networkBusy=true;refreshStart();setNetworkStatus(t('online.connecting'));
  try{if(create)await network.create(selected.playerTeam,selected.playerSpecial);else await network.join($('room-code-input').value,selected.playerTeam,selected.playerSpecial);renderOnlineLobby(network.lobby);}
  catch(error){setNetworkStatus(error.message);toast(error.message);}finally{networkBusy=false;refreshStart();}
}
function startOnlineBattle(){
  clearCelebration();
  clearTimeout(endTimer);clearInput();lastCountdown=4;lastState='ready';activeSignature='';partyWasOpen=false;previousOnlinePause=false;
  renderer?.event({type:'reset'});audio.start();audio.resume();
  for(const id of ['start-screen','pause-screen','result-screen','party-screen'])$(id).hidden=true;
  $('game-shell').classList.remove('selecting');document.body.classList.add('in-battle');$('online-badge').hidden=false;
  document.querySelector('.enemy-card .trainer-line small').textContent=t('battle.friend');
  $('restart-button').hidden=true;$('rematch-button').textContent=t('result.oneMore');$('pause-change-button').textContent=t('online.leaveRoom');
  syncBattleViewport();syncActive();updateHud();$('arena').focus({preventScroll:true});
}
function syncOnlinePause(){
  if(!network.active)return;const info=network.pauseInfo,paused=Boolean(info);
  const selecting=info?.kind==='switch'&&(info.by===network.seat||info.forced.includes(network.seat))&&!info.chosen.includes(network.seat);
  $('pause-screen').hidden=!paused||selecting;$('resume-button').hidden=info?.kind==='switch';
  if(paused){
    if(!previousOnlinePause)clearInput();audio.pause();$('pause-limit').hidden=false;
    $('pause-title').textContent=info.kind==='switch'?t('pause.enemySwitching'):t('pause.title');
    $('pause-limit').textContent=t('pause.autoResume',{sec:Math.max(0,Math.ceil((info.deadline-performance.now())/1000))});
  }else if(previousOnlinePause){for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();$('party-screen').hidden=true;partyWasOpen=false;lastCountdown=4;audio.resume();}
  previousOnlinePause=paused;
}
function onlinePartyOpen(){const info=network.pauseInfo;return network.active&&info?.kind==='switch'&&(info.by===network.seat||info.forced.includes(network.seat))&&!info.chosen.includes(network.seat);}

function syncPressedKeys(){const held=new Set([...heldPhysicalKeys,...heldTouchKeys.values()]);for(const node of document.querySelectorAll("[data-movement-key],[data-control-key],[data-direction]")){const pressed=held.has(node.dataset.movementKey||node.dataset.controlKey||node.dataset.direction);node.classList.toggle("is-pressed",pressed);node.dataset.pressed=String(pressed);}}
let renderer,spriteMap={},assetsReady=false,loading=false,lastFrame=0,hudTimer=0,toastTimer,announcementTimer,endTimer,lastState='ready',pausedForDialog=false,lastCountdown=4,activeSide='player',detailId=null,activeType='',lastBattleOptions=null,activeSignature='',partySignature='',partyWasOpen=false;
// Selection preview has its own state. loadSprites shares its cache with battle loading,
// but preview fetches must never change loading/assetsReady or the Start button.
const previewMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const previewSprites={},previewBounds={};
let previewId=null,previewRequest=0,previewTimer,previewTime=0,previewReady=false;
function previewBoundsFor(id,idle){
  if(previewBounds[id])return previewBounds[id];
  // Native sheets have different transparent margins. Fit the actual art, not the sheet.
  const scratch=document.createElement('canvas');scratch.width=idle.image.width;scratch.height=idle.frameHeight;
  const context=scratch.getContext('2d',{willReadFrequently:true});context.drawImage(idle.image,0,0);
  const pixels=context.getImageData(0,0,scratch.width,scratch.height).data;
  let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
  for(let frame=0;frame<idle.frameCount;frame++){
    const anchor=idle.anchors?.[0]?.[frame]||{x:idle.frameWidth/2,y:idle.frameHeight-4};
    for(let y=0;y<idle.frameHeight;y++)for(let x=0;x<idle.frameWidth;x++)if(pixels[(y*scratch.width+frame*idle.frameWidth+x)*4+3]>0){left=Math.min(left,x-anchor.x);right=Math.max(right,x-anchor.x);top=Math.min(top,y-anchor.y);bottom=Math.max(bottom,y-anchor.y);}
  }
  return previewBounds[id]=Number.isFinite(left)?{width:right-left+1,height:bottom-top+1,center:(left+right)/2,bottom}:{width:idle.frameWidth,height:idle.frameHeight,center:0,bottom:0};
}
function drawSelectionPreview(dt=0){
  if(!previewReady||!previewId||$('start-screen').hidden||(dt>0&&document.hidden))return;
  const canvas=$('detail-sprite'),ctx=canvas.getContext('2d'),set=previewSprites[previewId];
  const idle=set?.animations.idle||Object.values(set?.animations||{})[0];if(!ctx||!idle)return;
  previewTime=previewMotion.matches?0:previewTime+dt;
  const bounds=previewBoundsFor(previewId,idle),scale=Math.min(9,canvas.width*.68/bounds.width,canvas.height*.82/bounds.height);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawFighter(ctx,previewSprites,{id:previewId,def:{...mon(previewId),scale},x:canvas.width/2-bounds.center*scale,y:canvas.height*.9-bounds.bottom*scale,radius:30,hp:1,anim:'idle',animTime:previewTime,facing:Math.PI/2,hurt:0});
}
function requestSelectionPreview(id){
  if(previewId===id){if(previewReady){$('detail-sprite').hidden=false;$('detail-portrait').hidden=true;}return;}
  previewId=id;previewReady=false;previewTime=0;const request=++previewRequest;clearTimeout(previewTimer);
  $('detail-sprite').hidden=true;$('detail-portrait').hidden=false;
  $('detail-sprite').setAttribute('aria-label',t('select.spritePendingAria',{name:mon(id).displayName}));
  const accept=()=>{if(request!==previewRequest||detailId!==id)return;previewReady=true;$('detail-portrait').hidden=true;$('detail-sprite').hidden=false;drawSelectionPreview();};
  if(previewSprites[id]){accept();return;}
  // A short dwell avoids loading sheets for every portrait crossed by the pointer.
  previewTimer=setTimeout(async()=>{try{const loaded=await loadSprites([id]);Object.assign(previewSprites,loaded);accept();}catch(error){if(request===previewRequest){previewReady=false;$('detail-sprite').hidden=true;$('detail-portrait').hidden=false;}console.warn('Preview unavailable:',id,error);}},90);
}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(selectionToSave(selected,saved,ROSTER)));}catch{}}
function input(){return mergeMovement(inputFromKeys(keys),touchControls?.input);}
function clearInput(){keys.clear();heldPhysicalKeys.clear();heldTouchKeys.clear();touchControls?.reset();syncPressedKeys();battle.input={x:0,y:0};if(renderer)renderer.preview=null;}
function syncBattleViewport(){const v=window.visualViewport,height=Math.round(v&&Math.abs(v.scale-1)<.01?v.height:window.innerHeight),width=window.innerWidth;if(viewportWidth&&(width!==viewportWidth||height!==viewportHeight))clearInput();viewportWidth=width;viewportHeight=height;document.documentElement.style.setProperty('--battle-viewport-height',height+'px');for(const {button} of Object.values(moveButtons)){if(mobileControls.matches)button.removeAttribute('title');else button.title=button.dataset.tooltip||'';}updateArenaLabel();syncCanvasViewport();}
function syncCanvasViewport(){
  if(!renderer||!document.body.classList.contains('in-battle'))return;
  const rect=$('arena').getBoundingClientRect(),mobile=mobileControls.matches,insets={left:12,right:12,top:12,bottom:16};
  if(mobile){
    for(const selector of ['.battle-hud','.battle-center']){const node=document.querySelector(selector);if(node)insets.top=Math.max(insets.top,node.getBoundingClientRect().bottom-rect.top+12);}
    if(rect.width>rect.height){const stick=$('touch-stick')?.getBoundingClientRect(),skill=document.querySelector('#ability-q')?.getBoundingClientRect();if(stick)insets.left=Math.max(12,stick.right-rect.left+12);if(skill)insets.right=Math.max(12,rect.right-skill.left+12);}
  }
  renderer.setViewport(rect.width,rect.height,{mobile,insets,dpr:window.devicePixelRatio||1});
}
function updateArenaLabel(p=battle.player?.def,e=battle.enemy?.def){if(!p||!e)return;const controlHint=mobileControls.matches?t('battle.controlHintTouch'):t('battle.controlHintKeyboard',{skill:getTrainerSkill(selected.playerSpecial).displayName});$('arena').setAttribute('aria-label',t('battle.arenaLabel',{player:p.displayName,enemy:e.displayName,hint:controlHint}));}
function toast(text){$('battle-toast').textContent=text;$('battle-toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('battle-toast').classList.remove('visible'),2200);}
function announce(text,duration=1100){$('battle-announcement').textContent=text;$('battle-announcement').classList.add('visible');clearTimeout(announcementTimer);announcementTimer=setTimeout(()=>$('battle-announcement').classList.remove('visible'),duration);}
function setPortrait(img,id,label=''){img.src=mon(id).portrait;img.alt=`${label} ${mon(id).displayName}`.trim();}
function setTypeChip(node,type,color){const lbl=getTypeLabel(type);node.textContent=lbl;node.dataset.type=type;node.style.setProperty('--type-color',color||'#acc8b6');node.title=lbl;}
function fighterTeam(side){return battle.teams?.[side]||battle[`${side}Team`]||[battle[side]].filter(Boolean);}
function activeMoves(){return {...getMoves(battle.player?.id||selected.playerTeam[0]),...(battle.moves||{}),s:getTrainerSkill(selected.playerSpecial)};}
function ui(kind,data){audio.unlock?.();audio.ui?.(kind,data);}
function validTeams(){return isComplete(selected.playerTeam,ROSTER)&&(playMode==='online'||selected.rivalMode==='auto'||isComplete(selected.enemyTeam,ROSTER));}
function refreshStart(){if(playMode==='online'){const full=isComplete(selected.playerTeam,ROSTER);$('room-create').disabled=networkBusy||!full;$('room-join').disabled=networkBusy||!full;$('start-button').disabled=loading||networkBusy||!full||!network.connected||network.lobby?.players[network.seat]?.ready;$('start-label').textContent=!full?t('select.partyCount',{n:selected.playerTeam.filter(Boolean).length}):!network.active?t('select.readyOnline'):network.lobby?.players[network.seat]?.ready?t('select.readyOnlineWait'):t('select.readyOnlineReady');return;}assetsReady=selected.playerTeam.filter(Boolean).every(id=>!!spriteMap[id]);$('start-button').disabled=loading||!validTeams();if(!loading)$('start-label').textContent=validTeams()?t('select.startBattle'):!isComplete(selected.playerTeam,ROSTER)?t('select.partyCount',{n:selected.playerTeam.filter(Boolean).length}):t('select.enemyCount',{n:selected.enemyTeam.filter(Boolean).length});}
function renderSlots(){for(const side of ['player','enemy']){const team=selected[side+'Team'];$(side+'-slots').innerHTML=team.map((id,i)=>'<button type="button" class="team-slot '+(id?'filled':'empty')+'" data-slot="'+i+'" data-side="'+side+'" '+(!id?'disabled':'')+' aria-label="'+(id?t('select.slotRemove',{name:mon(id).displayName}):t('select.slotEmpty',{n:i+1}))+'"><small>'+String(i+1).padStart(2,'0')+'</small>'+(id?'<img src="'+mon(id).portrait+'" alt=""><b>'+mon(id).displayName+'</b><span class="slot-remove" aria-hidden="true">×</span>':'<span class="empty-ball" aria-hidden="true">+</span>')+'</button>').join('');$(side+'-slots').hidden=side!==activeSide;$(side+'-count').textContent=team.filter(Boolean).length+' / 6';$('select-'+side+'-side').classList.toggle('active',side===activeSide);$('select-'+side+'-side').setAttribute('aria-pressed',String(side===activeSide));}$('select-enemy-side').hidden=selected.rivalMode!=='manual';$('rival-auto').setAttribute('aria-pressed',String(selected.rivalMode==='auto'));$('rival-manual').setAttribute('aria-pressed',String(selected.rivalMode==='manual'));$('rival-description').textContent=selected.rivalMode==='auto'?t('select.autoDesc'):t('select.manualDesc');$('selection-target').textContent=activeSide==='player'?t('select.myParty'):t('select.enemyParty');refreshStart();}
function setDraftSide(side){if(side==='enemy'&&selected.rivalMode!=='manual')return;activeSide=side;renderSlots();updateRosterCards();}
function draftChanged(){if(network.connected)network.unready();selected.intentionalDraft=true;lastBattleOptions=null;persist();renderSlots();updateRosterCards();}
function selectRoster(id){const result=togglePick(selected[activeSide+'Team'],id,ROSTER);showDetail(id);if(result.action==='full'||result.action==='error'){ui('error');$('selection-message').textContent=t('select.selectionFull');return;}selected[activeSide+'Team']=result.team;ui(result.action,mon(id));draftChanged();$('selection-message').textContent=result.action==='remove'?t('select.selectionRemoved',{name:mon(id).displayName}):t('select.selectionAdded',{name:mon(id).displayName,slot:result.slot});}
function buildRoster(){$('roster-grid').replaceChildren();$('type-filter').replaceChildren();$('roster-total').textContent=ROSTER.length;for(const data of ROSTER){const card=document.createElement('button');card.type='button';card.className='roster-card';card.dataset.id=data.id;card.style.setProperty('--mon-color',data.color);card.innerHTML='<img src="'+data.portrait+'" alt="" loading="lazy"><span class="roster-name"><b>'+data.displayName+'</b></span><span class="roster-element" aria-hidden="true">'+elementGlyph(data.type)+'</span><span class="slot-badge" hidden></span>';card.setAttribute('aria-label',t('select.rosterCardAria',{name:data.displayName,type:getTypeLabel(data.type)}));card.addEventListener('mouseenter',()=>{showDetail(data.id);audio.ui?.('hover');});card.addEventListener('focus',()=>showDetail(data.id));card.addEventListener('click',()=>selectRoster(data.id));$('roster-grid').append(card);}for(const type of ['',...new Set(ROSTER.flatMap(m=>m.types||[m.type]))]){const button=document.createElement('button');button.type='button';button.dataset.type=type;button.setAttribute('aria-pressed',String(!type));button.innerHTML=(type?'<span aria-hidden="true">'+elementGlyph(type)+'</span>':'')+'<b>'+(type?getTypeLabel(type):t('select.allTypes'))+'</b>';button.addEventListener('click',()=>{activeType=type;$('type-filter-label').textContent=type?t('select.typeFilter')+' · '+getTypeLabel(type):t('select.typeFilter');$('type-filter-disclosure').open=false;for(const item of $('type-filter').children)item.setAttribute('aria-pressed',String(item===button));ui('pick');filterRoster();});$('type-filter').append(button);}updateRosterCards();}
function updateRosterCards(){const team=selected[activeSide+'Team'];for(const card of document.querySelectorAll('.roster-card')){const id=card.dataset.id,slot=team.indexOf(id);card.classList.toggle('in-team',slot>=0);card.classList.toggle('active-choice',id===detailId);card.setAttribute('aria-pressed',String(slot>=0));card.setAttribute('aria-label',slot>=0?t('select.rosterPickedAria',{name:mon(id).displayName,slot:slot+1}):t('select.rosterUnpickedAria',{name:mon(id).displayName}));const badge=card.querySelector('.slot-badge');badge.hidden=slot<0;badge.textContent=slot+1;}const picked=team.includes(detailId);$('detail-pick').disabled=!detailId||(!picked&&team.every(Boolean));$('detail-pick').textContent=detailId?(picked?t('select.removeFromParty'):team.every(Boolean)?t('select.partyFull'):t('select.addToParty')):t('select.pickPrompt');}
function filterRoster(){const query=$('roster-search').value.toLowerCase().trim();let count=0;for(const card of document.querySelectorAll('.roster-card')){const data=mon(card.dataset.id),match=(!query||(data.ko+' '+data.name+' '+data.displayName+' '+data.id+' '+String(data.dex).padStart(3,'0')).toLowerCase().includes(query))&&(!activeType||(data.types||[data.type]).includes(activeType));card.hidden=!match;if(match)count++;}$('roster-empty').hidden=count>0;}
function showDetail(id){if(!id)return;const data=mon(id);detailId=id;$('selection-detail').classList.remove('empty-preview');$('selection-detail').style.setProperty('--preview-color',data.color);$('preview-empty').hidden=true;$('detail-portrait').hidden=false;setPortrait($('detail-portrait'),id);requestSelectionPreview(id);$('detail-number').textContent=data.custom?t('select.guestCharacter'):'No. '+String(data.dex).padStart(3,'0');$('detail-name').textContent=data.displayName;setTypeChip($('detail-type'),data.type,data.color);$('detail-type').textContent=(data.types||[data.type]).map(t=>getTypeLabel(t)).join(' / ');$('detail-role').textContent=data.displayRole;$('detail-tagline').textContent=data.displayTagline||(data.types||[data.type]).map(t=>getTypeLabel(t)).join(' / ');$('detail-hp').textContent=data.hp;$('detail-speed').textContent=data.speed;$('detail-basic').textContent=data.basic.displayName;const moves=getMoves(id);$('detail-moves').innerHTML=['q','w','e','r'].map(key=>{const move=moves[key];return '<details class="move-detail"><summary><kbd>'+key.toUpperCase()+'</kbd><span>'+iconFor(move,key)+'</span><b>'+move.displayName+'</b><em>'+t('select.detailCooldown',{sec:move.cooldown,cost:move.cost||0})+'</em></summary><p>'+move.description+'</p></details>';}).join('');updateRosterCards();}
function skillArt(skill,key='s'){return skill.icon?'<img src="'+skill.icon+'" alt="" loading="lazy">':iconFor(skill,key);}
function updateSkills(side){
  const choice=selected[side+'Special'],random=choice==='random',current=getTrainerSkill(choice);
  for(const button of $(side+'-special').children)button.setAttribute('aria-pressed',String(button.dataset.skill===choice));
  const name=document.createElement('strong'),description=document.createElement('span');
  name.textContent=random?t('select.randomSkill'):current.displayName+' · '+t('battle.reuse',{sec:current.cooldown});
  description.textContent=random?t('select.randomSkillDesc'):current.displayDescription;
  $(side+'-special-description').replaceChildren(name,description);
}
function buildOptions(){
  $('player-special').replaceChildren();$('enemy-special').replaceChildren();$('difficulty-buttons').replaceChildren();
  for(const side of ['player','enemy']){
    const choices=side==='enemy'?[{id:'random',displayName:t('select.randomSkill'),displayDescription:t('select.randomSkillDesc')},...TRAINER_SKILLS]:TRAINER_SKILLS;
    for(const skill of choices){
      const button=document.createElement('button'),random=skill.id==='random';
      button.type='button';button.dataset.skill=skill.id;
      if(random)button.className='random-skill';
      const art=random?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h3c4 0 8 12 12 12h3M17 14l4 4-4 4M3 18h3c1.8 0 3.6-2.4 5.3-5M14 8.3C15.4 6.9 16.7 6 18 6h3M17 2l4 4-4 4"/></svg>':skillArt(skill);
      button.innerHTML=art+'<b>'+skill.displayName+'</b>';
      button.setAttribute('aria-label',skill.displayName+(random?'':', '+t('battle.reuse',{sec:skill.cooldown}))+'. '+skill.displayDescription);
      button.addEventListener('click',()=>{selected[side+'Special']=skill.id;if(network.connected)network.unready();lastBattleOptions=null;ui('pick');persist();updateSkills(side);});
      $(side+'-special').append(button);
    }
    updateSkills(side);
  }
  for(const [index,[id,data]] of Object.entries(DIFFICULTIES).entries()){
    const button=document.createElement('button');button.type='button';button.dataset.difficulty=id;
    button.innerHTML='<span class="difficulty-number" aria-hidden="true">'+(index+1)+'</span><b>'+data.name+'</b>';
    button.title=data.name+' · '+data.description;button.setAttribute('aria-label',(index+1)+' '+data.name+': '+data.description);
    button.addEventListener('click',()=>{selected.difficulty=id;lastBattleOptions=null;ui('pick');persist();updateDifficulty();});
    $('difficulty-buttons').append(button);
  }
  updateDifficulty();
}
function updateDifficulty(){const current=DIFFICULTIES[selected.difficulty]||DIFFICULTIES.standard;for(const button of document.querySelectorAll('[data-difficulty]')){const active=button.dataset.difficulty===selected.difficulty;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}$('difficulty-description').innerHTML=`<b>${current.name}</b><span>${current.description}</span>`;}
function configureReady(){clearInput();battle.configure({mode:'cpu',playerTeam:selected.playerTeam.filter(Boolean),enemyTeam:selected.rivalMode==='manual'?selected.enemyTeam.filter(Boolean):undefined,playerSpecial:selected.playerSpecial,enemySpecial:selected.enemySpecial,difficulty:selected.difficulty});activeSignature='';syncActive();updateHud();refreshStart();}
function syncActive(){const p=battle.player?.def||mon(battle.player?.id||selected.playerTeam[0]),e=battle.enemy?.def||mon(battle.enemy?.id||selected.enemyTeam[0]);const signature=`${getLocale()}:${p.id}:${e.id}:${selected.playerSpecial}`;if(signature===activeSignature)return;activeSignature=signature;for(const [side,data] of [['player',p],['enemy',e]]){$(`${side}-name`).textContent=data.displayName;$(`${side}-dex`).textContent=data.custom?t('select.guestCharacter'):String(data.dex).padStart(3,'0');setPortrait($(`${side}-portrait`),data.id,side==='player'?t('select.myParty'):t('select.enemyParty'));setTypeChip($(`${side}-type`),data.type,data.color);}updateArenaLabel(p,e);createAbilities();}
function createAbilities(){
  touchControls?.resetActions();
  $('abilities').replaceChildren();$('specials').replaceChildren();$('move-guide').replaceChildren();
  for(const key of Object.keys(moveButtons))delete moveButtons[key];
  const moves=activeMoves();
  for(const key of ['q','w','e','r','s','d']){
    const move=moves[key];if(!move)continue;
    const art=move.trainer?skillArt(move,key):iconFor(move,key);
    const button=document.createElement('button');button.type='button';button.className='ability-button';button.id='ability-'+key;button.dataset.action=key;
    button.setAttribute('aria-label',t('battle.abilityAria',{key:key.toUpperCase(),name:move.displayName}));
    button.dataset.tooltip=t('battle.abilityTooltip',{name:move.displayName,desc:move.description||'',cd:move.cooldown,cost:move.cost||0});if(!mobileControls.matches)button.title=button.dataset.tooltip;
    button.innerHTML='<kbd class="ability-key" data-control-key="'+key+'">'+key.toUpperCase()+'</kbd><span class="ability-art">'+art+'<span class="cooldown-shade" style="transform:scaleY(0)"></span><span class="cooldown-number"></span></span><span class="ability-name"><b>'+move.displayName+'</b></span><span class="ability-state"></span>';
    for(const event of ['mouseenter','focus'])button.addEventListener(event,()=>{if(renderer&&!mobileControls.matches)renderer.preview=key;});
    for(const event of ['mouseleave','blur'])button.addEventListener(event,()=>{if(renderer)renderer.preview=null;});
    $(key==='s'||key==='d'?'specials':'abilities').append(button);
    moveButtons[key]={button,shade:button.querySelector('.cooldown-shade'),number:button.querySelector('.cooldown-number'),state:button.querySelector('.ability-state'),move};

  }
  const basic=(battle.player?.def||mon(selected.playerTeam[0])).basic;$('basic-name').textContent=basic.displayName;renderMoveGuide(moves,battle.player?.id||selected.playerTeam.find(Boolean)||ROSTER[0].id);syncPressedKeys();
}
function renderMoveGuide(moves,id){
  $('move-guide').replaceChildren();$('move-guide').dataset.pokemonId=id;
  $('help-pokemon-name').textContent=mon(id).displayName;setPortrait($('help-pokemon-portrait'),id);
  for(const key of ['q','w','e','r','s','d']){const move=moves[key];if(!move)continue;const art=move.trainer?skillArt(move,key):iconFor(move,key);
    const guide=document.createElement('article');guide.className='guide-card';guide.dataset.guideKey=key;
    const chips=key==='d'?`<span>${t('battle.invul05')}</span><span>${t('battle.reuse',{sec:2})}</span>`:`<span>${t('battle.reuse',{sec:move.cooldown})}</span>`+(move.cost?`<span>${t('battle.mpCost',{cost:move.cost})}</span>`:'');
    guide.innerHTML='<div class="guide-card-title"><kbd data-control-key="'+key+'">'+key.toUpperCase()+'</kbd><span class="guide-move-icon">'+art+'</span><strong>'+move.displayName+'</strong></div><div class="guide-chips">'+chips+'</div><details class="guide-description"><summary aria-label="'+t('select.detailMoveAria',{name:move.displayName})+'">'+t('select.detailMore')+'</summary><p>'+(move.description||'')+'</p></details>';
    $('move-guide').append(guide);
  }
}
function syncHelp(){const selecting=!$('start-screen').hidden,id=selecting?(detailId||selected.playerTeam.find(Boolean)||ROSTER[0].id):(battle.player?.id||ROSTER[0].id);renderMoveGuide(selecting?{...getMoves(id),s:getTrainerSkill(selected.playerSpecial)}:activeMoves(),id);}
function cast(key){if(battle.state!=='playing')return false;battle.input=input();return network.active?network.cast(key):battle.cast(key);}
async function ensureSprites(ids){loading=true;refreshStart();$('start-label').textContent=t('select.preparing');try{const missing=[...new Set(ids)].filter(id=>!spriteMap[id]);if(missing.length){const loaded=await loadSprites(missing);spriteMap={...spriteMap,...loaded};}if(renderer)renderer.sprites=spriteMap;return ids.every(id=>!!spriteMap[id]);}finally{loading=false;refreshStart();}}
async function begin(){clearCelebration();if(playMode==='online'){if(network.connected&&validTeams()){network.ready(selected.playerTeam,selected.playerSpecial);$('rematch-button').disabled=true;$('rematch-button').textContent=t('result.waitRematch');}return;}if(loading)return;if(!validTeams()){ui('error');return;}ui('confirm');clearTimeout(endTimer);clearInput();const rematch=$('start-screen').hidden&&lastBattleOptions;const options=rematch?structuredClone(lastBattleOptions):{playerSpecial:selected.playerSpecial,enemySpecial:selected.enemySpecial,difficulty:selected.difficulty,playerTeam:[...selected.playerTeam],enemyTeam:selected.rivalMode==='auto'?generateCpuTeam(ROSTER):[...selected.enemyTeam]};try{audio.start();const ready=await ensureSprites([...options.playerTeam,...options.enemyTeam]);if(!ready)throw new Error('Party sprites unavailable');lastBattleOptions=structuredClone(options);battle.configure({...options,enemySpecial:resolveTrainerSkillChoice(options.enemySpecial),mode:'cpu'});battle.start();activeSignature='';syncActive();lastCountdown=4;for(const id of ['start-screen','pause-screen','result-screen','party-screen'])$(id).hidden=true;$('game-shell').classList.remove('selecting');document.body.classList.add('in-battle');syncBattleViewport();$('battle-toast').classList.remove('visible');$('battle-announcement').classList.remove('visible');$('context-tip').textContent=t('battle.contextTip');audio.music.currentTime=0;audio.resume();$('arena').focus({preventScroll:true});updateHud();}catch(error){console.error(error);audio.pause();$('start-label').textContent=t('select.loadFailed');$('selection-message').textContent=t('select.loadFailedDetail');toast(t('select.loadFailedToast'));}}
function returnToSelect(){clearCelebration();if(network.active)network.leave();$('online-badge').hidden=true;$('online-connect').hidden=false;$('online-room').hidden=true;$('online-opponent').replaceChildren();$('pause-limit').hidden=true;$('resume-button').hidden=false;$('pause-title').textContent=t('pause.title');$('restart-button').hidden=false;$('rematch-button').disabled=false;$('rematch-button').textContent=t('result.rematch');$('pause-change-button').textContent=t('pause.returnToDraft');document.querySelector('.enemy-card .trainer-line small').textContent=t('ui.cpu');clearTimeout(endTimer);clearInput();audio.pause();for(const id of ['pause-screen','result-screen','party-screen'])$(id).hidden=true;$('start-screen').hidden=false;$('game-shell').classList.add('selecting');document.body.classList.remove('in-battle');syncBattleViewport();configureReady();renderSlots();$('select-player-side').focus({preventScroll:true});}
function pause(){clearInput();if(network.active){network.pause();return;}if(battle.pause()){$('pause-screen').hidden=false;$('resume-button').focus({preventScroll:true});audio.pause();updateHud();}}
function resume(){if(network.active){network.resume();return;}battle.resume();$('pause-screen').hidden=true;audio.resume();$('arena').focus({preventScroll:true});updateHud();}
function togglePause(){if(battle.state==='paused')resume();else if(['playing','countdown','transition'].includes(battle.state))pause();}
function openParty(){clearInput();if(network.active){if(onlinePartyOpen())network.cancelSwitch();else if(battle.switchCooldowns.player>0)toast(t('online.switchCooldownToast'));else network.party();return;}if(battle.state==='switching'){cancelParty();return;}if(battle.requestSwitch?.())syncParty();else handleEvents();}
function cancelParty(){if(network.active){network.cancelSwitch();return;}if(battle.cancelSwitch?.()){clearInput();$('party-screen').hidden=true;partyWasOpen=false;$('arena').focus({preventScroll:true});}}
function swap(index){if(network.active){network.switch(index);return;}if(battle.switchPokemon?.(index)){clearInput();$('party-screen').hidden=true;partyWasOpen=false;activeSignature='';syncActive();updateHud();$('arena').focus({preventScroll:true});}}
function syncParty(){if(battle.state!=='switching'&&!onlinePartyOpen()){if(partyWasOpen){$('party-screen').hidden=true;partyWasOpen=false;}return;}const team=fighterTeam('player'),active=battle.activeIndices?.player??0,forced=network.active?network.pauseInfo?.forced.includes(network.seat):battle.switchReason==='fainted',signature=JSON.stringify([getLocale(),active,forced,team.map(f=>[f.id,Math.ceil(f.hp),Math.floor(f.mp)])]);const firstOpen=!partyWasOpen;if(firstOpen)clearInput();partyWasOpen=true;$('party-screen').hidden=false;$('party-cancel').hidden=forced;$('party-message').textContent=network.active?t('party.onlinePause',{sec:Math.max(0,Math.ceil((network.pauseInfo.deadline-performance.now())/1000))}):forced?t('party.forced'):t('party.manual');if(signature!==partySignature||firstOpen){const focused=document.activeElement?.dataset?.partyIndex;partySignature=signature;$('party-list').innerHTML=team.map((f,i)=>{const disabled=i===active||f.hp<=0;const stKey=f.hp<=0?'fainted':i===active?'active':'switchable';const statusText=t('party.'+stKey);const ariaLabel=t('party.memberAria',{name:mon(f.id).displayName,status:stKey,hp:Math.ceil(f.hp),maxHp:f.maxHp});return `<button class="party-member ${i===active?'active-member':''} ${f.hp<=0?'fainted':''}" data-party-index="${i}" ${disabled?'disabled':''} aria-label="${ariaLabel}"><img src="${mon(f.id).portrait}" alt=""><span class="member-title"><b>${mon(f.id).displayName}</b><small>${statusText}</small></span><span class="member-numbers"><span>${t('ui.hp')} ${Math.ceil(f.hp)} / ${f.maxHp}</span><span>${t('ui.mp')} ${Math.floor(f.mp)} / ${f.maxMp||100}</span></span><span class="member-bar"><i style="width:${clamp(f.hp/f.maxHp)*100}%"></i></span><span class="member-bar mp"><i style="width:${clamp(f.mp/(f.maxMp||100))*100}%"></i></span></button>`;}).join('');if(focused!==undefined)$('party-list').querySelector(`[data-party-index="${focused}"]:not(:disabled)`)?.focus({preventScroll:true});}if(firstOpen)$('party-list').querySelector('button:not(:disabled)')?.focus({preventScroll:true});}
function partyNavigate(key){const items=[...$('party-list').querySelectorAll('button:not(:disabled)')];if(!items.length)return;let index=items.indexOf(document.activeElement);const step=key==='ArrowUp'||key==='ArrowLeft'?-1:1;items[(index+step+items.length)%items.length].focus({preventScroll:true});}
function statusFor(f){if(f.hp<=0)return t('status.fainted');if(battle.state!=='playing')return getStateLabel(battle.state)||'';if(f.stun>0)return t('status.stunned');if(f.dodgeGuard)return t('status.dodging');const tags=[];if(f.ignite)tags.push(t('status.ignited'));if(f.burn>0)tags.push(t('status.burning'));if(f.weakened>0)tags.push(t('status.weakened'));else if(f.slow>0)tags.push(t('status.slowed'));if(f.shield>0)tags.push(t('status.shielded'));if(f.cleanseGuard>0)tags.push(t('status.cleansed'));if(f.haste>0)tags.push(t('status.hasted'));if(f.attackBoost>0)tags.push(t('status.attackBoosted'));return tags.slice(0,2).join(' · ')||t('status.inBattle');}
function updateHud(){syncActive();syncParty();const p=battle.player,e=battle.enemy;if(!p||!e)return;for(const [side,f] of [['player',p],['enemy',e]]){const ratio=clamp(f.hp/f.maxHp);$(`${side}-hp-bar`).style.width=`${ratio*100}%`;$(`${side}-hp-lag`).style.width=`${ratio*100}%`;$(`${side}-hp-bar`).classList.toggle('low',ratio<.25);$(`${side}-hp-bar`).classList.toggle('mid',ratio>=.25&&ratio<.5);$(`${side}-hp`).textContent=`${Math.ceil(f.hp)} / ${f.maxHp}`;$(`${side}-status`).textContent=statusFor(f);$(`${side}-balls`).innerHTML=fighterTeam(side).map((member,i)=>`<i class="${member.hp<=0?'fainted':''} ${i===battle.activeIndices?.[side]?'active':''}" title="${mon(member.id).displayName}: ${member.hp<=0?t('status.fainted'):t('status.survived')}"></i>`).join('');}const action=e.action;if(action&&battle.state==='playing'&&e.hp>0){const windup=action.windup||0,elapsed=action.elapsed||0,attackEnd=action.attackEnd??windup;if(elapsed<windup){$('enemy-status').textContent=t('battle.phaseWindup',{sec:(windup-elapsed).toFixed(1)});$('enemy-status').className='phase-windup';}else if(elapsed>=attackEnd){$('enemy-status').textContent=t('battle.phaseRecovery');$('enemy-status').className='phase-recovery';}else{$('enemy-status').textContent=t('battle.phaseAttack');$('enemy-status').className='';}}else $('enemy-status').className='';$('battle-timer').textContent=formatTime(battle.time);$('battle-phase').textContent=getStateLabel(battle.state)||battle.state;const maxMp=p.maxMp||100;$('energy-bar').style.width=`${clamp(p.mp/maxMp)*100}%`;$('energy-value').textContent=`${Math.floor(p.mp)} / ${maxMp}`;for(const [key,ui] of Object.entries(moveButtons)){const cooldown=battle.cooldowns?.[key]??p.cooldowns?.[key]??0,move=key==='s'?ui.move:(battle.moves?.[key]||ui.move),cost=move.cost||0,ready=cooldown<.01&&p.mp>=cost;ui.number.textContent=cooldown>.01?(cooldown>=10?Math.ceil(cooldown):cooldown.toFixed(1)):'';ui.shade.style.transform=`scaleY(${clamp(cooldown/(move.cooldown||1))})`;ui.button.classList.toggle('on-cooldown',cooldown>.01);ui.button.classList.toggle('no-energy',p.mp<cost);ui.button.dataset.cooldown=cooldown.toFixed(2);ui.button.dataset.ready=String(ready);ui.button.disabled=battle.state!=='playing';ui.state.textContent=p.mp<cost?t('battle.mpInsufficient'):'';}
const basic=p.def.basic,timer=Math.max(0,p.basicTimer||0),windup=p.basicWindup?.time||0,distance=Math.hypot(p.x-e.x,p.y-e.y);$('basic-progress').style.transform=`scaleX(${clamp(1-timer/(basic.cooldown||1))})`;$('basic-meta').textContent=distance>basic.range?t('battle.outOfRange'):windup?t('battle.attacking'):timer>.01?t('battle.cooldownSec',{sec:timer.toFixed(1)}):t('battle.inRange');$('basic-stats').textContent=t('battle.basicHits',{hits:battle.stats?.basicHits||0,fired:battle.stats?.basicsFired||0});const cd=battle.switchCooldowns?.player||0;$('switch-cooldown').textContent=cd>.01?t('battle.switchCooldown',{sec:cd.toFixed(1)}):t('battle.switchReady');$('party-button').disabled=!['playing','switching'].includes(battle.state);$('pause-button').disabled=!['playing','countdown','transition','paused'].includes(battle.state);if(battle.state==='countdown'){const n=Math.ceil(battle.countdown||0);if(n>0&&n<lastCountdown){lastCountdown=n;announce(`${n}`,600);}}}
const confetti=new VictoryConfetti($('result-confetti'));let resultMvp=null,resultMvpTime=0;
function clearCelebration(){confetti.stop();resultMvp=null;}
function drawResultMvp(dt){
  if($('result-screen').hidden||!resultMvp)return;
  const canvas=$('mvp-sprite'),ctx=canvas.getContext('2d'),set=spriteMap[resultMvp.id],idle=set?.animations.idle;if(!ctx||!idle)return;
  resultMvpTime+=selected.motionEnabled&&!previewMotion.matches?dt:0;
  const bounds=previewBoundsFor(resultMvp.id,idle),scale=Math.min(10,canvas.width*.68/bounds.width,canvas.height*.74/bounds.height);
  ctx.clearRect(0,0,canvas.width,canvas.height);drawFighter(ctx,spriteMap,{id:resultMvp.id,def:{...mon(resultMvp.id),scale},x:canvas.width/2-bounds.center*scale,y:canvas.height*.9-bounds.bottom*scale,radius:32,hp:1,anim:'idle',animTime:resultMvpTime,facing:Math.PI/2,hurt:0});
}
function showResults(event){$('rematch-button').disabled=false;$('rematch-button').textContent=network.active?t('result.oneMore'):t('result.rematch');clearInput();const won=!!event.won,stats=event.stats||battle.stats||{};$('result-title').textContent=won?t('result.victory'):t('result.defeat');$('result-kicker').textContent=won?t('result.victoryKicker'):t('result.defeatKicker');$('result-text').textContent=network.active&&network.finishReason?network.finishReason:won?t('result.victoryText'):t('result.defeatText');$('result-time').textContent=formatTime(event.time??battle.time);$('result-damage').textContent=Math.round(stats.damageDealt||0).toLocaleString();$('result-knockouts').textContent=`${stats.knockouts??fighterTeam('enemy').filter(f=>f.hp<=0).length} / 6`;$('result-switches').textContent=stats.switches||0;resultMvp=pickMvp(fighterTeam('player'),stats);resultMvpTime=0;$('result-screen').dataset.outcome=won?'won':'lost';$('result-screen').dataset.motion=selected.motionEnabled&&!previewMotion.matches?'on':'off';$('mvp-highlight').hidden=!resultMvp;if(resultMvp){$('mvp-name').textContent=mon(resultMvp.id).displayName;$('mvp-sprite').setAttribute('aria-label','MVP '+mon(resultMvp.id).displayName);$('mvp-record').textContent=t('result.mvpRecord',{damage:Math.round(resultMvp.damage).toLocaleString(),ko:resultMvp.knockouts});}$('result-party').innerHTML=fighterTeam('player').map(f=>`<img src="${mon(f.id).portrait}" alt="${mon(f.id).displayName}${f.hp<=0?' '+t('status.fainted'):''}" class="${f.hp<=0?'fainted':''} ${f.id===resultMvp?.id?'is-mvp':''}">`).join('');clearTimeout(endTimer);endTimer=setTimeout(()=>{$('party-screen').hidden=true;$('result-screen').hidden=false;confetti.start({won,reducedMotion:!selected.motionEnabled||previewMotion.matches,width:window.innerWidth,height:window.innerHeight});$('rematch-button').focus({preventScroll:true});},1000);}
function handleEvents(){for(const event of battle.drainEvents()){renderer?.event(event);audio.handleBattleEvent?.(event,battle);if(event.type==='hint')toast(event.text);if(event.type==='resumeCountdown'){lastCountdown=4;clearInput();}if(event.type==='fight'){announce(t('battle.fightAnnounce'));}if(event.type==='trackingBreak'&&event.team==='player')toast(t('battle.dodgeSuccess'));if(event.type==='enemyCast'&&(event.ko||event.name||event.displayName))toast(t('battle.enemyCast',{enemy:battle.enemy?.def?.displayName||'',move:event.displayName||(getLocale()==='ko'?event.ko:event.name)||event.name||event.ko}));if(event.type==='faint'){toast(t('battle.faintedMsg',{name:event.displayName||event.name||mon(event.id).displayName}));if(event.team==='player')clearInput();else touchControls?.resetActions();syncParty();}if(event.type==='switch'){activeSignature='';syncActive();toast(event.team==='player'?t('battle.switchIn',{name:mon(event.toId).displayName}):t('battle.enemySwitchIn',{name:mon(event.toId).displayName}));syncParty();}if(event.type==='trainer')toast(t('battle.trainerCast',{trainer:event.team==='player'?t('select.red'):t('select.gold'),skill:event.displayName||getTrainerSkill(event.id).displayName}));if(event.type==='end')showResults(event);}}
function tick(now){const dt=Math.min((now-lastFrame)/1000||.016,.05);lastFrame=now;if(network.active){network.update(dt,input());syncOnlinePause();}else battle.update(dt,input());handleEvents();renderer?.update(dt);renderer?.draw();drawSelectionPreview(dt);drawResultMvp(dt);confetti.update(dt);hudTimer+=dt;if(hudTimer>.08||lastState!==battle.state){hudTimer=0;updateHud();lastState=battle.state;}requestAnimationFrame(tick);}
for(const side of ['player','enemy']){$('select-'+side+'-side').addEventListener('click',()=>setDraftSide(side));$(side+'-slots').addEventListener('click',event=>{const target=event.target.closest('[data-slot]');if(target){const id=selected[side+'Team'][Number(target.dataset.slot)];if(id)selectRoster(id);}});}
$('roster-search').addEventListener('input',filterRoster);
const recentDraft=restoreDraft(saved,ROSTER);$('load-recent').hidden=!recentDraft.some(Boolean);$('load-recent').addEventListener('click',()=>{selected.playerTeam=[...recentDraft];activeSide='player';ui('pick');draftChanged();showDetail(selected.playerTeam.find(Boolean));$('selection-message').textContent=t('select.recentLoaded');});
$('detail-pick').addEventListener('click',()=>{if(detailId)selectRoster(detailId);});
$('random-fill').addEventListener('click',()=>{selected[activeSide+'Team']=randomFill(selected[activeSide+'Team'],ROSTER);ui('pick');draftChanged();showDetail(selected[activeSide+'Team'].find(Boolean));$('selection-message').textContent=t('select.randomFilled');});
$('clear-party').addEventListener('click',()=>{selected[activeSide+'Team']=emptyDraft();ui('remove');draftChanged();$('selection-message').textContent=t('select.partyCleared');});
for(const mode of ['auto','manual'])$('rival-'+mode).addEventListener('click',()=>{selected.rivalMode=mode;activeSide=mode==='auto'?'player':'enemy';$('opponent-settings').open=false;ui('pick');lastBattleOptions=null;persist();renderSlots();updateRosterCards();});
const unlockAudio=()=>audio.unlock?.();document.addEventListener('pointerdown',unlockAudio,{once:true,capture:true});document.addEventListener('keydown',unlockAudio,{once:true,capture:true});
for(const [id,fn] of Object.entries({'start-button':begin,'resume-button':resume,'restart-button':begin,'rematch-button':begin,'pause-change-button':returnToSelect,'result-change-button':returnToSelect,'party-cancel':cancelParty}))$(id).addEventListener('click',fn);
$('party-list').addEventListener('click',event=>{const target=event.target.closest('[data-party-index]');if(target&&!target.disabled)swap(Number(target.dataset.partyIndex));});
function toggleSound(){const muted=audio.toggle();$('music-toggle').classList.toggle('muted',muted);$('music-label').textContent=muted?t('ui.soundOff'):t('ui.soundOn');$('music-toggle').setAttribute('aria-label',muted?t('ui.soundOffAria'):t('ui.soundOnAria'));try{localStorage.setItem('mt-silver-muted',String(muted));}catch{}}
$('music-toggle').addEventListener('click',toggleSound);try{if(localStorage.getItem('mt-silver-muted')==='true')toggleSound();}catch{}
$('music-volume').value=selected.musicVolume*100;audio.setVolume(selected.musicVolume);
$('music-volume').addEventListener('input',event=>{selected.musicVolume=Number(event.target.value)/100;audio.setVolume(selected.musicVolume);persist();});
$('sfx-volume').value=selected.sfxVolume*100;audio.setSfxVolume?.(selected.sfxVolume);
$('sfx-volume').addEventListener('input',event=>{selected.sfxVolume=Number(event.target.value)/100;audio.setSfxVolume?.(selected.sfxVolume);persist();});
$('motion-enabled').checked=selected.motionEnabled;$('motion-enabled').addEventListener('change',event=>{selected.motionEnabled=event.target.checked;renderer?.setMotionEnabled?.(selected.motionEnabled);persist();});
function updateHapticsCapability(){
  const feedback=audio.getFeedbackState?.()||{},supported=feedback.hapticsSupported===true;
  $('haptics-enabled').disabled=!supported;$('haptics-enabled').checked=supported&&selected.hapticsEnabled;
  $('haptics-status').textContent=!supported?t('settings.noVibration'):feedback.reducedMotion?t('settings.reducedMotion'):feedback.gamepadHapticsSupported?t('settings.gamepadVibration'):t('settings.deviceOnly');
  audio.setHapticsEnabled?.(selected.hapticsEnabled);
}
updateHapticsCapability();
for(const name of ['gamepadconnected','gamepaddisconnected'])window.addEventListener(name,updateHapticsCapability);
previewMotion.addEventListener?.('change',updateHapticsCapability);
$('haptics-enabled').addEventListener('change',event=>{selected.hapticsEnabled=event.target.checked;updateHapticsCapability();persist();});$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('game-shell').requestFullscreen();}catch{toast(t('ui.fullscreenFail'));}});
function openDialog(id){clearInput();if(id==='help-dialog')syncHelp();pausedForDialog=!network.active&&['playing','countdown','transition'].includes(battle.state);if(pausedForDialog){battle.pause();audio.pause();}$(id).showModal();}
for(const id of ['help-dialog','credits-dialog']){const dialog=$(id);dialog.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{clearInput();if(pausedForDialog){battle.resume();audio.resume();$('arena').focus({preventScroll:true});}pausedForDialog=false;if(battle.state==='switching')$('party-list').querySelector('button:not(:disabled)')?.focus({preventScroll:true});});}
for(const id of ['help-button','pause-help-button'])$(id).addEventListener('click',()=>openDialog('help-dialog'));for(const id of ['credits-button','pause-settings-button'])$(id).addEventListener('click',()=>openDialog('credits-dialog'));
window.addEventListener('keydown',event=>{if(event.metaKey||event.ctrlKey||event.altKey)return;const key=event.code==='KeyP'?'p':controlKey(event);if(event.target instanceof HTMLInputElement||event.target instanceof HTMLSelectElement||event.target instanceof HTMLTextAreaElement)return;
const dialog=document.querySelector('dialog[open]');if(dialog){if(dialog.id==='help-dialog'&&['ArrowUp','ArrowLeft','ArrowDown','ArrowRight','q','w','e','r','s','d','p'].includes(key)){heldPhysicalKeys.add(key);syncPressedKeys();}return;}
if(battle.state==='switching'||onlinePartyOpen()){if(key.startsWith('Arrow')){event.preventDefault();partyNavigate(key);}else if(key==='p'||key==='Escape'){event.preventDefault();if(!event.repeat)cancelParty();}else if(key==='Enter'){event.preventDefault();if(!event.repeat){const target=document.activeElement?.closest('[data-party-index]');if(target&&!target.disabled)swap(Number(target.dataset.partyIndex));}}else if(key==='Tab'){const targets=[...$('party-screen').querySelectorAll('button:not(:disabled):not([hidden])')];if(targets.length){event.preventDefault();let i=targets.indexOf(document.activeElement);targets[(i+(event.shiftKey?-1:1)+targets.length)%targets.length].focus();}}return;}
if((key==='m'||key==='h')&&!event.repeat){event.preventDefault();if(key==='m')toggleSound();else openDialog('help-dialog');return;}
if(!$('start-screen').hidden){if(key==='Enter'&&!(event.target instanceof HTMLButtonElement)){event.preventDefault();begin();}return;}
if(event.target instanceof HTMLButtonElement&&(key==='Enter'||key===' '))return;
if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','q','w','e','r','s','d','p','Escape','Enter'].includes(key))event.preventDefault();if(key.startsWith('Arrow')){if(battle.state==='playing'){keys.add(key);heldPhysicalKeys.add(key);syncPressedKeys();}return;}if(battle.state==='playing'&&['q','w','e','r','s','d','p'].includes(key)){heldPhysicalKeys.add(key);syncPressedKeys();}if(event.repeat)return;if(['q','w','e','r','s','d'].includes(key))cast(key);else if(key==='p')openParty();else if(key==='Escape')togglePause();else if(key==='m')toggleSound();else if(key==='h')openDialog('help-dialog');else if(key==='Enter'){if(['won','lost'].includes(battle.state))begin();else if(battle.state==='paused')resume();}});
window.addEventListener('keyup',event=>{const key=event.code==='KeyP'?'p':controlKey(event);heldPhysicalKeys.delete(key);if(![...heldTouchKeys.values()].includes(key))keys.delete(key);syncPressedKeys();});window.addEventListener('blur',()=>{clearInput();if(!network.active&&!document.querySelector('dialog[open]')&&['playing','countdown','transition'].includes(battle.state))pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();if(!network.active&&!document.querySelector('dialog[open]')&&['playing','countdown','transition'].includes(battle.state))pause();}});
touchControls=bindBattleTouch({stick:$('touch-stick'),root:document.querySelector('.battle-console'),canMove:()=>canTrackStick(battle.state),onAction:(action,event)=>{if(action==='party')openParty();else if(action==='pause')togglePause();else{cast(action);if(event.pointerType!=='touch'&&event.pointerType!=='pen')$('arena').focus({preventScroll:true});}},onPressChange:(id,key,pressed)=>{if(pressed)heldTouchKeys.set(id,key);else heldTouchKeys.delete(id);syncPressedKeys();}});
window.addEventListener('resize',syncBattleViewport);window.visualViewport?.addEventListener('resize',syncBattleViewport);window.addEventListener('orientationchange',()=>{clearInput();syncBattleViewport();});mobileControls.addEventListener?.('change',syncBattleViewport);syncBattleViewport();
async function loadCredits(){try{const [credits,music]=await Promise.all([fetch('/assets/sprite-credits.json').then(r=>r.json()),fetch('/assets/audio/music-credits.json').then(r=>r.json())]);$('sprite-credit-list').innerHTML=ROSTER.map(data=>{const record=credits.assets?.[data.id],creators=[...new Set((record?.credits||[]).map(item=>item.creator))];return `<div><b>${data.displayName} <small>${data.name}</small></b><span>${creators.join(' · ')||'PMD SpriteCollab'}</span></div>`;}).join('');$('sprite-credit-text').textContent=t('credits.spriteCreditsText');const track=music[0];if(track){$('music-credit-text').textContent=t('credits.musicCredit',{game:track.game,title:track.title,composer:track.composer,arranger:track.arranger});$('music-source-link').href=track.sourceUrl;$('music-source-link').hidden=false;}}catch(error){console.warn('Credit metadata unavailable',error);}}
async function init(){await initLocale();const langSelects=[$('language-select'),$('header-lang-select')].filter(Boolean),LOCALE_NAMES={ko:['한국어','KO'],en:['English','EN'],ja:['日本語','JA'],es:['Español','ES'],zh:['中文','ZH']};function updateLangDisplay(){const [name,code]=LOCALE_NAMES[getLocale()]||['한국어','KO'],display=$('header-lang-display');if(display){const n=display.querySelector('.lang-name'),c=display.querySelector('.lang-code');if(n)n.textContent=name;if(c)c.textContent=code;}}for(const select of langSelects){select.value=getLocale();select.addEventListener('change',async event=>{const val=event.target.value;for(const s of langSelects)s.value=val;await setLocale(val);});}updateLangDisplay();onChange(()=>{applyDOM();buildRoster();buildOptions();renderSlots();if(detailId)showDetail(detailId);updateArenaLabel();createAbilities();updateHud();updateHapticsCapability();loadCredits();const muted=audio.muted;$('music-label').textContent=muted?t('ui.soundOff'):t('ui.soundOn');$('music-toggle').setAttribute('aria-label',muted?'모든 소리 켜기':'모든 소리 끄기');if(getLocale()!=='ko')$('music-toggle').setAttribute('aria-label',muted?t('ui.soundOffAria'):t('ui.soundOnAria'));for(const s of langSelects)s.value=getLocale();updateLangDisplay();});buildRoster();buildOptions();renderSlots();showDetail(detailId);renderer=new Renderer($('arena'),spriteMap,battle);renderer.setMotionEnabled?.(selected.motionEnabled);configureReady();if(typeof ResizeObserver==='function'){const observer=new ResizeObserver(syncCanvasViewport);observer.observe(document.querySelector('.battle-stage'));observer.observe(document.querySelector('.battle-hud'));}syncBattleViewport();requestAnimationFrame(tick);loadCredits();try{await ensureSprites(selected.playerTeam.filter(Boolean));}catch(error){console.warn(error);$('selection-message').textContent=t('select.initPartial');}}
Object.defineProperty(window,'__arena',{value:Object.freeze({snapshot:()=>structuredClone({...battle.snapshot(),assetsReady,selected,selection:{...selected,activeSide,detailId,preview:{id:previewId,ready:previewReady,time:+previewTime.toFixed(3),reducedMotion:previewMotion.matches}},network:network.diagnostics(),controls:{touch:touchControls?.getState(),viewport:{width:viewportWidth,height:viewportHeight,mobile:mobileControls.matches}},feedback:{audio:audio.getFeedbackState?.(),visual:renderer?.getFeedbackDiagnostics?.()},audio:{playing:!audio.music.paused,muted:audio.muted,time:+audio.music.currentTime.toFixed(2),readyState:audio.music.readyState,error:audio.failed||false}})}),writable:false,configurable:false});
$('mode-solo').addEventListener('click',()=>setPlayMode('solo'));
$('mode-online').addEventListener('click',()=>setPlayMode('online'));
$('room-create').addEventListener('click',()=>connectOnline(true));
$('room-join').addEventListener('click',()=>connectOnline(false));
$('room-code-input').addEventListener('input',event=>{event.target.value=event.target.value.toUpperCase().replace(/[^A-Z2-9]/g,'');});
$('room-code-input').addEventListener('keydown',event=>{if(event.key==='Enter')connectOnline(false);});
$('room-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.origin+'/?room='+network.session.code);setNetworkStatus(t('online.inviteCopied'));}catch{setNetworkStatus(t('online.sendCode',{code:network.session.code}));}});
$('room-leave').addEventListener('click',()=>{network.leave();$('online-connect').hidden=false;$('online-room').hidden=true;$('online-opponent').replaceChildren();setNetworkStatus(t('online.leftRoom'));refreshStart();});
init().then(async()=>{const invite=new URLSearchParams(location.search).get('room'),savedRoom=network.savedSession();if(invite||savedRoom){setPlayMode('online');if(invite)$('room-code-input').value=invite.toUpperCase();if(savedRoom?.token&&(!invite||invite.toUpperCase()===savedRoom.code)){selected.playerTeam=savedRoom.team;selected.playerSpecial=savedRoom.special;renderSlots();updateSkills('player');try{await ensureSprites(savedRoom.team);await network.restore();}catch(error){setNetworkStatus(error.message);}}}});

