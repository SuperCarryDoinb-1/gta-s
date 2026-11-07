import * as THREE from 'three';
import { Physics, RAPIER, setVel, radialBlastImpulse } from '../core/Physics';
import { safePedestrianBlockX } from '../world/ShanghaiLayout';
import { CITY_MIN_BLOCK_X, PITCH, PLOT_HEIGHT, SIDEWALK_LINE } from '../world/City';
import { ALL_PERSON_TYPES, type PersonInstance, type PersonLibrary } from '../core/Loader';
import { wrapAngle } from '../core/MathUtil';
import { playClip, placeSkinnedRoot } from '../core/CharacterAnim';
import { HealthBar3D } from '../ui/HealthBar3D';

const COUNT = 26; // 骨骼蒙皮角色比实例化盒子人贵，缩小人口保帧率
const SPAWN_MIN = 30; // 距玩家最近生成距离
const SPAWN_MAX = 100;
const DESPAWN = 130; // 超出即回收重生到玩家附近
const WALK_MIN = 1.1;
const WALK_MAX = 1.9;
const RADIUS = 0.3;
const HALF_CYL = 0.6; // 身高 2*(0.6+0.3) = 1.8m
const ARRIVE_DIST = 0.5;
const YAW_DAMPING = 10;
const CENTER_ABOVE_FEET = 0.9; // 行人胶囊中心距脚底

// 人行道四角，按几何环路顺序
const CORNERS: Array<[number, number]> = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
];

type PedState = 'walk' | 'flee' | 'down';

const FLEE_SPEED = 4.5;
const FLEE_RADIUS = 18; // 车距阈值
const THREAT_CAR_SPEED = 8; // m/s（≈29km/h）以上才算威胁
const KNOCK_SPEED = 6; // 自身速度超过即判定被撞倒
const DOWN_TIME = 2.5;
const MAX_HP = 100;
const KNOCK_DMG = 55; // 被车撞倒一次的伤害（两次撞死）
const DEAD_TIME = 4.5; // 尸体停留时间，然后回收重生

interface Ped {
  body: RAPIER.RigidBody;
  person: PersonInstance;
  currentClip: string;
  currentAction: THREE.AnimationAction | null;
  /** 动画降频累计的未推进时间（远处行人隔几帧才推 mixer） */
  animAcc: number;
  speed: number;
  state: PedState;
  hp: number;
  dead: boolean;
  bar: HealthBar3D;
  /** 所属街区中心（世界坐标，PITCH 的整数倍） */
  bx: number;
  bz: number;
  corner: number;
  dir: 1 | -1;
  pause: number;
  fleeTimer: number;
  downTimer: number;
  /** 逃跑时的威胁点（车的预测位置 / 枪响处 / 爆点） */
  threatX: number;
  threatZ: number;
  yaw: number;
  prevYaw: number;
  readonly target: THREE.Vector3;
  readonly prevPos: THREE.Vector3;
  readonly currPos: THREE.Vector3;
  readonly prevQuat: THREE.Quaternion;
  readonly currQuat: THREE.Quaternion;
}

/**
 * 行人系统（N1 巡走 + N2 反应 AI）：
 * - 固定池 40 人，围绕玩家生成/回收（远处重生到附近，GTA 式环境人口）。
 * - 沿所属街区的人行道环路巡走，到角落后：概率停留、概率过马路换街区、否则继续。
 * - 车辆高速逼近且朝向自己 → 逃离预测落点方向狂奔，威胁解除 1.5s 后回归路线。
 * - 被撞（自身速度突增）→ 解锁旋转真实翻滚倒地，静止后爬起、就近归位。
 * - 渲染：六个部件 InstancedMesh（躯干/头/四肢，共 6 draw call），
 *   每人独立朝向与步行摆动，位置/旋转带渲染插值。
 */
export class Pedestrians {
  private enabled = true;
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    for (const p of this.peds) { p.body.setEnabled(enabled); p.person.root.visible = enabled; if (!enabled) p.bar.hide(); }
  }
  private readonly peds: Ped[] = [];
  /** 刚体句柄 → 行人（子弹伤害查找） */
  private readonly byBody = new Map<number, Ped>();

  /** 玩家开车撞倒行人上报（通缉系统挂钩） */
  onHitByPlayerCar: ((x: number, z: number) => void) | null = null;
  /** 行人倒地掉落现金（经济系统挂钩） */
  onDropMoney: ((x: number, z: number) => void) | null = null;

  private readonly playerRef = new THREE.Vector3();

  constructor(scene: THREE.Scene, physics: Physics, playerPos: THREE.Vector3, personLib: PersonLibrary) {
    for (let i = 0; i < COUNT; i++) {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .lockRotations()
          .setLinearDamping(0.2)
          .setAngularDamping(1.5)
          .setCcdEnabled(true), // 爆炸冲量很大,无 CCD 会被打穿地面嵌进地基
      );
      physics.world.createCollider(RAPIER.ColliderDesc.capsule(HALF_CYL, RADIUS), body);

      const person = personLib.spawn(ALL_PERSON_TYPES[i % ALL_PERSON_TYPES.length]!);
      scene.add(person.root);

      const ped: Ped = {
        body,
        person,
        currentClip: '',
        currentAction: null,
        animAcc: Math.random() * 0.05, // 错开降频行人的更新帧，避免同帧扎堆
        speed: WALK_MIN + Math.random() * (WALK_MAX - WALK_MIN),
        state: 'walk',
        hp: MAX_HP,
        dead: false,
        bar: new HealthBar3D(scene),
        bx: 0,
        bz: 0,
        corner: 0,
        dir: Math.random() < 0.5 ? 1 : -1,
        pause: 0,
        fleeTimer: 0,
        downTimer: 0,
        threatX: 0,
        threatZ: 0,
        yaw: 0,
        prevYaw: 0,
        target: new THREE.Vector3(),
        prevPos: new THREE.Vector3(),
        currPos: new THREE.Vector3(),
        prevQuat: new THREE.Quaternion(),
        currQuat: new THREE.Quaternion(),
      };
      this.respawn(ped, playerPos);
      playClip(ped, 'Walking_A', false, ped.speed / 1.4);
      // 起步相位错开，不齐步走
      if (ped.currentAction) ped.currentAction.time = Math.random() * 2;
      this.peds.push(ped);
      this.byBody.set(body.handle, ped);
    }
  }

  /** 物理步开始：记录插值端点 + AI 驱动速度。需在 physics.step() 前调用 */
  beginStep(dt: number, playerPos: THREE.Vector3, carPos: THREE.Vector3, carVel: THREE.Vector3): void {
    if (!this.enabled) return;
    this.playerRef.copy(playerPos);
    for (const ped of this.peds) {
      ped.prevPos.copy(ped.currPos);
      ped.prevQuat.copy(ped.currQuat);
      ped.prevYaw = ped.yaw;
      this.think(ped, dt, playerPos, carPos, carVel);
    }
  }

  /** 物理步结束：采样新位姿。需在 physics.step() 后调用 */
  endStep(): void {
    if (!this.enabled) return;
    for (const ped of this.peds) {
      const t = ped.body.translation();
      const r = ped.body.rotation();
      ped.currPos.set(t.x, t.y, t.z);
      ped.currQuat.set(r.x, r.y, r.z, r.w);
    }
  }

  /** 渲染前：插值位姿写入骨骼模型根节点，并推进各自动画混合器 */
  syncVisual(alpha: number, dt: number): void {
    if (!this.enabled) return;
    for (const ped of this.peds) {
      placeSkinnedRoot(
        ped.person.root,
        ped.prevPos, ped.currPos,
        ped.prevQuat, ped.currQuat,
        ped.prevYaw, ped.yaw,
        alpha, CENTER_ABOVE_FEET,
      );
      // 动画 LOD：26 套蒙皮骨骼全帧率推进是恒定大头，远处行人降频
      //（35m 内全帧率，75m 内 30Hz，更远 15Hz；累计 dt 一次推进，动画节奏不变）
      ped.animAcc += dt;
      const dx = ped.currPos.x - this.playerRef.x;
      const dz = ped.currPos.z - this.playerRef.z;
      const d2 = dx * dx + dz * dz;
      const interval = d2 < 35 * 35 ? 0 : d2 < 75 * 75 ? 1 / 30 : 1 / 15;
      if (ped.animAcc >= interval) {
        ped.person.mixer.update(ped.animAcc);
        ped.animAcc = 0;
      }
      // 头顶血条：挂过伤才显示，死亡即隐藏
      ped.bar.update(
        ped.person.root.position.x,
        ped.person.root.position.y + 2.05,
        ped.person.root.position.z,
        ped.hp / MAX_HP,
        !ped.dead,
        this.playerRef,
      );
    }
  }

  private think(
    ped: Ped,
    dt: number,
    playerPos: THREE.Vector3,
    carPos: THREE.Vector3,
    carVel: THREE.Vector3,
  ): void {
    const t = ped.body.translation();

    // 出了活动圈 → 回收到玩家附近
    const pdx = t.x - playerPos.x;
    const pdz = t.z - playerPos.z;
    // y<-2.5：城市/沙滩没有任何合法位置低于此——嵌进地里或坠出世界都直接回收
    if (pdx * pdx + pdz * pdz > DESPAWN * DESPAWN || t.y < -2.5) {
      this.respawn(ped, playerPos);
      return;
    }

    const vel = ped.body.linvel();
    const horizSpeed = Math.hypot(vel.x, vel.z);

    // 倒地：死者停尸计时后回收；活人等翻滚停下再爬起
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer > 0) return;
      if (ped.dead) this.respawn(ped, playerPos);
      else if (horizSpeed < 1.2) this.standUp(ped);
      return;
    }

    // 被撞判定：自身速度突增 → 掉血 + 解锁旋转，真实翻滚 + 倒地动画
    if (horizSpeed > KNOCK_SPEED) {
      ped.hp -= KNOCK_DMG;
      ped.dead = ped.hp <= 0;
      ped.state = 'down';
      ped.downTimer = ped.dead ? DEAD_TIME : DOWN_TIME;
      ped.body.setEnabledRotations(true, true, true, true);
      playClip(ped, 'Death_A', true, 1, 0.08);
      // 玩家的车又近又快 → 算玩家撞的
      if (
        Math.hypot(t.x - carPos.x, t.z - carPos.z) < 6 &&
        Math.hypot(carVel.x, carVel.z) > 5
      ) {
        this.onHitByPlayerCar?.(t.x, t.z);
      }
      if (ped.dead || Math.random() < 0.6) this.onDropMoney?.(t.x, t.z);
      return;
    }

    // 威胁评估：车够近、够快、并朝自己开
    const cdx = t.x - carPos.x;
    const cdz = t.z - carPos.z;
    const carDist = Math.hypot(cdx, cdz);
    const carSpeed = Math.hypot(carVel.x, carVel.z);
    if (carDist < FLEE_RADIUS && carSpeed > THREAT_CAR_SPEED) {
      const closing = (carVel.x * cdx + carVel.z * cdz) / (carSpeed * Math.max(carDist, 0.01));
      if (closing > 0.5) {
        ped.state = 'flee';
        ped.fleeTimer = 1.5;
        ped.pause = 0;
        // 威胁点 = 车 0.5s 后的预测位置
        ped.threatX = carPos.x + carVel.x * 0.5;
        ped.threatZ = carPos.z + carVel.z * 0.5;
      }
    }

    if (ped.state === 'flee') {
      ped.fleeTimer -= dt;
      if (ped.fleeTimer <= 0) {
        this.rehome(ped, t.x, t.z);
        ped.state = 'walk';
      } else {
        const fx = t.x - ped.threatX;
        const fz = t.z - ped.threatZ;
        const fd = Math.max(Math.hypot(fx, fz), 0.01);
        setVel(ped.body, (fx / fd) * FLEE_SPEED, vel.y, (fz / fd) * FLEE_SPEED);
        this.faceAndStride(ped, fx / fd, fz / fd, FLEE_SPEED, dt);
        return;
      }
    }

    if (ped.pause > 0) {
      ped.pause -= dt;
      playClip(ped, 'Idle');
      setVel(ped.body, 0, vel.y, 0);
      return;
    }

    const tx = ped.target.x - t.x;
    const tz = ped.target.z - t.z;
    const dist = Math.hypot(tx, tz);

    if (dist < ARRIVE_DIST) {
      this.pickNextTarget(ped);
      return;
    }

    setVel(ped.body, (tx / dist) * ped.speed, vel.y, (tz / dist) * ped.speed);
    this.faceAndStride(ped, tx / dist, tz / dist, ped.speed, dt);
  }

  /** 朝移动方向平滑转身 + 播放对应移速的走/跑剪辑 */
  private faceAndStride(ped: Ped, dx: number, dz: number, speed: number, dt: number): void {
    const targetYaw = Math.atan2(-dx, -dz);
    ped.yaw += wrapAngle(targetYaw - ped.yaw) * (1 - Math.exp(-YAW_DAMPING * dt));
    if (speed > 3) playClip(ped, 'Running_A', false, 1.15);
    else playClip(ped, 'Walking_A', false, Math.max(0.8, speed / 1.4));
  }

  /** 遍历所有行人位置（小地图用） */
  forEachPed(cb: (x: number, z: number) => void): void {
    for (const ped of this.peds) cb(ped.currPos.x, ped.currPos.z);
  }

  /**
   * 子弹伤害：按刚体句柄找行人扣血。归零 → 倒地死亡（掉钱）；未死 → 惊逃。
   * 返回是否命中了本系统的行人（main 用来分流给警察系统）。
   */
  applyBulletDamage(body: RAPIER.RigidBody, dmg: number): boolean {
    const ped = this.byBody.get(body.handle);
    if (!ped) return false;
    if (ped.dead) return true;
    ped.hp -= dmg;
    const t = ped.body.translation();
    if (ped.hp <= 0) {
      this.killPed(ped);
      this.onDropMoney?.(t.x, t.z);
    } else if (ped.state !== 'down') {
      // 没死 → 从玩家方向惊逃
      ped.state = 'flee';
      ped.fleeTimer = 3;
      ped.pause = 0;
      ped.threatX = this.playerRef.x;
      ped.threatZ = this.playerRef.z;
    }
    return true;
  }

  /** 击杀：倒地翻滚 + 停尸计时（到点回收重生） */
  private killPed(ped: Ped): void {
    ped.dead = true;
    ped.hp = 0;
    ped.state = 'down';
    ped.downTimer = DEAD_TIME;
    ped.body.setEnabledRotations(true, true, true, true);
    playClip(ped, 'Death_A', true, 1, 0.08);
  }

  /** 枪声/爆炸惊吓：半径内行人丢下一切逃离该点 */
  panicAt(x: number, z: number, radius: number): void {
    for (const ped of this.peds) {
      if (ped.state === 'down') continue;
      const t = ped.body.translation();
      if (Math.hypot(t.x - x, t.z - z) > radius) continue;
      ped.state = 'flee';
      ped.fleeTimer = 2.5;
      ped.pause = 0;
      ped.threatX = x;
      ped.threatZ = z;
    }
  }

  /** 爆炸冲击：半径内行人被径向掀飞并按距离掉血（近爆必死） */
  applyExplosion(center: THREE.Vector3, radius: number): void {
    for (const ped of this.peds) {
      const t = ped.body.translation();
      const dx = t.x - center.x;
      const dz = t.z - center.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      radialBlastImpulse(ped.body, dx, dz, d, radius);
      if (!ped.dead) {
        ped.hp -= 130 * (1 - d / radius);
        if (ped.hp <= 0) {
          this.killPed(ped);
          this.onDropMoney?.(t.x, t.z);
        }
      }
    }
    this.panicAt(center.x, center.z, radius * 4);
  }

  /** 爬起：转正、锁回旋转、就近归位 */
  private standUp(ped: Ped): void {
    const t = ped.body.translation();
    ped.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    ped.body.setTranslation({ x: t.x, y: t.y + 0.4, z: t.z }, true);
    ped.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ped.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ped.body.setEnabledRotations(false, false, false, true);
    this.rehome(ped, t.x, t.z);
    ped.state = 'walk';
    playClip(ped, 'Lie_StandUp', true, 1.4, 0.1);
  }

  /** 归位：认领最近的街区和最近的角落作为新路线 */
  private rehome(ped: Ped, x: number, z: number): void {
    ped.bx = Math.round(x / PITCH) * PITCH;
    ped.bz = Math.round(z / PITCH) * PITCH;
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < CORNERS.length; c++) {
      const [sx, sz] = CORNERS[c]!;
      const d = Math.hypot(
        ped.bx + sx * SIDEWALK_LINE - x,
        ped.bz + sz * SIDEWALK_LINE - z,
      );
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    ped.corner = best;
    this.setTargetFromCorner(ped);
  }

  /** 到达角落后的决策：停留 / 过马路换街区 / 继续环路 */
  private pickNextTarget(ped: Ped): void {
    const roll = Math.random();
    if (roll < 0.2) {
      ped.pause = 1 + Math.random() * 3;
      return;
    }
    if (roll < 0.5) {
      // 过马路：当前角落 (sx,sz) 沿随机一条邻路跨到对面街区的对应角
      const [sx, sz] = CORNERS[ped.corner]!;
      if (Math.random() < 0.5) {
        ped.bx += sx * PITCH;
        ped.corner = CORNERS.findIndex(([a, b]) => a === -sx && b === sz);
      } else {
        ped.bz += sz * PITCH;
        ped.corner = CORNERS.findIndex(([a, b]) => a === sx && b === -sz);
      }
    } else {
      ped.corner = (ped.corner + ped.dir + CORNERS.length) % CORNERS.length;
    }
    this.setTargetFromCorner(ped);
  }

  private setTargetFromCorner(ped: Ped): void {
    const [sx, sz] = CORNERS[ped.corner]!;
    ped.target.set(ped.bx + sx * SIDEWALK_LINE, 0, ped.bz + sz * SIDEWALK_LINE);
  }

  private respawn(ped: Ped, playerPos: THREE.Vector3): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
    // 吸附到最近的街区中心；夹紧到城市区（沙滩/海里不刷人）
    ped.bx = Math.max(
      Math.round((playerPos.x + Math.cos(angle) * dist) / PITCH) * PITCH,
      CITY_MIN_BLOCK_X,
    );
    ped.bz = Math.round((playerPos.z + Math.sin(angle) * dist) / PITCH) * PITCH;
    ped.bx = safePedestrianBlockX(ped.bx, ped.bz);
    ped.corner = Math.floor(Math.random() * CORNERS.length);
    ped.dir = Math.random() < 0.5 ? 1 : -1;
    ped.pause = 0;

    const [sx, sz] = CORNERS[ped.corner]!;
    const y = PLOT_HEIGHT + HALF_CYL + RADIUS + 0.05;
    const px = ped.bx + sx * SIDEWALK_LINE;
    const pz = ped.bz + sz * SIDEWALK_LINE;
    ped.body.setTranslation({ x: px, y, z: pz }, true);
    ped.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ped.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ped.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    ped.body.setEnabledRotations(false, false, false, true);
    ped.state = 'walk';
    ped.hp = MAX_HP;
    ped.dead = false;
    ped.bar.hide();
    ped.fleeTimer = 0;
    ped.downTimer = 0;
    ped.yaw = Math.random() * Math.PI * 2;
    ped.prevYaw = ped.yaw;
    ped.prevPos.set(px, y, pz);
    ped.currPos.set(px, y, pz);
    ped.prevQuat.identity();
    ped.currQuat.identity();

    // 目标设为环路下一个角，立刻开始走
    ped.corner = (ped.corner + ped.dir + CORNERS.length) % CORNERS.length;
    this.setTargetFromCorner(ped);
  }
}
