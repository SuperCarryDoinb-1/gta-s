import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

/**
 * 车辆模型库（Kenney Car Kit，CC0，见 ASSETS.md）。
 * 启动时全部预载；模板统一缩放到目标车长、底面对齐地面，clone 共享几何/材质。
 */

export type CarType =
  | 'sedan'
  | 'sedan-sports'
  | 'suv'
  | 'suv-luxury'
  | 'taxi'
  | 'hatchback-sports'
  | 'police'
  | 'delivery';

const ALL_CAR_TYPES: CarType[] = [
  'sedan',
  'sedan-sports',
  'suv',
  'suv-luxury',
  'taxi',
  'hatchback-sports',
  'police',
  'delivery',
];

/** 交通车随机池（玩家初始车型不在池里，便于识别自己的车） */
export const TRAFFIC_TYPES: CarType[] = [
  'sedan',
  'suv',
  'taxi',
  'hatchback-sports',
  'suv-luxury',
  'delivery',
];

const TARGET_LENGTH = 4.4; // 与物理底盘一致的目标车长（米）

/** 原 Kenney 车身贴图主色（按车身表面 UV 取样）；初始跑车保留现有红漆。 */
export const CAR_PAINT: Record<Exclude<CarType, 'police'>, number> = {
  sedan: 0xe86147,
  'sedan-sports': 0xff1824,
  suv: 0x43ac7c,
  'suv-luxury': 0xffcf60,
  taxi: 0xffb147,
  'hatchback-sports': 0x5ac487,
  delivery: 0x5ac487,
};

/** 停靠车静态合并用的单材质部件（几何已烘焙到车根坐标系） */
export interface CarPart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** 单个碰撞盒（车根坐标系：原点在车底中心地面，+Z 车头）：半尺寸 + 中心偏移 */
export interface CarBox {
  hx: number;
  hy: number;
  hz: number;
  cy: number;
  cz: number;
}

/** 按车型实测的碰撞规格：车身盒（全footprint到座舱线）+ 座舱盒（到真实车顶） */
export interface CarBoxes {
  body: CarBox;
  cabin: CarBox | null;
}

export class CarLibrary {
  private readonly templates = new Map<CarType, THREE.Group>();
  private readonly baked = new Map<CarType, CarPart[]>();
  private readonly boxCache = new Map<CarType, CarBoxes>();

  setupSportsReflections(renderer: THREE.WebGLRenderer): void {
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const reflection = pmrem.fromScene(room, .04).texture;
    for (const [type, template] of this.templates) {
      if (type === 'police') continue;
      template.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.envMap = reflection;
          mat.envMapIntensity = .6;
        }
      }
      });
    }
    room.dispose();
    pmrem.dispose();
  }

  static async load(): Promise<CarLibrary> {
    const lib = new CarLibrary();
    const loader = new GLTFLoader();
    const draco = new DRACOLoader().setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    await Promise.all(
      (['police', 'sedan-sports'] as const).map(async (type) => {
        const gltf = await loader.loadAsync(`/models/cars/${type === 'sedan-sports' ? 'ferrari' : type}.glb`);
        const inner = gltf.scene;
        if (type === 'sedan-sports') {
          inner.rotation.y = Math.PI; // 示例车头为 -Z，游戏约定 +Z。
          for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
            inner.getObjectByName(name)!.rotation.x = 0;
          }
          const paint = new THREE.MeshPhysicalMaterial({ color: 0xff1824, metalness: .65, roughness: .3, clearcoat: 1, clearcoatRoughness: .03 });
          const trim = new THREE.MeshStandardMaterial({ color: 0xdde2e8, metalness: .85, roughness: .28 });
          const glass = new THREE.MeshPhysicalMaterial({ color: 0x859aa7, metalness: .15, roughness: .08, transparent: true, opacity: .38, depthWrite: false });
          const interior = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: .85 });
          inner.traverse(o => {
            if (o instanceof THREE.Mesh && /leather|interior|carpet|carbon|grills|plastic/i.test(o.name)) o.material = interior;
          });
          (inner.getObjectByName('body') as THREE.Mesh).material = paint;
          for (const name of ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim']) (inner.getObjectByName(name) as THREE.Mesh).material = trim;
          (inner.getObjectByName('glass') as THREE.Mesh).material = glass;
          inner.userData.model = 'Ferrari 458 Italia';
        }
        const box = new THREE.Box3().setFromObject(inner);
        const size = box.getSize(new THREE.Vector3());
        const s = TARGET_LENGTH / size.z;
        inner.scale.setScalar(s);
        inner.position.set(
          -((box.min.x + box.max.x) / 2) * s,
          -box.min.y * s,
          -((box.min.z + box.max.z) / 2) * s,
        );
        inner.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            const mat = o.material as THREE.MeshStandardMaterial;
            if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
          }
        });
        const template = new THREE.Group();
        template.add(inner);
        lib.templates.set(type, template);
      }),
    );
    draco.dispose();
    const ferrari = lib.templates.get('sedan-sports')!;
    for (const type of ALL_CAR_TYPES) {
      if (type === 'police' || type === 'sedan-sports') continue;
      const variant = ferrari.clone(true);
      const body = variant.getObjectByName('body') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
      body.material = body.material.clone();
      body.material.color.setHex(CAR_PAINT[type]);
      lib.templates.set(type, variant);
    }
    return lib;
  }

  /** 将原车轮烘焙到游戏坐标，再以轮心为原点交给物理悬挂/转向驱动。 */
  sportsWheels(): Array<{ model: THREE.Group; center: THREE.Vector3 }> {
    const template = this.templates.get('sedan-sports')!;
    template.updateMatrixWorld(true);
    return ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'].map(name => {
      const source = template.getObjectByName(name)!;
      const center = new THREE.Box3().setFromObject(source).getCenter(new THREE.Vector3());
      const model = new THREE.Group();
      source.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld).translate(-center.x, -center.y, -center.z);
        const mesh = new THREE.Mesh(geometry, o.material);
        mesh.castShadow = true;
        model.add(mesh);
      });
      return { model, center };
    });
  }

  /**
   * 取一辆车的实例（共享几何/材质）。原点在车底中心地面处，+Z 车头。
   * hideWheels=true 隐藏模型自带车轮（玩家车用物理驱动的独立车轮）。
   */
  clone(type: CarType, hideWheels: boolean): THREE.Group {
    const template = this.templates.get(type);
    if (!template) throw new Error(`未加载的车型: ${type}`);
    const g = template.clone(true);
    if (hideWheels) {
      g.traverse((o) => {
        if (o.name.startsWith('wheel')) o.visible = false;
      });
    }
    return g;
  }

  /**
   * 路边停靠车合并渲染用：模板各 mesh 几何烘焙到车根坐标系、按材质分组（懒构建缓存）。
   * 返回的几何/材质均为共享模板，调用方 clone 几何后使用、不得释放材质。
   */
  bakedParts(type: CarType): CarPart[] {
    let parts = this.baked.get(type);
    if (parts) return parts;
    if (type !== 'police' && type !== 'sedan-sports') {
      const originalPaint = (this.templates.get('sedan-sports')!.getObjectByName('body') as THREE.Mesh).material;
      const paint = (this.templates.get(type)!.getObjectByName('body') as THREE.Mesh).material as THREE.Material;
      parts = this.bakedParts('sedan-sports').map(part => ({
        geometry: part.geometry, material: part.material === originalPaint ? paint : part.material,
      }));
      this.baked.set(type, parts);
      return parts;
    }
    const template = this.templates.get(type);
    if (!template) throw new Error(`未加载的车型: ${type}`);
    template.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    template.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material;
      const g = (o.geometry as THREE.BufferGeometry).clone();
      g.applyMatrix4(o.matrixWorld);
      let list = byMat.get(mat);
      if (!list) byMat.set(mat, (list = []));
      list.push(g);
    });
    parts = [];
    for (const [material, geos] of byMat) {
      const geometry = geos.length === 1 ? geos[0]! : mergeGeometries(geos)!;
      if (geos.length > 1) for (const g of geos) g.dispose();
      parts.push({ geometry, material });
    }
    this.baked.set(type, parts);
    return parts;
  }

  /**
   * 按车型实测碰撞规格（缓存）：从模型真实顶点量出整车包围盒，
   * 再取"座舱线"（55% 车高）以上的顶点量出座舱盒——轿车得到短座舱、
   * 货车自动得到近全长的高箱，每种车型的车顶平面高度天然正确。
   * 只用方盒（求解器最稳），不用凸包/三角网格——凸包在动态车身+CCD+
   * 悬挂射线的组合下会触发 Rapier WASM panic（实测崩过）。
   */
  colliderBoxes(type: CarType): CarBoxes {
    let spec = this.boxCache.get(type);
    if (spec) return spec;
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const parts = this.bakedParts(type);
    for (const part of parts) {
      const pos = part.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i));
        maxY = Math.max(maxY, pos.getY(i));
        minZ = Math.min(minZ, pos.getZ(i)); maxZ = Math.max(maxZ, pos.getZ(i));
      }
    }
    const cabinLine = maxY * 0.55;
    let cMinX = Infinity, cMaxX = -Infinity, cMinZ = Infinity, cMaxZ = -Infinity, cCount = 0;
    for (const part of parts) {
      const pos = part.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < cabinLine) continue;
        cCount++;
        cMinX = Math.min(cMinX, pos.getX(i)); cMaxX = Math.max(cMaxX, pos.getX(i));
        cMinZ = Math.min(cMinZ, pos.getZ(i)); cMaxZ = Math.max(cMaxZ, pos.getZ(i));
      }
    }
    spec = {
      body: {
        hx: (maxX - minX) / 2,
        hy: cabinLine / 2,
        hz: (maxZ - minZ) / 2,
        cy: cabinLine / 2,
        cz: (maxZ + minZ) / 2,
      },
      cabin:
        cCount >= 3
          ? {
              hx: (cMaxX - cMinX) / 2,
              hy: (maxY - cabinLine) / 2,
              hz: (cMaxZ - cMinZ) / 2,
              cy: (maxY + cabinLine) / 2,
              cz: (cMaxZ + cMinZ) / 2,
            }
          : null,
    };
    this.boxCache.set(type, spec);
    return spec;
  }
}

// ============ 建筑/街道道具库（Kenney City Kit，CC0，见 ASSETS.md） ============

const BUILDING_PROP_TYPES = [
  'building-a', 'building-b', 'building-c', 'building-d', 'building-e', 'building-f',
  'building-g', 'building-h', 'building-i', 'building-j', 'building-k', 'building-l',
  'building-m', 'building-n',
] as const;
const SKYSCRAPER_PROP_TYPES = [
  'building-skyscraper-a', 'building-skyscraper-b', 'building-skyscraper-c',
  'building-skyscraper-d', 'building-skyscraper-e',
] as const;
const LAMP_PROP_TYPES = ['light-curved'] as const;
const DETAIL_PROP_TYPES = [
  'detail-awning', 'detail-awning-wide', 'detail-overhang', 'detail-overhang-wide',
  'detail-parasol-a', 'detail-parasol-b',
] as const;
const NATURE_PROP_TYPES = [
  'tree_palm', 'tree_palmBend', 'tree_palmDetailedTall', 'tree_palmDetailedShort',
  'rock_largeA', 'rock_largeC', 'rock_smallA', 'rock_smallE',
] as const;

export type PropKit = 'buildings' | 'props' | 'nature';

/** 一个道具的单材质部件（几何已做统一缩放与贴地对齐） */
export interface PropPart {
  geometry: THREE.BufferGeometry;
  matKey: string;
}

export interface PropDef {
  parts: PropPart[];
  size: THREE.Vector3;
  kit: PropKit;
}

const LOT_FIT = 8.6; // 建筑占地不超过 9m 宅地
const SKYSCRAPER_H = 30;
const LAMP_H = 5;

function propScale(type: string, kit: PropKit, raw: THREE.Vector3): number {
  if (kit === 'nature') {
    if (type.startsWith('tree_palm')) return (type.includes('Short') ? 3.6 : 5.6) / raw.y;
    return (type.startsWith('rock_large') ? 1.7 : 0.7) / raw.y;
  }
  if (kit === 'props') return LAMP_H / raw.y;
  if (type.startsWith('detail-parasol')) return 2.2 / raw.y;
  if (type.startsWith('detail-')) return (type.includes('wide') ? 4.6 : 2.6) / raw.x;
  if (type.includes('skyscraper')) {
    return Math.min(LOT_FIT / Math.max(raw.x, raw.z), SKYSCRAPER_H / raw.y);
  }
  return LOT_FIT / Math.max(raw.x, raw.z);
}

export class PropLibrary {
  private readonly defs = new Map<string, PropDef>();
  private readonly materials = new Map<string, THREE.Material>();

  static async load(): Promise<PropLibrary> {
    const lib = new PropLibrary();
    const loader = new GLTFLoader();
    const jobs: Array<{ type: string; kit: PropKit; path: string }> = [
      ...BUILDING_PROP_TYPES.map((t) => ({ type: t as string, kit: 'buildings' as PropKit, path: `/models/buildings/${t}.glb` })),
      ...SKYSCRAPER_PROP_TYPES.map((t) => ({ type: t as string, kit: 'buildings' as PropKit, path: `/models/buildings/${t}.glb` })),
      ...LAMP_PROP_TYPES.map((t) => ({ type: t as string, kit: 'props' as PropKit, path: `/models/props/${t}.glb` })),
      ...DETAIL_PROP_TYPES.map((t) => ({ type: t as string, kit: 'buildings' as PropKit, path: `/models/buildings/${t}.glb` })),
      ...NATURE_PROP_TYPES.map((t) => ({ type: t as string, kit: 'nature' as PropKit, path: `/models/nature/${t}.glb` })),
    ];
    await Promise.all(
      jobs.map(async ({ type, kit, path }) => {
        const gltf = await loader.loadAsync(path);
        gltf.scene.updateMatrixWorld(true);
        // 先算整体包围盒 → 统一变换参数
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const raw = box.getSize(new THREE.Vector3());
        const s = propScale(type, kit, raw);
        const ox = -(box.min.x + box.max.x) / 2;
        const oy = -box.min.y;
        const oz = -(box.min.z + box.max.z) / 2;

        // 按材质名收集部件（同 kit 同材质名共享一份材质，供跨模型合并）
        const byKey = new Map<string, THREE.BufferGeometry[]>();
        gltf.scene.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const mat = mats[0] as THREE.MeshStandardMaterial;
          const key = `${kit}:${mat.name || 'default'}`;
          if (!lib.materials.has(key)) {
            if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
            lib.materials.set(key, mat);
          }
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          g.translate(ox, oy, oz);
          g.scale(s, s, s);
          let list = byKey.get(key);
          if (!list) byKey.set(key, (list = []));
          list.push(g);
        });
        const parts: PropPart[] = [];
        for (const [matKey, geos] of byKey) {
          parts.push({ geometry: geos.length === 1 ? geos[0]! : mergeGeometries(geos)!, matKey });
        }
        lib.defs.set(type, { parts, size: raw.multiplyScalar(s), kit });
      }),
    );
    // 建筑套件整体暖色调（参考纽约砂岩/石灰岩街景），与灰色路面拉开对比
    const bmat = lib.materials.get('buildings:colormap');
    if (bmat instanceof THREE.MeshStandardMaterial) bmat.color.setHex(0xf5e0c4);
    return lib;
  }

  def(type: string): PropDef {
    const d = this.defs.get(type);
    if (!d) throw new Error(`未加载的道具: ${type}`);
    return d;
  }

  material(matKey: string): THREE.Material {
    return this.materials.get(matKey)!;
  }
}

// ============ 摩托模型（OpenGameArt "Harakiri Warbike"，CC-BY 3.0，见 ASSETS.md） ============

/** 加载摩托 OBJ+MTL（带贴图）：统一到车长 2.2m、贴地对齐、车头朝 +Z */
export async function loadMotoModel(): Promise<THREE.Group> {
  const mtl = await new MTLLoader().setPath('/models/moto/').loadAsync('bike.mtl');
  mtl.preload();
  const obj = await new OBJLoader().setMaterials(mtl).setPath('/models/moto/').loadAsync('bike.obj');
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const mat = m as THREE.MeshPhongMaterial;
        if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
  });
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  // 车身长轴对齐 Z
  if (size.x > size.z) {
    obj.rotateY(Math.PI / 2);
    box.setFromObject(obj);
    box.getSize(size);
  }
  const s = 2.2 / size.z;
  obj.scale.setScalar(s);
  obj.position.set(
    -((box.min.x + box.max.x) / 2) * s,
    -box.min.y * s,
    -((box.min.z + box.max.z) / 2) * s,
  );
  const root = new THREE.Group();
  root.add(obj);
  return root;
}

// ==== 坦克模型（OGA "Stridsvagn 103" by Lukasz Wesiora，CC-BY 3.0，见 ASSETS.md） ====

// 由 .blend 经 Blender 无头导出（几何+UV，材质在此手动挂）。实测（Y-up，炮口 +Z，
// 原生尺寸即米制,与真车 1:1）：全长含炮管 z∈[-4.45, 4.50]，车体（车尾板到前翼子板）
// z∈[-4.45, 3.10] → 车体中心 -0.675。按包围盒居中会让车体后错半个炮管悬伸。
const TANK_HULL_CENTER_Z = -0.675;

/** 加载坦克 GLB + 2048 PBR 贴图（漫反射/法线×车体/细节两套）：履带底贴地、车体中心对准原点、炮口 +Z */
export async function loadTankModel(): Promise<THREE.Group> {
  const tex = new THREE.TextureLoader().setPath('/models/tank/');
  const [gltf, bodyD, bodyN, detailsD, detailsN] = await Promise.all([
    new GLTFLoader().loadAsync('/models/tank/tank.glb'),
    tex.loadAsync('Body_d.jpg'),
    tex.loadAsync('Body_n.jpg'),
    tex.loadAsync('Details_d.jpg'),
    tex.loadAsync('Details_n.jpg'),
  ]);
  for (const t of [bodyD, bodyN, detailsD, detailsN]) {
    t.flipY = false; // 手动加载的贴图需遵守 glTF 的 UV 约定
    t.anisotropy = 4;
  }
  bodyD.colorSpace = THREE.SRGBColorSpace;
  detailsD.colorSpace = THREE.SRGBColorSpace;
  const bodyMat = new THREE.MeshStandardMaterial({
    map: bodyD,
    normalMap: bodyN,
    roughness: 0.82,
    metalness: 0.18,
  });
  const detailsMat = new THREE.MeshStandardMaterial({
    map: detailsD,
    normalMap: detailsN,
    roughness: 0.9,
    metalness: 0.25,
  });
  const obj = gltf.scene;
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      // 网格→材质映射：车体网格名以 Body 开头，其余（履带/负重轮/主动轮/附件）用细节材质
      o.material = o.name.startsWith('Body') ? bodyMat : detailsMat;
    }
  });
  const box = new THREE.Box3().setFromObject(obj);
  obj.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -TANK_HULL_CENTER_Z);
  const root = new THREE.Group();
  root.add(obj);
  return root;
}

// ============ 人物模型库（KayKit Adventurers，CC0，见 ASSETS.md） ============

export type PersonType = 'Knight' | 'Barbarian' | 'Mage' | 'Rogue' | 'Rogue_Hooded';
export const ALL_PERSON_TYPES: PersonType[] = [
  'Knight',
  'Barbarian',
  'Mage',
  'Rogue',
  'Rogue_Hooded',
];

const PERSON_HEIGHT = 1.8; // 统一身高（米）

export interface PersonInstance {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  /** 右手武器挂点（骨骼），没有则为 null */
  handSlotR: THREE.Object3D | null;
}

interface PersonTemplate {
  scene: THREE.Group;
  clips: THREE.AnimationClip[];
}

export class PersonLibrary {
  private readonly templates = new Map<PersonType, PersonTemplate>();

  static async load(): Promise<PersonLibrary> {
    const lib = new PersonLibrary();
    const loader = new GLTFLoader();
    await Promise.all(
      ALL_PERSON_TYPES.map(async (type) => {
        const gltf = await loader.loadAsync(`/models/characters/${type}.glb`);
        const inner = gltf.scene;
        // 隐藏自带的手持武器/盾牌（挂在 handslot 下的网格），统一缩放到目标身高、脚底对齐原点
        inner.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true;
            if (o.parent && o.parent.name.startsWith('handslot')) o.visible = false;
          }
        });
        const box = new THREE.Box3().setFromObject(inner);
        const s = PERSON_HEIGHT / (box.max.y - box.min.y);
        inner.scale.setScalar(s);
        inner.position.y = -box.min.y * s;
        inner.rotation.y = Math.PI; // 模型面朝 +Z → 本项目约定面朝 -Z
        const template = new THREE.Group();
        template.add(inner);
        lib.templates.set(type, { scene: template, clips: gltf.animations });
      }),
    );
    return lib;
  }

  /** 生成可动画实例（骨骼深拷贝，几何/材质共享）。root 原点在脚底。 */
  spawn(type: PersonType): PersonInstance {
    const template = this.templates.get(type);
    if (!template) throw new Error(`未加载的人物: ${type}`);
    const root = SkeletonUtils.clone(template.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<string, THREE.AnimationAction>();
    for (const clip of template.clips) {
      actions.set(clip.name, mixer.clipAction(clip));
    }
    let handSlotR: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (o.name === 'handslot.r' || o.name === 'handslotr') handSlotR = o;
    });
    return { root, mixer, actions, handSlotR };
  }
}
