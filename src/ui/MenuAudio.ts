/** 首页音频在游戏中挂起，返回时复用已加载的音源。 */
export class MenuAudio {
  private readonly music = new Audio('/sounds/system-overload.ogg');
  private readonly events = new AbortController();
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private enabled = true;
  private unlocked = false;
  private ending = false;
  private intro = false;
  private lastHover = 0;
  private finishTimer = 0;
  private readonly button = document.querySelector<HTMLButtonElement>('#music-btn')!;

  constructor() {
    this.music.id = 'menu-music';
    this.music.loop = true;
    this.music.preload = 'auto';
    this.music.hidden = true;
    document.body.append(this.music);
    const signal = this.events.signal;
    this.button.addEventListener('click', () => {
      if (this.ending) return;
      // 首次点击“开启音乐”解锁；播放后再次点击才关闭。
      this.enabled = !this.unlocked || !this.enabled;
      if (this.enabled) this.activate(); else { this.music.pause(); this.refresh(); }
    }, { signal });
    document.addEventListener('click', event => {
      if (this.ending || (event.target as Element).closest('#music-btn')) return;
      if (this.enabled) this.activate();
      if ((event.target as Element).closest('#menu button, dialog button')) this.tone(true);
    }, { capture: true, signal });
    document.addEventListener('keydown', event => {
      if (this.ending || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
          (event.target as Element).closest('#music-btn')) return;
      if (this.enabled && !this.unlocked) this.activate();
    }, { signal });
    document.addEventListener('pointerover', event => {
      const button = (event.target as Element).closest('button');
      if (!button || button.contains((event as PointerEvent).relatedTarget as Node | null)) return;
      if (button.closest('#menu, dialog')) this.tone(false);
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.music.pause();
      else if (this.enabled && !this.ending) this.activate();
    }, { signal });
    window.addEventListener('intro:started', () => {
      this.intro = true;
      this.fade(.1, .12);
    }, { signal });
    window.addEventListener('game:started', () => this.finish(), { signal });
    window.addEventListener('game:home', () => {
      window.clearTimeout(this.finishTimer);
      this.ending = false;
      this.intro = false;
      if (this.enabled) this.activate();
      else this.refresh();
    }, { signal });
    this.music.addEventListener('playing', () => this.refresh(), { signal });
    this.music.addEventListener('error', () => {
      this.button.querySelector('span')!.textContent = '音乐重试';
      this.button.setAttribute('aria-pressed', 'false');
      this.unlocked = false;
    }, { signal });
    this.refresh();
    this.activate();
  }

  private activate(): void {
    if (this.ending || !this.enabled || document.hidden) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.gain = this.ctx.createGain();
        this.gain.gain.value = 0;
        this.ctx.createMediaElementSource(this.music).connect(this.gain);
        this.gain.connect(this.ctx.destination);
        this.ctx.addEventListener('statechange', () => this.refresh(), { signal: this.events.signal });
      }
      void this.ctx.resume().catch(() => {});
      if (this.music.error) this.music.load();
      this.fade(this.intro ? .1 : .38, .35);
      void this.music.play().then(() => {
        if (this.ending || !this.enabled || document.hidden) this.music.pause();
        this.refresh();
      }).catch(() => {
        if (!this.ending && this.enabled) { this.unlocked = false; this.refresh(); }
      });
      this.refresh();
    } catch { this.unlocked = false; this.refresh(); }
  }

  private refresh(): void {
    const playing = this.enabled && this.ctx?.state === 'running' && !this.music.paused && !this.ending;
    this.unlocked = playing;
    this.button.setAttribute('aria-pressed', String(playing));
    this.button.querySelector('span')!.textContent = playing ? '音乐 开' : this.enabled ? '开启音乐' : '音乐 关';
    this.button.title = 'System Overload · Alexander Ehlers';
  }

  private fade(volume: number, seconds: number): void {
    if (!this.ctx || !this.gain) return;
    this.gain.gain.cancelAndHoldAtTime(this.ctx.currentTime);
    this.gain.gain.linearRampToValueAtTime(volume, this.ctx.currentTime + seconds);
  }

  private tone(click: boolean): void {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running' || this.ending || this.intro) return;
    const now = this.ctx.currentTime;
    if (!click && now - this.lastHover < .09) return;
    this.lastHover = now;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(click ? 440 : 880, now);
    osc.frequency.exponentialRampToValueAtTime(click ? 110 : 1200, now + .09);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(click ? .09 : .025, now + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .12);
    osc.connect(gain); gain.connect(this.ctx.destination);
    osc.start(); osc.stop(now + .13);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }

  private finish(): void {
    if (this.ending) return;
    this.ending = true;
    this.fade(0, .55);
    this.finishTimer = window.setTimeout(() => {
      this.music.pause();
      void this.ctx?.suspend().catch(() => {});
    }, 600);
  }
}
