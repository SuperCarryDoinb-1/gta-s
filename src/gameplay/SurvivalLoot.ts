import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { GameAudio } from '../core/Audio';
import { CHUNK_SIZE, chunkZone } from '../world/City';
import type { HealthSystem } from './Health';
import { LOOT_NAMES, SurvivalInventory, isWearable, type LootKind, type StoredItem } from './SurvivalInventory';
import { itemIcon } from '../ui/ItemIcons';
import type { NearbyLoot } from '../ui/InventoryScreen';
import { clearLootPosition } from '../world/ShanghaiLayout';

interface LootPoint {
  id: string;
  kind: LootKind;
  count: number;
  mesh: THREE.Group;
  durability?: number;
  source?: 'death' | 'enemy';
}
export interface WorldLoot extends StoredItem { id: string; x: number; y: number; z: number; source?: 'death' | 'enemy' }

const COLORS: Record<LootKind, number> = {
  backpack: 0x52dfbd, pistol: 0xffce6b, mg: 0xffce6b, grenade: 0xff896b,
  pistolAmmo: 0x77baff, mgAmmo: 0x77baff, bandage: 0xff91bb,
  jacket: 0x5b9ac0, workwear: 0xe4a15f, armor: 0xaab796,
};
const ROUTE: ReadonlyArray<readonly [LootKind, number, number, number]> = [
  ['backpack', 1, 11, 16], ['pistol', 1, 11, 25], ['pistolAmmo', 24, 11, 32],
  ['bandage', 3, 11, 40], ['mg', 1, 11, 48], ['mgAmmo', 60, 11, 56],
  ['grenade', 2, 11, 64],
  ['bandage', 2, -1, 32], ['pistolAmmo', 24, 2, 29],
  ['jacket', 1, 11, 5], ['workwear', 1, 11, 74],
  ['armor', 1, 39, -24],
];

/** Stream a bounded set of markers; consumed point IDs survive chunk unloads. */
export class SurvivalLoot {
  private readonly chunks = new Map<string, LootPoint[]>();
  private readonly collected = new Set<string>();
  private readonly external = new Map<string, LootPoint>();
  onExternalPickup: ((id: string) => void) | null = null;
  onChanged: (() => void) | null = null;

  consumedIds(): string[] { return [...this.collected]; }
  restoreConsumed(ids: string[]): void {
    this.collected.clear(); ids.forEach(id => this.collected.add(id));
    for (const points of this.chunks.values()) for (const p of points) if (this.collected.has(p.id)) p.mesh.visible = false;
  }
  setWorldLoot(items: WorldLoot[]): void {
    const desired = new Set(items.map(item => item.id));
    for (const [id, p] of this.external) if (!desired.has(id)) { this.scene.remove(p.mesh); this.external.delete(id); }
    for (const item of items) {
      if (this.external.has(item.id)) continue;
      const p = this.add(item.id, item.kind, item.count, item.x, item.z);
      if (p) { p.mesh.position.y = item.y; p.durability = item.durability; p.source = item.source; this.external.set(item.id, p); }
    }
  }
  private *points(): Generator<LootPoint> {
    for (const points of this.chunks.values()) yield* points;
    yield* this.external.values();
  }
  private readonly box = new THREE.BoxGeometry(0.48, 0.32, 0.34);
  private readonly ring = new THREE.RingGeometry(0.3, 0.34, 24);
  private readonly materials = new Map<LootKind, THREE.MeshStandardMaterial>();
  private readonly rings = new Map<LootKind, THREE.MeshBasicMaterial>();
  private readonly panel = document.createElement('div');
  private time = 0;
  private toastTime = 0;
  private toast = '';
  private lastPanel = '';
  private region = '';
  hint = '';
  private nearest: LootPoint | null = null;
  private readonly playerPosition = new THREE.Vector3();
  private blocked = true;
  private readonly scene: THREE.Scene;
  private readonly input: Input;
  private readonly audio: GameAudio;
  readonly inventory: SurvivalInventory;
  private readonly health: HealthSystem;
  private readonly procedural: boolean;

  constructor(
    scene: THREE.Scene,
    input: Input,
    audio: GameAudio,
    inventory: SurvivalInventory,
    health: HealthSystem,
    procedural = true,
  ) {
    this.scene = scene;
    this.input = input;
    this.audio = audio;
    this.inventory = inventory;
    this.health = health;
    this.procedural = procedural;
    this.panel.id = 'survival-inventory';
    this.panel.style.display = 'none';
    document.body.appendChild(this.panel);
    for (const kind of Object.keys(COLORS) as LootKind[]) {
      this.materials.set(kind, new THREE.MeshStandardMaterial({
        color: COLORS[kind], emissive: COLORS[kind], emissiveIntensity: 0.08, roughness: 0.7,
      }));
      this.rings.set(kind, new THREE.MeshBasicMaterial({
        color: COLORS[kind], transparent: true, opacity: 0.3, side: THREE.DoubleSide,
      }));
    }
  }

  private add(id: string, kind: LootKind, count: number, x: number, z: number): LootPoint | null {
    if (this.collected.has(id)) return null;
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.box, this.materials.get(kind));
    body.position.y = 0.4;
    if (kind === 'pistol' || kind === 'mg') body.scale.set(1.5, 0.5, 0.7);
    if (kind === 'backpack') body.scale.set(1, 1.6, 1);
    if (isWearable(kind)) {
      body.scale.set(.9, .9, .55);
      for (const side of [-1, 1]) {
        const sleeve = new THREE.Mesh(this.box, this.materials.get(kind));
        sleeve.scale.set(.3, kind === 'armor' ? .35 : .85, .65);
        sleeve.position.set(side * .27, .05, 0); sleeve.rotation.z = side * .4;
        body.add(sleeve);
      }
    }
    const ring = new THREE.Mesh(this.ring, this.rings.get(kind));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    mesh.add(body, ring);
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);
    return { id, kind, count, mesh };
  }

  private stream(pos: THREE.Vector3): void {
    if (!this.procedural) return;
    const cx = Math.round(pos.x / CHUNK_SIZE), cz = Math.round(pos.z / CHUNK_SIZE);
    const region = `${cx},${cz}`;
    if (region === this.region) return;
    this.region = region;
    const desired = new Set<string>();
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) {
      if (chunkZone(x) !== 'city') continue;
      const key = `${x},${z}`;
      desired.add(key);
      if (this.chunks.has(key)) continue;
      const points: LootPoint[] = [];
      const put = (id: string, kind: LootKind, n: number, px: number, pz: number): void => {
        const point = this.add(id, kind, n, px, pz);
        if (point) points.push(point);
      };
      if (x === 0 && z === 0) {
        ROUTE.forEach(([kind, n, px, pz], i) => put(`intro:${i}`, kind, n, px, pz));
      } else if (x === -1 && z === 0) {
        put('oldtown:coat', 'workwear', 1, -95, 32); put('oldtown:medicine', 'bandage', 3, -97, 32);
        put('oldtown:bag', 'backpack', 1, -83, 16); put('oldtown:ammo', 'pistolAmmo', 24, -112, 6);
      } else if (x === 2 && z === 2) {
        put('port:gun', 'mg', 1, 192, 192); put('port:ammo', 'mgAmmo', 60, 195, 192);
        put('port:armor', 'armor', 1, 192, 196); put('port:medicine', 'bandage', 2, 178, 208);
      } else {
        // Clothing belongs by residential/shop fronts; armor is scarcer than basic supplies.
        const kinds: LootKind[] = ['bandage', 'pistolAmmo', 'jacket', 'backpack', 'mgAmmo', 'workwear', 'armor', 'bandage', 'pistol', 'grenade', 'mg'];
        for (let i = 0; i < 4; i++) {
          const seed = Math.abs(x * 31 + z * 17 + i * 13);
          const kind = kinds[seed % kinds.length]!;
          const count = kind === 'pistolAmmo' ? 24 : kind === 'mgAmmo' ? 60 : kind === 'bandage' ? 2 : 1;
          let px = x * CHUNK_SIZE + (i % 2 === 0 ? -21 : 11);
          const pz = z * CHUNK_SIZE + (i < 2 ? -16 : 16);
          if (!clearLootPosition(px, pz)) px = 174;
          put(`${key}:${i}`, kind, count, px, pz);
        }
      }
      this.chunks.set(key, points);
    }
    for (const [key, points] of this.chunks) if (!desired.has(key)) {
      points.forEach(p => this.scene.remove(p.mesh));
      this.chunks.delete(key);
    }
  }

  update(dt: number, pos: THREE.Vector3, blocked: boolean, playing: boolean): void {
    this.panel.style.display = playing ? 'block' : 'none';
    if (!playing) { this.hint = ''; return; }
    this.time += dt;
    this.toastTime = Math.max(0, this.toastTime - dt);
    this.stream(pos);
    this.playerPosition.copy(pos);
    this.blocked = blocked;
    if (!blocked && this.health.hp > 0 && this.input.wasPressed('KeyB')) {
      this.useBandage();
    }
    this.nearest = null;
    let distance = Infinity;
    for (const point of this.points()) {
      if (!point.mesh.visible) continue;
      const body = point.mesh.children[0]!;
      body.rotation.y = this.time * 0.7;
      body.position.y = 0.4 + Math.sin(this.time * 2 + point.mesh.position.x) * 0.06;
      const d = point.mesh.position.distanceToSquared(pos);
      if (d < distance) { distance = d; this.nearest = point; }
    }
    this.hint = '';
    if (!blocked && this.health.hp > 0 && this.nearest && distance < 2.8 ** 2) {
      const p = this.nearest;
      this.hint = `G 拾取 ${LOOT_NAMES[p.kind]}${p.count > 1 ? ` ×${p.count}` : ''}`;
      if (this.input.wasPressed('KeyG')) {
        this.pickup(p.id);
      }
    }
    const text = `<div class="survival-brief"><span>${this.inventory.hasBackpack ? '背包' : '随身'}</span><b>${this.inventory.usedSlots} / ${this.inventory.capacity}</b><kbd>I</kbd></div>` +
      (this.inventory.armorEquipped ? `<div class="armor-brief">护甲 ${Math.ceil(this.inventory.armorDurability)} / 100${this.inventory.armorDurability <= 0 ? ' · 已损坏' : ''}<div><i style="width:${this.inventory.armorDurability}%"></i></div></div>` : '') +
      (this.toastTime > 0 ? `<div class="survival-toast">${this.toast}</div>` : '') +
      (this.hint && this.nearest ? `<div class="ground-loot-preview"><span>${itemIcon(this.nearest.kind)}</span><div><small>发现物资</small><strong>${LOOT_NAMES[this.nearest.kind]}${this.nearest.count > 1 ? ` ×${this.nearest.count}` : ''}</strong></div><kbd>G</kbd></div>` : '');
    if (text !== this.lastPanel) { this.panel.innerHTML = text; this.lastPanel = text; }
  }

  prepare(pos: THREE.Vector3): void {
    this.stream(pos);
    this.playerPosition.copy(pos);
  }

  nearbyItems(): NearbyLoot[] {
    if (this.blocked || this.health.hp <= 0) return [];
    const items: NearbyLoot[] = [];
    for (const p of this.points()) {
      if (!p.mesh.visible || p.mesh.position.distanceToSquared(this.playerPosition) >= 2.8 ** 2) continue;
      items.push({ id: p.id, kind: p.kind, count: p.count,
        distance: Math.hypot(p.mesh.position.x - this.playerPosition.x, p.mesh.position.z - this.playerPosition.z) });
    }
    return items.sort((a,b) => a.distance - b.distance);
  }

  pickup(id: string): string {
    if (!this.nearbyItems().some(p => p.id === id)) return '物资不在可拾取范围内';
    for (const p of this.points()) {
      if (p.id !== id) continue;
      const error = this.inventory.collect(p.kind, p.count);
      if (error) { this.message(error); return error; }
      if (p.kind === 'armor' && p.durability !== undefined) {
        this.inventory.armorDurability = p.durability; this.inventory.onAppearanceChange?.();
      }
      const external = this.external.has(id);
      if (!external) this.collected.add(id);
      p.mesh.visible = false; this.hint = '';
      this.audio.blip();
      const text = `已拾取 ${LOOT_NAMES[p.kind]}${p.count > 1 ? ` ×${p.count}` : ''}`;
      this.message(text);
      if (external) this.onExternalPickup?.(id);
      this.onChanged?.();
      return text;
    }
    return '物资已被拾取';
  }

  useBandage(): string {
    let text: string;
    if (this.blocked || this.health.hp <= 0) text = '当前状态无法使用绷带';
    else if (this.health.hp >= 100) text = '生命值已满，未消耗绷带';
    else if (this.inventory.bandages <= 0) text = '没有绷带，继续搜索物资';
    else {
      this.inventory.bandages--; this.health.heal(25); this.audio.blip();
      text = '使用绷带，恢复 25 HP';
      this.onChanged?.();
    }
    this.message(text);
    return text;
  }

  message(text: string): void { this.toast = text; this.toastTime = 3; }

  targetInfo(out: THREE.Vector3): string | null {
    if (!this.nearest) return null;
    out.copy(this.nearest.mesh.position);
    return `搜索：${LOOT_NAMES[this.nearest.kind]}`;
  }

  forEachPoint(cb: (x: number, z: number, color: string) => void): void {
    for (const p of this.points()) {
      if (p.mesh.visible) cb(p.mesh.position.x, p.mesh.position.z, p.source === 'death' ? '#ffd58a' : `#${COLORS[p.kind].toString(16).padStart(6, '0')}`);
    }
  }
}
