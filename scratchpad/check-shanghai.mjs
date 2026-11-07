import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';

process.env.TEMP=process.env.TMP=path.resolve('scratchpad/shanghai-browser-tmp');
fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.resolve('scratchpad/shanghai-browser-profile'),{
  executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:900},
});
const errors=[];
try {
  const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/src/main.ts*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+'\nwindow.__sh={engine,physics,character,controller,cameraRig,input,inventory,weapons,inventoryScreen,survivalLoot,health,vehicle,playerManager,pedestrians,traffic,wanted,chunkManager,shanghai,environment,enterGame,THREE};'});
  });
  await page.goto('http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__sh,null,{timeout:90000}).catch(e=>{throw Error(e.message+' '+JSON.stringify(errors));});
  await page.evaluate(()=>{
    const q=window.__sh;q.enterGame();q.engine.stop();
    for(let i=0;i<12;i++){q.engine.hooks.fixedUpdate(1/60);q.engine.hooks.update(1/60,1);}
    q.engine.renderer.render(q.engine.scene,q.engine.camera);
  });
  await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
  await page.screenshot({path:'scratchpad/shanghai-spawn.png'});
  const result=await page.evaluate(async()=>{
    const q=window.__sh,{THREE,input,character,controller,chunkManager,engine}=q;
    const layout=await import('/src/world/ShanghaiLayout.ts');
    const city=await import('/src/world/City.ts');
    const check=(condition,msg)=>{if(!condition)throw Error(msg);};
    const step=()=>{engine.hooks.fixedUpdate(1/60);engine.hooks.update(1/60,1);};
    const move=(x,z,y=1.3)=>{
      chunkManager.update(new THREE.Vector3(x,y,z),Infinity);
      q.physics.step(1/60);character.teleport(new THREE.Vector3(x,y,z));character.settleOnGround();controller.reset();
      for(let i=0;i<6;i++)step();
    };
    check(q.inventory.usedSlots===0&&q.health.money===0,'Empty start regression');
    check(character.body.translation().y>.9,'Spawn floor collision');
    check(city.chunkZone(1)==='ocean'&&city.chunkZone(0)==='city'&&city.chunkZone(2)==='city','Two banks and river');
    check(q.shanghai.root.children.length>0,'Missing Shanghai landmarks');
    const siteTests=[];
    for(const [label,x,z] of [['west quay',40,16],['store',1,32],['north bridge',96,-80],['south bridge',96,112],['east plaza',174,16]]) {
      move(x,z);const p=character.body.translation();
      check(p.y>.85&&p.y<1.6,label+' ground unavailable '+JSON.stringify(p));siteTests.push({label,position:{...p}});
    }
    // Physically walk through the convenience-store opening, not just teleport inside.
    move(12,32);q.cameraRig.reset(Math.PI/2,1,.1);input.debugHold('KeyW',true);
    for(let i=0;i<132;i++)step();input.debugHold('KeyW',false);
    check(character.body.translation().x<7&&character.body.translation().x>-8,'Store doorway blocked');
    check(q.survivalLoot.nearbyItems().length>0,'No searchable store supplies');
    const item=q.survivalLoot.nearbyItems()[0];const pickup=q.survivalLoot.pickup(item.id);
    check(pickup.startsWith('已拾取'),'Store pickup failed');
    // Cross the whole south bridge with real character movement.
    move(35,112);q.cameraRig.reset(-Math.PI/2,1,.1);input.debugHold('KeyW',true);input.debugHold('ShiftLeft',true);
    let minimumY=Infinity;
    for(let i=0;i<900;i++){step();minimumY=Math.min(minimumY,character.body.translation().y);}
    input.debugHold('KeyW',false);input.debugHold('ShiftLeft',false);
    const crossed={...character.body.translation()};check(crossed.x>150&&minimumY>.8,'Bridge crossing fell into river '+JSON.stringify({crossed,minimumY}));
    // The player can also drive a real physics vehicle across the same bridge.
    q.vehicle.setStashed(false);q.vehicle.teleportTo(35,112,Math.PI/2);
    move(35,109.5);input.debugHold('KeyE',true);step();input.debugHold('KeyE',false);
    for(let i=0;i<150;i++)step();
    check(q.playerManager.isDriving,'Cannot enter bridge test car');
    input.debugHold('KeyW',true);
    const carPosition=new THREE.Vector3();
    for(let i=0;i<700;i++){step();q.vehicle.getPosition(carPosition);if(carPosition.x>170)break;}
    input.debugHold('KeyW',false);q.vehicle.getPosition(carPosition);
    const driven={x:carPosition.x,y:carPosition.y,z:carPosition.z};
    check(driven.x>150&&Number.isFinite(driven.x+driven.y+driven.z)&&driven.y>0,'Bridge driving failed '+JSON.stringify(driven));
    q.playerManager.forceExit();
    // River must be deep water away from the bridge, with a working swim state.
    move(95,48,1.1);
    for(let i=0;i<120;i++)step();
    const swimming={position:{...character.body.translation()},state:controller.state};
    check(controller.state==='swim'&&swimming.position.y>-.5,'River swimming failed '+JSON.stringify(swimming));
    character.teleport(new THREE.Vector3(57,.28,48));controller.reset();q.cameraRig.reset(Math.PI/2,1,.15);
    input.debugHold('KeyW',true);
    for(let i=0;i<400;i++)step();input.debugHold('KeyW',false);
    const shore={...character.body.translation()};check(shore.x<47&&shore.y>.75,'Cannot climb river steps '+JSON.stringify(shore));
    // All streamed supplies are outside landmark buildings and the river.
    const invalidLoot=[];
    move(192,81);
    q.survivalLoot.forEachPoint((x,z)=>{if(!layout.clearLootPosition(x,z))invalidLoot.push({x,z});});
    check(invalidLoot.length===0,'Inaccessible landmark loot '+JSON.stringify(invalidLoot));
    const aiWater=[];
    for(let i=0;i<300;i++)step();
    q.traffic.forEachCar((x,z)=>{if(layout.isRiver(x,z))aiWater.push({type:'car',x,z});});
    q.pedestrians.forEachPed((x,z)=>{if(layout.isRiver(x,z))aiWater.push({type:'ped',x,z});});
    check(aiWater.length===0,'AI spawned into water '+JSON.stringify(aiWater));
    move(174,22);q.cameraRig.reset(-Math.PI/2,1,-.3);
    for(let i=0;i<6;i++)step();engine.renderer.render(engine.scene,engine.camera);
    return {siteTests,storePickup:pickup,crossed,minimumY,driven,swimming,shore,invalidLoot,aiWater};
  });
  await page.screenshot({path:'scratchpad/shanghai-pearl-plaza.png'});
  await page.evaluate(()=>{const q=window.__sh;q.character.teleport(new q.THREE.Vector3(39,1.3,26));q.character.settleOnGround();q.controller.reset();q.cameraRig.reset(-Math.PI/2,1,-.06);q.environment.skip(.46);for(let i=0;i<10;i++){q.engine.hooks.fixedUpdate(1/60);q.engine.hooks.update(1/60,1);}q.engine.renderer.render(q.engine.scene,q.engine.camera);});
  await page.screenshot({path:'scratchpad/shanghai-night.png'});
  assert.deepEqual(errors,[],'Page errors');
  fs.writeFileSync('scratchpad/shanghai-check-result.json',JSON.stringify({result,errors},null,2));
  console.log('PASS',JSON.stringify(result));
} finally {await context.close();}
