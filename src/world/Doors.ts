import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { DoorSpec } from './City';

const DOOR_W = 1.2;
const DOOR_H = 2.2;
const OPEN_DIST = 2.6; // 走近自动开
const OPEN_ANGLE = 1.9; // 内开约 109°
const ANIM_RATE = 6;

const DOOR_MAT = new THREE.MeshStandardMaterial({
  color: 0x33434f,
  roughness: 0.25,
  metalness: 0.4,
});
const FRAME_MAT = new THREE.MeshStandardMaterial({ color: 0x2a2a2e });

interface DoorEntry {
  pivot: THREE.Group;
  collider: import('@dimforge/rapier3d-compat').Collider;
  open: number;
  hx: number;
  hz: number;
  swing: number;
}

/**
 * 商店门：铰链枢轴旋转的玻璃门。
 * 玩家走近 2.6m 自动内开、离开自动关；关闭状态下门板碰撞体生效（真实挡人），
 * 开门过程中禁用碰撞体放行。随 chunk 生命周期增删。
 */
export class DoorSystem {
  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly byChunk = new Map<string, DoorEntry[]>();

  constructor(scene: THREE.Scene, physics: Physics) {
    this.scene = scene;
    this.physics = physics;
  }

  addChunkDoors(key: string, specs: DoorSpec[]): void {
    if (specs.length === 0) return;
    const list: DoorEntry[] = [];
    for (const spec of specs) {
      const pivot = new THREE.Group();
      pivot.position.set(spec.hx, 0, spec.hz);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.07, DOOR_H, DOOR_W), DOOR_MAT);
      leaf.position.set(0, DOOR_H / 2 + 0.04, DOOR_W / 2);
      leaf.castShadow = true;
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.14), FRAME_MAT);
      handle.position.set(0, 1.1, DOOR_W - 0.15);
      pivot.add(leaf, handle);
      this.scene.add(pivot);

      // 碰撞体固定在关门位形，开门时禁用
      const collider = this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.05, DOOR_H / 2, DOOR_W / 2).setTranslation(
          spec.hx,
          DOOR_H / 2,
          spec.hz + DOOR_W / 2,
        ),
      );
      list.push({ pivot, collider, open: 0, hx: spec.hx, hz: spec.hz, swing: spec.swing });
    }
    this.byChunk.set(key, list);
  }

  removeChunkDoors(key: string): void {
    const list = this.byChunk.get(key);
    if (!list) return;
    for (const d of list) {
      this.scene.remove(d.pivot);
      this.physics.world.removeCollider(d.collider, false);
    }
    this.byChunk.delete(key);
  }

  /** 每帧调用 */
  update(dt: number, playerPos: THREE.Vector3): void {
    const k = 1 - Math.exp(-ANIM_RATE * dt);
    for (const list of this.byChunk.values()) {
      for (const d of list) {
        const dx = playerPos.x - d.hx;
        const dz = playerPos.z - (d.hz + DOOR_W / 2);
        const near = dx * dx + dz * dz < OPEN_DIST * OPEN_DIST;
        const target = near ? 1 : 0;
        if (Math.abs(target - d.open) < 0.001) continue;
        d.open += (target - d.open) * k;
        d.pivot.rotation.y = d.swing * OPEN_ANGLE * d.open;
        d.collider.setEnabled(d.open < 0.3);
      }
    }
  }
}
