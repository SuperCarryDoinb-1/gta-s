# ASSETS.md — 待替换资源清单

## 游戏内 Ferrari 458 Italia（2026-09）

- 全部七款非警用汽车替换为用户指定的 [Three.js Ferrari 示例](https://threejs.org/examples/webgl_materials_car.html)车辆，作者 vicent091036；警车保留原模型。摩托、船和坦克使用独立的专用模型。
- 车漆保留被替换车型的主色：sedan 红橙 `#e86147`、sedan-sports 现有红色 `#ff1824`、suv 绿色 `#43ac7c`、suv-luxury 黄色 `#ffcf60`、taxi 黄色 `#ffb147`、hatchback-sports 与 delivery 绿色 `#5ac487`。Kenney 主色根据原车身网格的 UV 贴图表面取样；新车漆采用统一实体主色，不复制旧车的烘焙明暗和图案。
- 模型只解码一次，各颜色共享几何；路边汽车按几何与材质分组进行实例化渲染。车型 ID 保留，出租任务、抢车与警车逻辑不变。
- 模型本地文件：`public/models/cars/ferrari.glb`；Draco 解码器本地提供，运行不依赖外部 CDN。
- 接入红色车漆、独立原模型车轮、转向和悬挂、原车灯罩；保留车型切换和车辆损伤逻辑。
- 该 GLB 未声明许可，原 Sketchfab 页面目前无法访问；公开发布前仍需核实模型再分发许可。来源与状态见 `public/licenses/ferrari-source.md`，不能将模型视为 Three.js 的 MIT 代码或 CC0 资产。

## 首页封面（2026-09）

- 首页无人机：Chistodrako._. / oscar.lopez.riviello 的 [Flying Drone](https://sketchfab.com/3d-models/flying-drone-2ecfb55304a043a2a86353f70cc1cf92)，原页标注 Creative Commons Attribution。用户提供 `flying-drone.zip`，本地运行资产 `public/models/drone/flying-drone.glb`，改动记录见同目录 README。保留原始悬停动画，添加自由巡航、靠近跟随提示与右键脱离确认；进入开场时释放。

- 首页背景音乐：Alexander Ehlers / tricksntraps 的 System Overload（154 BPM），来源 [T & T Free Cyberpunk Pack 2](https://opengameart.org/content/t-t-free-cyberpunk-pack-2)，作者标注 CC0。本地 `public/sounds/system-overload.ogg`；详细记录 `public/licenses/system-overload-source.md`。原曲循环播放，漂移时压低音量，进入游戏淡出；按钮提示音由代码合成。

### 漂移开场

- 跑车：Khronos glTF Sample Assets 的 [Car Concept](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept)，本地 `public/models/intro/concept-car.glb`。© 2024 Darmstadt Graphics Group GmbH，Eric Chadwick（模型与贴图），采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。原始创作来源为 Unity Fan 的 CC0 概念车。下载文件内的 `asset.copyright` 与官方 README 均明确载明许可；完整来源说明保存在 `public/licenses/concept-car-source.md`。本项目调整了车漆、玻璃、轮毂，隐藏标识展示部分，并为开场重新构建可转动的车轮、添加动画和灯光；不表示原作者或 Khronos 对游戏的背书。
- 无车街道：`public/menu/night-alley-clean.png`，由现有 itsiken / Unsplash 图片通过内置 image_gen 工具去除汽车及其阴影、车灯与倒影，原始图片许可继续适用。生成提示词及输出记录见 `public/menu/clean-plate-generation.md`。原图仍保留。
- 漂移烟雾、车灯光晕、接地阴影、轮胎痕迹均由代码生成。音效复用现有引擎采样与轮胎啸叫系统。
- 整段开场约 3.8 秒，结束或跳过后释放独立渲染器、几何、材质和纹理。关闭动态效果时直接进入游戏；标签页隐藏时暂停开场。

- 布局改编参考：Prabhjot Singh 的 [Zentry](https://github.com/prabhsingh20/Zentry)，具体参考 `src/components/Hero.jsx` 的全屏主视觉、错位大标题及前景操作层。移植为项目现有的原生 HTML/CSS/TypeScript；不引入 React、Tailwind、GSAP。原项目 MIT 许可保留在 `public/licenses/zentry-MIT.txt`。未使用其品牌、视频或字体资源。
- 封面图：itsiken，[A sports car parked in a neon-lit alleyway at night](https://unsplash.com/photos/tADpuhqqeHk)，本地文件 `public/menu/night-drive.jpg`。采用 [Unsplash License](https://unsplash.com/license)，可免费用于商业及非商业项目、修改及分发；不能将未显著修改的图片单独出售，也不能用于复制竞争图库服务。图片不是 MIT 或 CC0；这些图片条款独立于游戏代码许可。该图作为氛围封面，不代表游戏实机画面。
- 英文字体：Jeremy Tribby 的 Barlow Condensed ExtraBold，来自 [Google Fonts](https://github.com/google/fonts/tree/main/ofl/barlowcondensed)，本地文件 `public/fonts/BarlowCondensed-ExtraBold.ttf`。采用 SIL Open Font License 1.1，完整许可位于 `public/licenses/barlow-OFL.txt`。
- 所有首页资产均本地提供；运行时无需连接图片或字体 CDN。

> 记录所有占位资源及推荐的 CC0 替换来源。红线：不使用任何商业游戏提取资产。

| 占位资源 | 位置 | 用途 | 推荐替换来源 | 状态 |
|---|---|---|---|---|
| ambientCG 路面 PBR 贴图 | `public/textures/ground/`（Asphalt031 + PavingStones128，Color/Normal） | 城市沥青与人行道 | 来源 https://ambientcg.com ，许可 CC0 | ✅ 已接入 |
| KayKit Adventurers 角色 ×5 | `public/models/characters/`（Knight/Barbarian/Mage/Rogue/Rogue_Hooded） | 玩家与行人（含骨骼动画） | 来源 https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 ，许可 CC0 | ✅ 已接入 |
| Kenney Car Kit 车辆模型 ×8 | `public/models/cars/`（sedan/suv/taxi/police 等） | 玩家车与交通车 | 来源 https://kenney.nl/assets/car-kit ，许可 CC0（无需署名） | ✅ 已接入 |
| Kenney City Kit 建筑 ×19 + 路灯 | `public/models/buildings/`、`public/models/props/` | 街区建筑与路灯 | 来源 https://kenney.nl/assets/city-kit-commercial 与 city-kit-roads ，许可 CC0 | ✅ 已接入 |
| Harakiri Warbike（OBJ+MTL+贴图） | `public/models/moto/` | 玩家摩托车 | 来源 https://opengameart.org/content/harakiri-warbike-1000cc ，作者 hc (hackcraft.de)，许可 **CC-BY 3.0（需署名，已在此登记）** | ✅ 已接入 |
| Stridsvagn 103 写实坦克（GLB+2048 PBR 贴图×4） | `public/models/tank/` | R 键空投坦克 | 来源 https://opengameart.org/content/stridsvagn-103 ，作者 Lukasz Wesiora (l.Wesiora@gmail.com)，许可 **CC-BY 3.0（需署名，已在此登记）**；由原始 .blend 经 Blender 4.1 无头导出，4K 贴图降采样至 2048 | ✅ 已接入 |
| Kenney Impact Sounds 音效 ×18 | `public/sounds/`（step/punch/crash/thud 系列） | 脚步、行人被击、车祸金属声、落地闷响 | 来源 https://kenney.nl/assets/impact-sounds ，许可 CC0 | ✅ 已接入 |
| 引擎循环采样 | `public/sounds/engine_loop.wav` | 驾驶引擎声（随车速变调） | 来源 https://opengameart.org/content/racing-car-engine-sound-loops ，许可 CC0 | ✅ 已接入 |
| 车辆杂音效 ×4 | `public/sounds/`（horn/door_open/door_close/engine_start） | 喇叭、上下车车门、点火 | 来源 https://opengameart.org/content/car-sound-effects-pack-low-quality ，许可 CC0 | ✅ 已接入 |


## Imported vehicle fleet

人物也已从同一源项目导入：玩家使用 Adventurer，路人使用 Animated Woman 和 Man，任务人物和警员同步替换。授权信息见 [imported-people](public/licenses/imported-people.md)。

Nine vehicle models and the helicopter rotor texture copied from `D:/AI/gpt/game/gta5/public/assets` into `public/assets`. Attribution and source terms: [imported-vehicles](public/licenses/imported-vehicles.md).


## 游泳动画接入与 Ferrari 恢复（后续修正）

- 当前七款非警用车继续使用用户原指定的 Ferrari 模型和颜色，不再采用上一轮临时换回的 Kenney 车型。原模型不改写，新增 ferrari-lod.json 保存同源远景简化索引；近处和驾驶使用原完整模型。
- 游泳使用 Quaternius Universal Animation Library 免费 Standard 版的 Swim_Fwd_Loop、Swim_Idle_Loop 和参考 A_TPose，CC0 1.0。官方来源 https://quaternius.com/packs/universalanimationlibrary.html ，原版免费包镜像 https://github.com/J-Ponzo/gltf-universal-animation-library 。仅提取所需动作和骨架，在现有人物上重定向。
- 本地资源及完整许可证：public/animations/quaternius/swimming.json、LICENSE.txt；修改与来源记录见同目录 README.md。全部资源本地运行。
- 当前修正详情：[游泳与 Ferrari 修正](SWIMMING_AND_FERRARI_FIX.md)。
