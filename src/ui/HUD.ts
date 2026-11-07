import type * as THREE from 'three';

export interface HUDData {
  /** 当前状态标签（角色状态机或 'drive'） */
  state: string;
  speed: number;
  /** 速度单位标签（'m/s' 或 'km/h'） */
  speedUnit: string;
  grounded: boolean;
  position: THREE.Vector3;
  pointerLocked: boolean;
  /** 交互提示（如"按 E 上车"），空串不显示 */
  hint: string;
  /** 当前武器名，空串=徒手 */
  weapon: string;
  /** 导航行（如"海滩 ↖ 320m"），空串不显示 */
  guide: string;
  /** 游戏内时钟 HH:MM */
  clock: string;
  /** 通缉星级 0~3，0 不显示 */
  stars: number;
  /** 正在脱离通缉（星星闪烁） */
  evading: boolean;
  /** 生命值 0~100 */
  hp: number;
  /** 现金 */
  money: number;
  /** 驾驶中载具车况 0~100，-1 = 未驾驶不显示 */
  vehicleCond: number;
  /** 性能诊断 */
  frameAvgMs: number;
  frameMaxMs: number;
  physMs: number;
  drawCalls: number;
  pixelRatio: number;
}

const TEXT_REFRESH_INTERVAL = 0.1; // 文本 10Hz 刷新，避免每帧重排
const FPS_SAMPLE_WINDOW = 0.5;

const CARD_BG =
  'background:rgba(10,14,22,.62);backdrop-filter:blur(8px);' +
  'border:1px solid rgba(255,255,255,.09);border-radius:10px;';
const FONT = "font-family:'Segoe UI',system-ui,sans-serif;";

/**
 * 游戏 HUD（GTA 式布局）：
 * - 左上：状态卡（时钟/FPS/状态/速度 + 折叠感的性能小字）
 * - 右上：现金（绿）与通缉星
 * - 中下：导航/交互提示 + 血条（+驾驶时车况条）
 */
export class HUD {
  private readonly panel: HTMLDivElement;
  private readonly topRight: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly hpFill: HTMLDivElement;
  private readonly hpText: HTMLDivElement;
  private readonly condRow: HTMLDivElement;
  private readonly condFill: HTMLDivElement;
  private readonly msgBox: HTMLDivElement;

  private frames = 0;
  private fpsAcc = 0;
  private fps = 0;
  private textAcc = 0;
  private totalTime = 0;

  constructor(parent: HTMLElement = document.body) {
    // —— 左上状态卡 ——
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      `position:fixed;left:12px;top:10px;z-index:10;color:#e8edf4;${FONT}` +
      `font-size:12.5px;line-height:1.75;${CARD_BG}padding:8px 12px;` +
      'pointer-events:none;user-select:none;min-width:210px;';
    parent.appendChild(this.panel);

    // —— 右上：现金 + 通缉星 ——
    this.topRight = document.createElement('div');
    this.topRight.style.cssText =
      `position:fixed;right:14px;top:10px;z-index:10;text-align:right;${FONT}` +
      'pointer-events:none;user-select:none;';
    parent.appendChild(this.topRight);

    // —— 中下容器：提示 + 血条 ——
    this.center = document.createElement('div');
    this.center.style.cssText =
      'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:10;' +
      `display:flex;flex-direction:column;align-items:center;gap:7px;${FONT}` +
      'pointer-events:none;user-select:none;';
    parent.appendChild(this.center);

    this.msgBox = document.createElement('div');
    this.msgBox.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:5px;';
    this.center.appendChild(this.msgBox);

    // 血条：♥ + 渐变填充圆角条 + 数字
    const hpRow = document.createElement('div');
    hpRow.style.cssText =
      `display:flex;align-items:center;gap:9px;${CARD_BG}padding:7px 14px;border-radius:999px;`;
    const heart = document.createElement('span');
    heart.textContent = '♥';
    heart.style.cssText = 'color:#ff5d6c;font-size:15px;line-height:1;';
    const hpTrack = document.createElement('div');
    hpTrack.style.cssText =
      'width:300px;height:9px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden;';
    this.hpFill = document.createElement('div');
    this.hpFill.style.cssText =
      'height:100%;width:100%;border-radius:999px;transition:width .25s ease,background .3s;' +
      'background:linear-gradient(90deg,#2fd672,#7ce98a);';
    hpTrack.appendChild(this.hpFill);
    this.hpText = document.createElement('div');
    this.hpText.style.cssText =
      'color:#fff;font-size:12.5px;font-weight:600;min-width:28px;text-align:right;' +
      'font-variant-numeric:tabular-nums;';
    hpRow.append(heart, hpTrack, this.hpText);
    this.center.appendChild(hpRow);

    // 车况细条（驾驶时显示）
    this.condRow = document.createElement('div');
    this.condRow.style.cssText =
      'display:none;align-items:center;gap:8px;margin-top:-1px;padding:0 14px;';
    const wrench = document.createElement('span');
    wrench.textContent = '🔧';
    wrench.style.cssText = 'font-size:10px;line-height:1;filter:grayscale(.3);';
    const condTrack = document.createElement('div');
    condTrack.style.cssText =
      'width:260px;height:5px;border-radius:999px;background:rgba(0,0,0,.45);overflow:hidden;';
    this.condFill = document.createElement('div');
    this.condFill.style.cssText =
      'height:100%;width:100%;border-radius:999px;background:#58b4ff;transition:width .25s ease;';
    condTrack.appendChild(this.condFill);
    this.condRow.append(wrench, condTrack);
    this.center.appendChild(this.condRow);
  }

  /** 每帧调用（渲染帧，非物理步） */
  update(dt: number, data: HUDData): void {
    this.frames += 1;
    this.totalTime += dt;
    this.fpsAcc += dt;
    if (this.fpsAcc >= FPS_SAMPLE_WINDOW) {
      this.fps = this.frames / this.fpsAcc;
      this.frames = 0;
      this.fpsAcc = 0;
    }

    this.textAcc += dt;
    if (this.textAcc < TEXT_REFRESH_INTERVAL) return;
    this.textAcc = 0;

    // —— 血条（中下）——
    const hp = Math.max(0, Math.min(100, data.hp));
    this.hpFill.style.width = `${hp}%`;
    this.hpFill.style.background =
      hp > 50
        ? 'linear-gradient(90deg,#2fd672,#7ce98a)'
        : hp > 25
          ? 'linear-gradient(90deg,#e8a53a,#f4c95d)'
          : 'linear-gradient(90deg,#e03b48,#ff7562)';
    this.hpText.textContent = `${Math.ceil(hp)}`;

    if (data.vehicleCond >= 0) {
      this.condRow.style.display = 'flex';
      const c = Math.max(0, data.vehicleCond);
      this.condFill.style.width = `${c}%`;
      this.condFill.style.background = c > 50 ? '#58b4ff' : c > 25 ? '#f4c95d' : '#ff7562';
    } else {
      this.condRow.style.display = 'none';
    }

    // —— 中下提示/导航 ——
    const msgs: string[] = [];
    if (data.guide) {
      msgs.push(
        `<div style="color:#ffd34d;font-size:13px;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8)">${data.guide}</div>`,
      );
    }
    if (data.hint) {
      msgs.push(
        `<div style="color:#fff;font-size:13px;${CARD_BG}padding:4px 14px;border-radius:999px">${data.hint}</div>`,
      );
    }
    if (!data.pointerLocked) {
      msgs.push(
        `<div style="color:#cfd8e3;font-size:12px;${CARD_BG}padding:4px 14px;border-radius:999px">点击画面锁定鼠标 · H 查看帮助</div>`,
      );
    }
    this.msgBox.innerHTML = msgs.join('');

    // —— 右上：通缉星 + 现金 ——
    const blinkOff = data.evading && Math.floor(this.totalTime * 2.5) % 2 === 1;
    const stars =
      data.stars > 0
        ? `<div style="font-size:19px;letter-spacing:3px;color:#ffcf3f;text-shadow:0 1px 4px rgba(0,0,0,.85);margin-bottom:2px">${(blinkOff ? '☆' : '★').repeat(data.stars)}${'<span style="opacity:.28">★</span>'.repeat(3 - data.stars)}</div>`
        : '';
    this.topRight.innerHTML =
      stars +
      `<div style="color:#63d97c;font-size:17px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.85);font-variant-numeric:tabular-nums">$ ${data.money.toLocaleString()}</div>`;

    // —— 左上状态卡 ——
    const p = data.position;
    const fpsColor = this.fps >= 50 ? '#63d97c' : this.fps >= 30 ? '#f4c95d' : '#ff7562';
    const dim = 'color:#8f9aab;font-size:11px;line-height:1.6;';
    const stateLabel =
      data.state === 'drive'
        ? '🚗 驾驶'
        : data.state === 'dive'
          ? '潜水'
        : data.state === 'swim'
          ? '🌊 游泳'
          : data.state === 'jump'
            ? '🦘 跳跃'
            : data.state === 'run'
              ? '🏃 奔跑'
              : data.state === 'walk'
                ? '🚶 行走'
                : '🧍 站立';
    this.panel.innerHTML =
      `<div style="display:flex;justify-content:space-between;gap:14px">` +
      `<span>🕐 ${data.clock}</span>` +
      `<span style="color:${fpsColor};font-weight:600">${this.fps.toFixed(0)} FPS</span></div>` +
      `<div>${stateLabel}<span style="color:#cfd8e3"> · ${data.speed.toFixed(1)} ${data.speedUnit}</span>` +
      (data.weapon ? `<span style="color:#f4c95d"> · ${data.weapon}</span>` : '') +
      `</div>` +
      `<div style="${dim}">frame ${data.frameAvgMs.toFixed(1)}ms (峰值 ${data.frameMaxMs.toFixed(0)}) · 物理 ${data.physMs.toFixed(1)}ms</div>` +
      `<div style="${dim}">draw ${data.drawCalls} · dpr ${data.pixelRatio.toFixed(2)} · ` +
      `坐标 ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}</div>` +
      `<div style="${dim}">G 拾取 · I 背包 · B 绷带 · H 帮助</div>`;
  }
}
