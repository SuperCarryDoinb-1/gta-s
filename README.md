# 开放世界原型(GTA-like)

Three.js + Rapier 物理的浏览器开放世界游戏原型:程序化城市、昼夜天气、驾驶/骑行/游泳/开船、
行人与交通 AI、武器、通缉系统、生命值、经济闭环、主线剧情。

- **玩家说明书**:见 [MANUAL.md](MANUAL.md)(游戏内按 H 有速查版)
- **素材来源与许可**:见 [ASSETS.md](ASSETS.md)
- **产品架构文档**:见 [game-architecture.html](game-architecture.html)(流程图/架构图/游戏逻辑图)
- **1:1 复刻提示词包**:见 [rebuild-prompts/](rebuild-prompts/README.md)(分阶段 vibe coding 提示词,可让他人从零复刻本游戏)

## 运行

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build
```

## 目录结构

```
src/
├── main.ts                 # 组装层:构建所有系统、跨系统回调接线、主循环调度
├── core/                   # 引擎无关的基础设施
│   ├── Engine.ts           #   渲染器/相机/后期(bloom)/固定步长循环(fixedUpdate+update)
│   ├── Physics.ts          #   Rapier world 封装 + setVel/爆炸冲量零分配工具
│   ├── MathUtil.ts         #   wrapAngle 等共用数学
│   ├── CharacterAnim.ts    #   骨骼角色共用:剪辑切换(playClip)/插值位姿→根节点
│   ├── Input.ts            #   键鼠状态(isDown/wasPressed/指针锁定)
│   ├── Audio.ts            #   WebAudio 全程序化音频:BGM/引擎/风雨/枪炮/警笛/胎鸣/提示音
│   └── Loader.ts           #   GLB/OBJ 模型库(车辆/人物/建筑道具),模板化 clone
├── world/                  # 世界生成与环境
│   ├── City.ts             #   程序化城市数据:街区/楼宇/红绿灯/商店门/楼梯/分区(城市|沙滩|海)
│   ├── ChunkManager.ts     #   分块流式加载(5×5 chunk),几何合并,昼夜/雨湿联动
│   ├── Scene.ts            #   光照/天空/太阳(昼夜循环)
│   ├── Weather.ts          #   雨天系统(粒子+湿度)
│   └── Doors.ts            #   商店门开合动画
├── entities/               # 有位姿的游戏实体(物理+视觉,渲染插值)
│   ├── Character.ts        #   玩家角色:KCC 胶囊+骨骼动画+手臂 IK(骑车握把)
│   ├── Vehicle.ts          #   载具通用类:四轮悬挂物理/水面浮航/损伤三段/漂移;CAR|MOTO|BOAT|TANK_SPEC
│   ├── BoatMesh.ts         #   程序化快艇造型
│   ├── Pedestrians.ts      #   行人 AI 池:人行道巡走/避车逃跑/被撞翻滚/掉钱
│   ├── Traffic.ts          #   交通 AI 池:路网巡航/刹停/换车交换/剧情跑腿标记
│   └── CameraRig.ts        #   第三人称相机(碰撞规避+驾驶追尾模式)
├── gameplay/               # 玩法规则层(操作实体,互相之间用回调解耦)
│   ├── CharacterController.ts # 步行状态机:走跑跳游/楼梯/击退/硬着陆
│   ├── PlayerManager.ts    #   步行⇄驾驶切换/抢车/摩托甩人
│   ├── Weapons.ts          #   武器三件套+弹药/爆炸(explodeAt 供殉爆复用)
│   ├── Wanted.ts           #   通缉系统:热度→星级/警车追击/警察围捕/视线检测/消退
│   ├── Health.ts           #   生命值/受伤红屏/死亡黑幕/医院复活/金钱账户
│   ├── Story.ts            #   主线剧情状态机+字幕框+目标光柱
│   ├── TaxiJobs.ts         #   出租车载客(经济收入)
│   ├── Shops.ts            #   武器店/喷漆店(经济支出)
│   ├── Pickups.ts          #   掉落现金拾取池
│   └── fx.ts               #   曳光弹共享特效(Weapons/Wanted 共用)
└── ui/
    ├── HUD.ts              #   左上调试/状态面板(星级/HP/车况/导航/提示)
    ├── Minimap.ts          #   右下小地图(canvas)
    ├── Help.ts             #   H 键游戏指南浮层
    ├── HealthBar3D.ts      #   行人/警察头顶血条(世界空间)
    └── Beacon.ts           #   目标/店铺光柱(Story/TaxiJobs/Shops 共用)
```

## 架构要点

**主循环**(Engine 驱动,见 `main.ts` 的 `setHooks`):

- `fixedUpdate(60Hz)`:各实体 `beginStep`(记录插值端点、AI 决策、写入物理输入)
  → `physics.step()` → 各实体 `endStep`(采样物理结果)
- `update(每帧)`:玩法系统轮询、`syncVisual(alpha)` 按插值系数混合两个物理步的位姿
  (任何 60Hz 直读都会在高刷屏上抖)、UI/音频刷新

**解耦约定**:gameplay 系统之间不互相 import 实例,跨系统事件用公开回调字段
(如 `weapons.onCrime`、`pedestrians.onHitByPlayerCar`、`vehicle.onExploded`),
统一在 `main.ts` 接线——看 main 即可读出全部系统交互。

**对象池**:行人/交通车/警力/曳光/烟火/现金全部固定池复用,运行期零常态分配
(`setLinvel` 参数对象也复用,避免 GC 峰值掉帧)。

**载具即插槽**:玩家"抢车"不生成新载具,而是主车瞬移换装(`teleportTo`+`setCarType`),
AI 车原地变成停放的旧车——所有权模型 O(1)。

**世界流式加载**:LOAD_RADIUS=2(240m 见方),远处实体会踩空——
剧情奖励载具用 `setStashed`(物理禁用+隐藏)暂存,船靠水面浮力自持不受影响。

## 数值调参速查

| 系统 | 位置 |
|---|---|
| 车辆悬挂/动力/漂移摩擦 | `entities/Vehicle.ts` 顶部常量区 |
| 通缉热度/警力/视距/衰减 | `gameplay/Wanted.ts` 顶部常量区 |
| 伤害数值/回血/医院费 | `gameplay/Health.ts` 顶部 + `main.ts` 接线处 |
| 商店价格 | `gameplay/Shops.ts` 顶部 |
| 出租车计价 | `gameplay/TaxiJobs.ts` 顶部 |
| 行人/交通密度 | `entities/Pedestrians.ts`、`entities/Traffic.ts` 顶部 |
| 剧情坐标/台词 | `gameplay/Story.ts` |
