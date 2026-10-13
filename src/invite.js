export const SITE_ORIGIN = 'https://pokemon-arena-rosy.vercel.app';
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
export function normalizeName(value) {
  return typeof value === 'string' ? Array.from(value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim()).slice(0, 20).join('') : '';
}
export function inviteFromURL(value) {
  const url = new URL(value, SITE_ORIGIN);
  const code = (url.pathname.match(/^\/invite\/([^/]+)\/?$/)?.[1] || url.searchParams.get('room') || '').toUpperCase();
  return ROOM_CODE.test(code) ? {code, name: normalizeName(url.searchParams.get('name')), lang: shareLocale(url.searchParams.get('lang'))} : null;
}
export function shareLocale(value) { return ['ko','en','ja','es','zh'].includes(value) ? value : 'ko'; }
export function inviteURL(origin, code, name, lang = 'ko') {
  if (!ROOM_CODE.test(code)) throw new Error('Invalid room code');
  const url = new URL('/invite/' + code, origin);
  const normalized = normalizeName(name);
  if (normalized) url.searchParams.set('name', normalized);
  url.searchParams.set('lang', shareLocale(lang));
  return url.href;
}
