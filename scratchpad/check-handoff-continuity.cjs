const assert = require('node:assert/strict');
const { loadPeople, fixture, THREE, CAR_SPEC, MOTO_SPEC } = require('./check-vehicle-handoff.cjs');

(async () => {
  await loadPeople();
  const results = [];
  for (const [vehicleName, spec] of [['car', CAR_SPEC], ['motorcycle', MOTO_SPEC]]) {
    for (const intervals of [[1 / 30], [1 / 60], [1 / 120], [1 / 120, 1 / 45, 1 / 80, 1 / 30]]) {
      const f = await fixture(spec);
      let accumulator = 0, frame = 0;
      const render = () => {
        const dt = intervals[frame++ % intervals.length];
        accumulator += dt;
        while (accumulator >= 1 / 60) { f.fixedStep(); accumulator -= 1 / 60; }
        f.render(dt, accumulator * 60);
        return dt;
      };
      const bones = ['handl', 'handr', 'hips', 'head'].map(n => f.character.mesh.getObjectByName(n));
      assert.ok(bones.every(Boolean), 'Test must track the shipped hand/hips/head bones');
      const pose = () => {
        f.character.mesh.updateMatrixWorld(true);
        return bones.map(b => b.getWorldPosition(new THREE.Vector3()));
      };
      for (const entering of [true, false]) {
        let lastPosition = f.character.mesh.position.clone(), lastBones = pose();
        let junctionMinSpeed = Infinity, lastWasTransition = false, joinStep = 0, maxHandSpeed = 0;
        let previousCamera = f.camera.position.clone(), startCameraStep = 0;
        f.pressE();
        for (let i = 0; i < 150; i++) {
          const t = f.manager.transition;
          const dt = render();
          const bonePositions = pose();
          const speed = f.character.mesh.position.distanceTo(lastPosition) / dt;
          maxHandSpeed = Math.max(maxHandSpeed, ...bonePositions.slice(0, 2).map((p, n) => p.distanceTo(lastBones[n]) / dt));
          if (entering && t && Math.abs(t.elapsed - t.approach) < 0.04) junctionMinSpeed = Math.min(junctionMinSpeed, speed);
          if (i === 0) startCameraStep = previousCamera.distanceTo(f.camera.position);
          if (lastWasTransition && !f.manager.isTransitioning) {
            joinStep = Math.max(...bonePositions.map((p, n) => p.distanceTo(lastBones[n])));
            assert.ok(joinStep < dt * 4 + 0.015, 'Last animation frame must join seated/walking pose without a bone jump');
          }
          lastWasTransition = f.manager.isTransitioning;
          lastPosition.copy(f.character.mesh.position); lastBones = bonePositions;
          previousCamera.copy(f.camera.position);
          if (i > 60 && !f.manager.isTransitioning) break;
        }
        if (entering) assert.ok(junctionMinSpeed > 1, `Unexpected stop at door: ${junctionMinSpeed}m/s`);
        assert.ok(startCameraStep < 0.25, `Camera swings on mode change: ${startCameraStep}m`);
        // At 60 Hz this permits 25 cm of combined root/arm motion, but rejects
        // the 45–69 cm single-frame flips produced by the old absolute IK rotation.
        assert.ok(maxHandSpeed < 15, `${vehicleName} ${entering ? 'entry' : 'exit'} ${intervals}: hand pose snaps at ${maxHandSpeed}m/s`);
        assert.equal(f.manager.isDriving, entering);
        results.push({ vehicleName, fps: intervals.length > 1 ? 'variable' : Math.round(1 / intervals[0]),
          phase: entering ? 'entry' : 'exit', doorMinSpeed: entering ? +junctionMinSpeed.toFixed(2) : undefined,
          joinStep: +joinStep.toFixed(3), maxHandSpeed: +maxHandSpeed.toFixed(2) });
      }
      f.physics.world.free();
    }
  }

  // Held inputs must take effect when an exit completes, including a moving vehicle.
  const moving = await fixture(MOTO_SPEC);
  moving.pressE(); moving.finish();
  moving.held.add('KeyW');
  for (let i = 0; i < 120; i++) moving.step();
  moving.pressE(); moving.finish(); moving.step();
  assert.equal(moving.controller.state, 'walk');
  assert.ok(moving.character.collider.isEnabled() && !moving.character.isRiding);
  moving.physics.world.free();
  console.table(results);
  console.log('PASS: 60 Hz physics with 30/60/120/variable render rates, nonzero door velocity, hand blending, final-pose continuity, camera continuity, held-input handoff');
})().catch(error => { console.error(error); process.exitCode = 1; });
