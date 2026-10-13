import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all([
  cp(resolve(root, 'index.html'), resolve(output, 'index.html')),
  cp(resolve(root, 'src'), resolve(output, 'src'), { recursive: true }),
  cp(resolve(root, 'public'), output, { recursive: true }),
]);
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nAllow: /$\nAllow: /invite/\nAllow: /api/og\nAllow: /assets/brand/\nDisallow: /\n');
const html = await readFile(resolve(output, 'index.html'), 'utf8');
if (!html.includes('/src/app.js')) throw new Error('Build is missing the game entry point');
console.log('Built static game in dist/ (source, sprites, music, and credits).');
