import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {ImageResponse} from '@vercel/og';
import {shareInfo} from './share.js';

let assets;
const box = (style, ...children) => ({type:'div',props:{style:{display:'flex',...style},children}});
const image = (src, size, style = {}) => ({type:'img',props:{src,width:size,height:size,style}});
async function loadAssets() {
  const root = process.cwd();
  const [font, logo, ...portraits] = await Promise.all([
    readFile(join(root,'assets/share/NotoSansKR.ttf')),
    readFile(join(root,'public/assets/brand/logo-square.png')),
    ...['pikachu','charizard','gengar'].map(id=>readFile(join(root,`public/assets/pokemon/${id}/portrait/Normal.png`))),
  ]);
  const data = buffer => 'data:image/png;base64,' + buffer.toString('base64');
  return {font, logo:data(logo), portraits:portraits.map(data)};
}
export async function shareImage(invite) {
  const {font,logo,portraits} = await (assets ||= loadAssets());
  const {text,name} = shareInfo(invite);
  const card = box({width:'100%',height:'100%',background:'linear-gradient(125deg, #102635 0%, #204b51 100%)',color:'#faf6e9',fontFamily:'Arena',padding:'46px 56px',position:'relative',overflow:'hidden',flexDirection:'column'},
    box({alignItems:'center',gap:16,fontSize:28},image(logo,52),text.brand),
    box({position:'absolute',right:-84,bottom:-220,width:740,height:740,border:'2px solid #3b6263',borderRadius:'50%'}),
    box({position:'absolute',right:-8,bottom:-143,width:590,height:590,border:'2px solid #3b6263',borderRadius:'50%'}),
    box({marginTop:48,color:'#edc56a',fontSize:24},invite ? text.battle : text.tag),
    box({fontSize:invite ? (Array.from(name).length>12?48:70) : 76,letterSpacing:-2,lineHeight:1.2,width:invite?700:1000,marginTop:12,maxHeight:172,overflow:'hidden'},invite ? name : text.brand),
    box({marginTop:26,fontSize:25,color:'#c4d8d8',width:invite?660:560,lineHeight:1.5},invite ? text.join : text.description),
    box({position:'absolute',bottom:48,left:56,alignItems:'center',gap:16,fontSize:invite?22:24,color:'#102635',background:'#edc56a',padding:'14px 22px',borderRadius:12},invite ? text.code+'  '+invite.code : text.action),
    box({position:'absolute',right:50,bottom:60,alignItems:'flex-end',gap:12},...portraits.map((src,i)=>box({width:i===1?144:118,height:i===1?164:138,background:['#f5da8a','#eaa777','#bfb5e0'][i],borderRadius:20,border:'4px solid #fffdf444',justifyContent:'center',alignItems:'center',transform:`rotate(${[-9,0,9][i]}deg)`},image(src,i===1?124:102)))),
  );
  return new ImageResponse(card,{width:1200,height:630,fonts:[{name:'Arena',data:font,weight:700,style:'normal'}]});
}
