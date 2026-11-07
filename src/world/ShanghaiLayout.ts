import type { BoxInstance, ChunkData } from './City';

export const RIVER_WEST = 48;
export const RIVER_EAST = 144;
export const BRIDGE_Z = [-80, 112] as const;
export const PEARL = { x: 192, z: 0 };
export const SHANGHAI_SPAWN = { x: 16, z: 16 };

export function onBridge(z: number, margin = 0): boolean {
  return BRIDGE_Z.some(center => Math.abs(z - center) < 6 + margin);
}
export function isRiver(x: number, z: number): boolean {
  return x > RIVER_WEST && x < RIVER_EAST && !onBridge(z);
}
export function isShanghaiCore(cx: number, cz: number): boolean {
  return ((cx === 0 || cx === 2) && Math.abs(cz) <= 1) || (cx === -1 && cz === 0) || (cx === 2 && cz === 2);
}
export function districtName(x: number, z: number): string {
  if (x < -48 && x > -144 && Math.abs(z) < 48) return '里弄老街 · 海派生活';
  if (x >= 144 && x < 240 && z >= 144 && z < 240) return '浦东港区 · 仓储码头';
  if (x > RIVER_WEST && x < RIVER_EAST) return onBridge(z) ? '浦江大桥' : '黄浦江';
  return x < RIVER_WEST ? (x > -48 && Math.abs(z) < 144 ? '外滩 · 滨江街区' : '浦西 · 城市街区') :
    Math.hypot(x - PEARL.x, z - PEARL.z) < 38 ? '东方明珠 · 城市广场' : '陆家嘴 · 浦东';
}

/** AI remains on marked roads; pedestrian plazas are still drivable by the player. */
export function roadAvailable(x: number, z: number): boolean {
  if (x > 182 && x < 220 && z > 179 && z < 205) return false;
  if (onBridge(z, 1)) return true;
  if (x > 29 && x < 160) return false;
  if (x >= 160 && x < 231 && Math.abs(z) < 144) return false;
  return true;
}
export function safeRoadX(x: number, z: number): number {
  if (roadAvailable(x, z)) return x;
  return x < 96 ? 16 : Math.abs(z) < 144 ? 240 : 176;
}
export function safePedestrianBlockX(x: number, z: number): number {
  if (x >= 32 && x <= 224) return x < 96 ? 0 : Math.abs(z) < 160 ? 256 : 160;
  return x;
}

export function clearLootPosition(x: number, z: number): boolean {
  if (isRiver(x, z)) return false;
  if (Math.hypot(x - PEARL.x, z) < 17) return false;
  if (Math.abs(x - 216) < 11 && Math.abs(z + 101) < 11) return false;
  if (Math.abs(x - 228) < 11 && Math.abs(z - 48) < 11) return false;
  if (Math.abs(x - 206) < 11 && Math.abs(z - 81) < 8) return false;
  return true;
}

/** Custom central blocks share the normal chunk renderer and collision budget. */
export function generateShanghaiChunk(cx: number, cz: number): ChunkData {
  const data: ChunkData = { boxes: [], props: [], cars: [], stairs: [], doors: [] };
  const out = data.boxes;
  const ox = cx * 96, oz = cz * 96;
  const box = (x: number, z: number, w: number, d: number, h: number, base: number, color: number, solid = true): void => {
    out.push({ x, z, w, d, h, base, color, solid });
  };
  box(ox, oz, 96, 96, 4, -4, 0xb9b6a8);
  if (cx === -1 && cz === 0) {
    for (const x of [-144, -112, -80, -48]) box(x, 0, 8, 96, .015, .005, 0x42494a, false);
    for (const z of [-48, -16, 16, 48]) box(-96, z, 96, 8, .015, .005, 0x42494a, false);
    for (const x of [-128, -96, -64]) for (const z of [-32, 0, 32]) {
      if (x === -96 && z === 32) {
        box(-103, 32, .25, 13, 3.8, 0, 0x8c7160); box(-96, 25.5, 14, .25, 3.8, 0, 0x8c7160); box(-96, 38.5, 14, .25, 3.8, 0, 0x8c7160);
        for (const side of [-1, 1]) box(-89, 32 + side * 4.1, .25, 4.8, 3.8, 0, 0x8c7160);
        box(-96, 32, 14.5, 13.6, .25, 3.8, 0x554d45);
        box(-100, 34.5, 1, 4, 1.1, 0, 0x9d876b); box(-96, 37, 4, .8, 1, 0, 0x6c8776);
      } else {
        box(x, z, 19, 20, 6.8, 0, 0xa4806a); box(x, z, 20, 21, .3, 6.8, 0x514d49);
        for (const level of [1.5, 4.5]) for (const dx of [-6, -2, 2, 6]) box(x + dx, z + 10.06, 1.2, .1, 1.6, level, 0x3b5659, false);
        box(x + 9.7, z, .4, 2.4, 3.2, 0, 0x564d44, false);
      }
    }
    return data;
  }
  if (cx === 2 && cz === 2) {
    for (const x of [176, 240]) box(x, 192, 8, 96, .015, .005, 0x42494a, false);
    for (const z of [144, 176, 208, 240]) box(192, z, 96, 8, .015, .005, 0x42494a, false);
    box(213, 192, .35, 20, 6, 0, 0x657c82); for (const z of [182,202]) box(200, z, 26, .35, 6, 0, 0x657c82);
    for (const side of [-1, 1]) box(187, 192 + side * 6.2, .35, 7.6, 6, 0, 0x657c82);
    box(187, 192, .35, 4.8, 1.5, 4.5, 0x657c82); box(200, 192, 27, 21, .3, 6, 0x384e55);
    for (const x of [160,166]) for (const z of [158,166,220,228]) {
      box(x, z, 2.5, 6, 2.6, 0, x === 160 ? 0x527e83 : 0x9d654e);
      box(x, z, 2.55, 6.05, .12, 2.6, 0xa0a393);
    }
    for (const x of [152,168]) box(x, 191, .65, .65, 14, 0, 0xb09a59);
    box(160, 191, 17, .65, .7, 13.6, 0xb09a59); box(158, 191, .18, .18, 7, 6.6, 0x3b4c50);
    box(205, 196, 3, 3, 1.2, 0, 0x998465);
    return data;
  }
  // Continuous riverside paving and streets meet the existing 32 m road grid.
  if (cx === 0) {
    for (const x of [-48, -16, 16]) box(x, oz, 8, 96, .012, .003, 0x42494a, false);
    for (const z of [oz - 48, oz - 16, oz + 16, oz + 48]) box(-10, z, 76, 8, .012, .004, 0x42494a, false);
    box(38, oz, 20, 96, .025, .003, 0xc6c3b6, false);
    // Low quay wall, with openings at bridges and bathing stairs.
    for (let z = oz - 44; z <= oz + 44; z += 8) {
      if (onBridge(z, 4) || Math.abs(z - 48) < 9) continue;
      box(47, z, .65, 7.8, 1.05, 0, 0xaaa99d);
      box(46.8, z, .9, 7.8, .13, 1.05, 0xe1d8c5);
    }
    for (const x of [-32, 0]) for (const dz of [-32, 0, 32]) {
      const z = oz + dz;
      if (x === 0 && cz === 0 && dz === 32) { addConvenienceStore(out); continue; }
      addBundBuilding(out, x, z, 13 + ((Math.abs(z + x) / 32) % 3) * 3);
    }
    if (cz === 0) {
      data.cars.push({ type: 'sedan', x: 21, z: -30, rotY: 0 });
      data.cars.push({ type: 'taxi', x: -19, z: 45, rotY: Math.PI });
    }
  } else {
    // The eastern district is an open landmark plaza, with a boulevard at x=240.
    box(192, oz, 90, 96, .025, .003, 0xc5c4ba, false);
    box(238, oz, 4, 96, .015, .01, 0x42494a, false);
    for (const bridge of BRIDGE_Z) if (Math.abs(bridge - oz) <= 48) {
      box(192, bridge, 96, 12, .015, .01, 0x42494a, false);
    }
    for (let z = oz - 44; z <= oz + 44; z += 8) {
      if (onBridge(z, 4) || Math.abs(z - 48) < 9) continue;
      box(145, z, .65, 7.8, 1.05, 0, 0xaaa99d);
      box(145, z, .9, 7.8, .13, 1.05, 0xe1d8c5);
    }
    if (cz === 0) {
      data.cars.push({ type: 'suv', x: 231, z: 64, rotY: 0 });
      data.cars.push({ type: 'sedan-sports', x: 231, z: 76, rotY: 0 });
    }
  }
  return data;
}

function addBundBuilding(out: BoxInstance[], x: number, z: number, height: number): void {
  const put = (px: number, pz: number, w: number, d: number, h: number, base: number, color: number, solid = true): void => {
    out.push({ x: px, z: pz, w, d, h, base, color, solid });
  };
  put(x, z, 18, 18, height, 0, 0xc8bba2);
  put(x, z, 19.2, 19.2, .65, height, 0xe7dcc6);
  put(x, z, 18.8, 18.8, .45, 4.1, 0xe2d6bc, false);
  put(x, z, 18.8, 18.8, .4, height - 1.5, 0xe2d6bc, false);
  for (let level = 1; level < height / 3.1; level++) for (const offset of [-6, -2, 2, 6]) {
    put(x + 9.06, z + offset, .12, 1.7, 1.8, level * 3, 0x35464d, false);
    put(x + offset, z + 9.06, 1.7, .12, 1.8, level * 3, 0x35464d, false);
    put(x + offset, z - 9.06, 1.7, .12, 1.8, level * 3, 0x35464d, false);
  }
  for (const offset of [-7.5, -3.75, 0, 3.75, 7.5]) {
    put(x + 9.2, z + offset, .55, .55, 3.8, .25, 0xe2d7be, false);
  }
}

function addConvenienceStore(out: BoxInstance[]): void {
  const put = (x: number, z: number, w: number, d: number, h: number, base: number, color: number, solid = true): void => {
    out.push({ x, z, w, d, h, base, color, solid });
  };
  put(-9, 32, .3, 14, 4.3, 0, 0xc6c1b0);
  put(0, 25, 18, .3, 4.3, 0, 0xc6c1b0); put(0, 39, 18, .3, 4.3, 0, 0xc6c1b0);
  put(9, 27.9, .3, 5.8, 4.3, 0, 0x65776e); put(9, 36.1, .3, 5.8, 4.3, 0, 0x65776e);
  put(9, 32, .3, 2.4, 1, 3.3, 0x65776e);
  put(0, 32, 18.8, 14.8, .3, 4.3, 0xd9d0b9);
  put(0, 32, 18, 14, .035, .003, 0xd8d5c6, false);
  for (const z of [27.8, 36.2]) {
    put(-5, z, 2, 3, 1.4, 0, 0x6e7869);
    for (let i = 0; i < 3; i++) put(-4.8, z - 1 + i, 1.1, .45, .4, 1.4, [0xb98960, 0xa5b7a0, 0xbfb36d][i]!, false);
  }
  put(2, 37, 4, 1, 1.1, 0, 0x8b7f66);
}
