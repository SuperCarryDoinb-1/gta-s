import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
process.env.TEMP=process.env.TMP=path.resolve('scratchpad/storage-rules-tmp');fs.mkdirSync(process.env.TEMP,{recursive:true});
const context=await chromium.launchPersistentContext(path.resolve(`scratchpad/storage-rules-profile-${Date.now()}`),{
  executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
});
try{
 const page=context.pages()[0];await page.goto('http://127.0.0.1:5186/inventory-preview.html');
 const result=await page.evaluate(async()=>{
  const {SurvivalInventory}=await import('/src/gameplay/SurvivalInventory.ts');
  const {SurvivalSession}=await import('/src/gameplay/SurvivalSession.ts');
  const check=(p,m)=>{if(!p)throw Error(m);};
  const inventory=new SurvivalInventory(),loot={consumedIds:()=>[],setWorldLoot:()=>{},restoreConsumed:()=>{}},health={hp:100,money:0},enemies={defeatedIds:()=>[],restoreDefeated:()=>{}};
  const session=new SurvivalSession(inventory,loot,health,enemies);session.start();
  session.stash.push({kind:'armor',count:1,durability:37.5},{kind:'pistol',count:1});
  inventory.collect('pistolAmmo',96);const before=JSON.stringify(session.stash);
  check(session.withdraw(0).includes('空间不足')&&JSON.stringify(session.stash)===before&&!inventory.hasArmor,'Full bag must preserve warehouse armor');
  inventory.clear();inventory.collect('pistol');
  check(session.withdraw(1).includes('已经拥有')&&JSON.stringify(session.stash)===before,'Duplicate ownership must preserve warehouse weapon');
  inventory.clear();session.withdraw(0);check(inventory.armorDurability===37.5,'Taking armor must retain its exact durability');
  inventory.wear('armor');session.depositAll();check(session.stash.find(p=>p.kind==='armor').durability===37.5&&inventory.items().length===0,'Worn armor deposit must retain durability');
  const loadedInventory=new SurvivalInventory(),loaded=new SurvivalSession(loadedInventory,loot,health,enemies);
  check(loaded.loaded&&loaded.stash.length===2&&loaded.stash.find(p=>p.kind==='armor').durability===37.5,'Persist transaction as one complete snapshot');
  const stable=JSON.stringify(loaded.stash);loaded.withdraw(-1);loaded.withdraw(999);check(JSON.stringify(loaded.stash)===stable,'Invalid requests cannot remove items');
  return {fullBagAtomic:true,duplicateAtomic:true,durability:37.5,reloaded:true,invalidIndexAtomic:true};
 });
 assert.equal(result.reloaded,true);fs.writeFileSync('scratchpad/storage-rules-result.json',JSON.stringify(result,null,2));console.log('PASS',JSON.stringify(result));
}finally{await context.close();}
