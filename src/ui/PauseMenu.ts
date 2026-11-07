import { exitImmersive } from '../core/Input';
import './pause.css';

interface PauseActions {
  isPlaying: () => boolean;
  pause: () => void;
  resume: () => void;
  home: () => void;
  end: () => void;
  soundEnabled: () => boolean;
  setSoundEnabled: (enabled: boolean) => void;
}

/** Esc 只打开菜单；忽略长按重复事件，选择“继续游戏”恢复。 */
export class PauseMenu {
  private readonly dialog = document.createElement('dialog');
  private readonly actions: PauseActions;
  private paused = false;
  private ended = false;
  private hadPointerLock = false;

  constructor(actions: PauseActions) {
    this.actions = actions;
    this.dialog.id = 'pause-menu';
    this.dialog.setAttribute('aria-labelledby', 'pause-title');
    this.dialog.setAttribute('aria-describedby', 'pause-description');
    this.dialog.innerHTML = `
      <p class="pause-kicker">MIDNIGHT PURSUIT</p>
      <h2 id="pause-title">游戏已暂停</h2>
      <p id="pause-description">稍作休息，夜晚等你继续。</p>
      <div class="pause-actions">
        <button id="pause-resume" autofocus>继续游戏</button>
        <button id="pause-home">返回首页</button>
        <button id="pause-quit">结束游戏</button>
      </div>
      <button id="pause-sound" type="button" role="switch" aria-checked="true" aria-label="游戏音效">
        <span>游戏音效</span><span id="pause-sound-state" aria-hidden="true">开</span>
      </button>
      <p class="pause-hint"><kbd>↑</kbd> <kbd>↓</kbd> 选择 · <kbd>Enter</kbd> 确认</p>`;
    document.body.append(this.dialog);
    this.dialog.querySelector('#pause-resume')!.addEventListener('click', () => this.resume());
    this.dialog.querySelector('#pause-home')!.addEventListener('click', () => this.home());
    this.dialog.querySelector('#pause-quit')!.addEventListener('click', () => this.quit());
    this.dialog.querySelector('#pause-sound')!.addEventListener('click', () => {
      if (this.ended) return;
      this.actions.setSoundEnabled(!this.actions.soundEnabled());
      this.refreshSound();
    });
    this.refreshSound();
    this.dialog.addEventListener('cancel', event => event.preventDefault());
    window.addEventListener('keydown', event => {
      if (!this.actions.isPlaying() || this.ended) return;
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) this.pause();
      } else if (this.paused && ['ArrowUp', 'ArrowDown'].includes(event.code)) {
        event.preventDefault();
        const buttons = Array.from(this.dialog.querySelectorAll<HTMLButtonElement>('button'));
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const step = event.code === 'ArrowDown' ? 1 : -1;
        buttons[(current + step + buttons.length) % buttons.length]!.focus();
      }
    }, { capture: true });
    // 浏览器可能优先消费 Esc（包括长按退出全屏），用鼠标解锁事件兜底。
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement !== null;
      if (this.hadPointerLock && !locked) this.pause();
      this.hadPointerLock = locked;
    });
  }

  private pause(): void {
    if (!this.actions.isPlaying() || this.paused || this.ended) return;
    this.paused = true;
    this.actions.pause();
    document.body.classList.add('game-paused');
    document.exitPointerLock();
    this.refreshSound();
    this.dialog.showModal();
  }

  private refreshSound(): void {
    const enabled = this.actions.soundEnabled();
    this.dialog.querySelector('#pause-sound')!.setAttribute('aria-checked', String(enabled));
    this.dialog.querySelector('#pause-sound-state')!.textContent = enabled ? '开' : '关';
  }

  private resume(): void {
    if (!this.paused || this.ended) return;
    this.paused = false;
    this.dialog.close();
    document.body.classList.remove('game-paused');
    this.actions.resume();
  }

  private home(): void {
    // 已结束的会话需要重新创建；普通返回首页保留已加载的场景。
    if (this.ended) {
      const url = new URL(location.href);
      url.searchParams.delete('autotest');
      location.replace(url.href);
      return;
    }
    this.paused = false;
    this.dialog.close();
    document.body.classList.remove('game-paused');
    this.actions.home();
  }

  private quit(): void {
    if (this.ended) return;
    this.ended = true;
    this.actions.end();
    exitImmersive();
    document.body.classList.add('game-ended');
    this.dialog.querySelector('#pause-title')!.textContent = '游戏已结束';
    this.dialog.querySelector('#pause-description')!.textContent = '感谢游玩。你可以关闭当前窗口，或返回首页重新开始。';
    this.dialog.querySelector<HTMLButtonElement>('#pause-resume')!.hidden = true;
    this.dialog.querySelector<HTMLButtonElement>('#pause-quit')!.hidden = true;
    this.dialog.querySelector<HTMLButtonElement>('#pause-sound')!.hidden = true;
    this.dialog.querySelector<HTMLElement>('.pause-hint')!.hidden = true;
    this.dialog.querySelector<HTMLButtonElement>('#pause-home')!.focus();
    // 普通标签页可能禁止脚本关窗，此时保留可操作的结束页面。
    window.close();
  }
}
