import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
const output=path.resolve('scratchpad/stage-five-review');process.env.TEMP=process.env.TMP=path.join(output,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.join(output,`profile-${Date.now()}`),{
 executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:950},
});
const errors=[],gpuErrors=[];
try{
 const page=context.pages()[0];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});
 page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|feedback/i.test(m.text()))gpuErrors.push(m.text());});
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__five={engine,input,physics,character,controller,cameraRig,chunkManager,inventory,inventoryScreen,survivalLoot,session,shelterScreen,survivalSites,hostiles,health,weapons,wanted,battle,battleMode,worldEvents,THREE};'});});
 const waitLoaded=async()=>page.waitForFunction(()=>window.__five&&!document.querySelector('#start-btn').disabled,null,{timeout:90000}).catch(e=>{throw Error(e.message+JSON.stringify(errors));});
 const start=async()=>{if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');await page.evaluate(()=>window.__five.engine.stop());};
 const move=async(x,z)=>page.evaluate(({x,z})=>{const q=window.__five;q.engine.stop();q.chunkManager.update(new q.THREE.Vector3(x,1,z),Infinity);q.physics.step(1/60);q.character.teleport(new q.THREE.Vector3(x,2,z));q.character.settleOnGround();q.controller.reset();for(let i=0;i<6;i++)q.engine.prepareStep(1/60);q.engine.warmup();},{x,z});
 const getKit=async()=>{await move(18,19);await page.keyboard.press('i');for(const name of ['背包','手枪','手枪弹药','绷带'])await page.getByRole('button',{name:`拾取${name}`,exact:true}).click();await page.keyboard.press('i');await page.evaluate(()=>window.__five.engine.stop());};
 // Seed a genuine free-mode checkpoint before visiting the arena.
 await page.goto('http://127.0.0.1:5186/inventory-preview.html');
 const seed=await page.evaluate(async()=>{const {SurvivalInventory}=await import('/src/gameplay/SurvivalInventory.ts');const inv=new SurvivalInventory();for(const kind of ['backpack','pistol','jacket','armor'])inv.collect(kind);inv.collect('pistolAmmo',48);inv.wear('jacket');inv.wear('armor');inv.armorDurability=61;const raw=JSON.stringify({version:1,savedAt:123,inventory:inv.snapshot(),stash:[{kind:'bandage',count:3}],worldLoot:[],consumed:['intro:0'],defeated:[],money:321,hp:83,sequence:0});localStorage.setItem('shanghai-survival-v1',raw);return raw;});
 await page.goto('http://127.0.0.1:5186/');await waitLoaded();assert.equal(await page.evaluate(()=>window.__five.session.loaded),true);
 await page.screenshot({path:path.join(output,'mode-menu-free.png')});
 await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#battle-mode').click()]);await waitLoaded();
 const initial=await page.evaluate(()=>{const q=window.__five;return{battle:q.battleMode,state:q.battle.state,elapsed:q.battle.zone.elapsed,items:q.inventory.items(),remaining:q.battle.remaining,armed:q.battle.bots.filter(b=>b.armed).length,raw:localStorage.getItem('shanghai-survival-v1')};});
 assert.equal(initial.battle,true);assert.equal(initial.state,'waiting');assert.equal(initial.elapsed,0);assert.equal(initial.remaining,8);assert.equal(initial.armed,0);assert.equal(initial.items.length,0);assert.equal(initial.raw,seed);
 await page.screenshot({path:path.join(output,'mode-menu-battle.png')});await start();await getKit();
 const looted=await page.evaluate(()=>{const q=window.__five;for(let i=0;i<240;i++)q.engine.prepareStep(1/60);q.engine.warmup();return{armed:q.battle.bots.filter(b=>b.armed).length,ammo:q.battle.bots.map(b=>b.ammo),items:q.session.worldLoot.length,humanAmmo:q.inventory.ammo.pistol};});
 assert.equal(looted.armed,7);assert.ok(looted.ammo.every(n=>n===24),JSON.stringify(looted));assert.equal(looted.humanAmmo,24);assert.equal(looted.items,12);
 await page.screenshot({path:path.join(output,'battle-looting.png')});
 await page.keyboard.press('Escape');const paused=await page.evaluate(()=>window.__five.battle.zone.elapsed);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__five.battle.zone.elapsed),paused);await page.locator('#pause-resume').click();await page.evaluate(()=>window.__five.engine.stop());
 // Leave the bots to fight one another while the player stays away from the centre.
 await move(40,-140);
 const simulation=await page.evaluate(()=>{const q=window.__five;for(let i=0;i<3300&&!q.battle.finished;i++)q.engine.prepareStep(1/60);q.engine.warmup();return{state:q.battle.state,remaining:q.battle.remaining,kills:q.battle.kills,dead:q.battle.bots.filter(b=>b.hp<=0).length,armed:q.battle.bots.filter(b=>b.armed).length,ammo:q.battle.bots.map(b=>b.ammo),feed:q.battle.feed,positions:q.battle.bots.map(b=>({hp:b.hp,...b.body.translation()})),elapsed:q.battle.zone.elapsed};});
 console.log('AI SIMULATION',JSON.stringify(simulation));
 assert.equal(simulation.kills,0);assert.ok(simulation.dead>0&&simulation.remaining<8,'Bots must fight one another');assert.ok(simulation.ammo.every(n=>n>=0));assert.equal(simulation.state,'running');
 await page.screenshot({path:path.join(output,'battle-midgame.png')});
 await move(40,88);await page.keyboard.press('f');assert.equal(await page.locator('#shelter-screen').isVisible(),false);
 const zone=await page.evaluate(()=>{const q=window.__five;q.battle.zone.elapsed=230;q.inventory.collect('armor');q.inventory.wear('armor');q.health.hp=100;const durability=q.inventory.armorDurability;for(let i=0;i<90;i++)q.engine.prepareStep(1/60);q.engine.warmup();return{hp:q.health.hp,durability,before:durability,after:q.inventory.armorDurability,radius:q.battle.zone.state.radius,elapsed:q.battle.zone.elapsed};});
 assert.ok(zone.hp<100&&zone.radius<64);assert.equal(zone.after,zone.before,'Zone damage must bypass armor');
 await page.screenshot({path:path.join(output,'battle-outside-zone.png')});
 const defeat=await page.evaluate(()=>{const q=window.__five;q.health.hp=1;for(let i=0;i<90&&!q.battle.finished;i++)q.engine.prepareStep(1/60);q.health.update(10);return{state:q.battle.state,dead:q.health.dead,hp:q.health.hp,rank:q.battle.rank,raw:localStorage.getItem('shanghai-survival-v1')};});
 assert.equal(defeat.state,'lost');assert.equal(defeat.dead,true);assert.equal(defeat.hp,0);assert.ok(defeat.rank>=2);assert.equal(defeat.raw,seed);
 assert.equal(await page.locator('#battle-result').isVisible(),true);await page.screenshot({path:path.join(output,'battle-defeat.png')});
 await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#battle-restart').click()]);await waitLoaded();
 assert.equal(await page.evaluate(()=>window.__five.inventory.items().length),0);assert.equal(await page.evaluate(()=>window.__five.battle.remaining),8);
 await start();await getKit();
 const victory=await page.evaluate(async()=>{const q=window.__five,{RAPIER}=await import('/src/core/Physics.ts');q.weapons.current='pistol';q.input.locked=true;const before=q.inventory.ammo.pistol;
  for(const bot of q.battle.bots){const p=bot.body.translation();let origin;
   for(const [dx,dz]of [[0,-1],[0,1],[-1,0],[1,0]]){const o={x:p.x+dx*4,y:p.y+.25,z:p.z+dz*4};const dir=new q.THREE.Vector3(p.x-o.x,-.1,p.z-o.z).normalize();const hit=q.physics.world.castRay(new RAPIER.Ray(o,dir),5,true,undefined,undefined,q.character.collider);if(hit?.collider.parent()?.handle===bot.body.handle){origin=o;break;}}
   if(!origin)throw Error('No clear shot for '+bot.id);
   q.character.teleport(new q.THREE.Vector3(origin.x,2,origin.z));q.character.settleOnGround();q.physics.step(1/60);
   for(let i=0;i<3;i++){const t=bot.body.translation();q.engine.camera.position.set(origin.x,origin.y,origin.z);q.engine.camera.lookAt(t.x,t.y+.15,t.z);q.input.debugHold('Mouse0',true);q.weapons.update(1/60,false);q.input.endFrame();q.input.debugHold('Mouse0',false);}
  }
  q.input.locked=false;return{state:q.battle.state,rank:q.battle.rank,kills:q.battle.kills,remaining:q.battle.remaining,used:before-q.inventory.ammo.pistol,raw:localStorage.getItem('shanghai-survival-v1')};});
 assert.equal(victory.state,'won');assert.equal(victory.rank,1);assert.equal(victory.kills,7);assert.equal(victory.used,21);assert.equal(victory.remaining,1);assert.equal(victory.raw,seed);
 await page.screenshot({path:path.join(output,'battle-victory.png')});
 await Promise.all([page.waitForEvent('domcontentloaded'),page.locator('#battle-return').click()]);await waitLoaded();
 const returned=await page.evaluate(()=>{const q=window.__five;return{mode:q.battleMode,loaded:q.session.loaded,money:q.health.money,ammo:q.inventory.ammo.pistol,outfit:q.inventory.outfit,durability:q.inventory.armorDurability,stash:q.session.stash,raw:localStorage.getItem('shanghai-survival-v1')};});
 assert.equal(returned.mode,false);assert.equal(returned.loaded,true);assert.equal(returned.ammo,48);assert.equal(returned.money,321);assert.equal(returned.outfit,'jacket');assert.equal(returned.durability,61);assert.equal(returned.raw,seed);
 console.log('MODE ISOLATION / LOSS / REPLAY / VICTORY PASS');await start();
 // Real doorway movement and pickups in both added districts.
 const enter=async(x,z,dx)=>{await move(x,z);return page.evaluate(({dx})=>{const q=window.__five;for(let i=0;i<110;i++){q.character.beginStep();q.character.moveBy(new q.THREE.Vector3(dx,-.04,0));q.physics.step(1/60);q.character.endStep();}q.character.syncVisual(1);q.engine.prepareStep(1/60);q.engine.warmup();return{...q.character.body.translation()};},{dx});};
 const oldtown=await enter(-85,32,-.08);assert.ok(oldtown.x<-93&&oldtown.x>-100);await page.keyboard.press('i');await page.getByRole('button',{name:'拾取橙色工装套装',exact:true}).click();await page.keyboard.press('i');await page.evaluate(()=>window.__five.engine.stop());await page.screenshot({path:path.join(output,'oldtown-shop.png')});
 const port=await enter(184,192,.08);assert.ok(port.x>191&&port.x<198);await page.keyboard.press('i');await page.getByRole('button',{name:'拾取机枪',exact:true}).click();await page.keyboard.press('i');await page.evaluate(()=>window.__five.engine.stop());await page.screenshot({path:path.join(output,'port-warehouse.png')});
 const event=await page.evaluate(()=>{const q=window.__five;const before=q.session.worldLoot.length;q.worldEvents.timer=0;q.engine.prepareStep(1/60);const initial=q.worldEvents.active.mesh.position.y;for(let i=0;i<740;i++)q.engine.prepareStep(1/60);const a=q.worldEvents.active;const count=q.session.worldLoot.length;for(let i=0;i<120;i++)q.engine.prepareStep(1/60);return{initial,landed:a.landed,height:a.mesh.position.y,body:a.body.translation().y,title:a.title,count:count-before,after:q.session.worldLoot.length-count,x:a.x,z:a.z};});
 assert.ok(event.initial>20&&event.landed);assert.ok(Math.abs(event.height-event.body)<.1);assert.ok(event.count>=2&&event.count<=3);assert.equal(event.after,0);
 await move(event.x+4,event.z+4);await page.screenshot({path:path.join(output,'random-supply.png')});
 assert.deepEqual(errors,[]);assert.deepEqual(gpuErrors,[]);
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,initial:{...initial,raw:undefined},looted,simulation,zone,defeat:{...defeat,raw:undefined},victory:{...victory,raw:undefined},returned:{...returned,raw:undefined},oldtown,port,event,errors,gpuErrors},null,2));
 console.log('PASS: isolated matches, physical AI looting/combat, zone, defeat, replay, victory, checkpoint preservation, expanded districts, random drops');
}finally{await context.close();}
