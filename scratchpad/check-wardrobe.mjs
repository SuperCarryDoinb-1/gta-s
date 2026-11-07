import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
process.env.TEMP = process.env.TMP = path.resolve('scratchpad/wardrobe-review/tmp');
fs.mkdirSync(process.env.TEMP, { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve('scratchpad/wardrobe-review/profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  viewport: { width: 1440, height: 1000 },
});
const errors = [], gpuErrors = [];
try {
  const page = context.pages()[0];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error' && /WebGL|shader|feedback/i.test(m.text())) gpuErrors.push(m.text()); });
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nwindow.__wardrobe={engine,character,controller,input,inventory,inventoryScreen,survivalLoot,health,appearance,wanted,weapons,THREE};' });
  });
  await page.goto('http://127.0.0.1:5186/');
  await page.waitForFunction(() => window.__wardrobe, null, { timeout: 90000 }).catch(async e => {
    await page.screenshot({ path: 'scratchpad/wardrobe-review/load-failure.png' });
    throw Error(e.message + ' ' + JSON.stringify(errors));
  });
  if (await page.locator('#motion-btn').getAttribute('aria-pressed') === 'true') await page.locator('#motion-btn').click();
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => document.getElementById('menu').style.display === 'none');
  const initial = await page.evaluate(() => {
    const q = window.__wardrobe;
    return { slots: q.inventory.usedSlots, outfit: q.inventory.outfit, bag: q.character.mesh.getObjectByName('Backpack').visible, vest: q.character.mesh.getObjectByName('Equipped-Armor').visible };
  });
  assert.deepEqual(initial, { slots: 0, outfit: 'base', bag: false, vest: false });
  const pickup = async (x, z, kind) => {
    await page.evaluate(({ x, z }) => {
      const q = window.__wardrobe; q.engine.stop();
      q.character.teleport(new q.THREE.Vector3(x, 1.3, z)); q.character.settleOnGround(); q.controller.reset();
      for (let i = 0; i < 8; i++) q.engine.prepareStep(1 / 60); q.engine.warmup();
    }, { x, z });
    await page.keyboard.press('i');
    await page.locator(`[data-pickup][aria-label="拾取${kind}"]`).click();
  };
  await pickup(11, 5, '海蓝夹克套装');
  await page.locator('.inventory-grid [data-kind="jacket"]').click();
  await page.locator('[data-wear="jacket"]').click();
  assert.equal(await page.evaluate(() => window.__wardrobe.inventory.outfit), 'jacket');
  assert.equal(await page.evaluate(() => window.__wardrobe.inventory.usedSlots), 0);
  assert.equal(await page.locator('.character-portrait').count(), 1);
  await page.screenshot({ path: 'scratchpad/wardrobe-review/blue-jacket.png', fullPage: true });
  await page.keyboard.press('i');
  await pickup(39, -24, '轻型防弹背心');
  await page.locator('.inventory-grid [data-kind="armor"]').click();
  await page.locator('[data-wear="armor"]').click();
  assert.equal(await page.evaluate(() => window.__wardrobe.inventory.armorEquipped), true);
  const protectedHit = await page.evaluate(() => {
    const q = window.__wardrobe; q.health.hp = 100;
    q.wanted.onPlayerHit(40);
    const vest = q.character.mesh.getObjectByName('Equipped-Armor');
    q.character.mesh.updateMatrixWorld(true);
    const bounds = new q.THREE.Box3().setFromObject(vest);
    return { hp: q.health.hp, durability: q.inventory.armorDurability, visible: vest.visible,
      size: bounds.getSize(new q.THREE.Vector3()).toArray(), center: bounds.getCenter(new q.THREE.Vector3()).toArray(), body: q.character.body.translation() };
  });
  assert.equal(protectedHit.hp, 84); assert.equal(protectedHit.durability, 76); assert.equal(protectedHit.visible, true);
  assert.ok(Math.max(...protectedHit.size) < 1, 'Armor attachment scale');
  assert.ok(Math.abs(protectedHit.center[1] - protectedHit.body.y - .3) < .15, 'Armor follows torso');
  // Reopen to reflect damage in the paused inventory.
  await page.keyboard.press('i'); await page.keyboard.press('i');
  await page.screenshot({ path: 'scratchpad/wardrobe-review/armor-equipped.png', fullPage: true });
  await page.keyboard.press('i');
  await pickup(11, 74, '橙色工装套装');
  await page.locator('.inventory-grid [data-kind="workwear"]').click(); await page.locator('[data-wear="workwear"]').click();
  assert.equal(await page.evaluate(() => window.__wardrobe.inventory.outfit), 'workwear');
  assert.equal(await page.locator('.inventory-grid [data-kind="jacket"]').count(), 1);
  await page.screenshot({ path: 'scratchpad/wardrobe-review/orange-workwear.png', fullPage: true });
  await page.keyboard.press('i');
  const equippedMotion = await page.evaluate(() => {
    const q = window.__wardrobe; q.engine.stop();
    const step = () => q.engine.prepareStep(1 / 60);
    q.input.debugHold('Space', true); step(); q.input.debugHold('Space', false);
    for (let i = 0; i < 20; i++) step();
    const roll = q.character.currentClip, jumpY = q.character.body.translation().y;
    q.character.teleport(new q.THREE.Vector3(78, .28, 36)); q.controller.reset();
    for (let i = 0; i < 20; i++) step();
    q.input.debugHold('ControlLeft', true); for (let i = 0; i < 90; i++) step(); q.input.debugHold('ControlLeft', false);
    q.engine.warmup();
    const vest = q.character.mesh.getObjectByName('Equipped-Armor'); q.character.mesh.updateMatrixWorld(true);
    const box = new q.THREE.Box3().setFromObject(vest);
    return { roll, jumpY, depth: q.character.body.translation().y, camera: q.engine.camera.position.y,
      armorSize: box.getSize(new q.THREE.Vector3()).toArray(), armorVisible: vest.visible, outfit: q.inventory.outfit };
  });
  assert.equal(equippedMotion.roll, 'Jump_Roll'); assert.ok(equippedMotion.jumpY > 2);
  assert.ok(equippedMotion.depth < -2 && equippedMotion.camera < -1);
  assert.ok(Math.max(...equippedMotion.armorSize) < 1 && equippedMotion.armorVisible);
  await page.screenshot({ path: 'scratchpad/wardrobe-review/equipped-underwater.png' });
  await page.evaluate(() => {
    const q = window.__wardrobe; q.character.teleport(new q.THREE.Vector3(11, 1.3, 74)); q.character.settleOnGround(); q.controller.reset();
    for (let i = 0; i < 40; i++) q.engine.prepareStep(1 / 60);
    q.inventoryScreen.open();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'scratchpad/wardrobe-review/mobile.png', fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const rules = await page.evaluate(async () => {
    const { SurvivalInventory } = await import('/src/gameplay/SurvivalInventory.ts');
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const full = new SurvivalInventory(); full.collect('jacket'); full.wear('jacket'); full.collect('pistolAmmo', 96);
    check(full.usedSlots === 4 && full.collect('workwear') !== null, 'Full bag pickup must fail');
    check(full.wear('base').includes('背包已满') && full.outfit === 'jacket', 'Full bag cannot remove clothing');
    const inv = new SurvivalInventory(); inv.collect('armor'); inv.wear('armor');
    check(inv.absorbDamage(40, 'bullet') === 16 && inv.armorDurability === 76, 'Bullet protection');
    check(inv.absorbDamage(20, 'blast') === 13 && inv.armorDurability === 69, 'Blast protection');
    check(inv.absorbDamage(20, 'impact') === 20 && inv.armorDurability === 69, 'Falls bypass armor');
    inv.wear('armor'); inv.wear('armor'); check(inv.armorDurability === 69, 'Re-equipping must not repair');
    inv.absorbDamage(200, 'bullet'); check(inv.armorDurability === 0 && inv.absorbDamage(20, 'bullet') === 20, 'Broken armor');
    check(inv.collect('armor') === null && inv.armorDurability === 100 && inv.usedSlots === 0, 'Replace broken vest');
    const q = window.__wardrobe; q.inventory.wear('armor'); q.health.hp = 100; q.wanted.onPlayerHit(40);
    check(q.health.hp === 60 && q.inventory.armorDurability === 76, 'Removed armor must not protect');
    q.inventory.wear('armor'); q.health.damage(200); const durability = q.inventory.armorDurability; q.health.damage(10, 'bullet');
    check(q.inventory.armorDurability === durability, 'Dead player cannot consume armor');
    q.health.update(3); q.health.damage(10, 'bullet');
    check(q.inventory.armorDurability === durability, 'Respawn invulnerability cannot consume armor');
    return { fullBag: true, bullet: true, blast: true, fallBypass: true, durability: true, invulnerability: true };
  });
  assert.deepEqual(errors, []); assert.deepEqual(gpuErrors, []);
  fs.writeFileSync('scratchpad/wardrobe-review/result.json', JSON.stringify({ passed: true, initial, protectedHit, equippedMotion, rules, errors, gpuErrors }, null, 2));
  console.log('PASS', JSON.stringify({ protectedHit, rules }));
} finally { await context.close(); }
