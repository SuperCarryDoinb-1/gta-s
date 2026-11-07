import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';

process.env.TEMP = process.env.TMP = path.resolve('scratchpad/survival-browser-tmp');
fs.mkdirSync(process.env.TEMP, { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve('scratchpad/survival-browser-profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, viewport: { width: 1365, height: 850 },
});
const errors = [];
try {
  const page = context.pages()[0];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) +
      '\nwindow.__survival={engine,character,controller,input,playerManager,vehicle,weapons,inventory,inventoryScreen,survivalLoot,health,shops,enterGame,THREE};' });
  });
  await page.goto('http://127.0.0.1:5186/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__survival, null, { timeout: 90000 });
  const result = await page.evaluate(async () => {
    const q = window.__survival;
    q.enterGame();
    q.engine.stop();
    const { input, character, inventory, weapons, survivalLoot, health, THREE } = q;
    const { SurvivalInventory } = await import('/src/gameplay/SurvivalInventory.ts');
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const step = () => { q.engine.hooks.fixedUpdate(1 / 60); q.engine.hooks.update(1 / 60, 1); };
    const press = code => { input.debugHold(code, true); step(); input.debugHold(code, false); };
    const move = (x, z) => {
      character.teleport(new THREE.Vector3(x, 1.3, z));
      character.settleOnGround(); q.controller.reset();
      for (let i = 0; i < 5; i++) step();
    };
    check(health.money === 0 && inventory.usedSlots === 0 && weapons.current === 'none', 'Empty start');
    for (const key of ['Digit1', 'Digit2', 'Digit3']) { press(key); check(weapons.current === 'none', 'Unowned weapon selected'); }
    const pure = new SurvivalInventory();
    check(pure.collect('pistol') === null && pure.collect('pistolAmmo', 72) === null, 'Fill four slots');
    check(pure.usedSlots === 4 && pure.collect('bandage') !== null && pure.bandages === 0, 'Capacity atomicity');
    check(pure.collect('backpack') === null && pure.capacity === 12, 'Backpack upgrade');
    check(pure.collect('pistol') !== null && pure.usedSlots === 4, 'Duplicate ownership');
    const route = [[11,16,'backpack'], [11,25,'pistol'], [11,32,'pistolAmmo'], [11,40,'bandage'], [11,48,'mg'], [11,56,'mgAmmo'], [11,64,'grenade']];
    const pickups = [];
    for (const [x,z,kind] of route) {
      move(x,z);
      check(survivalLoot.hint.includes('G'), 'Missing reachable pickup: ' + kind + ' ' + survivalLoot.hint);
      press('KeyG');
      pickups.push({ kind, used: inventory.usedSlots, position: { ...character.body.translation() } });
    }
    check(inventory.capacity === 12 && inventory.has('pistol') && inventory.has('mg'), 'Ownership after search');
    check(inventory.ammo.pistol === 24 && inventory.ammo.mg === 60 && inventory.ammo.grenade === 2, 'Ammo collection');
    check(inventory.bandages === 3, 'Bandage collection');
    press('KeyB'); check(inventory.bandages === 3, 'Full HP consumed bandage');
    health.damage(50); press('KeyB');
    check(health.hp === 75 && inventory.bandages === 2, 'Bandage recovery');
    press('Digit1'); check(weapons.current === 'pistol', 'Cannot equip found pistol');
    input.locked = true;
    press('Mouse0');
    check(inventory.ammo.pistol === 23, 'Shot did not consume inventory ammo');
    input.locked = false;
    press('Digit1'); check(weapons.current === 'none', 'Cannot holster');
    move(11,16); check(!survivalLoot.hint.includes('背包'), 'Collected point respawned');
    move(310,16); move(11,16); check(!survivalLoot.hint.includes('背包'), 'Collected point respawned after streaming');
    // Test commerce against the same inventory: full capacity must not charge cash.
    health.money = 500;
    const beforeAmmo = inventory.ammo.mg;
    q.shops.buyAmmo('mg',150,120);
    check(health.money === 350 && inventory.ammo.mg === beforeAmmo + 120, 'Successful purchase');
    while (inventory.collect('bandage', 3) === null) { /* fill all remaining slots */ }
    check(inventory.usedSlots === inventory.capacity, 'Did not fill actual inventory');
    q.shops.buyAmmo('mg',150,120);
    check(health.money === 350 && inventory.ammo.mg === beforeAmmo + 120, 'Failed purchase charged cash');
    // Vehicle entry, pickup blocking, movement and exit still use the existing manager.
    q.vehicle.setStashed(false); q.vehicle.teleportTo(16, 18.5, 0);
    move(16,16); press('KeyE');
    for (let i = 0; i < 150; i++) step();
    check(q.playerManager.isDriving, 'Vehicle entry regression');
    const drivingSlots = inventory.usedSlots;
    press('KeyG'); check(inventory.usedSlots === drivingSlots && survivalLoot.hint === '', 'Pickup while driving');
    const start = new THREE.Vector3(); q.vehicle.getPosition(start);
    input.debugHold('KeyW',true);
    for (let i = 0; i < 180; i++) step();
    input.debugHold('KeyW',false);
    const finish = new THREE.Vector3(); q.vehicle.getPosition(finish);
    check(Number.isFinite(finish.x + finish.y + finish.z) && finish.distanceTo(start) > 3, 'Driving regression');
    q.playerManager.forceExit();
    q.inventoryScreen.open();
    check(!document.querySelector('#inventory-screen').hidden, 'Inventory UI');
    check(document.querySelectorAll('.inventory-cell').length === inventory.capacity, 'Inventory capacity grid');
    q.inventoryScreen.close(); q.engine.stop();
    move(16,16);
    q.engine.renderer.render(q.engine.scene,q.engine.camera);
    return { pickups, slots: inventory.usedSlots, capacity: inventory.capacity, hp: health.hp, ammo: inventory.ammo, checks: 'empty start, ownership, reachable pickups, capacity, bandages, shooting, streaming, commerce, vehicle entry/driving, pickup blocking, UI' };
  });
  await page.screenshot({ path: 'scratchpad/survival-step1.png' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#pause-menu').open);
  assert.equal(await page.locator('#survival-inventory').isVisible(), false, 'Inventory must hide during pause');
  await page.locator('#pause-home').click();
  assert.equal(await page.locator('#survival-inventory').isVisible(), false, 'Inventory must hide on home');
  assert.deepEqual(errors, [], 'Browser errors');
  fs.writeFileSync('scratchpad/survival-step1-result.json', JSON.stringify({ result, errors }, null, 2));
  console.log('PASS', JSON.stringify(result));
} finally {
  await context.close();
}
