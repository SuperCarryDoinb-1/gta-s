import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Character } from '../entities/Character';
import type { Vehicle } from '../entities/Vehicle';
import type { TrafficSystem } from '../entities/Traffic';
import type { CameraRig } from '../entities/CameraRig';
import type { CharacterController } from './CharacterController';
import type { WantedSystem, PoliceTakeover } from './Wanted';
import type { ChunkManager } from '../world/ChunkManager';
import type { CarType } from '../core/Loader';
import { wrapAngle } from '../core/MathUtil';

const ENTER_RANGE = 3; // 可上车距离（米）
const EJECT_IMPACT = 9; // 摩托一步内前向速度骤降超过此值（m/s）→ 甩出骑手

interface VehicleTransition {
  entering: boolean;
  vehicle: Vehicle;
  elapsed: number;
  duration: number;
  approach: number;
  from: THREE.Vector3;
  target: THREE.Vector3;
  fromRotation: THREE.Quaternion;
  toRotation: THREE.Quaternion;
  yaw: number;
  path: THREE.CatmullRomCurve3 | null;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const SEAT_FACE = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, Math.PI);
const RIDER_FACE = SEAT_FACE.clone().multiply(
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5),
);

const smooth = (t: number): number => {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 玩家模式管理：步行 ⇄ 驾驶（多辆自有载具 + 可抢任意 AI 车）。
 * - update（每帧）：近距检测 + E 键上下车 + 摩托撞击甩人。
 * - fixedUpdate（每物理步）：输入给当前驾驶载具，其余载具停车模拟（悬挂+手刹）。
 */
export class PlayerManager {
  private readonly character: Character;
  private readonly controller: CharacterController;
  private readonly vehicles: Vehicle[];
  private readonly traffic: TrafficSystem;
  private readonly cameraRig: CameraRig;
  private readonly input: Input;

  private active = -1; // 驾驶中的载具索引，-1 = 步行
  private near = false;
  private nearPolice = false;
  private takeover: PoliceTakeover | null = null;
  private transition: VehicleTransition | null = null;
  private wanted: WantedSystem | null = null;
  private chunks: ChunkManager | null = null;
  private createVehicle: ((x: number, y: number, z: number, yaw: number, type: CarType) => Vehicle) | null = null;

  connectWorldVehicles(wanted: WantedSystem, chunks: ChunkManager, create: (x: number, y: number, z: number, yaw: number, type: CarType) => Vehicle): void {
    this.wanted = wanted; this.chunks = chunks; this.createVehicle = create;
  }

  get isCarjacking(): boolean { return this.takeover !== null; }
  get isTransitioning(): boolean { return this.transition !== null; }

  private claim(data: { x: number; y: number; z: number; yaw: number; type: CarType }): void {
    const car = this.createVehicle!(data.x, data.y, data.z, data.yaw, data.type);
    this.vehicles.push(car);
    this.enterVehicle(this.vehicles.length - 1);
    this.controller.reset(); this.onCarjack?.();
  }

  /** 抢 AI 车上报（通缉系统挂钩） */
  onCarjack: (() => void) | null = null;
  /** 摩托重撞甩人上报（生命值系统挂钩） */
  onEjected: (() => void) | null = null;

  private readonly charPos = new THREE.Vector3();
  private readonly vehPos = new THREE.Vector3();
  private readonly vehQuat = new THREE.Quaternion();
  private readonly exitPos = new THREE.Vector3();
  private readonly exitCandidate = new THREE.Vector3();
  private readonly groundProbe = new THREE.Vector3(0, -0.04, 0);
  private readonly transitionPos = new THREE.Vector3();
  private readonly transitionQuat = new THREE.Quaternion();
  private readonly vehicleFrame = new THREE.Quaternion();
  private readonly leanRotation = new THREE.Quaternion();
  private readonly barLeft = new THREE.Vector3();
  private readonly barRight = new THREE.Vector3();
  private seatSide = 1;

  constructor(
    character: Character,
    controller: CharacterController,
    vehicles: Vehicle[],
    traffic: TrafficSystem,
    cameraRig: CameraRig,
    input: Input,
  ) {
    this.character = character;
    this.controller = controller;
    this.vehicles = vehicles;
    this.traffic = traffic;
    this.cameraRig = cameraRig;
    this.input = input;
  }

  /** 当前驾驶载具（未驾驶时返回主车，供 HUD/音频取速度） */
  get activeVehicle(): Vehicle {
    return this.vehicles[Math.max(0, this.active)]!;
  }

  /** 每帧调用（E 是边沿触发，必须每帧只查一次） */
  update(dt = 1 / 60): void {
    if (this.transition) {
      const t = this.transition;
      t.elapsed = Math.min(t.duration, t.elapsed + dt);
      if (t.entering && t.elapsed >= t.approach) {
        this.character.setVehiclePose('sit', (t.elapsed - t.approach) / (t.duration - t.approach));
      } else if (!t.entering) {
        this.character.setVehiclePose('stand', t.elapsed / t.duration);
      }
      return;
    }
    if (this.takeover) {
      if (this.takeover.update(dt)) {
        const taken = this.takeover; this.takeover = null;
        this.character.setActive(true); this.claim(taken);
      }
      return;
    }
    this.character.getPosition(this.charPos);

    // 摩托更脆：迎面重撞 → 骑手被甩出去
    if (this.active >= 0) {
      const v = this.vehicles[this.active]!;
      if (v.spec.fragile && v.impactDv > EJECT_IMPACT) {
        const yaw = v.visualHeadingYaw;
        const throwSpeed = 5 + v.impactDv * 0.6;
        this.exitVehicle(true);
        this.controller.knock(Math.sin(yaw) * throwSpeed, Math.cos(yaw) * throwSpeed, 5.5);
        this.onEjected?.();
        return;
      }
      // The character body stays at its entry point while driving; proximity queries
      // there are both stale and unnecessary until the player gets out.
      this.near = this.nearPolice = false;
      if (this.input.wasPressed('KeyE')) this.exitVehicle();
      return;
    }

    // 最近的自有载具
    let bestVeh = -1;
    let bestDist = ENTER_RANGE;
    for (let i = 0; i < this.vehicles.length; i++) {
      if (this.vehicles[i]!.stashed) continue; // 剧情未解锁的载具不可交互
      this.vehicles[i]!.getPosition(this.vehPos);
      const d = this.charPos.distanceTo(this.vehPos);
      if (d < bestDist) {
        bestDist = d;
        bestVeh = i;
      }
    }
    const aiIndex = this.traffic.findNearest(this.charPos, ENTER_RANGE);
    const distAI = aiIndex >= 0 ? this.traffic.distanceTo(aiIndex, this.charPos) : Infinity;
    const police = this.wanted?.nearestCar(this.charPos, ENTER_RANGE);
    const parked = this.chunks?.nearestParked(this.charPos, ENTER_RANGE);
    const distParked = parked ? Math.hypot(parked.x - this.charPos.x, parked.z - this.charPos.z) : Infinity;
    const distPolice = police?.distance ?? Infinity;
    this.nearPolice = !!police && distPolice <= Math.min(bestDist, distAI, distParked);
    this.near = this.active < 0 && (bestVeh >= 0 || aiIndex >= 0 || !!police || !!parked);

    if (this.input.wasPressed('KeyE')) {
      if (this.nearPolice && police) {
        this.takeover = this.wanted!.beginTakeover(police.index, this.character);
        if (this.takeover) { this.controller.reset(); this.character.collider.setEnabled(false); }
      } else if (parked && distParked < Math.min(bestDist, distAI)) {
        if (parked.take()) this.claim(parked);
      } else if (bestVeh >= 0 && bestDist <= distAI) {
        this.enterVehicle(bestVeh);
      } else if (aiIndex >= 0) {
        // 抢 AI 车：主车（轿车）瞬移换装成那辆车，原地留下停放车。
        // 主车还在剧情暂存里（借壳复活的第一次）：玩家没有旧车可留，不放车壳
        const car = this.vehicles[0]!;
        const wasStashed = car.stashed;
        car.setStashed(false);
        car.getPosition(this.vehPos);
        const taken = this.traffic.swapWithPlayer(
          aiIndex,
          this.vehPos.x,
          this.vehPos.z,
          car.visualHeadingYaw,
          car.carType,
          !wasStashed,
        );
        car.teleportTo(taken.x, taken.z, taken.yaw, -car.spec.groundOffset);
        car.setCarType(taken.type);
        this.enterVehicle(0);
        this.onCarjack?.();
      }
    }
  }

  fixedUpdate(dt: number): void {
    if (this.active < 0 && !this.takeover) this.controller.fixedUpdate(dt);
    for (let i = 0; i < this.vehicles.length; i++) {
      if (i === this.active && !this.transition) {
        this.vehicles[i]!.fixedUpdate(dt, {
          throttle: (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0),
          steer: (this.input.isDown('KeyA') ? 1 : 0) - (this.input.isDown('KeyD') ? 1 : 0),
          brake: this.input.isDown('Space'),
          piloted: true,
          lift: (this.input.isDown('Space') ? 1 : 0) - (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') ? 1 : 0),
        });
      } else if (!this.vehicles[i]!.stashed) {
        // 停车状态：悬挂照常模拟 + 手刹
        this.vehicles[i]!.fixedUpdate(dt, { throttle: 0, steer: 0, brake: true });
      }
    }
  }

  /** 相机跟随目标（步行=角色，驾驶=车），用插值后的视觉位置防抖 */
  getCameraTarget(out: THREE.Vector3): THREE.Vector3 {
    if (this.transition) {
      const t = this.transition;
      const seated = t.entering ? smooth(t.elapsed / t.duration) : 1 - smooth(t.elapsed / t.duration);
      this.character.getVisualPosition(out);
      return out.lerp(t.vehicle.mesh.position, seated);
    }
    return this.active >= 0
      ? this.vehicles[this.active]!.getVisualPosition(out)
      : this.character.getVisualPosition(out);
  }

  get isDriving(): boolean {
    return this.active >= 0;
  }

  /** HUD 交互提示 */
  get hint(): string {
    if (this.transition) return this.transition.entering ? '正在上车' : '正在下车';
    if (this.takeover) return this.takeover.occupants ? '正在将警员拉下车…清空座舱后驾驶' : '正在进入警车…';
    if (this.active >= 0) return this.activeVehicle.spec.flying ? '直升机 · W/S 俯仰 · A/D 转弯 · 空格爬升 · Shift 下降 · E 下机' : '按 E 下车';
    if (this.nearPolice) return '按 E 夺取警车';
    return this.near ? '按 E 上车' : '';
  }

  /** 强制下车（死亡复活用），未驾驶时无操作 */
  forceExit(): void {
    this.transition = null;
    this.character.setVehiclePose(null);
    if (this.takeover) { this.takeover.cancel(); this.takeover = null; this.character.setActive(true); this.controller.reset(); }
    if (this.active >= 0) this.exitVehicle(true);
  }

  /** 正在骑的敞座载具（摩托等，骑手可见需外部贴装），否则 null */
  get ridingVehicle(): Vehicle | null {
    if (this.active < 0 || this.transition) return null;
    const v = this.vehicles[this.active]!;
    return v.spec.lean ? v : null;
  }

  private enterVehicle(index: number): void {
    this.active = index;
    this.near = this.nearPolice = false;
    this.controller.reset();
    // 敞座载具（摩托）：人可见坐上去；封闭座舱：人隐藏
    const vehicle = this.vehicles[index]!;
    this.getVehicleFrame(vehicle);
    const from = this.character.mesh.position.clone().sub(vehicle.mesh.position)
      .applyQuaternion(this.vehQuat.copy(this.vehicleFrame).invert());
    const side = from.x < 0 ? -1 : 1;
    this.seatSide = side;
    const door = new THREE.Vector3(side * (vehicle.spec.half.x + 0.45), from.y, 0.25);
    const approach = THREE.MathUtils.clamp(from.distanceTo(door) / 5, 0.16, 0.4);
    const seat = this.seatPosition(vehicle, side);
    const path = new THREE.CatmullRomCurve3([from, door, seat], false, 'centripetal');
    path.updateArcLengths();
    this.transition = {
      entering: true, vehicle, elapsed: 0, duration: approach + 0.3, approach,
      from, target: new THREE.Vector3(), path,
      fromRotation: this.character.mesh.quaternion.clone().premultiply(this.vehQuat),
      toRotation: (vehicle.spec.lean ? RIDER_FACE : SEAT_FACE).clone(),
      yaw: 0,
    };
    this.character.setRiding(true);
    this.character.setVehiclePose('approach');
    this.cameraRig.setExcludeCollider(vehicle.chassisCollider);
  }

  private seatPosition(vehicle: Vehicle, side: number): THREE.Vector3 {
    return vehicle.spec.lean ? new THREE.Vector3(0, 0.33, 0.22) : new THREE.Vector3(side * 0.42, 0.33, 0.25);
  }

  /** Called after vehicle interpolation so the character and moving seat share one frame. */
  syncVisual(): void {
    const t = this.transition;
    if (!t) {
      if (this.active >= 0) this.placeSeated(this.vehicles[this.active]!);
      return;
    }
    const mesh = this.character.mesh;
    const progress = t.elapsed / t.duration;
    this.getVehicleFrame(t.vehicle);
    if (t.entering) {
      // One arc-length-parametrized path: no braking to zero at the door waypoint.
      t.path!.getPointAt(smooth(progress), this.transitionPos);
      mesh.position.copy(this.transitionPos).applyQuaternion(this.vehicleFrame).add(t.vehicle.mesh.position);
      this.transitionQuat.slerpQuaternions(t.fromRotation, t.toRotation, smooth(progress));
      mesh.quaternion.copy(this.vehicleFrame).multiply(this.transitionQuat);
    } else {
      // Keep the source attached to the interpolated vehicle while releasing it.
      this.transitionPos.copy(t.from).applyQuaternion(this.vehicleFrame).add(t.vehicle.mesh.position);
      mesh.position.lerpVectors(this.transitionPos, t.target, smooth(progress));
      mesh.quaternion.copy(this.vehicleFrame).multiply(t.fromRotation).slerp(t.toRotation, smooth(progress));
    }
    if (t.vehicle.spec.lean) {
      this.gripHandlebars(t.vehicle, t.entering ? smooth((progress - 0.5) / 0.5) : 1 - smooth(progress / 0.7));
    }
    // Evaluate the final pose and position before handing ownership to physics or
    // the seated rig. Completing in update() skipped this frame of the animation.
    if (t.elapsed >= t.duration) {
      this.transition = null;
      this.character.setVehiclePose(null);
      if (t.entering) {
        this.character.setRiding(true);
        if (!t.vehicle.spec.lean) this.character.setActive(false);
      } else if (this.character.resolveExitPosition(t.target, this.exitPos)) {
        this.finishExit(this.exitPos, t.yaw);
      } else {
        this.exitVehicle(true);
      }
    }
  }

  private getVehicleFrame(vehicle: Vehicle): void {
    this.vehicleFrame.copy(vehicle.mesh.quaternion);
    if (vehicle.spec.lean) this.vehicleFrame.multiply(this.leanRotation.setFromAxisAngle(Z_AXIS, vehicle.visualLean));
  }

  private placeSeated(vehicle: Vehicle): void {
    this.getVehicleFrame(vehicle);
    this.character.mesh.position.set(vehicle.spec.lean ? 0 : this.seatSide * 0.42, 0.33, vehicle.spec.lean ? 0.22 : 0.25)
      .applyQuaternion(this.vehicleFrame).add(vehicle.mesh.position);
    this.character.mesh.quaternion.copy(this.vehicleFrame).multiply(vehicle.spec.lean ? RIDER_FACE : SEAT_FACE);
    if (vehicle.spec.lean) this.gripHandlebars(vehicle, 1);
  }

  private gripHandlebars(vehicle: Vehicle, weight: number): void {
    this.barLeft.set(-0.16, 0.85, 0.4).applyQuaternion(this.vehicleFrame).add(vehicle.mesh.position);
    this.barRight.set(0.16, 0.85, 0.4).applyQuaternion(this.vehicleFrame).add(vehicle.mesh.position);
    this.character.aimArmsAt(this.barLeft, this.barRight, weight);
  }

  private exitVehicle(forced = false): void {
    const v = this.vehicles[this.active]!;
    v.getPosition(this.vehPos);
    // Use horizontal heading even when the vehicle is leaning or overturned.
    const q = v.chassisBody.rotation();
    const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
    this.vehQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading);
    let clear = false;
    for (const gap of [0.7, 1.2, 2]) {
      for (let side = 0; side < 4; side++) {
        this.exitCandidate.set(
          side < 2 ? (v.spec.half.x + gap) * (side === 0 ? 1 : -1) : 0,
          0.3,
          side >= 2 ? (v.spec.half.z + gap) * (side === 2 ? -1 : 1) : 0,
        ).applyQuaternion(this.vehQuat).add(this.vehPos);
        if (this.character.resolveExitPosition(this.exitCandidate, this.exitPos)) {
          clear = true;
          break;
        }
      }
      if (clear) break;
    }
    if (!clear) {
      if (!forced) return;
      // Death/ejection must still release control if all surrounding exits are blocked.
      this.exitPos.copy(this.vehPos);
      this.exitPos.y += Math.hypot(v.spec.half.x, v.spec.half.y, v.spec.half.z) + 1;
    }
    const yaw = wrapAngle(heading + Math.PI);
    if (!forced) {
      this.getVehicleFrame(v);
      const inverseFrame = this.vehicleFrame.clone().invert();
      const from = this.character.mesh.position.clone().sub(v.mesh.position).applyQuaternion(inverseFrame);
      const fromRotation = this.character.mesh.quaternion.clone().premultiply(inverseFrame);
      this.transition = {
        entering: false, vehicle: v, elapsed: 0, duration: 0.38, approach: 0,
        from, target: this.exitPos.clone(), fromRotation, path: null,
        toRotation: new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), yaw,
      };
      this.character.setRiding(true);
      this.character.setVehiclePose('stand', 0);
      this.syncVisual();
      return;
    }
    this.finishExit(this.exitPos, yaw);
  }

  private finishExit(position: THREE.Vector3, yaw: number): void {
    this.character.setVehiclePose(null);
    this.character.setRiding(false);
    this.character.teleport(position);
    this.character.resetOrientation(yaw);
    this.character.setActive(true);
    this.character.moveBy(this.groundProbe);
    this.controller.reset();
    this.active = -1;
    this.cameraRig.setExcludeCollider(this.character.collider);
  }
}
