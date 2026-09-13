import type { CarType } from '../core/Loader';

export const BLOCK_SIZE = 24; // 街区地皮边长
const ROAD_WIDTH = 8;
export const PITCH = BLOCK_SIZE + ROAD_WIDTH; // 街区中心间距
export const PLOT_HEIGHT = 0.04; // 地皮薄贴面（纯视觉，无碰撞体——路面全平，行驶不颠）
const CHUNK_BLOCKS = 3; // 每 chunk 3×3 街区
export const CHUNK_SIZE = CHUNK_BLOCKS * PITCH; // 96m

const SAND = 0xe3d2a4;
const SEABED = 0xc8b184;

// —— 分区：x 轴向西依次是 城市 → 沙滩(1 列 chunk) → 海洋 ——
type ChunkZone = 'city' | 'beach' | 'ocean';
export const COAST_CX = -3; // 该列 chunk 是沙滩
/** 深水海床顶面（近岸 chunk 内部另做浅滩/深水分级） */
const OCEAN_FLOOR_Y = -1.8;
/** 城市区最西侧街区中心 x（行人重生夹紧用） */
export const CITY_MIN_BLOCK_X = (COAST_CX + 1) * CHUNK_SIZE - PITCH;

export function chunkZone(cx: number): ChunkZone {
  if (cx > COAST_CX) return 'city';
  if (cx === COAST_CX) return 'beach';
  return 'ocean';
}

// —— 路网寻路共用约定（Traffic / Wanted）——
export const HALF_ROAD = PITCH / 2; // 道路中心线 ≡ 16 (mod 32)
// 方向：0=+z 1=+x 2=-z 3=-x
export const DIR_X = [0, 1, 0, -1];
export const DIR_Z = [1, 0, -1, 0];
/** 右侧车道横向偏移（右侧通行）：+z→x-2，+x→z+2，-z→x+2，-x→z-2 */
export const LANE_X = [-2, 0, 2, 0];
export const LANE_Z = [0, 2, 0, -2];

/** 就近吸附到道路中心线（≡ HALF_ROAD mod PITCH） */
export function snapToRoad(v: number): number {
  return Math.round((v - HALF_ROAD) / PITCH) * PITCH + HALF_ROAD;
}

/** 路网行驶车（Traffic AI 车 / 警车）所需的最小字段 */
export interface RoadRunner {
  /** 方向索引：0=+z 1=+x 2=-z 3=-x */
  dir: number;
  currPos: { x: number; z: number };
}

/**
 * 路网行驶一步（Traffic/Wanted 共用）：沿 dir 前进；跨过路口中心线时经 pickDir
 * 选新方向（返回原方向即直行）并把双轴吸附到新车道；越过城市西界自动调头
 * （不开进沙滩/海里）。返回行进方向 yaw。
 */
export function advanceOnRoad(
  car: RoadRunner,
  speed: number,
  dt: number,
  pickDir: (dir: number, x: number, z: number) => number,
): number {
  const prevAlong = car.dir % 2 === 0 ? car.currPos.z : car.currPos.x;
  car.currPos.x += DIR_X[car.dir]! * speed * dt;
  car.currPos.z += DIR_Z[car.dir]! * speed * dt;
  const along = car.dir % 2 === 0 ? car.currPos.z : car.currPos.x;

  // 跨过路口中心线 → 选新方向
  const step = along - prevAlong;
  if (step !== 0) {
    const line = snapToRoad(prevAlong + step * 0.5 + Math.sign(step) * 0.01);
    const crossed = (prevAlong < line && along >= line) || (prevAlong > line && along <= line);
    if (crossed) {
      const newDir = pickDir(car.dir, car.currPos.x, car.currPos.z);
      if (newDir !== car.dir) {
        // 旧行进轴坐标定在路口线，横轴吸附到新道路的右车道
        if (car.dir % 2 === 0) {
          car.currPos.z = line + LANE_Z[newDir]!;
          car.currPos.x = snapToRoad(car.currPos.x) + LANE_X[newDir]!;
        } else {
          car.currPos.x = line + LANE_X[newDir]!;
          car.currPos.z = snapToRoad(car.currPos.z) + LANE_Z[newDir]!;
        }
        car.dir = newDir;
      }
    }
  }

  // 城市区外调头
  if (car.currPos.x < CITY_MIN_BLOCK_X - HALF_ROAD && DIR_X[car.dir]! < 0) {
    car.dir = 1;
    car.currPos.x = snapToRoad(car.currPos.x) + LANE_X[1]!;
  }
  return Math.atan2(DIR_X[car.dir]!, DIR_Z[car.dir]!);
}

const SIDEWALK = 3; // 人行道退线
/** 人行道中线离街区中心的偏移（行人巡走 / 出租车接客点共用同一条线） */
export const SIDEWALK_LINE = BLOCK_SIZE / 2 - 1.5;
const LOT = (BLOCK_SIZE - SIDEWALK * 2) / 2; // 每街区 2×2 宅地
const CITY_SEED = 20260717;
// 纽约系楼色（乘在实拍幕墙贴图上做楼间色差）：石灰岩米、砂岩棕、暖花岗灰、玻璃蓝灰、褐石
const BUILDING_COLORS = [0xd9c9b4, 0xc9a184, 0xbfb4a8, 0x9caebc, 0x8d7f72];

/** 一个盒子体块（地皮或楼层）：base 为底面高度；solid=false 表示纯视觉无碰撞体 */
export interface BoxInstance {
  x: number;
  z: number;
  w: number;
  h: number;
  d: number;
  base: number;
  color: number;
  solid: boolean;
  /** 墙面带窗户贴图（楼体），渲染进单独的 InstancedMesh */
  windows?: boolean;
  /** 幕墙款式索引（配合 windows，四款实拍幕墙轮换） */
  facade?: number;
  /** 特殊渲染：glow=自发光体（灯头），pool=夜间地面光斑（w/d 为直径），signal=红绿灯灯面（全城同步变色） */
  kind?: 'glow' | 'pool' | 'signal';
  /** 碰撞体绕 X 轴旋转（弧度）——斜坡用 */
  rotX?: number;
  /** 只作碰撞不渲染（隐形斜坡等） */
  hidden?: boolean;
}

/** 商店门：铰链世界坐标（门板沿 z 轴长 1.2m），swing 为内开方向符号 */
export interface DoorSpec {
  hx: number;
  hz: number;
  swing: number;
}

/** 楼梯高度场区域：在 [x0,x1]×[z0,z1] 内，沿 z 从 zf(高度 base) 线性升到 zt(高度 top) */
export interface StairZone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  zf: number;
  zt: number;
  base: number;
  top: number;
}

/** GLB 道具摆放（建筑/路灯等，模型由 PropLibrary 提供，渲染由 ChunkManager 合并） */
export interface PropSpec {
  type: string;
  x: number;
  z: number;
  rotY: number;
  /** 挂装高度（默认贴地）——雨棚等墙面挂件用 */
  y?: number;
}

/** 路边停靠车（纯装饰）：视觉由 ChunkManager 按材质合并，碰撞盒在 boxes 里 */
export interface ParkedCarSpec {
  type: CarType;
  x: number;
  z: number;
  rotY: number;
}

export interface ChunkData {
  boxes: BoxInstance[];
  doors: DoorSpec[];
  stairs: StairZone[];
  props: PropSpec[];
  cars: ParkedCarSpec[];
}

/** 确定性伪随机（mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** chunk 坐标 → 稳定种子：同一 chunk 永远生成同一批楼 */
function chunkSeed(cx: number, cz: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ CITY_SEED) >>> 0;
}

/**
 * 生成一个 chunk（3×3 街区）的全部体块数据。
 * 分区：城市（地皮+楼+车道线）/ 沙滩（沙地+棕榈树）/ 海洋（下沉海床，水面由 ChunkManager 叠加）。
 * 纯函数、确定性，不碰 three/rapier。
 */
export function generateChunk(cx: number, cz: number): ChunkData {
  const rand = mulberry32(chunkSeed(cx, cz));
  const boxes: BoxInstance[] = [];
  const doors: DoorSpec[] = [];
  const stairs: StairZone[] = [];
  const props: PropSpec[] = [];
  const cars: ParkedCarSpec[] = [];
  const center = (CHUNK_BLOCKS - 1) / 2;
  const zone = chunkZone(cx);

  // 每 chunk 地基（顶面 = 0；海洋区下沉为海床）。
  // 厚度 4m：薄板会被高速坠落的刚体单步穿透（tunneling），厚地基 + 车辆 CCD 双保险
  const GROUND_THICK = 4;
  if (zone === 'ocean' && cx === COAST_CX - 1) {
    // 近岸 chunk：东侧 32m 可涉水浅滩，往外骤深进入游泳区
    boxes.push({
      x: cx * CHUNK_SIZE + CHUNK_SIZE / 2 - 16,
      z: cz * CHUNK_SIZE,
      w: 32,
      h: GROUND_THICK,
      d: CHUNK_SIZE,
      base: -0.3 - GROUND_THICK,
      color: SEABED,
      solid: true,
    });
    boxes.push({
      x: cx * CHUNK_SIZE - 16,
      z: cz * CHUNK_SIZE,
      w: 64,
      h: GROUND_THICK,
      d: CHUNK_SIZE,
      base: -1.6 - GROUND_THICK,
      color: SEABED,
      solid: true,
    });
  } else {
    const groundTop = zone === 'ocean' ? OCEAN_FLOOR_Y : 0;
    // 城市地基只做碰撞（视觉由路面标线贴图平面接管）
    boxes.push({
      x: cx * CHUNK_SIZE,
      z: cz * CHUNK_SIZE,
      w: CHUNK_SIZE,
      h: GROUND_THICK,
      d: CHUNK_SIZE,
      base: groundTop - GROUND_THICK,
      color: zone === 'beach' ? SAND : SEABED,
      solid: true,
      hidden: zone === 'city',
    });
  }

  if (zone === 'city') {
    // 每 chunk 随机一个街区放"街角商店"、另一个放"可上楼的塔楼"
    const nBlocks = CHUNK_BLOCKS * CHUNK_BLOCKS;
    const shopBlock = Math.floor(rand() * nBlocks);
    const towerBlock = (shopBlock + 1 + Math.floor(rand() * (nBlocks - 1))) % nBlocks;
    let blockIndex = 0;
    for (let bi = 0; bi < CHUNK_BLOCKS; bi++) {
      for (let bj = 0; bj < CHUNK_BLOCKS; bj++) {
        const x = cx * CHUNK_SIZE + (bi - center) * PITCH;
        const z = cz * CHUNK_SIZE + (bj - center) * PITCH;
        const special =
          blockIndex === shopBlock ? 'shop' : blockIndex === towerBlock ? 'tower' : null;
        generateBlockBuildings(rand, x, z, boxes, special, doors, stairs, props, cars);
        generateStreetLamps(x, z, boxes, props);
        generateTrafficSignal(x, z, boxes);
        blockIndex++;
      }
    }
  } else if (zone === 'beach') {
    // 真棕榈树 + 礁石（Kenney Nature Kit）
    const palms = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < palms; i++) {
      props.push({
        type: PALM_TYPES[Math.floor(rand() * PALM_TYPES.length)]!,
        x: cx * CHUNK_SIZE + (rand() - 0.5) * (CHUNK_SIZE - 10),
        z: cz * CHUNK_SIZE + (rand() - 0.5) * (CHUNK_SIZE - 10),
        rotY: rand() * Math.PI * 2,
      });
    }
    const rocks = 2 + Math.floor(rand() * 3);
    for (let i = 0; i < rocks; i++) {
      props.push({
        type: ROCK_TYPES[Math.floor(rand() * ROCK_TYPES.length)]!,
        x: cx * CHUNK_SIZE + (rand() - 0.5) * (CHUNK_SIZE - 8),
        z: cz * CHUNK_SIZE + (rand() - 0.5) * (CHUNK_SIZE - 8),
        rotY: rand() * Math.PI * 2,
      });
    }
  }
  return { boxes, doors, stairs, props, cars };
}

const PALM_TYPES = ['tree_palm', 'tree_palmBend', 'tree_palmDetailedTall', 'tree_palmDetailedShort'];
const ROCK_TYPES = ['rock_largeA', 'rock_largeC', 'rock_smallA', 'rock_smallE'];

/** 红绿灯：每街区一角，灯杆+灯箱实体，灯面为全城同步变色的 signal 体块 */
function generateTrafficSignal(blockX: number, blockZ: number, out: BoxInstance[]): void {
  const px = blockX + BLOCK_SIZE / 2 - 0.4;
  const pz = blockZ - (BLOCK_SIZE / 2 - 0.4);
  out.push({ x: px, z: pz, w: 0.12, h: 3.4, d: 0.12, base: PLOT_HEIGHT, color: 0x2c2e33, solid: true });
  out.push({
    x: px, z: pz, w: 0.34, h: 0.85, d: 0.26,
    base: PLOT_HEIGHT + 3.4, color: 0x1e1e22, solid: false,
  });
  out.push({
    x: px, z: pz - 0.14, w: 0.22, h: 0.62, d: 0.05,
    base: PLOT_HEIGHT + 3.5, color: 0x33dd55, solid: false, kind: 'signal',
  });
}

const LAMP_HEAD = 0xfff0b8;

const SHOP_SIZE = 7;
const SHOP_H = 3.4;
const SHOP_WALL = 0xcfc7b8;
const DOOR_HALF_GAP = 0.6; // 门洞半宽

/**
 * 可进入的街角商店：四面实心薄墙（前墙留门洞+门楣）+ 屋顶 + 柜台/货架 + 顶灯。
 * s 为朝向符号（前墙在 ±x 侧），门由 DoorSystem 单独渲染与开合。
 */
function generateShop(
  sx: number,
  sz: number,
  s: number,
  out: BoxInstance[],
  doors: DoorSpec[],
  props: PropSpec[],
  rand: () => number,
): void {
  const half = SHOP_SIZE / 2;
  const W = 0.15;
  const fx = sx + s * half; // 前墙 x
  const wall = (x: number, z: number, w: number, d: number, base: number, h: number): void => {
    out.push({ x, z, w, h, d, base, color: SHOP_WALL, solid: true });
  };
  // 后墙 + 两侧墙
  wall(sx - s * half, sz, W, SHOP_SIZE, PLOT_HEIGHT, SHOP_H);
  wall(sx, sz - half, SHOP_SIZE, W, PLOT_HEIGHT, SHOP_H);
  wall(sx, sz + half, SHOP_SIZE, W, PLOT_HEIGHT, SHOP_H);
  // 前墙：门洞两侧段 + 门楣
  const segD = half - DOOR_HALF_GAP;
  wall(fx, sz - DOOR_HALF_GAP - segD / 2, W, segD, PLOT_HEIGHT, SHOP_H);
  wall(fx, sz + DOOR_HALF_GAP + segD / 2, W, segD, PLOT_HEIGHT, SHOP_H);
  wall(fx, sz, W, DOOR_HALF_GAP * 2, PLOT_HEIGHT + 2.2, SHOP_H - 2.2);
  // 屋顶
  out.push({
    x: sx,
    z: sz,
    w: SHOP_SIZE + 0.2,
    h: 0.2,
    d: SHOP_SIZE + 0.2,
    base: PLOT_HEIGHT + SHOP_H,
    color: 0x6e6a63,
    solid: true,
  });
  // 内饰：柜台 + 两排货架（可碰撞）
  out.push({
    x: sx - s * 1.6,
    z: sz,
    w: 0.7,
    h: 1,
    d: 2.6,
    base: PLOT_HEIGHT,
    color: 0x7a5a38,
    solid: true,
  });
  for (const zs of [1, -1]) {
    out.push({
      x: sx,
      z: sz + zs * (half - 0.55),
      w: 2.6,
      h: 1.9,
      d: 0.5,
      base: PLOT_HEIGHT,
      color: 0x5d6a5d,
      solid: true,
    });
  }
  // 室内顶灯（夜里也亮）
  out.push({
    x: sx,
    z: sz,
    w: 1.4,
    h: 0.06,
    d: 1.4,
    base: PLOT_HEIGHT + SHOP_H - 0.25,
    color: 0xfff2cc,
    solid: false,
    kind: 'glow',
  });

  doors.push({ hx: fx, hz: sz - DOOR_HALF_GAP, swing: -s });

  // 门口人行道遮阳伞（街角咖啡感）
  const parasols = 1 + Math.floor(rand() * 2);
  for (let i = 0; i < parasols; i++) {
    props.push({
      type: rand() < 0.5 ? 'detail-parasol-a' : 'detail-parasol-b',
      x: fx + s * 1.8,
      z: sz + (i === 0 ? 2.2 : -2.4) + (rand() - 0.5),
      rotY: rand() * Math.PI * 2,
    });
  }
}

// 可上楼的塔楼（PUBG 式多层房）
const TW_SIZE = 9;
const TW_FLOORS = 3;
const TW_FH = 3; // 层高
const TW_WALL = 0.2;
const STAIR_X = -3.65; // 楼梯中线（局部坐标，沿背墙）
const STEP_D = 0.42;
const STEP_RISE = 0.3; // < KCC autostep 0.4，可直接走上去

/**
 * 三层可进塔楼：每层实体楼板（留楼梯口）、沿背墙的之字形实体台阶楼梯、
 * 每层顶灯+杂物箱、屋顶天台（女儿墙）、一层正门（DoorSystem 开合）。
 * 局部坐标建模（正面朝 +x），s=±1 做 x 镜像。
 */
function generateTower(
  rand: () => number,
  sx: number,
  sz: number,
  s: number,
  out: BoxInstance[],
  doors: DoorSpec[],
  stairs: StairZone[],
): void {
  const half = TW_SIZE / 2;
  const color = BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]!;
  const put = (
    lx: number,
    lz: number,
    w: number,
    d: number,
    base: number,
    h: number,
    c: number,
    extra?: Partial<BoxInstance>,
  ): void => {
    out.push({ x: sx + s * lx, z: sz + lz, w, d, h, base, color: c, solid: true, ...extra });
  };

  for (let f = 0; f < TW_FLOORS; f++) {
    const base = PLOT_HEIGHT + f * TW_FH;
    const m = f % 2 === 0 ? 1 : -1; // 楼梯方向逐层交替

    // 四面墙（带窗贴图；一层正面留门洞+门楣）
    put(-half, 0, TW_WALL, TW_SIZE, base, TW_FH, color, { windows: true });
    put(0, -half, TW_SIZE, TW_WALL, base, TW_FH, color, { windows: true });
    put(0, half, TW_SIZE, TW_WALL, base, TW_FH, color, { windows: true });
    if (f === 0) {
      const segD = half - 0.6;
      put(half, -(0.6 + segD / 2), TW_WALL, segD, base, TW_FH, color, { windows: true });
      put(half, 0.6 + segD / 2, TW_WALL, segD, base, TW_FH, color, { windows: true });
      put(half, 0, TW_WALL, 1.2, base + 2.2, TW_FH - 2.2, color, { windows: true });
    } else {
      put(half, 0, TW_WALL, TW_SIZE, base, TW_FH, color, { windows: true });
    }

    // 楼梯：台阶只做视觉；行走高度由 StairZone 高度场接管
    // （Rapier KCC 的 autostep/坡面过渡实测均不可靠——见楼梯无头测试）
    for (let i = 0; i < 10; i++) {
      const lz = m * (-2.9 + STEP_D / 2 + i * STEP_D);
      put(STAIR_X, lz, 1.3, STEP_D, base, STEP_RISE * (i + 1), 0x8d8d8d, { solid: false });
    }
    {
      const xa = sx + s * (STAIR_X - 0.65);
      const xb = sx + s * (STAIR_X + 0.65);
      const zf = sz + m * -2.9;
      const zt = sz + m * 1.3;
      // 区域覆盖整条楼梯井走廊：坡道两端外的部分被 clamp 成平台高度（天然的层间缓步台）
      stairs.push({
        x0: Math.min(xa, xb),
        x1: Math.max(xa, xb),
        z0: sz - half + 0.2,
        z1: sz + half - 0.2,
        zf,
        zt,
        base,
        top: base + TW_FH,
      });
    }

    // 顶灯 + 随机杂物箱
    put(0.6, 0, 1.4, 1.4, base + TW_FH - 0.22, 0.06, 0xfff2cc, { solid: false, kind: 'glow' });
    if (rand() < 0.8) {
      put(1 + rand() * 2, (rand() - 0.5) * 5, 0.8, 0.8, base, 0.8, 0x7a5a38);
    }

    // 上层楼板 / 屋顶：楼梯井整条贯通开洞（天井式楼梯间，杜绝爬升途中撞板穿模）
    const slabBase = base + TW_FH - 0.15;
    const slabColor = f === TW_FLOORS - 1 ? 0x6e6a63 : 0xbdb6a8;
    put(0.75, 0, 7.5, TW_SIZE, slabBase, 0.15, slabColor);
  }

  // 天台女儿墙
  const top = PLOT_HEIGHT + TW_FLOORS * TW_FH;
  put(-half, 0, TW_WALL, TW_SIZE, top, 0.8, color);
  put(half, 0, TW_WALL, TW_SIZE, top, 0.8, color);
  put(0, -half, TW_SIZE, TW_WALL, top, 0.8, color);
  put(0, half, TW_SIZE, TW_WALL, top, 0.8, color);

  doors.push({ hx: sx + s * half, hz: sz - 0.6, swing: -s });
}

/** 路灯：每街区对角两盏，Kenney 弧形灯杆模型（灯臂探向道路），保留夜间灯头光晕与地面光斑 */
function generateStreetLamps(
  blockX: number,
  blockZ: number,
  out: BoxInstance[],
  props: PropSpec[],
): void {
  for (const s of [1, -1]) {
    const px = blockX + s * (BLOCK_SIZE / 2 - 0.4);
    const pz = blockZ + s * (BLOCK_SIZE / 2 - 0.4);
    props.push({ type: 'light-curved', x: px, z: pz, rotY: (s * Math.PI) / 2 });
    out.push({
      x: px + s * 1.3,
      z: pz,
      w: 0.4,
      h: 0.1,
      d: 0.24,
      base: PLOT_HEIGHT + 4.35,
      color: LAMP_HEAD,
      solid: false,
      kind: 'glow',
    });
    // 夜间灯下光斑
    out.push({
      x: px + s * 1.3,
      z: pz,
      w: 9,
      h: 0,
      d: 9,
      base: 0.02,
      color: 0xffdf9e,
      solid: false,
      kind: 'pool',
    });
  }
}

const PROP_BUILDING_COUNT = 14; // building-a..n
const PROP_SKYSCRAPER_COUNT = 5; // building-skyscraper-a..e
const BUILDING_LETTERS = 'abcdefghijklmn';

/**
 * 单个街区：2×2 宅地随机取 2~4 块。普通宅地大多摆 Kenney 建筑模型
 * （低层商业楼/摩天楼），12% 保留程序化亮窗高塔撑夜景天际线；
 * special 指定本街区建商店或可进塔楼。
 */
const PARKED_TYPES: CarType[] = ['sedan', 'suv', 'taxi', 'hatchback-sports', 'suv-luxury', 'delivery'];

function generateBlockBuildings(
  rand: () => number,
  blockX: number,
  blockZ: number,
  out: BoxInstance[],
  special: 'shop' | 'tower' | null,
  doors: DoorSpec[],
  stairs: StairZone[],
  props: PropSpec[],
  cars: ParkedCarSpec[],
): void {
  const lots: Array<[number, number]> = [
    [-0.5, -0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
    [0.5, 0.5],
  ];
  for (let i = lots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [lots[i], lots[j]] = [lots[j]!, lots[i]!];
  }

  if (special) {
    const [li, lj] = lots.pop()!;
    const cx = blockX + li * LOT;
    const cz = blockZ + lj * LOT;
    const s = li > 0 ? 1 : -1;
    if (special === 'shop') generateShop(cx, cz, s, out, doors, props, rand);
    else generateTower(rand, cx, cz, s, out, doors, stairs);
  }

  const count = Math.min(2 + Math.floor(rand() * 3), lots.length); // 2..4

  // 没盖楼的宅地 → 露天停车位（GTA 街景标配：停靠车提升街道密度与生活感）
  for (const [li, lj] of lots.slice(count)) {
    if (rand() < 0.3) continue; // 三成留作真正的空地
    const cx = blockX + li * LOT;
    const cz = blockZ + lj * LOT;
    const n = 1 + Math.floor(rand() * 2);
    const alongZ = rand() < 0.5; // 整排车头统一沿 x 或沿 z（像画了车位线）
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * 2.7;
      const x = cx + (alongZ ? off : (rand() - 0.5) * 1.5);
      const z = cz + (alongZ ? (rand() - 0.5) * 1.5 : off);
      const rotY =
        (alongZ ? 0 : Math.PI / 2) + (rand() < 0.5 ? Math.PI : 0) + (rand() - 0.5) * 0.1;
      // 碰撞体不走盒子管线：ChunkManager 按车型挂真实几何凸包（人能站上引擎盖/车顶面）
      cars.push({ type: PARKED_TYPES[Math.floor(rand() * PARKED_TYPES.length)]!, x, z, rotY });
    }
  }

  for (const [li, lj] of lots.slice(0, count)) {
    const cx = blockX + li * LOT;
    const cz = blockZ + lj * LOT;

    const roll = rand();
    if (roll >= 0.55) {
      // Kenney 建筑模型（街边配角）：门面朝街区外侧
      const rotY = li > 0 ? Math.PI / 2 : -Math.PI / 2;
      const type =
        roll < 0.72
          ? `building-skyscraper-${BUILDING_LETTERS[Math.floor(rand() * PROP_SKYSCRAPER_COUNT)]}`
          : `building-${BUILDING_LETTERS[Math.floor(rand() * PROP_BUILDING_COUNT)]}`;
      props.push({ type, x: cx, z: cz, rotY });
      continue;
    }

    // 实拍幕墙楼（B3 主力）：四款幕墙轮换，中层/高层混合
    const w = LOT * (0.55 + rand() * 0.35);
    const d = LOT * (0.55 + rand() * 0.35);
    const x = cx + (rand() - 0.5) * (LOT - w); // 不越出宅地 = 不越退线
    const z = cz + (rand() - 0.5) * (LOT - d);
    const h = rand() < 0.45 ? 13 + rand() * 14 : 30 + rand() * 28;
    const facade = Math.floor(rand() * 4);
    const color = BUILDING_COLORS[Math.floor(rand() * BUILDING_COLORS.length)]!;
    out.push({ x, z, w, h, d, base: PLOT_HEIGHT, color, solid: true, windows: true, facade });

    // 裙楼：较高的楼 60% 概率带一圈更宽的深色临街底座（纯视觉）
    if (h > 15 && rand() < 0.6) {
      out.push({
        x,
        z,
        w: w + 0.9,
        d: d + 0.9,
        h: 3.2,
        base: PLOT_HEIGHT,
        color: 0x55504a,
        solid: false,
      });
    }

    // 屋顶设备：1~3 个小箱体（水箱/空调，纯视觉）
    const units = 1 + Math.floor(rand() * 3);
    for (let u = 0; u < units; u++) {
      out.push({
        x: x + (rand() - 0.5) * w * 0.5,
        z: z + (rand() - 0.5) * d * 0.5,
        w: 0.6 + rand() * 0.9,
        h: 0.5 + rand() * 0.9,
        d: 0.6 + rand() * 0.9,
        base: PLOT_HEIGHT + h,
        color: rand() < 0.5 ? 0x8d8d8d : 0x6e6a63,
        solid: false,
      });
    }

    if (h > 26 && rand() < 0.5) {
      out.push({
        x,
        z,
        w: w * 0.6,
        d: d * 0.6,
        h: 5 + rand() * 6,
        base: PLOT_HEIGHT + h,
        color,
        solid: true,
        windows: true,
        facade,
      });
    }
  }
}
