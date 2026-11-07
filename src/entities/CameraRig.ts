import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { MouseDelta } from '../core/Input';
import { wrapAngle } from '../core/MathUtil';
import { waterSurfaceHeight } from '../world/WaterDomain';

const SENSITIVITY = 0.0025; // 弧度/像素
const PITCH_MIN = -20 * (Math.PI / 180);
const PITCH_MAX = 70 * (Math.PI / 180);
const DISTANCE = 6;
const HEAD_OFFSET = 1.5; // 注视点在脚底上方的高度
const PROBE_RADIUS = 0.25; // 球形探测半径，给相机留出安全间隙
const EXPAND_SPEED = 8; // 遮挡解除后拉远的阻尼系数
const CHASE_SHRINK_SPEED = 22; // 驾驶时拉近的阻尼系数：快但不瞬移（瞬移=开车穿楼群时持续的画面急跳）
// 追尾模式
const CHASE_DISTANCE = 6.5;
const CHASE_HEAD_OFFSET = 1.3;
const CHASE_PITCH_MIN = -5 * (Math.PI / 180);
const CHASE_YAW_FOLLOW = 5; // 相机 yaw 追赶车头朝向的阻尼
const CHASE_RECENTER = 1.2; // 鼠标环视偏移的自动回中速率
const CHASE_DIST_PER_KMH = 1 / 40; // 每 km/h 拉远的米数（上限见下）
const CHASE_DIST_MAX_EXTRA = 2.5;
const TARGET_BLEND_TIME = 0.32;

/**
 * 第三人称相机，两种模式共享 yaw/pitch/距离状态（切换时无跳切）：
 * - update：步行轨道模式，鼠标直接控制 yaw/pitch。
 * - updateChase：驾驶追尾模式，yaw 阻尼跟随车头，鼠标做临时环视（自动回中），
 *   距离随车速拉远。
 * 两种模式都做球形 shape cast 防穿墙——拉近瞬时，拉远带阻尼。
 */
export class CameraRig {
  private yaw = 0;
  private pitch = 20 * (Math.PI / 180);
  private currentDistance = DISTANCE;
  private chaseYawOffset = 0;
  private chasing = false;
  private swimming = false;
  private readonly flightUp = new THREE.Vector3();
  private flightPitchBias = 0;
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private zoom = 1; // 滚轮缩放系数（乘在目标距离上），朝 zoomTarget 阻尼过渡
  private zoomTarget = 1;

  private readonly camera: THREE.PerspectiveCamera;
  private readonly physics: Physics;
  private exclude: RAPIER.Collider;
  private readonly probe = new RAPIER.Ball(PROBE_RADIUS);

  private readonly target = new THREE.Vector3();
  private readonly offsetDir = new THREE.Vector3();
  private readonly targetOffset = new THREE.Vector3();
  private hasTarget = false;
  private targetChanged = false;
  private targetBlend = 0;
  private previousExclude: RAPIER.Collider | null = null;
  private readonly transitionFilter = (collider: RAPIER.Collider): boolean => {
    const previous = this.previousExclude;
    if (!previous) return true;
    return collider.handle !== previous.handle && collider.parent()?.handle !== previous.parent()?.handle;
  };

  constructor(camera: THREE.PerspectiveCamera, physics: Physics, excludeCollider: RAPIER.Collider) {
    this.camera = camera;
    this.physics = physics;
    this.exclude = excludeCollider;
  }

  /** 切换跟随目标时更新墙体探测要排除的碰撞体（角色胶囊/载具底盘） */
  setExcludeCollider(collider: RAPIER.Collider): void {
    if (collider === this.exclude) return;
    this.previousExclude = this.exclude;
    this.exclude = collider;
    this.targetChanged = this.hasTarget;
  }

  /** 滚轮缩放：向上滚拉近、向下滚拉远（指数映射；实际缩放带阻尼跟随，丝滑不跳档） */
  reset(yaw = 0, zoom = 1, pitch = .18): void {
    this.yaw = yaw; this.pitch = THREE.MathUtils.clamp(pitch, PITCH_MIN, PITCH_MAX);
    this.zoom = this.zoomTarget = zoom; this.currentDistance = DISTANCE * zoom;
    this.targetBlend = 0; this.targetChanged = false; this.hasTarget = false;
    this.previousExclude = null; this.chasing = false;
    this.swimming=false;
  }

  applyWheel(deltaY: number): void {
    if (deltaY === 0) return;
    this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * Math.exp(deltaY * 0.0011), 0.35, 2.8);
  }

  private smoothZoom(dt: number): void {
    this.zoom += (this.zoomTarget - this.zoom) * (1 - Math.exp(-10 * dt));
  }

  /** 步行模式。feetPos 为角色脚底（刚体中心）位置。 */
  update(dt: number, feetPos: THREE.Vector3, mouse: MouseDelta): void {
    this.resetFlightView(dt);
    this.swimming=false;
    this.chasing = false;
    this.yaw -= mouse.x * SENSITIVITY;
    this.pitch = THREE.MathUtils.clamp(this.pitch + mouse.y * SENSITIVITY, PITCH_MIN, PITCH_MAX);
    this.smoothZoom(dt);
    // 缩放变化期间拉近走阻尼通道（瞬时通道只留给防穿墙）
    const zooming = Math.abs(this.zoomTarget - this.zoom) > 0.002;
    this.applyOrbit(dt, feetPos, HEAD_OFFSET, DISTANCE * this.zoom, !zooming);
  }

  /** Swim around the physical torso, so Ctrl takes the lens below the surface
   * with the diver instead of leaving a land-height camera floating overhead. */
  updateSwim(dt:number,bodyPos:THREE.Vector3,mouse:MouseDelta):void {
    this.resetFlightView(dt);
    if(!this.swimming){this.targetChanged=this.hasTarget;this.targetBlend=0;}
    this.swimming=true;this.chasing=false;
    this.yaw-=mouse.x*SENSITIVITY;
    this.pitch=THREE.MathUtils.clamp(this.pitch+mouse.y*SENSITIVITY,-Math.PI*.43,Math.PI*.44);
    this.smoothZoom(dt);
    this.applyOrbit(dt,bodyPos,.08,4.5*this.zoom,false);
    const surface=waterSurfaceHeight(bodyPos.x,bodyPos.z);
    const surfacing=THREE.MathUtils.smoothstep(bodyPos.y-surface,-.45,.28);
    // A negative orbit pitch must not leave the lens below water after the
    // swimmer has surfaced. Blend through the actual moving waterline.
    const lensSurface=waterSurfaceHeight(this.camera.position.x,this.camera.position.z);
    this.camera.position.y=THREE.MathUtils.lerp(this.camera.position.y,Math.max(this.camera.position.y,Math.max(surface,lensSurface)+.18),surfacing);
    this.camera.lookAt(this.target);
  }

  /**
   * 驾驶追尾模式。headingYaw 为车头朝向（弧度），speedKmh 取绝对值。
   * 鼠标横向做临时环视（松手自动回中到车尾），纵向调 pitch。
   */
  updateChase(
    dt: number,
    feetPos: THREE.Vector3,
    headingYaw: number,
    speedKmh: number,
    mouse: MouseDelta,
    flight = false,
  ): void {
    if (!flight) this.resetFlightView(dt);
    if (!this.chasing) {
      this.chaseYawOffset = wrapAngle(this.yaw - headingYaw - Math.PI);
      this.chasing = true;
    }
    this.chaseYawOffset -= mouse.x * SENSITIVITY;
    this.chaseYawOffset *= Math.exp(-CHASE_RECENTER * dt);
    this.pitch = THREE.MathUtils.clamp(
      this.pitch + mouse.y * SENSITIVITY,
      CHASE_PITCH_MIN,
      PITCH_MAX,
    );

    // 相机 yaw 阻尼追赶"车尾方向 + 环视偏移"
    const targetYaw = headingYaw + Math.PI + this.chaseYawOffset;
    const delta = wrapAngle(targetYaw - this.yaw);
    this.yaw += delta * (1 - Math.exp(-CHASE_YAW_FOLLOW * dt));

    this.smoothZoom(dt);
    const distance =
      (CHASE_DISTANCE + Math.min(speedKmh * CHASE_DIST_PER_KMH, CHASE_DIST_MAX_EXTRA)) * this.zoom;
    this.applyOrbit(dt, feetPos, CHASE_HEAD_OFFSET, distance, false);
  }

  updateFlight(dt: number, position: THREE.Vector3, attitude: THREE.Quaternion, velocity: THREE.Vector3, mouse: MouseDelta): void {
    this.flightUp.copy(this.worldUp).applyQuaternion(attitude).lerp(this.worldUp, .86).normalize();
    this.camera.up.lerp(this.flightUp, 1 - Math.exp(-3 * dt)).normalize();
    const bias = THREE.MathUtils.clamp(velocity.y * .022, -.12, .12);
    this.flightPitchBias += (bias - this.flightPitchBias) * (1 - Math.exp(-2 * dt));
    this.pitch += this.flightPitchBias;
    const heading = Math.atan2(2 * (attitude.x * attitude.z + attitude.w * attitude.y), 1 - 2 * (attitude.x ** 2 + attitude.y ** 2));
    this.updateChase(dt, position, heading, Math.hypot(velocity.x, velocity.z) * 3.6, mouse, true);
    this.pitch -= this.flightPitchBias;
    const fov = 70 + Math.min(7, velocity.length() * .35);
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-2 * dt));
    this.camera.updateProjectionMatrix();
  }

  private resetFlightView(dt: number): void {
    this.camera.up.copy(this.worldUp); this.flightPitchBias = 0;
    if (Math.abs(this.camera.fov - 70) > .01) {
      this.camera.fov += (70 - this.camera.fov) * (1 - Math.exp(-5 * dt));
      this.camera.updateProjectionMatrix();
    }
  }

  /** 共享尾段：由 yaw/pitch 求相机方位 → 球形防穿墙 → 距离阻尼 → 落位 */
  private applyOrbit(
    dt: number,
    feetPos: THREE.Vector3,
    headOffset: number,
    desiredDistance: number,
    snapIn: boolean,
  ): void {
    if (this.targetChanged) {
      // Blend only the handoff; ordinary movement retains exact render interpolation.
      this.targetOffset.copy(this.target).sub(feetPos);
      this.targetOffset.y -= headOffset;
      this.targetBlend = TARGET_BLEND_TIME;
      this.targetChanged = false;
    }
    this.target.copy(feetPos).y += headOffset;
    if (this.targetBlend > 0) {
      const t = 1 - this.targetBlend / TARGET_BLEND_TIME;
      this.target.addScaledVector(this.targetOffset, 1 - t * t * (3 - 2 * t));
      this.targetBlend = Math.max(0, this.targetBlend - dt);
      snapIn = false;
    } else {
      this.previousExclude = null;
    }
    this.hasTarget = true;

    const cosP = Math.cos(this.pitch);
    this.offsetDir.set(Math.sin(this.yaw) * cosP, Math.sin(this.pitch), Math.cos(this.yaw) * cosP);

    // 球形射线：从注视点沿 offsetDir 扫出去，命中即为允许的最大相机距离
    const hit = this.physics.world.castShape(
      this.target,
      { x: 0, y: 0, z: 0, w: 1 },
      this.offsetDir,
      this.probe,
      0,
      desiredDistance,
      false,
      undefined,
      undefined,
      this.exclude,
      this.exclude.parent() ?? undefined, // 排除整个刚体：载具底盘+车顶舱盒都不挡相机
      this.previousExclude ? this.transitionFilter : undefined,
    );
    const allowed = hit ? Math.max(hit.time_of_impact, 0.2) : desiredDistance;

    if (allowed < this.currentDistance) {
      if (snapIn) {
        this.currentDistance = allowed; // 步行：瞬时拉近，绝不穿墙
      } else {
        // 驾驶：高速阻尼拉近。楼角掠过时相机轻推而非急跳，短暂轻微穿插可接受
        const k = 1 - Math.exp(-CHASE_SHRINK_SPEED * dt);
        this.currentDistance += (allowed - this.currentDistance) * k;
      }
    } else {
      const k = 1 - Math.exp(-EXPAND_SPEED * dt);
      this.currentDistance += (allowed - this.currentDistance) * k;
    }

    // Smoothing may ease outward, but must never place the lens beyond a wall.
    this.currentDistance = Math.min(this.currentDistance, allowed);
    this.camera.position.copy(this.target).addScaledVector(this.offsetDir, this.currentDistance);
    this.camera.lookAt(this.target);
  }

  /** 相机在 XZ 平面上的前方（供移动方向映射） */
  getFlatForward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** 相机在 XZ 平面上的右方 */
  getFlatRight(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  getSwimForward(out:THREE.Vector3):THREE.Vector3 {
    const c=Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw)*c,-Math.sin(this.pitch),-Math.cos(this.yaw)*c);
  }
}
