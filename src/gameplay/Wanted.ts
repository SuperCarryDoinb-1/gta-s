import * as THREE from 'three';
import { Physics, RAPIER, setVel, radialBlastImpulse } from '../core/Physics';
import { safeRoadX, roadAvailable } from '../world/ShanghaiLayout';
import {
  PITCH,
  CITY_MIN_BLOCK_X,
  HALF_ROAD,
  DIR_X,
  DIR_Z,
  LANE_X,
  LANE_Z,
  snapToRoad,
  advanceOnRoad,
} from '../world/City';
import { wrapAngle } from '../core/MathUtil';
import { driveRoadCar, roadCarBody } from '../entities/AICarPhysics';
import { playClip, placeSkinnedRoot } from '../core/CharacterAnim';
import { makeTracer } from './fx';
import { HealthBar3D } from '../ui/HealthBar3D';
import type { CarLibrary, PersonInstance, PersonLibrary } from '../core/Loader';
import type { GameAudio } from '../core/Audio';
import type { Pedestrians } from '../entities/Pedestrians';
import type { Vehicle } from '../entities/Vehicle';
import type { CharacterController } from './CharacterController';
import type { Character } from '../entities/Character';

export interface PoliceTakeover {
  x: number; y: number; z: number; yaw: number; type: 'police';
  update: (dt: number) => boolean;
  cancel: () => void;
  readonly occupants: number;
}

export type CrimeKind = 'gunshot' | 'explosion' | 'carjack' | 'pedhit' | 'cophit' | 'copkill';

const MAX_HEAT = 3.99; // 星级 = floor(heat)，上限 3 星
const COUNT_BY_STARS = [0, 2, 3, 4]; // 各星级出动的警车数
const CAR_POOL = 4;
const COP_POOL = 16;

// —— 通缉热度 ——
const SIGHT_CAR = 50; // 警车视距
const SIGHT_COP = 35; // 步行警察视距
const SIGHT_INTERVAL = 0.4; // 视线检测频率（射线检测降频）
const EVADE_GRACE = 6; // 脱离视线多少秒后热度开始衰减
const DECAY_RATE = 0.22; // 热度衰减速度（/s）

// —— 警车 ——
const RESPAWN_DIST = 170;
const SPAWN_MIN = 55;
const SPAWN_MAX = 90;
const DIRECT_RANGE = 26; // 近距且玩家在道路走廊内 → 脱离路网直追
const CORRIDOR = 6.5; // 玩家距道路中心线阈值（再远就在楼群里，车追不进去）
const STOP_DIST = 6; // 玩家步行时车的逼停距离
const SIEGE_DIST = 14; // 2 星起：进入该距离警察下车
const SIEGE_BREAK = 40; // 玩家跑出该距离 → 收兵回车继续追
const TURN_RATE = 2.6; // 直追模式转向速率（rad/s）
const LANE_BLEND = 6; // 横向回正到车道中心的速度（m/s）

/** 巡逻模式跨路口：30% 概率随机左/右转（否则直行） */
function pickRandomDir(dir: number): number {
  return Math.random() < 0.3 ? (dir + (Math.random() < 0.5 ? 1 : 3)) % 4 : dir;
}

// —— 步行警察 ——
const COP_RUN = 3.6; // 略慢于玩家疾跑（9），给"跑得掉"的余地
const COP_SHOOT_RANGE = 13;
const COP_DESPAWN = 60; // 距玩家超过即收兵
const COP_DOWN_TIME = 2.5;
const COP_MAX_HP = 100;
const COP_KNOCK_DMG = 45; // 被撞/被炸倒地一次的伤害
const COP_DEAD_TIME = 4.5; // 尸体停留后收回对象池
const KNOCK_SPEED = 6; // 自身速度突增 → 倒地（被撞/被炸）

const TRACER_LIFE = 0.06;
const CENTER_ABOVE_FEET = 0.9;

// 警灯共享材质（全队同步爆闪，昼夜都亮）
const LIGHT_RED = new THREE.MeshStandardMaterial({
  color: 0xff2020,
  emissive: 0xff2020,
  emissiveIntensity: 0.3,
});
const LIGHT_BLUE = new THREE.MeshStandardMaterial({
  color: 0x2266ff,
  emissive: 0x2266ff,
  emissiveIntensity: 0.3,
});

type CarMode = 'chase' | 'siege' | 'retreat';

interface PoliceCar {
  seized: boolean;
  seats: Array<{ person: PersonInstance; occupied: boolean }>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  group: THREE.Group;
  active: boolean;
  mode: CarMode;
  dir: number;
  /** 连续朝向（直追模式脱离四向路网时用） */
  yaw: number;
  direct: boolean;
  speed: number;
  retreatTimer: number;
  cops: Cop[];
  readonly prevPos: THREE.Vector3;
  readonly currPos: THREE.Vector3;
  prevYaw: number;
  currYaw: number;
}

type CopState = 'run' | 'shoot' | 'down';

interface Cop {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  person: PersonInstance;
  active: boolean;
  state: CopState;
  hp: number;
  dead: boolean;
  bar: HealthBar3D;
  car: PoliceCar | null;
  shootTimer: number;
  downTimer: number;
  /** 爬起后的定身时间（把 Lie_StandUp 播完） */
  pause: number;
  yaw: number;
  prevYaw: number;
  currentClip: string;
  currentAction: THREE.AnimationAction | null;
  readonly prevPos: THREE.Vector3;
  readonly currPos: THREE.Vector3;
  readonly prevQuat: THREE.Quaternion;
  readonly currQuat: THREE.Quaternion;
}

/**
 * 通缉系统：作恶 → 星级（1~3★）→ 警力响应 → 脱离视线后消退。
 * - 犯罪事件由外部上报（开枪/爆炸/抢车/撞人/袭警），热度换算星级。
 * - 警车（kinematic 对象池）沿路网追击；近距且玩家在道路走廊内转直线逼抢；
 *   玩家步行则逼停，驾车则冲撞。
 * - 2 星起警车到位后警察下车（动态胶囊），持枪追击，带真实建筑遮挡视线检测——
 *   躲进楼后打不到你；被打/被撞会翻滚倒地（计袭警加星）。
 * - 消退：所有警力既看不到你（射线遮挡）也不够近，宽限期后热度衰减到 0 收兵。
 */
export class WantedSystem {
  private heat = 0;
  private time = 0;
  private unseen = 0;
  private sightAcc = 0;
  private seen = true;
  private lastGun = -10;
  private lastCopHit = -10;
  private ramCooldown = 0;
  private nearestDist = Infinity;

  /** 玩家受击上报（子弹命中/警车冲撞），main 接生命值系统 */
  onPlayerHit: ((dmg: number) => void) | null = null;

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly audio: GameAudio;
  private readonly controller: CharacterController;
  private readonly peds: Pedestrians;

  private readonly cars: PoliceCar[] = [];
  private readonly cops: Cop[] = [];
  /** 刚体句柄 → 警察（子弹伤害查找） */
  private readonly copByBody = new Map<number, Cop>();
  private readonly effects: Array<{ mesh: THREE.Mesh; life: number }> = [];

  private readonly playerPos = new THREE.Vector3();
  private driving = false;
  private playerVehicle: Vehicle | null = null;

  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly scratchV = new THREE.Vector3();
  private readonly muzzleV = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    physics: Physics,
    audio: GameAudio,
    carLib: CarLibrary,
    personLib: PersonLibrary,
    controller: CharacterController,
    peds: Pedestrians,
  ) {
    this.scene = scene;
    this.physics = physics;
    this.audio = audio;
    this.controller = controller;
    this.peds = peds;

    // —— 警车池 ——
    const lightGeo = new THREE.BoxGeometry(0.26, 0.12, 0.2);
    for (let i = 0; i < CAR_POOL; i++) {
      const model = carLib.clone('police', false);
      const group = new THREE.Group();
      const lr = new THREE.Mesh(lightGeo, LIGHT_RED);
      lr.position.set(0.24, 1.52, -0.25);
      const lb = new THREE.Mesh(lightGeo, LIGHT_BLUE);
      lb.position.set(-0.24, 1.52, -0.25);
      group.add(model, lr, lb);
      const seats = [1, -1].map(side => {
        const person = personLib.spawn('adventurer');
        person.root.position.set(side * .48, .12, .35);
        person.root.scale.setScalar(.85);
        person.root.rotation.y = Math.PI;
        person.actions.get('Sit_Chair_Idle')?.play();
        group.add(person.root);
        return { person, occupied: true };
      });
      group.visible = false;
      scene.add(group);

      const body = physics.world.createRigidBody(roadCarBody());
      physics.registerVehicle(body);
      // 实测双盒碰撞（同交通车）：车身盒+座舱盒，人能站上警车真实车顶
      const spec = carLib.colliderBoxes('police');
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(spec.body.hx, spec.body.hy, spec.body.hz)
          .setTranslation(0, spec.body.cy, spec.body.cz)
          .setMass(700).setFriction(0.4).setRestitution(0.05),
        body,
      );
      if (spec.cabin) {
        physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(spec.cabin.hx, spec.cabin.hy, spec.cabin.hz)
            .setTranslation(0, spec.cabin.cy, spec.cabin.cz).setMass(0),
          body,
        );
      }
      body.setEnabled(false);

      this.cars.push({
        body,
        collider,
        group,
        seats,
        seized: false,
        active: false,
        mode: 'chase',
        dir: 0,
        yaw: 0,
        direct: false,
        speed: 0,
        retreatTimer: 0,
        cops: [],
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevYaw: 0,
        currYaw: 0,
      });
    }

    // —— 步行警察池（Mage 皮 + 手枪道具）——
    const gunMat = new THREE.MeshStandardMaterial({ color: 0x2b2b30 });
    for (let i = 0; i < COP_POOL; i++) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .lockRotations()
          .setLinearDamping(0.2)
          .setAngularDamping(1.5)
          .setCcdEnabled(true), // 爆炸冲量很大,无 CCD 会被打穿地面嵌进地基
      );
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.capsule(0.6, 0.3),
        body,
      );
      body.setEnabled(false);

      const person = personLib.spawn('adventurer');
      person.root.visible = false;
      scene.add(person.root);
      // 手枪挂右手（同武器系统的挂法：挂点武器轴 +Y，枪管建在 -Z → 绕 X 转 90°）
      const gun = new THREE.Group();
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.26), gunMat);
      barrel.position.z = -0.1;
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), gunMat);
      grip.position.set(0, -0.09, 0.04);
      gun.add(barrel, grip);
      gun.position.set(0, 0.05, 0);
      gun.rotation.x = Math.PI / 2;
      (person.handSlotR ?? person.root).add(gun);

      this.cops.push({
        body,
        collider,
        person,
        active: false,
        state: 'run',
        hp: COP_MAX_HP,
        dead: false,
        bar: new HealthBar3D(scene),
        car: null,
        shootTimer: 0,
        downTimer: 0,
        pause: 0,
        yaw: 0,
        prevYaw: 0,
        currentClip: '',
        currentAction: null,
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevQuat: new THREE.Quaternion(),
        currQuat: new THREE.Quaternion(),
      });
      this.copByBody.set(body.handle, this.cops[this.cops.length - 1]!);
    }

  }

  get stars(): number {
    return Math.min(3, Math.floor(this.heat));
  }

  /** 正在脱离通缉（警方失去目标，星星闪烁提示） */
  get evading(): boolean {
    return this.stars > 0 && this.unseen > 2;
  }

  /** 警笛响度 0~1（按最近警力距离衰减） */
  get sirenLevel(): number {
    if (this.stars === 0 || !Number.isFinite(this.nearestDist)) return 0;
    return THREE.MathUtils.clamp(1 - this.nearestDist / 90, 0.12, 1);
  }

  /** 犯罪上报：热度上升并立刻恢复被目击状态 */
  reportCrime(kind: CrimeKind, x: number, z: number): void {
    switch (kind) {
      case 'gunshot':
        this.heat = Math.max(this.heat, 1);
        if (this.time - this.lastGun > 0.4) {
          this.heat += 0.1;
          this.lastGun = this.time;
        }
        break;
      case 'pedhit':
        this.heat = Math.max(this.heat, 1) + 0.5;
        break;
      case 'carjack':
        this.heat = Math.max(this.heat, 1) + 0.4;
        break;
      case 'explosion':
        this.heat = Math.max(this.heat, 2) + 0.4;
        this.blastCops(x, z);
        break;
      case 'cophit':
        if (this.time - this.lastCopHit > 0.3) {
          this.heat = Math.max(this.heat, 1) + 0.6;
          this.lastCopHit = this.time;
        }
        break;
      case 'copkill':
        this.heat = Math.max(this.heat, 2) + 0.7;
        break;
    }
    this.heat = Math.min(this.heat, MAX_HEAT);
    this.unseen = 0;
    this.seen = true;
  }

  /** 立即清空通缉并收兵（死亡复活用） */
  clearAll(): void {
    if (this.heat > 0) this.clearWanted();
  }

  /** 剧情栽赃：直接拉到 2 星并立刻被目击 */
  frameUp(): void {
    this.heat = Math.max(this.heat, 2.2);
    this.unseen = 0;
    this.seen = true;
  }

  /** 每物理步调用（physics.step 之前） */
  fixedUpdate(dt: number, playerPos: THREE.Vector3, driving: boolean, vehicle: Vehicle): void {
    this.time += dt;
    this.ramCooldown -= dt;
    this.playerPos.copy(playerPos);
    this.driving = driving;
    this.playerVehicle = vehicle;
    const stars = this.stars;

    // 出警配额：星级上升补车（下降不撤，直到完全脱离）
    if (stars > 0) {
      let activeCount = 0;
      for (const car of this.cars) if (car.active && car.mode !== 'retreat') activeCount++;
      for (let i = activeCount; i < COUNT_BY_STARS[stars]!; i++) this.activateCar();
    }

    // 视线检测（降频）与热度衰减
    if (stars > 0) {
      this.sightAcc += dt;
      if (this.sightAcc >= SIGHT_INTERVAL) {
        this.sightAcc = 0;
        this.seen = this.anyUnitSees();
      }
      this.unseen = this.seen ? 0 : this.unseen + dt;
      if (this.unseen > EVADE_GRACE) {
        this.heat -= DECAY_RATE * dt;
        if (this.heat < 1) this.clearWanted();
      }
    }

    // 最近警力距离（警笛响度用）
    this.nearestDist = Infinity;
    for (const car of this.cars) {
      if (!car.active) continue;
      const d = Math.hypot(car.currPos.x - playerPos.x, car.currPos.z - playerPos.z);
      if (d < this.nearestDist) this.nearestDist = d;
    }

    for (const car of this.cars) if (car.active) this.updateCar(car, dt, stars);
    for (const cop of this.cops) if (cop.active) this.updateCop(cop, dt, stars);
  }

  nearestCar(pos: THREE.Vector3, range: number): { index: number; distance: number } | null {
    let result = null, best = range;
    this.cars.forEach((car, index) => {
      const distance = Math.hypot(car.currPos.x - pos.x, car.currPos.z - pos.z);
      if (car.active && !car.seized && distance < best && Math.abs(pos.y - car.currPos.y) < 3) {
        result = { index, distance }; best = distance;
      }
    });
    return result;
  }

  beginTakeover(index: number, character: Character): PoliceTakeover | null {
    const car = this.cars[index];
    if (!car?.active || car.seized) return null;
    car.seized = true; car.speed = 0;
    car.prevPos.copy(car.currPos); car.prevYaw = car.currYaw;
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.frameUp(); this.audio.door(true);
    const occupied = car.seats.map((seat, i) => seat.occupied ? i : -1).filter(i => i >= 0);
    let elapsed = 0, completed = 0, closed = false;
    const start = character.getPosition(new THREE.Vector3()).clone();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), car.currYaw);
    const world = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q).add(car.currPos);
    const finishCop = (seatIndex: number) => {
      const seat = car.seats[seatIndex]!;
      seat.occupied = false; seat.person.root.visible = false;
      const cop = this.cops.find(c => !c.active);
      if (!cop) return;
      const side = seatIndex === 0 ? 1 : -1;
      this.spawnCop(cop, car, -side * 2.35);
      car.cops.splice(car.cops.indexOf(cop), 1); cop.car = null;
      cop.state = 'down'; cop.downTimer = 2.5; cop.pause = 0;
      playClip(cop, 'Lie_Down', true, 1.4, .05);
      this.audio.door(true);
    };
    return {
      x: car.currPos.x, y: car.currPos.y, z: car.currPos.z, yaw: car.currYaw, type: 'police', occupants: occupied.length,
      update: dt => {
        if (closed) return true;
        elapsed += dt;
        const stage = Math.floor(elapsed / 1.65);
        while (completed < Math.min(stage, occupied.length)) finishCop(occupied[completed++]!);
        if (stage >= occupied.length) {
          character.setCarjackHands(null);
          car.active = false; car.seized = false; car.body.setEnabled(false); car.group.visible = false;
          for (const cop of car.cops) cop.car = null;
          car.cops.length = 0;
          closed = true; return true;
        }
        const i = occupied[stage]!, side = i === 0 ? 1 : -1;
        const t = (elapsed % 1.65) / 1.65;
        const reach = THREE.MathUtils.smoothstep(t, .22, .82);
        const seat = car.seats[i]!;
        const root = seat.person.root;
        root.position.set(side * THREE.MathUtils.lerp(.48, 2.35, reach), THREE.MathUtils.lerp(.12, 0, reach), .35);
        root.scale.setScalar(THREE.MathUtils.lerp(.85, 1, reach));
        root.rotation.z = side * Math.sin(reach * Math.PI) * .42;
        const shoulder = world(root.position.x, 1.12 - reach * .25, .35);
        const door = world(side * (1.6 + reach * 1.25), .95, .35);
        // 第二位警员从车尾绕到另一侧，避免穿过座舱。
        const previous = stage === 0 ? start : world(-side * 2.85, .95, .35);
        const approach = THREE.MathUtils.smoothstep(t, 0, .25);
        const position = previous.clone().lerp(door, approach);
        if (stage > 0) position.add(new THREE.Vector3(0, 0, -Math.sin(approach * Math.PI) * 2.8).applyQuaternion(q));
        character.teleport(position);
        character.setYaw(car.currYaw + side * Math.PI / 2);
        character.setCarjackHands(shoulder.clone().add(new THREE.Vector3(0, 0, .15)), shoulder.clone().add(new THREE.Vector3(0, 0, -.15)));
        return false;
      },
      cancel: () => {
        if (closed) return;
        closed = true; car.seized = false; character.setCarjackHands(null);
        car.seats.forEach((seat, i) => { seat.person.root.position.set(i === 0 ? .48 : -.48, .12, .35); seat.person.root.scale.setScalar(.85); seat.person.root.rotation.z = 0; });
      },
    };
  }

  /** 每物理步结束后调用：采样警察刚体位姿（插值端点） */
  endStep(): void {
    for (const car of this.cars) {
      if (!car.active) continue;
      const p = car.body.translation(), q = car.body.rotation();
      car.currPos.set(p.x, p.y, p.z);
      car.currYaw = Math.atan2(2 * q.w * q.y, 1 - 2 * q.y * q.y);
      car.yaw = car.currYaw;
    }
    for (const cop of this.cops) {
      if (!cop.active) continue;
      const t = cop.body.translation();
      const r = cop.body.rotation();
      cop.currPos.set(t.x, t.y, t.z);
      cop.currQuat.set(r.x, r.y, r.z, r.w);
    }
  }

  /** 每帧调用（渲染帧）：视觉插值、警灯爆闪、动画混合器、特效与红屏 */
  update(dt: number, alpha: number): void {
    // 警灯：红蓝交替爆闪
    const phase = this.time * 4 % 1 < 0.5;
    LIGHT_RED.emissiveIntensity = phase ? 3.2 : 0.15;
    LIGHT_BLUE.emissiveIntensity = phase ? 0.15 : 3.2;

    for (const car of this.cars) {
      if (!car.active) continue;
      car.group.position.lerpVectors(car.prevPos, car.currPos, alpha);
      car.group.rotation.y = car.prevYaw + wrapAngle(car.currYaw - car.prevYaw) * alpha;
      for (const seat of car.seats) {
        seat.person.root.visible = seat.occupied;
        if (seat.occupied) seat.person.mixer.update(dt);
      }
    }

    for (const cop of this.cops) {
      if (!cop.active) continue;
      placeSkinnedRoot(
        cop.person.root,
        cop.prevPos, cop.currPos,
        cop.prevQuat, cop.currQuat,
        cop.prevYaw, cop.yaw,
        alpha, CENTER_ABOVE_FEET,
      );
      cop.person.mixer.update(dt);
      cop.bar.update(
        cop.person.root.position.x,
        cop.person.root.position.y + 2.05,
        cop.person.root.position.z,
        cop.hp / COP_MAX_HP,
        !cop.dead,
        this.playerPos,
      );
    }

    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      e.life -= dt;
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        this.effects.splice(i, 1);
      }
    }

  }

  /** 遍历警力位置（小地图用），isCar 区分警车/步行警察 */
  forEachUnit(cb: (x: number, z: number, isCar: boolean) => void): void {
    for (const car of this.cars) if (car.active) cb(car.currPos.x, car.currPos.z, true);
    for (const cop of this.cops) if (cop.active) cb(cop.currPos.x, cop.currPos.z, false);
  }

  // ================= 警车 =================

  private updateCar(car: PoliceCar, dt: number, stars: number): void {
    if (car.seized) {
      car.prevPos.copy(car.currPos); car.prevYaw = car.currYaw;
      driveRoadCar(car.body, car.currPos.x, car.currPos.z, car.currYaw, 0, dt);
      return;
    }
    car.prevPos.copy(car.currPos);
    car.prevYaw = car.currYaw;

    const px = this.playerPos.x;
    const pz = this.playerPos.z;
    const dx = px - car.currPos.x;
    const dz = pz - car.currPos.z;
    const dist = Math.hypot(dx, dz);

    if (dist > RESPAWN_DIST) {
      if (car.mode === 'retreat') return this.deactivateCar(car);
      this.spawnCarNearPlayer(car);
      return;
    }

    if (car.mode === 'retreat') {
      car.retreatTimer += dt;
      if (dist > 110 || car.retreatTimer > 10) return this.deactivateCar(car);
      this.roadFollow(car, dt, 8, true);
    } else if (car.mode === 'siege') {
      // 到位驻车，警察在外面干活；玩家跑远/驱车逃逸 → 收兵回车继续追
      const playerSpeed = this.driving ? Math.abs(this.playerVehicle!.speedKmh) / 3.6 : 0;
      if (dist > SIEGE_BREAK || playerSpeed > 8) {
        for (let i = car.cops.length - 1; i >= 0; i--) {
          if (car.cops[i]!.state !== 'down') this.despawnCop(car.cops[i]!);
        }
        car.mode = 'chase';
      }
    } else {
      // chase
      const playerSpeed = this.driving ? Math.abs(this.playerVehicle!.speedKmh) / 3.6 : 0;
      const pursuit = 7 + stars;
      const corridorOK =
        Math.abs(px - snapToRoad(px)) < CORRIDOR || Math.abs(pz - snapToRoad(pz)) < CORRIDOR;

      if (dist < DIRECT_RANGE && corridorOK && roadAvailable(px, pz) &&
        roadAvailable(car.currPos.x + Math.sin(car.yaw) * 6, car.currPos.z + Math.cos(car.yaw) * 6)) {
        // 直线逼抢
        car.direct = true;
        const desired = Math.atan2(dx, dz);
        car.yaw += THREE.MathUtils.clamp(
          wrapAngle(desired - car.yaw),
          -TURN_RATE * dt,
          TURN_RATE * dt,
        );
        let target = pursuit;
        if (!this.driving && dist < STOP_DIST) target = 0; // 步行逼停，不碾人
        else if (this.driving && dist < 5) target = Math.min(pursuit, playerSpeed + 2); // 贴身推挤不瞬爆
        car.speed += (target - car.speed) * (1 - Math.exp(-4 * dt));
        car.currPos.x += Math.sin(car.yaw) * car.speed * dt;
        car.currPos.z += Math.cos(car.yaw) * car.speed * dt;
        car.currYaw = car.yaw;
        // 高速贴身撞到步行玩家：撞飞 + 伤害（1s 冷却防连续判定）
        if (!this.driving && dist < 3.2 && car.speed > 5 && this.ramCooldown <= 0) {
          this.ramCooldown = 1;
          const inv = 1 / Math.max(dist, 0.3);
          this.controller.knock(dx * inv * 7, dz * inv * 7, 3.5);
          this.onPlayerHit?.(16);
        }
      } else {
        this.roadFollow(car, dt, pursuit, false);
      }

      // 2 星起：到位下车围捕（车上警察 2 人）
      if (stars >= 2 && dist < SIEGE_DIST && playerSpeed <= 8 && car.cops.length === 0) {
        let deployed = 0;
        for (const cop of this.cops) {
          if (deployed >= 2 || !car.seats.some(s => s.occupied)) break;
          if (cop.active) continue;
          this.spawnCop(cop, car, deployed === 0 ? 1.7 : -1.7);
          deployed++;
        }
        if (deployed > 0) {
          car.mode = 'siege';
          car.speed = 0;
        }
      }
    }

    driveRoadCar(car.body, car.currPos.x, car.currPos.z, car.currYaw, car.speed, dt);
    car.currPos.copy(car.prevPos);
    car.currYaw = car.prevYaw;
  }

  /** 沿路网行驶：路口选朝向玩家的方向（retreat 时随机），横向渐进回正到车道 */
  private roadFollow(car: PoliceCar, dt: number, targetSpeed: number, random: boolean): void {
    if (car.direct) {
      // 退出直追：朝向量化回最近轴向，横向由 LANE_BLEND 渐进回正（不瞬移）
      let best = 0;
      let bestDot = -Infinity;
      for (let d = 0; d < 4; d++) {
        const dot = Math.sin(car.yaw) * DIR_X[d]! + Math.cos(car.yaw) * DIR_Z[d]!;
        if (dot > bestDot) {
          bestDot = dot;
          best = d;
        }
      }
      car.dir = best;
      car.direct = false;
    }

    car.speed += (targetSpeed - car.speed) * (1 - Math.exp(-4 * dt));
    car.yaw = advanceOnRoad(car, car.speed, dt, random ? pickRandomDir : this.pickChaseDir);

    // 横向回正到本方向车道中心（跨路口吸附之外的渐进修正，不瞬移）
    if (car.dir % 2 === 0) {
      const lane = snapToRoad(car.currPos.x) + LANE_X[car.dir]!;
      car.currPos.x += THREE.MathUtils.clamp(lane - car.currPos.x, -LANE_BLEND * dt, LANE_BLEND * dt);
    } else {
      const lane = snapToRoad(car.currPos.z) + LANE_Z[car.dir]!;
      car.currPos.z += THREE.MathUtils.clamp(lane - car.currPos.z, -LANE_BLEND * dt, LANE_BLEND * dt);
    }
    car.currYaw = car.yaw;
  }

  /** 追击选向：直行/左转/右转里选最朝向玩家的（不出城西） */
  private readonly pickChaseDir = (dir: number, x: number, z: number): number => {
    const tx = this.playerPos.x - x;
    const tz = this.playerPos.z - z;
    const len = Math.max(Math.hypot(tx, tz), 0.01);
    let best = dir;
    let bestDot = -Infinity;
    for (const cand of [dir, (dir + 1) % 4, (dir + 3) % 4]) {
      if (DIR_X[cand]! < 0 && x < CITY_MIN_BLOCK_X + PITCH) continue;
      const dot = (DIR_X[cand]! * tx + DIR_Z[cand]! * tz) / len;
      if (dot > bestDot) {
        bestDot = dot;
        best = cand;
      }
    }
    return best;
  };

  private activateCar(): void {
    for (const car of this.cars) {
      if (car.active) continue;
      car.active = true;
      car.seized = false;
      car.seats.forEach((seat, i) => { seat.occupied = true; seat.person.root.position.set(i === 0 ? .48 : -.48, .12, .35); seat.person.root.scale.setScalar(.85); seat.person.root.rotation.z = 0; });
      car.mode = 'chase';
      car.cops.length = 0;
      car.retreatTimer = 0;
      car.body.setEnabled(true);
      car.group.visible = true;
      this.spawnCarNearPlayer(car);
      return;
    }
  }

  private spawnCarNearPlayer(car: PoliceCar): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    const sx = this.playerPos.x + Math.cos(angle) * dist;
    const sz = this.playerPos.z + Math.sin(angle) * dist;
    // 随机纵横路，方向选朝玩家的一侧
    if (Math.random() < 0.5) {
      car.dir = this.playerPos.z > sz ? 0 : 2;
      car.currPos.set(
        Math.max(snapToRoad(sx), CITY_MIN_BLOCK_X + HALF_ROAD) + LANE_X[car.dir]!,
        0,
        sz,
      );
    } else {
      car.dir = this.playerPos.x > sx ? 1 : 3;
      if (car.dir === 3 && sx < CITY_MIN_BLOCK_X + PITCH * 2) car.dir = 1;
      car.currPos.set(Math.max(sx, CITY_MIN_BLOCK_X), 0, snapToRoad(sz) + LANE_Z[car.dir]!);
    }
    car.speed = 8;
    const safeX = safeRoadX(car.currPos.x, car.currPos.z);
    if (safeX !== car.currPos.x) {
      car.dir = this.playerPos.z > car.currPos.z ? 0 : 2;
      car.currPos.x = safeX + LANE_X[car.dir]!;
    }
    car.direct = false;
    car.yaw = Math.atan2(DIR_X[car.dir]!, DIR_Z[car.dir]!);
    car.currYaw = car.yaw;
    car.prevPos.copy(car.currPos);
    car.prevYaw = car.currYaw;
    car.body.setTranslation({ x: car.currPos.x, y: 0, z: car.currPos.z }, false);
    car.body.setRotation({ x: 0, y: Math.sin(car.currYaw / 2), z: 0, w: Math.cos(car.currYaw / 2) }, true);
    car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  private deactivateCar(car: PoliceCar): void {
    for (const cop of [...car.cops]) this.despawnCop(cop);
    car.active = false;
    car.body.setEnabled(false);
    car.group.visible = false;
  }

  private clearWanted(): void {
    this.heat = 0;
    this.unseen = 0;
    for (const cop of this.cops) if (cop.active) this.despawnCop(cop);
    for (const car of this.cars) {
      if (!car.active) continue;
      car.mode = 'retreat';
      car.retreatTimer = 0;
    }
  }

  // ================= 步行警察 =================

  /**
   * 子弹伤害：按刚体句柄找警察扣血（袭警计罪）。归零 → 殉职倒地 + 杀警重罪。
   * 返回是否命中了警察。
   */
  applyBulletDamage(body: RAPIER.RigidBody, dmg: number): boolean {
    const cop = this.copByBody.get(body.handle);
    if (!cop || !cop.active) return false;
    if (cop.dead) return true;
    cop.hp -= dmg;
    const t = cop.body.translation();
    if (cop.hp <= 0) {
      cop.dead = true;
      cop.hp = 0;
      cop.state = 'down';
      cop.downTimer = COP_DEAD_TIME;
      cop.body.setEnabledRotations(true, true, true, true);
      playClip(cop, 'Death_A', true, 1, 0.08);
      this.reportCrime('copkill', t.x, t.z);
    } else {
      this.reportCrime('cophit', t.x, t.z);
    }
    return true;
  }

  private spawnCop(cop: Cop, car: PoliceCar, side: number): void {
    const seat = car.seats.find(s => s.occupied);
    if (seat && !car.seized) seat.occupied = false;
    cop.active = true;
    cop.state = 'run';
    cop.hp = COP_MAX_HP;
    cop.dead = false;
    cop.car = car;
    cop.shootTimer = 0.5 + Math.random() * 0.5;
    cop.pause = 0;
    cop.yaw = car.yaw;
    cop.prevYaw = car.yaw;
    cop.currentClip = '';
    cop.currentAction = null;
    car.cops.push(cop);

    // 车侧下车点
    const rx = -Math.cos(car.yaw) * side;
    const rz = Math.sin(car.yaw) * side;
    const x = car.currPos.x + rx;
    const z = car.currPos.z + rz;
    cop.body.setEnabled(true);
    cop.body.setTranslation({ x, y: 0.95, z }, true);
    cop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    cop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    cop.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    cop.body.setEnabledRotations(false, false, false, true);
    cop.prevPos.set(x, 0.95, z);
    cop.currPos.set(x, 0.95, z);
    cop.prevQuat.identity();
    cop.currQuat.identity();
    cop.person.root.visible = true;
    playClip(cop, 'Running_A', false, 0.85);
  }

  private despawnCop(cop: Cop): void {
    cop.active = false;
    cop.body.setEnabled(false);
    cop.person.root.visible = false;
    cop.bar.hide();
    if (cop.car) {
      if (!cop.dead && !cop.car.seized) {
        const seat = cop.car.seats.find(s => !s.occupied);
        if (seat) seat.occupied = true;
      }
      const i = cop.car.cops.indexOf(cop);
      if (i >= 0) cop.car.cops.splice(i, 1);
      cop.car = null;
    }
  }

  private updateCop(cop: Cop, dt: number, stars: number): void {
    cop.prevPos.copy(cop.currPos);
    cop.prevQuat.copy(cop.currQuat);
    cop.prevYaw = cop.yaw;

    const t = cop.body.translation();
    const dx = this.playerPos.x - t.x;
    const dz = this.playerPos.z - t.z;
    const dist = Math.hypot(dx, dz);
    const vel = cop.body.linvel();
    const horizSpeed = Math.hypot(vel.x, vel.z);

    if (t.y < -2.5) return this.despawnCop(cop); // 嵌地/坠出世界直接收回

    // 倒地：殉职的停尸计时后收回；活的等翻滚停下再爬起
    if (cop.state === 'down') {
      cop.downTimer -= dt;
      if (cop.downTimer > 0) return;
      if (cop.dead) return this.despawnCop(cop);
      if (horizSpeed < 1.2) {
        cop.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
        cop.body.setTranslation({ x: t.x, y: t.y + 0.4, z: t.z }, true);
        cop.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        cop.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        cop.body.setEnabledRotations(false, false, false, true);
        cop.state = 'run';
        cop.pause = 0.9;
        playClip(cop, 'Lie_StandUp', true, 1.4, 0.1);
      }
      return;
    }

    // 被撞/被炸/被打飞 → 掉血翻滚倒地 + 计袭警（撞死加计杀警）
    if (horizSpeed > KNOCK_SPEED) {
      cop.hp -= COP_KNOCK_DMG;
      cop.dead = cop.hp <= 0;
      cop.state = 'down';
      cop.downTimer = cop.dead ? COP_DEAD_TIME : COP_DOWN_TIME;
      cop.body.setEnabledRotations(true, true, true, true);
      playClip(cop, 'Death_A', true, 1, 0.08);
      this.reportCrime(cop.dead ? 'copkill' : 'cophit', t.x, t.z);
      return;
    }

    if (dist > COP_DESPAWN) return this.despawnCop(cop);

    if (cop.pause > 0) {
      cop.pause -= dt;
      setVel(cop.body, 0, vel.y, 0);
      return;
    }

    const nx = dx / Math.max(dist, 0.01);
    const nz = dz / Math.max(dist, 0.01);

    if (dist > COP_SHOOT_RANGE) {
      // 追：不下海
      if (!roadAvailable(t.x + nx * 2, t.z + nz * 2)) {
        setVel(cop.body, 0, vel.y, 0);
        playClip(cop, 'Idle');
      } else {
        setVel(cop.body, nx * COP_RUN, vel.y, nz * COP_RUN);
        cop.yaw += wrapAngle(Math.atan2(-nx, -nz) - cop.yaw) * (1 - Math.exp(-10 * dt));
        playClip(cop, 'Running_A', false, 0.85);
      }
      cop.state = 'run';
    } else {
      // 站定射击
      setVel(cop.body, 0, vel.y, 0);
      cop.yaw += wrapAngle(Math.atan2(-nx, -nz) - cop.yaw) * (1 - Math.exp(-12 * dt));
      playClip(cop, '1H_Ranged_Aiming');
      cop.state = 'shoot';
      cop.shootTimer -= dt;
      if (cop.shootTimer <= 0) {
        this.tryShoot(cop, t.x, t.y, t.z, nx, nz, dist, stars);
        cop.shootTimer = 1.35 - stars * 0.15 + Math.random() * 0.4;
      }
    }
  }

  /** 开火尝试：先做建筑遮挡视线检测，命中则击退玩家/推搡车辆 + 红屏 */
  private tryShoot(
    cop: Cop,
    x: number,
    y: number,
    z: number,
    nx: number,
    nz: number,
    dist: number,
    stars: number,
  ): void {
    if (dist > 3 && !this.hasLineOfSight(x, y + 0.5, z, cop.collider)) return;

    this.audio.gunshot(false);
    this.peds.panicAt(x, z, 22);

    const hit = Math.random() < 0.5 + stars * 0.08;
    // 曳光：命中指向玩家胸口，未命中带随机偏差
    const ox = hit ? 0 : (Math.random() - 0.5) * 3;
    const oy = hit ? 0.3 : Math.random() * 1.5;
    const oz = hit ? 0 : (Math.random() - 0.5) * 3;
    this.scratchV.set(this.playerPos.x + ox, this.playerPos.y + oy, this.playerPos.z + oz);
    this.muzzleV.set(x + nx * 0.3, y + 0.4, z + nz * 0.3);
    const tracer = makeTracer(this.muzzleV, this.scratchV);
    this.scene.add(tracer);
    this.effects.push({ mesh: tracer, life: TRACER_LIFE });

    if (!hit) return;
    this.onPlayerHit?.(11 + stars * 2);
    if (this.driving && this.playerVehicle) {
      const body = this.playerVehicle.chassisBody;
      this.scratchV.set(nx * 0.35, 0.05, nz * 0.35).multiplyScalar(body.mass());
      body.applyImpulse(this.scratchV, true);
    } else {
      this.controller.knock(nx * 2.4, nz * 2.4, 1.0);
    }
  }

  /** 视线检测：从警力眼位到玩家胸口，被建筑挡住即失明（玩家自己的车不算遮挡） */
  private hasLineOfSight(x: number, y: number, z: number, exclude: RAPIER.Collider): boolean {
    const tx = this.playerPos.x - x;
    const ty = this.playerPos.y + 0.3 - y;
    const tz = this.playerPos.z - z;
    const dist = Math.hypot(tx, ty, tz);
    if (dist < 2.5) return true;
    this.ray.origin.x = x;
    this.ray.origin.y = y;
    this.ray.origin.z = z;
    this.ray.dir.x = tx / dist;
    this.ray.dir.y = ty / dist;
    this.ray.dir.z = tz / dist;
    // 排除自身整个刚体（警车如今是双碰撞盒，只排单个碰撞体会被自己的座舱盒挡瞎）
    const hit = this.physics.world.castRay(
      this.ray,
      dist - 2,
      true,
      undefined,
      undefined,
      exclude,
      exclude.parent() ?? undefined,
    );
    if (!hit) return true;
    // 驾车时命中自己的车体不算遮挡
    return this.driving && this.playerVehicle !== null
      ? hit.collider.parent() === this.playerVehicle.chassisBody
      : false;
  }

  /** 是否有任意警力看得到玩家（距离 + 建筑遮挡） */
  private anyUnitSees(): boolean {
    for (const car of this.cars) {
      if (!car.active || car.mode === 'retreat') continue;
      const d = Math.hypot(car.currPos.x - this.playerPos.x, car.currPos.z - this.playerPos.z);
      if (d < SIGHT_CAR && this.hasLineOfSight(car.currPos.x, 1.2, car.currPos.z, car.collider)) {
        return true;
      }
    }
    for (const cop of this.cops) {
      if (!cop.active || cop.state === 'down') continue;
      const d = Math.hypot(cop.currPos.x - this.playerPos.x, cop.currPos.z - this.playerPos.z);
      if (d < SIGHT_COP && this.hasLineOfSight(cop.currPos.x, cop.currPos.y + 0.5, cop.currPos.z, cop.collider)) {
        return true;
      }
    }
    return false;
  }

  /** 爆炸波及警察：径向掀飞 + 按距离掉血（速度阈值自动触发倒地/殉职判定） */
  private blastCops(x: number, z: number): void {
    const radius = 8; // 与 Weapons.EXPLOSION_RADIUS 同一物理量：爆炸对玩家/行人/警察同半径
    for (const cop of this.cops) {
      if (!cop.active || cop.dead) continue;
      const t = cop.body.translation();
      const dx = t.x - x;
      const dz = t.z - z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      radialBlastImpulse(cop.body, dx, dz, d, radius);
      cop.hp -= 90 * (1 - d / radius); // 归零由随后的倒地判定收尾（dead + copkill）
    }
  }
}
