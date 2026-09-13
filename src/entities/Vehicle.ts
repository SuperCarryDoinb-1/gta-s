import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import { CHUNK_SIZE, chunkZone } from '../world/City';
import { CarLibrary, type CarType } from '../core/Loader';

export interface DriveInput {
  /** 油门 [-1, 1]，正为前进；行驶中反向输入自动视为刹车，停稳后才倒车 */
  throttle: number;
  /** 转向 [-1, 1]，正为左转；实际转角随车速衰减 */
  steer: number;
  /** 手刹（后轮重刹） */
  brake: boolean;
}

// 底盘（局部坐标：+Z 车头，+Y 上，+X 左）
const CHASSIS_HALF = { x: 1.0, y: 0.35, z: 2.2 };
const CHASSIS_DENSITY = 100; // → 质量约 620kg
// 车轮
const WHEEL_RADIUS = 0.35;
const WHEEL_WIDTH = 0.25;
const WHEEL_X = 0.95; // 加宽轮距抗侧翻
const WHEEL_Y = -0.1;
const WHEEL_Z = 1.4;
// 悬挂调参依据：Rapier 悬挂力 = 刚度×压缩量×底盘质量（Bullet 同款，刚度是质量归一化单位），
// 临界阻尼 = 2√刚度 ≈ 10.6。压缩取 ~43%、回弹取 ~61% 临界值——欠阻尼会船晃/点头。
// 数值经无头测试验证：落地 1.1s 稳定、刹车点头 2.2°、过坎单次回弹 0.37s 收敛。
const SUSPENSION_REST = 0.35;
const SUSPENSION_STIFFNESS = 28;
const SUSPENSION_COMPRESSION = 4.5;
const SUSPENSION_RELAXATION = 6.5;
const SUSPENSION_MAX_TRAVEL = 0.25;
const SUSPENSION_MAX_FORCE = 20000; // 默认 6000N 在刹车载荷转移时会触底顿挫
const COM_DROP = -0.25; // 质心下移，抗侧倾/抗点头
const SIDE_FRICTION = 0.85; // <1：极限时先侧滑而不是掀翻
// 动力
const MAX_ENGINE_FORCE = 4500;
const REVERSE_FORCE_RATIO = 0.5;
const TOP_SPEED_MS = 30; // ≈108 km/h，引擎力线性衰减到 0
const REVERSE_TOP_MS = 8;
const MAX_BRAKE = 45; // 行车刹车（四轮）
const HANDBRAKE_REAR = 65; // 手刹（仅后轮）
const IDLE_BRAKE = 3; // 无油门时的滚动阻力，防止溜车不停
const MAX_STEER = 0.55; // 静止时最大转角（弧度）
const STEER_SPEED_FALLOFF = 12; // 车速衰减系数：steer = MAX/(1+v/此值)
const STEER_DAMPING = 10;
// 水中（深水区）：浮力弹簧让车漂在水面，油门退化为划水推进——防止沉底困死
const FLOAT_TARGET_Y = 0.15; // 漂浮时底盘中心高度
const FLOAT_ENGAGE_Y = 0.3; // 低于此高度且在海洋区才启用浮力
const BUOY_SPRING = 14;
const BUOY_DAMP = 5;
const WATER_DRAG = 1.1;
const PADDLE_THRUST = 2.4; // m/s² 量级的划水加速度

// 四元数旋转下的车头(+Z)方向分量（兼容 rapier/three 四元数）；共享 scratch 零分配
const fwdTmp = { fx: 0, fy: 0, fz: 0 };
function forwardOf(q: { x: number; y: number; z: number; w: number }): typeof fwdTmp {
  fwdTmp.fx = 2 * (q.x * q.z + q.w * q.y);
  fwdTmp.fy = 2 * (q.y * q.z - q.w * q.x);
  fwdTmp.fz = 1 - 2 * (q.x * q.x + q.y * q.y);
  return fwdTmp;
}
const PADDLE_TURN = 1.6;

/** 载具规格：轿车/摩托共用一套物理，参数不同 */
export interface VehicleSpec {
  half: { x: number; y: number; z: number };
  mass: number;
  comDrop: number;
  wheels: Array<{ x: number; y: number; z: number; front: boolean }>;
  wheelRadius: number;
  wheelWidth: number;
  suspRest: number;
  engine: number;
  topSpeed: number;
  steerMax: number;
  steerFalloff: number;
  brake: number;
  handbrake: number;
  /** 锁滚转/俯仰（摩托防倒，街机式直立） */
  upright: boolean;
  /** 视觉模型相对底盘中心的下移量 */
  groundOffset: number;
  /** 转向时车身侧倾（摩托压弯，纯视觉） */
  lean: boolean;
  /** 更脆：迎面重撞会把骑手甩出去 */
  fragile: boolean;
  /** 不渲染物理车轮圆柱（坦克等模型自带履带/轮组） */
  hideWheels?: boolean;
  /** 车灯位置覆盖（底盘局部系）：默认按方盒推位,异形车（坦克翼子板灯等）需手调。xRear 缺省同 x */
  lamps?: { x: number; y: number; zFront: number; zRear: number; xRear?: number; scale?: number };
  /** 挂该车型实测座舱盒（密度 0 纯几何）：人能站上真实高度的车顶平面 */
  roofHull?: boolean;
  /** 水中推进/转向覆盖（船用，默认取车辆划水常量） */
  paddleThrust?: number;
  paddleTurn?: number;
}

export const CAR_SPEC: VehicleSpec = {
  half: { x: CHASSIS_HALF.x, y: CHASSIS_HALF.y, z: CHASSIS_HALF.z },
  mass: 8 * CHASSIS_HALF.x * CHASSIS_HALF.y * CHASSIS_HALF.z * CHASSIS_DENSITY,
  comDrop: COM_DROP,
  wheels: [
    { x: WHEEL_X, y: WHEEL_Y, z: WHEEL_Z, front: true },
    { x: -WHEEL_X, y: WHEEL_Y, z: WHEEL_Z, front: true },
    { x: WHEEL_X, y: WHEEL_Y, z: -WHEEL_Z, front: false },
    { x: -WHEEL_X, y: WHEEL_Y, z: -WHEEL_Z, front: false },
  ],
  wheelRadius: WHEEL_RADIUS,
  wheelWidth: WHEEL_WIDTH,
  suspRest: SUSPENSION_REST,
  engine: MAX_ENGINE_FORCE,
  topSpeed: TOP_SPEED_MS,
  steerMax: MAX_STEER,
  steerFalloff: STEER_SPEED_FALLOFF,
  brake: MAX_BRAKE,
  handbrake: HANDBRAKE_REAR,
  upright: false,
  groundOffset: -0.72,
  lean: false,
  fragile: false,
  roofHull: true,
};

/** 摩托：更快（145km/h）、更灵、更轻、更脆——重撞甩人 */
export const MOTO_SPEC: VehicleSpec = {
  half: { x: 0.3, y: 0.5, z: 1.05 },
  mass: 240,
  comDrop: -0.3,
  wheels: [
    { x: 0.17, y: -0.12, z: 0.72, front: true },
    { x: -0.17, y: -0.12, z: 0.72, front: true },
    { x: 0.17, y: -0.12, z: -0.72, front: false },
    { x: -0.17, y: -0.12, z: -0.72, front: false },
  ],
  wheelRadius: 0.33,
  wheelWidth: 0.14,
  suspRest: 0.3,
  engine: 2800,
  topSpeed: 33,
  steerMax: 0.72,
  steerFalloff: 18,
  brake: 32,
  handbrake: 42,
  upright: true,
  groundOffset: -0.62,
  lean: true,
  fragile: true,
};

/** 快艇：水中靠强化划水推进（真正的动力在水里），轮子只是沙滩上蹭两步用 */
export const BOAT_SPEC: VehicleSpec = {
  half: { x: 1.1, y: 0.5, z: 2.6 },
  mass: 900,
  comDrop: -0.4,
  wheels: [
    { x: 0.9, y: -0.2, z: 1.8, front: true },
    { x: -0.9, y: -0.2, z: 1.8, front: true },
    { x: 0.9, y: -0.2, z: -1.8, front: false },
    { x: -0.9, y: -0.2, z: -1.8, front: false },
  ],
  wheelRadius: 0.28,
  wheelWidth: 0.2,
  suspRest: 0.22,
  engine: 1200,
  topSpeed: 8,
  steerMax: 0.4,
  steerFalloff: 10,
  brake: 30,
  handbrake: 40,
  upright: true,
  groundOffset: -0.55,
  lean: false,
  fragile: false,
  paddleThrust: 13,
  paddleTurn: 2.2,
};

/** 坦克：重装甲慢速载具（R 键空投）。质量大惯性强,撞击近乎无感,但极限车速低 */
export const TANK_SPEC: VehicleSpec = {
  half: { x: 1.77, y: 0.7, z: 3.75 }, // 对应 Stridsvagn 103 实尺:宽 3.54m、车体长 7.5m（不含炮管悬伸）
  mass: 5000,
  comDrop: -0.35,
  wheels: [
    { x: 1.24, y: -0.15, z: 2.4, front: true },
    { x: -1.24, y: -0.15, z: 2.4, front: true },
    { x: 1.24, y: -0.15, z: -2.4, front: false },
    { x: -1.24, y: -0.15, z: -2.4, front: false },
  ],
  wheelRadius: 0.45,
  wheelWidth: 0.3,
  suspRest: 0.3,
  engine: 30000,
  topSpeed: 16,
  steerMax: 0.5,
  steerFalloff: 6,
  brake: 70,
  handbrake: 90,
  upright: false,
  // 平衡压缩 = g/(4×刚度) ≈ 0.088，静置底盘中心离地 0.15+(0.3−0.088)+0.45 ≈ 0.81
  groundOffset: -0.81,
  lean: false,
  fragile: false,
  hideWheels: true, // 模型自带履带轮组
  // 灯位经查看页截图校准：前灯贴斜甲板（模型自带浇铸大灯旁）,尾灯贴船型收窄的尾板
  lamps: { x: 1.1, y: 0.27, zFront: 3.56, zRear: -3.4, xRear: 0.98, scale: 1.4 },
};

// —— 手刹漂移：拉手刹时后轮侧向摩擦骤降 → 甩尾 ——
const DRIFT_SIDE_FRICTION = 0.35;

// —— 损伤三段：<50 冒烟、<25 起火、0 爆炸成废车 ——
const DAMAGE_SMOKE = 50;
const DAMAGE_FIRE = 25;
const IMPACT_DMG_MIN = 6; // Δv 超过此值开始掉车况
const FX_POOL = 14;

/**
 * 载具：动态刚体底盘 + Rapier DynamicRayCastVehicleController 四轮悬挂。
 * fixedUpdate 需在 physics.step() 之前调用。
 */
export class Vehicle {
  readonly mesh: THREE.Group;
  readonly chassisBody: RAPIER.RigidBody;
  readonly chassisCollider: RAPIER.Collider;
  private cabinCollider: RAPIER.Collider | null = null;
  private physicsRef!: Physics;
  private readonly controller: RAPIER.DynamicRayCastVehicleController;
  private readonly wheelPivots: THREE.Group[] = [];
  private readonly sportsWheelVisuals: Array<{ model: THREE.Group; center: THREE.Vector3 }> = [];
  private readonly defaultWheelVisuals: THREE.Object3D[][] = [];
  private readonly lampMeshes: THREE.Mesh[] = [];
  private brakeLightMat!: THREE.MeshStandardMaterial;
  private headlightMat!: THREE.MeshStandardMaterial;
  private carLib!: CarLibrary;
  private carGroup!: THREE.Group;
  private currentType: CarType = 'sedan-sports';
  private readonly headlights: THREE.SpotLight[] = [];
  private steering = 0;
  readonly spec: VehicleSpec;
  /** 本步前向速度骤降量（撞击探测，摩托甩人用） */
  impactDv = 0;
  private prevForward = 0;
  private isStashed = false;

  // —— 损伤状态 ——
  condition = 100;
  private isWrecked = false;
  /** 车况归零殉爆回调（main 接爆炸特效/伤害） */
  onExploded: (() => void) | null = null;
  private readonly sceneRef: THREE.Scene;
  private fxAcc = 0;
  private readonly fx: Array<{
    mesh: THREE.Mesh;
    mat: THREE.MeshBasicMaterial;
    life: number;
    max: number;
    vx: number;
    vy: number;
    vz: number;
    active: boolean;
  }> = [];
  private static readonly FX_GEO = new THREE.SphereGeometry(0.16, 6, 5);

  // 渲染插值端点（底盘 + 每轮悬挂/自转/转向，全部插值——任何 60Hz 步进直读都会在高刷屏抖）
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private readonly prevQuat = new THREE.Quaternion();
  private readonly currQuat = new THREE.Quaternion();
  private readonly prevSusp: number[];
  private readonly currSusp: number[];
  private readonly prevSpin = [0, 0, 0, 0];
  private readonly currSpin = [0, 0, 0, 0];
  private prevSteer = 0;
  private currSteer = 0;

  constructor(
    scene: THREE.Scene,
    physics: Physics,
    spawn: THREE.Vector3,
    carLib: CarLibrary,
    spec: VehicleSpec = CAR_SPEC,
    customModel: THREE.Group | null = null,
  ) {
    this.spec = spec;
    this.sceneRef = scene;
    this.prevSusp = spec.wheels.map(() => spec.suspRest);
    this.currSusp = spec.wheels.map(() => spec.suspRest);

    // --- 物理 ---
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setCcdEnabled(true); // 连续碰撞检测：高速坠落/冲撞不穿透薄碰撞体（掉入地下的元凶之一）
    if (spec.upright) bodyDesc.enabledRotations(false, true, false); // 摩托：只允许偏航
    this.chassisBody = physics.world.createRigidBody(bodyDesc);
    // 手动指定质量属性：质心下移，惯量按盒体公式
    const half = spec.half;
    const mass = spec.mass;
    const sq = (n: number) => n * n;
    this.chassisCollider = physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z).setMassProperties(
        mass,
        { x: 0, y: spec.comDrop, z: 0 },
        {
          x: (mass / 12) * (sq(2 * half.y) + sq(2 * half.z)),
          y: (mass / 12) * (sq(2 * half.x) + sq(2 * half.z)),
          z: (mass / 12) * (sq(2 * half.x) + sq(2 * half.y)),
        },
        { x: 0, y: 0, z: 0, w: 1 },
      ),
      this.chassisBody,
    );

    this.physicsRef = physics;
    this.carLib = carLib;
    // 该车型实测座舱盒（密度 0，不影响手调的质量属性）：人可以站上真实车顶平面
    if (spec.roofHull) this.refreshRoofHull();

    this.controller = physics.world.createVehicleController(this.chassisBody);
    for (const p of spec.wheels) {
      const i = this.controller.numWheels();
      this.controller.addWheel(
        { x: p.x, y: p.y, z: p.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        spec.suspRest,
        spec.wheelRadius,
      );
      this.controller.setWheelSuspensionStiffness(i, SUSPENSION_STIFFNESS);
      this.controller.setWheelSuspensionCompression(i, SUSPENSION_COMPRESSION);
      this.controller.setWheelSuspensionRelaxation(i, SUSPENSION_RELAXATION);
      this.controller.setWheelMaxSuspensionTravel(i, SUSPENSION_MAX_TRAVEL);
      this.controller.setWheelMaxSuspensionForce(i, SUSPENSION_MAX_FORCE);
      this.controller.setWheelSideFrictionStiffness(i, SIDE_FRICTION);
    }

    // --- 视觉：Kenney Car Kit 模型或自定义模型（原点在地面，挂进底盘中心系需下移） ---
    this.carLib = carLib;
    this.carGroup = customModel ?? carLib.clone(this.currentType, true);
    this.carGroup.position.y = spec.groundOffset;
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222 });

    this.headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff2cc,
      emissive: 0xfff2cc,
      emissiveIntensity: 0.9,
    });
    const headlightMat = this.headlightMat;
    this.brakeLightMat = new THREE.MeshStandardMaterial({
      color: 0x7a1414,
      emissive: 0xff2222,
      emissiveIntensity: 0.15,
    });
    const lampX = spec.lamps?.x ?? half.x * 0.6;
    const lampY = spec.lamps?.y ?? 0.05;
    const lampZF = spec.lamps?.zFront ?? half.z + 0.01;
    const lampZR = spec.lamps?.zRear ?? -half.z - 0.01;
    const lightGeo = new THREE.BoxGeometry(0.34, 0.14, 0.06);
    const hlL = new THREE.Mesh(lightGeo, headlightMat);
    hlL.position.set(lampX, lampY, lampZF);
    const hlR = hlL.clone();
    hlR.position.x = -lampX;
    const lampXR = spec.lamps?.xRear ?? lampX;
    const tlL = new THREE.Mesh(lightGeo, this.brakeLightMat);
    tlL.position.set(lampXR, lampY, lampZR);
    const tlR = tlL.clone();
    tlR.position.x = -lampXR;
    const lampScale = spec.lamps?.scale ?? 1;
    for (const lamp of [hlL, hlR, tlL, tlR]) lamp.scale.setScalar(lampScale);

    this.mesh = new THREE.Group();
    this.mesh.add(this.carGroup, hlL, hlR, tlL, tlR);
    this.lampMeshes.push(hlL, hlR, tlL, tlR);

    // 夜间真实大灯：两盏前向聚光灯（只给玩家车，成本可控）
    for (const sx of [lampX, -lampX]) {
      const spot = new THREE.SpotLight(0xffeecc, 0, 45, 0.5, 0.45, 1.4);
      spot.position.set(sx, lampY + 0.05, lampZF);
      spot.target.position.set(sx, lampY - 0.65, lampZF + 14);
      this.mesh.add(spot, spot.target);
      this.headlights.push(spot);
    }

    if (!spec.hideWheels) {
      const wheelGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, spec.wheelWidth, 16);
      wheelGeo.rotateZ(Math.PI / 2); // 圆柱轴 Y → X（沿轮轴）
      const rimGeo = new THREE.CylinderGeometry(spec.wheelRadius * 0.5, spec.wheelRadius * 0.5, spec.wheelWidth + 0.02, 8);
      rimGeo.rotateZ(Math.PI / 2);
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.35, metalness: 0.7 });
      for (const p of spec.wheels) {
        const pivot = new THREE.Group();
        pivot.position.set(p.x, p.y - spec.suspRest, p.z);
        pivot.rotation.order = 'YXZ'; // 先转向（Y）再自转（X）
        const wheelMesh = new THREE.Mesh(wheelGeo, darkMat);
        wheelMesh.castShadow = true;
        const rim = new THREE.Mesh(rimGeo, rimMat);
        pivot.add(wheelMesh, rim);
        this.defaultWheelVisuals.push([wheelMesh, rim]);
        this.mesh.add(pivot);
        this.wheelPivots.push(pivot);
      }
    }
    if (!customModel && spec === CAR_SPEC) {
      this.sportsWheelVisuals.push(...carLib.sportsWheels());
      this.updateWheelVisuals();
    }
    scene.add(this.mesh);

    this.prevPos.copy(spawn);
    this.currPos.copy(spawn);
    this.mesh.position.copy(spawn);
  }

  /** 每个物理步开始前调用 */
  beginStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    for (let i = 0; i < 4; i++) {
      this.prevSusp[i] = this.currSusp[i]!;
      this.prevSpin[i] = this.currSpin[i]!;
    }
    this.prevSteer = this.currSteer;
  }

  /** 每个物理步结束后调用 */
  endStep(): void {
    const t = this.chassisBody.translation();
    const r = this.chassisBody.rotation();
    this.currPos.set(t.x, t.y, t.z);
    this.currQuat.set(r.x, r.y, r.z, r.w);
    for (let i = 0; i < 4; i++) {
      this.currSusp[i] = this.controller.wheelSuspensionLength(i) ?? this.spec.suspRest;
      this.currSpin[i] = this.controller.wheelRotation(i) ?? 0;
    }
    this.currSteer = this.steering;
  }

  /**
   * 带符号前进速度（m/s）：底盘线速度在车头方向上的投影。
   * 不用 controller.currentVehicleSpeed()——实测其符号会随机翻转，
   * 导致限速器反向放大引擎力、行驶中被误判"倒溜"而突然全力刹车。
   */
  private forwardSpeed(): number {
    const v = this.chassisBody.linvel();
    const { fx, fy, fz } = forwardOf(this.chassisBody.rotation());
    return v.x * fx + v.y * fy + v.z * fz;
  }

  private readonly impulse = { x: 0, y: 0, z: 0 };
  private readonly torque = { x: 0, y: 0, z: 0 };
  private readonly lastGoodPos = new THREE.Vector3(0, 2, 0);

  fixedUpdate(dt: number, drive: DriveInput): void {
    const speedMs = this.forwardSpeed();

    // —— 水中模式：浮力 + 划水推进（车轮悬不着底，正常动力失效）——
    const t = this.chassisBody.translation();

    // 兜底保险丝：掉出世界拉回地表；物理 NaN（极端求解失稳）用最后已知好位置自愈复位
    const finite = Number.isFinite(t.x + t.y + t.z);
    if (!finite || t.y < -6) {
      const rx = finite ? t.x : this.lastGoodPos.x;
      const rz = finite ? t.z : this.lastGoodPos.z;
      this.chassisBody.setTranslation({ x: rx, y: 2.5, z: rz }, true);
      this.chassisBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.prevPos.set(rx, 2.5, rz);
      this.currPos.copy(this.prevPos);
      this.prevQuat.identity();
      this.currQuat.identity();
      return;
    }
    this.lastGoodPos.set(t.x, t.y, t.z);
    if (chunkZone(Math.round(t.x / CHUNK_SIZE)) === 'ocean' && t.y < FLOAT_ENGAGE_Y) {
      const mass = this.chassisBody.mass();
      const vel = this.chassisBody.linvel();
      const { fx, fz } = forwardOf(this.chassisBody.rotation());

      const thrust = this.isWrecked ? 0 : (this.spec.paddleThrust ?? PADDLE_THRUST);
      const turn = this.spec.paddleTurn ?? PADDLE_TURN;
      this.impulse.x = (fx * drive.throttle * thrust - vel.x * WATER_DRAG) * mass * dt;
      // 浮力弹簧 + 重力补偿（少了 +g 会稳定沉降 g/k ≈ 0.7m，实测过）
      this.impulse.y = ((FLOAT_TARGET_Y - t.y) * BUOY_SPRING - vel.y * BUOY_DAMP + 9.81) * mass * dt;
      this.impulse.z = (fz * drive.throttle * thrust - vel.z * WATER_DRAG) * mass * dt;
      this.chassisBody.applyImpulse(this.impulse, true);

      const av = this.chassisBody.angvel();
      this.torque.x = -av.x * 2 * mass * dt * 0.4;
      this.torque.y = (drive.steer * turn - av.y * 1.5) * mass * dt;
      this.torque.z = -av.z * 2 * mass * dt * 0.4;
      this.chassisBody.applyTorqueImpulse(this.torque, true);
    }

    // 转向：最大转角随车速衰减，再平滑逼近目标角
    const steerLimit = this.spec.steerMax / (1 + Math.abs(speedMs) / this.spec.steerFalloff);
    const targetSteer = drive.steer * steerLimit;
    this.steering += (targetSteer - this.steering) * (1 - Math.exp(-STEER_DAMPING * dt));

    // 油门/刹车仲裁：与行驶方向相反的油门先当刹车用，停稳后才反向驱动
    let engineForce = 0;
    let serviceBrake = IDLE_BRAKE;
    if (drive.throttle > 0) {
      if (speedMs < -0.5) {
        serviceBrake = this.spec.brake;
      } else {
        engineForce =
          drive.throttle * this.spec.engine * Math.max(0, 1 - speedMs / this.spec.topSpeed);
        serviceBrake = 0;
      }
    } else if (drive.throttle < 0) {
      if (speedMs > 0.5) {
        serviceBrake = this.spec.brake;
      } else {
        engineForce =
          drive.throttle *
          this.spec.engine *
          REVERSE_FORCE_RATIO *
          Math.max(0, 1 - Math.abs(speedMs) / REVERSE_TOP_MS);
        serviceBrake = 0;
      }
    }

    if (this.isWrecked) engineForce = 0; // 废车引擎报废

    for (let i = 0; i < this.controller.numWheels(); i++) {
      const front = this.spec.wheels[i]!.front;
      if (front) {
        this.controller.setWheelSteering(i, this.steering);
      } else {
        this.controller.setWheelEngineForce(i, engineForce);
      }
      // 手刹只锁后轮（可甩尾）；行车刹车四轮
      const brake = drive.brake ? (front ? 0 : this.spec.handbrake) : serviceBrake;
      this.controller.setWheelBrake(i, brake);
      // 漂移：拉手刹时后轮侧向抓地骤降，尾部甩出
      this.controller.setWheelSideFrictionStiffness(
        i,
        drive.brake && !front ? DRIFT_SIDE_FRICTION : SIDE_FRICTION,
      );
    }

    // 刹车灯：手刹或行车重刹时点亮
    this.brakeLightMat.emissiveIntensity = drive.brake || serviceBrake >= this.spec.brake ? 2.2 : 0.15;
    // 撞击探测：前向速度骤降（撞墙/撞车）
    this.impactDv = Math.max(0, this.prevForward - speedMs);
    this.prevForward = speedMs;
    // 撞击掉车况
    if (this.impactDv > IMPACT_DMG_MIN) this.damage((this.impactDv - IMPACT_DMG_MIN) * 2.5);

    // 车轮射线要排除底盘与座舱盒自身
    this.controller.updateVehicle(
      dt,
      undefined,
      undefined,
      (c) => c !== this.chassisCollider && c !== this.cabinCollider,
    );
  }

  /**
   * 车头朝向 yaw（弧度），取自插值后的视觉四元数——
   * 追尾相机每帧读取，用物理刚体的 60Hz 步进值会造成相机抖动。
   */
  get visualHeadingYaw(): number {
    // 车头 = 局部 +Z：将 (0,0,1) 旋转后取 XZ 平面方位角
    const { fx, fz } = forwardOf(this.mesh.quaternion);
    return Math.atan2(fx, fz);
  }

  /** 渲染前按 alpha 插值底盘位姿并同步车轮 */
  syncVisual(alpha: number): void {
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);

    // 摩托压弯：转向 × 车速 → 车身侧倾（纯视觉，物理保持直立）
    if (this.spec.lean) {
      const speedK = Math.min(Math.abs(this.prevForward) / 12, 1);
      this.carGroup.rotation.z = -(this.prevSteer + (this.currSteer - this.prevSteer) * alpha) * speedK * 0.8;
    }

    const steer = this.prevSteer + (this.currSteer - this.prevSteer) * alpha;
    for (let i = 0; i < this.wheelPivots.length; i++) {
      const pivot = this.wheelPivots[i]!;
      pivot.position.y =
        this.spec.wheels[i]!.y - (this.prevSusp[i]! + (this.currSusp[i]! - this.prevSusp[i]!) * alpha);
      if (this.currentType !== 'police' && this.sportsWheelVisuals[i]) {
        // 轮心与轮拱保持原模型的位置，悬挂变化仍来自 Rapier。
        pivot.position.y += this.sportsWheelVisuals[i]!.center.y - this.spec.wheelRadius;
      }
      pivot.rotation.y = this.spec.wheels[i]!.front ? steer : 0;
      pivot.rotation.x = this.prevSpin[i]! + (this.currSpin[i]! - this.prevSpin[i]!) * alpha;
    }
  }

  getPosition(out: THREE.Vector3): THREE.Vector3 {
    const t = this.chassisBody.translation();
    return out.set(t.x, t.y, t.z);
  }

  getQuaternion(out: THREE.Quaternion): THREE.Quaternion {
    const r = this.chassisBody.rotation();
    return out.set(r.x, r.y, r.z, r.w);
  }

  /** 插值后的视觉位置（相机跟随用） */
  getVisualPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.mesh.position);
  }

  /** 底盘线速度（行人威胁判定用） */
  getLinvel(out: THREE.Vector3): THREE.Vector3 {
    const v = this.chassisBody.linvel();
    return out.set(v.x, v.y, v.z);
  }

  /** 视觉压弯角（骑手跟随用） */
  get visualLean(): number {
    return this.carGroup.rotation.z;
  }

  /** 当前车型（换车交换用） */
  get carType(): CarType {
    return this.currentType;
  }

  setCarType(type: CarType): void {
    if (type === this.currentType) return;
    this.currentType = type;
    this.mesh.remove(this.carGroup);
    this.carGroup = this.carLib.clone(type, true);
    this.carGroup.position.y = this.spec.groundOffset;
    this.mesh.add(this.carGroup);
    this.updateWheelVisuals();
    if (this.spec.roofHull) this.refreshRoofHull(); // 车壳换了,站立面轮廓也得换
  }

  private updateWheelVisuals(): void {
    if (!this.sportsWheelVisuals.length) return;
    const sports = this.currentType !== 'police';
    for (let i = 0; i < this.wheelPivots.length; i++) {
      const pivot = this.wheelPivots[i]!;
      const visual = this.sportsWheelVisuals[i]!;
      for (const mesh of this.defaultWheelVisuals[i]!) mesh.visible = !sports;
      if (!visual.model.parent) pivot.add(visual.model);
      visual.model.visible = sports;
      pivot.position.x = sports ? visual.center.x : this.spec.wheels[i]!.x;
      pivot.position.z = sports ? visual.center.z : this.spec.wheels[i]!.z;
      this.controller.setWheelChassisConnectionPointCs(i, {
        x: pivot.position.x, y: this.spec.wheels[i]!.y, z: pivot.position.z,
      });
    }
    for (const lamp of this.lampMeshes) lamp.visible = !sports;
    // 原模型灯罩共享几何，但灯光材质必须归当前车辆独享。
    if (sports) {
      for (const name of ['lights', 'leds']) {
        const lamp = this.carGroup.getObjectByName(name);
        if (lamp instanceof THREE.Mesh) lamp.material = this.headlightMat;
      }
      const rear = this.carGroup.getObjectByName('lights_red');
      if (rear instanceof THREE.Mesh) rear.material = this.brakeLightMat;
    }
  }

  /** 重挂当前车型的实测座舱盒（换车型时高度/范围随之更新） */
  private refreshRoofHull(): void {
    if (this.cabinCollider) this.physicsRef.world.removeCollider(this.cabinCollider, false);
    const cabin = this.carLib.colliderBoxes(this.currentType).cabin;
    if (!cabin) {
      this.cabinCollider = null;
      return;
    }
    // 实测盒在车根系（原点在地面），底盘局部系需下移 groundOffset
    this.cabinCollider = this.physicsRef.world.createCollider(
      RAPIER.ColliderDesc.cuboid(cabin.hx, cabin.hy, cabin.hz)
        .setTranslation(0, cabin.cy + this.spec.groundOffset, cabin.cz)
        .setDensity(0),
      this.chassisBody,
    );
  }

  get wrecked(): boolean {
    return this.isWrecked;
  }

  /** 掉车况：归零殉爆成废车（引擎报废，喷漆店可修） */
  damage(n: number): void {
    if (this.isWrecked || n <= 0) return;
    this.condition = Math.max(0, this.condition - n);
    if (this.condition <= 0) {
      this.isWrecked = true;
      this.onExploded?.();
    }
  }

  /** 修复（喷漆店 / 换车借壳） */
  repair(): void {
    this.condition = 100;
    this.isWrecked = false;
  }

  /**
   * 损伤特效（每渲染帧调用）：车况 <50 冒烟、<25 掺火苗、废车浓烟。
   * 粒子池懒创建，材质独立便于各自淡出。
   */
  updateFx(dt: number): void {
    const rate = this.isStashed
      ? 0
      : this.isWrecked
        ? 14
        : this.condition < DAMAGE_FIRE
          ? 10
          : this.condition < DAMAGE_SMOKE
            ? 5
            : 0;
    if (rate > 0) {
      this.fxAcc += dt * rate;
      while (this.fxAcc > 1) {
        this.fxAcc -= 1;
        this.emitFx();
      }
    }
    for (const p of this.fx) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      const k = 1 - p.life / p.max;
      p.mesh.scale.setScalar(0.7 + k * 1.8);
      p.mat.opacity = (1 - k) * 0.55;
    }
  }

  private emitFx(): void {
    let slot = this.fx.find((p) => !p.active);
    if (!slot) {
      if (this.fx.length >= FX_POOL) {
        slot = this.fx.reduce((a, b) => (a.life < b.life ? a : b));
      } else {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x555555,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(Vehicle.FX_GEO, mat);
        this.sceneRef.add(mesh);
        slot = { mesh, mat, life: 0, max: 1, vx: 0, vy: 0, vz: 0, active: false };
        this.fx.push(slot);
      }
    }
    const fire = this.condition < DAMAGE_FIRE && Math.random() < 0.45;
    slot.active = true;
    slot.max = fire ? 0.4 : 1.1;
    slot.life = slot.max;
    slot.mat.color.setHex(fire ? 0xff7a2a : 0x555555);
    slot.mat.blending = fire ? THREE.AdditiveBlending : THREE.NormalBlending;
    slot.vx = (Math.random() - 0.5) * 0.6;
    slot.vy = fire ? 1.0 + Math.random() * 0.6 : 1.4 + Math.random() * 0.7;
    slot.vz = (Math.random() - 0.5) * 0.6;
    // 引擎盖位置（车头方向偏前上方）
    this.scratchFx
      .set((Math.random() - 0.5) * 0.5, 0.55, this.spec.half.z * 0.55)
      .applyQuaternion(this.mesh.quaternion)
      .add(this.mesh.position);
    slot.mesh.position.copy(this.scratchFx);
    slot.mesh.scale.setScalar(0.7);
    slot.mesh.visible = true;
  }

  private readonly scratchFx = new THREE.Vector3();

  /** 剧情暂存中：物理禁用+隐藏（未解锁的剧情奖励载具，也防止落在未加载 chunk 上坠落） */
  get stashed(): boolean {
    return this.isStashed;
  }

  setStashed(on: boolean): void {
    if (this.isStashed === on) return;
    this.isStashed = on;
    this.mesh.visible = !on;
    this.chassisBody.setEnabled(!on);
  }

  /** 瞬移到指定位姿并清空动力学状态（换车人格交换用；y 可指定=空投起始高度） */
  teleportTo(x: number, z: number, yaw: number, y = 0.9): void {
    const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    this.chassisBody.setTranslation({ x, y, z }, true);
    this.chassisBody.setRotation(q, true);
    this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steering = 0;
    this.prevPos.set(x, y, z);
    this.currPos.set(x, y, z);
    this.prevQuat.set(q.x, q.y, q.z, q.w);
    this.currQuat.set(q.x, q.y, q.z, q.w);
    this.prevSteer = 0;
    this.currSteer = 0;
    this.mesh.position.copy(this.currPos);
    this.mesh.quaternion.copy(this.currQuat);
    this.repair(); // 借壳换车 = 换了辆完好的车
  }

  /** 夜色联动：大灯聚光强度 + 灯罩自发光 */
  setNight(n: number): void {
    for (const spot of this.headlights) spot.intensity = 130 * n;
    this.headlightMat.emissiveIntensity = 0.9 + 1.5 * n;
  }

  /** 前向速度 km/h（带符号，倒车为负） */
  get speedKmh(): number {
    return this.forwardSpeed() * 3.6;
  }
}
