import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export interface EngineHooks {
  /** 固定步长回调（物理等），dt 恒为 FIXED_DT 秒 */
  fixedUpdate?: (dt: number) => void;
  /** 每帧回调（渲染前），dt 为该帧实际耗时秒，alpha 为固定步插值系数 [0,1) */
  update?: (dt: number, alpha: number) => void;
}

const FIXED_DT = 1 / 60;
// 单帧最多补 5 个物理步：更长的帧直接丢弃多余时间（表现为轻微慢动作），
// 避免"帧越慢→补步越多→帧更慢"的死亡螺旋
const MAX_FRAME_DT = FIXED_DT * 5;

export interface EngineStats {
  /** 最近窗口的平均帧耗时（ms） */
  avgMs: number;
  /** 最近窗口的最差帧（ms），尖刺探测 */
  maxMs: number;
  /** 当前渲染像素比（自适应降档后） */
  pixelRatio: number;
}

const STAT_WINDOW = 60; // 帧
const ADAPT_THRESHOLD_MS = 22; // 平均帧耗时超过即降像素比
const MIN_PIXEL_RATIO = 0.75;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly stats: EngineStats = { avgMs: 0, maxMs: 0, pixelRatio: 1 };
  private composer!: EffectComposer;
  private bloomPass!: UnrealBloomPass;

  private hooks: EngineHooks = {};
  preview: ((dt: number) => void) | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private statAcc = 0;
  private statMax = 0;
  private statCount = 0;
  private currentPixelRatio: number;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    // 1.5 足够清晰；高 DPI 屏上 2.0 的填充率代价接近翻倍。运行时自适应降档。
    this.currentPixelRatio = Math.min(window.devicePixelRatio, 1.5);
    this.stats.pixelRatio = this.currentPixelRatio;
    this.renderer.setPixelRatio(this.currentPixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 电影级色调映射：高光滚降柔和、色彩饱和自然，整体质感提升一档
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );

    // 后处理：HDR 半浮点 + 4×MSAA 目标 → 渲染 → Bloom → 色调映射/色彩空间输出
    const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.currentPixelRatio);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.06, // 强度（白天基线，夜里由 setBloom 拉高）
      0.42, // 半径
      1.35, // 阈值：只有明确的 HDR 发光体参与辉光（天空/白墙不糊）
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
  }

  /** 辉光强度（夜色/雨湿联动） */
  setBloom(strength: number): void {
    this.bloomPass.strength = strength;
  }

  setHooks(hooks: EngineHooks): void {
    this.hooks = hooks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private tick = (now: number): void => {
    const rawMs = now - this.lastTime;
    const dt = Math.min(rawMs / 1000, MAX_FRAME_DT);
    this.lastTime = now;

    if (this.preview) {
      this.preview(dt);
      return;
    }

    // 帧耗时统计 + 自适应像素比
    this.statAcc += rawMs;
    this.statMax = Math.max(this.statMax, rawMs);
    if (++this.statCount >= STAT_WINDOW) {
      this.stats.avgMs = this.statAcc / this.statCount;
      this.stats.maxMs = this.statMax;
      this.statAcc = 0;
      this.statMax = 0;
      this.statCount = 0;
      if (this.stats.avgMs > ADAPT_THRESHOLD_MS && this.currentPixelRatio > MIN_PIXEL_RATIO) {
        this.currentPixelRatio = Math.max(MIN_PIXEL_RATIO, this.currentPixelRatio - 0.25);
        this.stats.pixelRatio = this.currentPixelRatio;
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.composer.setPixelRatio(this.currentPixelRatio);
        this.composer.setSize(window.innerWidth, window.innerHeight);
      }
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.hooks.fixedUpdate?.(FIXED_DT);
      this.accumulator -= FIXED_DT;
    }

    const alpha = this.accumulator / FIXED_DT;
    this.hooks.update?.(dt, alpha);

    this.composer.render();
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
  };
}
