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

const ENTER_RANGE = 3; // 可上车距离（米）
const EXIT_OFFSET = new THREE.Vector3(2.0, 0.3, 0); // 车局部 +X = 左侧车门
const EJECT_IMPACT = 9; // 摩托一步内前向速度骤降超过此值（m/s）→ 甩出骑手

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
  private wanted: WantedSystem | null = null;
  private chunks: ChunkManager | null = null;
  private createVehicle: ((x: number, y: number, z: number, yaw: number, type: CarType) => Vehicle) | null = null;

  connectWorldVehicles(wanted: WantedSystem, chunks: ChunkManager, create: (x: number, y: number, z: number, yaw: number, type: CarType) => Vehicle): void {
    this.wanted = wanted; this.chunks = chunks; this.createVehicle = create;
  }

  get isCarjacking(): boolean { return this.takeover !== null; }

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
        this.exitVehicle();
        this.controller.knock(Math.sin(yaw) * throwSpeed, Math.cos(yaw) * throwSpeed, 5.5);
        this.onEjected?.();
        return;
      }
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
      if (this.active >= 0) {
        this.exitVehicle();
      } else if (this.nearPolice && police) {
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
        car.teleportTo(taken.x, taken.z, taken.yaw);
        car.setCarType(taken.type);
        this.enterVehicle(0);
        this.onCarjack?.();
      }
    }
  }

  fixedUpdate(dt: number): void {
    if (this.active < 0 && !this.takeover) this.controller.fixedUpdate(dt);
    for (let i = 0; i < this.vehicles.length; i++) {
      if (i === this.active) {
        this.vehicles[i]!.fixedUpdate(dt, {
          throttle: (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0),
          steer: (this.input.isDown('KeyA') ? 1 : 0) - (this.input.isDown('KeyD') ? 1 : 0),
          brake: this.input.isDown('Space'),
        });
      } else if (!this.vehicles[i]!.stashed) {
        // 停车状态：悬挂照常模拟 + 手刹
        this.vehicles[i]!.fixedUpdate(dt, { throttle: 0, steer: 0, brake: true });
      }
    }
  }

  /** 相机跟随目标（步行=角色，驾驶=车），用插值后的视觉位置防抖 */
  getCameraTarget(out: THREE.Vector3): THREE.Vector3 {
    return this.active >= 0
      ? this.vehicles[this.active]!.getVisualPosition(out)
      : this.character.getVisualPosition(out);
  }

  get isDriving(): boolean {
    return this.active >= 0;
  }

  /** HUD 交互提示 */
  get hint(): string {
    if (this.takeover) return this.takeover.occupants ? '正在将警员拉下车…清空座舱后驾驶' : '正在进入警车…';
    if (this.active >= 0) return '按 E 下车';
    if (this.nearPolice) return '按 E 夺取警车';
    return this.near ? '按 E 上车' : '';
  }

  /** 强制下车（死亡复活用），未驾驶时无操作 */
  forceExit(): void {
    if (this.takeover) { this.takeover.cancel(); this.takeover = null; this.character.setActive(true); this.controller.reset(); }
    if (this.active >= 0) this.exitVehicle();
  }

  /** 正在骑的敞座载具（摩托等，骑手可见需外部贴装），否则 null */
  get ridingVehicle(): Vehicle | null {
    if (this.active < 0) return null;
    const v = this.vehicles[this.active]!;
    return v.spec.lean ? v : null;
  }

  private enterVehicle(index: number): void {
    this.active = index;
    // 敞座载具（摩托）：人可见坐上去；封闭座舱：人隐藏
    if (this.vehicles[index]!.spec.lean) this.character.setRiding(true);
    else this.character.setActive(false);
    this.cameraRig.setExcludeCollider(this.vehicles[index]!.chassisCollider);
  }

  private exitVehicle(): void {
    const v = this.vehicles[this.active]!;
    v.getPosition(this.vehPos);
    v.getQuaternion(this.vehQuat);
    this.exitPos.copy(EXIT_OFFSET).applyQuaternion(this.vehQuat).add(this.vehPos);
    // 车侧翻/翻顶时"左侧车门"方向会转到地下,出口落点夹紧到车中心以上——
    // 否则人被传送进地基碰撞体内部,KCC 永远卡在地里
    this.exitPos.y = Math.max(this.exitPos.y, this.vehPos.y + 0.3);
    this.character.setRiding(false);
    this.character.teleport(this.exitPos);
    this.character.setActive(true);
    this.controller.reset();
    this.active = -1;
    this.cameraRig.setExcludeCollider(this.character.collider);
  }
}
