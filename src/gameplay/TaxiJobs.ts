import * as THREE from 'three';
import { PITCH, CITY_MIN_BLOCK_X, SIDEWALK_LINE } from '../world/City';
import type { PersonInstance, PersonLibrary } from '../core/Loader';
import type { GameAudio } from '../core/Audio';
import type { HealthSystem } from './Health';
import { Beacon } from '../ui/Beacon';

const PICKUP_MIN = 60;
const PICKUP_MAX = 140;
const DEST_MIN = 120;
const DEST_MAX = 260;
const ARRIVE = 5.5;
const STOP_SPEED = 2; // km/h 视为停稳
const NEXT_FARE_DELAY = 2.5;

type JobState = 'none' | 'pickup' | 'ride';

/**
 * 出租车任务（经济收入端,可重复）：开着 taxi 就自动接单——
 * 去接乘客（停稳上车）→ 送到目的地（停稳收车费,按里程计价）。
 * 中途下车 = 乘客跑单。目标点绿色光柱 + HUD 导航。
 */
export class TaxiJobs {
  private state: JobState = 'none';
  private cooldown = 1;
  private readonly pickupPos = new THREE.Vector3();
  private readonly destPos = new THREE.Vector3();
  private fareBase = 0;

  private readonly health: HealthSystem;
  private readonly audio: GameAudio;
  private readonly passenger: PersonInstance;
  private readonly beacon: Beacon;
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private time = 0;

  constructor(scene: THREE.Scene, personLib: PersonLibrary, audio: GameAudio, health: HealthSystem) {
    this.audio = audio;
    this.health = health;

    this.passenger = personLib.spawn('Rogue');
    this.passenger.root.visible = false;
    scene.add(this.passenger.root);
    const idle = this.passenger.actions.get('Idle');
    if (idle) idle.play();

    this.beacon = new Beacon(scene, 0x51ff7e, {
      radius: 1.2,
      height: 16,
      opacity: 0.25,
      pulse: { base: 0.18, amp: 0.08 },
    });

    this.toastEl = document.createElement('div');
    this.toastEl.style.cssText =
      'position:fixed;left:50%;bottom:20%;transform:translateX(-50%);z-index:10;' +
      'background:rgba(8,14,8,.72);border-left:3px solid #51ff7e;border-radius:6px;' +
      'padding:6px 14px;color:#eaffea;font:14px/1.6 system-ui,sans-serif;' +
      'pointer-events:none;user-select:none;display:none;';
    document.body.appendChild(this.toastEl);
  }

  /** 每帧调用。drivingTaxi = 正开着 taxi 车型 */
  update(dt: number, playerPos: THREE.Vector3, drivingTaxi: boolean, speedKmh: number): void {
    this.time += dt;
    this.passenger.mixer.update(dt);
    this.toastTimer -= dt;
    if (this.toastTimer <= 0) this.toastEl.style.display = 'none';
    this.beacon.update(this.time);

    if (!drivingTaxi) {
      if (this.state !== 'none') {
        this.toast('乘客跑单了——回到出租车上重新接单');
        this.cancel();
      }
      return;
    }

    switch (this.state) {
      case 'none':
        this.cooldown -= dt;
        if (this.cooldown <= 0) {
          this.pickCorner(playerPos, PICKUP_MIN, PICKUP_MAX, this.pickupPos);
          this.passenger.root.position.set(this.pickupPos.x, 0.04, this.pickupPos.z);
          this.passenger.root.visible = true;
          this.state = 'pickup';
          this.toast('新乘客在招手——去接客(停稳车)');
        }
        break;

      case 'pickup': {
        // 乘客面向出租车干等
        this.passenger.root.rotation.y = Math.atan2(
          -(playerPos.x - this.pickupPos.x),
          -(playerPos.z - this.pickupPos.z),
        );
        const d = Math.hypot(playerPos.x - this.pickupPos.x, playerPos.z - this.pickupPos.z);
        if (d < ARRIVE && Math.abs(speedKmh) < STOP_SPEED) {
          this.passenger.root.visible = false;
          this.pickCorner(playerPos, DEST_MIN, DEST_MAX, this.destPos);
          this.fareBase = Math.round(
            35 + Math.hypot(this.destPos.x - playerPos.x, this.destPos.z - playerPos.z) * 0.4,
          );
          this.state = 'ride';
          this.toast(`乘客上车:送到目的地(车费 $${this.fareBase})`);
        }
        break;
      }

      case 'ride': {
        const d = Math.hypot(playerPos.x - this.destPos.x, playerPos.z - this.destPos.z);
        if (d < ARRIVE && Math.abs(speedKmh) < STOP_SPEED) {
          this.health.addMoney(this.fareBase);
          this.audio.blip();
          this.toast(`✓ 送达!+$${this.fareBase}`);
          this.state = 'none';
          this.cooldown = NEXT_FARE_DELAY;
        }
        break;
      }
    }

    // 光柱跟随当前目标
    if (this.state === 'pickup') {
      this.beacon.setPosition(this.pickupPos.x, this.pickupPos.z);
    } else if (this.state === 'ride') {
      this.beacon.setPosition(this.destPos.x, this.destPos.z);
    } else {
      this.beacon.hide();
    }
  }

  /** 当前目标点(HUD 导航/小地图用),无任务返回 null */
  targetInfo(out: THREE.Vector3): string | null {
    if (this.state === 'pickup') {
      out.copy(this.pickupPos);
      return '乘客';
    }
    if (this.state === 'ride') {
      out.copy(this.destPos);
      return '目的地';
    }
    return null;
  }

  private cancel(): void {
    this.state = 'none';
    this.cooldown = NEXT_FARE_DELAY;
    this.passenger.root.visible = false;
    this.beacon.hide();
  }

  /** 随机选一个城市区人行道拐角(距离在 [min,max] 环内) */
  private pickCorner(from: THREE.Vector3, min: number, max: number, out: THREE.Vector3): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = min + Math.random() * (max - min);
    const bx = Math.max(
      Math.round((from.x + Math.cos(angle) * dist) / PITCH) * PITCH,
      CITY_MIN_BLOCK_X,
    );
    const bz = Math.round((from.z + Math.sin(angle) * dist) / PITCH) * PITCH;
    const sx = Math.random() < 0.5 ? 1 : -1;
    const sz = Math.random() < 0.5 ? 1 : -1;
    out.set(bx + sx * SIDEWALK_LINE, 0, bz + sz * SIDEWALK_LINE);
  }

  private toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.style.display = 'block';
    this.toastTimer = 3.2;
  }
}
