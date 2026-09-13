/**
 * 游戏内帮助面板：H 键随时开关，覆盖显示完整操作与系统说明。
 * pointer-events:none —— 打开时游戏照常进行，不夺焦点。
 */
export class HelpOverlay {
  private readonly el: HTMLDivElement;
  private visible = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:15;' +
      'width:min(780px,92vw);max-height:86vh;overflow:hidden;display:none;' +
      'background:rgba(8,11,16,.92);border:1px solid rgba(255,255,255,.14);' +
      'border-radius:12px;padding:20px 28px;color:#e8eef4;' +
      'font:13px/1.9 system-ui,sans-serif;pointer-events:none;user-select:none;';
    this.el.innerHTML = `
      <div style="font-size:18px;font-weight:700;letter-spacing:.2em;margin-bottom:8px">
        游戏指南 <span style="font-size:12px;opacity:.5;letter-spacing:0">（H 关闭）</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 32px">
        <div>
          <div style="color:#7fc4ff;font-weight:600">基础操作</div>
          WASD 移动 · Shift 疾跑 · Space 跳跃<br>
          鼠标 视角 · Esc 退出沉浸模式(点击画面恢复) · 深水自动游泳<br>
          <div style="color:#7fc4ff;font-weight:600;margin-top:6px">驾驶</div>
          E 上/下车（靠近任意车可抢）<br>
          W/S 油门/倒车 · A/D 转向<br>
          Space 手刹——高速拉手刹甩尾漂移 · F 喇叭<br>
          撞击掉车况：冒烟→起火→殉爆,及时弃车<br>
          <div style="color:#7fc4ff;font-weight:600;margin-top:6px">武器</div>
          1 手枪 · 2 机枪 · 3 手雷（再按收起）<br>
          左键 开火/投掷 · 弹药打空去武器店买<br>
        </div>
        <div>
          <div style="color:#ff8a8a;font-weight:600">通缉系统</div>
          开枪/撞人/抢车/爆炸 → 星级 1~3★<br>
          2★ 起警察下车开枪,躲到楼后可断视线<br>
          脱离视线一段时间星级消退（星星闪烁中）<br>
          喷漆店 $200 立刻洗白 · 下海警察不追<br>
          <div style="color:#51ff7e;font-weight:600;margin-top:6px">赚钱与消费</div>
          开出租车(taxi)自动接单,送客赚车费<br>
          武器店(蓝柱) J/K/L 买弹药<br>
          喷漆店(橙柱) J 洗通缉 · K 修车 $150<br>
          HP 归零医院复活扣 $100<br>
          <div style="color:#ffd34d;font-weight:600;margin-top:6px">其他</div>
          金色光柱 = 主线目标 · 跟着 HUD 箭头走<br>
          海滩外有快艇,游过去按 E 开船出海<br>
          R 空投坦克——从天而降,走近按 E 开走<br>
          路边车和警车也可按 E 驾驶；有人警车先拉出警员再上车<br>
          N 快进时间 · T 切换天气<br>
        </div>
      </div>`;
    document.body.appendChild(this.el);

    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('menu-open')) return;
      if (e.code === 'KeyH') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }
}
