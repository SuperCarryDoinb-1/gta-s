import * as THREE from 'three';

export interface BeaconOpts {
  radius: number;
  height: number;
  /** 静止不透明度（初始值） */
  opacity: number;
  /** 呼吸脉动：opacity = base + sin(time*3)*amp（不传则恒定不脉动） */
  pulse?: { base: number; amp: number };
}

/**
 * 世界空间目标光柱（Story 任务金柱 / TaxiJobs 绿柱 / Shops 店铺柱共用）：
 * additive 半透明开口圆柱，Y 自动取半高贴地。
 */
export class Beacon {
  private readonly mesh: THREE.Mesh;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly halfHeight: number;
  private readonly pulseOpts?: { base: number; amp: number };

  constructor(scene: THREE.Scene, color: number, opts: BeaconOpts) {
    this.halfHeight = opts.height / 2;
    this.pulseOpts = opts.pulse;
    this.mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: opts.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(opts.radius, opts.radius, opts.height, 12, 1, true),
      this.mat,
    );
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** 移到 (x, z) 并显示 */
  setPosition(x: number, z: number): void {
    this.mesh.position.set(x, this.halfHeight, z);
    this.mesh.visible = true;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /** 每帧调用（可见且配置了 pulse 才生效） */
  update(time: number): void {
    if (this.mesh.visible && this.pulseOpts) {
      this.mat.opacity = this.pulseOpts.base + Math.sin(time * 3) * this.pulseOpts.amp;
    }
  }
}
