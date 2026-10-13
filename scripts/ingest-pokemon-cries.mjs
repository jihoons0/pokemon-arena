import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ROSTER} from '../src/roster.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(root,'public/assets/audio/cries');
await mkdir(destination,{recursive:true});
const pokemon=ROSTER.filter(mon=>!mon.custom);
const credits=[];let next=0;
await Promise.all(Array.from({length:5},async()=>{
  while(next<pokemon.length){const mon=pokemon[next++];const metadataUrl=`https://pokeapi.co/api/v2/pokemon/${mon.dex}`;const metadataResponse=await fetch(metadataUrl);if(!metadataResponse.ok)throw Error(`${mon.id} metadata: ${metadataResponse.status}`);const metadata=await metadataResponse.json();const sourceUrl=metadata.cries?.legacy||metadata.cries?.latest;if(!sourceUrl)throw Error(`No cry for ${mon.id}`);const audioResponse=await fetch(sourceUrl);if(!audioResponse.ok)throw Error(`${mon.id} cry: ${audioResponse.status}`);const bytes=Buffer.from(await audioResponse.arrayBuffer());if(bytes.toString('ascii',0,4)!=='OggS')throw Error(`Not Ogg: ${mon.id}`);await writeFile(resolve(destination,`${mon.dex}.ogg`),bytes);credits.push({id:mon.id,dex:mon.dex,name:mon.ko,file:`/assets/audio/cries/${mon.dex}.ogg`,sourceUrl,metadataUrl,variant:metadata.cries.legacy?'legacy':'latest'});
  }
}));
credits.sort((a,b)=>a.dex-b.dex);
await writeFile(resolve(destination,'credits.json'),JSON.stringify({source:'PokeAPI cries',repository:'https://github.com/PokeAPI/cries',rights:'Pokémon cries are original game audio owned by Nintendo, Creatures, Game Freak, and The Pokémon Company. PokeAPI availability is not a separate redistribution or commercial-use license. Noncommercial fan demo.',assets:credits},null,2)+'\n');
console.log(`Bundled ${credits.length} real Pokémon cries.`);
