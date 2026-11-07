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
  private readonly vehicles: RAPIER.RigidBody[] = [];
  private readonly contactImpulse = { x: 0, y: 0, z: 0 };

  private constructor(world: RAPIER.World) {
    this.world = world;
    world.maxCcdSubsteps = 4;
  }

  registerVehicle(body: RAPIER.RigidBody): void {
    this.vehicles.push(body);
  }

  /** Sweep both moving hulls: Rapier's size-based CCD threshold can miss a
   * sub-metre corner impact on a long car. Remove only the impending closing
   * velocity; the solver still owns contact, sliding and separation. */
  private predictVehicleContacts(dt: number): void {
    for (let i = 0; i < this.vehicles.length; i++) {
      const a = this.vehicles[i]!;
      if (!a.isEnabled()) continue;
      for (let j = i + 1; j < this.vehicles.length; j++) {
        const b = this.vehicles[j]!;
        if (!b.isEnabled() || (a.isSleeping() && b.isSleeping())) continue;
        const p = a.translation(), p2 = b.translation();
        const v = a.linvel(), v2 = b.linvel();
        const reach = 10 + (Math.hypot(v.x, v.y, v.z) + Math.hypot(v2.x, v2.y, v2.z)) * dt;
        if ((p.x - p2.x) ** 2 + (p.y - p2.y) ** 2 + (p.z - p2.z) ** 2 > reach * reach) continue;
        let earliest: RAPIER.ColliderShapeCastHit | null = null;
        let source: RAPIER.Collider | null = null;
        for (let x = 0; x < a.numColliders(); x++) {
          const collider = a.collider(x);
          if (!collider.isEnabled() || collider.isSensor()) continue;
          for (let y = 0; y < b.numColliders(); y++) {
            const other = b.collider(y);
            if (!other.isEnabled() || other.isSensor()) continue;
            const hit = collider.castCollider(v, other, v2, 0.025, dt, false);
            if (hit && (!earliest || hit.time_of_impact < earliest.time_of_impact)) {
              earliest = hit; source = collider;
            }
          }
        }
        if (!earliest || !source) continue;
        const n = earliest.normal1, q = source.rotation();
        // Rotate the cast's local normal into world coordinates.
        const tx = 2 * (q.y * n.z - q.z * n.y);
        const ty = 2 * (q.z * n.x - q.x * n.z);
        const tz = 2 * (q.x * n.y - q.y * n.x);
        const nx = n.x + q.w * tx + q.y * tz - q.z * ty;
        const ny = n.y + q.w * ty + q.z * tx - q.x * tz;
        const nz = n.z + q.w * tz + q.x * ty - q.y * tx;
        const closing = (v.x - v2.x) * nx + (v.y - v2.y) * ny + (v.z - v2.z) * nz;
        if (closing <= 0) continue;
        const inverseMass = a.invMass() + b.invMass();
        if (inverseMass <= 0) continue;
        const magnitude = closing * (1 - Math.max(0, earliest.time_of_impact) / dt) / inverseMass;
        this.contactImpulse.x = -nx * magnitude;
        this.contactImpulse.y = -ny * magnitude;
        this.contactImpulse.z = -nz * magnitude;
        a.applyImpulse(this.contactImpulse, true);
        this.contactImpulse.x *= -1;
        this.contactImpulse.y *= -1;
        this.contactImpulse.z *= -1;
        b.applyImpulse(this.contactImpulse, true);
      }
    }
  }

  static async create(gravity: Gravity = DEFAULT_GRAVITY): Promise<Physics> {
    await RAPIER.init();
    return new Physics(new RAPIER.World(gravity));
  }

  /** 推进一个固定步长。由 Engine 的 fixedUpdate 驱动。 */
  step(dt: number): void {
    this.world.timestep = dt;
    this.predictVehicleContacts(dt);
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
