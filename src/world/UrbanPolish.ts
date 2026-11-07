import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics, RAPIER } from '../core/Physics';
import { groundPlane, woodMaterial } from './ShanghaiSurfaces';

/** Furniture is solid; small fittings share merged geometry per site/material. */
export class UrbanPolish {
  private readonly sites: Array<{ root: THREE.Group; x: number; z: number }> = [];

  constructor(scene: THREE.Scene, physics: Physics) {
    const steel = new THREE.MeshStandardMaterial({ color: 0x465558, roughness: .65, metalness: .4 });
    const paper = new THREE.MeshStandardMaterial({ color: 0xc8b99c, roughness: .95 });
    const fabric = new THREE.MeshStandardMaterial({ color: 0x6c8880, roughness: 1 });
    const lamp = new THREE.MeshStandardMaterial({ color: 0xd8d7bd, emissive: 0xd8d7bd, emissiveIntensity: .25, roughness: .8 });
    const brick = this.brickMaterial();
    const site = (name: string, x: number, z: number) => {
      const root = new THREE.Group(); root.name = `Interior-${name}`; scene.add(root); this.sites.push({ root, x, z });
      const light = new THREE.PointLight(0xffe4bb, name === 'Port-Warehouse' ? 28 : 15, name === 'Port-Warehouse' ? 19 : 11, 2);
      // Keep the finite-range lights registered when furniture is culled, so
      // crossing a district boundary does not compile a new light-count shader.
      light.position.set(x, name === 'Port-Warehouse' ? 4.7 : 3, z); scene.add(light);
      const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
      const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material, solid = false) => {
        const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z);
        // World-sized UVs keep wood grain and masonry at a consistent scale.
        const uv = g.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) {
          const face = Math.floor(i / 4);
          uv.setXY(i, uv.getX(i) * (face < 2 ? d : w) / 2, uv.getY(i) * (face === 2 || face === 3 ? d : h) / 2);
        }
        if (!batches.has(material)) batches.set(material, []);
        batches.get(material)!.push(g);
        if (solid) physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(x, y, z));
      };
      const finish = () => {
        for (const [material, parts] of batches) {
          const mesh = new THREE.Mesh(mergeGeometries(parts)!, material); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh);
          parts.forEach(g => g.dispose());
        }
      };
      return { root, box, finish };
    };

    const shop = site('Lilong-Shop', -96, 32), b = shop.box;
    // The fascia is an actual board. Its collider also stops the third-person
    // lens entering the sign when the player stands in the doorway.
    b(-88.84, 3.55, 32, .07, .7, 6.5, steel, true);
    b(-102.85, 1.9, 32, .025, 3.7, 12.7, brick);
    for (const z of [25.65, 38.35]) b(-96, 1.9, z, 13.7, 3.7, .025, brick);
    shop.root.add(groundPlane(-96, 32, 13.7, 12.7, .046, 2, woodMaterial));
    // Low shelves leave the doorway and both existing pickup locations clear.
    for (const x of [-100, -94]) {
      for (const dx of [-2, 2]) b(x + dx, 1.1, 26.2, .07, 2.2, .65, steel);
      for (const y of [.24, 1, 1.8]) {
        b(x, y, 26.2, 4.1, .08, .75, woodMaterial, true);
        for (let i = 0; i < 7; i++) b(x - 1.6 + i * .52, y + .22, 26.2, .38, .35, .45, i % 2 ? paper : fabric);
      }
    }
    for (const z of [28.5, 35.5]) {
      b(-101.8, 1.6, z, .05, 1.7, .05, steel);
      b(-100.7, 2.43, z, 2.3, .05, .05, steel);
      b(-99.6, 1.6, z, .05, 1.7, .05, steel);
      for (let i = 0; i < 4; i++) {
        b(-101.5 + i * .5, 1.75, z, .36, 1.15, .11, fabric);
        b(-101.5 + i * .5, 2.15, z, .47, .16, .12, fabric);
      }
    }
    for (const x of [-101, -96, -91]) {
      b(x, 3.65, 32, .16, .2, 12.7, woodMaterial);
      b(x, 3.47, 32, .18, .06, 1.8, lamp);
    }
    // Masonry and drainpipes on the old street; existing windows stay proud.
    for (const x of [-128, -96, -64]) for (const z of [-32, 0, 32]) {
      if (x === -96 && z === 32) continue;
      b(x, 3.4, z + 10.015, 19, 6.8, .025, brick);
      b(x + 8.7, 3.3, z + 10.15, .12, 6.6, .12, steel);
      for (const y of [.28, 3.4, 6.6]) b(x, y, z + 10.1, 19, .14, .18, paper);
    }
    shop.finish();

    const warehouse = site('Port-Warehouse', 200, 192), w = warehouse.box;
    const corrugated = this.industrialMaterial(true);
    warehouse.root.add(groundPlane(200, 192, 25.6, 19.6, .048, 6, this.industrialMaterial(false)));
    for (const z of [182.19, 201.81]) w(200, 3, z, 25.6, 5.85, .025, corrugated);
    w(212.81, 3, 192, .025, 5.85, 19.6, corrugated);
    for (const x of [188, 200, 212]) {
      for (const z of [182.3, 201.7]) w(x, 3, z, .17, 5.9, .2, steel);
      w(x, 5.75, 192, .17, .23, 19.4, steel);
    }
    for (const x of [199, 207]) {
      for (const z of [183.3, 200.7]) {
        for (const dx of [-2, 2]) w(x + dx, 1.95, z, .12, 3.9, 1.1, steel);
        for (const y of [.2, 1.6, 3]) {
          w(x, y, z, 4.2, .1, 1.3, steel, true);
          for (const dx of [-1.4, 0, 1.4]) {
            w(x + dx, y + .43, z, 1.12, .75, .95, paper);
            w(x + dx, y + .43, z + (z < 192 ? .48 : -.48), .13, .74, .012, woodMaterial);
          }
        }
      }
      w(x, 5.55, 192, .3, .08, 2.4, lamp);
    }
    // Rubber door guards and floor clearance markings, all outside loot paths.
    for (const z of [189.35, 194.65]) w(187.25, .65, z, .32, 1.3, .3, paper, true);
    for (let i = 0; i < 7; i++) w(189 + i * 1.1, .055, 188.7, .65, .012, .11, paper);
    warehouse.finish();

    const shelter = site('Riverside-Shelter', 40, 88), s = shelter.box;
    s(43.1, 1.3, 90.7, 1.2, 2.25, .65, steel, true);
    for (const x of [42.8, 43.4]) { s(x, 1.65, 90.35, .35, .04, .03, paper); s(x + .15, 1.05, 90.34, .04, .15, .04, paper); }
    s(38.4, .39, 85.4, 1.8, .45, .7, fabric, true);
    for (const x of [37.7, 39.1]) s(x, .22, 85.4, .07, .44, .6, steel);
    s(41, 3.27, 88, 1.4, .06, .18, lamp);
    s(40, .175, 88, 3.1, .012, 2.2, fabric);
    s(41, .86, 85.3, .5, .25, .28, paper);
    shelter.finish();
  }

  update(position: THREE.Vector3): void {
    for (const site of this.sites) site.root.visible = Math.hypot(position.x - site.x, position.z - site.z) < 145;
  }

  private brickMaterial(): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#928a78'; ctx.fillRect(0, 0, 512, 512);
    let seed = 314159;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let row = 0; row < 16; row++) for (let col = -1; col < 5; col++) {
      const shade = 70 + Math.floor(random() * 26);
      ctx.fillStyle = `rgb(${shade + 28},${shade + 9},${shade})`;
      ctx.fillRect(col * 128 + row % 2 * 64 + 2, row * 32 + 2, 124, 28);
    }
    for (let i = 0; i < 10000; i++) { ctx.fillStyle = random() > .5 ? '#ffffff0c' : '#00000018'; ctx.fillRect(random() * 512, random() * 512, 2, 1); }
    const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.anisotropy = 8;
    const color = texture.clone(); color.colorSpace = THREE.SRGBColorSpace; color.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: color, bumpMap: texture, bumpScale: .035, roughness: .95 });
  }

  private industrialMaterial(metal: boolean): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.createImageData(512, 512); let seed = 8893;
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = (seed / 4294967296 - .5) * (metal ? 7 : 24);
      const value = metal ? 170 + Math.cos(x / 512 * Math.PI * 32) * 30 + grain
        : 178 + grain - (x < 2 || y < 2 ? 35 : 0) + Math.sin(x * .03) * Math.cos(y * .05) * 7;
      const at = (y * 512 + x) * 4; data.data[at] = data.data[at + 1] = data.data[at + 2] = value; data.data[at + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const bump = new THREE.CanvasTexture(canvas); bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 8;
    const color = bump.clone(); color.colorSpace = THREE.SRGBColorSpace; color.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ color: metal ? 0x83999c : 0xbebbb1, map: color, bumpMap: bump, bumpScale: metal ? .055 : .025, metalness: metal ? .45 : 0, roughness: metal ? .65 : .96 });
  }
}
