import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {inviteFromURL} from '../src/invite.js';
import {inviteHTML} from '../server/share.js';

let template;
export default async function handler(req, res) {
  const invite = inviteFromURL(req.url);
  if (!invite) { res.statusCode = 404; return res.end('Invite not found'); }
  template ||= readFile(join(process.cwd(), 'index.html'), 'utf8');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(inviteHTML(await template, invite));
}
