const MAX_HP = 100;
const REGEN_DELAY = 6; // 停止受伤后多少秒开始回血
const REGEN_RATE = 5; // 回血速度（/s）
const HOSPITAL_FEE = 100;
const DEATH_TIME = 2.4; // 黑幕停留时长
const INVULN_TIME = 3; // 复活无敌

/**
 * 玩家生命值与失败状态：
 * - 受伤红屏（伤害越重越明显），停火 6s 后缓慢回血。
 * - HP 归零 → 黑幕「你倒下了」→ 医院复活（扣费、清通缉、回出生点），短暂无敌。
 * - 伤害源由外部上报（警察子弹/警车冲撞/爆炸/驾车撞击/坠落）。
 */
export class HealthSystem {
  hp = MAX_HP;
  money = 800;

  /** 复活瞬间回调（main 负责：强制下车、瞬移医院、清通缉） */
  onRespawn: (() => void) | null = null;

  private sinceDamage = 999;
  private invuln = 0;
  private deathTimer = 0;
  private isDead = false;
  private flash = 0;

  private readonly flashEl: HTMLDivElement;
  private readonly deathEl: HTMLDivElement;

  constructor() {
    // 受伤红屏
    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText =
      'position:fixed;inset:0;z-index:9;pointer-events:none;opacity:0;' +
      'background:radial-gradient(ellipse at center, transparent 52%, rgba(255,28,28,.6) 100%);';
    document.body.appendChild(this.flashEl);

    // 死亡黑幕
    this.deathEl = document.createElement('div');
    this.deathEl.style.cssText =
      'position:fixed;inset:0;z-index:12;pointer-events:none;opacity:0;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'background:rgba(26,2,2,.92);color:#e8e0d8;transition:opacity .5s;' +
      'font:15px/2 system-ui,sans-serif;';
    this.deathEl.innerHTML =
      '<div style="font-size:30px;letter-spacing:8px;color:#ff5b5b">你倒下了</div>' +
      `<div style="opacity:.75">医院把你拉了回来 · 费用 $${HOSPITAL_FEE}</div>`;
    document.body.appendChild(this.deathEl);
  }

  addMoney(n: number): void {
    this.money += Math.round(n);
  }

  /** 花钱：余额不足返回 false 且不扣 */
  spend(n: number): boolean {
    if (this.money < n) return false;
    this.money -= n;
    return true;
  }

  /** 受伤（死亡/无敌期间免疫） */
  damage(amount: number): void {
    if (this.isDead || this.invuln > 0 || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.sinceDamage = 0;
    this.flash = Math.min(1, 0.45 + amount / 40);
    if (this.hp <= 0) {
      this.isDead = true;
      this.deathTimer = DEATH_TIME;
      this.money = Math.max(0, this.money - HOSPITAL_FEE);
      this.deathEl.style.opacity = '1';
    }
  }

  /** 每帧调用 */
  update(dt: number): void {
    this.invuln -= dt;
    this.sinceDamage += dt;

    if (!this.isDead && this.hp < MAX_HP && this.sinceDamage > REGEN_DELAY) {
      this.hp = Math.min(MAX_HP, this.hp + REGEN_RATE * dt);
    }

    this.flash = Math.max(0, this.flash - dt * 1.8);
    this.flashEl.style.opacity = String(Math.min(1, this.flash) * 0.85);

    if (this.isDead) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.isDead = false;
        this.hp = MAX_HP;
        this.invuln = INVULN_TIME;
        this.flash = 0;
        this.deathEl.style.opacity = '0';
        this.onRespawn?.();
      }
    }
  }
}
