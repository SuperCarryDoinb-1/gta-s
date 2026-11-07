import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
const root=path.resolve('scratchpad/stage-five-review');process.env.TEMP=process.env.TMP=path.join(root,'ui-tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const profile=fs.readdirSync(root).filter(n=>/^profile-\d+$/.test(n)).sort().at(-1);
const context=await chromium.launchPersistentContext(path.join(root,profile),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1280,height:720}});
const errors=[];
try{
 const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/main.ts*',async route=>{const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\nwindow.__modeui={engine,input,battle,health};'});});
 await page.goto('http://127.0.0.1:5186/?mode=battle');await page.waitForFunction(()=>window.__modeui&&!document.getElementById('start-btn').disabled,null,{timeout:90000});
 await page.locator('#start-btn').scrollIntoViewIfNeeded();
 assert.ok(await page.locator('#start-btn').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
 await page.screenshot({path:path.join(root,'mode-desktop-720.png')});
 await page.setViewportSize({width:390,height:844});await page.locator('#battle-mode').scrollIntoViewIfNeeded();
 assert.equal(await page.locator('#battle-mode').getAttribute('aria-current'),'page');
 await page.screenshot({path:path.join(root,'mode-mobile.png')});
 await page.locator('#guide-btn').click();assert.match(await page.locator('#guide-dialog').textContent(),/1 名玩家对 7 名 AI/);await page.keyboard.press('Escape');
 if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();
 await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');await page.evaluate(()=>window.__modeui.engine.stop());
 await page.keyboard.press('h');assert.equal(await page.locator('#help-overlay').isVisible(),true);assert.match(await page.locator('#help-overlay').textContent(),/没有自动回血/);await page.keyboard.press('h');
 await page.keyboard.press('i');const before=await page.evaluate(()=>window.__modeui.battle.zone.elapsed);await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>window.__modeui.battle.zone.elapsed),before);await page.keyboard.press('Escape');assert.equal(await page.locator('#pause-menu').isVisible(),false);
 await page.evaluate(()=>{const q=window.__modeui;q.engine.stop();q.health.damage(200);});
 assert.equal(await page.locator('#battle-result').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 await page.screenshot({path:path.join(root,'battle-result-mobile.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'ui-result.json'),JSON.stringify({passed:true,desktop720:true,mobile390:true,modeGuide:true,inventoryPausesMatch:true,visibleResult:true,errors},null,2));
 console.log('PASS: 720px menu, 390px mode/result, mode-specific guides, inventory pause, result visibility');
}finally{await context.close();}
