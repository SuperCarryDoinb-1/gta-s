import { RAPIER } from '../core/Physics';
import { wrapAngle } from '../core/MathUtil';

/** Road AI supplies steering; Rapier owns position and collision response. */
export function roadCarBody(): RAPIER.RigidBodyDesc {
  return RAPIER.RigidBodyDesc.dynamic()
    .enabledTranslations(true, false, true)
    .enabledRotations(false, true, false)
    .setGravityScale(0)
    .setCcdEnabled(true)
    .setSoftCcdPrediction(1.2)
    .setAdditionalSolverIterations(4);
}

const impulse = { x: 0, y: 0, z: 0 };
const angular = { x: 0, y: 0, z: 0 };

export function driveRoadCar(
  body: RAPIER.RigidBody, targetX: number, targetZ: number,
  targetYaw: number, maxSpeed: number, dt: number,
): void {
  const position = body.translation();
  const velocity = body.linvel();
  let vx = (targetX - position.x) / dt;
  let vz = (targetZ - position.z) / dt;
  const scale = Math.min(1, maxSpeed / Math.max(Math.hypot(vx, vz), 0.001));
  vx *= scale;
  vz *= scale;
  // Bounded traction prevents AI from injecting unlimited force into a jam.
  const dx = vx - velocity.x, dz = vz - velocity.z;
  const gain = Math.min(1, 6 * dt / Math.max(Math.hypot(dx, dz), 0.001));
  impulse.x = dx * gain * body.mass();
  impulse.z = dz * gain * body.mass();
  body.applyImpulse(impulse, true);
  const q = body.rotation();
  const yaw = Math.atan2(2 * q.w * q.y, 1 - 2 * q.y * q.y);
  angular.y = Math.max(-1.8, Math.min(1.8, wrapAngle(targetYaw - yaw) * 5));
  body.setAngvel(angular, true);
}
