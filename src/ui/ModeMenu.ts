export function setupModeMenu(battle:boolean):void {
  const start=document.getElementById('start-btn');if(!start)return;
  const selector=document.createElement('div');selector.className='mode-selector';selector.setAttribute('aria-label','选择游戏模式');
  selector.innerHTML=`<a id="free-mode" href="./" ${battle?'':'aria-current="page"'}><b>自由生存</b><small>持续存档 · 不缩圈</small></a><a id="battle-mode" href="?mode=battle" ${battle?'aria-current="page"':''}><b>单人吃鸡</b><small>1 名玩家 + 7 名 AI</small></a>`;
  start.before(selector);
  const label=document.querySelector('.story-label');if(label)label.textContent=battle?'单机竞技 / 上海滨江生存赛':'自由生存 / 上海开放世界';
  const title=document.querySelector('.hero-copy h2');if(title)title.innerHTML=battle?'空手搜装。<br>成为<em>最后生还者。</em>':'从空手出发。<br>把收获<em>带回家。</em>';
  const synopsis=document.querySelector('.synopsis');if(synopsis)synopsis.innerHTML=battle?'搜集装备，转移安全区。<br>淘汰对手，活到最后。':'探索里弄与港区，搜集装备。<br>返回避难所，保管你的收获。';
  const nav=document.querySelector('.nav-current');if(nav)nav.textContent=battle?'上海 · 单机竞技':'上海 · 自由生存';
  const footer=document.querySelector('.footer-center');if(footer)footer.textContent=battle?'独立对局 · 自由进度保留':'单人开放世界 · 本地持续存档';
  const chapters=document.querySelectorAll('.chapter h3');const names=battle?['搜装发育','安全区转移','最后生还']:['探索上海','搜集装备','挑战据点'];chapters.forEach((el,i)=>{el.textContent=names[i]??'';});
  const intro=document.querySelector('.guide-intro');if(intro)intro.textContent='自由模式探索、保管与存档；单人吃鸡每局空手开始，蓝圈外持续掉血。G 拾取，I 背包，B 绷带。';
  const grid=document.querySelector('#guide-dialog .guide-grid');
  if(grid)grid.innerHTML=battle?
    '<section><h3>01 · 空手搜装</h3><p>WASD 移动 · 空格翻滚跳跃</p><p>G 拾取 · I 背包 · B 绷带</p><p>1/2/3 切换已获得武器 · 左键开火</p></section><section><h3>02 · 安全区转移</h3><p>45 秒后开始缩圈，蓝圈外持续掉血。</p><p>护甲与避难所无法免除圈外伤害。</p><p>虚线标记下一圈，及时向中心转移。</p></section><section><h3>03 · AI 生存赛</h3><p>1 名玩家对 7 名 AI，AI 也会搜装和互相交战。</p><p>利用实体建筑与掩体，成为最后生还者。</p></section><section><h3>04 · 独立对局</h3><p>淘汰后不复活，可重开或返回自由模式。</p><p>每局装备重置，自由模式进度保留。</p><p>H 当前模式指南 · Esc 暂停</p></section>':
    '<section><h3>01 · 搜装与换装</h3><p>G 拾取 · I 背包 · B 绷带</p><p>服装与护甲可在背包中点击穿戴。</p><p>1/2/3 切换已获得武器 · 左键射击</p></section><section><h3>02 · 驾驶与飞行</h3><p>E 上下车，W/S 油门，A/D 转向。</p><p>直升机：空格爬升，Shift 下降。</p><p>水中 Ctrl 下潜，空格上浮。</p></section><section><h3>03 · 上海探索</h3><p>里弄老街 (-96,32)，浦东港区 (192,192)。</p><p>危险货栈 (177,-57) 有巡逻守卫。</p><p>自由模式有随机补给，不缩圈。</p></section><section><h3>04 · 避难所与存档</h3><p>避难所 (40,88)，屋内 F 仓库和休整。</p><p>死亡遗落随身物资，仓库保留。</p><p>当前浏览器自动存档；H 指南，Esc 暂停。</p></section>';
}
