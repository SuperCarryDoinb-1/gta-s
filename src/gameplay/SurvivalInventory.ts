export type SurvivalWeapon = 'pistol' | 'mg' | 'grenade';
export type OutfitKind = 'jacket' | 'workwear';
export type WearableKind = OutfitKind | 'armor';
export type DamageKind = 'impact' | 'bullet' | 'blast' | 'zone';
export type LootKind = SurvivalWeapon | 'pistolAmmo' | 'mgAmmo' | 'bandage' | 'backpack' | WearableKind;
export const isWearable = (kind: LootKind): kind is WearableKind => kind === 'jacket' || kind === 'workwear' || kind === 'armor';
export interface StoredItem { kind: LootKind; count: number; durability?: number }
export interface InventoryState {
  ammo: { pistol: number; mg: number; grenade: number };
  weapons: Array<'pistol' | 'mg'>;
  bandages: number; backpack: boolean; outfits: OutfitKind[]; outfit: OutfitKind | 'base';
  armor: { owned: boolean; equipped: boolean; durability: number };
}

export const LOOT_NAMES: Record<LootKind, string> = {
  pistol: '手枪', mg: '机枪', grenade: '手雷', pistolAmmo: '手枪弹药',
  mgAmmo: '机枪弹药', bandage: '绷带', backpack: '背包',
  jacket: '海蓝夹克套装', workwear: '橙色工装套装', armor: '轻型防弹背心',
};

/** One source of truth for ownership, ammunition and carrying capacity. */
export class SurvivalInventory {
  readonly ammo = { pistol: 0, mg: 0, grenade: 0 };
  private readonly weapons = new Set<SurvivalWeapon>();
  bandages = 0;
  hasBackpack = false;
  readonly outfits = new Set<OutfitKind>();
  outfit: OutfitKind | 'base' = 'base';
  hasArmor = false;
  armorEquipped = false;
  armorDurability = 0;
  onAppearanceChange: (() => void) | null = null;

  snapshot(): InventoryState {
    return { ammo: { ...this.ammo }, weapons: [...this.weapons] as Array<'pistol' | 'mg'>,
      bandages: this.bandages, backpack: this.hasBackpack, outfits: [...this.outfits], outfit: this.outfit,
      armor: { owned: this.hasArmor, equipped: this.armorEquipped, durability: this.armorDurability } };
  }

  clear(): void {
    this.weapons.clear(); this.outfits.clear(); this.ammo.pistol = this.ammo.mg = this.ammo.grenade = 0;
    this.bandages = 0; this.hasBackpack = false; this.outfit = 'base';
    this.hasArmor = this.armorEquipped = false; this.armorDurability = 0; this.onAppearanceChange?.();
  }

  /** Validate in a separate inventory before replacing the active state. */
  restore(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    const s = value as InventoryState, integer = (n: unknown) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 100000;
    if (!s.ammo || !['pistol','mg','grenade'].every(k => integer(s.ammo[k as keyof typeof s.ammo])) || !integer(s.bandages) ||
      typeof s.backpack !== 'boolean' || !Array.isArray(s.weapons) || s.weapons.length > 2 ||
      !s.weapons.every(k => k === 'pistol' || k === 'mg') || new Set(s.weapons).size !== s.weapons.length ||
      !Array.isArray(s.outfits) || s.outfits.length > 2 || !s.outfits.every(k => k === 'jacket' || k === 'workwear') ||
      new Set(s.outfits).size !== s.outfits.length || !(s.outfit === 'base' || s.outfits.includes(s.outfit)) ||
      !s.armor || typeof s.armor.owned !== 'boolean' || typeof s.armor.equipped !== 'boolean' ||
      !Number.isFinite(s.armor.durability) || s.armor.durability < 0 || s.armor.durability > 100 ||
      (!s.armor.owned && (s.armor.equipped || s.armor.durability !== 0))) return false;
    const candidate = new SurvivalInventory();
    Object.assign(candidate.ammo, s.ammo); s.weapons.forEach(k => candidate.weapons.add(k));
    s.outfits.forEach(k => candidate.outfits.add(k)); candidate.bandages = s.bandages; candidate.hasBackpack = s.backpack;
    candidate.outfit = s.outfit; candidate.hasArmor = s.armor.owned; candidate.armorEquipped = s.armor.equipped; candidate.armorDurability = s.armor.durability;
    if (candidate.usedSlots > candidate.capacity) return false;
    this.clear(); Object.assign(this.ammo, candidate.ammo); candidate.weapons.forEach(k => this.weapons.add(k));
    candidate.outfits.forEach(k => this.outfits.add(k)); this.bandages = candidate.bandages; this.hasBackpack = candidate.hasBackpack;
    this.outfit = candidate.outfit; this.hasArmor = candidate.hasArmor; this.armorEquipped = candidate.armorEquipped; this.armorDurability = candidate.armorDurability;
    this.onAppearanceChange?.(); return true;
  }

  items(): StoredItem[] {
    const result: StoredItem[] = [];
    if (this.hasBackpack) result.push({ kind: 'backpack', count: 1 });
    for (const kind of ['pistol','mg'] as const) if (this.has(kind)) result.push({ kind, count: 1 });
    for (const [kind, count, stack] of [['pistolAmmo',this.ammo.pistol,24],['mgAmmo',this.ammo.mg,60],['grenade',this.ammo.grenade,3],['bandage',this.bandages,3]] as const)
      for (let n = count; n > 0; n -= stack) result.push({ kind, count: Math.min(n, stack) });
    for (const kind of this.outfits) result.push({ kind, count: 1 });
    if (this.hasArmor) result.push({ kind: 'armor', count: 1, durability: this.armorDurability });
    return result;
  }

  get storedWearables(): WearableKind[] {
    return [...this.outfits].filter(kind => kind !== this.outfit);
  }

  /** Wearing an item frees its storage slot; removing it needs room in the bag. */
  wear(kind: WearableKind | 'base'): string {
    if (kind === 'armor') {
      if (!this.hasArmor) return '尚未找到护甲';
      if (this.armorEquipped && this.usedSlots >= this.capacity) return '背包已满，无法收起护甲';
      this.armorEquipped = !this.armorEquipped;
    } else {
      if (kind !== 'base' && !this.outfits.has(kind)) return '尚未找到这套服装';
      const next = this.outfit === kind ? 'base' : kind;
      if (next === 'base' && this.outfit !== 'base' && this.usedSlots >= this.capacity) return '背包已满，无法收起服装';
      this.outfit = next;
    }
    this.onAppearanceChange?.();
    return kind === 'armor' ? (this.armorEquipped ? '已穿戴防弹背心' : '已收起防弹背心') : '已更换服装';
  }

  absorbDamage(amount: number, kind: DamageKind): number {
    if (!this.armorEquipped || this.armorDurability <= 0 || (kind !== 'bullet' && kind !== 'blast')) return amount;
    const absorbed = Math.min(this.armorDurability, amount * (kind === 'bullet' ? .6 : .35));
    this.armorDurability = Math.max(0, this.armorDurability - absorbed);
    if (this.armorDurability === 0) this.onAppearanceChange?.();
    return amount - absorbed;
  }

  get capacity(): number { return this.hasBackpack ? 12 : 4; }
  get usedSlots(): number {
    return Number(this.has('pistol')) + Number(this.has('mg')) +
      Math.ceil(this.ammo.pistol / 24) + Math.ceil(this.ammo.mg / 60) +
      Math.ceil(this.ammo.grenade / 3) + Math.ceil(this.bandages / 3) +
      this.storedWearables.length + Number(this.hasArmor && !this.armorEquipped);
  }

  has(kind: SurvivalWeapon): boolean {
    return kind === 'grenade' ? this.ammo.grenade > 0 : this.weapons.has(kind);
  }

  collect(kind: LootKind, count = 1): string | null {
    if (!Number.isInteger(count) || count <= 0) return '物资数量无效';
    if (isWearable(kind)) {
      if (count !== 1) return '装备每次拾取一件';
      if (kind === 'armor' ? this.hasArmor && this.armorDurability > 0 : this.outfits.has(kind)) return '已经拥有这件装备';
      const replacing = kind === 'armor' && this.hasArmor;
      if (!replacing && this.usedSlots >= this.capacity) return '空间不足，无法拾取装备';
      if (kind === 'armor') { this.hasArmor = true; this.armorDurability = 100; }
      else this.outfits.add(kind);
      this.onAppearanceChange?.();
      return null;
    }
    if (kind === 'backpack') {
      if (this.hasBackpack) return '已经装备背包';
      this.hasBackpack = true;
      this.onAppearanceChange?.();
      return null;
    }
    if (kind === 'pistol' || kind === 'mg') {
      if (this.has(kind)) return '已经拥有这把武器';
      if (this.usedSlots >= this.capacity) return '容量不足，先寻找背包或使用物资';
      this.weapons.add(kind);
      return null;
    }
    const before = this.usedSlots;
    const current = kind === 'bandage' ? this.bandages :
      this.ammo[kind === 'pistolAmmo' ? 'pistol' : kind === 'mgAmmo' ? 'mg' : 'grenade'];
    const stack = kind === 'pistolAmmo' ? 24 : kind === 'mgAmmo' ? 60 : 3;
    if (before - Math.ceil(current / stack) + Math.ceil((current + count) / stack) > this.capacity) {
      return '容量不足，先寻找背包或使用物资';
    }
    if (kind === 'bandage') this.bandages += count;
    else this.ammo[kind === 'pistolAmmo' ? 'pistol' : kind === 'mgAmmo' ? 'mg' : 'grenade'] += count;
    return null;
  }

  get summary(): string {
    return `${this.hasBackpack ? '背包' : '随身'} ${this.usedSlots}/${this.capacity} 格 · I 查看 · B 绷带`;
  }

  get contents(): string {
    return [this.summary, '',
      `1 手枪：${this.has('pistol') ? '已获得' : '未获得'} · 子弹 ${this.ammo.pistol}`,
      `2 机枪：${this.has('mg') ? '已获得' : '未获得'} · 子弹 ${this.ammo.mg}`,
      `3 手雷：${this.ammo.grenade} 枚`, `绷带：${this.bandages} · 每个恢复 25 HP`, '',
      'G 拾取 · 再按数字键收起武器', '避难所 F 保管与保存；死亡遗落随身物资，可返回回收',
    ].join('\n');
  }
}
