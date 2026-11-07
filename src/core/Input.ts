export interface MouseDelta {
  x: number;
  y: number;
}

/**
 * 进入沉浸模式：全屏 + 键盘锁定。必须在用户手势（点击）里调用。
 * 全屏下 Keyboard Lock（Chrome）把 Tab/Alt 等系统键交给页面；
 * Esc 由游戏暂停菜单接管，释放鼠标并暂停游戏。
 */
export function enterImmersive(): void {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  const kb = (navigator as { keyboard?: { lock?: () => Promise<void> } }).keyboard;
  kb?.lock?.()?.catch(() => {}); // 不支持的浏览器静默跳过
}

/** 退出沉浸模式：释放鼠标 + 退出全屏（键盘锁随全屏退出自动解除） */
export function exitImmersive(): void {
  document.exitPointerLock();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

/**
 * 键鼠输入。
 * - 键盘：按 `KeyboardEvent.code` 记录（'KeyW'、'Space'、'ShiftLeft'…）。
 * - 鼠标：点击画布进入 pointer lock，之后 movementX/Y 累积到 delta，
 *   由消费方每帧 `consumeMouseDelta()` 取走并清零。
 * - `wasPressed` 是帧内边沿触发，主循环每帧末尾需调用 `endFrame()`。
 * - IME 屏蔽：焦点全程钉在 canvas 上——canvas 不是可编辑元素，
 *   输入法没有组词上下文，英文键不会触发候选窗/上屏（比密码框方案更彻底，
 *   部分国产输入法连密码框的直接输入约定都不遵守）。
 *   另挂 compositionstart 保险：一旦有组词冒头立即打断。
 * - 暂停时禁用输入并清空按键，菜单可以正常获取焦点。
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private jumpPressedAt = -Infinity;

  consumeJumpPress(): boolean {
    const fresh = performance.now() - this.jumpPressedAt < 160;
    this.jumpPressedAt = -Infinity;
    return fresh;
  }
  private deltaX = 0;
  private deltaY = 0;
  private wheel = 0;
  private locked = false;
  private enabled = true;
  private readonly element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    // canvas 默认不可聚焦；tabIndex=-1 允许编程聚焦（不进 Tab 序）
    element.tabIndex = -1;
    element.style.outline = 'none';
    this.focusGame();

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', () => {
      this.down.clear();
      this.pressed.clear();
      this.jumpPressedAt = -Infinity;
      this.deltaX = this.deltaY = this.wheel = 0;
    });
    // 保险丝：任何组词开始（不守规矩的输入法）立即打断——失焦可编辑目标即取消组合
    window.addEventListener('compositionstart', this.onComposition);
    window.addEventListener('keyup', this.onKeyUp);
    element.addEventListener('click', this.onClick);
    document.addEventListener('pointerlockchange', this.onLockChange);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    // 任何点击（开始按钮/画布）、切回窗口、进出全屏后都把焦点收回屏蔽盾
    document.addEventListener('click', this.onAnyClick);
    window.addEventListener('focus', this.onAnyClick);
    document.addEventListener('fullscreenchange', this.onAnyClick);
  }

  /** 焦点钉回 canvas（非可编辑元素 = 输入法无组词上下文） */
  private focusGame(): void {
    if (!this.enabled) return;
    const menu = document.getElementById('menu');
    if (menu && menu.style.display !== 'none' && !menu.classList.contains('leaving')) return;
    this.element.focus({ preventScroll: true });
  }

  private onAnyClick = (): void => {
    this.focusGame();
  };

  private onComposition = (e: CompositionEvent): void => {
    if (!this.enabled) return;
    const t = e.target;
    if (t instanceof HTMLElement) t.blur(); // 打断组词
    this.focusGame();
  };

  /** 按键当前是否按住 */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** 按键是否在本帧刚按下（边沿触发，endFrame 后清除） */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  get pointerLocked(): boolean {
    return this.locked;
  }

  /** 取走自上次调用以来累积的鼠标增量 */
  consumeMouseDelta(): MouseDelta {
    const d = { x: this.deltaX, y: this.deltaY };
    this.deltaX = 0;
    this.deltaY = 0;
    return d;
  }

  /** 取走累积的滚轮增量（向上滚为负） */
  consumeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** 每帧末尾调用，清除边沿状态 */
  endFrame(): void {
    this.pressed.clear();
  }

  setEnabled(enabled: boolean): void {
    this.jumpPressedAt = -Infinity;
    this.enabled = enabled;
    this.down.clear();
    this.pressed.clear();
    this.deltaX = this.deltaY = this.wheel = 0;
  }

  /** 自动化测试注入：模拟按住/松开某键（走与真实输入完全相同的路径） */
  debugHold(code: string, on: boolean): void {
    if (on && code === 'Space' && !this.down.has(code)) this.jumpPressedAt = performance.now();
    if (on) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    const menu = document.getElementById('menu');
    if (menu && menu.style.display !== 'none' && !menu.classList.contains('leaving')) return;
    if (e.code === 'Escape') return;
    if (this.locked) e.preventDefault();
    if (!e.repeat) this.pressed.add(e.code);
    if (!e.repeat && e.code === 'Space') this.jumpPressedAt = performance.now();
    this.down.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onClick = (): void => {
    if (!this.enabled) return;
    if (!this.locked) {
      this.jumpPressedAt = -Infinity;
      enterImmersive(); // 全屏切换拒绝锁定时，点击画布重试。
      this.element.requestPointerLock()?.catch(() => {});
    }
  };

  private onLockChange = (): void => {
    this.locked = document.pointerLockElement === this.element;
    if (!this.locked) {
      // 失焦时清空，防止按键"卡住"
      this.down.clear();
      this.pressed.clear();
    }
    this.focusGame(); // 进出锁定都把焦点钉回 canvas，输入法保持哑火
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled || !this.locked) return;
    this.deltaX += e.movementX;
    this.deltaY += e.movementY;
  };

  // 鼠标键记作 'Mouse0'（左）/'Mouse2'（右），与键盘共用 isDown/wasPressed
  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    const code = `Mouse${e.button}`;
    if (!this.down.has(code)) this.pressed.add(code);
    this.down.add(code);
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.down.delete(`Mouse${e.button}`);
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    this.wheel += e.deltaY;
  };
}
