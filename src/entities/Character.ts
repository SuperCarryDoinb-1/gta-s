import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { PersonInstance, PersonLibrary } from '../core/Loader';
import { wrapAngle } from '../core/MathUtil';

/** 手部姿态：徒手 / 单手举枪 / 双手端枪 / 持雷 */
export type HandPose = 'none' | 'pistol' | 'mg' | 'grenade';

const RADIUS = 0.35;
const HALF_HEIGHT = 0.6; // 圆柱段半高 → 胶囊总高 2*(0.6+0.35) = 1.9m
const KCC_OFFSET = 0.02;
const DEG = Math.PI / 180;
const CENTER_ABOVE_FEET = 0.95;

/**
 * 玩家角色：胶囊 mesh + kinematicPositionBased 刚体 + KinematicCharacterController。
 * 只负责"带碰撞修正的位移执行"与位姿同步；速度/跳跃/状态机等逻辑在 gameplay 层。
 */
export class Character {
  readonly mesh: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly controller: RAPIER.KinematicCharacterController;
  private readonly person: PersonInstance;
  private currentClip = '';
  private currentAction: THREE.AnimationAction | null = null;
  private isGrounded = false;
  private pose: HandPose = 'none';
  private throwTimer = 0;
  private riding = false;
  private carjackHands: [THREE.Vector3, THREE.Vector3] | null = null;

  setCarjackHands(left: THREE.Vector3 | null, right?: THREE.Vector3): void {
    this.carjackHands = left && right ? [left.clone(), right.clone()] : null;
  }
  // 游泳视觉：整体前倾贴水 + 视觉体下沉（碰撞胶囊保持直立不变）
  private swimBlend = 0;

  // 渲染插值端点（上一物理步/当前物理步）
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private prevYaw = 0;
  private currYaw = 0;

  constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3, personLib: PersonLibrary) {
    // KayKit 骨骼动画角色（碰撞体仍是胶囊）；root 原点在脚底 → 挂到胶囊中心系下移
    this.person = personLib.spawn('Knight');
    this.person.root.position.y = -CENTER_ABOVE_FEET;
    this.mesh = new THREE.Group();
    this.mesh.add(this.person.root);
    scene.add(this.mesh);
    this.play('Idle');

    this.body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(HALF_HEIGHT, RADIUS),
      this.body,
    );

    this.controller = physics.world.createCharacterController(KCC_OFFSET);
    this.controller.enableAutostep(0.65, 0.2, true); // 可迈上 0.65m：台阶 + 从引擎盖跨上车顶
    this.controller.enableSnapToGround(0.3); // 下坡贴地，不"飘"
    this.controller.setMaxSlopeClimbAngle(50 * DEG);
    this.controller.setMinSlopeSlideAngle(55 * DEG);
    this.controller.setApplyImpulsesToDynamicBodies(true); // 能推动动态刚体

    this.prevPos.copy(spawn);
    this.currPos.copy(spawn);
    this.mesh.position.copy(spawn);
  }

  /**
   * 期望位移（已含 dt）→ KCC 碰撞修正 → 提交给刚体。
   * 需在 physics.step() 之前调用。
   */
  moveBy(desired: THREE.Vector3): void {
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    this.isGrounded = this.controller.computedGrounded();
  }

  get grounded(): boolean {
    return this.isGrounded;
  }

  /** 将刚体平移写入 out，避免每帧分配 */
  getPosition(out: THREE.Vector3): THREE.Vector3 {
    const t = this.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  /** 插值后的视觉位置（相机跟随用，避免 60Hz 步进抖动） */
  getVisualPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.mesh.position);
  }

  /** 上/下车（封闭座舱）：隐藏视觉体并禁用碰撞体（反之亦然） */
  setActive(active: boolean): void {
    this.mesh.visible = active;
    this.collider.setEnabled(active);
  }

  /**
   * 骑乘（敞座载具如摩托）：碰撞体关闭但人保持可见，
   * 位姿由外部每帧贴装到车上（见 main），动画切坐姿。
   */
  setRiding(riding: boolean): void {
    this.riding = riding;
    this.mesh.visible = true;
    this.collider.setEnabled(!riding);
  }

  get isRiding(): boolean {
    return this.riding;
  }

  /**
   * 手臂 IK（骑摩托握把用）：把左右臂骨骼链朝目标点瞄准。
   * KayKit 骨骼的肢体延伸方向为骨骼局部 +Y；需在坐姿动画更新与整体贴装之后调用。
   */
  aimArmsAt(leftTarget: THREE.Vector3, rightTarget: THREE.Vector3): void {
    if (!this.armL.length) {
      this.person.root.traverse((o) => {
        if (o.name === 'upperarm.l') this.armL[0] = o;
        else if (o.name === 'lowerarm.l') this.armL[1] = o;
        else if (o.name === 'upperarm.r') this.armR[0] = o;
        else if (o.name === 'lowerarm.r') this.armR[1] = o;
      });
      if (!this.armL.length) return;
      // 实测骨长：上臂 = 肩→肘，前臂+手 ≈ 肘→掌
      this.mesh.updateMatrixWorld(true);
      const a = this.ikPos;
      const b = this.ikDir;
      this.armL[0]!.getWorldPosition(a);
      this.armL[1]!.getWorldPosition(b);
      this.upperLen = a.distanceTo(b);
      this.lowerLen = this.upperLen * 1.35; // 前臂+手略长于上臂
    }
    this.mesh.updateMatrixWorld(true);
    this.aimArm(this.armL[0]!, this.armL[1]!, leftTarget);
    this.aimArm(this.armR[0]!, this.armR[1]!, rightTarget);
  }

  /** 两段式手臂 IK：上臂按余弦定理偏转（肘部下沉弯曲），前臂再指向目标 */
  private aimArm(upper: THREE.Object3D, lower: THREE.Object3D, target: THREE.Vector3): void {
    upper.getWorldPosition(this.ikPos);
    this.ikDir.copy(target).sub(this.ikPos);
    const d = Math.max(this.ikDir.length(), 0.05);
    this.ikDir.normalize();

    // 肩部偏角 β：手够得着时肘要弯，上臂偏离肩→目标连线 β 角
    const U = this.upperLen;
    const W = this.lowerLen;
    const cosB = Math.min(1, Math.max(-1, (U * U + d * d - W * W) / (2 * U * d)));
    const beta = Math.acos(cosB);
    // 肘沉方向：绕"肩→目标 × 世界上"轴向下偏转
    this.ikAxis.crossVectors(this.ikDir, Character.Y_UP).normalize();
    this.ikBend.setFromAxisAngle(this.ikAxis, -beta);
    this.ikAimDir.copy(this.ikDir).applyQuaternion(this.ikBend);

    upper.parent!.getWorldQuaternion(this.ikParentQ);
    this.ikDesired.setFromUnitVectors(Character.Y_UP, this.ikAimDir);
    upper.quaternion.copy(this.ikParentQ.invert()).multiply(this.ikDesired);
    upper.updateMatrixWorld(true);

    // 前臂：从新的肘位直指目标
    lower.getWorldPosition(this.ikPos);
    this.ikDir.copy(target).sub(this.ikPos).normalize();
    lower.parent!.getWorldQuaternion(this.ikParentQ);
    this.ikDesired.setFromUnitVectors(Character.Y_UP, this.ikDir);
    lower.quaternion.copy(this.ikParentQ.invert()).multiply(this.ikDesired);
    lower.updateMatrixWorld(true);
  }

  private static readonly Y_UP = new THREE.Vector3(0, 1, 0);
  private readonly armL: THREE.Object3D[] = [];
  private readonly armR: THREE.Object3D[] = [];
  private upperLen = 0.23;
  private lowerLen = 0.31;
  private readonly ikPos = new THREE.Vector3();
  private readonly ikDir = new THREE.Vector3();
  private readonly ikAimDir = new THREE.Vector3();
  private readonly ikAxis = new THREE.Vector3();
  private readonly ikBend = new THREE.Quaternion();
  private readonly ikParentQ = new THREE.Quaternion();
  private readonly ikDesired = new THREE.Quaternion();

  /** 直接设置高度（楼梯高度场用；插值由 endStep 正常采样，不跳帧） */
  forceY(y: number): void {
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x, y, z: t.z }, true);
  }

  /** 瞬移（下车落位用），插值端点一并重置避免拖影 */
  teleport(pos: THREE.Vector3): void {
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.prevPos.copy(pos);
    this.currPos.copy(pos);
    this.mesh.position.copy(pos);
  }

  /** 设置朝向（yaw 弧度，0 = 面向 -Z），渲染时插值 */
  setYaw(yaw: number): void {
    this.currYaw = yaw;
  }

  /** 每个物理步开始前调用：当前端点变为上一端点 */
  beginStep(): void {
    this.prevPos.copy(this.currPos);
    this.prevYaw = this.currYaw;
  }

  /** 每个物理步结束后调用：记录新端点 */
  endStep(): void {
    const t = this.body.translation();
    this.currPos.set(t.x, t.y, t.z);
  }

  /** 设置手部姿态（由武器系统驱动） */
  setPose(pose: HandPose): void {
    this.pose = pose;
  }

  /** 播放投掷动作 */
  playThrow(): void {
    this.throwTimer = 0.8;
    this.play('Throw', 0.06, true);
  }

  /** 武器模型挂载点（右手骨骼挂点） */
  get rightHandAnchor(): THREE.Object3D {
    return this.person.handSlotR ?? this.mesh;
  }

  /** 剪辑切换（同名跳过，交叉淡入） */
  private play(name: string, fade = 0.22, once = false, timeScale = 1): void {
    const action = this.person.actions.get(name);
    if (!action) return;
    if (this.currentClip === name && !once) {
      action.timeScale = timeScale;
      return;
    }
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.timeScale = timeScale;
    if (this.currentAction && this.currentAction !== action) {
      action.crossFadeFrom(this.currentAction, fade, false);
    }
    action.play();
    this.currentAction = action;
    this.currentClip = name;
  }

  /** 每帧调用：按运动/武器状态选择动画剪辑并推进混合器 */
  animate(dt: number, speed: number, grounded: boolean, swimming = false): void {
    // 游泳姿态过渡（0=直立 1=贴水），视觉压水由 syncVisual 应用
    this.swimBlend += ((swimming ? 1 : 0) - this.swimBlend) * (1 - Math.exp(-8 * dt));
    if (this.mesh.visible) {
      if (this.carjackHands) {
        this.play('Interact', .12);
      } else if (this.riding) {
        this.play('Sit_Chair_Idle', 0.15); // 骑姿：坐 + 外部整体前倾
      } else if (this.throwTimer > 0) {
        this.throwTimer -= dt; // 投掷一次性动画播完前不切换
      } else if (swimming) {
        this.play('Walking_A', 0.25, false, 1.6); // 身体前倾贴水 + 快步频 ≈ 划水
      } else if (!grounded) {
        this.play('Jump_Idle', 0.12);
      } else if (speed > 6.5) {
        this.play('Running_A');
      } else if (speed > 0.1) {
        this.play('Walking_A', 0.22, false, Math.max(0.9, speed / 4));
      } else if (this.pose === 'pistol' || this.pose === 'grenade') {
        this.play('1H_Ranged_Aiming');
      } else if (this.pose === 'mg') {
        this.play('2H_Ranged_Aiming');
      } else {
        this.play('Idle');
      }
      this.person.mixer.update(dt);
    }
  }

  /** 渲染前按 alpha 在两个物理步之间插值；游泳时视觉体前倾贴水并下沉；骑乘时由外部贴装 */
  syncVisual(alpha: number): void {
    if (this.riding) return;
    this.mesh.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.mesh.position.y -= this.swimBlend * 0.42;
    const dYaw = wrapAngle(this.currYaw - this.prevYaw);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.prevYaw + dYaw * alpha;
    this.mesh.rotation.x = -1.25 * this.swimBlend;
    if (this.carjackHands) this.aimArmsAt(this.carjackHands[0], this.carjackHands[1]);
  }
}
