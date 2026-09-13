import * as THREE from 'three';
import { Engine } from './core/Engine';
import { Physics } from './core/Physics';
import { Input, enterImmersive } from './core/Input';
import { setupEnvironment } from './world/Scene';
import { ChunkManager, setCityNight, setCityWetness, updateCitySignals } from './world/ChunkManager';
import { WeatherSystem } from './world/Weather';
import { COAST_CX, CHUNK_SIZE, chunkZone } from './world/City';
import { Character } from './entities/Character';
import { CameraRig } from './entities/CameraRig';
import { Vehicle, MOTO_SPEC, BOAT_SPEC, TANK_SPEC } from './entities/Vehicle';
import { buildBoatModel } from './entities/BoatMesh';
import { Pedestrians } from './entities/Pedestrians';
import { TrafficSystem } from './entities/Traffic';
import { CharacterController } from './gameplay/CharacterController';
import { PlayerManager } from './gameplay/PlayerManager';
import { HUD, type HUDData } from './ui/HUD';
import { Minimap } from './ui/Minimap';
import { HelpOverlay } from './ui/Help';
import { GameAudio } from './core/Audio';
import { CarLibrary, PersonLibrary, PropLibrary, loadMotoModel, loadTankModel } from './core/Loader';
import { WeaponSystem } from './gameplay/Weapons';
import { WantedSystem } from './gameplay/Wanted';
import { StorySystem } from './gameplay/Story';
import { HealthSystem } from './gameplay/Health';
import { Pickups } from './gameplay/Pickups';
import { Shops } from './gameplay/Shops';
import { TaxiJobs } from './gameplay/TaxiJobs';
import { DriftIntro } from './ui/DriftIntro';
import { menuMotion } from './ui/menuControls';

const app = document.getElementById('app');
if (!app) throw new Error('#app container not found');

const engine = new Engine(app);
const physics = await Physics.create();
const [carLib, personLib, propLib, motoModel, tankModel] = await Promise.all([
  CarLibrary.load(),
  PersonLibrary.load(),
  PropLibrary.load(),
  loadMotoModel(),
  loadTankModel(),
]);
carLib.setupSportsReflections(engine.renderer);
const input = new Input(engine.renderer.domElement);
engine.preview = () => {
  input.endFrame();
};

const environment = setupEnvironment(engine.scene);

// 出生在路口（街区中心在 ±16+n·32 之外的路网交点），车停在旁边的路上
const spawnPoint = new THREE.Vector3(16, 2, 16);
const chunkManager = new ChunkManager(engine.scene, physics, spawnPoint, propLib, carLib);

const character = new Character(engine.scene, physics, spawnPoint.clone(), personLib);
const cameraRig = new CameraRig(engine.camera, physics, character.collider);
const vehicle = new Vehicle(engine.scene, physics, new THREE.Vector3(16, 2, 26), carLib);
const motorcycle = new Vehicle(engine.scene, physics, new THREE.Vector3(-262, 1.5, 16), carLib, MOTO_SPEC, motoModel);
// 剧情开局：两辆自有载具都"被偷走了"——暂存待剧情放出
vehicle.setStashed(true);
motorcycle.setStashed(true);
// 快艇泊在近海：水中浮力自持,不依赖 chunk 地面,无需暂存
const boat = new Vehicle(engine.scene, physics, new THREE.Vector3(-345, 0.6, 20), carLib, BOAT_SPEC, buildBoatModel());
// 坦克：暂存待命,按 R 空投到玩家面前（从天而降）
const tank = new Vehicle(engine.scene, physics, new THREE.Vector3(16, 3, 60), carLib, TANK_SPEC, tankModel);
tank.setStashed(true);
// 自有载具的统一遍历入口（beginStep/endStep/syncVisual/updateFx/setNight/爆炸波及）
const ownedVehicles = [vehicle, motorcycle, boat, tank];
const pedestrians = new Pedestrians(engine.scene, physics, spawnPoint, personLib);
const traffic = new TrafficSystem(engine.scene, physics, spawnPoint, carLib);

const controller = new CharacterController(character, cameraRig, input, (x, z, feetY) =>
  chunkManager.stairHeightAt(x, z, feetY),
);
const playerManager = new PlayerManager(character, controller, ownedVehicles, traffic, cameraRig, input);
const hud = new HUD();
const minimap = new Minimap();
new HelpOverlay(); // H 键呼出游戏指南
const audio = new GameAudio();
const weather = new WeatherSystem(engine.scene);
const weapons = new WeaponSystem(
  engine.scene,
  physics,
  engine.camera,
  input,
  audio,
  character,
  pedestrians,
  ownedVehicles.map((v) => v.chassisBody),
);
const crosshairEl = document.getElementById('crosshair');

// 通缉系统：犯罪事件从武器/抢车/撞人处上报
const wanted = new WantedSystem(
  engine.scene,
  physics,
  audio,
  carLib,
  personLib,
  controller,
  pedestrians,
);
const blastTmp = new THREE.Vector3();
weapons.onCrime = (kind, x, z) => {
  wanted.reportCrime(kind, x, z);
  // 爆炸波及自有载具车况（殉爆可链式,damage 对已报废车免疫故必收敛）
  if (kind === 'explosion') {
    for (const v of ownedVehicles) {
      if (v.stashed) continue;
      v.getPosition(blastTmp);
      const d = Math.hypot(blastTmp.x - x, blastTmp.z - z);
      if (d < 8) v.damage(70 * (1 - d / 8));
    }
  }
};
pedestrians.onHitByPlayerCar = (x, z) => {
  wanted.reportCrime('pedhit', x, z);
  audio.pedHit(true);
};
// 子弹命中动态体 → 行人/警察扣血（行人先查，未命中再查警察）
weapons.onHitBody = (body, dmg) => {
  if (!pedestrians.applyBulletDamage(body, dmg)) wanted.applyBulletDamage(body, dmg);
};
// 车况归零 → 原地殉爆（特效/冲击/自伤与手雷一致）
for (const v of ownedVehicles) {
  v.onExploded = () => {
    v.getPosition(blastTmp);
    weapons.explodeAt(blastTmp.x, blastTmp.y + 0.5, blastTmp.z);
  };
}

// 主线剧情
const story = new StorySystem(engine.scene, personLib, vehicle, motorcycle, traffic, wanted);
playerManager.connectWorldVehicles(wanted, chunkManager, (x, y, z, yaw, type) => {
  const taken = new Vehicle(engine.scene, physics, new THREE.Vector3(x, y + .9, z), carLib);
  taken.setCarType(type); taken.teleportTo(x, z, yaw, y + .9);
  taken.onExploded = () => {
    taken.getPosition(blastTmp);
    weapons.explodeAt(blastTmp.x, blastTmp.y + .5, blastTmp.z);
  };
  return taken;
});
playerManager.onCarjack = () => {
  wanted.reportCrime('carjack', 0, 0);
  story.notifyCarjack();
};

// 生命值与失败状态：五路伤害源 → HP；归零医院复活
const health = new HealthSystem();
wanted.onPlayerHit = (dmg) => {
  // 驾车时车身挡一半子弹,但车况掉
  if (playerManager.isDriving) {
    playerManager.activeVehicle.damage(6);
    health.damage(dmg * 0.5);
  } else {
    health.damage(dmg);
  }
};
weapons.onPlayerBlast = (dmg, dx, dz) => {
  health.damage(dmg);
  if (!playerManager.isDriving) controller.knock(dx * 9, dz * 9, 4.5);
};
playerManager.onEjected = () => health.damage(25);
controller.onHardLanding = (v) => {
  health.damage(Math.min(50, (v - 12) * 4));
  audio.land(true);
};
health.onRespawn = () => {
  playerManager.forceExit();
  character.teleport(spawnPoint);
  controller.reset();
  wanted.clearAll();
};

// 经济闭环：掉钱拾取 + 商店（弹药/喷漆清通缉）+ 出租车载客
const pickups = new Pickups(engine.scene, audio, health);
const shops = new Shops(engine.scene, input, audio, health, weapons, wanted);
const taxiJobs = new TaxiJobs(engine.scene, personLib, audio, health);
pedestrians.onDropMoney = (x, z) => pickups.spawn(x, 0.5, z, 10 + Math.floor(Math.random() * 31));

// 开始页面：点击后隐藏、启动音频（需用户手势）、锁定鼠标
const menu = document.getElementById('menu');
const startBtn = document.querySelector<HTMLButtonElement>('#start-btn');
let intro: DriftIntro | null = null;
if (menu) {
  try {
    intro = await DriftIntro.create(menu);
  } catch (error) {
    console.warn('开场动画加载失败，将直接进入游戏。', error);
  }
}
if (startBtn) startBtn.disabled = false;
document.getElementById('start-label')!.textContent = '开始游戏';
document.getElementById('load-status')!.textContent = '城市已就绪';
let started = false;
let startAccepted = false;
function enterGame(): void {
  if (started) return;
  started = true;
  window.dispatchEvent(new Event('game:started'));
  document.body.classList.remove('menu-open');
  engine.preview = null;
  input.endFrame();
  menu?.classList.add('leaving');
  if (menu) {
    menu.inert = true;
    window.setTimeout(() => { menu.style.display = 'none'; }, 650);
  }
  audio.start();
  story.start();
  // Fullscreen transitions can briefly reject pointer lock; clicking the canvas retries.
  engine.renderer.domElement.requestPointerLock()?.catch(() => {});
  window.setTimeout(() => { intro?.dispose(); intro = null; }, 650);
}
startBtn?.addEventListener('click', () => {
  if (startAccepted) return;
  startAccepted = true;
  audio.start();
  enterImmersive();
  const isAutotest = new URLSearchParams(location.search).has('autotest');
  if (intro && menuMotion && !isAutotest) {
    audio.engineStart();
    intro.play(enterGame, (speed, skid) => {
      audio.update(speed, speed > 0, speed > 30 ? .9 : .2);
      audio.setScreech(skid * .8);
    });
  } else {
    enterGame();
  }
});
// —— 自动化冒烟测试（?autotest）：帧驱动状态机走真实代码路径"上车→油门 8 秒"，
// 结果以 console.warn 打给 vite 终端日志（AUTOTEST PASS/FAIL）——
// 专抓"上车后物理爆炸/NaN/卡死"这类回归。用帧计数而非 setTimeout：
// 后台/被遮挡标签页 rAF 暂停时定时器照跑，会误判
let autotestTick: (() => void) | null = null;
const autotestMode = new URLSearchParams(location.search).get('autotest');
// Existing frame-driven smoke tests must run the game loop to reach their start click.
if (autotestMode !== null) engine.preview = null;
// ?autotest=tank：R 空投 → 等落地 → 传送到坦克旁 → E 上车 → 油门 5 秒
if (autotestMode === 'tank') {
  let frames = 0;
  let driveFrames = 0;
  let done = false;
  const pos = new THREE.Vector3();
  const dropPos = new THREE.Vector3();
  autotestTick = () => {
    if (done) return;
    frames++;
    if (frames === 30) {
      (document.getElementById('start-btn') as HTMLButtonElement | null)?.click();
    } else if (frames === 40) {
      input.debugHold('KeyR', true); // 空投
    } else if (frames === 44) {
      input.debugHold('KeyR', false);
      if (tank.stashed) {
        console.warn('AUTOTEST FAIL: R 空投未生效');
        done = true;
      }
    } else if (frames === 300) {
      // 34m 自由落体约 2.6s（156 帧），到这里必须已落地且姿态健康
      tank.getPosition(pos);
      if (!Number.isFinite(pos.x + pos.y + pos.z) || pos.y < -1 || pos.y > 25) {
        console.warn(`AUTOTEST FAIL: 落地异常 y=${pos.y.toFixed(2)}`);
        done = true;
        return;
      }
      dropPos.set(pos.x + 2.2, pos.y + 0.3, pos.z);
      character.teleport(dropPos); // 传送到坦克旁（省去走路寻路）
      controller.reset();
    } else if (frames === 320) {
      input.debugHold('KeyE', true); // 上坦克
    } else if (frames === 324) {
      input.debugHold('KeyE', false);
      if (!playerManager.isDriving || playerManager.activeVehicle !== tank) {
        console.warn('AUTOTEST FAIL: E 上坦克未生效');
        done = true;
        return;
      }
      tank.getPosition(dropPos); // 记录起驶点
      input.debugHold('KeyW', true);
    } else if (frames > 324) {
      driveFrames++;
      tank.getPosition(pos);
      if (!Number.isFinite(pos.x + pos.y + pos.z) || !Number.isFinite(tank.speedKmh)) {
        console.warn(`AUTOTEST FAIL: NaN @driveFrame ${driveFrames}`);
        done = true;
        return;
      }
      if (driveFrames >= 300) {
        input.debugHold('KeyW', false);
        const moved = Math.hypot(pos.x - dropPos.x, pos.z - dropPos.z);
        console.warn(
          moved > 8 && pos.y > -1
            ? `AUTOTEST PASS: tank moved=${moved.toFixed(1)}m pos=(${pos.x.toFixed(1)},${pos.y.toFixed(2)},${pos.z.toFixed(1)}) speed=${tank.speedKmh.toFixed(0)}km/h`
            : `AUTOTEST FAIL: tank moved=${moved.toFixed(1)}m pos=(${pos.x.toFixed(1)},${pos.y.toFixed(2)},${pos.z.toFixed(1)})`,
        );
        done = true;
      }
    }
  };
} else if (autotestMode !== null) {
  let frames = 0;
  let driveFrames = 0;
  let done = false;
  const pos = new THREE.Vector3();
  autotestTick = () => {
    if (done) return;
    frames++;
    if (frames === 30) {
      (document.getElementById('start-btn') as HTMLButtonElement | null)?.click();
      vehicle.setStashed(false);
      vehicle.teleportTo(16, 18.5, 0); // 放到玩家旁边（可上车距离内）
    } else if (frames === 60) {
      input.debugHold('KeyE', true); // 上车
    } else if (frames === 64) {
      input.debugHold('KeyE', false);
      if (!playerManager.isDriving) {
        console.warn('AUTOTEST FAIL: E 上车未生效');
        done = true;
        return;
      }
      input.debugHold('KeyW', true); // 油门
    } else if (frames > 64) {
      driveFrames++;
      vehicle.getPosition(pos);
      if (!Number.isFinite(pos.x + pos.y + pos.z) || !Number.isFinite(vehicle.speedKmh)) {
        console.warn(`AUTOTEST FAIL: NaN @driveFrame ${driveFrames}`);
        done = true;
        return;
      }
      if (driveFrames >= 480) {
        input.debugHold('KeyW', false);
        const moved = Math.hypot(pos.x - 16, pos.z - 18.5);
        console.warn(
          moved > 15 && pos.y > -1 && pos.y < 5
            ? `AUTOTEST PASS: moved=${moved.toFixed(1)}m pos=(${pos.x.toFixed(1)},${pos.y.toFixed(2)},${pos.z.toFixed(1)}) speed=${vehicle.speedKmh.toFixed(0)}km/h`
            : `AUTOTEST FAIL: moved=${moved.toFixed(1)}m pos=(${pos.x.toFixed(1)},${pos.y.toFixed(2)},${pos.z.toFixed(1)})`,
        );
        done = true;
      }
    }
  };
}

const camTarget = new THREE.Vector3();
const carPosTmp = new THREE.Vector3();
const carVelTmp = new THREE.Vector3();
const hudData: HUDData = {
  state: 'idle',
  speed: 0,
  speedUnit: 'm/s',
  grounded: false,
  position: camTarget,
  pointerLocked: false,
  hint: '',
  weapon: '',
  guide: '',
  clock: '',
  stars: 0,
  evading: false,
  hp: 100,
  money: 0,
  vehicleCond: -1,
  frameAvgMs: 0,
  frameMaxMs: 0,
  physMs: 0,
  drawCalls: 0,
  pixelRatio: 1,
};
let physMsAccum = 0;
let physMsShown = 0;
let waterTime = 0;

// 海滩东边界（沙滩 chunk 列的东缘）
const BEACH_EDGE_X = COAST_CX * CHUNK_SIZE + CHUNK_SIZE / 2;
const GUIDE_ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const;
const camForwardTmp = new THREE.Vector3();
const storyTargetTmp = new THREE.Vector3();

/** 通用导航：相对当前视角方向的箭头 + 距离 */
function guideTo(label: string, tx: number, tz: number): string {
  const dx = tx - camTarget.x;
  const dz = tz - camTarget.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 4) return `${label} 就在附近`;
  engine.camera.getWorldDirection(camForwardTmp);
  // rel>0 = 目标在视线右侧
  const rel = Math.atan2(
    camForwardTmp.x * dz - camForwardTmp.z * dx,
    camForwardTmp.x * dx + camForwardTmp.z * dz,
  );
  const sector = ((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8;
  return `${label} ${GUIDE_ARROWS[sector]} ${dist.toFixed(0)}m`;
}

/** 海滩导航（无剧情目标时的兜底） */
function beachGuide(): string {
  if (camTarget.x - BEACH_EDGE_X <= 0) return '';
  return guideTo('海滩', BEACH_EDGE_X, camTarget.z);
}

// 骑手贴装用临时量：面向车头（人面 -Z、车头 +Z → 转半圈）并前倾 24°
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const RIDER_FACE = new THREE.Quaternion()
  .setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
  .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.5));
const riderQ = new THREE.Quaternion();
const riderLeanQ = new THREE.Quaternion();
const riderPos = new THREE.Vector3();
const barL = new THREE.Vector3();
const barR = new THREE.Vector3();

const rescueTmp = new THREE.Vector3();
let wasDriving = false;
let prevMoveState = 'idle';

engine.setHooks({
  fixedUpdate: (dt) => {
    // 角色陷地/坠落兜底：按分区取合法最低高度——城市/沙滩地面为 0（角色中心应 ≈0.95），
    // 海洋区可游到海床上方。低于阈值即视为已嵌进碰撞体或坠出世界，拉回地表
    if (!playerManager.isDriving) {
      character.getPosition(rescueTmp);
      const sunk =
        chunkZone(Math.round(rescueTmp.x / CHUNK_SIZE)) === 'ocean'
          ? rescueTmp.y < -1.6
          : rescueTmp.y < 0.25;
      if (sunk) {
        rescueTmp.y = 1.2;
        character.teleport(rescueTmp);
        controller.reset();
      }
    }
    character.beginStep();
    for (const v of ownedVehicles) v.beginStep();
    playerManager.activeVehicle.getPosition(carPosTmp);
    playerManager.activeVehicle.getLinvel(carVelTmp);
    pedestrians.beginStep(dt, camTarget, carPosTmp, carVelTmp);
    traffic.fixedUpdate(dt, camTarget, carPosTmp);
    wanted.fixedUpdate(dt, camTarget, playerManager.isDriving, playerManager.activeVehicle);

    playerManager.fixedUpdate(dt);
    // 驾车撞击：Δv>4 出金属撞击声，Δv>10（≈36km/h 撞墙）掉血
    if (playerManager.isDriving) {
      const iv = playerManager.activeVehicle.impactDv;
      if (iv > 4) audio.crash(Math.min(1, iv / 22));
      if (iv > 10) health.damage(Math.min(45, (iv - 10) * 2.5));
    }
    const t0 = performance.now();
    physics.step(dt);
    physMsAccum += performance.now() - t0;

    character.endStep();
    for (const v of ownedVehicles) v.endStep();
    pedestrians.endStep();
    wanted.endStep();
  },
  update: (dt, alpha) => {
    playerManager.update(dt);

    // 上下车音效：关门+点火 / 开门下车
    if (playerManager.isDriving !== wasDriving) {
      wasDriving = playerManager.isDriving;
      if (wasDriving) {
        audio.door(false);
        audio.engineStart();
      } else {
        audio.door(true);
        audio.setHorn(false);
      }
    }

    character.animate(dt, controller.speed, character.grounded, controller.state === 'swim');
    character.syncVisual(alpha);
    for (const v of ownedVehicles) {
      v.syncVisual(alpha);
      v.updateFx(dt);
    }

    // 骑手贴装：坐上摩托（坐点偏移 + 面向车头 + 前倾 + 跟随压弯）
    const rv = playerManager.ridingVehicle;
    if (rv) {
      riderLeanQ.setFromAxisAngle(Z_AXIS, rv.visualLean);
      riderQ.copy(rv.mesh.quaternion).multiply(riderLeanQ);
      // 落座点/把手坐标来自对 bike.obj 顶点的实测（见 scratchpad/measure-bike.mjs）：
      // 车把末端在车身系 (±0.17, 0.38, 0.23)；骑手前坐贴油箱，肘部弯曲够把
      riderPos.set(0, 0.33, 0.22).applyQuaternion(riderQ).add(rv.mesh.position);
      character.mesh.position.copy(riderPos);
      character.mesh.quaternion.copy(riderQ).multiply(RIDER_FACE);
      // 双手 IK 握把：目标即实测把端（微内收），随车身与压弯实时变化
      // 手部高度对齐头盔下沿（约在骑手头底的水平线上）
      barL.set(-0.16, 0.85, 0.4).applyQuaternion(riderQ).add(rv.mesh.position);
      barR.set(0.16, 0.85, 0.4).applyQuaternion(riderQ).add(rv.mesh.position);
      character.aimArmsAt(barL, barR);
    }
    pedestrians.syncVisual(alpha, dt);
    traffic.syncVisual(alpha);
    wanted.update(dt, alpha);
    story.update(
      dt,
      camTarget,
      playerManager.isDriving,
      playerManager.isDriving && playerManager.activeVehicle === vehicle,
      playerManager.isDriving && playerManager.activeVehicle === motorcycle,
      wanted.stars,
    );
    const driving = playerManager.isDriving;
    cameraRig.applyWheel(input.consumeWheel());
    weapons.update(dt, driving || playerManager.isCarjacking);
    if (crosshairEl) {
      crosshairEl.style.display =
        weapons.current !== 'none' && input.pointerLocked && !driving ? 'block' : 'none';
    }
    playerManager.getCameraTarget(camTarget);
    if (input.wasPressed('KeyN')) environment.skip(0.06); // 快进约 1.5 小时
    if (input.wasPressed('KeyT')) weather.toggle(); // 手动切换天气
    // R 空投坦克：在玩家视线前方 12m 上空 34m 放下（正在开坦克时忽略,防止砸自己）
    if (input.wasPressed('KeyR') && !(playerManager.isDriving && playerManager.activeVehicle === tank)) {
      engine.camera.getWorldDirection(camForwardTmp);
      const dropYaw = Math.atan2(camForwardTmp.x, camForwardTmp.z);
      tank.setStashed(false);
      tank.teleportTo(
        camTarget.x + Math.sin(dropYaw) * 12,
        camTarget.z + Math.cos(dropYaw) * 12,
        dropYaw,
        34,
      );
    }
    weather.update(dt, camTarget);
    const wet = weather.wetness;
    environment.update(dt, camTarget, wet);
    setCityWetness(wet);
    audio.setRain(wet);
    const night = environment.nightFactor;
    setCityNight(night);
    for (const v of ownedVehicles) v.setNight(night);
    traffic.setNight(night);
    // 辉光：白天极淡，入夜增强，雨夜再加成（湿面反光 + 光晕）
    engine.setBloom(0.05 + night * 0.24 + night * wet * 0.12);
    chunkManager.update(camTarget);
    chunkManager.doors.update(dt, camTarget);
    waterTime += dt;
    chunkManager.animateWater(waterTime);
    updateCitySignals(waterTime, 1 + night * 0.9);
    audio.update(
      playerManager.activeVehicle.speedKmh,
      driving,
      driving && input.isDown('KeyW') ? 1 : 0,
    );
    audio.setSiren(wanted.sirenLevel);
    // 喇叭（F 按住持续响）；步行时按步幅出脚步声，起跳/落地沿状态切换触发
    audio.setHorn(driving && input.isDown('KeyF'));
    if (!driving) audio.setMovement(controller.state, controller.speed, dt);
    const moveState = driving ? 'drive' : controller.state;
    if (moveState !== prevMoveState) {
      if (moveState === 'jump') audio.jump();
      else if (prevMoveState === 'jump') audio.land(false);
      prevMoveState = moveState;
    }
    // 轮胎啸叫：手刹漂移时随车速开阖
    const speedAbs = Math.abs(playerManager.activeVehicle.speedKmh);
    audio.setScreech(driving && input.isDown('Space') && speedAbs > 25 ? Math.min(1, speedAbs / 70) : 0);
    if (driving) {
      cameraRig.updateChase(
        dt,
        camTarget,
        playerManager.activeVehicle.visualHeadingYaw,
        Math.abs(playerManager.activeVehicle.speedKmh),
        input.consumeMouseDelta(),
      );
    } else {
      cameraRig.update(dt, camTarget, input.consumeMouseDelta());
    }

    hudData.state = driving ? 'drive' : controller.state;
    hudData.speed = driving ? Math.abs(playerManager.activeVehicle.speedKmh) : controller.speed;
    hudData.speedUnit = driving ? 'km/h' : 'm/s';
    hudData.grounded = character.grounded;
    hudData.pointerLocked = input.pointerLocked;
    hudData.hint = playerManager.hint;
    hudData.weapon = weapons.label;
    // 导航优先级：剧情目标 > 出租车任务 > 海滩兜底
    const storyLabel = story.targetInfo(storyTargetTmp);
    const taxiLabel = storyLabel ? null : taxiJobs.targetInfo(storyTargetTmp);
    const guideLabel = storyLabel ?? taxiLabel;
    hudData.guide = guideLabel
      ? guideTo(guideLabel, storyTargetTmp.x, storyTargetTmp.z)
      : beachGuide();
    hudData.clock = environment.clock + (weather.wetness > 0.35 ? ' ☔' : '');
    hudData.stars = wanted.stars;
    hudData.evading = wanted.evading;
    health.update(dt);
    hudData.hp = health.hp;
    hudData.money = health.money;
    hudData.vehicleCond = driving ? playerManager.activeVehicle.condition : -1;
    pickups.update(dt, camTarget);
    shops.update(dt, camTarget, driving, driving ? playerManager.activeVehicle : null);
    taxiJobs.update(
      dt,
      camTarget,
      driving && playerManager.activeVehicle.carType === 'taxi',
      playerManager.activeVehicle.speedKmh,
    );

    // 小地图：地形 → 实体点 → 玩家朝向
    if (minimap.begin(camTarget.x, camTarget.z)) {
      traffic.forEachCar((x, z) => minimap.dot(x, z, '#d9dee4', 2.3));
      for (const taken of ownedVehicles.slice(4)) {
        if (taken.stashed || (driving && taken === playerManager.activeVehicle)) continue;
        taken.getPosition(carPosTmp);
        minimap.dot(carPosTmp.x, carPosTmp.z, '#54a8ff', 3);
      }
      pedestrians.forEachPed((x, z) => minimap.dot(x, z, '#ffb15e', 1.5));
      wanted.forEachUnit((x, z, isCar) =>
        minimap.dot(x, z, isCar ? '#ff5252' : '#ff9c9c', isCar ? 3 : 1.8),
      );
      if (!vehicle.stashed && (playerManager.activeVehicle !== vehicle || !driving)) {
        vehicle.getPosition(carPosTmp);
        minimap.dot(carPosTmp.x, carPosTmp.z, '#54a8ff', 3);
      }
      if (!motorcycle.stashed && (playerManager.activeVehicle !== motorcycle || !driving)) {
        motorcycle.getPosition(carPosTmp);
        minimap.dot(carPosTmp.x, carPosTmp.z, '#4dffd5', 2.6);
      }
      if (playerManager.activeVehicle !== boat || !driving) {
        boat.getPosition(carPosTmp);
        minimap.dot(carPosTmp.x, carPosTmp.z, '#7de1ff', 2.8);
      }
      if (!tank.stashed && (playerManager.activeVehicle !== tank || !driving)) {
        tank.getPosition(carPosTmp);
        minimap.dot(carPosTmp.x, carPosTmp.z, '#a8d178', 3.2);
      }
      if (guideLabel) {
        minimap.dot(storyTargetTmp.x, storyTargetTmp.z, storyLabel ? '#ffd34d' : '#51ff7e', 3.5);
      }
      shops.forEachShop((x, z, color) => minimap.dot(x, z, color, 2.6));
      engine.camera.getWorldDirection(camForwardTmp);
      minimap.end(camForwardTmp.x, camForwardTmp.z);
    }
    physMsShown = physMsShown * 0.9 + physMsAccum * 0.1;
    physMsAccum = 0;
    hudData.frameAvgMs = engine.stats.avgMs;
    hudData.frameMaxMs = engine.stats.maxMs;
    hudData.physMs = physMsShown;
    hudData.drawCalls = engine.renderer.info.render.calls;
    hudData.pixelRatio = engine.stats.pixelRatio;
    hud.update(dt, hudData);

    input.endFrame();
    autotestTick?.(); // endFrame 之后：本帧注入的按键留到下一帧被消费
  },
});

engine.start();
