import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
process.env.TEMP=process.env.TMP=path.resolve('scratchpad/shanghai-quality-tmp');
fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.resolve('scratchpad/shanghai-quality-profile'),{
 executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:900},
});
const errors=[],shaderErrors=[];
try {
 const page=context.pages()[0];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error/i.test(m.text()))shaderErrors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__quality={engine,physics,character,controller,cameraRig,chunkManager,shanghai,environment,weather,enterGame,THREE};'});});
 await page.goto('http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__quality,null,{timeout:90000}).catch(e=>{throw Error(e.message+' '+JSON.stringify(errors));});
 await page.evaluate(()=>{const q=window.__quality;q.enterGame();q.engine.stop();for(let i=0;i<120;i++){q.engine.hooks.fixedUpdate(1/60);q.engine.hooks.update(1/60,1);}q.engine.warmup();});
 await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 await page.waitForFunction(()=>{let ready=true;window.__quality.engine.scene.traverse(o=>{if(o.isMesh){for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map?.image instanceof HTMLImageElement&&!m.map.image.complete)ready=false;}});return ready;});
 await page.screenshot({path:'scratchpad/detail-spawn.png'});
 const report=await page.evaluate(async()=>{
  const q=window.__quality,{engine,THREE}=q;
  const check=(x,message)=>{if(!x)throw Error(message);};
  check(engine.renderPipeline==='direct-msaa','Unexpected fullscreen postprocessing');
  const water=[];let textures=0;
  engine.scene.traverse(o=>{if(o.name==='Huangpu-Water')water.push(o);if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map)textures++;});
  check(water.length>0&&textures>25,'Water or textured detail missing');
  const riverMaterial=water[0].material;
  check(riverMaterial.transparent&&!riverMaterial.depthWrite&&riverMaterial.uniforms.uRefractionReady.value===1,'Water must transmit the 3D submerged scene');
  const camera=engine.camera,position=camera.position.clone(),rotation=camera.quaternion.clone(),up=camera.up.clone();
  camera.position.set(96,20,20);camera.up.set(0,0,-1);camera.lookAt(96,-1,20);engine.warmup();
  const gl=engine.renderer.getContext(),size=engine.renderer.getDrawingBufferSize(new THREE.Vector2()),rgba=new Uint8Array(4);
  gl.readPixels(Math.floor(size.x/2),Math.floor(size.y/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);
  camera.position.copy(position);camera.quaternion.copy(rotation);camera.up.copy(up);
  check(Math.max(...rgba.slice(0,3))-Math.min(...rgba.slice(0,3))>10&&rgba[0]+rgba[1]+rgba[2]>60,'Water render is blank: '+JSON.stringify([...rgba]));
  const time=riverMaterial.uniforms.uTime.value;
  q.chunkManager.animateWater(time+3);
  check(riverMaterial.uniforms.uTime.value>time,'Water ripple time not advancing');
  return {waterChunks:water.length,texturedMeshes:textures,waterRGBA:[...rgba],renderPipeline:engine.renderPipeline};
 });
 await page.evaluate(()=>{const q=window.__quality;q.engine.camera.position.set(25,5,46);q.engine.camera.lookAt(-4,4.5,23);q.engine.warmup();});
 await page.screenshot({path:'scratchpad/detail-street.png'});
 await page.evaluate(()=>{const q=window.__quality;q.engine.camera.position.set(41,10,54);q.engine.camera.lookAt(153,13,-3);q.engine.warmup();});
 await page.screenshot({path:'scratchpad/detail-river-day.png'});
 await page.evaluate(()=>{const q=window.__quality;q.environment.skip(.43);q.engine.hooks.update(0,1);q.engine.camera.position.set(41,10,54);q.engine.camera.lookAt(153,13,-3);q.engine.warmup();});
 await page.screenshot({path:'scratchpad/detail-river-night.png'});
 await page.evaluate(()=>{const q=window.__quality;q.weather.toggle();for(let i=0;i<180;i++)q.engine.hooks.update(1/60,1);q.engine.camera.position.set(41,10,54);q.engine.camera.lookAt(153,13,-3);q.engine.warmup();});
 await page.screenshot({path:'scratchpad/detail-river-rain.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(shaderErrors,[],'Shader compile failures');
 fs.writeFileSync('scratchpad/shanghai-quality-result.json',JSON.stringify({passed:true,report,errors,shaderErrors},null,2));
 console.log('PASS',JSON.stringify(report));
}finally{await context.close();}
