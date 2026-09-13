import * as THREE from 'three';
import type { Input } from '../core/Input';
import type { GameAudio } from '../core/Audio';
import type { HealthSystem } from './Health';
import type { WeaponSystem } from './Weapons';
import type { WantedSystem } from './Wanted';
import type { Vehicle } from '../entities/Vehicle';
import { Beacon } from '../ui/Beacon';

// 武器店/喷漆店位置（人行道拐角）
const GUN_X = 53.5;
const GUN_Z = 10.5;
const SPRAY_X = -42.5;
const SPRAY_Z = 74.5;

const GUN_RANGE = 4.5; // 步行进店
const SPRAY_RANGE = 6; // 开车进店

const PRICE_PISTOL = 100;
const PRICE_MG = 150;
const PRICE_GRENADE = 120;
const PRICE_SPRAY = 200;
const PRICE_REPAIR = 150;

/**
 * 商店（经济支出端）：
 * - 武器店（蓝色光柱,步行靠近）：J/K/L 购买三种弹药。
 * - 喷漆店（橙色光柱,开车靠近）：J 喷漆换牌,清除通缉（Pay'n'Spray）。
 */
export class Shops {
  private readonly input: Input;
  private readonly audio: GameAudio;
  private readonly health: HealthSystem;
  private readonly weapons: WeaponSystem;
  private readonly wanted: WantedSystem;

  private readonly panel: HTMLDivElement;
  private lastShown = '';
  private msg = '';
  private msgTimer = 0;

  constructor(
    scene: THREE.Scene,
    input: Input,
    audio: GameAudio,
    health: HealthSystem,
    weapons: WeaponSystem,
    wanted: WantedSystem,
  ) {
    this.input = input;
    this.audio = audio;
    this.health = health;
    this.weapons = weapons;
    this.wanted = wanted;

    // 店铺光柱（比剧情金柱矮且淡,常亮不脉动）
    new Beacon(scene, 0x54a8ff, { radius: 1, height: 10, opacity: 0.16 }).setPosition(GUN_X, GUN_Z);
    new Beacon(scene, 0xff9a3d, { radius: 1, height: 10, opacity: 0.16 }).setPosition(SPRAY_X, SPRAY_Z);

    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:11;max-width:340px;' +
      'background:rgba(8,10,14,.75);border-left:3px solid #54a8ff;border-radius:6px;' +
      'padding:8px 14px;color:#f2f2f2;font:13px/1.7 system-ui,sans-serif;' +
      'pointer-events:none;user-select:none;display:none;white-space:pre-line;';
    document.body.appendChild(this.panel);
  }

  update(dt: number, playerPos: THREE.Vector3, driving: boolean, vehicle: Vehicle | null): void {
    this.msgTimer -= dt;
    if (this.msgTimer <= 0) this.msg = '';

    const dGun = Math.hypot(playerPos.x - GUN_X, playerPos.z - GUN_Z);
    const dSpray = Math.hypot(playerPos.x - SPRAY_X, playerPos.z - SPRAY_Z);

    if (dGun < GUN_RANGE && !driving) {
      this.show(
        '#54a8ff',
        `【武器店】现金 $${this.health.money}\n` +
          `J 手枪弹 +24　$${PRICE_PISTOL}（现 ${this.weapons.ammoOf('pistol')}）\n` +
          `K 机枪弹 +120　$${PRICE_MG}（现 ${this.weapons.ammoOf('mg')}）\n` +
          `L 手雷 +3　$${PRICE_GRENADE}（现 ${this.weapons.ammoOf('grenade')}）` +
          (this.msg ? `\n${this.msg}` : ''),
      );
      if (this.input.wasPressed('KeyJ')) this.buyAmmo('pistol', PRICE_PISTOL, 24);
      if (this.input.wasPressed('KeyK')) this.buyAmmo('mg', PRICE_MG, 120);
      if (this.input.wasPressed('KeyL')) this.buyAmmo('grenade', PRICE_GRENADE, 3);
    } else if (dSpray < SPRAY_RANGE && driving && vehicle) {
      this.show(
        '#ff9a3d',
        `【喷漆店】现金 $${this.health.money}\n` +
          `J 喷漆换牌　$${PRICE_SPRAY}——立刻清除通缉\n` +
          `K 修车　$${PRICE_REPAIR}（车况 ${Math.ceil(vehicle.condition)}%${vehicle.wrecked ? '·报废' : ''}）` +
          (this.msg ? `\n${this.msg}` : ''),
      );
      if (this.input.wasPressed('KeyJ')) {
        if (this.wanted.stars === 0) {
          this.toast('现在没人在追你');
        } else if (this.health.spend(PRICE_SPRAY)) {
          this.wanted.clearAll();
          this.audio.blip();
          this.toast('✓ 换了新涂装,警察认不出这辆车了');
        } else {
          this.toast('现金不足');
        }
      }
      if (this.input.wasPressed('KeyK')) {
        if (vehicle.condition >= 100) {
          this.toast('这车好得很,不用修');
        } else if (this.health.spend(PRICE_REPAIR)) {
          vehicle.repair();
          this.audio.blip();
          this.toast('✓ 修好了,跟新的一样');
        } else {
          this.toast('现金不足');
        }
      }
    } else {
      this.show('', '');
    }
  }

  /** 店铺位置（小地图用）：cb(x, z, colorHex) */
  forEachShop(cb: (x: number, z: number, color: string) => void): void {
    cb(GUN_X, GUN_Z, '#54a8ff');
    cb(SPRAY_X, SPRAY_Z, '#ff9a3d');
  }

  private buyAmmo(kind: 'pistol' | 'mg' | 'grenade', price: number, count: number): void {
    if (this.health.spend(price)) {
      this.weapons.addAmmo(kind, count);
      this.audio.blip();
      this.toast(`✓ 已购买（-$${price}）`);
    } else {
      this.toast('现金不足');
    }
  }

  private toast(text: string): void {
    this.msg = text;
    this.msgTimer = 2.5;
    this.lastShown = ''; // 强制刷新面板
  }

  private show(accent: string, text: string): void {
    if (text === this.lastShown) return;
    this.lastShown = text;
    if (!text) {
      this.panel.style.display = 'none';
      return;
    }
    this.panel.style.display = 'block';
    this.panel.style.borderLeftColor = accent;
    this.panel.textContent = text;
  }
}
