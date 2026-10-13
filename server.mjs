import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';
const root = resolve(import.meta.dirname);
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.wav':'audio/wav','.mp3':'audio/mpeg','.ogg':'audio/ogg','.xml':'application/xml','.md':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try {
    if(req.url.startsWith('/invite/')||req.url.startsWith('/api/invite')){const {default:handler}=await import('./api/invite.js');return await handler(req,res);}
    if(req.url.startsWith('/api/og')){const {default:handler}=await import('./api/og.js');return await handler(req,res);}
    let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(url==='/')url='/index.html';
    const file=resolve(root, url.startsWith('/assets/') ? `public${url}` : `.${url}`);
    if(!file.startsWith(root+sep)){res.writeHead(403);return res.end('Forbidden');}
    const info=await stat(file); if(!info.isFile())throw new Error('not file');
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
    res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
});
const port=Number(process.env.PORT||5173);
server.listen(port,'127.0.0.1',()=>console.log(`Pokémon Arena ready at http://localhost:${port}`));
