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
  private readonly physics: Physics;
  private readonly person: PersonInstance;
  private currentClip = '';
  private currentAction: THREE.AnimationAction | null = null;
  private isGrounded = false;
  private pose: HandPose = 'none';
  private throwTimer = 0;
  private riding = false;
  private vehiclePose: 'approach' | 'sit' | 'stand' | null = null;
  private carjackHands: [THREE.Vector3, THREE.Vector3] | null = null;

  setCarjackHands(left: THREE.Vector3 | null, right?: THREE.Vector3): void {
    this.carjackHands = left && right ? [left.clone(), right.clone()] : null;
  }
  // 游泳视觉：整体前倾贴水 + 视觉体下沉（碰撞胶囊保持直立不变）
  private swimBlend = 0;
  private swimPitch = 0;
  private swimStrokeBlend = 0;

  // 渲染插值端点（上一物理步/当前物理步）
  private readonly prevPos = new THREE.Vector3();
  private readonly currPos = new THREE.Vector3();
  private prevYaw = 0;
  private currYaw = 0;

  constructor(scene: THREE.Scene, physics: Physics, spawn: THREE.Vector3, personLib: PersonLibrary) {
    this.physics = physics;
    // KayKit 骨骼动画角色（碰撞体仍是胶囊）；root 原点在脚底 → 挂到胶囊中心系下移
    this.person = personLib.spawn('adventurer');
    this.person.root.position.y = -CENTER_ABOVE_FEET;
    this.mesh = new THREE.Group();
    this.mesh.add(this.person.root);
    this.person.root.traverse(o=>{if(o instanceof THREE.Mesh)o.layers.enable(2);});
    scene.add(this.mesh);
    this.play('Idle');
    this.person.mixer.update(0);

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
  moveBy(desired: THREE.Vector3): THREE.Vector3 {
    this.controller.computeColliderMovement(this.collider, desired);
    const m = this.controller.computedMovement();
    const t = this.body.translation();
    const horizontal = Math.hypot(desired.x, desired.z);
    let stepped = false;
    if (this.isGrounded && desired.y <= 0 && horizontal > .001 && Math.hypot(m.x, m.z) < horizontal * .75) {
      // Sweep up, forward, then down for curb corners where the capsule's rounded
      // base makes the built-in autostep stall. Every segment checks clearance.
      const height = .36;
      const cast = (origin: RAPIER.Vector, velocity: RAPIER.Vector, distance: number) => this.physics.world.castShape(
        origin, this.body.rotation(), velocity, this.collider.shape, 0, distance, false,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body,
      );
      if (!cast(t, { x: 0, y: 1, z: 0 }, height)) {
        const raised = { x: t.x, y: t.y + height, z: t.z };
        const forward = { x: desired.x / horizontal, y: 0, z: desired.z / horizontal };
        if (!cast(raised, forward, horizontal)) {
          raised.x += desired.x; raised.z += desired.z;
          const landing = cast(raised, { x: 0, y: -1, z: 0 }, height + .04);
          // A capsule contacting a stair edge has a diagonal normal even though
          // the tread is horizontal; the swept clearance bounds the climb.
          if (landing && landing.normal1.y > .1) {
            m.x = desired.x; m.z = desired.z;
            m.y = height - landing.time_of_impact + KCC_OFFSET;
            stepped = true;
          }
        }
      }
    }
    this.isGrounded = stepped || this.controller.computedGrounded();
    // Rapier can accept the downward stick displacement when the capsule starts
    // just inside its contact offset (notably on adjoining city foundations).
    // Keep the feet above a walkable support surface without teleporting through
    // walls or snapping to floors above the current feet.
    if (desired.y <= 0) {
      this.supportRay.origin.x = t.x + m.x;
      this.supportRay.origin.y = t.y;
      this.supportRay.origin.z = t.z + m.z;
      const hit = this.physics.world.castRayAndGetNormal(
        this.supportRay, CENTER_ABOVE_FEET + KCC_OFFSET + Math.max(.1, -desired.y), false,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body,
      );
      if (hit && hit.normal.y >= Math.cos(50 * DEG)) {
        const supportY = t.y - hit.timeOfImpact + CENTER_ABOVE_FEET + KCC_OFFSET + .001;
        if (Math.abs(supportY - t.y) < .06) this.isGrounded = true;
        if (supportY <= t.y + .08 && t.y + m.y < supportY) {
          m.y = supportY - t.y;
          this.isGrounded = true;
        }
      }
    }
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return this.actualMove.set(m.x, m.y, m.z);
  }

  private readonly actualMove = new THREE.Vector3();
  private readonly supportRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });

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

  getSwimCameraPosition(out:THREE.Vector3):THREE.Vector3 {
    return out.copy(this.mesh.position).addScaledVector(Character.Y_UP,this.swimBlend*.58*(1-this.swimStrokeBlend));
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

  /** Resolve spawn/respawn against the loaded world's actual ground surface. */
  settleOnGround(): boolean {
    const position = this.body.translation();
    const hit = this.physics.world.castRayAndGetNormal(
      new RAPIER.Ray(position, { x: 0, y: -1, z: 0 }), 4, false,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body,
    );
    if (!hit || hit.normal.y < .6) return false;
    this.teleport(new THREE.Vector3(position.x, position.y - hit.timeOfImpact + CENTER_ABOVE_FEET + KCC_OFFSET, position.z));
    this.isGrounded = true;
    this.syncVisual(1);
    return true;
  }

  /** Play each handoff clip once; the manager owns movement until it finishes. */
  setVehiclePose(pose: 'approach' | 'sit' | 'stand' | null, progress = 0): void {
    if (this.vehiclePose !== pose) {
      this.vehiclePose = pose;
      if (!pose) return;
      this.throwTimer = 0;
      this.swimBlend = 0;
      this.carjackHands = null;
      const name = pose === 'approach' ? 'Walking_A' : pose === 'sit' ? 'Sit_Chair_Down' : 'Sit_Chair_StandUp';
      this.play(name, 0.14, pose !== 'approach', pose === 'approach' ? 1.25 : 1);
    }
    if (pose && pose !== 'approach' && this.currentAction) {
      // Sample from the same clock as the path. No extra animation tick on the
      // first/last frame, even when several physics steps occur between renders.
      this.currentAction.paused = true;
      this.currentAction.time = this.currentAction.getClip().duration * THREE.MathUtils.clamp(progress, 0, 1);
    }
  }

  /**
   * 手臂 IK（骑摩托握把用）：把左右臂骨骼链朝目标点瞄准。
   * KayKit 骨骼的肢体延伸方向为骨骼局部 +Y；需在坐姿动画更新与整体贴装之后调用。
   */
  aimArmsAt(leftTarget: THREE.Vector3, rightTarget: THREE.Vector3, weight = 1): void {
    if (weight <= 0) return;
    if (!this.armL.length) {
      this.person.root.traverse((o) => {
        // GLTFLoader sanitizes dots from animation binding names.
        const name = o.name.replaceAll('.', '').toLowerCase();
        if (name === 'upperarml') this.armL[0] = o;
        else if (name === 'lowerarml') this.armL[1] = o;
        else if (name === 'upperarmr') this.armR[0] = o;
        else if (name === 'lowerarmr') this.armR[1] = o;
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
    this.aimArm(this.armL[0]!, this.armL[1]!, leftTarget, weight);
    this.aimArm(this.armR[0]!, this.armR[1]!, rightTarget, weight);
  }

  /** 两段式手臂 IK：上臂按余弦定理偏转（肘部下沉弯曲），前臂再指向目标 */
  private aimArm(upper: THREE.Object3D, lower: THREE.Object3D, target: THREE.Vector3, weight: number): void {
    this.ikOriginalUpper.copy(upper.quaternion);
    this.ikOriginalLower.copy(lower.quaternion);
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

    upper.getWorldQuaternion(this.ikBoneWorld);
    this.ikCurrentDir.copy(Character.Y_UP).applyQuaternion(this.ikBoneWorld);
    this.ikDesired.setFromUnitVectors(this.ikCurrentDir, this.ikAimDir).multiply(this.ikBoneWorld);
    upper.parent!.getWorldQuaternion(this.ikParentQ);
    upper.quaternion.copy(this.ikParentQ.invert()).multiply(this.ikDesired);
    upper.updateMatrixWorld(true);

    // 前臂：从新的肘位直指目标
    lower.getWorldPosition(this.ikPos);
    this.ikDir.copy(target).sub(this.ikPos).normalize();
    lower.getWorldQuaternion(this.ikBoneWorld);
    this.ikCurrentDir.copy(Character.Y_UP).applyQuaternion(this.ikBoneWorld);
    this.ikDesired.setFromUnitVectors(this.ikCurrentDir, this.ikDir).multiply(this.ikBoneWorld);
    lower.parent!.getWorldQuaternion(this.ikParentQ);
    lower.quaternion.copy(this.ikParentQ.invert()).multiply(this.ikDesired);
    // Solve the complete arm first, then blend both bones from the animation.
    // This retains the exact seated pose at weight=1 and releases it continuously.
    upper.quaternion.slerp(this.ikOriginalUpper, 1 - weight);
    lower.quaternion.slerp(this.ikOriginalLower, 1 - weight);
    upper.updateMatrixWorld(true);
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
  private readonly ikOriginalUpper = new THREE.Quaternion();
  private readonly ikOriginalLower = new THREE.Quaternion();
  private readonly ikBoneWorld = new THREE.Quaternion();
  private readonly ikCurrentDir = new THREE.Vector3();

  /** 直接设置高度（楼梯高度场用；插值由 endStep 正常采样，不跳帧） */
  forceY(y: number): void {
    const next = this.body.nextTranslation();
    const current = this.body.translation();
    // A stair correction must pass through the same capsule sweep as walking;
    // changing the body directly left the previous kinematic target behind.
    this.actualMove.set(next.x - current.x, y - current.y, next.z - current.z);
    this.moveBy(this.actualMove);
  }

  /** 瞬移（下车落位用），插值端点一并重置避免拖影 */
  teleport(pos: THREE.Vector3): void {
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    // Clear the previous walking target as well, including teleports between physics ticks.
    this.body.setNextKinematicTranslation(pos);
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.isGrounded = false;
    this.prevPos.copy(pos);
    this.currPos.copy(pos);
    this.mesh.position.copy(pos);
  }

  /** Find nearby footing and reject exits inside a wall or another vehicle. */
  resolveExitPosition(candidate: THREE.Vector3, out: THREE.Vector3): boolean {
    out.copy(candidate);
    const ray = new RAPIER.Ray(
      { x: out.x, y: out.y - CENTER_ABOVE_FEET + 0.65, z: out.z },
      { x: 0, y: -1, z: 0 },
    );
    const hit = this.physics.world.castRayAndGetNormal(
      ray, 2.15, true, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined, this.collider, this.body,
    );
    if (hit && hit.normal.y > 0.6) {
      out.y = ray.origin.y - hit.timeOfImpact + CENTER_ABOVE_FEET + KCC_OFFSET;
    }
    return !this.physics.world.intersectionWithShape(
      out, { x: 0, y: 0, z: 0, w: 1 }, this.collider.shape,
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, this.body,
    );
  }

  /** Restore upright posture and synchronize both interpolation endpoints on dismount. */
  resetOrientation(yaw: number): void {
    this.prevYaw = this.currYaw = yaw;
    this.swimBlend = 0;
    this.mesh.rotation.set(0, yaw, 0, 'YXZ');
  }

  get yaw(): number { return this.currYaw; }

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
  animate(dt: number, speed: number, grounded: boolean, swimming = false, verticalVelocity = 0, airTime = 0, jumping = false): void {
    // 游泳姿态过渡（0=直立 1=贴水），视觉压水由 syncVisual 应用
    this.swimBlend += ((swimming ? 1 : 0) - this.swimBlend) * (1 - Math.exp(-8 * dt));
    const swimMoving = speed > .3 || Math.abs(verticalVelocity) > .3;
    this.swimStrokeBlend += ((swimMoving ? 1 : 0) - this.swimStrokeBlend) * (1 - Math.exp(-8 * dt));
    // Authored clips already contain the horizontal swim / upright tread pose.
    const targetPitch = THREE.MathUtils.clamp(verticalVelocity * .09, -.35, .35);
    this.swimPitch += (targetPitch - this.swimPitch) * (1 - Math.exp(-5 * dt));
    if (this.mesh.visible || this.riding) {
      if (this.vehiclePose) {
        // Keep the one-shot sit/stand action running instead of replacing it with idle/jump.
      } else if (this.carjackHands) {
        this.play('Interact', .12);
      } else if (this.riding) {
        this.play('Sit_Chair_Idle', 0.15); // 骑姿：坐 + 外部整体前倾
      } else if (this.throwTimer > 0) {
        this.throwTimer -= dt; // 投掷一次性动画播完前不切换
      } else if (swimming) {
        this.play(swimMoving ? 'Swim_Forward' : 'Swim_Idle', .25, false, speed > 3 ? 1.15 : 1);
      } else if (!grounded) {
        if(jumping&&this.person.actions.has('Jump_Roll')) {
          if(this.currentClip!=='Jump_Roll')this.play('Jump_Roll',.035,true);
          if(this.currentAction){
            this.currentAction.paused=true;
            // First lift clear of the ground, then complete one full roll over
            // the ascending and descending parts of the 0.8 s ballistic arc.
            const progress=THREE.MathUtils.clamp((airTime-.10)/.61,0,1);
            this.currentAction.time=this.currentAction.getClip().duration*progress;
          }
        } else {
          const clip = verticalVelocity > .05 ? 'Jump_Rise' : 'Jump_Fall';
          if (this.currentClip !== clip) this.play(clip, .08, true);
        }
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
    // Treading water puts the shoulders at the surface; forward swimming is
    // already horizontal in the authored clip. Do not rotate the pose twice.
    this.mesh.position.y -= this.swimBlend * .58 * (1-this.swimStrokeBlend);
    const dYaw = wrapAngle(this.currYaw - this.prevYaw);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.prevYaw + dYaw * alpha;
    this.mesh.rotation.x = this.swimPitch * this.swimBlend;
    this.mesh.rotation.z = 0;
    if (this.carjackHands) this.aimArmsAt(this.carjackHands[0], this.carjackHands[1]);
  }
}
