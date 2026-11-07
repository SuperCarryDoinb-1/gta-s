import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const root = fs.realpathSync('.'), scratch = fs.realpathSync('scratchpad');
if (!scratch.startsWith(root + path.sep)) throw Error('Scratch directory is outside workspace');
const temp = path.join(scratch, 'scene-browser-temp'); fs.mkdirSync(temp, { recursive: true });
process.env.TEMP = process.env.TMP = temp;
const context = await chromium.launchPersistentContext(path.join(scratch, 'scene-browser-profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  viewport: { width: 1280, height: 800 }, args: ['--autoplay-policy=no-user-gesture-required'],
});
const result = { errors: [], checks: [] };
try {
  const page = context.pages()[0];
  page.on('pageerror', e => { result.errors.push(e.message); console.log('ERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto('http://127.0.0.1:5180/?sceneTest=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.sceneTest, { timeout: 90000 });
  await page.evaluate(() => window.sceneTest.start());
  await page.waitForTimeout(2500);
  console.log('OUTDOOR', await page.evaluate(() => window.sceneTest.state()));
  await page.screenshot({ path: 'scratchpad/scene-outdoor.png' });
  await page.evaluate(() => window.sceneTest.teleport(2.1, 1.5, 28, Math.PI / 2));
  await page.waitForTimeout(700);
  console.log('ENTRANCE', await page.evaluate(() => window.sceneTest.state()));
  await page.screenshot({ path: 'scratchpad/scene-entrance.png' });
  await page.keyboard.press('g');
  await page.waitForTimeout(1800);
  const indoor = await page.evaluate(() => window.sceneTest.state());
  console.log('INDOOR', indoor);
  result.checks.push({ name: 'G enters actual room; stable floor', passed: indoor.inside && indoor.grounded && indoor.position.y > .9 && indoor.position.y < 1.5 });
  await page.screenshot({ path: 'scratchpad/scene-interior.png' });
  await page.keyboard.down('w'); await page.waitForTimeout(800); await page.keyboard.up('w');
  const walked = await page.evaluate(() => window.sceneTest.state());
  result.checks.push({ name: 'Walk inside room', passed: Math.hypot(walked.position.x - indoor.position.x, walked.position.z - indoor.position.z) > 1 });
  const frozen = await page.evaluate(() => {
    let enabled = 0; window.sceneTest.physics.world.forEachRigidBody(b => { if (b.isEnabled()) enabled++; });
    return enabled;
  });
  result.checks.push({ name: 'Outdoor bodies frozen indoors', passed: frozen === 1 });
  await page.evaluate(() => window.sceneTest.teleport(998, 1.2, -3, Math.PI / 2));
  await page.waitForTimeout(400);
  await page.keyboard.down('w'); await page.waitForTimeout(1400); await page.keyboard.up('w');
  const wall = await page.evaluate(() => window.sceneTest.state());
  console.log('GLASS COLLISION', wall);
  result.checks.push({ name: 'Glass wall blocks walking', passed: wall.position.x > 996.1 && wall.position.x < 997.5 && wall.grounded });
  await page.evaluate(() => window.sceneTest.teleport(1008, 1.15, -3.7));
  await page.waitForTimeout(700); await page.keyboard.press('g'); await page.waitForTimeout(1300);
  const returned = await page.evaluate(() => window.sceneTest.state());
  console.log('RETURN', returned);
  result.checks.push({ name: 'G returns to original entrance', passed: !returned.inside && Math.abs(returned.position.x - 2.1) < 1 && Math.abs(returned.position.z - 28) < 1 });
  await page.screenshot({ path: 'scratchpad/scene-return.png' });
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('g'); await page.waitForTimeout(1200);
    await page.evaluate(() => window.sceneTest.teleport(1008, 1.15, -3.7));
    await page.waitForTimeout(250); await page.keyboard.press('g'); await page.waitForTimeout(1200);
  }
  const repeated = await page.evaluate(() => window.sceneTest.state());
  result.checks.push({ name: 'Repeated round trips do not leak colliders', passed: !repeated.inside && repeated.colliders === returned.colliders });
  await page.evaluate(() => {
    const t = window.sceneTest;
    t.vehicle.setStashed(false); t.vehicle.teleportTo(16, 40, 0);
    t.teleport(13.7, 1.3, 40);
  });
  await page.waitForTimeout(800); await page.keyboard.press('e'); await page.waitForTimeout(2000);
  console.log('CAR ENTER', await page.evaluate(() => window.sceneTest.state()));
  const beforeDrive = await page.evaluate(() => {
    const t = window.sceneTest; return { driving: t.playerManager.isDriving, pos: t.playerManager.activeVehicle.chassisBody.translation() };
  });
  await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
  await page.keyboard.down('Space'); await page.waitForTimeout(600); await page.keyboard.up('Space');
  const afterDrive = await page.evaluate(() => window.sceneTest.playerManager.activeVehicle.chassisBody.translation());
  console.log('DRIVE', { beforeDrive, afterDrive });
  result.checks.push({ name: 'Car drives on imported street', passed: beforeDrive.driving && Math.hypot(afterDrive.x - beforeDrive.pos.x, afterDrive.z - beforeDrive.pos.z) > 3 && afterDrive.y > -.3 });
  await page.screenshot({ path: 'scratchpad/scene-driving.png' });
  console.log(JSON.stringify(result));
  fs.writeFileSync('scratchpad/scene-check-result.json', JSON.stringify(result, null, 2));
  if (result.errors.length || result.checks.some(c => !c.passed)) process.exitCode = 1;
} finally { await context.close(); }
