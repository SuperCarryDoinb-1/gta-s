import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
process.env.TEMP=process.env.TMP=path.resolve('scratchpad/fleet-browser-tmp');
const context=await chromium.launchPersistentContext(path.resolve('scratchpad/quality-browser-profile'),{
 executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1280,height:720},
});
try {
 const page=context.pages()[0],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/main.ts*',async r=>{
  const response=await r.fetch();
  await r.fulfill({response,body:(await response.text())+'\nwindow.__quality={engine,physics,character,controller,input,playerManager,ownedVehicles,enterGame,THREE};'});
 });
 await page.goto('http://127.0.0.1:5181/?autotest=quality',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__quality, null, {timeout:60000}).catch(e=>{throw Error(e.message+' '+JSON.stringify(errors));});
 const report=await page.evaluate(async()=>{
  const q=window.__quality,{engine,character,controller,input,THREE}=q;
  q.enterGame();engine.stop();
  const bounds=()=>{character.mesh.updateMatrixWorld(true);return new THREE.Box3().setFromObject(character.mesh,true);};
  const step=()=>{engine.hooks.fixedUpdate(1/60);engine.hooks.update(1/60,1);};
  const history=[];for(let i=0;i<30;i++){step();history.push({y:character.body.translation().y,cy:character.collider.translation().y,grounded:character.grounded});}
  if(history.some(p=>p.y<.94))throw Error('Spawn transient penetration: '+JSON.stringify(history));
  const birth={body:{...character.body.translation()},feet:bounds().min.y,head:bounds().max.y};
  if(birth.feet<-.03||birth.head-birth.feet<1.8)throw Error('Spawn height/feet regression: '+JSON.stringify({birth,history}));
  input.debugHold('KeyW',true);
  for(let i=0;i<60;i++)step();
  input.debugHold('KeyW',false);
  for(let i=0;i<20;i++)step();
  const walked={...character.body.translation()};
  // Render-only frame clears normal edges: the physics jump queue must survive it.
  input.debugHold('Space',true);input.endFrame();input.debugHold('Space',false);
  const startY=character.body.translation().y;let peak=startY,minFeet=Infinity;
  for(let i=0;i<100;i++){step();peak=Math.max(peak,character.body.translation().y);minFeet=Math.min(minFeet,bounds().min.y);}
  if(peak-startY<1||!character.grounded)throw Error('Buffered jump/landing failed');
  const jump={height:peak-startY,minFeet,landingY:character.body.translation().y};
  input.debugHold('ShiftLeft',true);input.debugHold('KeyW',true);
  for(let i=0;i<90;i++)step();
  input.debugHold('ShiftLeft',false);input.debugHold('KeyW',false);
  for(let i=0;i<20;i++)step();
  if(!Number.isFinite(character.body.translation().y))throw Error('Run invalid');
  controller.reset();
  const frameTimes=[];let last=performance.now();engine.start();
  for(let i=0;i<90;i++)await new Promise(resolve=>requestAnimationFrame(now=>{frameTimes.push(now-last);last=now;resolve();}));
  engine.stop();frameTimes.sort((a,b)=>a-b);
  return {birth,walked,jump,performance:{medianMs:frameTimes[45],p95Ms:frameTimes[85],drawCalls:engine.renderer.info.render.calls,triangles:engine.renderer.info.render.triangles,pixelRatio:engine.stats.pixelRatio},finalFeet:bounds().min.y};
 });
 await page.screenshot({path:'scratchpad/world-quality.png'});
 if(errors.length)throw Error(errors.join('\n'));
 fs.writeFileSync('scratchpad/world-quality-result.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally { await context.close(); }
