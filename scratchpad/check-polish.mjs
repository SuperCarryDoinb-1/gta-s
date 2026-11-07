import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
const dir=path.resolve('scratchpad/polish-review');
process.env.TEMP=process.env.TMP=path.join(dir,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(dir,`profile-check-${Date.now()}`),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:900}});
const errors=[],gpuErrors=[];
try {
 const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|feedback loop/i.test(m.text()))gpuErrors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__polishCheck={engine,physics,character,controller,cameraRig,chunkManager,carLib,personLib,vehicle,urbanPolish,THREE};'});});
 const start=Date.now();await page.goto('http://127.0.0.1:5186/');await page.waitForFunction(()=>window.__polishCheck&&!document.getElementById('start-btn').disabled,null,{timeout:90000});const bootMs=Date.now()-start;
 if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();
 await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 const models=await page.evaluate(()=>{
  const q=window.__polishCheck;q.engine.stop();
  const types=['sedan','sedan-sports','suv','taxi','delivery'];
  const cars=types.map(type=>({type,triangles:q.carLib.bakedParts(type).reduce((sum,p)=>sum+(p.geometry.index?.count??p.geometry.getAttribute('position').count)/3,0),farTriangles:q.carLib.bakedParts(type).reduce((sum,p)=>sum+q.carLib.farGeometry(p.geometry).index.count/3,0),boxes:q.carLib.colliderBoxes(type)}));
  q.vehicle.setCarType('taxi');q.vehicle.syncVisual(1);
  const taxiWheels=q.vehicle.defaultWheelVisuals.flat().every(o=>!o.visible)&&q.vehicle.sportsWheelVisuals.every(o=>o.model.visible);
  q.vehicle.setCarType('sedan-sports');
  const swimming=['adventurer','animated-woman','man'].map(type=>{
   const p=q.personLib.spawn(type),crawl=p.actions.get('Swim_Forward').getClip(),idle=p.actions.get('Swim_Idle').getClip();
   const wrist=crawl.tracks.find(t=>/UpperArm.*quaternion/i.test(t.name)),v=wrist.values;
   let motion=0;for(let i=4;i<v.length;i++)motion=Math.max(motion,Math.abs(v[i]-v[i%4]));
   const root=crawl.tracks.find(t=>/^Root.position$/i.test(t.name));
   return{type,crawl:crawl.duration,idle:idle.duration,motion,rootFixed:!root||root.values.every((value,i)=>Math.abs(value-root.values[i%3])<1e-5)};
  });
  return{cars,taxiWheels,swimming};
 });
 assert.ok(models.taxiWheels,'Restored Ferrari variant does not use its original wheels');
 for(const car of models.cars)assert.ok(car.triangles===358788&&car.farTriangles<20000,'Civilian Ferrari replacement or LOD incorrect');
 assert.deepEqual(models.cars.find(c=>c.type==='delivery').boxes,models.cars.find(c=>c.type==='sedan').boxes,'Ferrari body and collider differ between paint variants');
 for(const p of models.swimming)assert.ok(p.motion>.2&&p.rootFixed,JSON.stringify(p));
 const paths=[];
 for(const location of [{name:'shop',x:-85,z:32,dx:-.12,frames:85,look:[-99,1.65,30],camera:[-90.4,2.6,34]},{name:'warehouse',x:183,z:192,dx:.12,frames:105,look:[204,2.2,195],camera:[188.2,3.2,189.5]},{name:'shelter',x:33,z:88,dx:.1,frames:75,look:[43,1.5,88],camera:[36.9,2.5,90.2]}]){
  const result=await page.evaluate(async s=>{
   const q=window.__polishCheck,{RAPIER}=await import('/src/core/Physics.ts');q.engine.stop();
   const pos=new q.THREE.Vector3(s.x,1.3,s.z);q.chunkManager.update(pos,Infinity);q.chunkManager.prepareCollisions(pos,30);q.physics.step(1/60);q.character.teleport(pos);q.character.settleOnGround();q.controller.reset();
   for(let i=0;i<s.frames;i++){q.character.beginStep();q.character.moveBy(new q.THREE.Vector3(s.dx,-.04,0));q.physics.step(1/60);q.character.endStep();}
   q.character.animate(.1,1,true);q.character.syncVisual(1);q.engine.prepareStep(1/60);q.urbanPolish.update(new q.THREE.Vector3(s.x,1,s.z));
   q.engine.camera.far=1000;q.engine.camera.updateProjectionMatrix();q.engine.camera.position.fromArray(s.camera);q.engine.camera.lookAt(new q.THREE.Vector3(...s.look));q.engine.warmup();
   const height=s.name==='warehouse'?4:2.8;
   const shelf=s.name==='shelter'?null:q.physics.world.castRay(new RAPIER.Ray({x:s.name==='warehouse'?199:-94,y:height,z:s.name==='warehouse'?183.3:26.2},{x:0,y:-1,z:0}),height,true,RAPIER.QueryFilterFlags.ONLY_FIXED);
   return{location:s.name,position:{...q.character.body.translation()},shelfTop:shelf?height-shelf.timeOfImpact:null,meshes:q.engine.renderer.info.render.calls};
  },location);
  paths.push(result);await page.screenshot({path:path.join(dir,`interior-${location.name}.png`)});
 }
 assert.ok(paths[0].position.x<-93&&paths[1].position.x>194&&paths[2].position.x>39,'Furnished doorway blocked '+JSON.stringify(paths));
 assert.ok(Math.abs(paths[0].shelfTop-1.84)<.03&&Math.abs(paths[1].shelfTop-3.05)<.03,'Furniture does not have matching collision '+JSON.stringify(paths));
 const roads=await page.evaluate(()=>{const q=window.__polishCheck;return['Shanghai-Road--1-0','Shanghai-Road-2-2'].map(name=>{const o=q.engine.scene.getObjectByName(name);if(!o)return{name,missing:true};const p=o.geometry.getAttribute('position');return{name,x:[...Array(p.count)].map((_,i)=>p.getX(i)).reduce((r,x)=>[Math.min(r[0],x),Math.max(r[1],x)],[Infinity,-Infinity]),z:[...Array(p.count)].map((_,i)=>p.getZ(i)).reduce((r,z)=>[Math.min(r[0],z),Math.max(r[1],z)],[Infinity,-Infinity])};});});
 assert.ok(roads.every(r=>!r.missing));assert.ok(roads[0].x[1]<0&&roads[1].z[0]>=140,'Road surfaces in the wrong district');
 const stop=await page.evaluate(()=>{const q=window.__polishCheck,original=q.engine.hooks;let fixed=0,updated=0;q.engine.setHooks({fixedUpdate:()=>{fixed++;q.engine.stop();},update:()=>updated++});q.engine.start();q.engine.tick(performance.now()+70);const r={fixed,updated,running:q.engine.running,accumulator:q.engine.accumulator};q.engine.setHooks(original);return r;});
 assert.deepEqual(stop,{fixed:1,updated:0,running:false,accumulator:0},'Engine advanced after stopping');
 assert.deepEqual(errors,[]);assert.deepEqual(gpuErrors,[]);
 fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify({bootMs,models,paths,roads,stop,errors,gpuErrors},null,2));console.log('PASS',JSON.stringify({bootMs,paths,stop,models}));
}finally{await context.close();}
