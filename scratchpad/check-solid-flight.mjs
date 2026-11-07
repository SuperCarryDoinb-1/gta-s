import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
process.env.TEMP = process.env.TMP = path.resolve('scratchpad/solid-flight-review/tmp');
fs.mkdirSync(process.env.TEMP, { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve('scratchpad/solid-flight-review/profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, viewport: { width: 1280, height: 800 },
});
const errors = [], gpuErrors = [];
try {
  const page = context.pages()[0];
  page.on('pageerror', e => { errors.push(e.message); console.log('PAGE ERROR', e.message); });
  page.on('console', m => { if (m.type() === 'error' && /shader|WebGL|feedback/i.test(m.text())) gpuErrors.push(m.text()); });
  await page.route('**/src/main.ts*', async route => {
    const response = await route.fetch(); await route.fulfill({ response, body: await response.text() + '\nwindow.__flight={engine,physics,character,controller,input,playerManager,vehicle,importedFleet,cameraRig,chunkManager,shanghai,THREE};' });
  });
  await page.goto('http://127.0.0.1:5186/');
  await page.waitForFunction(() => window.__flight, null, { timeout: 90000 });
  if (await page.locator('#motion-btn').getAttribute('aria-pressed') === 'true') await page.locator('#motion-btn').click();
  await page.locator('#start-btn').click();
  await page.waitForFunction(() => document.getElementById('menu').style.display === 'none');
  const buildings = await page.evaluate(async () => {
    const q = window.__flight, { RAPIER } = await import('/src/core/Physics.ts'); q.engine.stop();
    const ray = (origin, dir, length) => {
      const hit = q.physics.world.castRayAndGetNormal(new RAPIER.Ray(origin, dir), length, true, RAPIER.QueryFilterFlags.ONLY_FIXED);
      return hit ? { distance: hit.timeOfImpact, y: origin.y + dir.y * hit.timeOfImpact } : null;
    };
    const wall = ray({ x: 16, y: 10, z: 0 }, { x: -1, y: 0, z: 0 }, 20);
    const shaft = ray({ x: 215, y: 48, z: 0 }, { x: -1, y: 0, z: 0 }, 35);
    const sphere = ray({ x: 215, y: 66, z: 0 }, { x: -1, y: 0, z: 0 }, 35);
    const highRoof = ray({ x: 216, y: 120, z: -101 }, { x: 0, y: -1, z: 0 }, 60);
    const roofBridge = ray({ x: 206, y: 95, z: 81 }, { x: 0, y: -1, z: 0 }, 20);
    q.character.teleport(new q.THREE.Vector3(14, 1.3, 0)); q.character.settleOnGround();
    for (let i = 0; i < 100; i++) {
      q.character.beginStep(); q.character.moveBy(new q.THREE.Vector3(-.13, -.04, 0)); q.physics.step(1 / 60); q.character.endStep();
    }
    const stoppedAt = { ...q.character.body.translation() };
    const car = q.vehicle, carBody = car.chassisBody;
    car.setStashed(false); carBody.setTranslation({ x: 17, y: 1, z: 0 }, true);
    carBody.setRotation(new q.THREE.Quaternion().setFromAxisAngle(new q.THREE.Vector3(0, 1, 0), -Math.PI / 2), true);
    carBody.setLinvel({ x: -18, y: 0, z: 0 }, true); carBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let i = 0; i < 80; i++) { car.fixedUpdate(1 / 60, { throttle: 1, steer: 0, brake: false }); q.physics.step(1 / 60); }
    const carWallStop = { ...carBody.translation() }; car.setStashed(true);
    // No background build budget: the current actor's nearby walls still become physical.
    const remote = new q.THREE.Vector3(480, 1, 0); q.chunkManager.update(remote, 0);
    const newChunk = q.chunkManager.chunks.get('5,0');
    const box = newChunk.pending.find(b => b.h > 4 && b.w > 2 && b.d > 2);
    if (!box) throw Error('No building in streamed test chunk');
    remote.set(box.x + box.w / 2 + 2, box.base + 2, box.z);
    q.chunkManager.prepareCollisions(remote, 20); q.physics.step(1 / 60);
    const streamedWall = ray(remote, { x: -1, y: 0, z: 0 }, 10);
    q.chunkManager.update(new q.THREE.Vector3(16, 1, -16), Infinity); q.physics.step(1 / 60);
    const heli = q.importedFleet.find(v => v.spec.flying);
    heli.getPosition(remote); remote.x += 2.4; remote.y = 1.3;
    q.character.teleport(remote); q.character.settleOnGround(); q.controller.reset();
    for (let i = 0; i < 6; i++) q.engine.prepareStep(1 / 60);
    return { wall, shaft, sphere, highRoof, roofBridge, stoppedAt, carWallStop, streamedWall };
  });
  assert.ok(buildings.wall && buildings.shaft && buildings.sphere && buildings.roofBridge && buildings.streamedWall, JSON.stringify(buildings));
  assert.ok(buildings.highRoof?.y > 94, 'The visible high roof must be solid');
  assert.ok(buildings.roofBridge.y > 81 && buildings.stoppedAt.x > 9.3 && buildings.stoppedAt.x < 10.5, 'Wall/roof collision mismatch');
  assert.ok(buildings.carWallStop.x > 10.5, 'Driving cannot pass through the wall');
  console.log('BUILDINGS', JSON.stringify(buildings));
  await page.keyboard.press('e');
  await page.evaluate(() => { const q = window.__flight; for (let i = 0; i < 160; i++) q.engine.prepareStep(1 / 60); });
  assert.equal(await page.evaluate(() => window.__flight.playerManager.isDriving && window.__flight.playerManager.activeVehicle.spec.flying), true, 'Enter real helicopter with E');
  const samples = [];
  const sample = async (label, keys, frames, screenshot = false) => {
    for (const key of keys) await page.keyboard.down(key);
    const data = await page.evaluate(({ label, frames }) => {
      const q = window.__flight; for (let i = 0; i < frames; i++) q.engine.prepareStep(1 / 60); q.engine.warmup();
      const h = q.playerManager.activeVehicle, body = h.chassisBody;
      const angles = new q.THREE.Euler().setFromQuaternion(h.mesh.quaternion, 'YXZ');
      return { label, position: { ...body.translation() }, velocity: { ...body.linvel() }, pitch: angles.x, yaw: angles.y, roll: angles.z, rotor: h.flight.rotorSpeed, climbCommand: h.flight.climbCommand,
        cameraY: q.engine.camera.position.y, fov: q.engine.camera.fov, condition: h.condition };
    }, { label, frames });
    for (const key of keys) await page.keyboard.up(key);
    samples.push(data); console.log('FLIGHT', JSON.stringify(data));
    if (screenshot) await page.screenshot({ path: `scratchpad/solid-flight-review/${label}.png` });
    return data;
  };
  const start = await sample('ground', [], 1);
  const first = await sample('climb-start', ['Space'], 15);
  const climb = await sample('climbing', ['Space'], 210, true);
  const hover = await sample('hover', [], 180, true);
  const forward = await sample('forward-pitch', ['w'], 180, true);
  const diagonal = await sample('forward-climb', ['w', 'Space'], 90, true);
  const turn = await sample('banked-turn', ['w', 'a'], 150, true);
  const descend = await sample('descending', ['Shift'], 120, true);
  const ease = await sample('vertical-braking', [], 180);
  assert.ok(first.velocity.y < climb.velocity.y && climb.position.y > start.position.y + 7, 'Gradual takeoff and climb');
  assert.ok(Math.abs(hover.velocity.y) < .7, 'Release collective settles to hover');
  assert.ok(forward.pitch > .2 && Math.hypot(forward.velocity.x, forward.velocity.z) > 3, 'Nose tilt must produce forward flight');
  assert.ok(diagonal.position.y > forward.position.y + .5 && Math.hypot(diagonal.position.x - forward.position.x, diagonal.position.z - forward.position.z) > 4, 'Forward climbing must follow a 3D trajectory');
  assert.ok(Math.abs(turn.roll) > .08 && Math.abs(turn.yaw - forward.yaw) > .5, 'Physical bank and yaw');
  assert.ok(descend.velocity.y < -2 && Math.abs(ease.velocity.y) < .7, 'Descent and inertial braking');
  assert.ok(turn.cameraY > 3 && forward.fov > 70 && samples.every(s => s.condition > 0), 'Flight camera and controllability');
  const contacts = await page.evaluate(() => {
    const q = window.__flight, heli = q.playerManager.activeVehicle, body = heli.chassisBody;
    const reset = (x, y, z, yaw, vx, vy, vz) => {
      body.setTranslation({ x, y, z }, true); const r = new q.THREE.Quaternion().setFromAxisAngle(new q.THREE.Vector3(0, 1, 0), yaw);
      body.setRotation(r, true); body.setLinvel({ x: vx, y: vy, z: vz }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };
    reset(215, 48, 0, -Math.PI / 2, -18, 0, 0);
    for (let i = 0; i < 90; i++) { heli.fixedUpdate(1 / 60, { throttle: 0, steer: 0, brake: false }); q.physics.step(1 / 60); }
    const shaftStop = { ...body.translation() };
    reset(216, 104, -101, 0, 0, -8, 0);
    for (let i = 0; i < 100; i++) { heli.fixedUpdate(1 / 60, { throttle: 0, steer: 0, brake: false }); q.physics.step(1 / 60); }
    return { shaftStop, rooftop: { ...body.translation() } };
  });
  assert.ok(contacts.shaftStop.x > 195, 'Helicopter cannot fly through the tower shaft');
  assert.ok(contacts.rooftop.y > 95, 'Helicopter must land on the visible high rooftop');
  assert.deepEqual(errors, []); assert.deepEqual(gpuErrors, []);
  fs.writeFileSync('scratchpad/solid-flight-review/result.json', JSON.stringify({ passed: true, buildings, samples, contacts, errors, gpuErrors }, null, 2));
  console.log('PASS', JSON.stringify(contacts));
} finally { await context.close(); }
