import * as THREE from 'three';

export interface EngineHooks {
  beforeRender?: () => void;
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
  readonly renderPipeline = 'direct-msaa';

  private hooks: EngineHooks = {};
  preview: ((dt: number) => void) | null = null;
  private accumulator = 0;
  private lastTime = 0;
  private running = false;
  private statAcc = 0;
  private statMax = 0;
  private statCount = 0;
  private currentPixelRatio: number;
  private readonly maxPixelRatio: number;
  private slowWindows = 0;
  private fastWindows = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Count the entire composed frame, not just the final fullscreen triangle.
    this.renderer.info.autoReset = false;
    // 1.5 足够清晰；高 DPI 屏上 2.0 的填充率代价接近翻倍。运行时自适应降档。
    this.currentPixelRatio = Math.min(window.devicePixelRatio, 1.25);
    this.maxPixelRatio = this.currentPixelRatio;
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

    // The scene has no screen-space effects: render once to the native MSAA
    // canvas instead of resolving a second HDR/MSAA buffer and copying it out.

    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', () => {
      this.lastTime = performance.now();
      this.accumulator = 0;
      this.statAcc = this.statMax = this.statCount = 0;
    });
  }

  setHooks(hooks: EngineHooks): void {
    this.hooks = hooks;
  }

  /** Upload geometry and initialize shadow/postprocessing passes behind the menu. */
  warmup(): void {
    this.renderer.info.reset();
    this.hooks.beforeRender?.();
    this.renderer.render(this.scene, this.camera);
  }

  prepareStep(dt: number): void {
    this.hooks.fixedUpdate?.(dt);
    this.hooks.update?.(dt, 1);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.statAcc = this.statMax = this.statCount = 0;
    this.slowWindows = this.fastWindows = 0;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    this.accumulator = 0;
    this.renderer.setAnimationLoop(null);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
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
      this.slowWindows = this.stats.avgMs > ADAPT_THRESHOLD_MS ? this.slowWindows + 1 : 0;
      this.fastWindows = this.stats.avgMs < 18 && this.stats.maxMs < 34 ? this.fastWindows + 1 : 0;
      let nextRatio = this.currentPixelRatio;
      if (this.slowWindows >= 2) nextRatio = Math.max(MIN_PIXEL_RATIO, nextRatio - .25);
      else if (this.fastWindows >= 6) nextRatio = Math.min(this.maxPixelRatio, nextRatio + .25);
      if (nextRatio !== this.currentPixelRatio) {
        this.currentPixelRatio = nextRatio;
        this.slowWindows = this.fastWindows = 0;
        this.stats.pixelRatio = this.currentPixelRatio;
        this.renderer.setPixelRatio(this.currentPixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      }
    }

    this.accumulator += dt;
    while (this.accumulator >= FIXED_DT) {
      this.hooks.fixedUpdate?.(FIXED_DT);
      // A death/result screen may stop the loop inside the fixed-step callback.
      if (!this.running) return;
      this.accumulator -= FIXED_DT;
    }

    const alpha = this.accumulator / FIXED_DT;
    this.hooks.update?.(dt, alpha);
    if (!this.running) return;

    this.renderer.info.reset();
    this.hooks.beforeRender?.();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
