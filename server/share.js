import {SITE_ORIGIN, inviteURL, normalizeName, shareLocale} from '../src/invite.js';

const copy = {
  ko: {brand:'포켓몬 아레나', description:'포켓몬 6마리로 나만의 파티를 만들고, 혼자 또는 친구와 실시간 배틀을 즐기세요.', invite:name=>`${name}님이 배틀에 초대했어요!`, join:'파티 6마리를 골라 친구와 실시간 배틀을 시작하세요.', friend:'친구', battle:'배틀 초대', tag:'6 vs 6 · 실시간 배틀', action:'친구와 대전', code:'방 코드'},
  en: {brand:'Pokémon Arena', description:'Build your party of six Pokémon. Play solo or challenge a friend in a real-time battle.', invite:name=>`${name} invited you to battle!`, join:'Pick your party of six and join your friend for a real-time battle.', friend:'A friend', battle:'You’re invited to battle', tag:'6 vs 6 · Real-time battles', action:'Battle a friend', code:'ROOM CODE'},
  ja: {brand:'ポケモンアリーナ', description:'6匹のポケモンでパーティを組んで、ソロでも友達ともリアルタイムバトル。', invite:name=>`${name}さんからバトルへの招待！`, join:'6匹のポケモンを選んで、友達とのリアルタイムバトルに参加しよう。', friend:'友達', battle:'バトルへの招待', tag:'6 vs 6 · リアルタイムバトル', action:'友達と対戦', code:'ルームコード'},
  es: {brand:'Pokémon Arena', description:'Crea tu equipo de seis Pokémon. Juega en solitario o reta a un amigo en tiempo real.', invite:name=>`¡${name} te invita a combatir!`, join:'Elige seis Pokémon y únete a tu amigo para un combate en tiempo real.', friend:'Un amigo', battle:'Invitación a combatir', tag:'6 vs 6 · Combates en tiempo real', action:'Combate con amigos', code:'CÓDIGO DE SALA'},
  zh: {brand:'宝可梦竞技场', description:'组建六只宝可梦的队伍，单人挑战或与朋友实时对战。', invite:name=>`${name}邀请你来对战！`, join:'选择六只宝可梦，加入朋友的实时对战。', friend:'朋友', battle:'对战邀请', tag:'6 vs 6 · 实时对战', action:'与朋友对战', code:'房间代码'},
};
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function shareInfo(invite) {
  const lang = shareLocale(invite?.lang), text = copy[lang], name = normalizeName(invite?.name) || text.friend;
  const url = invite ? inviteURL(SITE_ORIGIN, invite.code, name, lang) : SITE_ORIGIN + '/';
  const image = new URL('/api/og', SITE_ORIGIN);
  if (invite) { image.searchParams.set('room', invite.code); image.searchParams.set('name', name); image.searchParams.set('lang', lang); }
  return {lang, text, name, title:invite ? text.invite(name) : text.brand, description:invite ? text.join : text.description, url, image:invite ? image.href : SITE_ORIGIN + '/assets/brand/social-card.png'};
}
export function shareTags(invite) {
  const info = shareInfo(invite);
  return `<title>${escape(info.title)}</title>
<meta name="description" content="${escape(info.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escape(info.text.brand)}">
<meta property="og:title" content="${escape(info.title)}">
<meta property="og:description" content="${escape(info.description)}">
<meta property="og:url" content="${escape(info.url)}">
<meta property="og:image" content="${escape(info.image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escape(info.title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(info.title)}">
<meta name="twitter:description" content="${escape(info.description)}">
<meta name="twitter:image" content="${escape(info.image)}">`;
}
export function inviteHTML(template, invite) {
  return template.replace(/<!-- share:start -->[\s\S]*?<!-- share:end -->/, () => `<!-- share:start -->${shareTags(invite)}<!-- share:end -->`);
}
