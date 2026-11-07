import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {chromium} from './browser-tools/node_modules/playwright/index.mjs';
const out='scratchpad/roll-swim-review';fs.mkdirSync(out,{recursive:true});
process.env.TEMP=process.env.TMP=path.resolve(`${out}/tmp`);fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.resolve(`${out}/profile`),{
 executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1280,height:800},
});
const errors=[],gpuErrors=[];
try{
 const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|INVALID_OPERATION|feedback loop|shader error|VALIDATE_STATUS/.test(m.text()))gpuErrors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__real={engine,input,character,controller,cameraRig,physics,chunkManager,waterRenderer,environment,waterSurfaceHeight,THREE};'});});
 await page.goto('http://127.0.0.1:5186/');await page.waitForFunction(()=>window.__real,null,{timeout:90000}).catch(e=>{throw Error(e.message+' '+JSON.stringify({errors,gpuErrors}));});
 if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();
 await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 await page.evaluate(()=>{const stream=document.querySelector('#app canvas').captureStream(24),chunks=[];const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});recorder.ondataavailable=e=>chunks.push(e.data);window.__capture={recorder,chunks,stream};recorder.start();});
 await page.evaluate(()=>{const q=window.__real;q.engine.stop();q.character.teleport(new q.THREE.Vector3(25,1.3,16));q.character.settleOnGround();q.controller.reset();q.cameraRig.reset(Math.PI/2,.75,.2);for(let i=0;i<6;i++)q.engine.prepareStep(1/60);q.engine.warmup();});
 const samples=[];
 await page.keyboard.down('Space');
 for(const [label,frames]of [['takeoff',6],['rising-roll',9],['apex',9],['falling-roll',11],['landing',16]]){
  const sample=await page.evaluate(({frames,label})=>{const q=window.__real;for(let i=0;i<frames;i++)q.engine.prepareStep(1/60);q.engine.warmup();const pelvis=q.character.person.root.getObjectByName('Hips').getWorldPosition(new q.THREE.Vector3());const body=q.character.person.root.getObjectByName('Body').getWorldQuaternion(new q.THREE.Quaternion());return {label,y:q.character.body.translation().y,pelvisY:pelvis.y,bodyRotation:body.toArray(),clip:q.character.currentClip,rollTime:q.character.currentAction?.time,airTime:q.controller.airborneTime};},{frames,label});
  samples.push(sample);await page.screenshot({path:`${out}/jump-${label}.png`});
  if(label==='takeoff')await page.keyboard.up('Space');
 }
 assert.ok(samples[0].y>1.5&&samples[2].y>samples[0].y&&samples[3].y<samples[2].y,'Jump must ascend, then descend');
 assert.equal(samples[1].clip,'Jump_Roll');assert.equal(samples[3].clip,'Jump_Roll');
 const rotation=await page.evaluate(samples=>{const Q=window.__real.THREE.Quaternion;return new Q(...samples[0].bodyRotation).angleTo(new Q(...samples[2].bodyRotation));},samples);
 assert.ok(rotation>1.5,'Somersault is not visibly rotating: '+rotation);
 assert.ok(Math.abs(samples.at(-1).y-.971)<.1,'Roll does not land on floor');
 await page.evaluate(()=>{const q=window.__real;q.character.teleport(new q.THREE.Vector3(78,.28,36));q.controller.reset();q.cameraRig.reset(-Math.PI/2,1,.15);for(let i=0;i<12;i++)q.engine.prepareStep(1/60);q.engine.warmup();q.engine.start();});
 const before=await page.evaluate(()=>({body:window.__real.character.body.translation().y,camera:window.__real.engine.camera.position.y,state:window.__real.controller.state,running:window.__real.engine.running,enabled:window.__real.input.enabled}));
 await page.keyboard.down('Control');await page.waitForTimeout(350);
 const early=await page.evaluate(()=>({body:window.__real.character.body.translation().y,camera:window.__real.engine.camera.position.y,state:window.__real.controller.state,running:window.__real.engine.running,enabled:window.__real.input.enabled,control:window.__real.input.isDown('ControlLeft')}));
 fs.writeFileSync(`${out}/early-dive.json`,JSON.stringify({before,early,errors,gpuErrors},null,2));
 assert.ok(early.body<before.body-.15&&early.camera<before.camera-.1,'Camera does not immediately follow Ctrl dive');
 await page.waitForTimeout(1900);await page.keyboard.up('Control');
 const submerged=await page.evaluate(()=>({body:window.__real.character.body.translation().y,camera:window.__real.engine.camera.position.y,depth:window.__real.controller.waterDepth}));
 fs.writeFileSync(`${out}/dive-stages.json`,JSON.stringify({before,early,submerged,errors,gpuErrors},null,2));
 assert.ok(submerged.body<-3&&submerged.camera<-2,'Player and camera have not entered actual underwater space');
 await page.screenshot({path:`${out}/underwater-real-controls.png`});
 // Verify looking upward and following the camera direction is true 3D swimming.
 const aimBefore=await page.evaluate(()=>{const q=window.__real;q.cameraRig.reset(-Math.PI/2,1,-.3);return {...q.character.body.translation()};});
 await page.keyboard.down('w');await page.waitForTimeout(750);await page.keyboard.up('w');
 const aimed=await page.evaluate(()=>({y:window.__real.character.body.translation().y,x:window.__real.character.body.translation().x}));
 assert.ok(aimed.y>aimBefore.y+.2&&aimed.x>aimBefore.x+.4,'Swim movement is constrained to an XZ plane '+JSON.stringify({aimBefore,aimed}));
 await page.keyboard.down('Space');await page.waitForTimeout(2300);await page.keyboard.up('Space');
 const emerged=await page.evaluate(()=>{const q=window.__real,p=q.engine.camera.position;return {body:q.character.body.translation().y,camera:p.y,state:q.controller.state,surface:q.waterSurfaceHeight(p.x,p.z),fog:q.engine.scene.fog.far};});
 assert.equal(emerged.state,'swim');assert.ok(emerged.camera>emerged.surface+.1&&emerged.fog>100,'Camera remains below water after surfacing '+JSON.stringify(emerged));
 await page.screenshot({path:`${out}/surface-after-emerging.png`});
 const transmission=await page.evaluate(()=>{
  const q=window.__real,{THREE,engine}=q;engine.stop();
  engine.camera.position.set(76,7,37);engine.camera.lookAt(76,-2.6,37);
  const box=new THREE.Mesh(new THREE.BoxGeometry(1.5,1,1.5),new THREE.MeshBasicMaterial({color:0xff4422}));box.position.set(76,-2.6,37);box.layers.enable(2);engine.scene.add(box);
  const read=()=>{engine.warmup();const gl=engine.renderer.getContext(),size=engine.renderer.getDrawingBufferSize(new THREE.Vector2()),pixel=new Uint8Array(4);gl.readPixels(Math.floor(size.x/2),Math.floor(size.y/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return [...pixel];};
  const through=read();box.visible=false;const empty=read();engine.scene.remove(box);box.geometry.dispose();box.material.dispose();
  const water=[];engine.scene.traverse(o=>{if(o.name==='Huangpu-Water')water.push(o);});
  return {through,empty,transparent:water.every(o=>o.material.transparent),refractionReady:water[0].material.uniforms.uRefractionReady.value};
 });
 assert.ok(transmission.transparent&&transmission.refractionReady===1,'Water is still an opaque surface');
 assert.ok(transmission.through[0]>transmission.empty[0]+20,'Submerged geometry cannot be seen through the water '+JSON.stringify(transmission));
 await page.screenshot({path:`${out}/transparent-water.png`});
 assert.deepEqual(errors,[]);assert.deepEqual(gpuErrors,[]);
 fs.writeFileSync(`${out}/result.json`,JSON.stringify({samples,rotation,before,early,submerged,aimed,emerged,transmission,errors,gpuErrors},null,2));
 const video=await page.evaluate(async()=>{const c=window.__capture;await new Promise(resolve=>{c.recorder.onstop=resolve;c.recorder.stop();});const bytes=new Uint8Array(await new Blob(c.chunks,{type:'video/webm'}).arrayBuffer());c.stream.getTracks().forEach(t=>t.stop());let encoded='';for(let i=0;i<bytes.length;i+=32768)encoded+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(encoded);});
 fs.writeFileSync(`${out}/real-controls.webm`,Buffer.from(video,'base64'));
 console.log('PASS',JSON.stringify({rotation,before,early,submerged,aimed,emerged,transmission}));
}finally{await context.close();}
