/**
 * 混合音频：真实采样（CC0 素材，public/sounds，来源见 ASSETS.md）+ 程序合成。
 * - 引擎声：真实引擎循环采样随车速/油门变调（GTA 式 RPM 音高模型）+ 次低频正弦垫车身共鸣，
 *   低通滤波随车速开阖（怠速闷、高速亮）。
 * - 脚步（按步幅距离触发）/跳跃/落地/行人被击/车祸金属声/喇叭/车门/点火：采样一击即发，
 *   同类多变体随机 + 变调抖动防"机关枪耳朵"。
 * - 背景音乐：lo-fi 四和弦垫（Am → F → C → G）+ 程序鼓组（底鼓/军鼓/反拍踩镲带 swing）。
 * - 风噪/雨声/警笛/轮胎啸叫/枪声/爆炸：保持程序合成（这些合成效果已够味且零加载）。
 * 必须由用户手势调用 start()（浏览器 autoplay 政策）；采样异步加载，未就绪前对应音效静默跳过。
 */

// 和弦进行（Hz）：Am / F / C / G，根音 + 三度 + 五度
const CHORDS: number[][] = [
  [110.0, 220.0, 261.63, 329.63],
  [87.31, 174.61, 220.0, 261.63],
  [65.41, 130.81, 164.81, 196.0],
  [98.0, 196.0, 246.94, 293.66],
];
const CHORD_SECONDS = 4;
const MUSIC_GAIN = 0.15;
const ENGINE_GAIN = 0.34;
const WIND_GAIN = 0.18;
const AUDIO_SETTING_KEY = 'midnight-pursuit:game-audio-enabled';

// 采样清单：键名 → 变体数，对应 /sounds/<键名><i>.ogg
const VARIANTS: Record<string, number> = { step: 5, punch: 5, crash: 5, thud: 3 };
// 单文件采样：/sounds/<键名>.ogg
const SINGLES = ['horn', 'door_open', 'door_close', 'engine_start'];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineSrc: AudioBufferSourceNode | null = null;
  private engineSub!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private sirenGain!: GainNode;
  private screechGain!: GainNode;
  private chordIndex = 0;
  private nextChordTime = 0;
  private noiseBuf: AudioBuffer | null = null;

  private readonly buffers = new Map<string, AudioBuffer[]>();
  private hornNode: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private strideAcc = 1.2; // 起步后很快出第一步
  private lastCrash = 0;
  private enabled = true;
  private samplesReady: Promise<void> | null = null;

  constructor() {
    try { this.enabled = localStorage.getItem(AUDIO_SETTING_KEY) !== 'false'; } catch { /* 存储不可用时默认开启。 */ }
  }

  get soundEnabled(): boolean { return this.enabled; }

  setSoundEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.ctx && this.ctx.state !== 'closed') {
      this.master.gain.setValueAtTime(enabled ? 0.9 : 0, this.ctx.currentTime);
    }
    try { localStorage.setItem(AUDIO_SETTING_KEY, String(enabled)); } catch { /* 本次运行内仍然生效。 */ }
  }

  /** 必须在用户手势（点击开始）里调用 */
  start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(ctx.destination);

    // —— 引擎：采样循环（异步加载后挂上）+ 次低频正弦，低通出"车身里听"的闷感 ——
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 1000;
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'sine';
    this.engineSub.frequency.value = 32;
    this.engineSub.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineSub.start();

    // —— 风噪 ——
    const noiseLen = ctx.sampleRate * 2;
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = noiseBuf;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    noise.start();

    // —— 雨声：同一噪声源过高频带通，雨量控制音量 ——
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = noiseBuf;
    rainSrc.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2400;
    rainFilter.Q.value = 0.35;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.master);
    rainSrc.start(0, 1);

    // —— 警笛：三角波基频 + 慢正弦 LFO 扫频（经典 wail），响度由通缉系统控制 ——
    const siren = ctx.createOscillator();
    siren.type = 'triangle';
    siren.frequency.value = 720;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.75;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 170;
    lfo.connect(lfoGain);
    lfoGain.connect(siren.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    siren.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    siren.start();
    lfo.start();

    // —— 轮胎啸叫（漂移）：同一噪声源过高频带通 ——
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = noiseBuf;
    screechSrc.loop = true;
    const screechBp = ctx.createBiquadFilter();
    screechBp.type = 'bandpass';
    screechBp.frequency.value = 1500;
    screechBp.Q.value = 3.5;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    screechSrc.connect(screechBp);
    screechBp.connect(this.screechGain);
    this.screechGain.connect(this.master);
    screechSrc.start(0, 0.5);

    this.nextChordTime = ctx.currentTime + 0.3;
    this.samplesReady = this.loadSamples(ctx);
  }

  /** Allocate/decode behind the loading screen; user interaction resumes playback. */
  async prepare(): Promise<void> {
    this.start();
    await this.ctx?.suspend().catch(() => {});
    await this.samplesReady;
  }

  pause(): void {
    this.setHorn(false);
    void this.ctx?.suspend().catch(() => {});
  }

  resume(): void {
    void this.ctx?.resume().catch(() => {});
  }

  stop(): void {
    void this.ctx?.close().catch(() => {});
  }

  /** 异步加载全部采样；单个失败静默降级（对应音效不响，不影响其余） */
  private async loadSamples(ctx: AudioContext): Promise<void> {
    const load = async (key: string, url: string): Promise<void> => {
      try {
        const res = await fetch(url);
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        let list = this.buffers.get(key);
        if (!list) this.buffers.set(key, (list = []));
        list.push(buf);
      } catch {
        // 缺文件/解码失败 → 该音效静默
      }
    };
    const jobs: Promise<void>[] = [];
    for (const [key, n] of Object.entries(VARIANTS)) {
      for (let i = 0; i < n; i++) jobs.push(load(key, `/sounds/${key}${i}.ogg`));
    }
    for (const key of SINGLES) jobs.push(load(key, `/sounds/${key}.ogg`));
    jobs.push(
      load('engine_loop', '/sounds/engine_loop.wav').then(() => {
        const buf = this.buffers.get('engine_loop')?.[0];
        if (buf && !this.engineSrc && ctx.state !== 'closed') {
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          src.playbackRate.value = 0.5;
          src.connect(this.engineFilter);
          src.start();
          this.engineSrc = src;
        }
      }),
    );
    await Promise.all(jobs);
  }

  /** 采样一击即发：同键多变体随机挑一个，变调抖动去重复感 */
  private playBuf(key: string, gain: number, rate = 1, jitter = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const list = this.buffers.get(key);
    if (!list || list.length === 0) return;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)]!;
    src.playbackRate.value = rate * (1 + (Math.random() - 0.5) * jitter);
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(this.master);
    src.start();
  }

  /** 轮胎啸叫 0~1（手刹漂移时开） */
  setScreech(level: number): void {
    if (!this.ctx) return;
    this.screechGain.gain.setTargetAtTime(
      Math.min(level, 1) * 0.12,
      this.ctx.currentTime,
      0.08,
    );
  }

  /** 警笛响度 0~1（0 = 静音；随最近警车距离渐变） */
  setSiren(level: number): void {
    if (!this.ctx) return;
    this.sirenGain.gain.setTargetAtTime(
      Math.min(level, 1) * 0.055,
      this.ctx.currentTime,
      0.3,
    );
  }

  /** 每帧调用：调度音乐 + 更新引擎/风噪参数。throttle 0~1 为油门（催 RPM 的"轰"感） */
  update(speedKmh: number, driving: boolean, throttle = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;

    // 音乐调度（提前 0.5s 排队下一个和弦 + 鼓组）
    if (!document.body.classList.contains('menu-open') && ctx.currentTime > this.nextChordTime - 0.5) {
      this.nextChordTime = Math.max(this.nextChordTime, ctx.currentTime + .05);
      this.scheduleChord(ctx, CHORDS[this.chordIndex]!, this.nextChordTime);
      this.scheduleDrums(ctx, this.nextChordTime);
      this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
      this.nextChordTime += CHORD_SECONDS;
    }

    // 非有限数保险丝：物理极端失稳时车速可能是 NaN——setTargetAtTime 遇非有限数
    // 会抛异常中断整个渲染循环（表现为画面卡死），这里必须掐断
    const safeKmh = Number.isFinite(speedKmh) ? speedKmh : 0;
    const speed01 = Math.min(Math.abs(safeKmh) / 110, 1);
    const t = ctx.currentTime;

    // 引擎 RPM：怠速 0.5 倍速 → 全速 2 倍速，油门再催一点；亚低频正弦跟随
    const rpm = 0.5 + Math.pow(speed01, 0.9) * 1.5 + throttle * 0.12;
    this.engineSrc?.playbackRate.setTargetAtTime(rpm, t, 0.09);
    this.engineSub.frequency.setTargetAtTime(30 + speed01 * 90 + throttle * 8, t, 0.09);
    // 低通随车速开阖：怠速在车里听是闷的，上速后声音"亮"出来
    this.engineFilter.frequency.setTargetAtTime(700 + speed01 * 2600 + throttle * 400, t, 0.15);
    this.engineGain.gain.setTargetAtTime(
      driving ? ENGINE_GAIN * (0.4 + 0.4 * speed01 + 0.2 * throttle) : 0,
      t,
      0.15,
    );

    // 风噪随速度
    this.windFilter.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.2);
    this.windGain.gain.setTargetAtTime(speed01 * speed01 * WIND_GAIN, t, 0.2);
  }

  /** 每帧调用（步行时）：按步幅距离触发脚步声，速度越快步频越高 */
  setMovement(state: string, speed: number, dt: number): void {
    if (state !== 'walk' && state !== 'run') {
      this.strideAcc = 1.2;
      return;
    }
    this.strideAcc += speed * dt;
    const strideLen = state === 'run' ? 2.6 : 1.7;
    if (this.strideAcc >= strideLen) {
      this.strideAcc = 0;
      this.playBuf('step', state === 'run' ? 0.34 : 0.18, state === 'run' ? 1.06 : 1, 0.16);
    }
  }

  /** 起跳：蹬地脚步 + 短促风声 */
  jump(): void {
    const ctx = this.ctx;
    this.playBuf('step', 0.22, 0.82, 0.1);
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(420, t);
    bp.frequency.exponentialRampToValueAtTime(950, t + 0.18);
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.25);
  }

  /** 落地闷响；hard=true 为硬着陆（坠落伤害级） */
  land(hard: boolean): void {
    this.playBuf('thud', hard ? 0.55 : 0.2, hard ? 0.85 : 1.05, 0.12);
  }

  /** 行人被击中（子弹/拳脚为拳肉声；runOver=true 车撞加一记闷响） */
  pedHit(runOver: boolean): void {
    this.playBuf('punch', 0.5, 1, 0.18);
    if (runOver) this.playBuf('thud', 0.6, 0.9, 0.1);
  }

  /** 车祸金属撞击，intensity 0~1 定响度与调门（重撞更低沉）。内置 0.12s 冷却防连响刷屏 */
  crash(intensity: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastCrash < 0.12) return;
    this.lastCrash = ctx.currentTime;
    const k = Math.min(intensity, 1);
    this.playBuf('crash', 0.22 + 0.5 * k, 1.05 - 0.3 * k, 0.15);
    if (k > 0.55) this.playBuf('thud', 0.5, 0.8, 0.1);
  }

  /** 喇叭（按住 F 持续响）：采样循环 + 短包络避免爆音 */
  setHorn(on: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.hornNode) {
      const buf = this.buffers.get('horn')?.[0];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02);
      src.connect(g);
      g.connect(this.master);
      src.start();
      this.hornNode = { src, gain: g };
    } else if (!on && this.hornNode) {
      const { src, gain } = this.hornNode;
      this.hornNode = null;
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      src.stop(ctx.currentTime + 0.15);
    }
  }

  /** 车门（open=true 开门 / false 关门"砰"） */
  door(open: boolean): void {
    this.playBuf(open ? 'door_open' : 'door_close', 0.45, 1, 0.06);
  }

  /** 点火启动 */
  engineStart(): void {
    this.playBuf('engine_start', 0.4, 1, 0.04);
  }

  /** 雨量 0~1 → 雨声音量（背景氛围级，不盖过引擎与音乐） */
  setRain(w: number): void {
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(0.04 * w, this.ctx.currentTime, 0.4);
  }

  /** 拾取/购买提示音：短促上扬双音 */
  blip(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1320, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** 枪声：噪声脉冲过带通。heavy=true 为手枪（更响+低频砰），false 为机枪连发（短促） */
  gunshot(heavy: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = heavy ? 750 : 1400;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(heavy ? 0.5 : 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (heavy ? 0.22 : 0.09));
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.3);

    if (heavy) {
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(140, t);
      thump.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.4, t);
      tg.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      thump.connect(tg);
      tg.connect(this.master);
      thump.start(t);
      thump.stop(t + 0.2);
    }
  }

  /** 爆炸：低频扫频 + 闷噪声尾 */
  explosion(): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const t = ctx.currentTime;
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(110, t);
    boom.frequency.exponentialRampToValueAtTime(26, t + 0.7);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.7, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    boom.connect(bg);
    bg.connect(this.master);
    boom.start(t);
    boom.stop(t + 0.9);

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.8);
  }

  private scheduleChord(ctx: AudioContext, freqs: number[], when: number): void {
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = f < 100 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      const peak = (f < 100 ? 1.2 : 0.7) * (MUSIC_GAIN / freqs.length);
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(peak, when + 1.2);
      gain.gain.setValueAtTime(peak, when + CHORD_SECONDS - 0.8);
      gain.gain.linearRampToValueAtTime(0, when + CHORD_SECONDS + 0.4);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(when);
      osc.stop(when + CHORD_SECONDS + 0.5);
    }
  }

  /** lo-fi 鼓组：120bpm，底鼓四踩 + 2/4 拍军鼓 + 反拍踩镲（带一点 swing），音量克制垫在和弦下 */
  private scheduleDrums(ctx: AudioContext, when: number): void {
    if (!this.noiseBuf) return;
    for (let b = 0; b < 8; b++) {
      const t = when + b * 0.5;
      if (b % 2 === 0) this.kick(ctx, t);
      if (b === 2 || b === 6) this.snare(ctx, t);
      this.hat(ctx, t + 0.25 + (b % 2) * 0.02);
    }
  }

  private kick(ctx: AudioContext, t: number): void {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.13, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private snare(ctx: AudioContext, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.15);
  }

  private hat(ctx: AudioContext, t: number): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf!;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.028, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 0.07);
  }
}
