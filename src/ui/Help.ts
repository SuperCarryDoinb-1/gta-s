/**
 * 游戏内帮助面板：H 键随时开关，覆盖显示完整操作与系统说明。
 * pointer-events:none —— 打开时游戏照常进行，不夺焦点。
 */
export class HelpOverlay {
  private readonly el: HTMLDivElement;
  private visible = false;

  constructor(battle = false) {
    this.el = document.createElement('div');
    this.el.id = 'help-overlay';
    this.el.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:15;' +
      'width:min(780px,92vw);max-height:86vh;overflow:hidden;display:none;' +
      'background:rgba(8,11,16,.92);border:1px solid rgba(255,255,255,.14);' +
      'border-radius:12px;padding:20px 28px;color:#e8eef4;' +
      'font:13px/1.9 system-ui,sans-serif;pointer-events:none;user-select:none;';
    this.el.innerHTML = `
      <div style="color:#52dfbd;margin-bottom:8px">
        自由生存：首次空手出发，沿导航搜索物资；有存档时从避难所继续。<br>
        G 拾取 · I 背包 · B 使用绷带 · 1/2/3 切换已获得武器。<br>
        随身 4 格，背包 12 格；避难所 (40,88) 屋内 F 打开仓库。<br>
        废弃货栈 (177,-57) 有 3 名守卫；死亡掉落随身物资，可返回找回。<br>
        仓库物资保留，当前浏览器自动存档；读档返回避难所。<br>
        上海滨江：沿江过桥前往东方明珠；衣橱和劳保店有服装，巡防亭有护甲。
      </div>
      <div style="color:#7fc4ff">导入车队在出生点前方道路两侧，直升机在身后路口；靠近按 E 上下车。<br>
      直升机：W/S 俯仰前后飞 · A/D 倾斜转弯 · Space 爬升 · Shift 下降<br>升降逐渐加速，松键后逐渐回正并减速；观察右侧高度、升降速与姿态仪表。</div>
      <div style="font-size:18px;font-weight:700;letter-spacing:.2em;margin-bottom:8px">
        游戏指南 <span style="font-size:12px;opacity:.5;letter-spacing:0">（H 关闭）</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 32px">
        <div>
          <div style="color:#7fc4ff;font-weight:600">基础操作</div>
          WASD 移动 · Shift 疾跑 · Space 跳跃<br>
          鼠标 视角 · Esc 暂停游戏 / 打开菜单 · 深水自动游泳<br>
          <div style="color:#7fc4ff;font-weight:600;margin-top:6px">驾驶</div>
          E 上/下车（靠近任意车可抢）<br>
          W/S 油门/倒车 · A/D 转向<br>
          Space 手刹——高速拉手刹甩尾漂移 · F 喇叭<br>
          撞击掉车况：冒烟→起火→殉爆,及时弃车<br>
          <div style="color:#7fc4ff;font-weight:600;margin-top:6px">武器</div>
          1 手枪 · 2 机枪 · 3 手雷（先拾取，再切换）<br>
          左键 开火/投掷 · 弹药可搜索或到武器店补给<br>
        </div>
        <div>
          <div style="color:#ff8a8a;font-weight:600">通缉系统</div>
          开枪/撞人/抢车/爆炸 → 星级 1~3★<br>
          2★ 起警察下车开枪,躲到楼后可断视线<br>
          脱离视线一段时间星级消退（星星闪烁中）<br>
          喷漆店 $200 立刻洗白 · 下海警察不追<br>
          <div style="color:#51ff7e;font-weight:600;margin-top:6px">赚钱与消费</div>
          开出租车(taxi)自动接单,送客赚车费<br>
          滨江便利店内 J/K/L 买弹药<br>
          修车点（小地图橙色圆标）J 洗通缉 · K 修车 $150<br>
          HP 归零医院复活扣 $100<br>
          <div style="color:#ffd34d;font-weight:600;margin-top:6px">其他</div>
          地面彩色物资 = 搜集点 · 跟着 HUD 箭头搜索<br>
          水中 Ctrl 下潜 · Space 上浮 · Shift 加速；两岸 z≈48 有亲水台阶<br>
          路边车和警车也可按 E 驾驶；有人警车先拉出警员再上车<br>
          N 快进时间 · T 切换天气<br>
        </div>
      </div>`;
    if (battle) this.el.innerHTML = `<div style="color:#dfc38b;font-size:18px;margin-bottom:10px">上海滨江 · 单人吃鸡 <small style="font-size:12px">H 关闭</small></div>
      <p>1 名玩家 + 7 名 AI，每局空手开始。搜集地面装备，活到最后。</p>
      <p>WASD 移动 · Shift 疾跑 · 空格翻滚跳跃 · 鼠标视角<br>G 拾取 · I 图形背包 · B 绷带 · 1 / 2 / 3 切换已获得武器 · 左键射击</p>
      <p>蓝圈为当前安全区，白色虚线为下一圈。45 秒后开始缩圈，圈外持续掉血；护甲、载具和避难所不能免除圈外伤害。暂停或打开背包时对局暂停。</p>
      <p>AI 会拾取武器和弹药、互相交战并转移安全区。墙体与载具能挡子弹。没有自动回血，绷带可恢复生命。</p>
      <p>本局在滨江西岸小型赛区进行，胜负、排名与装备独立。淘汰后本局结束，不会复活；可再来一局，或返回自由模式继续原存档。</p>
      <p>E 上下车 · 直升机 W/S 前后倾飞，A/D 转弯，空格爬升，Shift 下降 · 水中 Ctrl 下潜，空格上浮。Esc 暂停。</p>`;
    document.body.appendChild(this.el);

    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('menu-open')) return;
      if (document.body.classList.contains('game-paused')) return;
      if (e.code === 'KeyH') this.toggle();
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
  }
}
