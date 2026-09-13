import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import {
  CHUNK_SIZE,
  COAST_CX,
  PLOT_HEIGHT,
  chunkZone,
  generateChunk,
  type BoxInstance,
  type ParkedCarSpec,
  type PropSpec,
  type StairZone,
} from './City';
import { DoorSystem } from './Doors';
import type { CarLibrary, PropLibrary } from '../core/Loader';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Collider = import('@dimforge/rapier3d-compat').Collider;

const LOAD_RADIUS = 2; // 加载 5×5 chunk（240m 见方）
const UNLOAD_RADIUS = 3; // 滞回：超出才卸载，防边界抖动
/**
 * 每帧碰撞体操作预算（创建+删除合计）。
 * 静态碰撞体的增删是 chunk 流式加载的真实开销来源——
 * 之前"整 chunk 一口气建/拆"会在跨界瞬间造成 40~280 次操作挤在一帧的顿挫。
 */
const COLLIDER_OPS_PER_FRAME = 20;

// 所有 chunk 共享的几何与材质
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const BOX_MATERIAL = new THREE.MeshStandardMaterial();
// 水面材质：Phong 高光出太阳粼光；近岸浅水偏青透亮、深水浓郁
const WATER_SHALLOW_MAT = new THREE.MeshPhongMaterial({
  color: 0x3b8aab,
  transparent: true,
  opacity: 0.55,
  shininess: 140,
  specular: 0xaaddee,
});
const WATER_DEEP_MAT = new THREE.MeshPhongMaterial({
  color: 0x1f5a82,
  transparent: true,
  opacity: 0.68,
  shininess: 120,
  specular: 0x88bbdd,
});
// 带分段的水面：顶点做波浪动画。波形空间频率取整周期，chunk 拼接处无缝
const WATER_GEO = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 24, 24);
const WATER_Y = -0.06;
// 岸边两道浪花带（近岸 chunk 东缘），透明度错相脉动模拟一波波拍岸
const FOAM_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xeef6f8,
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
const FOAM_MATERIAL_2 = new THREE.MeshBasicMaterial({
  color: 0xdceef2,
  transparent: true,
  opacity: 0.25,
  depthWrite: false,
});
const FOAM_GEO = new THREE.PlaneGeometry(4.5, CHUNK_SIZE);
const FOAM_GEO_2 = new THREE.PlaneGeometry(3, CHUNK_SIZE);

// 楼体墙面：ambientCG Facade018A 实拍摩天楼幕墙（CC0），含对齐的夜窗自发光贴图。
// 纵向平铺 3 次让层高落在合理范围；实例色相乘做楼与楼的色差。
function loadFacadeTex(name: string, srgb: boolean): THREE.Texture {
  const tex = new THREE.TextureLoader().load(`/textures/facade/${name}`);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  return tex;
}

const ROOF_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x6b625a });

/** 四款实拍幕墙（B3）：018A 现代幕墙（带夜窗自发光）+ 玻璃塔/办公楼/混凝土楼 */
interface FacadeSet {
  materials: THREE.Material[]; // BoxGeometry 六面材质组
  wall: THREE.MeshStandardMaterial;
  hasEmission: boolean;
}

function makeFacade(prefix: string, hasEmission: boolean, rough: number, metal: number): FacadeSet {
  const wall = new THREE.MeshStandardMaterial({
    map: loadFacadeTex(`${prefix}_color.jpg`, true),
    normalMap: loadFacadeTex(`${prefix}_normal.jpg`, false),
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: rough,
    metalness: metal,
  });
  if (hasEmission) {
    wall.emissive = new THREE.Color(0xffe9c4);
    wall.emissiveMap = loadFacadeTex(`${prefix}_emission.jpg`, true);
    wall.emissiveIntensity = 0;
  }
  return {
    materials: [wall, wall, ROOF_MATERIAL, ROOF_MATERIAL, wall, wall],
    wall,
    hasEmission,
  };
}

const FACADES: FacadeSet[] = [
  makeFacade('facade', true, 0.55, 0.15),
  makeFacade('facade1', false, 0.4, 0.3),
  makeFacade('facade2', false, 0.6, 0.1),
  makeFacade('facade3', false, 0.7, 0.05),
];

// 发光体（灯头）：Basic 材质不吃光照，夜里由 setCityNight 提亮
const GLOW_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x8a8578 });
// 灯下光斑：径向渐变贴图 + 加色混合，白天透明度 0
function makePoolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
const POOL_MATERIAL = new THREE.MeshBasicMaterial({
  map: makePoolTexture(),
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const POOL_GEO = new THREE.PlaneGeometry(1, 1);
POOL_GEO.rotateX(-Math.PI / 2);

/** 全局夜色（0 白天 ~ 1 深夜）：窗灯、路灯灯头、地面光斑 */
export function setCityNight(n: number): void {
  for (const f of FACADES) {
    if (f.hasEmission) f.wall.emissiveIntensity = 1.05 * n; // 略过 HDR 阈值，柔和参与辉光
  }
  GLOW_MATERIAL.color.setScalar(0.5 + 1.0 * n);
  POOL_MATERIAL.opacity = 0.38 * n;
}

/** 湿度（下雨）：路面变深变亮反光，出现太阳/月光高光条 */
export function setCityWetness(w: number): void {
  CITY_GROUND_MAT.roughness = 0.95 - 0.72 * w;
  CITY_GROUND_MAT.color.setScalar(1 - 0.32 * w);
}

// 交通信号灯：全城同步循环（绿 4.5s → 黄 1.2s → 红 4.5s）
const SIGNAL_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x33dd55 });

/** intensity>1 时颜色进入 HDR 超亮区，夜里参与 Bloom 辉光 */
export function updateCitySignals(time: number, intensity = 1): void {
  const t = time % 10.2;
  SIGNAL_MATERIAL.color
    .setHex(t < 4.5 ? 0x33dd55 : t < 5.7 ? 0xffcc33 : 0xff3333)
    .multiplyScalar(intensity);
}

/**
 * 城市路面贴图（96m 一格，跨 chunk 无缝周期）。
 * 底材来自 ambientCG 实拍 PBR（CC0）：沥青 Asphalt031 + 人行道 PavingStones128，
 * 先画程序化占位（贴图加载完成后重绘合成），标线（双黄线/斑马线/路缘）叠加在真实材质上。
 */
function makeRoadTexture(): THREE.CanvasTexture {
  const S = 2048;
  const m2p = S / CHUNK_SIZE;
  const c = (v: number): number => (v + CHUNK_SIZE / 2) * m2p;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;

  const drawMarkings = (): void => {
    // 路缘 + 人行道砖缝弱线（真实铺装贴图之上仅加路缘）
    for (let bi = 0; bi < 3; bi++) {
      for (let bj = 0; bj < 3; bj++) {
        const x0 = c((bi - 1) * 32 - 12);
        const z0 = c((bj - 1) * 32 - 12);
        g.strokeStyle = 'rgba(70,68,64,0.85)';
        g.lineWidth = 6;
        g.strokeRect(x0, z0, 24 * m2p, 24 * m2p);
      }
    }
    // 双黄虚线
    g.fillStyle = 'rgba(217,177,59,0.92)';
    const dashW = Math.max(3, 0.16 * m2p);
    for (const line of [-48, -16, 16, 48]) {
      for (let v = -48; v < 48; v += 4) {
        g.fillRect(c(line) - dashW - 2, c(v), dashW, 2 * m2p);
        g.fillRect(c(line) + 2, c(v), dashW, 2 * m2p);
        g.fillRect(c(v), c(line) - dashW - 2, 2 * m2p, dashW);
        g.fillRect(c(v), c(line) + 2, 2 * m2p, dashW);
      }
    }
    // 斑马线（微透，让沥青纹理透出来，像磨损的漆）
    g.fillStyle = 'rgba(233,232,226,0.88)';
    const bar = 0.45 * m2p;
    for (const ix of [-48, -16, 16, 48]) {
      for (const iz of [-48, -16, 16, 48]) {
        for (let k = 0; k < 7; k++) {
          const off = (k - 3) * 1.05 * m2p;
          g.fillRect(c(ix) + off - bar / 2, c(iz - 5.6), bar, 1.8 * m2p);
          g.fillRect(c(ix) + off - bar / 2, c(iz + 3.8), bar, 1.8 * m2p);
          g.fillRect(c(ix - 5.6), c(iz) + off - bar / 2, 1.8 * m2p, bar);
          g.fillRect(c(ix + 3.8), c(iz) + off - bar / 2, 1.8 * m2p, bar);
        }
      }
    }
  };

  // 占位底色（贴图到达前的一两帧）
  g.fillStyle = '#43454a';
  g.fillRect(0, 0, S, S);
  drawMarkings();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  // 异步合成真实材质：沥青全铺（8m/瓦）→ 人行道铺装（4m/瓦）→ 标线
  const asphaltImg = new Image();
  const pavingImg = new Image();
  let loaded = 0;
  const onLoad = (): void => {
    if (++loaded < 2) return;
    const asphalt = g.createPattern(asphaltImg, 'repeat')!;
    asphalt.setTransform(new DOMMatrix().scale((8 * m2p) / asphaltImg.width));
    g.fillStyle = asphalt;
    g.fillRect(0, 0, S, S);

    const paving = g.createPattern(pavingImg, 'repeat')!;
    paving.setTransform(new DOMMatrix().scale((4 * m2p) / pavingImg.width));
    g.fillStyle = paving;
    for (let bi = 0; bi < 3; bi++) {
      for (let bj = 0; bj < 3; bj++) {
        g.fillRect(c((bi - 1) * 32 - 12), c((bj - 1) * 32 - 12), 24 * m2p, 24 * m2p);
      }
    }
    drawMarkings();
    tex.needsUpdate = true;
  };
  asphaltImg.onload = onLoad;
  pavingImg.onload = onLoad;
  asphaltImg.src = '/textures/ground/asphalt_color.jpg';
  pavingImg.src = '/textures/ground/paving_color.jpg';

  return tex;
}

/** 沥青法线贴图：独立平铺（8m/瓦），车灯/夜灯下路面有凹凸反应 */
function makeRoadNormal(): THREE.Texture {
  const tex = new THREE.TextureLoader().load('/textures/ground/asphalt_normal.jpg');
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(CHUNK_SIZE / 8, CHUNK_SIZE / 8);
  return tex;
}

const CITY_GROUND_MAT = new THREE.MeshStandardMaterial({
  map: makeRoadTexture(),
  normalMap: makeRoadNormal(),
  normalScale: new THREE.Vector2(0.55, 0.55),
  roughness: 0.95,
});
const CITY_GROUND_GEO = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
CITY_GROUND_GEO.rotateX(-Math.PI / 2);

/**
 * 单个 chunk：视觉（一个 InstancedMesh，创建即显示）与碰撞体（分帧渐进创建）。
 * 视觉先行、碰撞体在 1~2 帧内补齐——玩家开到跟前之前早已就位（加载半径 240m）。
 */
class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly mesh: THREE.InstancedMesh;
  private readonly extraMeshes: THREE.InstancedMesh[] = [];
  private readonly propMeshes: THREE.Mesh[] = [];
  private cityGround: THREE.Mesh | null = null;
  readonly colliders: Collider[] = [];
  /** 停靠车固定刚体（随 chunk 销毁；removeRigidBody 连带移除其碰撞体） */
  private readonly parkedBodies: import('@dimforge/rapier3d-compat').RigidBody[] = [];
  readonly parkedCars: Array<{ spec: ParkedCarSpec; taken: boolean; hide: () => void }> = [];
  private readonly pending: BoxInstance[];
  private readonly water: THREE.Mesh | null = null;
  private readonly foam: THREE.Mesh | null = null;
  private readonly foam2: THREE.Mesh | null = null;
  /** 已出队列等待销毁（防止 build/dispose 队列双重处理） */
  dead = false;

  constructor(
    scene: THREE.Scene,
    physics: Physics,
    cx: number,
    cz: number,
    boxes: BoxInstance[],
    props: PropSpec[],
    propLib: PropLibrary,
    cars: ParkedCarSpec[],
    carLib: CarLibrary,
  ) {
    this.cx = cx;
    this.cz = cz;

    // 路边停靠车：几何按材质合并成每 chunk 一两个 mesh（几十辆车不吃 draw call）；
    // 碰撞 = 固定刚体 + 该车型实测双盒（数量少，直接创建不走分帧预算），随 chunk 销毁
    if (cars.length > 0) {
      for (const c of cars) {
        const body = physics.world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed()
            .setTranslation(c.x, PLOT_HEIGHT, c.z)
            .setRotation({ x: 0, y: Math.sin(c.rotY / 2), z: 0, w: Math.cos(c.rotY / 2) }),
        );
        const spec = carLib.colliderBoxes(c.type);
        for (const b of [spec.body, spec.cabin]) {
          if (!b) continue;
          physics.world.createCollider(
            RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(0, b.cy, b.cz),
            body,
          );
        }
        this.parkedBodies.push(body);
      }
      const batches = new Map<THREE.BufferGeometry, Map<THREE.Material, THREE.Matrix4[]>>();
      const m = new THREE.Matrix4();
      for (const c of cars) {
        for (const part of carLib.bakedParts(c.type)) {
          m.makeRotationY(c.rotY).setPosition(c.x, PLOT_HEIGHT, c.z);
          let byMaterial = batches.get(part.geometry);
          if (!byMaterial) batches.set(part.geometry, (byMaterial = new Map()));
          let list = byMaterial.get(part.material);
          if (!list) byMaterial.set(part.material, (list = []));
          list.push(m.clone());
        }
      }
      for (const [geometry, byMaterial] of batches) for (const [mat, matrices] of byMaterial) {
        const mesh = new THREE.InstancedMesh(geometry, mat, matrices.length);
        matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        this.extraMeshes.push(mesh); // 只释放实例缓冲；车型几何和材质由模型库共享。
      }
      for (let i = 0; i < cars.length; i++) {
        const spec = cars[i]!, body = this.parkedBodies[i]!;
        const entries: Array<{ mesh: THREE.InstancedMesh; index: number }> = [];
        for (const mesh of this.extraMeshes) for (let n = 0; n < mesh.count; n++) {
          mesh.getMatrixAt(n, m);
          if (Math.abs(m.elements[12]! - spec.x) < .01 && Math.abs(m.elements[14]! - spec.z) < .01) entries.push({ mesh, index: n });
        }
        this.parkedCars.push({ spec, taken: false, hide: () => {
          body.setEnabled(false);
          for (const entry of entries) {
            entry.mesh.setMatrixAt(entry.index, new THREE.Matrix4().makeScale(0, 0, 0));
            entry.mesh.instanceMatrix.needsUpdate = true;
          }
        } });
      }
    }

    // GLB 道具（建筑/路灯/植被）：按材质键合并成每 chunk 少量 mesh
    if (props.length > 0) {
      const byKey = new Map<string, THREE.BufferGeometry[]>();
      const m = new THREE.Matrix4();
      for (const p of props) {
        const def = propLib.def(p.type);
        for (const part of def.parts) {
          const g = part.geometry.clone();
          m.makeRotationY(p.rotY);
          m.setPosition(p.x, p.y ?? PLOT_HEIGHT, p.z);
          g.applyMatrix4(m);
          let list = byKey.get(part.matKey);
          if (!list) byKey.set(part.matKey, (list = []));
          list.push(g);
        }
      }
      for (const [matKey, geos] of byKey) {
        const merged = mergeGeometries(geos)!;
        for (const g of geos) g.dispose();
        const mesh = new THREE.Mesh(merged, propLib.material(matKey));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
        this.propMeshes.push(mesh);
      }
    }

    // 城市区：路面标线贴图平面（人行道/车道虚线/斑马线画在贴图里）
    if (chunkZone(cx) === 'city') {
      this.cityGround = new THREE.Mesh(CITY_GROUND_GEO, CITY_GROUND_MAT);
      this.cityGround.position.set(cx * CHUNK_SIZE, 0.004, cz * CHUNK_SIZE);
      this.cityGround.receiveShadow = true;
      scene.add(this.cityGround);
    }

    if (chunkZone(cx) === 'ocean') {
      const nearShore = cx === COAST_CX - 1;
      this.water = new THREE.Mesh(WATER_GEO, nearShore ? WATER_SHALLOW_MAT : WATER_DEEP_MAT);
      this.water.rotation.x = -Math.PI / 2;
      this.water.position.set(cx * CHUNK_SIZE, WATER_Y, cz * CHUNK_SIZE);
      scene.add(this.water);

      if (nearShore) {
        // 两道错相浪花带贴在与沙滩交界处
        this.foam = new THREE.Mesh(FOAM_GEO, FOAM_MATERIAL);
        this.foam.rotation.x = -Math.PI / 2;
        this.foam.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2 - 2, -0.01, cz * CHUNK_SIZE);
        scene.add(this.foam);
        this.foam2 = new THREE.Mesh(FOAM_GEO_2, FOAM_MATERIAL_2);
        this.foam2.rotation.x = -Math.PI / 2;
        this.foam2.position.set(cx * CHUNK_SIZE + CHUNK_SIZE / 2 - 9, 0.0, cz * CHUNK_SIZE);
        scene.add(this.foam2);
      }
    }

    const fill = (mesh: THREE.InstancedMesh, list: BoxInstance[]): void => {
      const m = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      const color = new THREE.Color();
      list.forEach((b, i) => {
        pos.set(b.x, b.base + b.h / 2, b.z);
        scale.set(b.w, b.h, b.d);
        m.compose(pos, quat, scale);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.setHex(b.color));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      scene.add(mesh);
    };

    // 按渲染类别拆 InstancedMesh：普通体块 / 楼体（按幕墙分组） / 发光体 / 光斑 / 信号灯；hidden 不渲染
    const plain = boxes.filter((b) => !b.windows && !b.kind && !b.hidden);
    const glows = boxes.filter((b) => b.kind === 'glow');
    const pools = boxes.filter((b) => b.kind === 'pool');
    const signals = boxes.filter((b) => b.kind === 'signal');
    this.mesh = new THREE.InstancedMesh(UNIT_BOX, BOX_MATERIAL, plain.length);
    fill(this.mesh, plain);
    for (let f = 0; f < FACADES.length; f++) {
      const group = boxes.filter((b) => b.windows && (b.facade ?? 0) % FACADES.length === f);
      if (group.length === 0) continue;
      const mesh = new THREE.InstancedMesh(UNIT_BOX, FACADES[f]!.materials, group.length);
      fill(mesh, group);
      this.extraMeshes.push(mesh);
    }
    if (glows.length > 0) {
      const glowMesh = new THREE.InstancedMesh(UNIT_BOX, GLOW_MATERIAL, glows.length);
      fill(glowMesh, glows);
      glowMesh.castShadow = false;
      this.extraMeshes.push(glowMesh);
    }
    if (pools.length > 0) {
      const poolMesh = new THREE.InstancedMesh(POOL_GEO, POOL_MATERIAL, pools.length);
      fill(poolMesh, pools);
      poolMesh.castShadow = false;
      poolMesh.receiveShadow = false;
      this.extraMeshes.push(poolMesh);
    }
    if (signals.length > 0) {
      const signalMesh = new THREE.InstancedMesh(UNIT_BOX, SIGNAL_MATERIAL, signals.length);
      fill(signalMesh, signals);
      signalMesh.castShadow = false;
      this.extraMeshes.push(signalMesh);
    }

    // 倒序存放：buildColliders 用 pop() 从尾部取，而地基体块是 generateChunk 第一个
    // push 的——倒序后地面碰撞体最先创建。否则高速驶入新 chunk 时地面最后才就位，车会漏下去
    this.pending = boxes.filter((b) => b.solid).reverse();
  }

  get colliderDone(): boolean {
    return this.pending.length === 0;
  }

  get hasWater(): boolean {
    return this.water !== null;
  }

  /** 建最多 budget 个碰撞体，返回消耗的预算 */
  buildColliders(physics: Physics, budget: number): number {
    let used = 0;
    while (this.pending.length > 0 && used < budget) {
      const b = this.pending.pop()!;
      const desc = RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(
        b.x,
        b.base + b.h / 2,
        b.z,
      );
      if (b.rotX) {
        desc.setRotation({ x: Math.sin(b.rotX / 2), y: 0, z: 0, w: Math.cos(b.rotX / 2) });
      }
      this.colliders.push(physics.world.createCollider(desc));
      used++;
    }
    return used;
  }

  /** 拆最多 budget 个碰撞体；全部拆完后释放视觉并返回 done */
  disposeSome(scene: THREE.Scene, physics: Physics, budget: number): { used: number; done: boolean } {
    this.pending.length = 0; // 未建的不再建
    let used = 0;
    while (this.colliders.length > 0 && used < budget) {
      physics.world.removeCollider(this.colliders.pop()!, false);
      used++;
    }
    if (this.colliders.length === 0) {
      for (const b of this.parkedBodies) physics.world.removeRigidBody(b);
      this.parkedBodies.length = 0;
      scene.remove(this.mesh);
      this.mesh.dispose();
      for (const m of this.extraMeshes) {
        scene.remove(m);
        m.dispose();
      }
      for (const m of this.propMeshes) {
        scene.remove(m);
        m.geometry.dispose(); // 合并几何是本 chunk 专属的；材质共享不释放
      }
      if (this.cityGround) scene.remove(this.cityGround); // 几何/材质全局共享
      if (this.water) scene.remove(this.water);
      if (this.foam) scene.remove(this.foam);
      if (this.foam2) scene.remove(this.foam2);
      return { used, done: true };
    }
    return { used, done: false };
  }
}

/**
 * 分块加载：以玩家为中心维持 (2·LOAD_RADIUS+1)² 个 chunk。
 * 视觉即时增删（便宜），碰撞体增删走每帧预算（平滑），
 * 沥青地面是一整块跟随玩家的平面（跨格吸附时才移动）。
 */
export class ChunkManager {
  private readonly takenCars = new Set<string>();

  nearestParked(pos: THREE.Vector3, range: number): { x: number; y: number; z: number; yaw: number; type: ParkedCarSpec['type']; take: () => boolean } | null {
    let result = null, best = range;
    for (const chunk of this.chunks.values()) for (const car of chunk.parkedCars) {
      if (car.taken || chunk.dead) continue;
      const d = Math.hypot(pos.x - car.spec.x, pos.z - car.spec.z);
      if (d >= best || Math.abs(pos.y - PLOT_HEIGHT) > 3) continue;
      best = d;
      result = { x: car.spec.x, y: PLOT_HEIGHT, z: car.spec.z, yaw: car.spec.rotY, type: car.spec.type, take: () => {
        if (car.taken || chunk.dead) return false;
        car.taken = true; car.hide();
        this.takenCars.add(`${car.spec.x},${car.spec.z}`);
        return true;
      } };
    }
    return result;
  }
  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly chunks = new Map<string, Chunk>();
  private readonly buildQueue: Chunk[] = [];
  private readonly disposeQueue: Chunk[] = [];
  private readonly stairZones = new Map<string, StairZone[]>();
  private readonly propLib: PropLibrary;
  private readonly carLib: CarLibrary;
  private waterChunks = 0;
  readonly doors: DoorSystem;

  constructor(
    scene: THREE.Scene,
    physics: Physics,
    initialPos: THREE.Vector3,
    propLib: PropLibrary,
    carLib: CarLibrary,
  ) {
    this.scene = scene;
    this.physics = physics;
    this.propLib = propLib;
    this.carLib = carLib;
    this.doors = new DoorSystem(scene, physics);

    // 地面由每个 chunk 的地基体块负责（见 City.generateChunk），无全局地面
    // 初始加载不限预算，出生时全部就位
    this.update(initialPos, Infinity);
  }

  /** 每帧调用 */
  update(playerPos: THREE.Vector3, budget: number = COLLIDER_OPS_PER_FRAME): void {
    const pcx = Math.round(playerPos.x / CHUNK_SIZE);
    const pcz = Math.round(playerPos.z / CHUNK_SIZE);

    // 出界 → 标记死亡进销毁队列（门即刻移除，数量少）
    for (const [key, chunk] of this.chunks) {
      if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cz - pcz)) > UNLOAD_RADIUS) {
        this.chunks.delete(key);
        this.doors.removeChunkDoors(key);
        this.stairZones.delete(key);
        chunk.dead = true;
        this.disposeQueue.push(chunk);
      }
    }

    // 补加载（视觉即时创建，碰撞体入队）。
    // 游戏中每帧最多新建 1 个 chunk：generateChunk + 道具几何合并是同步大活，
    // 跨界瞬间一口气建 5 个会挤出一帧 20ms+ 的尖刺；加载半径 240m，分帧补齐绰绰有余。
    let creates = budget === Infinity ? Infinity : 1;
    outer: for (let r = 0; r <= LOAD_RADIUS; r++) {
      for (let cx = pcx - r; cx <= pcx + r; cx++) {
        for (let cz = pcz - r; cz <= pcz + r; cz++) {
          if (Math.max(Math.abs(cx - pcx), Math.abs(cz - pcz)) !== r) continue;
          const key = `${cx},${cz}`;
          if (this.chunks.has(key)) continue;
          if (creates <= 0) break outer;
          creates--;
          const data = generateChunk(cx, cz);
          data.cars = data.cars.filter(c => !this.takenCars.has(`${c.x},${c.z}`));
          this.decorateBuildings(data);
          this.injectPropColliders(data);
          const chunk = new Chunk(this.scene, this.physics, cx, cz, data.boxes, data.props, this.propLib, data.cars, this.carLib);
          if (chunk.hasWater) this.waterChunks++;
          this.chunks.set(key, chunk);
          this.buildQueue.push(chunk);
          this.doors.addChunkDoors(key, data.doors);
          if (data.stairs.length > 0) this.stairZones.set(key, data.stairs);
        }
      }
    }

    // 花预算：先建（玩家正在靠近的），后拆（已远离的）
    let remaining = budget;
    while (remaining > 0 && this.buildQueue.length > 0) {
      const chunk = this.buildQueue[0]!;
      if (chunk.dead) {
        this.buildQueue.shift();
        continue;
      }
      remaining -= chunk.buildColliders(this.physics, remaining);
      if (chunk.colliderDone) this.buildQueue.shift();
    }
    while (remaining > 0 && this.disposeQueue.length > 0) {
      const chunk = this.disposeQueue[0]!;
      const r = chunk.disposeSome(this.scene, this.physics, remaining);
      remaining -= r.used;
      if (r.done) {
        if (chunk.hasWater) this.waterChunks--;
        this.disposeQueue.shift();
      }
    }
  }

  /**
   * B2 楼体分层细节：给 Kenney 楼群追加临街雨棚/挑檐、屋顶设备与女儿墙、
   * 夜里发光的店招牌，商店街角加遮阳伞。按坐标哈希确定性生成。
   */
  private decorateBuildings(data: { boxes: BoxInstance[]; props: PropSpec[] }): void {
    const SIGN_COLORS = [0xff5548, 0x4db4ff, 0xffd24d, 0xff7fc2, 0x5dffb0, 0xffffff];
    const count = data.props.length; // 只遍历原始建筑，追加的装饰不再迭代
    for (let i = 0; i < count; i++) {
      const p = data.props[i]!;
      const def = this.propLib.def(p.type);
      if (def.kit !== 'buildings' || p.type.startsWith('detail-')) continue;

      // 坐标哈希伪随机（确定性）
      let seed = (Math.imul(Math.round(p.x * 7), 73856093) ^ Math.imul(Math.round(p.z * 7), 19349663)) >>> 0;
      const rnd = (): number => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const dirX = Math.sin(p.rotY);
      const dirZ = Math.cos(p.rotY);
      const depth = Math.abs(dirX) > 0.5 ? def.size.x : def.size.z;
      const width = Math.abs(dirX) > 0.5 ? def.size.z : def.size.x;
      const fx = p.x + dirX * (depth / 2 + 0.12);
      const fz = p.z + dirZ * (depth / 2 + 0.12);
      const isTower = p.type.includes('skyscraper');

      // 临街雨棚/挑檐（低层楼 60%）
      if (!isTower && rnd() < 0.6) {
        const wide = width > 6.5 && rnd() < 0.5;
        const kind = rnd() < 0.5 ? 'detail-awning' : 'detail-overhang';
        data.props.push({
          type: wide ? `${kind}-wide` : kind,
          x: fx,
          z: fz,
          rotY: p.rotY,
          y: PLOT_HEIGHT + 2.55,
        });
      }

      // 屋顶设备 + 女儿墙
      const roof = PLOT_HEIGHT + def.size.y;
      const units = 1 + Math.floor(rnd() * 2);
      for (let u = 0; u < units; u++) {
        data.boxes.push({
          x: p.x + (rnd() - 0.5) * width * 0.45,
          z: p.z + (rnd() - 0.5) * depth * 0.45,
          w: 0.7 + rnd() * 0.8,
          h: 0.5 + rnd() * 0.8,
          d: 0.7 + rnd() * 0.8,
          base: roof,
          color: rnd() < 0.5 ? 0x9a9a98 : 0x77726b,
          solid: false,
        });
      }
      if (isTower || rnd() < 0.5) {
        data.boxes.push({
          x: p.x, z: p.z,
          w: width * 0.98, h: 0.5, d: depth * 0.98,
          base: roof - 0.05, color: 0x8a8378, solid: false,
        });
      }

      // 发光店招牌（低层楼 45%）：竖挂在门面上，夜里参与辉光
      if (!isTower && rnd() < 0.45) {
        const along = Math.abs(dirX) > 0.5;
        const off = (rnd() - 0.5) * width * 0.5;
        data.boxes.push({
          x: fx + (along ? 0 : off),
          z: fz + (along ? off : 0),
          w: along ? 0.22 : 1.5,
          d: along ? 1.5 : 0.22,
          h: 2.2,
          base: PLOT_HEIGHT + Math.min(def.size.y * 0.4, 4.2),
          color: SIGN_COLORS[Math.floor(rnd() * SIGN_COLORS.length)]!,
          solid: false,
          kind: 'glow',
        });
      }
    }
  }

  /** GLB 道具 → 追加隐形碰撞盒（走既有的预算制创建管线） */
  private injectPropColliders(data: { boxes: BoxInstance[]; props: PropSpec[] }): void {
    for (const p of data.props) {
      const def = this.propLib.def(p.type);
      if (p.type.startsWith('detail-')) continue; // 雨棚/遮阳伞等装饰不做碰撞
      if (def.kit === 'props') {
        // 路灯：只有细杆碰撞
        data.boxes.push({
          x: p.x, z: p.z, w: 0.24, h: 4.6, d: 0.24,
          base: PLOT_HEIGHT, color: 0, solid: true, hidden: true,
        });
      } else if (def.kit === 'nature' && p.type.startsWith('tree_')) {
        // 树：只有树干碰撞——整树 AABB 会在人行道/沙滩立起一堵看不见的大墙
        data.boxes.push({
          x: p.x, z: p.z, w: 0.35, h: def.size.y, d: 0.35,
          base: PLOT_HEIGHT, color: 0, solid: true, hidden: true,
        });
      } else {
        // 建筑：整体 AABB（rotY 为 ±90° 时对调宽深）
        const swap = Math.abs(Math.sin(p.rotY)) > 0.5;
        data.boxes.push({
          x: p.x, z: p.z,
          w: swap ? def.size.z : def.size.x,
          d: swap ? def.size.x : def.size.z,
          h: def.size.y,
          base: PLOT_HEIGHT, color: 0, solid: true, hidden: true,
        });
      }
    }
  }

  /**
   * 楼梯高度场查询：(x,z) 落在某楼梯区时返回该处行走高度，否则 null。
   * 多层楼梯同一平面重叠时，取"脚底高度不超过角色当前高度太多"的最高一层。
   */
  stairHeightAt(x: number, z: number, feetY: number): number | null {
    const key = `${Math.round(x / CHUNK_SIZE)},${Math.round(z / CHUNK_SIZE)}`;
    const zones = this.stairZones.get(key);
    if (!zones) return null;
    let best: number | null = null;
    for (const s of zones) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      const t = Math.min(1, Math.max(0, (z - s.zf) / (s.zt - s.zf)));
      const h = s.base + t * (s.top - s.base);
      if (h <= feetY + 0.7 && (best === null || h > best)) best = h;
    }
    return best;
  }

  /** 每帧调用：海面波浪顶点动画（几何共享，所有海洋 chunk 同步起伏且接缝连续）+ 浪花脉动 */
  animateWater(time: number): void {
    // 城市深处没有任何海面可见时整段跳过（625 顶点 + 法线是纯浪费）
    if (this.waterChunks === 0) return;
    const pos = WATER_GEO.attributes.position!;
    const normal = WATER_GEO.attributes.normal!;
    const tau = Math.PI * 2;
    const S = CHUNK_SIZE;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // 相位取负号 → 波峰随时间向 +x（岸边）推进
      const a = (x / S) * tau * 3 - time * 1.4;
      const b = ((x + y) / S) * tau * 2 - time;
      const c = (y / S) * tau * 5 + time * 2.1;
      pos.setZ(i, 0.22 * Math.sin(a) + 0.12 * Math.sin(b) + 0.1 * Math.sin(c));
      // 高度是正弦和，偏导有闭式解——解析法线比 computeVertexNormals
      //（逐三角形叉积再平均归一）便宜一个量级，且更精确
      const dhdx = (0.22 * Math.cos(a) * 3 + 0.12 * Math.cos(b) * 2) * (tau / S);
      const dhdy = (0.12 * Math.cos(b) * 2 + 0.1 * Math.cos(c) * 5) * (tau / S);
      const inv = 1 / Math.sqrt(dhdx * dhdx + dhdy * dhdy + 1);
      normal.setXYZ(i, -dhdx * inv, -dhdy * inv, inv);
    }
    pos.needsUpdate = true;
    normal.needsUpdate = true;

    // 拍岸浪花：两道错相呼吸，模拟一波接一波
    FOAM_MATERIAL.opacity = 0.28 + 0.24 * (0.5 + 0.5 * Math.sin(time * 1.6));
    FOAM_MATERIAL_2.opacity = 0.1 + 0.2 * (0.5 + 0.5 * Math.sin(time * 1.6 - 1.8));
  }
}
