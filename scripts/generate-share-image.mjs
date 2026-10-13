import {writeFile} from 'node:fs/promises';
import {shareImage} from '../server/share-image.js';
const response = await shareImage();
await writeFile('public/assets/brand/social-card.png',Buffer.from(await response.arrayBuffer()));
console.log('Generated 1200×630 default sharing image.');
