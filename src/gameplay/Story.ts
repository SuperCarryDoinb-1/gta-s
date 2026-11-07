import * as THREE from 'three';
import type { PersonInstance, PersonLibrary } from '../core/Loader';
import type { TrafficSystem } from '../entities/Traffic';
import type { Vehicle } from '../entities/Vehicle';
import type { WantedSystem } from './Wanted';
import { Beacon } from '../ui/Beacon';

/**
 * 主线剧情（C 档轻叙事）："初到这座城,爱车被码头帮偷了"。
 * 抢车教学 → 甩通缉教学 → 修车行老周给线索 → 逼停帮派跑腿 →
 * 码头场子夺回轿车（被栽赃 2 星）→ 海滩销赃点骑回摩托 → 自由模式。
 * 两辆自有载具开场 stash（物理禁用+隐藏），由剧情在对应节点放出——
 * 也规避了远处载具落在未加载 chunk 上坠落的问题。
 * 表现：底部对话/任务字幕框 + 目标点金色光柱 + HUD 方向导航 + 小地图金点。
 */

type StoryState = 'idle' | 'steal' | 'evade' | 'meet' | 'chase' | 'reclaim' | 'moto' | 'done';

// 老周修车行：街区人行道拐角
const ZHOU_X = 85.5;
const ZHOU_Z = -53.5;
// 码头帮场子（西区近海路口旁）
const LOT_X = -172;
const LOT_Z = 108;
// 海滩销赃点
const MOTO_X = -262;
const MOTO_Z = 16;
const MOTO_UNSTASH_DIST = 110; // 玩家足够近（chunk 已加载）才放出摩托
const ARRIVE_DIST = 6;

interface Line {
  text: string;
  dur: number;
}

export class StorySystem {
  private state: StoryState = 'idle';
  private time = 0;

  private readonly sedan: Vehicle;
  private readonly moto: Vehicle;
  private readonly traffic: TrafficSystem;
  private readonly wanted: WantedSystem;

  private carjacked = false;
  private courierIdx = -1;
  private sedanPlaced = false;
  private motoPlaced = false;

  private readonly queue: Line[] = [];
  private lineTimer = 0;
  private readonly box: HTMLDivElement;
  private lastShown = '';

  private readonly beacon: Beacon;
  private targetLabel: string | null = null;
  private readonly targetPos = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  private readonly zhou: PersonInstance;

  constructor(
    scene: THREE.Scene,
    personLib: PersonLibrary,
    sedan: Vehicle,
    moto: Vehicle,
    traffic: TrafficSystem,
    wanted: WantedSystem,
  ) {
    this.sedan = sedan;
    this.moto = moto;
    this.traffic = traffic;
    this.wanted = wanted;

    // 字幕/任务框
    this.box = document.createElement('div');
    this.box.style.cssText =
      'position:fixed;left:50%;bottom:11%;transform:translateX(-50%);z-index:11;' +
      'max-width:620px;min-width:260px;background:rgba(8,10,14,.72);' +
      'border-left:3px solid #ffd34d;border-radius:6px;padding:10px 16px;' +
      'color:#f2f2f2;font:14px/1.65 system-ui,sans-serif;pointer-events:none;' +
      'user-select:none;display:none;';
    document.body.appendChild(this.box);

    // 目标光柱
    this.beacon = new Beacon(scene, 0xffd34d, {
      radius: 1.4,
      height: 22,
      opacity: 0.3,
      pulse: { base: 0.22, amp: 0.1 },
    });

    // 老周：修车行门口站桩 NPC
    this.zhou = personLib.spawn('man');
    this.zhou.root.position.set(ZHOU_X, 0.04, ZHOU_Z);
    this.zhou.root.rotation.y = -Math.PI / 4;
    scene.add(this.zhou.root);
    const idle = this.zhou.actions.get('Idle');
    if (idle) idle.play();
  }

  /** 点击开始后调用：开场白 + 进入教学任务 */
  start(): void {
    if (this.state !== 'idle') return;
    this.say(
      '凌晨四点,你被楼下的动静吵醒。',
      '停好的爱车和摩托,一夜之间被"码头帮"搬空了。',
      '这座城市不讲道理——想拿回东西,只能自己动手。',
    );
    this.state = 'steal';
  }

  /** 抢车事件（PlayerManager 上报,教学任务与逼停跑腿的判定用） */
  notifyCarjack(): void {
    this.carjacked = true;
  }

  /**
   * 每帧调用。
   * drivingSedan/drivingMoto = 正在驾驶对应自有载具。
   */
  update(
    dt: number,
    playerPos: THREE.Vector3,
    driving: boolean,
    drivingSedan: boolean,
    drivingMoto: boolean,
    stars: number,
  ): void {
    this.time += dt;
    this.zhou.mixer.update(dt);
    this.advanceDialogue(dt);

    switch (this.state) {
      case 'idle':
      case 'done':
        this.setTarget(null, 0, 0);
        break;

      case 'steal': {
        // 光柱指向最近的一辆 AI 车
        let bx = playerPos.x;
        let bz = playerPos.z;
        let bd = Infinity;
        this.traffic.forEachCar((x, z) => {
          const d = (x - playerPos.x) ** 2 + (z - playerPos.z) ** 2;
          if (d < bd) {
            bd = d;
            bx = x;
            bz = z;
          }
        });
        this.setTarget('路车', bx, bz);
        this.objective('搞辆代步车:靠近路上的车按 E 抢走(小心引来警察)');
        if (this.carjacked || driving) {
          this.carjacked = false;
          if (stars > 0) {
            this.say('✓ 到手了。警笛声近了——先甩掉他们再说。');
            this.state = 'evade';
          } else {
            this.say('✓ 到手了。听说修车行的老周消息灵通。');
            this.state = 'meet';
          }
        }
        break;
      }

      case 'evade':
        this.setTarget(null, 0, 0);
        this.objective('甩掉通缉:拐进小巷、绕到楼后,脱离警察视线');
        if (stars === 0) {
          this.say('✓ 风头过了。修车行的老周消息灵通,去问问你的车。');
          this.state = 'meet';
        }
        break;

      case 'meet':
        this.setTarget('老周', ZHOU_X, ZHOU_Z);
        this.objective('去修车行找老周打听消息');
        if (playerPos.distanceTo(this.scratch.set(ZHOU_X, playerPos.y, ZHOU_Z)) < ARRIVE_DIST) {
          this.say(
            '老周:哟,新面孔。车被码头帮收走了?',
            '老周:他们的跑腿每天开辆面包车在城里送货。',
            '老周:把车逼停,他什么都会说。',
          );
          this.courierIdx = this.traffic.markCourier(playerPos);
          this.state = 'chase';
        }
        break;

      case 'chase': {
        const speed = this.traffic.courierState(this.courierIdx, this.scratch);
        this.setTarget('跑腿', this.scratch.x, this.scratch.z);
        this.objective('逼停帮派跑腿的面包车(堵住去路或撞停它)');
        const near =
          Math.hypot(this.scratch.x - playerPos.x, this.scratch.z - playerPos.z) < 7;
        const jackedCourier = this.carjacked && this.sedan.carType === 'delivery';
        this.carjacked = false;
        if ((near && speed < 0.8) || jackedCourier) {
          this.say(
            '跑腿:别动手!车…车在西边码头的场子里!',
            '跑腿:摩托拉去海滩销赃了,现在去还来得及!',
          );
          this.state = 'reclaim';
        }
        break;
      }

      case 'reclaim': {
        this.setTarget('场子', LOT_X, LOT_Z);
        const dist = Math.hypot(LOT_X - playerPos.x, LOT_Z - playerPos.z);
        if (!this.sedanPlaced) {
          this.objective(
            dist < 25 && driving ? '在场子附近下车查看' : '去西边码头帮的场子夺回爱车',
          );
          if (dist < 20 && !driving) {
            // 把"偷来的车"就地换装回你的爱车(同一物理载具,叙事上丢弃旧车)
            this.sedan.setStashed(false);
            this.sedan.teleportTo(LOT_X, LOT_Z, Math.PI / 2);
            this.sedan.setCarType('sedan-sports');
            this.sedanPlaced = true;
            this.say('你把偷来的车丢在一边——爱车就停在场子中央,一点没刮花。');
          }
        } else {
          this.objective('按 E 开走你的爱车');
          if (drivingSedan && this.sedan.carType === 'sedan-sports') {
            this.wanted.frameUp();
            this.say('✓ 帮派眼线立刻报了警,栽赃你"偷车"——甩掉警察,去海滩!');
            this.state = 'moto';
          }
        }
        break;
      }

      case 'moto': {
        this.setTarget('摩托', MOTO_X, MOTO_Z);
        this.objective('去海滩销赃点骑回你的摩托');
        const dist = Math.hypot(MOTO_X - playerPos.x, MOTO_Z - playerPos.z);
        if (!this.motoPlaced && dist < MOTO_UNSTASH_DIST) {
          this.moto.setStashed(false);
          this.moto.teleportTo(MOTO_X, MOTO_Z, Math.PI / 2);
          this.motoPlaced = true;
        }
        if (drivingMoto) {
          this.say(
            '✓ 都拿回来了。',
            '海风里,这座城市终于还清了欠你的东西。——自由行动,想去哪就去哪。',
          );
          this.state = 'done';
        }
        break;
      }
    }

    // 光柱脉动
    this.beacon.update(this.time);
  }

  /** 当前目标点写入 out,返回导航标签;无目标返回 null(HUD/小地图用) */
  targetInfo(out: THREE.Vector3): string | null {
    if (!this.targetLabel) return null;
    out.copy(this.targetPos);
    return this.targetLabel;
  }

  // ---------- 内部 ----------

  private setTarget(label: string | null, x: number, z: number): void {
    this.targetLabel = label;
    if (label) {
      this.targetPos.set(x, 0, z);
      this.beacon.setPosition(x, z);
    } else {
      this.beacon.hide();
    }
  }

  private say(...texts: string[]): void {
    for (const text of texts) {
      this.queue.push({ text, dur: Math.min(5, 2.2 + text.length * 0.07) });
    }
  }

  /** 无对话时显示的常驻任务目标 */
  private objective(text: string): void {
    if (this.queue.length > 0) return; // 对话优先
    this.show(`<span style="color:#ffd34d">任务</span>　${text}`);
  }

  private advanceDialogue(dt: number): void {
    const line = this.queue[0];
    if (!line) {
      if (this.state === 'done' && this.lastShown !== '') this.show('');
      return;
    }
    this.show(line.text);
    this.lineTimer += dt;
    if (this.lineTimer >= line.dur) {
      this.lineTimer = 0;
      this.queue.shift();
    }
  }

  private show(html: string): void {
    if (html === this.lastShown) return;
    this.lastShown = html;
    this.box.style.display = html ? 'block' : 'none';
    this.box.innerHTML = html;
  }
}
