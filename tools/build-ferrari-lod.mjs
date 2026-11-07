import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '../scratchpad/browser-tools/node_modules/playwright/index.mjs';
const dir=path.resolve('scratchpad/ferrari-lod-build');process.env.TEMP=process.env.TMP=path.join(dir,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const browser=await chromium.launchPersistentContext(path.join(dir,`profile-${Date.now()}`),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
 const page=browser.pages()[0];await page.route('**/asset-builder',r=>r.fulfill({contentType:'text/html',body:'<body></body>'}));await page.goto('http://127.0.0.1:5186/asset-builder');
 const data=await page.evaluate(async()=>{
  const {CarLibrary}=await import('/src/core/Loader.ts');const {MeshoptSimplifier}=await import('/node_modules/meshoptimizer/meshopt_simplifier.js');await MeshoptSimplifier.ready;
  const lib=await CarLibrary.load();const parts=lib.bakedParts('sedan-sports').map(part=>{
   const g=part.geometry,p=g.getAttribute('position'),original=Uint32Array.from(g.index?.array??Array.from({length:p.count},(_,i)=>i));
   const [indices,error]=original.length>300?MeshoptSimplifier.simplify(original,p.array,3,Math.max(60,Math.floor(original.length*.025/3)*3),.006,['Permissive']):[original,0];
   return{vertices:p.count,originalIndices:original.length,indices:[...indices],error};
  });return{source:'/models/cars/ferrari.glb',parts,originalTriangles:parts.reduce((s,p)=>s+p.originalIndices/3,0),triangles:parts.reduce((s,p)=>s+p.indices.length/3,0)};
 });
 fs.writeFileSync('public/models/cars/ferrari-lod.json',JSON.stringify(data));console.log(JSON.stringify({...data,parts:data.parts.map(p=>({...p,indices:p.indices.length}))}));
}finally{await browser.close();}
