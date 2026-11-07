import * as THREE from 'three';
import type { RAPIER } from '../core/Physics';
import type { DriveInput } from './Vehicle';

/** Assisted helicopter flight: forces and torques act on the actual hull.
 * Cyclic tilts the rotor axis; collective changes climb rate with inertia.
 * The attitude controller damps rotation without overwriting collision response. */
export class HelicopterFlight {
  rotorSpeed = 0;
  climbCommand = 0;
  private heading = 0;
  private pitch = 0;
  private roll = 0;
  private collective = 0;
  private powered = false;
  private readonly orientation = new THREE.Quaternion();
  private readonly inverse = new THREE.Quaternion();
  private readonly target = new THREE.Quaternion();
  private readonly error = new THREE.Quaternion();
  private readonly angles = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly up = new THREE.Vector3();
  private readonly force = new THREE.Vector3();
  private readonly torque = new THREE.Vector3();

  fixedUpdate(dt: number, body: RAPIER.RigidBody, drive: DriveInput, powered: boolean, gravity: number): void {
    const r = body.rotation(), v = body.linvel(), w = body.angvel();
    this.orientation.set(r.x, r.y, r.z, r.w);
    this.angles.setFromQuaternion(this.orientation);
    if (powered && !this.powered) { this.heading = this.angles.y; this.pitch = this.angles.x; this.roll = this.angles.z; }
    this.powered = powered;
    this.rotorSpeed += ((powered ? 1 : 0) - this.rotorSpeed) * (1 - Math.exp(-(powered ? 2.4 : .6) * dt));
    const climbTarget = powered ? (drive.lift ?? 0) * 4.5 : 0;
    this.climbCommand += THREE.MathUtils.clamp(climbTarget - this.climbCommand, -2.6 * dt, 2.6 * dt);
    const forwardSpeed = Math.hypot(v.x, v.z);
    const desiredPitch = powered ? drive.throttle * .36 : 0;
    const desiredRoll = powered ? -drive.steer * .32 * Math.min(1, .15 + forwardSpeed / 12) : 0;
    const smooth = 1 - Math.exp(-3 * dt);
    this.pitch += (desiredPitch - this.pitch) * smooth;
    this.roll += (desiredRoll - this.roll) * smooth;
    if (powered) this.heading += drive.steer * .78 * this.rotorSpeed * dt;
    this.target.setFromEuler(this.angles.set(this.pitch, this.heading, this.roll, 'YXZ'));

    this.up.set(0, 1, 0).applyQuaternion(this.orientation);
    const compensation = 1 / Math.max(.65, this.up.y);
    const verticalAcceleration = THREE.MathUtils.clamp((this.climbCommand - v.y) * 1.5, -3.6, 4);
    const thrust = powered ? (gravity + verticalAcceleration) * compensation * this.rotorSpeed ** 2 : 0;
    this.collective += (thrust - this.collective) * (1 - Math.exp(-4 * dt));
    const mass = body.mass();
    this.force.copy(this.up).multiplyScalar(this.collective);
    this.force.x -= v.x * .22; this.force.z -= v.z * .22; this.force.y -= v.y * .12;
    this.force.multiplyScalar(mass * dt); body.applyImpulse(this.force, powered);

    if (powered) {
      this.inverse.copy(this.orientation).invert();
      this.error.copy(this.target).multiply(this.inverse);
      const sign = this.error.w < 0 ? -1 : 1;
      this.torque.set(this.error.x * 36 * sign - w.x * 7, this.error.y * 36 * sign - w.y * 7, this.error.z * 36 * sign - w.z * 7);
      // Angular acceleration -> local principal inertia -> world torque impulse.
      this.torque.applyQuaternion(this.inverse);
      const inertia = body.principalInertia();
      this.torque.set(this.torque.x * inertia.x, this.torque.y * inertia.y, this.torque.z * inertia.z);
      this.torque.applyQuaternion(this.orientation).multiplyScalar(dt);
      body.applyTorqueImpulse(this.torque, true);
    }
  }
}
