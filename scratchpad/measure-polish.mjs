import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
const tag=process.argv[2]??'baseline',dir=path.resolve('scratchpad/polish-review');
process.env.TEMP=process.env.TMP=path.join(dir,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(dir,`profile-${tag}-${Date.now()}`),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1280,height:800}});
const errors=[];
try{
 const page=context.pages()[0];page.on('pageerror',e=>{errors.push(e.message);console.log('ERROR',e.message);});
 await page.addInitScript(()=>{let seed=17731;Math.random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__polish={engine,physics,character,controller,cameraRig,input,chunkManager,environment,waterRenderer,inventory,session,THREE};'});});
 await page.goto('http://127.0.0.1:5186/');await page.waitForFunction(()=>window.__polish&&!document.getElementById('start-btn').disabled,null,{timeout:90000});
 if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();
 await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 const records=[];
 for(const scene of [{name:'bund',x:25,y:2,z:16,yaw:Math.PI/2},{name:'oldtown',x:-94,y:2,z:32,yaw:Math.PI/2},{name:'port',x:196,y:2,z:192,yaw:-Math.PI/2},{name:'underwater',x:78,y:-3,z:36,yaw:-Math.PI/2}]){
  await page.evaluate(s=>{const q=window.__polish;q.engine.stop();q.chunkManager.update(new q.THREE.Vector3(s.x,s.y,s.z),Infinity);q.physics.step(1/60);q.character.teleport(new q.THREE.Vector3(s.x,s.y,s.z));if(s.y>0)q.character.settleOnGround();q.controller.reset();q.cameraRig.reset(s.yaw,1,.12);for(let i=0;i<30;i++)q.engine.prepareStep(1/60);const [h,m]=q.environment.clock.split(':').map(Number);q.environment.skip(.38-(h*60+m)/1440);q.engine.start();},scene);
  const measure=await page.evaluate(async()=>{
   const q=window.__polish,intervals=[],calls=[],triangles=[],timings=[];const original=q.engine.hooks.update;
   q.engine.hooks.update=(...args)=>{const t=performance.now();original(...args);timings.push(performance.now()-t);};
   await new Promise(resolve=>{let n=0,previous;const frame=now=>{if(n>=30){if(previous!==undefined)intervals.push(now-previous);calls.push(q.engine.renderer.info.render.calls);triangles.push(q.engine.renderer.info.render.triangles);}previous=now;if(++n>=150)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
   q.engine.stop();q.engine.hooks.update=original;
   const summary=a=>{const s=[...a].sort((a,b)=>a-b);return{median:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:Math.max(...s)};};
   return{frames:summary(intervals),update:summary(timings),calls:summary(calls),triangles:summary(triangles),pixelRatio:q.engine.stats.pixelRatio,geometries:q.engine.renderer.info.memory.geometries,textures:q.engine.renderer.info.memory.textures};
  });
  await page.screenshot({path:path.join(dir,`${tag}-${scene.name}.png`)});records.push({scene:scene.name,...measure});console.log(tag,scene.name,JSON.stringify(measure));
 }
 fs.writeFileSync(path.join(dir,`${tag}.json`),JSON.stringify({tag,records,errors},null,2));
}finally{await context.close();}
