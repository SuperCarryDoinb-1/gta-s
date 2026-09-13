import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { Character } from '../entities/Character';
import type { CameraRig } from '../entities/CameraRig';
import { CHUNK_SIZE, chunkZone } from '../world/City';
import { wrapAngle } from '../core/MathUtil';

export type CharacterState = 'idle' | 'walk' | 'run' | 'jump' | 'swim';

const WALK_SPEED = 5;
const RUN_SPEED = 9;
const GRAVITY = -20; // 比物理值略强，手感更利落
const JUMP_SPEED = 8;
const GROUND_STICK = -2; // 贴地下压速度，保证 grounded 检测稳定
const TURN_DAMPING = 12; // 转身阻尼系数（越大转得越快）
// 游泳：深水区浮力取代重力，身体悬浮在水面附近
const SWIM_SPEED = 2.6;
const SWIM_FAST = 4.2;
const SWIM_CENTER_Y = 0.28; // 漂浮时胶囊中心目标高度（胶囊底 -0.67，能 autostep 上浅滩）
const SWIM_ENTER_Y = 0.45; // 低于此高度且在海洋区 → 进入游泳

/**
 * 角色移动逻辑：相机相对 WASD、朝移动方向平滑转身、
 * Space 跳跃（仅落地可跳，禁二段跳）、Shift 疾跑。
 * 每个物理步调用一次 fixedUpdate，必须在 physics.step() 之前。
 */
/** 楼梯高度场查询（见 ChunkManager.stairHeightAt） */
export type StairQuery = (x: number, z: number, feetY: number) => number | null;

export class CharacterController {
  private readonly character: Character;
  private readonly cameraRig: CameraRig;
  private readonly input: Input;
  private readonly stairQuery: StairQuery;
  private onStairs = false;
  private wasGrounded = true;

  /** 硬着陆上报（落地竖直速度 m/s，坠落伤害用） */
  onHardLanding: ((speed: number) => void) | null = null;

  private velY = 0;
  private currentYaw = 0;
  private currentState: CharacterState = 'idle';
  private horizontalSpeed = 0;
  private kbX = 0;
  private kbZ = 0;

  private readonly moveDir = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly camForward = new THREE.Vector3();
  private readonly camRight = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();

  constructor(character: Character, cameraRig: CameraRig, input: Input, stairQuery: StairQuery) {
    this.character = character;
    this.cameraRig = cameraRig;
    this.input = input;
    this.stairQuery = stairQuery;
  }

  fixedUpdate(dt: number): void {
    const grounded = this.character.grounded || this.onStairs;
    const impactV = this.velY; // 本步进入时的竖直速度（硬着陆判定）

    // 相机相对移动方向
    this.cameraRig.getFlatForward(this.camForward);
    this.cameraRig.getFlatRight(this.camRight);
    const fwd = (this.input.isDown('KeyW') ? 1 : 0) - (this.input.isDown('KeyS') ? 1 : 0);
    const side = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);
    this.moveDir
      .set(0, 0, 0)
      .addScaledVector(this.camForward, fwd)
      .addScaledVector(this.camRight, side);
    const moving = this.moveDir.lengthSq() > 0;
    if (moving) this.moveDir.normalize();

    const sprinting = this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight');

    // 深水检测：海洋区且身体已沉到漂浮线以下 → 游泳
    this.character.getPosition(this.pos);
    const swimming =
      chunkZone(Math.round(this.pos.x / CHUNK_SIZE)) === 'ocean' && this.pos.y < SWIM_ENTER_Y;

    let speed: number;
    if (swimming) {
      speed = sprinting ? SWIM_FAST : SWIM_SPEED;
      // 浮力：垂直速度弹向水面漂浮高度（无重力、不可跳）
      this.velY = THREE.MathUtils.clamp((SWIM_CENTER_Y - this.pos.y) * 3, -1.5, 1.5);
    } else {
      speed = sprinting ? RUN_SPEED : WALK_SPEED;
      // 垂直速度：贴地下压 → 跳跃 → 重力积分
      this.velY = grounded && this.velY < 0 ? GROUND_STICK : this.velY + GRAVITY * dt;
      if (grounded && this.input.wasPressed('Space')) {
        this.velY = JUMP_SPEED; // 只有 grounded 才进得来，天然禁二段跳
      }
    }

    this.desired.copy(this.moveDir).multiplyScalar(moving ? speed * dt : 0);
    this.desired.y = this.velY * dt;
    // 击退（摩托甩人等）：叠加衰减中的水平冲量
    if (Math.abs(this.kbX) + Math.abs(this.kbZ) > 0.1) {
      this.desired.x += this.kbX * dt;
      this.desired.z += this.kbZ * dt;
      const k = Math.exp(-2.2 * dt);
      this.kbX *= k;
      this.kbZ *= k;
    }
    this.character.moveBy(this.desired);

    // 楼梯高度场：位于楼梯区且未在跳跃上升段时，直接贴合坡面高度
    this.character.getPosition(this.pos);
    const stairH = this.stairQuery(this.pos.x, this.pos.z, this.pos.y - 0.95);
    if (stairH !== null && this.velY <= 0.01) {
      const targetY = stairH + 0.95;
      if (this.pos.y > targetY - 1.2 && this.pos.y < targetY + 0.55) {
        this.character.forceY(targetY);
        this.velY = 0;
        this.onStairs = true;
      } else {
        this.onStairs = false;
      }
    } else {
      this.onStairs = false;
    }

    // 硬着陆检测：空中转落地且下落够快
    const landed = this.character.grounded || this.onStairs;
    if (landed && !this.wasGrounded && impactV < -12) this.onHardLanding?.(-impactV);
    this.wasGrounded = landed;

    // 朝移动方向平滑转身（最短角路径 + 指数阻尼）
    if (moving) {
      const targetYaw = Math.atan2(-this.moveDir.x, -this.moveDir.z);
      const delta = wrapAngle(targetYaw - this.currentYaw);
      this.currentYaw += delta * (1 - Math.exp(-TURN_DAMPING * dt));
      this.character.setYaw(this.currentYaw);
    }

    this.horizontalSpeed = moving ? speed : 0;
    // moveBy 之后 grounded 已刷新为本步结果
    this.currentState = swimming
      ? 'swim'
      : !(this.character.grounded || this.onStairs)
        ? 'jump'
        : moving
          ? sprinting ? 'run' : 'walk'
          : 'idle';
  }

  /** 下车等瞬移场景后调用，清掉残留垂直速度 */
  reset(): void {
    this.velY = 0;
    this.kbX = 0;
    this.kbZ = 0;
    this.currentState = 'idle';
    this.horizontalSpeed = 0;
  }

  /** 击退：水平冲量（指数衰减）+ 抛起 */
  knock(vx: number, vz: number, vy: number): void {
    this.kbX = vx;
    this.kbZ = vz;
    this.velY = vy;
  }

  get state(): CharacterState {
    return this.currentState;
  }

  /** 当前水平速度（m/s），供 HUD 显示 */
  get speed(): number {
    return this.horizontalSpeed;
  }
}
