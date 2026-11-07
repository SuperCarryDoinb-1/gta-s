import { LOOT_NAMES, isWearable, type WearableKind, type LootKind, type SurvivalInventory, type SurvivalWeapon } from '../gameplay/SurvivalInventory';
import { itemIcon, survivorFigure } from './ItemIcons';

export interface NearbyLoot { id: string; kind: LootKind; count: number; distance: number }
interface InventoryActions {
  preview?: boolean;
  inventory: SurvivalInventory;
  isPlaying: () => boolean;
  nearby: () => NearbyLoot[];
  pickup: (id: string) => string;
  heal: () => string;
  equip: (kind: SurvivalWeapon) => void;
  currentWeapon: () => string;
  hp: () => number;
  portrait?: () => string;
  open: () => void;
  close: () => void;
}

const DESCRIPTION: Record<LootKind, string> = {
  backpack: '轻型背包 · 容量扩展至 12 格', pistol: '半自动手枪 · 按 1 装备', mg: '自动机枪 · 按 2 装备',
  grenade: '投掷物 · 按 3 装备', pistolAmmo: '手枪弹药 · 24 发 / 格', mgAmmo: '机枪弹药 · 60 发 / 格',
  bandage: '医疗物资 · 恢复 25 点生命',
  jacket: '蓝色上衣与深色长裤 · 外观套装，不增加防护',
  workwear: '橙色工装与深色长裤 · 外观套装，不增加防护',
  armor: '吸收枪弹伤害的 60%、爆炸伤害的 35%，消耗等量耐久；耗尽后失效。收起再穿不会修复。',
};

export class InventoryScreen {
  private readonly root = document.createElement('section');
  private readonly actions: InventoryActions;
  private opened = false;
  private selected: LootKind | null = null;
  private notice = '';
  private previousFocus: HTMLElement | null = null;
  private portraitUrl = '';
  get isOpen(): boolean { return this.opened; }

  constructor(actions: InventoryActions) {
    this.actions = actions;
    this.root.id = 'inventory-screen';
    this.root.hidden = true;
    this.root.tabIndex = -1;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', '背包与装备');
    document.body.append(this.root);
    window.addEventListener('keydown', e => {
      if (!this.actions.isPlaying()) return;
      if (e.code === 'KeyI' || (this.opened && e.code === 'Escape')) {
        e.preventDefault(); e.stopImmediatePropagation();
        if (!e.repeat) this.opened ? this.close() : this.open();
      } else if (this.opened && e.code === 'Tab') {
        const buttons = [...this.root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = buttons[(index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length];
        e.preventDefault(); next?.focus();
      }
    }, { capture: true });
    this.root.addEventListener('click', e => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button');
      if (!button || button.disabled) return;
      if (button.dataset.close !== undefined) { this.close(); return; }
      if (button.dataset.pickup) { this.notice = actions.pickup(button.dataset.pickup); this.portraitUrl = ''; }
      if (button.dataset.wear) {
        this.notice = actions.inventory.wear(button.dataset.wear as WearableKind | 'base');
        this.portraitUrl = '';
      }
      if (button.dataset.kind) this.selected = button.dataset.kind as LootKind;
      if (button.dataset.use !== undefined) this.notice = actions.heal();
      if (button.dataset.equip) {
        const kind = button.dataset.equip as SurvivalWeapon;
        actions.equip(kind);
        this.notice = actions.currentWeapon() === kind ? `已装备${LOOT_NAMES[kind]}` : `已收起${LOOT_NAMES[kind]}`;
      }
      this.render();
      const focus = button.dataset.kind ? this.root.querySelector<HTMLButtonElement>(`[data-kind="${button.dataset.kind}"]`) :
        button.dataset.use !== undefined ? this.root.querySelector<HTMLButtonElement>('[data-use]:not(:disabled)') : null;
      (focus ?? this.root).focus({ preventScroll: true });
    });
    window.addEventListener('blur', () => { if (this.opened) this.notice = '背包已打开，关闭后继续探索'; });
  }

  open(): void {
    if (this.opened || !this.actions.isPlaying()) return;
    this.opened = true;
    this.notice = '';
    this.portraitUrl = '';
    this.previousFocus = document.activeElement as HTMLElement | null;
    document.body.classList.add('inventory-open');
    this.actions.open();
    this.root.hidden = false;
    this.render();
    this.root.querySelector<HTMLButtonElement>('[data-close]')?.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.hidden = true;
    document.body.classList.remove('inventory-open');
    this.previousFocus?.focus({ preventScroll: true });
    this.actions.close();
  }

  private render(): void {
    const a = this.actions, inv = a.inventory, nearby = a.nearby();
    const stacks: { kind: LootKind; count: number }[] = [];
    if (inv.has('pistol')) stacks.push({ kind: 'pistol', count: 1 });
    if (inv.has('mg')) stacks.push({ kind: 'mg', count: 1 });
    const split = (kind: LootKind, amount: number, max: number): void => {
      for (let n = amount; n > 0; n -= max) stacks.push({ kind, count: Math.min(n, max) });
    };
    split('pistolAmmo', inv.ammo.pistol, 24); split('mgAmmo', inv.ammo.mg, 60);
    split('grenade', inv.ammo.grenade, 3); split('bandage', inv.bandages, 3);
    for (const kind of inv.storedWearables) stacks.push({ kind, count: 1 });
    if (inv.hasArmor && !inv.armorEquipped) stacks.push({ kind: 'armor', count: 1 });
    if (!this.portraitUrl && a.portrait) this.portraitUrl = a.portrait();
    const worn = (kind: WearableKind) => kind === 'armor' ? inv.armorEquipped : inv.outfit === kind;
    const owned = (kind: WearableKind) => kind === 'armor' ? inv.hasArmor : inv.outfits.has(kind);
    const wearableDetail = this.selected && isWearable(this.selected) ? `<button class="item-action" data-wear="${this.selected}" ${owned(this.selected) ? '' : 'disabled'}>${worn(this.selected) ? '收起' : '穿戴'}</button>` : '';
    const equipment = (kind: SurvivalWeapon, key: string): string => `<button class="equipment-slot ${inv.has(kind) ? 'owned' : ''}" data-equip="${kind}" ${!inv.has(kind) ? 'disabled' : ''}>
      <span class="slot-key">${key}</span>${itemIcon(kind)}<span>${LOOT_NAMES[kind]}<small>${inv.has(kind) ? (a.currentWeapon() === kind ? '当前装备' : '点击装备') : '尚未获得'}</small></span></button>`;
    this.root.innerHTML = `<div class="inventory-shell">
      <header class="inventory-header"><div class="inventory-brand"><span class="brand-mark">生</span><div><span class="eyebrow">URBAN SURVIVAL / FIELD KIT</span><h1>行囊<span>与装备</span></h1></div></div>
      <div class="inventory-status"><i></i> ${a.preview ? '交互样本' : '探索已暂停'} <button data-close aria-label="关闭背包">${a.preview ? '关闭样本' : '返回城市'} <kbd>I</kbd><span>×</span></button></div></header>
      <div class="inventory-layout">
      <section class="inventory-nearby"><div class="section-heading"><div><span class="eyebrow">01 / VICINITY</span><h2>附近物资</h2></div><span class="count-pill">${nearby.length}</span></div>
      <p class="section-description">触手可及的发现 <span>2.6 m 内</span></p><div class="nearby-list">${nearby.length ? nearby.map(p => `<button class="nearby-card item-${p.kind}" data-pickup="${p.id}" aria-label="拾取${LOOT_NAMES[p.kind]}"><span class="nearby-art">${itemIcon(p.kind)}</span><span class="nearby-copy"><strong>${LOOT_NAMES[p.kind]}</strong><small>${p.distance.toFixed(1)} m · ${p.count > 1 ? `数量 ${p.count}` : '装备'}</small></span><span class="pickup-plus">+</span></button>`).join('') : `<div class="nearby-empty"><span class="scan-ring">+</span><strong>周围暂时没有物资</strong><p>回到街区，继续寻找下一份补给。</p></div>`}</div>
      <div class="nearby-tip"><span>搜寻提示</span><p>靠近彩色物资后打开背包，<br>点击卡片即可放入行囊。</p></div></section>
      <section class="inventory-character"><div class="section-heading"><div><span class="eyebrow">02 / LOADOUT</span><h2>随身装备</h2></div><span class="character-level">探索者</span></div>
      <div class="character-stage"><span class="stage-coordinate">${a.portrait ? '3D / 当前装备' : 'FIELD / 001'}</span><div class="character-rings"></div>${this.portraitUrl ? `<img class="character-portrait" src="${this.portraitUrl}" alt="当前人物与穿戴装备的三维预览">` : survivorFigure}
      <div class="gear-label gear-head">服装<span>${inv.outfit === 'base' ? '初始服装' : LOOT_NAMES[inv.outfit]}</span></div><div class="gear-label gear-armor">防护<span>${inv.armorEquipped ? `${Math.ceil(inv.armorDurability)} / 100${inv.armorDurability <= 0 ? ' 已损坏' : ''}` : '未装备'}</span></div><div class="gear-label gear-bag">行囊<span>${inv.hasBackpack ? '轻型背包' : '随身口袋'}</span></div>
      <div class="character-health"><span>生命状态 <b>${Math.ceil(a.hp())}<small> / 100</small></b></span><div><i style="width:${a.hp()}%"></i></div></div></div>
      <div class="wardrobe-equipment"><button data-wear="base" ${inv.outfit === 'base' ? 'disabled' : ''}>初始服装</button>${(['jacket','workwear','armor'] as const).map(kind => `<button data-kind="${kind}" ${!owned(kind) ? 'disabled' : ''} class="${worn(kind) ? 'is-worn' : ''}">${itemIcon(kind)}<span>${LOOT_NAMES[kind]}<small>${!owned(kind) ? '尚未找到' : worn(kind) ? '正在穿戴 · 点击查看' : '已拥有 · 点击查看'}</small></span></button>`).join('')}</div>
      <div class="equipment-list">${equipment('pistol', '1')}${equipment('mg', '2')}${equipment('grenade', '3')}</div></section>
      <section class="inventory-storage"><div class="section-heading"><div><span class="eyebrow">03 / INVENTORY</span><h2>${inv.hasBackpack ? '轻型背包' : '随身口袋'}</h2></div><div class="capacity-number">${inv.usedSlots}<span> / ${inv.capacity}</span></div></div>
      <div class="capacity-track"><i style="width:${inv.usedSlots / inv.capacity * 100}%"></i></div>
      <div class="storage-subhead"><span>物资收纳</span><span>${inv.capacity - inv.usedSlots} 格可用</span></div>
      <div class="inventory-grid">${Array.from({ length: inv.capacity }, (_, i) => {
        const p = stacks[i];
        return p ? `<button class="inventory-cell item-${p.kind} ${this.selected === p.kind ? 'selected' : ''}" data-kind="${p.kind}" aria-label="${LOOT_NAMES[p.kind]} 数量${p.count}"><span class="cell-index">${String(i + 1).padStart(2, '0')}</span>${itemIcon(p.kind)}<span class="cell-name">${LOOT_NAMES[p.kind]}</span>${p.count > 1 ? `<b class="cell-count">${p.count}</b>` : ''}</button>` : `<div class="inventory-cell empty"><span class="cell-index">${String(i + 1).padStart(2, '0')}</span><span>+</span></div>`;
      }).join('')}</div>
      <div class="item-inspector">${this.selected ? `<div class="inspector-art">${itemIcon(this.selected)}</div><div><span class="eyebrow">物品详情</span><h3>${LOOT_NAMES[this.selected]}</h3><p>${DESCRIPTION[this.selected]}${this.selected === 'armor' && inv.hasArmor ? ` 当前耐久 ${Math.ceil(inv.armorDurability)} / 100。` : ''}</p></div>${wearableDetail || (this.selected === 'bandage' ? `<button class="item-action" data-use ${inv.bandages <= 0 || a.hp() >= 100 ? 'disabled' : ''}>使用绷带</button>` : this.selected === 'pistol' || this.selected === 'mg' || this.selected === 'grenade' ? `<button class="item-action" data-equip="${this.selected}" ${!inv.has(this.selected) ? 'disabled' : ''}>${a.currentWeapon() === this.selected ? '收起' : '装备'}</button>` : '')}` : `<span class="inspector-placeholder">点击格子中的物品，查看详情与操作</span>`}</div>
      <div class="inventory-notice" role="status">${this.notice || (inv.hasBackpack ? '行装就绪，下一处发现正在等你。' : '寻找背包，可将携带容量扩展至 12 格。')}</div></section></div>
      <footer class="inventory-footer"><span><i></i> 自由探索 <span class="footer-divider">/</span> 随身物资</span><div><kbd>点击</kbd> 选择 / 拾取 <kbd>I</kbd><kbd>Esc</kbd> 关闭</div><span>整装，再出发。</span></footer>
    </div>`;
  }
}
