import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Physics, RAPIER } from '../core/Physics';
import type { Character } from '../entities/Character';
import type { CameraRig } from '../entities/CameraRig';
import type { CharacterController } from '../gameplay/CharacterController';
import { enableStreetNavigation } from './StreetNavigation';

export interface MapFootprint { x: number; z: number; w: number; d: number }
type Collider = import('@dimforge/rapier3d-compat').Collider;

/** Two actual GLB environments, isolated physics, and a reversible walking portal. */
export class ImportedWorld {
  readonly outdoor = new THREE.Group();
  readonly indoor = new THREE.Group();
  readonly entrance = new THREE.Vector3(2.1, .42, 28);
  readonly exit = new THREE.Vector3(1008, .08, -3.7);
  readonly indoorSpawn = new THREE.Vector3(1010, 1.12, 3.8);
  readonly spawn = new THREE.Vector3(10, 1.35, 33);
  readonly footprints: MapFootprint[] = [];
  inside = false;
  hint = '';
  private cooldown = 0;
  private readonly outdoorColliders: Collider[] = [];
  private readonly indoorColliders: Collider[] = [];
  private readonly frozenBodies: import('@dimforge/rapier3d-compat').RigidBody[] = [];
  private readonly returnPosition = new THREE.Vector3();
  private returnYaw = 0;
  private readonly overlay = document.createElement('div');
  private readonly label = document.createElement('div');
  private readonly interiorFill = new THREE.HemisphereLight(0xe7edff, 0x978371, .85);
  private readonly physics: Physics;
  private constructor(scene: THREE.Scene, physics: Physics) {
    this.physics = physics;
    this.outdoor.name = 'Street City 7'; this.indoor.name = 'Interior 15';
    scene.add(this.outdoor, this.indoor);
    this.indoor.add(this.interiorFill);
    const windowLight = new THREE.DirectionalLight(0xffe0b3, 1.5);
    windowLight.position.set(988, 9, 4); windowLight.target.position.set(1010, 0, 1);
    this.indoor.add(windowLight, windowLight.target);
    this.indoor.visible = false;
    this.overlay.id = 'scene-transition';
    this.overlay.style.cssText = 'position:fixed;inset:0;background:#0b0d10;opacity:0;pointer-events:none;z-index:80;transition:opacity .18s';
    this.label.id = 'location-label';
    this.label.style.cssText = 'position:fixed;left:24px;top:140px;z-index:12;color:#eee;font:12px/1.7 system-ui;letter-spacing:2px;text-shadow:0 2px 6px #000;pointer-events:none;display:none';
    document.body.append(this.overlay, this.label);
    window.addEventListener('game:started', () => { this.label.style.display = ''; });
    window.addEventListener('game:home', () => { this.label.style.display = 'none'; });
  }

  static async load(scene: THREE.Scene, physics: Physics): Promise<ImportedWorld> {
    const world = new ImportedWorld(scene, physics);
    const loader = new GLTFLoader();
    const [street, interior] = await Promise.all([
      loader.loadAsync('/models/environments/street-city.glb'),
      loader.loadAsync('/models/environments/panoramic-interior.glb'),
    ]);
    street.scene.scale.setScalar(6);
    street.scene.position.set(34, .08, 16);
    world.outdoor.add(street.scene);
    interior.scene.position.set(1000, .08, 0);
    world.indoor.add(interior.scene);
    scene.updateMatrixWorld(true);

    // Original author's sample buildings are lined up outside the assembled street.
    street.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      const bounds = new THREE.Box3().setFromObject(o);
      if (bounds.min.x > 140) { o.visible = false; return; }
      world.prepareMesh(o);
      // Preserve the painted puddles without treating the whole asphalt atlas as metal.
      if (bounds.max.y - bounds.min.y < 4 && bounds.max.x - bounds.min.x > 20) {
        const original = o.material as THREE.MeshStandardMaterial;
        const pavement = original.clone();
        pavement.metalnessMap = null; pavement.metalness = .02;
        pavement.roughnessMap = null; pavement.roughness = .72;
        o.material = pavement;
      }
      world.addMeshCollider(o, world.outdoorColliders);
      const size = bounds.getSize(new THREE.Vector3());
      if (size.y > 7 && size.x > 5 && size.z > 5) {
        world.footprints.push({ x: bounds.min.x, z: bounds.min.z, w: size.x, d: size.z });
      }
    });
    interior.scene.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      world.prepareMesh(o);
      // The artist's panorama dome is scenery, never a walkable/collidable shell.
      if (o.name.startsWith('Sphere')) {
        o.castShadow = false;
        const m = o.material as THREE.MeshStandardMaterial;
        o.material = new THREE.MeshBasicMaterial({ map: m.emissiveMap ?? m.map, side: THREE.DoubleSide, fog: false });
      } else {
        world.addMeshCollider(o, world.indoorColliders);
        // The supplied glazing is a zero-thickness, single-sided surface. Give
        // it thickness so the character controller cannot enter from its back.
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        if (materials.some(m => m.transparent)) {
          const box = new THREE.Box3().setFromObject(o);
          const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
          if (size.y > 1 && Math.min(size.x, size.z) < .15) {
            world.indoorColliders.push(physics.world.createCollider(
              RAPIER.ColliderDesc.cuboid(Math.max(.06, size.x / 2), size.y / 2, Math.max(.06, size.z / 2))
                .setTranslation(center.x, center.y, center.z),
            ));
          }
        }
      }
    });
    // Backup slab only underneath the street, not under the room's pool.
    world.outdoorColliders.push(physics.world.createCollider(
      RAPIER.ColliderDesc.cuboid(105, .3, 170).setTranslation(35, -.7, 16),
    ));
    world.addPortal(world.outdoor, world.entrance, '全景公寓', 'G · ENTER');
    world.addPortal(world.indoor, world.exit, '返回街区', 'G · EXIT');
    // End-of-street barriers make the finite downloaded map's limits explicit.
    for (const [x, z, yaw] of [[17, 81, 0], [70, -45, -.65]]) {
      const barrier = new THREE.Mesh(new THREE.BoxGeometry(16, 1, .6), new THREE.MeshStandardMaterial({ color: 0x57534b, roughness: .9 }));
      barrier.position.set(x!, .5, z!); barrier.rotation.y = yaw!;
      world.outdoor.add(barrier); barrier.updateMatrixWorld(true);
      world.addMeshCollider(barrier, world.outdoorColliders);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(15.8, .12, .62), new THREE.MeshStandardMaterial({ color: 0xd9c697, roughness: .8 }));
      stripe.position.copy(barrier.position); stripe.position.y += .15; stripe.rotation.y = yaw!;
      world.outdoor.add(stripe);
    }
    for (const c of world.indoorColliders) c.setEnabled(false);
    enableStreetNavigation();
    return world;
  }

  private prepareMesh(mesh: THREE.Mesh): void {
    mesh.castShadow = mesh.receiveShadow = true;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      if (mat.map) mat.map.anisotropy = 8;
      // Sketchfab's generic glTF metallic default turns unpainted pavement into chrome.
      if (mat.metalness === 1 && !mat.metalnessMap) mat.metalness = .08;
      if (mat.transparent) mat.depthWrite = false;
    }
  }

  private addMeshCollider(mesh: THREE.Mesh, list: Collider[]): void {
    const geo = mesh.geometry;
    const position = geo.getAttribute('position');
    if (!position) return;
    const vertices = new Float32Array(position.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
      vertices.set([v.x, v.y, v.z], i * 3);
    }
    const indices = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: position.count }, (_, i) => i);
    list.push(this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices).setFriction(.8)));
  }

  private addPortal(parent: THREE.Group, at: THREE.Vector3, title: string, action: string): void {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#141b20'; ctx.fillRect(0, 0, 512, 256);
    ctx.strokeStyle = '#bca77d'; ctx.lineWidth = 5; ctx.strokeRect(8, 8, 496, 240);
    ctx.textAlign = 'center'; ctx.fillStyle = '#f2e6cf'; ctx.font = '40px sans-serif'; ctx.fillText(title, 256, 110);
    ctx.font = '24px sans-serif'; ctx.fillStyle = '#bca77d'; ctx.fillText(action, 256, 175);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true }));
    sign.position.copy(at).y += 2.5; sign.scale.set(1.8, .9, 1); parent.add(sign);
    const ring = new THREE.Mesh(new THREE.RingGeometry(.65, .75, 48), new THREE.MeshBasicMaterial({ color: 0xcdb98c, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(at).y += .025; parent.add(ring);
  }

  update(dt: number, position: THREE.Vector3, driving: boolean): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const target = this.inside ? this.exit : this.entrance;
    const near = Math.hypot(position.x - target.x, position.z - target.z) < 2.4 && Math.abs(position.y - target.y) < 2.2;
    this.hint = near ? (driving ? '下车后进入全景公寓' : this.inside ? '按 G 返回街区' : '按 G 进入全景公寓') : '';
    this.label.textContent = this.inside ? '全景公寓  /  PANORAMIC RESIDENCE' : '旧城街区  /  OLD TOWN';
  }

  interact(character: Character, controller: CharacterController, camera: CameraRig, gameplay: THREE.Scene): boolean {
    if (!this.hint || this.cooldown > 0) return false;
    this.setInside(!this.inside, character, controller, camera, gameplay);
    return true;
  }

  setInside(inside: boolean, character: Character, controller: CharacterController, camera: CameraRig, gameplay: THREE.Scene): void {
    if (inside === this.inside) return;
    this.overlay.style.opacity = '.8';
    window.setTimeout(() => { this.overlay.style.opacity = '0'; }, 120);
    if (inside) {
      character.getPosition(this.returnPosition); this.returnYaw = character.yaw;
      // Freeze only bodies that were enabled; stashed cars remain stashed after returning.
      this.physics.world.forEachRigidBody(body => {
        if (body.handle !== character.body.handle && body.isEnabled()) {
          this.frozenBodies.push(body); body.setEnabled(false);
        }
      });
    } else {
      for (const body of this.frozenBodies) if (body.isValid()) body.setEnabled(true);
      this.frozenBodies.length = 0;
    }
    this.inside = inside;
    this.outdoor.visible = gameplay.visible = !inside; this.indoor.visible = inside;
    for (const c of this.outdoorColliders) c.setEnabled(!inside);
    for (const c of this.indoorColliders) c.setEnabled(inside);
    character.teleport(inside ? this.indoorSpawn : this.returnPosition);
    character.resetOrientation(inside ? 1.1 : this.returnYaw);
    controller.reset(); camera.reset(inside ? 1.1 : 0, inside ? .65 : 1);
    this.cooldown = 1; this.hint = '';
  }
}
