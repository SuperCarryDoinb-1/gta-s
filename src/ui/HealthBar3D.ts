import * as THREE from 'three';

// 底槽共享材质；填充条每实例一份（颜色随血量变）
const BG_MAT = new THREE.SpriteMaterial({
  color: 0x0c1016,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});

const SHOW_DIST_SQ = 45 * 45; // 太远的血条只有几个像素，纯浪费

/**
 * 头顶血条（世界空间 billboard）：底槽 + 填充双 Sprite。
 * 满血/死亡/超距自动隐藏；填充条居中缩放、颜色绿→黄→红随血量。
 */
export class HealthBar3D {
  private readonly bg: THREE.Sprite;
  private readonly fill: THREE.Sprite;
  private readonly fillMat: THREE.SpriteMaterial;

  constructor(scene: THREE.Scene) {
    this.bg = new THREE.Sprite(BG_MAT);
    this.bg.scale.set(0.85, 0.1, 1);
    this.bg.renderOrder = 8;
    this.fillMat = new THREE.SpriteMaterial({
      color: 0x53e07a,
      transparent: true,
      depthWrite: false,
    });
    this.fill = new THREE.Sprite(this.fillMat);
    this.fill.renderOrder = 9;
    this.bg.visible = false;
    this.fill.visible = false;
    scene.add(this.bg, this.fill);
  }

  /** 每帧调用：血条位置（头顶上方一点）与血量 0~1。show=false 强制隐藏（死亡/未激活） */
  update(x: number, y: number, z: number, hp01: number, show: boolean, playerPos: THREE.Vector3): void {
    const dx = x - playerPos.x;
    const dz = z - playerPos.z;
    const vis = show && hp01 > 0 && hp01 < 0.999 && dx * dx + dz * dz < SHOW_DIST_SQ;
    this.bg.visible = vis;
    this.fill.visible = vis;
    if (!vis) return;
    this.bg.position.set(x, y, z);
    this.fill.position.set(x, y, z);
    this.fill.scale.set(0.78 * hp01, 0.062, 1);
    // 绿(0.36) → 黄 → 红(0)，色相随血量滑
    this.fillMat.color.setHSL(0.36 * hp01, 0.72, 0.5);
  }

  hide(): void {
    this.bg.visible = false;
    this.fill.visible = false;
  }
}
