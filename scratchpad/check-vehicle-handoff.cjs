// Real Rapier/Three simulation without a browser or asset downloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports, console,
    require: name => {
      // Scene generation and GLB loading are unrelated to handoff physics.
      if (name.endsWith('/City')) return { CHUNK_SIZE: 64, chunkZone: () => 'city' };
      if (name.endsWith('/Loader')) return {};
      return name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
    },
  }, { filename: file });
  return exports;
}
const { Physics, RAPIER } = load('src/core/Physics.ts');
const { Character } = load('src/entities/Character.ts');
const { CameraRig } = load('src/entities/CameraRig.ts');
const { CharacterController } = load('src/gameplay/CharacterController.ts');
const { PlayerManager } = load('src/gameplay/PlayerManager.ts');
const { Vehicle, CAR_SPEC, MOTO_SPEC, TANK_SPEC } = load('src/entities/Vehicle.ts');
const zeroMouse = { x: 0, y: 0 };
let people = { spawn() {
  const root = new THREE.Group();
  return { root, actions: new Map(), mixer: new THREE.AnimationMixer(root) };
} };
const cars = { clone: () => new THREE.Group() };

async function fixture(spec = CAR_SPEC, heading = 0) {
  const physics = await Physics.create();
  const scene = new THREE.Scene();
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(100, 0.1, 100).setTranslation(0, -0.1, 0));
  const vehicle = new Vehicle(scene, physics, new THREE.Vector3(0, 0.8, 0), cars, { ...spec, roofHull: false });
  vehicle.chassisBody.setRotation(new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading), true);
  const character = new Character(scene, physics, new THREE.Vector3(2.5, 0.97, 0), people);
  const camera = new THREE.PerspectiveCamera();
  const rig = new CameraRig(camera, physics, character.collider);
  const pressed = new Set(), held = new Set();
  const input = { consumeJumpPress: () => pressed.delete('Space'), wasPressed(k) { return pressed.delete(k); }, isDown: k => held.has(k) };
  const controller = new CharacterController(character, rig, input, () => null);
  let scans = 0;
  const traffic = { findNearest() { scans++; return -1; }, distanceTo: () => Infinity };
  const manager = new PlayerManager(character, controller, [vehicle], traffic, rig, input);
  const target = new THREE.Vector3();
  function fixedStep(dt = 1 / 60) {
    character.beginStep(); vehicle.beginStep();
    manager.fixedUpdate(dt); physics.step(dt);
    character.endStep(); vehicle.endStep();
  }
  function render(dt, alpha = 1) {
    manager.update(dt);
    character.animate(dt, controller.speed, character.grounded);
    character.syncVisual(alpha); vehicle.syncVisual(alpha); manager.syncVisual();
    manager.getCameraTarget(target);
    if (manager.isDriving) rig.updateChase(dt, target, vehicle.visualHeadingYaw, 0, zeroMouse);
    else rig.update(dt, target, zeroMouse);
  }
  function step(dt = 1 / 60) { fixedStep(dt); render(dt); }
  for (let i = 0; i < 90; i++) step();
  const pressE = () => { pressed.add('KeyE'); manager.update(); };
  function finish() { for (let i=0; i<90 && manager.isTransitioning; i++) step(); assert.ok(!manager.isTransitioning); }
  return { physics, vehicle, character, rig, camera, controller, manager, held, step, fixedStep, render, pressE, finish, scans: () => scans };
}

async function loadPeople() {
  // Use the shipped skeleton and clips; textures alone are omitted for this Node test.
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const glb = fs.readFileSync('public/models/characters/Knight.glb');
  const jsonLength = glb.readUInt32LE(12), binStart = 20 + jsonLength;
  const json = JSON.parse(glb.toString('utf8', 20, binStart));
  json.buffers[0].uri = `data:application/octet-stream;base64,${glb.subarray(binStart + 8).toString('base64')}`;
  delete json.images; delete json.textures;
  json.materials = json.materials.map(() => ({ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  global.ProgressEvent ??= class ProgressEvent { constructor(type, data) { this.type = type; Object.assign(this, data); } };
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), '');
  const box = new THREE.Box3().setFromObject(gltf.scene), scale = 1.8 / (box.max.y - box.min.y);
  gltf.scene.scale.setScalar(scale); gltf.scene.position.y = -box.min.y * scale; gltf.scene.rotation.y = Math.PI;
  people = { spawn() {
    const root = new THREE.Group(); root.add(clone(gltf.scene));
    const mixer = new THREE.AnimationMixer(root), actions = new Map();
    for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
    return { root, mixer, actions };
  } };
}

async function run() {
  await loadPeople();
  const f = await fixture();
  const pos = new THREE.Vector3();
  f.character.moveBy(new THREE.Vector3(0, 0, -0.2));
  const destination = new THREE.Vector3(6, 0.97, 4);
  f.character.teleport(destination);
  f.physics.step(1 / 60);
  assert.ok(f.character.getPosition(pos).distanceTo(destination) < 1e-5, 'Teleport must clear pending kinematic movement');
  f.character.teleport(new THREE.Vector3(2.5, 0.97, 0));
  const entryStart = f.character.mesh.position.clone();
  f.pressE();
  assert.ok(f.manager.isDriving && f.manager.isTransitioning && f.character.mesh.visible);
  assert.ok(f.character.mesh.position.distanceTo(entryStart) < 1e-6, 'Entry must not hide or teleport the character');
  const scans = f.scans();
  const clips = new Set();
  let lastCharacter = entryStart.clone(), maxCharacterStep = 0, movingFrames = 0;
  for (let i = 0; i < 60; i++) {
    f.step(); clips.add(f.character.currentClip);
    if (f.character.mesh.visible) {
      const distance = lastCharacter.distanceTo(f.character.mesh.position);
      if (distance > 0.002) movingFrames++;
      maxCharacterStep = Math.max(maxCharacterStep, distance);
      lastCharacter.copy(f.character.mesh.position);
    }
  }
  assert.ok(clips.has('Walking_A') && clips.has('Sit_Chair_Down'), 'Use actual approach and sitting clips');
  assert.ok(movingFrames > 12 && maxCharacterStep < 0.3, `Entry continuity: ${movingFrames} frames, largest step ${maxCharacterStep}`);
  assert.equal(f.scans(), scans, 'Driving should not scan vehicles at the stale character location');
  const previousTarget = f.rig.target.clone();
  f.pressE();
  assert.ok(f.manager.isTransitioning && !f.character.collider.isEnabled());
  assert.ok(f.character.mesh.visible, 'Exit must animate the visible character');
  assert.equal(f.character.currentClip, 'Sit_Chair_StandUp');
  f.rig.updateChase(1 / 60, f.manager.getCameraTarget(pos), f.vehicle.visualHeadingYaw, 0, zeroMouse);
  assert.ok(f.rig.target.distanceTo(previousTarget) < 1e-5, 'Camera target should be continuous at dismount');
  let maxTargetStep = 0, last = f.rig.target.clone();
  for (let i = 0; i < 30; i++) {
    f.step(); maxTargetStep = Math.max(maxTargetStep, last.distanceTo(f.rig.target)); last.copy(f.rig.target);
  }
  assert.ok(maxTargetStep < 0.25, `Camera target jumped ${maxTargetStep}m`);
  assert.ok(!f.manager.isDriving && f.character.collider.isEnabled());
  assert.ok(f.character.grounded, 'Grounded dismount must not flash a jump animation');
  assert.ok(Math.abs(f.character.getPosition(pos).y - 0.97) < 0.04);
  assert.equal(f.controller.state, 'idle');
  for (let cycle = 0; cycle < 12; cycle++) {
    f.pressE(); assert.ok(f.manager.isDriving); f.finish();
    f.pressE(); f.finish(); assert.ok(!f.manager.isDriving); f.step();
    assert.ok(f.character.getPosition(pos).distanceTo(f.vehicle.getPosition(new THREE.Vector3())) < 3);
  }
  f.pressE(); f.finish();
  const wall = f.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.3, 2, 4).setTranslation(1.8, 2, 0));
  f.physics.step(1 / 60);
  f.pressE(); f.finish();
  assert.ok(!f.manager.isDriving);
  assert.ok(f.character.getPosition(pos).x < 0, 'Blocked driver side should choose the opposite side');
  f.physics.world.removeCollider(wall, true);
  f.pressE(); f.finish(); assert.ok(f.manager.isDriving);
  f.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.2, 10).setTranslation(0, 1.5, 0));
  f.physics.step(1 / 60);
  f.pressE();
  assert.ok(f.manager.isDriving, 'No clear exit must not place the character inside geometry');
  f.manager.forceExit();
  assert.ok(!f.manager.isDriving && f.character.collider.isEnabled(), 'Forced exit must always release control');
  f.physics.world.free();

  const moto = await fixture(MOTO_SPEC, 1.1);
  moto.pressE(); moto.finish(); assert.ok(moto.character.isRiding);
  moto.character.mesh.rotation.set(0.4, 2.2, 0.6, 'YXZ');
  moto.pressE(); moto.finish();
  assert.ok(!moto.character.isRiding);
  assert.ok(Math.abs(moto.character.mesh.rotation.z) < 1e-6);
  assert.ok(Math.abs(moto.character.mesh.rotation.x) < 1e-6);
  const expectedYaw = moto.character.yaw;
  moto.step();
  assert.ok(Math.abs(moto.character.mesh.rotation.y - expectedYaw) < 1e-6, 'Dismount heading must survive interpolation');
  assert.ok(Math.abs(moto.controller.currentYaw - expectedYaw) < 1e-6, 'Controller must retain dismount heading');
  moto.held.add('KeyW'); moto.step();
  assert.equal(moto.controller.state, 'walk', 'Movement must resume on the next physics tick');
  moto.physics.world.free();

  const tank = await fixture(TANK_SPEC);
  tank.pressE(); tank.finish(); assert.ok(tank.manager.isDriving);
  tank.pressE(); tank.finish(); assert.ok(!tank.manager.isDriving);
  const tankPos = tank.vehicle.getPosition(new THREE.Vector3());
  assert.ok(Math.abs(tank.character.getPosition(pos).x - tankPos.x) >= TANK_SPEC.half.x + 0.65, 'Wide vehicle exit must clear the hull');
  for (let i = 0; i < 30; i++) tank.step();
  assert.ok(tank.character.grounded);
  tank.physics.world.free();

  const continuity = [];
  for (const fps of [30, 60, 120]) {
    const run = await fixture(MOTO_SPEC);
    for (const entering of [true, false]) {
      let last = run.character.mesh.position.clone(), maxStep = 0, frames = 0;
      const clips = new Set();
      run.pressE();
      while (run.manager.isTransitioning && frames < fps * 2) {
        run.step(1 / fps); frames++;
        clips.add(run.character.currentClip);
        maxStep = Math.max(maxStep, last.distanceTo(run.character.mesh.position));
        last.copy(run.character.mesh.position);
      }
      assert.ok(!run.manager.isTransitioning && run.manager.isDriving === entering);
      assert.ok(maxStep < 20 / fps, `${fps} FPS: character jumps ${maxStep}m`);
      assert.ok(clips.has(entering ? 'Sit_Chair_Down' : 'Sit_Chair_StandUp'));
      continuity.push({ fps, phase: entering ? 'enter' : 'exit', frames, maxStep: +maxStep.toFixed(3) });
    }
    run.pressE(); run.step(); run.pressE();
    assert.ok(run.manager.isTransitioning && run.manager.transition.entering, 'Repeated E must not reverse an unfinished entry');
    run.manager.forceExit();
    assert.ok(!run.manager.isTransitioning && !run.character.isRiding && run.character.collider.isEnabled(), 'Death must cancel entry without leaving controls locked');
    run.physics.world.free();
  }
  const { CarLibrary } = load('src/core/Loader.ts');
  const lib = new CarLibrary(), template = new THREE.Group();
  for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
    const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.5), new THREE.MeshStandardMaterial());
    wheel.name = name; template.add(wheel);
  }
  lib.templates.set('sedan-sports', template);
  const wheelsA = lib.sportsWheels(), wheelsB = lib.sportsWheels();
  assert.notEqual(wheelsA[0].model, wheelsB[0].model);
  assert.equal(wheelsA[0].model.children[0].geometry, wheelsB[0].model.children[0].geometry, 'Taking another car must reuse baked wheel buffers');
  assert.equal(lib.colliderBoxes('taxi'), lib.colliderBoxes('sedan-sports'), 'Paint variants must reuse collision measurements');
  console.log('Animation continuity using the shipped Knight skeleton:', continuity);
  console.log('PASS: actual sit/stand clips, pending movement, grounded exit, camera continuity, repeated entry/exit, wall clearance, blocked/forced exit, motorcycle posture/control, tank clearance, driving query cost, wheel/collision caches');
}
module.exports = { loadPeople, fixture, load, THREE, CAR_SPEC, MOTO_SPEC };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
