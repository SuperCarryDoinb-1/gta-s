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
  vm.runInNewContext(code, { exports, console, require: name => {
    if (name.endsWith('/Loader')) return { TRAFFIC_TYPES: ['sedan', 'police'] };
    return name.startsWith('.') ? load(path.resolve(path.dirname(file), `${name}.ts`)) : require(name);
  } }, { filename: file });
  return exports;
}
const { Physics, RAPIER } = load('src/core/Physics.ts');
const { roadCarBody, driveRoadCar } = load('src/entities/AICarPhysics.ts');
const { Vehicle } = load('src/entities/Vehicle.ts');
const { TrafficSystem } = load('src/entities/Traffic.ts');
const { WantedSystem } = load('src/gameplay/Wanted.ts');
const boxes = { body: { hx: 1.15, hy: .35, hz: 2.2, cy: .45, cz: 0 },
  cabin: { hx: .8, hy: .3, hz: 1.1, cy: 1.1, cz: 0 } };
const cars = { clone: () => new THREE.Group(), colliderBoxes: () => boxes, sportsWheels: () => [] };
const personLib = { spawn: () => {
  const root = new THREE.Group();
  return { root, actions: new Map(), mixer: new THREE.AnimationMixer(root) };
} };
async function run() {
  const results = [];
  for (const scenario of ['head-on', 'rear-end', 'crossing', 'wall']) {
    const physics = await Physics.create();
    const world = physics.world;
    function car(x, z, yaw, speed) {
      const body = world.createRigidBody(roadCarBody().setTranslation(x, 0, z));
      physics.registerVehicle(body);
      body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
      const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(1.15, .5, 2.2).setTranslation(0, .6, 0).setMass(700), body);
      body.setLinvel({ x: Math.sin(yaw) * speed, y: 0, z: Math.cos(yaw) * speed }, true);
      return { body, collider, yaw, speed };
    }
    const a = scenario === 'crossing' ? car(-15, 0, Math.PI / 2, 30) : car(0, -15, 0, 30);
    const b = scenario === 'wall' ? null : car(0, scenario === 'head-on' ? 15 : scenario === 'crossing' ? -15 : 0, scenario === 'head-on' ? Math.PI : 0, scenario === 'rear-end' ? 0 : 30);
    const obstacle = b?.collider ?? world.createCollider(RAPIER.ColliderDesc.cuboid(10, 2, .2).setTranslation(0, 1, 0));
    let maxDepth = 0, contacts = 0;
    for (let step = 0; step < 360; step++) {
      for (const c of [a, b].filter(Boolean)) {
        const p = c.body.translation();
        driveRoadCar(c.body, p.x + Math.sin(c.yaw) * c.speed / 60, p.z + Math.cos(c.yaw) * c.speed / 60, c.yaw, c.speed, 1 / 60);
      }
      physics.step(1 / 60);
      const contact = a.collider.contactCollider(obstacle, .1);
      if (contact) {
        contacts++;
        maxDepth = Math.max(maxDepth, -contact.distance);
      }
      assert.ok(Number.isFinite(a.body.translation().z));
      if (scenario === 'head-on') assert.ok(a.body.translation().z < b.body.translation().z, 'Cars must not pass through one another');
      if (scenario === 'wall') assert.ok(a.body.translation().z < 0, 'Car must not tunnel through wall');
    }
    assert.ok(contacts > 0, `${scenario} must exercise contact`);
    assert.ok(maxDepth < .08, `${scenario}: excessive penetration ${maxDepth}`);
    results.push({ scenario, maxPenetrationCm: +(maxDepth * 100).toFixed(2), contacts });
    world.free();
  }
  const physics = await Physics.create(), scene = new THREE.Scene();
  const player = new Vehicle(scene, physics, new THREE.Vector3(0, .8, 0), cars);
  assert.equal(player.chassisCollider.shape.halfExtents.x, 1.15);
  for (let i = 0; i < 8; i++) {
    const car = new Vehicle(scene, physics, new THREE.Vector3(i * 8, .8, 0), cars);
    car.setStashed(i % 2 === 0);
  }
  let lightCount = 0;
  scene.traverseVisible(o => { if (o.isSpotLight) lightCount++; });
  assert.equal(lightCount, 2, 'Creating/stashing cars must not change shader light counts');
  const traffic = new TrafficSystem(scene, physics, new THREE.Vector3(20, 0, 0), cars);
  assert.ok(traffic.cars.every(c => c.body.isDynamic() && c.body.isCcdEnabled()));
  traffic.fixedUpdate(1 / 60, new THREE.Vector3(20, 0, 0), new THREE.Vector3(20, 0, 0));
  physics.step(1 / 60); traffic.endStep();
  for (const car of traffic.cars) assert.ok(car.currPos.distanceTo(new THREE.Vector3().copy(car.body.translation())) < 1e-6);
  const wanted = new WantedSystem(scene, physics, { door() {}, gunshot() {} }, cars, personLib, { knock() {} }, { panicAt() {} });
  wanted.frameUp();
  for (let i = 0; i < 300; i++) {
    wanted.fixedUpdate(1 / 60, new THREE.Vector3(20, 1, 0), true, player);
    physics.step(1 / 60); wanted.endStep();
    for (const car of wanted.cars.filter(c => c.active)) {
      assert.ok(car.body.isDynamic() && car.body.isCcdEnabled());
      assert.ok(car.currPos.distanceTo(new THREE.Vector3().copy(car.body.translation())) < 1e-6);
      assert.ok(car.speed <= 9.01, `Two-star pursuit too fast: ${car.speed}`);
    }
  }
  physics.world.free();
  console.table(results);
  console.log('PASS: collision response, CCD, model-sized hull, constant light count, traffic/police physics synchronization, reduced pursuit speed');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
