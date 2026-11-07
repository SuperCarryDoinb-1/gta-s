import { LOOT_NAMES, type SurvivalInventory } from '../gameplay/SurvivalInventory';
import type { SurvivalSession } from '../gameplay/SurvivalSession';
import { itemIcon } from './ItemIcons';

interface ShelterActions {
  session: SurvivalSession; inventory: SurvivalInventory;
  isPlaying: () => boolean; near: () => boolean; open: () => void; close: () => void; rest: () => void;
}

export class ShelterScreen {
  private readonly root = document.createElement('section');
  private readonly actions: ShelterActions;
  private opened = false;
  private notice = '';
  get isOpen(): boolean { return this.opened; }

  constructor(actions: ShelterActions) {
    this.actions = actions; this.root.id = 'shelter-screen'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-modal', 'true'); this.root.setAttribute('aria-label', '避难所仓库与存档');
    document.body.append(this.root);
    window.addEventListener('keydown', e => {
      if (this.opened && (e.code === 'Escape' || e.code === 'KeyF')) {
        e.preventDefault(); e.stopImmediatePropagation(); if (!e.repeat) this.close(); return;
      }
      if (e.code === 'KeyF' && !e.repeat && actions.isPlaying() && actions.near()) {
        e.preventDefault(); e.stopImmediatePropagation(); this.open();
      } else if (this.opened && e.code === 'Tab') {
        const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault(); buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    }, { capture: true });
    this.root.addEventListener('click', e => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
      if (button.hasAttribute('data-close')) { this.close(); return; }
      if (button.hasAttribute('data-deposit')) this.notice = actions.session.depositAll();
      if (button.dataset.take !== undefined) this.notice = actions.session.withdraw(Number(button.dataset.take));
      if (button.hasAttribute('data-save')) { actions.rest(); this.notice = actions.session.save(true); }
      this.render(); this.root.querySelector<HTMLButtonElement>('[data-save]')?.focus();
    });
  }

  open(): void {
    if (this.opened || !this.actions.isPlaying() || !this.actions.near()) return;
    this.opened = true; this.notice = ''; document.body.classList.add('shelter-open');
    this.actions.open(); this.root.hidden = false; this.render(); this.root.querySelector<HTMLButtonElement>('[data-close]')?.focus();
  }
  close(): void {
    if (!this.opened) return; this.opened = false; this.root.hidden = true;
    document.body.classList.remove('shelter-open'); this.actions.close();
  }
  private render(): void {
    const { inventory, session } = this.actions;
    const card = (kind: Parameters<typeof itemIcon>[0], count: number, durability?: number) => `${itemIcon(kind)}<span><b>${LOOT_NAMES[kind as keyof typeof LOOT_NAMES]}</b><small>${durability === undefined ? `数量 ${count}` : `耐久 ${Math.ceil(durability)} / 100`}</small></span>`;
    this.root.innerHTML = `<div class="shelter-shell"><header><div><small>THE BUND / SAFEHOUSE</small><h1>滨江避难所</h1><p>把收获留下，再轻装出发。</p></div><button data-close>返回城市 <kbd>F / Esc</kbd></button></header>
      <div class="shelter-rules">随身物资死亡后掉落，可返回找回。仓库物资保留；重新进入游戏从此处继续。存档仅保存在当前浏览器。</div>
      <div class="shelter-columns"><section><h2>随身物资 <small>${inventory.usedSlots} / ${inventory.capacity} 格</small></h2><div class="shelter-items">${inventory.items().map(p => `<div class="shelter-item">${card(p.kind, p.count, p.durability)}</div>`).join('') || '<p class="shelter-empty">空手出发，搜集到的物资会显示在这里。</p>'}</div><button class="shelter-primary" data-deposit ${inventory.items().length ? '' : 'disabled'}>存入全部并保存</button><p>包含穿戴的服装、护甲与背包；取出后可在 I 背包中重新穿戴。</p></section>
      <section><h2>保管箱 <small>${session.stash.length} / 256 份</small></h2><div class="shelter-items">${session.stash.map((p, i) => `<button class="shelter-item" data-take="${i}" aria-label="取出${LOOT_NAMES[p.kind]}">${card(p.kind, p.count, p.durability)}<em>取出</em></button>`).join('') || '<p class="shelter-empty">仓库为空。把物资带回来存放。</p>'}</div><button class="shelter-primary" data-save>休整并保存当前进度</button><p>休整恢复生命；护甲保留剩余耐久。满包、重复武器会阻止取出。</p></section></div>
      <footer role="status">${this.notice || session.status}</footer></div>`;
  }
}
