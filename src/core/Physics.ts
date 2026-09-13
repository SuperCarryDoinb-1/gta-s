import RAPIER from '@dimforge/rapier3d-compat';

export interface Gravity {
  x: number;
  y: number;
  z: number;
}

const DEFAULT_GRAVITY: Gravity = { x: 0, y: -9.81, z: 0 };

/**
 * Rapier 物理世界封装。
 * 必须通过 `await Physics.create()` 构造（Rapier WASM 需异步初始化）。
 */
export class Physics {
  readonly world: RAPIER.World;

  private constructor(world: RAPIER.World) {
    this.world = world;
  }

  static async create(gravity: Gravity = DEFAULT_GRAVITY): Promise<Physics> {
    await RAPIER.init();
    return new Physics(new RAPIER.World(gravity));
  }

  /** 推进一个固定步长。由 Engine 的 fixedUpdate 驱动。 */
  step(dt: number): void {
    this.world.timestep = dt;
    this.world.step();
  }
}

// setLinvel/applyImpulse 参数对象复用（Rapier 内部拷贝数值，安全）——
// 几十个体×60Hz 的对象分配会喂饱 GC
const VEL = { x: 0, y: 0, z: 0 };

/** 设线速度（复用参数对象，零分配） */
export function setVel(body: RAPIER.RigidBody, x: number, y: number, z: number): void {
  VEL.x = x;
  VEL.y = y;
  VEL.z = z;
  body.setLinvel(VEL, true);
}

/**
 * 爆炸径向掀飞（行人/警察共用）：水平随距离衰减 + 上抛。
 * (dx,dz,d) 为目标相对爆点的偏移与水平距离；调用方自行判过 d ≤ radius。
 */
export function radialBlastImpulse(
  body: RAPIER.RigidBody,
  dx: number,
  dz: number,
  d: number,
  radius: number,
): void {
  const falloff = 1 - d / radius;
  const inv = 1 / Math.max(d, 0.5);
  const mass = body.mass();
  VEL.x = dx * inv * 14 * falloff * mass;
  VEL.y = (6 + 5 * falloff) * mass;
  VEL.z = dz * inv * 14 * falloff * mass;
  body.applyImpulse(VEL, true);
}

// 统一从这里拿 RAPIER 类型/工厂，保证 init() 时序由 Physics.create 管控
export { RAPIER };
