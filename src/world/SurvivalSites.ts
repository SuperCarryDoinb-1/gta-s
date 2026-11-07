import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';

export const SHELTER = { x: 40, z: 88 };
export const HOSTILE_CAMP = { x: 177, z: -57 };

/** Walk-in shelter and a cover-filled encounter site, using real static bodies. */
export class SurvivalSites {
  readonly root = new THREE.Group();
  constructor(scene: THREE.Scene, physics: Physics) {
    this.root.name = 'Survival-Sites'; scene.add(this.root);
    const material = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: .85 });
    const wall = material(0x7d8e83), roof = material(0x3d5554), timber = material(0x998569), steel = material(0x4e5c5b);
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, solid = true) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true; this.root.add(m);
      if (solid) physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z));
    };
    box(40, .08, 88, 8, .16, 7, timber);
    box(44, 1.7, 88, .24, 3.4, 7.2, wall);
    for (const z of [84.5, 91.5]) box(40, 1.7, z, 8, 3.4, .24, wall);
    for (const z of [85.7, 90.3]) box(36, 1.7, z, .24, 3.4, 2.4, wall);
    box(40, 3.45, 88, 8.5, .2, 7.8, roof);
    box(36, 3.1, 88, .3, .6, 2.2, wall);
    box(42.5, .65, 88.5, 1.5, 1.15, 1.1, steel);
    box(42.5, 1.25, 88.5, 1.58, .12, 1.18, timber);
    box(41, .4, 85.3, 2.2, .65, .7, timber);
    box(43.84, 2.2, 88, .02, .8, 1.2, material(0xd4d8b1), false);
    this.sign('滨江避难所', 'F 仓库 / 存档 · SAFEHOUSE', 35.84, 2.75, 88, 4.4, 1, -Math.PI / 2);
    this.sign('物资保管箱', 'STORAGE / 保管已带回的物资', 42.5, 1.6, 87.91, 1.5, .5, Math.PI);
    for (const [x, z, w, d] of [[177,-57,2.5,2],[183,-64,3,1.5],[168,-63,1.5,2.5]]) {
      box(x!, .65, z!, w!, 1.3, d!, timber); box(x!, 1.34, z!, w! + .08, .08, d! + .08, steel);
    }
    for (const x of [166, 188]) box(x, 1.1, -68, .15, 2.2, .15, steel);
    box(177, 2.25, -68, 22, .12, .2, steel);
    this.sign('废弃货栈 · 危险区域', 'ARMED PATROL / 注意掩体', 177, 2.6, -68, 9, 1.1, Math.PI);
  }

  contains(pos: { x: number; y: number; z: number }): boolean {
    return pos.x > 35.5 && pos.x < 44.5 && pos.z > 84 && pos.z < 92 && pos.y < 3.5 && pos.y > -.5;
  }

  nearStorage(pos: { x: number; y: number; z: number }): boolean {
    return this.contains(pos) && Math.hypot(pos.x - 41, pos.z - 88) < 3.1;
  }

  private sign(title: string, subtitle: string, x: number, y: number, z: number, width: number, height: number, yaw: number): void {
    const c = document.createElement('canvas'); c.width = 768; c.height = 192;
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#203d38'; ctx.fillRect(0, 0, 768, 192);
    ctx.strokeStyle = '#bdcca2'; ctx.lineWidth = 5; ctx.strokeRect(5, 5, 758, 182);
    ctx.fillStyle = '#eee6c5'; ctx.textAlign = 'center'; ctx.font = 'bold 54px Microsoft YaHei,sans-serif'; ctx.fillText(title, 384, 83);
    ctx.fillStyle = '#b9c8b6'; ctx.font = '24px Microsoft YaHei,sans-serif'; ctx.fillText(subtitle, 384, 147);
    const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; this.root.add(mesh);
  }
}
