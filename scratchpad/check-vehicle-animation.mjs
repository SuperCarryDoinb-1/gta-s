import { chromium } from 'file:///C:/Users/17920/AppData/Local/npm-cache/_npx/c61c9351a0dbcfa7/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/handoff-check', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }));
  await page.goto('http://127.0.0.1:5175/handoff-check');
  await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { CarLibrary, PersonLibrary, loadMotoModel } = await import('/src/core/Loader.ts');
    const { Physics, RAPIER } = await import('/src/core/Physics.ts');
    const { Vehicle, MOTO_SPEC } = await import('/src/entities/Vehicle.ts');
    const { Character } = await import('/src/entities/Character.ts');
    const { CharacterController } = await import('/src/gameplay/CharacterController.ts');
    const { PlayerManager } = await import('/src/gameplay/PlayerManager.ts');
    const { CameraRig } = await import('/src/entities/CameraRig.ts');
    const [cars, people, physics, bike] = await Promise.all([CarLibrary.load(), PersonLibrary.load(), Physics.create(), loadMotoModel()]);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xaebccc);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x58626e, 3));
    const light = new THREE.DirectionalLight(0xffedd5, 3); light.position.set(4, 9, 3); scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: 0x555b63 }));
    ground.rotation.x = -Math.PI / 2; scene.add(ground);
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(75, 0.1, 75).setTranslation(0, -0.1, 0));
    const vehicle = new Vehicle(scene, physics, new THREE.Vector3(0, 0.8, 0), cars);
    const motorcycle = new Vehicle(scene, physics, new THREE.Vector3(7, 0.8, 0), cars, MOTO_SPEC, bike);
    const owned = [vehicle, motorcycle];
    const character = new Character(scene, physics, new THREE.Vector3(2.5, 0.97, 0.25), people);
    const followCamera = new THREE.PerspectiveCamera(55, 1100 / 760, 0.1, 200);
    const camera = followCamera.clone(); camera.position.set(6, 3.6, 6); camera.lookAt(0.7, 0.9, 0);
    const rig = new CameraRig(followCamera, physics, character.collider);
    const pressed = new Set(), held = new Set();
    const input = { wasPressed: k => pressed.has(k), isDown: k => held.has(k) };
    const controller = new CharacterController(character, rig, input, () => null);
    const manager = new PlayerManager(character, controller, owned, { findNearest: () => -1 }, rig, input);
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1100, 760);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; document.body.append(renderer.domElement);
    const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5));
    const target = new THREE.Vector3(), q = new THREE.Quaternion(), lean = new THREE.Quaternion();
    const zAxis = new THREE.Vector3(0, 0, 1), left = new THREE.Vector3(), right = new THREE.Vector3();
    function step(dt = 1 / 60) {
      character.beginStep(); owned.forEach(v => v.beginStep());
      manager.fixedUpdate(dt); physics.step(dt);
      character.endStep(); owned.forEach(v => v.endStep());
      manager.update(dt); pressed.clear();
      character.animate(dt, controller.speed, character.grounded);
      character.syncVisual(1); owned.forEach(v => v.syncVisual(1)); manager.syncVisual();
      manager.getCameraTarget(target);
      if (manager.isDriving) rig.updateChase(dt, target, manager.activeVehicle.visualHeadingYaw, 0, { x: 0, y: 0 });
      else rig.update(dt, target, { x: 0, y: 0 });
      renderer.render(scene, camera);
    }
    for (let i = 0; i < 120; i++) step();
    window.handoff = { THREE, physics, vehicle, motorcycle, character, controller, manager, pressed, held, camera, rig, step };
  });
  const run = async (label, entering) => {
    const result = await page.evaluate(async ({ entering }) => {
      const h = window.handoff, { character: c, manager: m, step, pressed, THREE } = h;
      const positions = [], clips = new Set(), costs = [], frameIntervals = [];
      let lastTime;
      const before = c.mesh.position.clone();
      pressed.add('KeyE'); step();
      if (!m.isTransitioning || !c.mesh.visible || c.collider.isEnabled()) throw Error('Transition must show the character with physics suspended');
      if (entering && c.mesh.position.distanceTo(before) > 0.1) throw Error('Entry teleported on the first frame');
      const initial = c.mesh.position.clone();
      for (let i = 0; i < 55; i++) {
        const now = await new Promise(requestAnimationFrame);
        if (lastTime !== undefined) frameIntervals.push(now - lastTime);
        lastTime = now;
        const start = performance.now(); step(); costs.push(performance.now() - start);
        if (c.mesh.visible) positions.push(c.mesh.position.clone());
        clips.add(c.currentClip);
      }
      if (m.isTransitioning || m.isDriving !== entering) throw Error('Transition did not finish');
      const movingFrames = positions.filter((p, i) => i > 0 && p.distanceTo(positions[i - 1]) > 0.002).length;
      if (movingFrames < 8) throw Error(`Only ${movingFrames} frames of visible movement`);
      if (!clips.has(entering ? 'Sit_Chair_Down' : 'Sit_Chair_StandUp')) throw Error('Missing sit/stand animation');
      let maxStep = 0, last = initial;
      for (const p of positions) { maxStep = Math.max(maxStep, last.distanceTo(p)); last = p; }
      if (maxStep > 0.3) throw Error(`Character jumped ${maxStep}m in one frame`);
      if (!entering && !c.grounded) throw Error('Exit did not restore grounded movement');
      costs.sort((a, b) => a - b); frameIntervals.sort((a, b) => a - b);
      return { movingFrames, maxStep: +maxStep.toFixed(3), clips: [...clips], updateP95Ms: +costs[Math.floor(costs.length * 0.95)].toFixed(2), frameP95Ms: +frameIntervals[Math.floor(frameIntervals.length * 0.95)].toFixed(2) };
    }, { entering });
    console.log(label, result);
  };
  await run('car-entry', true);
  await page.evaluate(() => { const h = window.handoff; h.pressed.add('KeyE'); for (let i = 0; i < 11; i++) h.step(); });
  await page.screenshot({ path: 'scratchpad/car-exit-animation.png' });
  await page.evaluate(() => { const h = window.handoff; for (let i = 0; i < 45; i++) h.step(); h.pressed.add('KeyE'); for (let i = 0; i < 55; i++) h.step(); });
  await run('car-exit', false);
  await page.evaluate(() => {
    const h = window.handoff;
    h.character.teleport(new h.THREE.Vector3(8.5, 0.97, 0.2)); h.controller.reset();
    h.camera.position.set(12, 3.2, 5); h.camera.lookAt(7.5, 0.8, 0);
    h.step();
  });
  await run('motorcycle-entry', true);
  await page.screenshot({ path: 'scratchpad/motorcycle-seated.png' });
  await run('motorcycle-exit', false);
  if (errors.length) throw Error(errors.join('\n'));
  console.log('Real model/animation/browser checks passed; pageerrors: []');
} finally { await browser.close(); }
