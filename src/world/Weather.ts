import * as THREE from 'three';

const DROP_COUNT = 1400;
const AREA = 46; // 雨区边长（跟随相机）
const TOP = 26; // 雨区高度
const FALL = 21; // 下落速度 m/s
const WIND = 2.2; // 侧风
const STREAK = 0.45; // 雨丝长度
const WET_RATE = 0.4; // 干湿过渡速率

/**
 * 天气循环：晴 → 雨 → 晴 随机时长交替。
 * 雨用 LineSegments 雨丝（相机局部空间循环下落），湿度 0~1 平滑过渡，
 * 供路面反光、雨声、天空光照联动。
 */
export class WeatherSystem {
  private readonly drops: Float32Array; // 每滴 x,y,z（局部）
  private readonly positions: Float32Array; // 2 顶点/滴
  private readonly geometry = new THREE.BufferGeometry();
  private readonly material = new THREE.LineBasicMaterial({
    color: 0xb9cfdd,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  private readonly lines: THREE.LineSegments;

  private raining = false;
  private wet = 0;
  private timer = 50; // 开局约 50s 后下第一场雨

  constructor(scene: THREE.Scene) {
    this.drops = new Float32Array(DROP_COUNT * 3);
    this.positions = new Float32Array(DROP_COUNT * 6);
    for (let i = 0; i < DROP_COUNT; i++) {
      this.drops[i * 3] = (Math.random() - 0.5) * AREA;
      this.drops[i * 3 + 1] = Math.random() * TOP;
      this.drops[i * 3 + 2] = (Math.random() - 0.5) * AREA;
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  /** 湿度 0（干）~1（大雨），供反光/音效/光照使用 */
  get wetness(): number {
    return this.wet;
  }

  /** 手动切换天气（调试/演示） */
  toggle(): void {
    this.raining = !this.raining;
    this.timer = this.raining ? 35 + Math.random() * 40 : 70 + Math.random() * 90;
  }

  update(dt: number, center: THREE.Vector3): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.raining = !this.raining;
      this.timer = this.raining ? 35 + Math.random() * 40 : 70 + Math.random() * 90;
    }
    this.wet += ((this.raining ? 1 : 0) - this.wet) * (1 - Math.exp(-WET_RATE * dt));

    this.material.opacity = 0.42 * this.wet;
    this.lines.visible = this.wet > 0.02;
    if (!this.lines.visible) return;

    for (let i = 0; i < DROP_COUNT; i++) {
      let x = this.drops[i * 3]! + WIND * dt;
      let y = this.drops[i * 3 + 1]! - FALL * dt;
      const z = this.drops[i * 3 + 2]!;
      if (y < 0) y += TOP;
      if (x > AREA / 2) x -= AREA;
      this.drops[i * 3] = x;
      this.drops[i * 3 + 1] = y;

      const o = i * 6;
      this.positions[o] = x;
      this.positions[o + 1] = y + STREAK;
      this.positions[o + 2] = z;
      this.positions[o + 3] = x - WIND * 0.02;
      this.positions[o + 4] = y;
      this.positions[o + 5] = z;
    }
    this.geometry.attributes.position!.needsUpdate = true;
    this.lines.position.set(center.x, Math.max(0, center.y - 2), center.z);
  }
}
