import { chromium } from './browser-tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
const temp = path.resolve('scratchpad/fleet-browser-tmp');
fs.mkdirSync(temp, { recursive: true });
process.env.TEMP = process.env.TMP = temp;
const context = await chromium.launchPersistentContext(path.resolve('scratchpad/fleet-browser-profile'), {
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  viewport: { width: 1400, height: 900 },
});
try {
  const page = context.pages()[0];
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/fleet-test', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }));
  await page.goto('http://127.0.0.1:5181/fleet-test');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { Physics, RAPIER } = await import('/src/core/Physics.ts');
    const { CarLibrary } = await import('/src/core/Loader.ts');
    const { loadImportedFleet, createImportedFleet } = await import('/src/entities/ImportedFleet.ts');
    const [physics, lib, assets] = await Promise.all([Physics.create(), CarLibrary.load(), loadImportedFleet()]);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9bbdd1);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(500, .1, 500).setTranslation(0, -.1, 0));
    const fleet = createImportedFleet(scene, physics, lib, assets);
    const step = (drive) => {
      fleet.forEach(v => { v.beginStep(); v.fixedUpdate(1/60, drive(v)); });
      physics.step(1/60);
      fleet.forEach(v => { v.endStep(); v.syncVisual(1); v.updateFx(1/60); });
    };
    const idle = () => ({ throttle: 0, steer: 0, brake: true });
    for (let i = 0; i < 240; i++) step(idle);
    const rest = fleet.map(v => ({ name: v.mesh.name, ...v.chassisBody.translation() }));
    for (const v of fleet) if (!Number.isFinite(v.mesh.position.y) || v.mesh.position.y < 0 || v.mesh.position.y > 3) throw Error('Unstable resting vehicle: ' + v.mesh.name);
    // Separate lanes for simultaneous acceleration, avoiding collisions between test subjects.
    fleet.forEach((v,i) => v.teleportTo(i * 14, 0, 0, 2.5));
    for (let i = 0; i < 180; i++) step(idle);
    const { PersonLibrary } = await import('/src/core/Loader.ts');
    const { Character } = await import('/src/entities/Character.ts');
    const { PlayerManager } = await import('/src/gameplay/PlayerManager.ts');
    const people = await PersonLibrary.load();
    const character = new Character(scene, physics, new THREE.Vector3(0,1,0), people);
    const keys = new Set();
    const input = { wasPressed: k => { const pressed=keys.has(k); keys.delete(k); return pressed; }, isDown: () => false };
    const manager = new PlayerManager(character, {fixedUpdate(){},reset(){},knock(){}}, fleet,
      {findNearest:()=>-1,distanceTo:()=>Infinity}, {setExcludeCollider(){},blendTarget(){}}, input);
    const transition = () => {
      for(let i=0;i<100;i++) { manager.update(1/60); manager.syncVisual(); }
    };
    for (const v of fleet) {
      character.teleport(new THREE.Vector3(v.mesh.position.x + v.spec.half.x + .7, 1, v.mesh.position.z));
      character.syncVisual(1);
      keys.add('KeyE'); manager.update(1/60); transition();
      if (!manager.isDriving || manager.activeVehicle !== v) throw Error('Cannot enter ' + v.mesh.name);
      keys.add('KeyE'); manager.update(1/60); transition();
      if (manager.isDriving || !character.collider.isEnabled()) throw Error('Cannot exit ' + v.mesh.name);
    }
    for (let i = 0; i < 180; i++) step(v => ({ throttle: 1, steer: 0, brake: false, piloted: true, lift: v.spec.flying ? 1 : 0 }));
    const driven = fleet.map(v => ({ name: v.mesh.name, ...v.chassisBody.translation(), speed: v.speedKmh }));
    for (const v of fleet) if (v.mesh.position.z < 5 || !Number.isFinite(v.speedKmh)) throw Error('Cannot drive: ' + v.mesh.name);
    const heli = fleet.at(-1);
    if (heli.mesh.position.y < 8) throw Error('Helicopter cannot climb');
    for (let i = 0; i < 180; i++) step(v => v === heli ? { throttle: 0, steer: 0, brake: false, piloted: true, lift: 0 } : idle());
    const hoverY = heli.mesh.position.y;
    for (let i = 0; i < 120; i++) step(v => v === heli ? { throttle: 0, steer: 0, brake: false, piloted: true, lift: 0 } : idle());
    if (Math.abs(heli.mesh.position.y - hoverY) > .3) throw Error('Hover unstable');
    for (let i = 0; i < 120; i++) step(v => v === heli ? { throttle: 0, steer: 1, brake: false, piloted: true, lift: -1 } : idle());
    if (heli.mesh.position.y > hoverY - 4) throw Error('Descent failed');
    fleet.forEach((v,i) => v.teleportTo((i%3)*10, Math.floor(i/3)*12, 0, 2.5));
    for (let i = 0; i < 180; i++) step(idle);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(1400,900); document.body.append(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff,0x557766,2));
    const light = new THREE.DirectionalLight(0xffffff,3); light.position.set(10,30,10); scene.add(light);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(500,500), new THREE.MeshStandardMaterial({color:0x555e61}));
    floor.rotation.x=-Math.PI/2; scene.add(floor);
    const camera = new THREE.PerspectiveCamera(45,1400/900,.1,1000); camera.position.set(39,34,53); camera.lookAt(10,0,12);
    renderer.render(scene,camera);
    return { count: fleet.length, rest, driven, hoverY, checks: ['load', 'settle', 'drive', 'climb', 'hover', 'descend', 'enter-exit-all', 'render'] };
  });
  await page.screenshot({ path: 'scratchpad/imported-fleet.png' });
  if (errors.length) throw Error(errors.join('\n'));
  fs.writeFileSync('scratchpad/imported-fleet-result.json', JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally { await context.close(); }
