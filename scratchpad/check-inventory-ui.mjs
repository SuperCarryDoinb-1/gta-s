import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
process.env.TEMP = process.env.TMP = path.resolve('scratchpad/inventory-ui-tmp');
fs.mkdirSync(process.env.TEMP,{recursive:true});
const context = await chromium.launchPersistentContext(path.resolve('scratchpad/inventory-ui-profile'), {
  executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1440,height:900},
});
const errors=[];
try {
  const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
  const networkErrors=[];
  page.on('requestfailed',r=>networkErrors.push(`${r.url()}: ${r.failure()?.errorText}`));
  await page.route('**/src/main.ts*',async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+'\nwindow.__ui={engine,character,controller,input,inventory,weapons,inventoryScreen,survivalLoot,health,enterGame,THREE};'});
  });
  await page.goto('http://127.0.0.1:5186/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__ui,null,{timeout:60000}).catch(e=>{throw Error(`${e.message}\n${JSON.stringify({errors,networkErrors})}`);});
  await page.evaluate(()=>{
    const q=window.__ui;q.enterGame();q.engine.stop();
    q.character.teleport(new q.THREE.Vector3(11,1.3,16));q.character.settleOnGround();q.controller.reset();
    for(let i=0;i<6;i++){q.engine.hooks.fixedUpdate(1/60);q.engine.hooks.update(1/60,1);}
    q.engine.renderer.render(q.engine.scene,q.engine.camera);
  });
  await page.keyboard.press('i');
  assert.equal(await page.locator('#inventory-screen').isVisible(),true);
  assert.equal(await page.locator('#pause-menu').isVisible(),false,'Unlocking mouse must not open pause menu');
  assert.equal(await page.locator('.inventory-cell').count(),4);
  assert.equal(await page.evaluate(()=>window.__ui.engine.running),false,'Inventory pauses simulation');
  await page.keyboard.down('w'); await page.keyboard.press('1');await page.keyboard.up('w');
  assert.equal(await page.evaluate(()=>window.__ui.input.isDown('KeyW')||window.__ui.input.wasPressed('Digit1')),false,'Input must be blocked');
  await page.getByRole('button',{name:'拾取背包',exact:true}).click();
  assert.equal(await page.locator('.inventory-cell').count(),12);
  assert.equal(await page.locator('.nearby-card').count(),0,'Picked item leaves vicinity');
  await page.screenshot({path:'scratchpad/inventory-empty.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#inventory-screen').isVisible(),false);
  assert.equal(await page.locator('#pause-menu').isVisible(),false,'Esc closes only the inventory');
  await page.evaluate(()=>{
    const q=window.__ui;q.engine.stop();
    q.inventory.collect('pistol');q.inventory.collect('mg');q.inventory.collect('pistolAmmo',48);
    q.inventory.collect('mgAmmo',60);q.inventory.collect('bandage',3);q.inventory.collect('grenade',2);
    q.health.damage(35);
    q.character.teleport(new q.THREE.Vector3(11,1.3,25));q.character.settleOnGround();q.controller.reset();
    for(let i=0;i<6;i++){q.engine.hooks.fixedUpdate(1/60);q.engine.hooks.update(1/60,1);}
    q.inventoryScreen.open();
  });
  await page.getByRole('button',{name:'拾取手枪',exact:true}).click();
  assert.match(await page.locator('.inventory-notice').textContent(),/已经拥有/);
  assert.equal(await page.locator('.nearby-card').count(),1,'Failed pickup preserves ground item');
  await page.locator('.inventory-cell[data-kind="bandage"]').first().click();
  await page.getByRole('button',{name:'使用绷带',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__ui.health.hp),90);
  assert.equal(await page.evaluate(()=>window.__ui.inventory.bandages),2);
  await page.locator('.inventory-cell[data-kind="mg"]').click();
  await page.getByRole('button',{name:'装备',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.__ui.weapons.current),'mg');
  await page.screenshot({path:'scratchpad/inventory-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.querySelector('#inventory-screen').scrollWidth<=innerWidth),true,'Mobile horizontal overflow');
  await page.screenshot({path:'scratchpad/inventory-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:900});
  await page.keyboard.press('i');
  await page.evaluate(()=>{
    const q=window.__ui;q.engine.stop();
    q.character.teleport(new q.THREE.Vector3(16,1.3,16));q.character.settleOnGround();q.controller.reset();
    for(let i=0;i<6;i++){q.engine.hooks.fixedUpdate(1/60);q.engine.hooks.update(1/60,1);}
    q.engine.renderer.render(q.engine.scene,q.engine.camera);
  });
  await page.screenshot({path:'scratchpad/minimap-redesign.png'});
  assert.equal(await page.locator('#district-minimap').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pause-menu').isVisible(),true);
  await page.keyboard.press('i');
  assert.equal(await page.locator('#inventory-screen').isVisible(),false,'Cannot open inventory through pause');
  await page.locator('#pause-home').click();
  assert.equal(await page.locator('#district-minimap').isVisible(),false);
  await page.goto('http://127.0.0.1:5186/inventory-preview.html');
  await page.waitForSelector('#inventory-screen:not([hidden])');
  assert.equal(await page.locator('.inventory-cell').count(),12);
  assert.equal(await page.locator('.nearby-card').count(),5);
  await page.locator('.inventory-cell[data-kind="mg"]').click();
  await page.screenshot({path:'scratchpad/inventory-sample.png'});
  await page.getByRole('button',{name:'拾取绷带',exact:true}).click();
  assert.equal(await page.locator('.nearby-card').count(),4);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'重新打开样本',exact:true}).click();
  assert.equal(await page.locator('#inventory-screen').isVisible(),true);
  assert.deepEqual(errors,[]);
  fs.writeFileSync('scratchpad/inventory-ui-result.json',JSON.stringify({passed:true,errors,checks:['I open/close','Esc closes inventory only','mouse unlock does not pause twice','simulation and input frozen','vicinity pickup','capacity grid','duplicate atomicity','bandage mouse use','equip mouse action','390px responsive','minimap visibility','pause/home interaction']},null,2));
  console.log('PASS: inventory mouse/keyboard, actual item actions, pause/input, responsive layout, minimap, no page errors');
} finally { await context.close(); }
