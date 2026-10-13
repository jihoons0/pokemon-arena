import {ROSTER_BY_ID,DIFFICULTIES} from './roster.js';
import {t} from './i18n/i18n.js';
const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
export function renderTeamLobby(root,data,network){
  root.replaceChildren();root.classList.add('team-lobby');
  if(!network.active)return;
  const host=network.seat===data.host,editable=['waiting','finished'].includes(data.phase);
  const toolbar=el('div','team-lobby-toolbar'),label=el('label','',t('teams.format')),format=el('select');
  format.setAttribute('aria-label',t('teams.format'));
  for(const [value,text]of [[1,'1 : 1'],[2,'2 : 2']]){const option=el('option','',text);option.value=value;format.append(option);}
  format.value=data.teamSize||1;format.disabled=!host||!editable;
  format.addEventListener('change',()=>network.configure({type:'format',teamSize:Number(format.value)}));label.append(format);toolbar.append(label);
  toolbar.append(el('span','team-lobby-hint',t('teams.everyoneReady')));root.append(toolbar);
  for(let side=0;side<2;side++){
    const section=el('section','lobby-team'),heading=el('h3','',t(side===0?'teams.a':'teams.b'));section.dataset.team=side;section.append(heading);
    for(let seat=side;seat<data.players.length;seat+=2){
      const p=data.players[seat],card=el('div','lobby-seat');card.dataset.seat=seat;
      const title=el('div','lobby-seat-title');title.append(el('strong','',p?(p.name||t('teams.trainer',{n:seat+1})):t('teams.empty')));
      if(p){title.append(el('small','',p.bot?'':seat===network.seat?t('teams.you'):seat===data.host?t('teams.host'):''));title.append(el('span','seat-ready',p.bot?DIFFICULTIES[p.difficulty].name:!p.connected?t('teams.reconnecting'):p.ready?t('teams.ready'):t('teams.preparing')));}
      card.append(title);
      if(p){const party=el('div','lobby-party');for(const id of p.team){const image=el('img');image.src=ROSTER_BY_ID[id].portrait;image.alt=ROSTER_BY_ID[id].displayName;party.append(image);}card.append(party);}
      if(host&&editable){
        if(!p||p.bot){
          const ai=el('select');ai.setAttribute('aria-label',t('teams.aiSlot',{team:side===0?'A':'B',n:Math.floor(seat/2)+1}));
          const empty=el('option','',t('teams.waitForPlayer'));empty.value='';ai.append(empty);
          for(const [value,difficulty]of Object.entries(DIFFICULTIES)){const option=el('option','',`AI · ${difficulty.name}`);option.value=value;ai.append(option);}
          ai.value=p?.difficulty||'';ai.addEventListener('change',()=>network.configure({type:'bot',seat,difficulty:ai.value||null}));card.append(ai);
        }
        if(p){
          const swap=el('select','seat-swap');swap.setAttribute('aria-label',t('teams.swapName',{name:p.name||t('teams.trainer',{n:seat+1})}));
          const placeholder=el('option','',t('teams.swap'));placeholder.value='';swap.append(placeholder);
          for(let other=1-side;other<data.players.length;other+=2){const occupant=data.players[other],option=el('option','',`${t(side===0?'teams.b':'teams.a')} ${Math.floor(other/2)+1} · ${occupant?.name||t('teams.empty')}`);option.value=other;swap.append(option);}
          swap.addEventListener('change',()=>{if(swap.value!=='')network.configure({type:'swap',a:seat,b:Number(swap.value)});});card.append(swap);
        }
      }
      section.append(card);
    }
    root.append(section);
  }
}
export function updateTeamHud(root,battle,onTarget){
  root.hidden=battle.sides.length!==4;document.body.classList.toggle('team-battle',!root.hidden);
  if(root.hidden)return;
  const ally=battle.source('ally'),other=battle.fighters.find(f=>!battle.isAllied('player',f.team)&&f!==battle.enemy);
  if(!root.firstChild){
    root.append(el('div','team-mini ally-mini'),el('button','team-mini target-mini'));
    root.lastChild.addEventListener('click',()=>{const side=root.lastChild.dataset.target;if(side)onTarget(side);});
  }
  for(const [node,f,isAlly]of [[root.firstChild,ally,true],[root.lastChild,other,false]]){
    if(!f)continue;
    const controller=battle.options.controllers[f.team]||{},living=battle.teams[f.team].filter(p=>p.hp>0).length;
    const name=controller.name||t('teams.trainer',{n:battle.sides.indexOf(f.team)+1}),label=isAlly?t('teams.ally'):t('teams.changeTarget');
    const signature=[f.team,f.id,name,controller.bot].join(':');
    if(node.dataset.signature!==signature){node.dataset.signature=signature;node.replaceChildren();const image=el('img');image.src=f.def.portrait;image.alt='';const text=el('span','mini-copy');text.append(el('b','',`${label} · ${name}${controller.bot&&!name.startsWith('AI')?' AI':''}`),el('small','',f.def.displayName));node.append(image,text,el('span','mini-hp'),el('span','mini-count'));if(!isAlly)node.append(el('kbd','','T'));}
    node.querySelector('.mini-hp').style.setProperty('--hp',Math.max(0,f.hp/f.maxHp)*100+'%');node.querySelector('.mini-count').textContent=living+'/6';
    node.classList.toggle('eliminated',!living);node.dataset.target=f.team;
    node.setAttribute('aria-label',isAlly?`${label} ${name}, ${f.def.displayName}, HP ${Math.ceil(f.hp)}`:t('teams.targetName',{name:f.def.displayName}));
    if(!isAlly)node.disabled=f.hp<=0||battle.state!=='playing';
  }
}
