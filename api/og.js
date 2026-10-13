import {inviteFromURL} from '../src/invite.js';
import {shareImage} from '../server/share-image.js';
export default async function handler(req, res) {
  const response = await shareImage(inviteFromURL(req.url));
  res.setHeader('Content-Type','image/png');
  res.setHeader('Cache-Control','public, max-age=86400, s-maxage=604800');
  res.end(Buffer.from(await response.arrayBuffer()));
}
