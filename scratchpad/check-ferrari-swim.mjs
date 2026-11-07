import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {chromium} from './browser-tools/node_modules/playwright/index.mjs';
const dir=path.resolve('scratchpad/swim-correction-review');fs.mkdirSync(dir,{recursive:true});process.env.TEMP=process.env.TMP=path.join(dir,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(dir,`game-profile-${Date.now()}`),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1280,height:800}});
const errors=[],gpuErrors=[];
try {
 const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|feedback loop/i.test(m.text()))gpuErrors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__fix={engine,physics,character,controller,cameraRig,input,carLib,personLib,traffic,vehicle,playerManager,chunkManager,THREE};'});});
 await page.goto('http://127.0.0.1:5186/');await page.waitForFunction(()=>window.__fix&&!document.getElementById('start-btn').disabled,null,{timeout:90000});
 if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 const before=await page.evaluate(()=>{const q=window.__fix;q.engine.stop();const v=q.vehicle;const p=v.chassisBody.translation();q.character.teleport(new q.THREE.Vector3(p.x-2.3,1.3,p.z));q.character.settleOnGround();q.controller.reset();for(let i=0;i<8;i++)q.engine.prepareStep(1/60);q.engine.camera.position.set(p.x+5,3.2,p.z+6);q.engine.camera.lookAt(p.x,.8,p.z);q.engine.warmup();return{stashed:v.stashed,position:{...v.chassisBody.translation()},body:!!v.carGroup.getObjectByName('body'),source:v.carGroup.children[0].userData.model};});
 assert.equal(before.stashed,false);assert.equal(before.source,'Ferrari 458 Italia');assert.ok(before.body);await page.screenshot({path:path.join(dir,'restored-ferrari.png')});
 await page.keyboard.press('e');const entered=await page.evaluate(()=>{const q=window.__fix;for(let i=0;i<120;i++)q.engine.prepareStep(1/60);q.engine.warmup();return{driving:q.playerManager.isDriving,favorite:q.playerManager.activeVehicle===q.vehicle,position:{...q.vehicle.chassisBody.translation()},sportsWheels:q.vehicle.sportsWheelVisuals.every(v=>v.model.visible)};});
 assert.ok(entered.driving&&entered.favorite&&entered.sportsWheels,'Cannot drive restored favorite '+JSON.stringify(entered));
 await page.keyboard.down('w');await page.evaluate(()=>{const q=window.__fix;for(let i=0;i<70;i++)q.engine.prepareStep(1/60);});await page.keyboard.up('w');
 const drove=await page.evaluate(()=>{const q=window.__fix;return{position:{...q.vehicle.chassisBody.translation()},speed:q.vehicle.speedKmh};});assert.ok(Math.hypot(drove.position.x-entered.position.x,drove.position.z-entered.position.z)>.5,'Ferrari does not drive');
 const lod=await page.evaluate(()=>{const q=window.__fix;const model=q.carLib.cloneTraffic('taxi'),lod=model.children[0];const camera=new q.THREE.PerspectiveCamera();camera.position.set(0,2,6);camera.updateMatrixWorld();lod.update(camera);const near=lod.levels.map(l=>l.object.visible);camera.position.set(0,2,60);camera.updateMatrixWorld();lod.update(camera);const far=lod.levels.map(l=>l.object.visible);return{near,far,triangles:q.carLib.bakedParts('taxi').reduce((n,p)=>n+p.geometry.index.count/3,0),farTriangles:q.carLib.bakedParts('taxi').reduce((n,p)=>n+q.carLib.farGeometry(p.geometry).index.count/3,0)};});assert.deepEqual(lod.near,[true,false]);assert.deepEqual(lod.far,[false,true]);assert.equal(lod.triangles,358788);assert.equal(lod.farTriangles,9077);
 const parked=await page.evaluate(()=>{
  const q=window.__fix;const chunk=[...q.chunkManager.chunks.values()].find(c=>c.parkedCars.some(p=>!p.taken&&p.spec.type!=='police'));
  const car=chunk.parkedCars.find(p=>!p.taken&&p.spec.type!=='police'),position=new q.THREE.Vector3(car.spec.x,1,car.spec.z);
  const counts=()=>{let near=0,far=0;const matrix=new q.THREE.Matrix4();for(const batch of chunk.carDetailBatches)for(const [kind,mesh]of [['near',batch.near],['far',batch.far]])for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);if(Math.abs(matrix.elements[12]-car.spec.x)<.01&&Math.abs(matrix.elements[14]-car.spec.z)<.01)kind==='near'?near++:far++;}return{near,far};};
  chunk.updateCarDetail(position);const near=counts();chunk.updateCarDetail(position.clone().add(new q.THREE.Vector3(150,0,0)));const far=counts();chunk.updateCarDetail(position);
  const candidate=q.chunkManager.nearestParked(position,1),taken=candidate.take(),hidden=counts();return{near,far,taken,hidden};
 });assert.ok(parked.near.near>0&&parked.near.far===0&&parked.far.near===0&&parked.far.far>0,'Parked Ferrari LOD incorrect');assert.ok(parked.taken&&parked.hidden.near===0&&parked.hidden.far===0,'Stolen parked car still rendered');
 const rigs=await page.evaluate(()=>{const q=window.__fix;return['adventurer','animated-woman','man'].map(type=>{
  const p=q.personLib.spawn(type),bones={};p.root.traverse(o=>{if(o.isBone)bones[o.name.replaceAll('.','')]=o;});
  const rows=[];for(const clip of ['Swim_Forward','Swim_Idle']){
   p.mixer.stopAllAction();const action=p.actions.get(clip);action.reset().play();action.paused=true;const spans={L:[],R:[]};let movingHead;
   for(let i=0;i<=24;i++){action.time=action.getClip().duration*i/24;p.mixer.update(0);p.root.updateMatrixWorld(true);for(const s of ['L','R'])spans[s].push(bones['LowerLeg'+s].getWorldPosition(new q.THREE.Vector3()).distanceTo(bones['Foot'+s].getWorldPosition(new q.THREE.Vector3())));if(i===12){const head=bones.Head.getWorldPosition(new q.THREE.Vector3()),hip=bones.Body.getWorldPosition(new q.THREE.Vector3());movingHead=head.sub(hip).toArray();}}
   rows.push({clip,shinLengthDrift:Math.max(...['L','R'].map(s=>Math.max(...spans[s])-Math.min(...spans[s]))),movingHead,duration:action.getClip().duration});
  }return{type,source:p.root.userData.swimAnimationSource,rows};
 });});
 // Quaternion and root-parented ankle tracks interpolate separately between
 // 30 Hz samples; allow up to 5 mm of sub-frame interpolation error.
 for(const rig of rigs){assert.ok(rig.source.includes('Quaternius'));for(const row of rig.rows)assert.ok(row.shinLengthDrift<.005,'Foot detached '+JSON.stringify(rig));assert.ok(Math.abs(rig.rows[0].movingHead[1])<.35,'Forward swimmer is vertical');assert.ok(rig.rows[1].movingHead[1]>.5,'Idle swimmer does not tread upright');}
 // Capture an actual moving underwater stroke, with physical position and the
 // gameplay animation mixer, rather than just an isolated rig preview.
 await page.keyboard.press('e');await page.evaluate(()=>{const q=window.__fix;for(let i=0;i<120;i++)q.engine.prepareStep(1/60);q.character.teleport(new q.THREE.Vector3(78,-3,36));q.controller.reset();q.cameraRig.reset(-Math.PI/2,1,.12);for(let i=0;i<12;i++)q.engine.prepareStep(1/60);});
 await page.keyboard.down('w');const swim=await page.evaluate(()=>{const q=window.__fix;for(let i=0;i<55;i++)q.engine.prepareStep(1/60);const p=q.character.body.translation();q.engine.camera.position.set(p.x+3,p.y+1,p.z+4);q.engine.camera.lookAt(p.x,p.y,p.z);q.engine.warmup();return{clip:q.character.currentClip,pitch:q.character.mesh.rotation.x,body:{...p},state:q.controller.state};});await page.keyboard.up('w');
 assert.equal(swim.clip,'Swim_Forward');assert.ok(Math.abs(swim.pitch)<.36,'Whole character still gets rotated twice');await page.screenshot({path:path.join(dir,'authored-underwater-stroke.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(gpuErrors,[]);fs.writeFileSync(path.join(dir,'checks.json'),JSON.stringify({before,entered,drove,lod,parked,rigs,swim,errors,gpuErrors},null,2));console.log('PASS',JSON.stringify({before,entered,drove,lod,parked,rigs,swim}));
}finally{await context.close();}
