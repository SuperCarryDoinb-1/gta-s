import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { CITY_MIN_BLOCK_X, PITCH, DIR_X, DIR_Z, LANE_X, LANE_Z, snapToRoad, advanceOnRoad } from '../world/City';
import { CarLibrary, TRAFFIC_TYPES, type CarType } from '../core/Loader';
import { wrapAngle } from '../core/MathUtil';

const CAR_COUNT = 6;
const CRUISE = 8; // m/s
const TURN_CHANCE = 0.35;

/** 跨路口时按概率随机左/右转（否则直行） */
function randomTurn(dir: number): number {
  return Math.random() < TURN_CHANCE ? (dir + (Math.random() < 0.5 ? 1 : 3)) % 4 : dir;
}
const RESPAWN_DIST = 170;
const SPAWN_MIN = 50;
const SPAWN_MAX = 130;
const BRAKE_DIST = 7; // 前方障碍刹停距离

// AI 车灯共享材质（夜里 setNight 提亮）
const TRAFFIC_HEAD_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff2cc,
  emissive: 0xfff2cc,
  emissiveIntensity: 0.3,
});
const TRAFFIC_TAIL_MAT = new THREE.MeshStandardMaterial({
  color: 0x7a1414,
  emissive: 0xff2222,
  emissiveIntensity: 0.2,
});

interface AICar {
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  group: THREE.Group;
  model: THREE.Group;
  type: CarType;
  dir: number;
  speed: number;
  /** 停放状态（玩家换车留下的旧车）：不巡航不转向 */
  parked: boolean;
  readonly prevPos: THREE.Vector3;
  readonly currPos: THREE.Vector3;
  prevYaw: number;
  currYaw: number;
}

/**
 * 环境交通：固定池 AI 车沿路网右侧车道巡航，路口概率转向，
 * 前方有玩家/玩家车/同类时刹停。kinematic 刚体（能撞飞行人、挡住玩家）。
 * 远离玩家即回收重生，城市区外不生成。
 */
export class TrafficSystem {
  private readonly cars: AICar[] = [];
  private carLib!: CarLibrary;
  private readonly physics: Physics;
  private readonly scratchSpawn = new THREE.Vector3();

  constructor(scene: THREE.Scene, physics: Physics, playerPos: THREE.Vector3, carLib: CarLibrary) {
    this.carLib = carLib;
    this.physics = physics;
    for (let i = 0; i < CAR_COUNT; i++) {
      const type = TRAFFIC_TYPES[i % TRAFFIC_TYPES.length]!;
      const model = carLib.clone(type, false);
      const group = new THREE.Group();
      const lightGeo = new THREE.BoxGeometry(0.3, 0.12, 0.06);
      const hl = new THREE.Mesh(lightGeo, TRAFFIC_HEAD_MAT);
      hl.position.set(0.55, 0.74, 2.26);
      const hr = hl.clone();
      hr.position.x = -0.55;
      const tl = new THREE.Mesh(lightGeo, TRAFFIC_TAIL_MAT);
      tl.position.set(0.55, 0.74, -2.26);
      const tr = tl.clone();
      tr.position.x = -0.55;
      group.add(model, hl, hr, tl, tr);
      this.attachLights(model);
      for (const lamp of [hl, hr, tl, tr]) lamp.visible = false;
      scene.add(group);

      const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());

      const car: AICar = {
        body,
        colliders: [],
        group,
        model,
        type,
        dir: 0,
        speed: CRUISE,
        parked: false,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevYaw: 0,
        currYaw: 0,
      };
      this.applyCollider(car);
      this.respawn(car, playerPos);
      this.cars.push(car);
    }
  }

  /**
   * 按当前车型挂实测双盒碰撞（换车留壳/剧情换货车时重挂）：
   * 车身盒+座舱盒尺寸来自该车型模型顶点实测，人站上去就在真实车顶平面。
   */
  private applyCollider(car: AICar): void {
    for (const c of car.colliders) this.physics.world.removeCollider(c, false);
    car.colliders.length = 0;
    const spec = this.carLib.colliderBoxes(car.type);
    for (const b of [spec.body, spec.cabin]) {
      if (!b) continue;
      car.colliders.push(
        this.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(0, b.cy, b.cz),
          car.body,
        ),
      );
    }
  }

  /** 每物理步调用（physics.step 之前） */
  fixedUpdate(dt: number, playerPos: THREE.Vector3, playerCarPos: THREE.Vector3): void {
    for (const car of this.cars) {
      car.prevPos.copy(car.currPos);
      car.prevYaw = car.currYaw;

      const dxp = car.currPos.x - playerPos.x;
      const dzp = car.currPos.z - playerPos.z;
      if (dxp * dxp + dzp * dzp > RESPAWN_DIST * RESPAWN_DIST) {
        car.parked = false;
        this.respawn(car, playerPos);
        continue;
      }
      if (car.parked) continue; // 停放车原地不动

      // 前方障碍检测（玩家、玩家车、其他 AI 车）→ 刹车
      const fx = DIR_X[car.dir]!;
      const fz = DIR_Z[car.dir]!;
      let blocked = this.isAhead(car, fx, fz, playerPos) || this.isAhead(car, fx, fz, playerCarPos);
      if (!blocked) {
        for (const other of this.cars) {
          if (other !== car && this.isAhead(car, fx, fz, other.currPos)) {
            blocked = true;
            break;
          }
        }
      }
      const targetSpeed = blocked ? 0 : CRUISE;
      car.speed += (targetSpeed - car.speed) * (1 - Math.exp(-4 * dt));

      car.currYaw = advanceOnRoad(car, car.speed, dt, randomTurn);
      car.body.setNextKinematicTranslation({ x: car.currPos.x, y: 0, z: car.currPos.z });
      car.body.setNextKinematicRotation(
        { x: 0, y: Math.sin(car.currYaw / 2), z: 0, w: Math.cos(car.currYaw / 2) },
      );
    }
  }

  /** 最近可上车：返回索引，无则 -1 */
  findNearest(pos: THREE.Vector3, maxDist: number): number {
    let best = -1;
    let bestD = maxDist * maxDist;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      const d = (c.currPos.x - pos.x) ** 2 + (c.currPos.z - pos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  distanceTo(index: number, pos: THREE.Vector3): number {
    const c = this.cars[index]!;
    return Math.hypot(c.currPos.x - pos.x, c.currPos.z - pos.z);
  }

  /**
   * 换车交换：AI 车 i 的位姿/车型给玩家载具用，AI 车原地变成玩家留下的旧车（停放）。
   * 返回 AI 车原本的 {x, z, yaw, type}。
   * leaveShell=false（主车从剧情暂存里"借壳复活"的第一次抢车）：玩家并没有留下旧车，
   * 不放车壳、AI 车直接易地重生——否则壳会凭空出现在出生路口，还可能与新车重叠卡死。
   */
  swapWithPlayer(
    index: number,
    oldX: number,
    oldZ: number,
    oldYaw: number,
    oldType: CarType,
    leaveShell = true,
  ): { x: number; z: number; yaw: number; type: CarType } {
    const car = this.cars[index]!;
    const taken = { x: car.currPos.x, z: car.currPos.z, yaw: car.currYaw, type: car.type };

    if (!leaveShell) {
      this.respawn(car, this.scratchSpawn.set(taken.x, 0, taken.z));
      return taken;
    }

    car.currPos.set(oldX, 0, oldZ);
    car.prevPos.copy(car.currPos);
    car.currYaw = oldYaw;
    car.prevYaw = oldYaw;
    this.setCarModel(car, oldType);
    car.parked = true;
    car.speed = 0;
    car.body.setTranslation({ x: oldX, y: 0, z: oldZ }, false);
    car.body.setRotation({ x: 0, y: Math.sin(oldYaw / 2), z: 0, w: Math.cos(oldYaw / 2) }, false);
    car.group.position.copy(car.currPos);
    car.group.rotation.y = oldYaw;
    return taken;
  }

  /** 遍历所有 AI 车位置（小地图用） */
  forEachCar(cb: (x: number, z: number) => void): void {
    for (const car of this.cars) cb(car.currPos.x, car.currPos.z);
  }

  /** 剧情：把一辆在跑的 AI 车换装成帮派面包车,返回索引（追逐任务目标） */
  markCourier(playerPos: THREE.Vector3): number {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      if (c.parked) continue;
      const d = (c.currPos.x - playerPos.x) ** 2 + (c.currPos.z - playerPos.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    this.setCarModel(this.cars[best]!, 'delivery');
    return best;
  }

  /** 换装 AI 车模型并重挂碰撞体 */
  private setCarModel(car: AICar, type: CarType): void {
    car.type = type;
    car.group.remove(car.model);
    car.model = this.carLib.clone(type, false);
    car.group.add(car.model);
    this.attachLights(car.model);
    for (const child of car.group.children) {
      if (child instanceof THREE.Mesh) child.visible = type === 'police';
    }
    this.applyCollider(car);
  }

  private attachLights(model: THREE.Group): void {
    for (const name of ['lights', 'leds', 'lights_red']) {
      const lamp = model.getObjectByName(name);
      if (lamp instanceof THREE.Mesh) lamp.material = name === 'lights_red' ? TRAFFIC_TAIL_MAT : TRAFFIC_HEAD_MAT;
    }
  }

  /** 剧情：查询某车位置（写入 outPos）与当前速度 */
  courierState(index: number, outPos: THREE.Vector3): number {
    const c = this.cars[index]!;
    outPos.set(c.currPos.x, 0, c.currPos.z);
    return c.parked ? 0 : c.speed;
  }

  /** 夜色联动：车灯提亮 */
  setNight(n: number): void {
    TRAFFIC_HEAD_MAT.emissiveIntensity = 0.3 + 2.4 * n;
    TRAFFIC_TAIL_MAT.emissiveIntensity = 0.2 + 1.6 * n;
  }

  /** 渲染前插值 */
  syncVisual(alpha: number): void {
    for (const car of this.cars) {
      car.group.position.lerpVectors(car.prevPos, car.currPos, alpha);
      car.group.rotation.y = car.prevYaw + wrapAngle(car.currYaw - car.prevYaw) * alpha;
    }
  }

  private isAhead(car: AICar, fx: number, fz: number, target: THREE.Vector3): boolean {
    const dx = target.x - car.currPos.x;
    const dz = target.z - car.currPos.z;
    const forward = dx * fx + dz * fz;
    if (forward < 1 || forward > BRAKE_DIST) return false;
    const side = Math.abs(dx * fz - dz * fx);
    return side < 2.2;
  }

  private respawn(car: AICar, playerPos: THREE.Vector3): void {
    car.dir = Math.floor(Math.random() * 4);
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const px = playerPos.x + Math.cos(angle) * dist;
    const pz = playerPos.z + Math.sin(angle) * dist;
    if (car.dir % 2 === 0) {
      car.currPos.set(Math.max(snapToRoad(px), CITY_MIN_BLOCK_X + PITCH / 2) + LANE_X[car.dir]!, 0, pz);
    } else {
      car.currPos.set(Math.max(px, CITY_MIN_BLOCK_X), 0, snapToRoad(pz) + LANE_Z[car.dir]!);
    }
    car.speed = CRUISE;
    car.currYaw = Math.atan2(DIR_X[car.dir]!, DIR_Z[car.dir]!);
    car.prevPos.copy(car.currPos);
    car.prevYaw = car.currYaw;
    car.body.setTranslation({ x: car.currPos.x, y: 0, z: car.currPos.z }, false);
  }
}
