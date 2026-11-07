import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {chromium} from './browser-tools/node_modules/playwright/index.mjs';
process.env.TEMP=process.env.TMP=path.resolve('scratchpad/water-motion-tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.resolve('scratchpad/water-motion-profile'),{
 executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:900},
});
const errors=[],shaderErrors=[];
try {
 const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGLProgram|VALIDATE_STATUS|shader error/.test(m.text()))shaderErrors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__water={engine,character,controller,cameraRig,input,physics,chunkManager,shipTraffic,environment,enterGame,THREE};'});});
 await page.goto('http://127.0.0.1:5186/');await page.waitForFunction(()=>window.__water,null,{timeout:90000});
 await page.evaluate(()=>{window.__water.enterGame();window.__water.engine.stop();});
 await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 const report=await page.evaluate(()=>{
  const q=window.__water,{engine,character,controller,input,THREE}=q;
  const check=(x,m)=>{if(!x)throw Error(m);};
  const step=()=>{engine.prepareStep(1/60);};
  const move=(x,y,z,settle=false)=>{q.chunkManager.update(new THREE.Vector3(x,y,z),Infinity);q.physics.step(1/60);character.teleport(new THREE.Vector3(x,y,z));if(settle)character.settleOnGround();controller.reset();for(let i=0;i<6;i++)step();};
  const bounds=()=>{character.mesh.updateMatrixWorld(true);return new THREE.Box3().setFromObject(character.mesh,true);};
  move(16,1.3,16,true);const start={y:character.body.translation().y,feet:bounds().min.y,head:bounds().max.y};
  input.debugHold('Space',true);const jump=[];
  for(let i=0;i<80;i++){step();if(i===0)input.debugHold('Space',false);const b=bounds();jump.push({y:character.body.translation().y,feet:b.min.y,head:b.max.y,clip:character.currentClip,vy:controller.verticalVelocity});}
  for(let i=1;i<12;i++)check(jump[i].y>jump[i-1].y,'Body falls during takeoff');
  for(let i=1;i<5;i++){check(jump[i].head>jump[i-1].head,'Body lowers before lifting into roll');check(jump[i].feet>jump[i-1].feet,'Feet lower before lifting into roll');}
  check(Math.max(...jump.map(p=>p.y))-start.y>1.4,'Jump is too short');
  check(jump.some(p=>p.clip==='Jump_Roll'&&p.vy>0)&&jump.some(p=>p.clip==='Jump_Roll'&&p.vy<0),'Roll must span both ascent and descent');
  check(Math.abs(jump.at(-1).y-start.y)<.06&&character.grounded,'Jump fails to land');
  check(Math.min(...jump.map(p=>p.feet))>-.04,'Feet penetrate floor during jump');
  // Hold Ctrl to descend, release to remain underwater, hold Space to return.
  move(96,.28,32);input.debugHold('ControlLeft',true);const diving=[];
  for(let i=0;i<240;i++){step();if(i%30===0)diving.push(character.body.translation().y);}input.debugHold('ControlLeft',false);
  const depth=character.body.translation().y;check(depth < -6&&controller.state==='dive','Cannot dive below surface: '+depth);
  for(let i=0;i<120;i++)step();const heldDepth=character.body.translation().y;
  check(Math.abs(heldDepth-depth)<.7,'Unexpected teleport/buoyancy pulls diver to surface');
  check(q.engine.scene.fog.far<70&&q.engine.camera.position.y<0,'Missing underwater camera/fog');
  const floorHit=q.physics.world.castRayAndGetNormal({origin:{x:96,y:1,z:32},dir:{x:0,y:-1,z:0}},30,true,undefined,undefined,character.collider,character.body);
  check(floorHit&&1-floorHit.timeOfImpact < -10,'No deep seabed collision');
  input.debugHold('ControlLeft',true);for(let i=0;i<180;i++)step();input.debugHold('ControlLeft',false);
  const bottomContact=character.body.translation().y;
  check(Math.abs(bottomContact-(1-floorHit.timeOfImpact+.97))<.12,'Cannot rest on the real seabed '+bottomContact);
  const boatPositions=q.shipTraffic.ships.map(s=>s.position.clone());for(let i=0;i<120;i++)step();
  const shipTravel=q.shipTraffic.ships.map((s,i)=>s.position.distanceTo(boatPositions[i]));
  check(q.shipTraffic.ships.length>=3&&shipTravel[0]>.1&&shipTravel[1]>.1&&Math.max(...shipTravel)>1,'Missing moving ships '+JSON.stringify(shipTravel));
  for(const ship of q.shipTraffic.ships){check(ship.position.x>48&&ship.position.x<144,'Ship leaves water');check(Number.isFinite(ship.body.translation().y),'Ship physics invalid');}
  engine.warmup();
  return {start,jump,diving,depth,heldDepth,bottomContact,seabedY:1-floorHit.timeOfImpact,shipTravel};
 });
 await page.screenshot({path:'scratchpad/water-underwater.png'});
 const surfaced=await page.evaluate(()=>{const q=window.__water;q.input.debugHold('Space',true);for(let i=0;i<360;i++)q.engine.prepareStep(1/60);q.input.debugHold('Space',false);q.engine.warmup();return {y:q.character.body.translation().y,state:q.controller.state,fogFar:q.engine.scene.fog.far};});
 assert.ok(Math.abs(surfaced.y-.28)<.4&&surfaced.state==='swim'&&surfaced.fogFar>100,'Cannot return to surface');
 await page.screenshot({path:'scratchpad/water-surface-ships.png'});
 const shore=await page.evaluate(()=>{const q=window.__water;q.character.teleport(new q.THREE.Vector3(57,.28,48));q.controller.reset();q.cameraRig.reset(Math.PI/2,1,.15);q.input.debugHold('KeyW',true);for(let i=0;i<400;i++)q.engine.prepareStep(1/60);q.input.debugHold('KeyW',false);return {...q.character.body.translation()};});
 assert.ok(shore.x<47&&shore.y>.75,'Cannot climb back onto bank');
 const bridge=await page.evaluate(()=>{const q=window.__water;q.character.teleport(new q.THREE.Vector3(96,-4,-80));q.controller.reset();q.input.debugHold('Space',true);for(let i=0;i<180;i++)q.engine.prepareStep(1/60);q.input.debugHold('Space',false);return {y:q.character.body.translation().y,state:q.controller.state};});
 assert.ok(bridge.y < -1.2,'Diver teleports through bridge deck');
 assert.deepEqual(errors,[]);assert.deepEqual(shaderErrors,[]);
 fs.writeFileSync('scratchpad/water-motion-result.json',JSON.stringify({report,surfaced,shore,bridge,errors,shaderErrors},null,2));
 console.log('PASS',JSON.stringify({jumpPeak:Math.max(...report.jump.map(p=>p.y)),depth:report.depth,seabedY:report.seabedY,shipTravel:report.shipTravel,surfaced,shore,bridge}));
}finally{await context.close();}
