import type * as THREE from 'three';
import { LOOT_NAMES, SurvivalInventory, type StoredItem, type InventoryState } from './SurvivalInventory';
import type { SurvivalLoot, WorldLoot } from './SurvivalLoot';
import type { HealthSystem } from './Health';
import type { HostileCamp } from './HostileCamp';

export const SURVIVAL_SAVE_KEY = 'shanghai-survival-v1';
interface SaveData {
  version: 1; savedAt: number; inventory: InventoryState; stash: StoredItem[]; worldLoot: WorldLoot[];
  consumed: string[]; defeated: string[]; money: number; hp: number; sequence: number;
}
const validItem = (item: unknown): item is StoredItem => {
  if (!item || typeof item !== 'object') return false;
  const p = item as StoredItem;
  if (!Object.hasOwn(LOOT_NAMES, p.kind)) return false;
  const max = p.kind === 'pistolAmmo' ? 24 : p.kind === 'mgAmmo' ? 60 : p.kind === 'bandage' || p.kind === 'grenade' ? 3 : 1;
  return Number.isInteger(p.count) && p.count > 0 && p.count <= max &&
    (p.kind === 'armor' ? Number.isFinite(p.durability) && p.durability! >= 0 && p.durability! <= 100 : p.durability === undefined);
};

/** Atomic browser snapshots keep inventory, consumed pickups, enemies and drops together. */
export class SurvivalSession {
  readonly stash: StoredItem[] = [];
  readonly worldLoot: WorldLoot[] = [];
  loaded = false;
  status = '尚未存档 · 物资可带回避难所保管';
  onCarryCleared: (() => void) | null = null;
  private readonly inventory: SurvivalInventory;
  private readonly loot: SurvivalLoot;
  private readonly health: HealthSystem;
  private readonly enemies: HostileCamp;
  private sequence = 0;
  private active = false;
  private writable = true;
  private timer = 0;
  private lastState = '';
  private readonly persistent: boolean;

  constructor(inventory: SurvivalInventory, loot: SurvivalLoot, health: HealthSystem, enemies: HostileCamp, persistent = true) {
    this.inventory = inventory; this.loot = loot; this.health = health; this.enemies = enemies;
    this.persistent = persistent;
    if (persistent) this.load(); else this.status = '独立竞技对局 · 不读取或写入自由模式存档';
    loot.onExternalPickup = id => {
      const index = this.worldLoot.findIndex(p => p.id === id); if (index >= 0) this.worldLoot.splice(index, 1);
      loot.setWorldLoot(this.worldLoot); this.save();
    };
    loot.onChanged = () => this.save();
    window.addEventListener('pagehide', () => { if (this.active) this.save(); });
  }

  start(): void { this.active = true; }

  private load(): void {
    try {
      const raw = localStorage.getItem(SURVIVAL_SAVE_KEY); if (!raw) return;
      const s = JSON.parse(raw) as SaveData, probe = new SurvivalInventory();
      const finitePosition = (p: WorldLoot) => [p.x,p.y,p.z].every(n => Number.isFinite(n) && Math.abs(n) < 100000);
      if (s.version !== 1 || !probe.restore(s.inventory) || !Array.isArray(s.stash) || s.stash.length > 256 || !s.stash.every(validItem) ||
        !Array.isArray(s.worldLoot) || s.worldLoot.length > 2048 || !s.worldLoot.every(p => validItem(p) && typeof p.id === 'string' && /^drop:\d+:\d+$/.test(p.id) && finitePosition(p) && (p.source === undefined || p.source === 'death' || p.source === 'enemy')) ||
        new Set(s.worldLoot.map(p => p.id)).size !== s.worldLoot.length || !Array.isArray(s.consumed) || s.consumed.length > 50000 ||
        !s.consumed.every(id => typeof id === 'string' && id.length < 100) || !Array.isArray(s.defeated) || s.defeated.length > 3 ||
        !s.defeated.every(id => ['camp:0','camp:1','camp:2'].includes(id)) || !Number.isInteger(s.sequence) || s.sequence < 0 || s.sequence > 1000000 ||
        !Number.isFinite(s.hp) || s.hp < 0 || s.hp > 100 || !Number.isInteger(s.money) || s.money < 0 || s.money > 1000000000) throw Error('Invalid save');
      this.inventory.restore(s.inventory); this.stash.push(...s.stash); this.worldLoot.push(...s.worldLoot);
      this.loot.restoreConsumed(s.consumed); this.loot.setWorldLoot(this.worldLoot); this.enemies.restoreDefeated(s.defeated);
      this.health.money = s.money; this.health.hp = s.hp > 0 ? s.hp : 100; this.sequence = s.sequence;
      this.loaded = true; this.status = '已读取本地存档 · 从避难所继续';
    } catch {
      this.writable = false;
      this.status = '存档无法读取或浏览器不允许存储；当前为临时会话，旧记录未覆盖。可在此点击保存重试。';
    }
  }

  save(explicit = false): string {
    if (!this.persistent) return this.status;
    if (!this.active) return this.status;
    if (!this.writable && !explicit) return this.status;
    const state = { version: 1 as const, inventory: this.inventory.snapshot(), stash: this.stash, worldLoot: this.worldLoot,
      consumed: this.loot.consumedIds(), defeated: this.enemies.defeatedIds(), money: this.health.money, hp: this.health.hp, sequence: this.sequence };
    const fingerprint = JSON.stringify(state);
    if (!explicit && fingerprint === this.lastState) return this.status;
    try {
      localStorage.setItem(SURVIVAL_SAVE_KEY, JSON.stringify({ ...state, savedAt: Date.now() }));
      this.lastState = fingerprint; this.writable = true; this.status = '已保存到当前浏览器 · 随身物资死亡会掉落，仓库物资保留';
    } catch { this.status = '保存失败：浏览器存储不可用或已满。物资仍在当前会话，请保留此页面。'; }
    return this.status;
  }

  update(dt: number): void {
    if (!this.active) return; this.timer += dt;
    if (this.timer >= 2) { this.timer = 0; this.save(); }
  }

  depositAll(): string {
    const items = this.inventory.items(); if (!items.length) return '随身没有可存入的物资';
    if (this.stash.length + items.length > 256) return '仓库已满，请先取出物资';
    this.stash.push(...items); this.inventory.clear(); this.onCarryCleared?.();
    return `已存入 ${items.length} 份物资。${this.save(true)}`;
  }

  withdraw(index: number): string {
    if (!Number.isInteger(index) || index < 0 || index >= this.stash.length) return '物资已不在仓库中';
    const item = this.stash[index]!, error = this.inventory.collect(item.kind, item.count);
    if (error) return error;
    if (item.kind === 'armor') { this.inventory.armorDurability = item.durability!; this.inventory.onAppearanceChange?.(); }
    this.stash.splice(index, 1); this.save(true); return `已取出 ${LOOT_NAMES[item.kind]}`;
  }

  recoveryTarget(out: THREE.Vector3): string | null {
    const item = this.worldLoot.findLast(p => p.source === 'death'); if (!item) return null;
    out.set(item.x, item.y, item.z); return '取回遗落物资';
  }

  takeWorldItem(id: string): WorldLoot | null {
    const index = this.worldLoot.findIndex(p => p.id === id); if (index < 0) return null;
    const item = this.worldLoot.splice(index, 1)[0]!; this.loot.setWorldLoot(this.worldLoot); this.save(); return item;
  }

  createLoot(items: StoredItem[], position: THREE.Vector3, source: 'death' | 'enemy' = 'enemy'): boolean {
    if (this.worldLoot.length + items.length > 2048) return false;
    this.sequence++;
    items.forEach((item, i) => this.worldLoot.push({ ...item, source, id: `drop:${this.sequence}:${i}`,
      x: position.x + (i % 3 - 1) * .45, y: position.y, z: position.z + (Math.floor(i / 3) - 1) * .35 }));
    this.loot.setWorldLoot(this.worldLoot); return true;
  }

  loseCarriedItems(position: THREE.Vector3): void {
    const items = this.inventory.items();
    if (!this.createLoot(items, position, 'death')) {
      this.loot.message('地面遗落物资过多，本次装备保留。请先回收已有物资。'); this.save(true); return;
    }
    this.inventory.clear(); this.onCarryCleared?.(); this.save(true);
  }
}
