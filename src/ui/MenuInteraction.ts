/** Pointer-only title effects. Reuses one canvas and stops drawing outside the homepage. */
export class MenuInteraction {
  private readonly menu: HTMLElement;
  private readonly canvas = document.createElement('canvas');
  private readonly reticle = document.createElement('div');
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  private readonly events = new AbortController();
  private readonly observer: MutationObserver;
  private readonly stars = Array.from({ length: 44 }, (_, i) => ({
    x: ((i * 0.61803398875) % 1), y: ((i * 0.381966 + .17) % 1), phase: i * 1.73,
  }));
  private ripples: { x: number; y: number; age: number }[] = [];
  private enabled = true;
  private inside = false;
  private frame = 0;
  private lastTime = 0;
  private width = 1;
  private height = 1;
  private targetX = 0;
  private targetY = 0;
  private x = 0;
  private y = 0;
  private hover: HTMLElement | null = null;

  constructor(menu: HTMLElement) {
    this.menu = menu;
    this.canvas.className = 'interaction-field';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.reticle.className = 'pointer-reticle';
    this.reticle.setAttribute('aria-hidden', 'true');
    this.reticle.innerHTML = '<i></i><i></i><i></i><i></i>';
    menu.append(this.canvas, this.reticle);
    this.ctx = this.canvas.getContext('2d');
    const signal = this.events.signal;
    menu.addEventListener('pointermove', this.move, { passive: true, signal });
    menu.addEventListener('pointerleave', this.reset, { signal });
    menu.addEventListener('pointerdown', this.pulse, { passive: true, signal });
    menu.addEventListener('scroll', this.reset, { passive: true, signal });
    window.addEventListener('blur', this.reset, { signal });
    window.addEventListener('resize', this.resize, { signal });
    document.addEventListener('visibilitychange', this.reset, { signal });
    window.addEventListener('game:started', this.reset, { signal });
    window.addEventListener('game:home', this.reset, { signal });
    window.addEventListener('intro:started', this.reset, { signal });
    this.finePointer.addEventListener('change', this.reset, { signal });
    this.observer = new MutationObserver(this.reset);
    document.querySelectorAll('dialog').forEach(dialog => this.observer.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
    this.resize();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  private canRun(): boolean {
    return this.enabled && this.finePointer.matches &&
      !this.menu.classList.contains('intro-playing') &&
      !document.hidden && document.body.classList.contains('menu-open') &&
      !document.querySelector('dialog[open]');
  }

  private resize = (): void => {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.reset();
  };

  private move = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || !this.canRun()) return;
    this.targetX = event.clientX;
    this.targetY = event.clientY;
    if (!this.inside) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.inside = true;
      this.menu.classList.add('pointer-active');
    }
    const next = (event.target as Element).closest<HTMLElement>('button, a, .chapter');
    if (next !== this.hover) {
      this.clearHover();
      this.hover = next;
    }
    const isAction = next?.matches('button, a') ?? false;
    this.reticle.classList.toggle('over-action', isAction);
    if (next) {
      const rect = next.getBoundingClientRect();
      next.style.setProperty('--glint-x', event.clientX - rect.left + 'px');
      next.style.setProperty('--glint-y', event.clientY - rect.top + 'px');
      if (next.id === 'start-btn') {
        next.style.setProperty('--magnet-x', ((event.clientX - rect.left - rect.width / 2) * .055).toFixed(2) + 'px');
        next.style.setProperty('--magnet-y', ((event.clientY - rect.top - rect.height / 2) * .1).toFixed(2) + 'px');
      }
    }
    if (!this.frame) {
      this.lastTime = performance.now();
      this.frame = requestAnimationFrame(this.draw);
    }
  };

  private pulse = (event: PointerEvent): void => {
    if (!this.inside || !this.canRun() || event.button !== 0) return;
    if (this.ripples.length === 5) this.ripples.shift();
    this.ripples.push({ x: event.clientX, y: event.clientY, age: 0 });
  };

  private draw = (time: number): void => {
    this.frame = 0;
    if (!this.inside || !this.canRun()) { this.reset(); return; }
    const dt = Math.min((time - this.lastTime) / 1000, .05);
    this.lastTime = time;
    const easing = 1 - Math.exp(-dt * 10);
    this.x += (this.targetX - this.x) * easing;
    this.y += (this.targetY - this.y) * easing;
    const nx = this.x / this.width - .5;
    const ny = this.y / this.height - .5;
    this.menu.style.setProperty('--depth-x', (nx * 22).toFixed(2) + 'px');
    this.menu.style.setProperty('--depth-y', (ny * 15).toFixed(2) + 'px');
    this.menu.style.setProperty('--title-x', (-nx * 9).toFixed(2) + 'px');
    this.menu.style.setProperty('--title-y', (-ny * 6).toFixed(2) + 'px');
    this.menu.style.setProperty('--pointer-x', this.x.toFixed(1) + 'px');
    this.menu.style.setProperty('--pointer-y', this.y.toFixed(1) + 'px');
    this.reticle.style.transform = 'translate3d(' + (this.x - 19) + 'px,' + (this.y - 19) + 'px,0)';
    const ctx = this.ctx;
    if (ctx) {
      ctx.clearRect(0, 0, this.width, this.height);
      // Sparse drifting points light up locally, leaving the artwork readable.
      for (const star of this.stars) {
        const sx = star.x * this.width + Math.sin(time * .00018 + star.phase) * 12;
        const sy = star.y * this.height + Math.cos(time * .00015 + star.phase) * 9;
        const distance = Math.hypot(sx - this.x, sy - this.y);
        const influence = Math.max(0, 1 - distance / 220);
        ctx.fillStyle = 'rgba(225,250,154,' + (.12 + influence * .6) + ')';
        ctx.fillRect(sx, sy, influence > .3 ? 2 : 1, influence > .3 ? 2 : 1);
        if (influence > 0) {
          ctx.strokeStyle = 'rgba(210,240,155,' + influence * .16 + ')';
          ctx.lineWidth = .6;
          ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(this.x, this.y); ctx.stroke();
        }
      }
      this.ripples = this.ripples.filter(ripple => {
        ripple.age += dt;
        if (ripple.age >= .7) return false;
        ctx.strokeStyle = 'rgba(229,255,89,' + (1 - ripple.age / .7) * .4 + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(ripple.x, ripple.y, 8 + ripple.age * 100, 0, Math.PI * 2); ctx.stroke();
        return true;
      });
    }
    this.frame = requestAnimationFrame(this.draw);
  };

  private clearHover(): void {
    for (const key of ['--magnet-x', '--magnet-y', '--glint-x', '--glint-y']) this.hover?.style.removeProperty(key);
    this.hover = null;
  }

  private reset = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.inside = false;
    this.ripples = [];
    this.clearHover();
    this.menu.classList.remove('pointer-active');
    for (const key of ['--depth-x', '--depth-y', '--title-x', '--title-y', '--pointer-x', '--pointer-y']) this.menu.style.removeProperty(key);
    this.ctx?.clearRect(0, 0, this.width, this.height);
  };

}
