import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
const dir=path.resolve('scratchpad/polish-review');process.env.TEMP=process.env.TMP=path.join(dir,'tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const origin='http://127.0.0.1:5187';
const context=await chromium.launchPersistentContext(path.join(dir,`profile-built-${Date.now()}`),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,viewport:{width:1280,height:800}});
const errors=[],gpuErrors=[],httpErrors=[];
try {
 const page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/WebGL|shader|feedback loop/i.test(m.text()))gpuErrors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)httpErrors.push({url:r.url(),status:r.status()});});
 const started=Date.now();await page.goto(origin);await page.waitForFunction(()=>!document.getElementById('start-btn').disabled,null,{timeout:90000});
 const bootMs=Date.now()-started;
 if(await page.locator('#motion-btn').getAttribute('aria-pressed')==='true')await page.locator('#motion-btn').click();
 await page.locator('#start-btn').click();await page.waitForFunction(()=>document.getElementById('menu').style.display==='none');
 await page.keyboard.down('w');await page.waitForTimeout(550);await page.keyboard.up('w');await page.keyboard.press('Space');await page.waitForTimeout(350);
 await page.screenshot({path:path.join(dir,'production-playing.png')});
 await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#pause-menu').open);await page.locator('#pause-resume').click();
 await page.keyboard.press('i');assert.equal(await page.locator('#inventory-screen').isVisible(),true);await page.keyboard.press('Escape');
 assert.deepEqual(errors,[]);assert.deepEqual(gpuErrors,[]);assert.deepEqual(httpErrors,[]);
 const checks=[];
 for(const [url,method,status]of[['/','HEAD',200],['/models/cars/taxi.glb','HEAD',200],['/draco/draco_decoder.wasm','HEAD',200],['/src/main.ts','GET',404],['/%2e%2e%2fpackage.json','GET',403],['/%xx','GET',400],['/','POST',405]]){
  const response=await fetch(origin+url,{method});checks.push({url,method,status:response.status,type:response.headers.get('content-type')});assert.equal(response.status,status,url);
 }
 fs.writeFileSync(path.join(dir,'production.json'),JSON.stringify({bootMs,checks,errors,gpuErrors,httpErrors},null,2));console.log('PASS',JSON.stringify({bootMs,checks}));
}finally{await context.close();}
