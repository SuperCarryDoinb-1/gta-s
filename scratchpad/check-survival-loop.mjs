import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
const directory = path.resolve('scratchpad/survival-loop-review');
process.env.TEMP = process.env.TMP = path.join(directory, 'tmp'); fs.mkdirSync(process.env.TEMP, { recursive: true });
const context = await chromium.launchPersistentContext(path.join(directory, `profile-${Date.now()}`), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, viewport: { width: 1440, height: 950 },
});
const errors = [], gpuErrors = [];
try {
  const page = context.pages()[0];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error' && /WebGL|shader|feedback/i.test(m.text())) gpuErrors.push(m.text()); });
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__loop={engine,input,physics,character,controller,inventory,inventoryScreen,survivalLoot,session,shelterScreen,survivalSites,hostiles,health,weapons,wanted,THREE};' });
  });
  const ready = async () => {
    await page.waitForFunction(() => window.__loop, null, { timeout: 90000 }).catch(e => { throw Error(e.message + JSON.stringify(errors)); });
    if (await page.locator('#motion-btn').getAttribute('aria-pressed') === 'true') await page.locator('#motion-btn').click();
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.getElementById('menu').style.display === 'none');
    await page.evaluate(() => window.__loop.engine.stop());
  };
  const move = async (x, z) => page.evaluate(({ x, z }) => {
    const q = window.__loop; q.engine.stop(); q.character.teleport(new q.THREE.Vector3(x, 2, z)); q.character.settleOnGround(); q.controller.reset();
    for (let i = 0; i < 8; i++) q.engine.prepareStep(1 / 60); q.engine.warmup();
  }, { x, z });
  const pickup = async (x, z, kind) => {
    await move(x, z); await page.keyboard.press('i'); await page.locator(`[data-pickup][aria-label="拾取${kind}"]`).click(); await page.keyboard.press('i');
  };
  await page.goto('http://127.0.0.1:5186/'); await ready();
  assert.equal(await page.evaluate(() => window.__loop.inventory.usedSlots), 0);
  await pickup(11, 16, '背包'); await pickup(11, 25, '手枪'); await pickup(11, 32, '手枪弹药');
  await pickup(11, 5, '海蓝夹克套装'); await pickup(39, -24, '轻型防弹背心');
  await page.evaluate(() => { const q = window.__loop; q.inventory.wear('armor'); q.wanted.onPlayerHit(40); });
  assert.equal(await page.evaluate(() => window.__loop.inventory.armorDurability), 76);
  // Walk through the actual doorway into the shelter.
  await move(34, 88);
  const entrance = await page.evaluate(() => {
    const q = window.__loop; q.engine.stop();
    for (let i = 0; i < 82; i++) { q.character.beginStep(); q.character.moveBy(new q.THREE.Vector3(.08, -.04, 0)); q.physics.step(1 / 60); q.character.endStep(); }
    q.character.syncVisual(1); q.engine.warmup(); return { ...q.character.body.translation() };
  });
  assert.ok(entrance.x > 39 && entrance.x < 41.5, JSON.stringify(entrance));
  await page.keyboard.press('f'); assert.equal(await page.locator('#shelter-screen').isVisible(), true);
  assert.equal(await page.evaluate(() => window.__loop.engine.running), false);
  await page.keyboard.press('i'); assert.equal(await page.locator('#inventory-screen').isVisible(), false);
  await page.locator('[data-deposit]').click();
  assert.equal(await page.evaluate(() => window.__loop.inventory.items().length), 0);
  const banked = await page.evaluate(() => window.__loop.session.stash);
  assert.equal(banked.find(p => p.kind === 'armor').durability, 76);
  await page.screenshot({ path: path.join(directory, 'warehouse.png'), fullPage: true });
  for (const kind of ['背包','手枪','手枪弹药','轻型防弹背心']) await page.getByRole('button', { name: `取出${kind}`, exact: true }).click();
  assert.equal(await page.evaluate(() => window.__loop.inventory.armorDurability), 76);
  await page.locator('[data-save]').click(); await page.keyboard.press('Escape');
  assert.equal(await page.locator('#pause-menu').isVisible(), false);
  await move(30, 40);
  const death = await page.evaluate(() => {
    const q = window.__loop; q.inventory.wear('armor'); q.health.damage(1000);
    const now = { dead: q.health.dead, items: q.inventory.items(), dropped: q.session.worldLoot.map(p => ({ ...p })), stash: q.session.stash.map(p => ({ ...p })), saved: JSON.parse(localStorage.getItem('shanghai-survival-v1')) };
    for (let i = 0; i < 180; i++) q.engine.prepareStep(1 / 60);
    return { ...now, respawn: { ...q.character.body.translation() } };
  });
  assert.equal(death.dead, true); assert.equal(death.items.length, 0); assert.equal(death.dropped.length, 4);
  assert.deepEqual(death.stash.map(p => p.kind), ['jacket']);
  assert.equal(death.dropped.find(p => p.kind === 'armor').durability, 76);
  assert.ok(Math.abs(death.respawn.x - 40) < 1 && Math.abs(death.respawn.z - 88) < 1);
  assert.equal(death.saved.inventory.weapons.length, 0);
  console.log('DEATH/STORAGE PASS', JSON.stringify({ drops: death.dropped.length, respawn: death.respawn }));
  await page.reload(); await ready();
  const loaded = await page.evaluate(() => ({ loaded: window.__loop.session.loaded, drops: window.__loop.session.worldLoot.length, stash: window.__loop.session.stash, inventory: window.__loop.inventory.items() }));
  assert.equal(loaded.loaded, true); assert.equal(loaded.drops, 4); assert.equal(loaded.stash.length, 1); assert.equal(loaded.inventory.length, 0);
  assert.equal(await page.evaluate(() => window.__loop.session.recoveryTarget(new window.__loop.THREE.Vector3())), '取回遗落物资');
  await move(11, 16); assert.ok(!(await page.evaluate(() => window.__loop.survivalLoot.nearbyItems())).some(p => p.kind === 'backpack'));
  await move(30, 40); await page.keyboard.press('i');
  for (const kind of ['背包','手枪','手枪弹药','轻型防弹背心']) await page.getByRole('button', { name: `拾取${kind}`, exact: true }).click();
  assert.equal(await page.evaluate(() => window.__loop.session.worldLoot.length), 0);
  assert.equal(await page.evaluate(() => window.__loop.inventory.armorDurability), 76);
  await page.keyboard.press('i');
  console.log('RELOAD/RECOVERY PASS');
  // Real patrols acquire and shoot a visible player, then a solid wall blocks all their shots.
  await move(161, -57);
  const engagement = await page.evaluate(() => {
    const q = window.__loop; q.engine.stop(); q.inventory.wear('armor'); q.health.hp = 100;
    for (let i = 0; i < 360; i++) q.engine.prepareStep(1 / 60);
    q.engine.warmup();
    return { hp: q.health.hp, durability: q.inventory.armorDurability, alerted: q.hostiles.guards.filter(g => g.alerted).length,
      shots: q.hostiles.guards.reduce((n, g) => n + g.shots, 0) };
  });
  assert.ok(engagement.hp < 100 && engagement.hp > 0 && engagement.alerted > 0 && engagement.shots > 0, JSON.stringify(engagement));
  await page.screenshot({ path: path.join(directory, 'hostile-camp.png') });
  const cover = await page.evaluate(async () => {
    const q = window.__loop, { RAPIER } = await import('/src/core/Physics.ts');
    const wall = q.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.2, 2, 16).setTranslation(166, 2, -57)); q.physics.step(1 / 60);
    q.health.hp = 100; const shotsBefore = q.hostiles.guards.reduce((n, g) => n + g.shots, 0);
    for (let i = 0; i < 300; i++) q.engine.prepareStep(1 / 60);
    const result = { hp: q.health.hp, shotsBefore, shotsAfter: q.hostiles.guards.reduce((n, g) => n + g.shots, 0), minGuardX: Math.min(...q.hostiles.guards.map(g => g.body.translation().x)) };
    q.physics.world.removeCollider(wall, false); q.physics.step(1 / 60); return result;
  });
  assert.equal(cover.hp, 100); assert.equal(cover.shotsAfter, cover.shotsBefore); assert.ok(cover.minGuardX > 166.4);
  const combat = await page.evaluate(async () => {
    const { RAPIER } = await import('/src/core/Physics.ts');
    const q = window.__loop; q.engine.stop(); q.weapons.current = 'pistol'; q.input.locked = true;
    const ammoBefore = q.inventory.ammo.pistol;
    for (const guard of q.hostiles.guards) {
      const p = guard.body.translation();
      let candidate;
      for (const [dx,dz] of [[0,-1],[0,1],[-1,0],[1,0]]) {
        const origin = { x:p.x+dx*5, y:p.y+.25, z:p.z+dz*5 };
        const direction = new q.THREE.Vector3(p.x-origin.x,-.1,p.z-origin.z).normalize();
        const hit = q.physics.world.castRay(new RAPIER.Ray(origin,direction),6,true,undefined,undefined,q.character.collider);
        if(hit?.collider.parent()?.handle===guard.body.handle){candidate=origin;break;}
      }
      if(!candidate)throw Error('No clear shot at '+guard.id+' '+JSON.stringify(p));
      q.character.teleport(new q.THREE.Vector3(candidate.x, 2, candidate.z)); q.character.settleOnGround();
      q.physics.step(1 / 60);
      for (let i = 0; i < 2; i++) {
        const target=guard.body.translation();
        q.engine.camera.position.set(candidate.x, candidate.y, candidate.z); q.engine.camera.lookAt(target.x, target.y + .15, target.z);
        q.input.debugHold('Mouse0', true); q.weapons.update(1 / 60, false); q.input.endFrame(); q.input.debugHold('Mouse0', false);
      }
    }
    const defeated = q.hostiles.defeatedIds(); const count = q.session.worldLoot.length;
    q.hostiles.explosion(177, 1, -57); // Already defeated guards cannot duplicate rewards.
    q.input.locked = false; q.session.save(true);
    return { defeated, usedAmmo: ammoBefore - q.inventory.ammo.pistol, rewardCount: count, afterRepeat: q.session.worldLoot.length, stars: q.wanted.stars };
  });
  assert.equal(combat.defeated.length, 3, JSON.stringify(combat)); assert.equal(combat.usedAmmo, 6);
  assert.equal(combat.rewardCount, 9); assert.equal(combat.afterRepeat, 9); assert.equal(combat.stars, 0);
  console.log('COMBAT/COVER PASS', JSON.stringify({ engagement, cover, combat }));
  await move(184, -56); await page.keyboard.press('i');
  await page.getByRole('button', { name: '拾取机枪', exact: true }).click();
  await page.getByRole('button', { name: '拾取机枪弹药', exact: true }).click();
  await page.keyboard.press('i'); await move(40, 88); await page.keyboard.press('f'); await page.locator('[data-deposit]').click();
  await page.screenshot({ path: path.join(directory, 'returned-supplies.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(directory, 'warehouse-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape'); await page.reload(); await ready();
  const final = await page.evaluate(() => ({ loaded: window.__loop.session.loaded, defeated: window.__loop.hostiles.defeatedIds(), stash: window.__loop.session.stash, drops: window.__loop.session.worldLoot.length, inventory: window.__loop.inventory.items() }));
  assert.equal(final.loaded, true); assert.equal(final.defeated.length, 3); assert.ok(final.stash.some(p => p.kind === 'mg')); assert.equal(final.inventory.length, 0); assert.equal(final.drops, 7);
  const storageFailure = await page.evaluate(() => {
    const q = window.__loop, original = Storage.prototype.setItem, before = JSON.stringify(q.session.stash);
    Storage.prototype.setItem = () => { throw Error('quota'); };
    const status = q.session.save(true); Storage.prototype.setItem = original;
    return { status, intact: before === JSON.stringify(q.session.stash) };
  });
  assert.match(storageFailure.status, /保存失败/); assert.equal(storageFailure.intact, true);
  const latestSave = await page.evaluate(() => localStorage.getItem('shanghai-survival-v1'));
  await page.evaluate(() => {
    window.__loop.session.active = false;
    localStorage.setItem('shanghai-survival-v1', '{invalid-save');
  });
  await page.reload(); await ready();
  const invalidSave = await page.evaluate(() => {
    const q = window.__loop; for (let i=0;i<180;i++)q.engine.prepareStep(1/60);
    const before=JSON.stringify(q.inventory.snapshot()), bad=q.inventory.snapshot(); bad.ammo.pistol=999;
    const accepted=q.inventory.restore(bad);
    return { loaded:q.session.loaded, status:q.session.status, preserved:localStorage.getItem('shanghai-survival-v1')==='{invalid-save', rejected:!accepted&&before===JSON.stringify(q.inventory.snapshot()) };
  });
  assert.equal(invalidSave.loaded, false); assert.equal(invalidSave.preserved, true); assert.equal(invalidSave.rejected, true);
  await page.evaluate(raw => { window.__loop.session.active=false;localStorage.setItem('shanghai-survival-v1',raw); }, latestSave);
  assert.deepEqual(errors, []); assert.deepEqual(gpuErrors, []);
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: true, entrance, banked, death, loaded, engagement, cover, combat, final, storageFailure, invalidSave, errors, gpuErrors }, null, 2));
  console.log('PASS: exploration, storage, reload, death recovery, physical AI combat, cover, rewards, responsive warehouse, storage failure');
} finally { await context.close(); }
