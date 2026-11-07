# 游泳动作与原 Ferrari 恢复

本轮修正上一轮两处问题：游泳用公式摆动骨骼，未正确处理骨骼坐标、脚骨与身体姿态；性能优化把用户原先指定的六款 Ferrari 颜色变体换回了普通车型。两处改动均已纠正。

## 查阅资料与采取的方法

- [Epic：IK Rig 骨骼重定向](https://dev.epicgames.com/documentation/en-us/unreal-engine/ik-rig-animation-retargeting-in-unreal-engine)：不同人物需要处理骨骼方向、参考姿势与链映射，手脚接触点需要单独校正。
- [Unity：Humanoid Avatar](https://docs.unity.cn/2023.3/Documentation/Manual/AvatarCreationandSetup.html)：人形动画重定向依赖对身体、头、手臂、腿等骨骼的映射。
- [Quaternius：Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html)：提供完整人形动画，包括游泳，作者标明 CC0。当前使用免费 Standard 版的 `Swim_Fwd_Loop` 和 `Swim_Idle_Loop`，并用 `A_TPose` 做参考。

游戏里现有模型仍然保留。动作先在原动画骨架播放，再按参考姿势转到三套游戏人物骨架，保持各自骨长。原地使用直立踩水，移动时使用完整蛙泳：前伸、向外划水、收手收腿、蹬腿伸展。没有将蛙泳称为自由泳。

人物脚骨在这些导入模型中直接挂在根骨骼下，不是小腿的子骨骼，因此同时重定向脚的旋转，并根据动画小腿更新脚的位置。去掉上一版整个人额外前翻约 72 度的处理；俯仰只随上浮/下潜做小幅调整。水面踩水姿势适当降低身体以接近肩部水线，镜头继续跟随实际物理位置。

原位移控制保留：**WASD 游动、Ctrl 下潜、Space 上浮、Shift 加速**；岸上 Space 仍是先升后落的翻滚跳跃。

动画及许可证在 `public/animations/quaternius/`。原始资料、提取方法和动画来源写在同目录 README，运行时全部使用本地资源，不需要登录或联网。

## Ferrari 恢复

- 七款非警用车型重新使用原 `public/models/cars/ferrari.glb`，恢复各自原配色。警车和已导入的公交、摩托等独立车型继续使用对应资源。
- 出生点前方 `(16,26)` 恢复一辆可驾驶的红色完整 Ferrari，不再将它隐藏。走近按 E 上车；完整原车身、车漆、车轮、转向和悬挂保留。
- 驾驶车辆始终保留完整模型。普通车流与停靠车靠近时使用约 35.9 万三角形的原模型，远处切换为**从同一辆 Ferrari 简化得到**的约 9077 三角形版本；没有换成其他汽车。
- 停靠车按距离分别压紧完整模型与远景版本的实例数量，取走后两组均移除。远处的原模型不会仅缩成零大小后继续绘制全量顶点。
- 原 `ferrari.glb` 未修改。简化索引单独保存为 `ferrari-lod.json`，可由 `tools/build-ferrari-lod.mjs` 用现有 meshoptimizer 重新生成。

## 检查与证据

- 三个人物骨架分别检查整套前进和踩水循环。前进时身体基本水平，踩水时直立；抽样帧间脚踝骨长误差最大约 1.9 mm，来自 30 Hz 动画键帧之间的插值。
- 实际键盘上车并加速，确认驾驶的是红色 Ferrari，原车轮显示正常；测试中前进约 8.4 米，速度达到约 47 km/h。
- 检查车流与停靠车近处完整、远处简化，以及取走停靠车后没有残留的重叠模型。
- 实际水下前进使用 `Swim_Forward`，人物不再额外旋转成俯冲姿势。翻滚跳跃、Ctrl 镜头下潜、三维游动、上浮与透明水面检查通过。
- 原建筑实体、东方明珠碰撞和直升机升降转弯回归通过；生产构建进入、移动、跳跃、暂停、背包及资源加载检查通过。
- TypeScript 和生产构建通过；输出为 `scratchpad/polish-build/`，保留原 `dist/`。

脚本与结果：`scratchpad/check-ferrari-swim.mjs`、`scratchpad/swim-correction-review/checks.json`、`scratchpad/check-real-roll-swim.mjs`、`scratchpad/check-solid-flight.mjs`、`scratchpad/check-built-polish.mjs`。

恢复跑车后的同机性能复测：1280×800，四个相同位置，每处采样 150 帧并排除前 30 帧。外滩、老街、港区和水下的实际帧间隔中位数均约 16.7 ms，P95 为 16.8–17.0 ms。此为当前测试机器和视角的数据，不是所有硬件的帧率保证。原始数据见 `scratchpad/polish-review/restored-ferrari.json`。

## 直接查看

- [6 秒连续骨骼动作预览](scratchpad/swim-correction-review/authored-swimming-preview.webm)：前半为蛙泳，后半为踩水；这是无场景遮挡的动作检查预览。
- [游戏里的水下划水](scratchpad/swim-correction-review/authored-underwater-stroke.png)。
- [游戏里恢复的红色 Ferrari](scratchpad/swim-correction-review/restored-ferrari.png)。

刷新原预览 **http://127.0.0.1:5186/**，即可在原浏览器与地址中继续试玩。当前等待用户检查这两个修正，不进入新的开发阶段。
