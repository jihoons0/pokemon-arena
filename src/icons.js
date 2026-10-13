const paths={
  bolt:'<path d="m14 2-9 13h7l-2 11 13-16h-8l4-8Z" fill="currentColor"/><path d="m3 7 3 1m16 13 3 2M1 18h4" stroke="currentColor" stroke-width="1.5"/>',
  fan:'<path d="M4 22c5-9 11-13 20-16M8 25c4-8 9-11 18-13M2 17c7-8 13-10 22-12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m21 3 5 2-4 4" fill="currentColor"/>',
  volley:'<path d="M5 7h14M3 14h18M7 21h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m18 3 7 4-7 4m2-1 7 4-7 4m-2-1 7 4-7 4" fill="currentColor"/>',
  dash:'<path d="m18 4-8 9 6 1-5 10 13-13-7-1 5-6Z" fill="currentColor"/><path d="M2 8h8M1 14h6M3 20h4" stroke="currentColor" stroke-width="2"/>',
  slash:'<path d="M21 3c5 14-1 22-13 22 6-4 8-9 4-15l-7 6 1-9 9-4 3 6Z" fill="currentColor"/><path d="m13 8 5 8-2 4" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".45"/>',
  pulse:'<circle cx="14" cy="14" r="3" fill="currentColor"/><circle cx="14" cy="14" r="8" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="14" r="13" stroke="currentColor" opacity=".45"/>',
  field:'<ellipse cx="14" cy="20" rx="11" ry="5" stroke="currentColor" stroke-width="2"/><path d="M8 18c0-7 3-12 6-15 4 4 7 9 6 15M4 13c3-2 6-2 9 0m3-2c3-2 6-1 9 2" stroke="currentColor" stroke-width="1.7"/>',
  storm:'<path d="m18 1-12 14h7l-4 12L24 10h-9Z" fill="currentColor"/><path d="m4 3-2 6h4l-3 6m22 3-4 5h4l-3 4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  nova:'<path d="m14 1 3 9 9 4-9 3-3 10-3-10-10-3 10-4Z" fill="currentColor"/><circle cx="14" cy="14" r="5" fill="none" stroke="currentColor" opacity=".5"/>',
  beam:'<path d="M3 11h13l8-6-5 9 5 9-8-6H3Z" fill="currentColor"/><path d="M1 7h10M1 21h10" stroke="currentColor" stroke-width="1.5" opacity=".55"/>',
  guard:'<path d="M14 2 24 6v7c0 7-4 11-10 14C8 24 4 20 4 13V6Z" fill="currentColor"/><path d="M14 6v16" stroke="#11202d" stroke-width="2" opacity=".5"/>',
  blink:'<path d="m14 1 3 9 9 4-9 3-3 10-3-10-10-3 10-4Z" fill="currentColor"/><path d="m24 1 1 3 3 1-3 1-1 3-1-3-3-1 3-1Z" fill="currentColor" opacity=".6"/>',
  dodge:'<path d="M5 18c1-8 8-13 16-10l-4-5m4 5-6 2" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 22h12M2 14h6M1 20h4" stroke="currentColor" stroke-width="1.7"/><path d="m14 11 6 4-7 7 1-6-5-1Z" fill="currentColor"/>',
  heal:'<path d="M11 4h7v7h7v7h-7v7h-7v-7H4v-7h7Z" fill="currentColor"/><path d="M2 4V1h3m19 25h3v-3" stroke="currentColor" fill="none" opacity=".6"/>',
  basic:'<circle cx="14" cy="14" r="9" stroke="currentColor" stroke-width="2"/><path d="M14 2v5m0 14v5M2 14h5m14 0h5" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="14" r="3" fill="currentColor"/>'
};
Object.assign(paths,{
 boost:'<path d="M8 24V12H3L14 2l11 10h-5v12Z" fill="currentColor"/><path d="M4 26h20" stroke="currentColor" stroke-width="2"/>',
 haste:'<path d="m16 3-7 10 5 1-7 11 16-14-6-1 6-7Z" fill="currentColor"/><path d="M2 7h6M1 14h5M2 21h3" stroke="currentColor" stroke-width="2"/>',
 exhaust:'<path d="M7 3v13H2l12 10 12-10h-5V3Z" fill="currentColor"/><path d="M12 5v8m4-8v8" stroke="#faf6e9" stroke-width="2"/>',
 barrier:paths.guard,trainerHeal:paths.heal,
 cleanse:'<path d="m14 2 3 8 9 4-9 3-3 9-3-9-9-3 9-4Z" fill="currentColor"/><path d="m23 1 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z" fill="currentColor"/>',
 ignite:'<path d="M16 1c3 9-3 9 2 14 2-1 3-4 3-6 9 14 0 18-7 18S0 22 5 13c0 5 4 5 5 3C7 9 15 7 16 1Z" fill="currentColor"/>'
});
paths.blinkStrike=paths.blink;
const elementGlyphs={electric:'ϟ',fire:'△',water:'≈',grass:'✦',ghost:'◌',dragon:'◇',psychic:'◎',steel:'◆',rock:'⬟',normal:'●'};
export function iconFor(moveOrKind,key){if(typeof moveOrKind==='object'&&moveOrKind?.trainer&&moveOrKind.icon)return `<img class="trainer-icon-art" src="${moveOrKind.icon}" alt="" aria-hidden="true" width="28" height="28">`;const kind=typeof moveOrKind==='string'?moveOrKind:moveOrKind?.kind;const path=paths[kind]||paths[key]||paths.basic;return `<svg viewBox="0 0 28 28" fill="none" aria-hidden="true">${path}</svg>`;}
const typePaths={electric:paths.bolt,fire:paths.ignite,water:'<path d="M14 2C10 8 4 13 4 18a10 10 0 0 0 20 0c0-5-6-10-10-16Z" fill="currentColor"/>',grass:'<path d="M25 2C7 2 1 7 4 18c3 9 20 8 21-16Z" fill="currentColor"/><path d="M4 25 20 8" stroke="#fff" stroke-width="2"/>',ghost:'<path d="M4 25V13a10 10 0 0 1 20 0v12l-5-3-5 4-5-4Z" fill="currentColor"/><path d="M10 11v5m8-5v5" stroke="#fff" stroke-width="3"/>',psychic:paths.pulse,steel:paths.guard,rock:'<path d="m8 3 13 2 5 13-8 8-14-5L2 12Z" fill="currentColor"/>',dragon:paths.slash,normal:paths.basic,ice:'<path d="M14 1v26M3 7l22 14M3 21 25 7M9 3l5 5 5-5M9 25l5-5 5 5" stroke="currentColor" stroke-width="2"/>',flying:paths.fan,fighting:paths.boost,bug:paths.guard,poison:paths.field,dark:paths.slash,ground:paths.field,fairy:paths.cleanse};
export const elementGlyph=element=>'<svg viewBox="0 0 28 28" fill="none" aria-hidden="true">'+(typePaths[element]||paths.basic)+'</svg>';
export default iconFor;
