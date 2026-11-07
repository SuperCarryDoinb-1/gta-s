import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { Input } from '../core/Input';
import type { GameAudio } from '../core/Audio';
import type { Character } from '../entities/Character';
import type { Pedestrians } from '../entities/Pedestrians';
import { makeTracer } from './fx';
import { SurvivalInventory, type SurvivalWeapon } from './SurvivalInventory';

export type WeaponKind = 'none' | 'pistol' | 'mg' | 'grenade';

const RANGE = 80;
const MG_INTERVAL = 0.1;
const MG_SPREAD = 0.035;
const GRENADE_FUSE = 2.5;
const EXPLOSION_RADIUS = 8;
const PANIC_RADIUS = 30;
const TRACER_LIFE = 0.05;
const FLASH_LIFE = 0.28;

interface Grenade {
  body: import('@dimforge/rapier3d-compat').RigidBody;
  mesh: THREE.Mesh;
  fuse: number;
}

interface Effect {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  /** 每秒缩放增量（爆炸火球用） */
  grow: number;
}

/**
 * 武器系统（仅步行时可用）：
 * - 1 手枪（半自动重击）/ 2 机枪（按住连发）/ 3 手雷（抛物线+引信爆炸），再按一次收起。
 * - 命中：从相机中心射线，命中动态刚体施加冲量（行人超速自动触发倒地翻滚）。
 * - 爆炸：半径内所有动态体径向掀飞，车辆会被真实掀动。
 * - 枪声/爆炸会惊散附近行人。特效（曳光/火球）与音效全程序化。
 */
export class WeaponSystem {
  current: WeaponKind = 'none';

  /** 犯罪上报（通缉系统挂钩）：开火/爆炸时回调 */
  onCrime: ((kind: 'gunshot' | 'explosion', x: number, z: number) => void) | null = null;
  onExplosion: ((center: THREE.Vector3) => void) | null = null;
  /** 爆炸波及玩家自己：伤害 + 爆心→玩家的水平方向（击退用） */
  onPlayerBlast: ((dmg: number, dirX: number, dirZ: number) => void) | null = null;
  /** 子弹命中动态刚体上报（行人/警察扣血挂钩），dmg 为该武器伤害 */
  onHitBody: ((body: import('@dimforge/rapier3d-compat').RigidBody, dmg: number) => void) | null =
    null;

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly input: Input;
  private readonly audio: GameAudio;
  private readonly character: Character;
  private readonly peds: Pedestrians;
  private readonly heavyBodies: import('@dimforge/rapier3d-compat').RigidBody[];

  private mgCooldown = 0;
  private readonly grenades: Grenade[] = [];
  private readonly effects: Effect[] = [];
  /** 弹药（打空后需到武器店补给） */
  private readonly ammo: SurvivalInventory['ammo'];
  private readonly inventory: SurvivalInventory;
  onNotice: ((text: string) => void) | null = null;

  // 手部武器模型
  private readonly pistolMesh: THREE.Group;
  private readonly mgMesh: THREE.Group;
  private readonly grenadeMesh: THREE.Mesh;

  private readonly ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private readonly camDir = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();
  private readonly handPos = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  private readonly flashMat = new THREE.MeshBasicMaterial({
    color: 0xff8c33,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  private readonly flashGeo = new THREE.SphereGeometry(1, 12, 8);
  private readonly grenadeGeo = new THREE.SphereGeometry(0.12, 10, 8);
  private readonly grenadeMat = new THREE.MeshStandardMaterial({ color: 0x35443a });

  constructor(
    scene: THREE.Scene,
    physics: Physics,
    camera: THREE.PerspectiveCamera,
    input: Input,
    audio: GameAudio,
    character: Character,
    peds: Pedestrians,
    heavyBodies: import('@dimforge/rapier3d-compat').RigidBody[],
    inventory: SurvivalInventory,
  ) {
    this.inventory = inventory;
    this.ammo = inventory.ammo;
    this.scene = scene;
    this.physics = physics;
    this.camera = camera;
    this.input = input;
    this.audio = audio;
    this.character = character;
    this.peds = peds;
    this.heavyBodies = heavyBodies;

    const dark = new THREE.MeshStandardMaterial({ color: 0x2b2b30 });
    // 手枪：短枪管 + 握把
    this.pistolMesh = new THREE.Group();
    const pBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.26), dark);
    pBarrel.position.z = -0.1;
    const pGrip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.14, 0.07), dark);
    pGrip.position.set(0, -0.09, 0.04);
    this.pistolMesh.add(pBarrel, pGrip);
    // 机枪：长枪管 + 弹匣
    this.mgMesh = new THREE.Group();
    const mBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), dark);
    mBarrel.position.z = -0.24;
    const mMag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.09), dark);
    mMag.position.set(0, -0.12, -0.08);
    this.mgMesh.add(mBarrel, mMag);
    // 手持手雷
    this.grenadeMesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);

    // 挂到右手骨骼挂点（KayKit handslot.r）：挂点的"武器朝向"轴为 +Y，
    // 枪模枪管建在 -Z → 绕 X 转 +90° 对齐
    for (const m of [this.pistolMesh, this.mgMesh, this.grenadeMesh]) {
      m.position.set(0, 0.05, 0);
      m.rotation.x = Math.PI / 2;
      m.visible = false;
      character.rightHandAnchor.add(m);
    }
  }

  get label(): string {
    return this.current === 'pistol'
      ? `手枪 ${this.ammo.pistol}发`
      : this.current === 'mg'
        ? `机枪 ${this.ammo.mg}发`
        : this.current === 'grenade'
          ? `手雷 ×${this.ammo.grenade}`
          : '徒手 · 搜索装备';
  }

  /** 补给弹药（武器店购买） */
  addAmmo(kind: SurvivalWeapon, n: number): string | null {
    return this.inventory.collect(kind === 'pistol' ? 'pistolAmmo' : kind === 'mg' ? 'mgAmmo' : 'grenade', n);
  }

  owns(kind: SurvivalWeapon): boolean {
    return this.inventory.has(kind);
  }

  ammoOf(kind: 'pistol' | 'mg' | 'grenade'): number {
    return this.ammo[kind];
  }

  /** 每帧调用（渲染帧） */
  update(dt: number, driving: boolean): void {
    if (!driving) {
      if (this.input.wasPressed('Digit1')) this.toggle('pistol');
      if (this.input.wasPressed('Digit2')) this.toggle('mg');
      if (this.input.wasPressed('Digit3')) this.toggle('grenade');
    }
    if (this.current === 'grenade' && this.ammo.grenade <= 0) this.current = 'none';
    if (driving && this.current !== 'none') this.current = 'none';

    this.character.setPose(this.current);
    this.pistolMesh.visible = this.current === 'pistol';
    this.mgMesh.visible = this.current === 'mg';
    this.grenadeMesh.visible = this.current === 'grenade';

    this.mgCooldown -= dt;
    if (!driving && this.input.pointerLocked) {
      if (this.current === 'pistol' && this.input.wasPressed('Mouse0') && this.ammo.pistol > 0) {
        this.ammo.pistol--;
        this.fireHitscan(9, 0, 40);
        this.audio.gunshot(true);
      } else if (
        this.current === 'mg' &&
        this.input.isDown('Mouse0') &&
        this.mgCooldown <= 0 &&
        this.ammo.mg > 0
      ) {
        this.ammo.mg--;
        this.mgCooldown = MG_INTERVAL;
        this.fireHitscan(5, MG_SPREAD, 14);
        this.audio.gunshot(false);
      } else if (
        this.current === 'grenade' &&
        this.input.wasPressed('Mouse0') &&
        this.ammo.grenade > 0
      ) {
        this.ammo.grenade--;
        this.character.playThrow();
        this.throwGrenade();
      }
    }

    this.updateGrenades(dt);
    this.updateEffects(dt);
  }

  toggle(kind: WeaponKind): void {
    if (kind !== 'none' && !this.inventory.has(kind)) {
      this.onNotice?.('尚未获得该武器，请先搜索物资');
      return;
    }
    this.current = this.current === kind ? 'none' : kind;
  }

  holster(): void {
    this.current = 'none'; this.character.setPose('none');
    this.pistolMesh.visible = this.mgMesh.visible = this.grenadeMesh.visible = false;
  }

  /**
   * 外部触发爆炸（载具殉爆等）：特效/冲击/惊散/自伤与手雷一致。
   * 每次分配新向量——殉爆可能在 onCrime 回调里链式嵌套，共享 tmp 会被内层覆盖。
   */
  explodeAt(x: number, y: number, z: number): void {
    this.explode(new THREE.Vector3(x, y, z));
  }

  /** 命中扫描：相机中心射线，命中动态体给冲量与伤害；曳光从枪口到命中点 */
  private fireHitscan(dv: number, spread: number, dmg: number): void {
    this.camera.getWorldPosition(this.camPos);
    this.camera.getWorldDirection(this.camDir);
    if (spread > 0) {
      this.camDir.x += (Math.random() - 0.5) * spread;
      this.camDir.y += (Math.random() - 0.5) * spread;
      this.camDir.z += (Math.random() - 0.5) * spread;
      this.camDir.normalize();
    }

    this.ray.origin.x = this.camPos.x;
    this.ray.origin.y = this.camPos.y;
    this.ray.origin.z = this.camPos.z;
    this.ray.dir.x = this.camDir.x;
    this.ray.dir.y = this.camDir.y;
    this.ray.dir.z = this.camDir.z;

    const hit = this.physics.world.castRay(
      this.ray,
      RANGE,
      true,
      undefined,
      undefined,
      this.character.collider,
    );
    const dist = hit ? hit.timeOfImpact : RANGE;
    this.hitPoint.copy(this.camPos).addScaledVector(this.camDir, dist);

    if (hit) {
      const body = hit.collider.parent();
      if (body && body.isDynamic()) {
        // 轻物按 dv 起飞，重物（车）只被轻推
        const imp = dv * Math.min(body.mass(), 3);
        this.scratch.copy(this.camDir).multiplyScalar(imp);
        body.applyImpulseAtPoint(this.scratch, this.hitPoint, true);
        // 命中反馈音：人形质量（行人/警察）出拳肉声，重物出金属声
        const m = body.mass();
        if (m > 30 && m < 250) this.audio.pedHit(false);
        else if (m >= 250) this.audio.crash(0.25);
        this.onHitBody?.(body, dmg);
      }
    }

    // 曳光
    this.character.rightHandAnchor.getWorldPosition(this.handPos);
    const tracer = makeTracer(this.handPos, this.hitPoint);
    this.scene.add(tracer);
    this.effects.push({ mesh: tracer, life: TRACER_LIFE, maxLife: TRACER_LIFE, grow: 0 });

    this.peds.panicAt(this.camPos.x, this.camPos.z, PANIC_RADIUS);
    this.onCrime?.('gunshot', this.camPos.x, this.camPos.z);
  }

  private throwGrenade(): void {
    this.camera.getWorldDirection(this.camDir);
    this.character.getPosition(this.scratch);
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(
          this.scratch.x + this.camDir.x,
          this.scratch.y + 0.6,
          this.scratch.z + this.camDir.z,
        )
        .setLinvel(this.camDir.x * 15, 4.5 + this.camDir.y * 8, this.camDir.z * 15)
        .setAngularDamping(0.8),
    );
    this.physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.12).setDensity(500).setRestitution(0.35),
      body,
    );
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
    this.scene.add(mesh);
    this.grenades.push({ body, mesh, fuse: GRENADE_FUSE });
  }

  private updateGrenades(dt: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i]!;
      g.fuse -= dt;
      const t = g.body.translation();
      g.mesh.position.set(t.x, t.y, t.z);
      if (g.fuse <= 0) {
        this.explode(g.mesh.position);
        this.scene.remove(g.mesh);
        this.physics.world.removeRigidBody(g.body);
        this.grenades.splice(i, 1);
      }
    }
  }

  private explode(center: THREE.Vector3): void {
    this.audio.explosion();
    this.onCrime?.('explosion', center.x, center.z);
    this.onExplosion?.(center);

    // 火球特效
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    flash.position.copy(center);
    flash.scale.setScalar(0.6);
    this.scene.add(flash);
    this.effects.push({ mesh: flash, life: FLASH_LIFE, maxLife: FLASH_LIFE, grow: 26 });

    // 行人掀飞 + 惊散
    this.peds.applyExplosion(center, EXPLOSION_RADIUS);

    // 玩家自己也在爆炸范围内 → 自伤（手雷别扔脚边）
    this.character.getPosition(this.scratch);
    const pdx = this.scratch.x - center.x;
    const pdz = this.scratch.z - center.z;
    const pd = Math.hypot(pdx, this.scratch.y - center.y, pdz);
    if (pd < EXPLOSION_RADIUS) {
      const inv = 1 / Math.max(Math.hypot(pdx, pdz), 0.5);
      this.onPlayerBlast?.(55 * (1 - pd / EXPLOSION_RADIUS), pdx * inv, pdz * inv);
    }

    // 重物（车/箱子）：径向 + 上抛冲量，近距能把车掀起来
    for (const body of this.heavyBodies) {
      const t = body.translation();
      const dx = t.x - center.x;
      const dy = t.y - center.y;
      const dz = t.z - center.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > EXPLOSION_RADIUS) continue;
      const falloff = 1 - d / EXPLOSION_RADIUS;
      const inv = 1 / Math.max(d, 0.6);
      const k = 9 * falloff * body.mass();
      this.scratch.set(dx * inv * k, (0.7 + dy * inv * 0.3) * k, dz * inv * k);
      body.applyImpulse(this.scratch, true);
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i]!;
      e.life -= dt;
      if (e.grow > 0) {
        e.mesh.scale.addScalar(e.grow * dt);
        const mat = e.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.9 * (e.life / e.maxLife);
      }
      if (e.life <= 0) {
        this.scene.remove(e.mesh);
        if (e.grow > 0) (e.mesh.material as THREE.Material).dispose();
        this.effects.splice(i, 1);
      }
    }
  }
}
