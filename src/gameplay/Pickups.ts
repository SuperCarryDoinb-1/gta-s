import * as THREE from 'three';
import type { GameAudio } from '../core/Audio';
import type { HealthSystem } from './Health';

const POOL = 24;
const LIFE = 25; // 秒后消失
const COLLECT_DIST = 1.5;

/**
 * 掉落现金拾取：绿色发光八面体,旋转漂浮,走近自动拾取。
 * 行人被撞倒概率掉落——捡钱有通缉风险,构成"作恶收入"一环。
 */
export class Pickups {
  private readonly items: Array<{
    mesh: THREE.Mesh;
    amount: number;
    life: number;
    active: boolean;
    baseY: number;
  }> = [];

  private readonly health: HealthSystem;
  private readonly audio: GameAudio;
  private time = 0;

  constructor(scene: THREE.Scene, audio: GameAudio, health: HealthSystem) {
    this.audio = audio;
    this.health = health;
    const geo = new THREE.OctahedronGeometry(0.22);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x51ff7e,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    for (let i = 0; i < POOL; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.items.push({ mesh, amount: 0, life: 0, active: false, baseY: 0 });
    }
  }

  spawn(x: number, y: number, z: number, amount: number): void {
    // 池满时顶掉最老的
    let slot = this.items.find((p) => !p.active);
    if (!slot) {
      slot = this.items.reduce((a, b) => (a.life < b.life ? a : b));
    }
    slot.active = true;
    slot.amount = amount;
    slot.life = LIFE;
    slot.baseY = y;
    slot.mesh.position.set(x, y, z);
    slot.mesh.visible = true;
  }

  update(dt: number, playerPos: THREE.Vector3): void {
    this.time += dt;
    for (const p of this.items) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.mesh.rotation.y += 3 * dt;
      p.mesh.position.y = p.baseY + 0.15 + Math.sin(this.time * 3 + p.baseY) * 0.08;
      const dx = p.mesh.position.x - playerPos.x;
      const dz = p.mesh.position.z - playerPos.z;
      if (dx * dx + dz * dz < COLLECT_DIST * COLLECT_DIST) {
        this.health.addMoney(p.amount);
        this.audio.blip();
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }
}
