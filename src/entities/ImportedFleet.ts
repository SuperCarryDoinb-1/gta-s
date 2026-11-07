import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Physics } from '../core/Physics';
import type { CarLibrary } from '../core/Loader';
import { Vehicle, CAR_SPEC, MOTO_SPEC, type VehicleSpec } from './Vehicle';

export const IMPORTED_VEHICLES = [
  { id: 'sports-car', label: '跑车', folder: 'poly-pizza-sports-car', length: 4.4 },
  { id: 'bus', label: '公交车', folder: 'poly-pizza-vehicles', length: 7 },
  { id: 'suv', label: 'SUV', folder: 'poly-pizza-vehicles', length: 4.4 },
  { id: 'police-car', label: '警车', folder: 'poly-pizza-vehicles', length: 4.4 },
  { id: 'van', label: '厢式车', folder: 'poly-pizza-vehicles', length: 4.6 },
  { id: 'pickup-truck', label: '皮卡', folder: 'poly-pizza-vehicles', length: 4.8 },
  { id: 'motorcycle', label: '摩托车', folder: 'poly-pizza-vehicles', length: 2.2 },
  { id: 'bicycle', label: '自行车', folder: 'poly-pizza-bicycle', length: 1.9 },
  { id: 'psx_helicopter', label: '直升机', folder: 'psx-helicopter', length: 7 },
] as const;

export async function loadImportedFleet() {
  const loader = new GLTFLoader();
  return Promise.all(IMPORTED_VEHICLES.map(async (definition) => {
    const model = (await loader.loadAsync(`/assets/${definition.folder}/${definition.id}.glb`)).scene;
    const flying = definition.id === 'psx_helicopter';
    let rotor: THREE.Group | undefined;
    if (flying) {
      const blades = model.getObjectByName('Helicopter_Rotors');
      if (!(blades instanceof THREE.Mesh)) throw new Error('Helicopter rotor missing');
      const texture = await new THREE.TextureLoader().loadAsync('/assets/psx-helicopter/psx_helicopter_rotors.png');
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      for (const material of Array.isArray(blades.material) ? blades.material : [blades.material]) {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) {
          material.map = texture;
          material.transparent = true;
          material.side = THREE.DoubleSide;
        }
      }
      rotor = new THREE.Group();
      rotor.name = 'ImportedRotor';
      rotor.position.set(0.025334, 4.572656, 2.159856);
      blades.removeFromParent();
      blades.position.copy(rotor.position).negate();
      rotor.add(blades);
      model.add(rotor);
    }
    // Source vehicles drive toward -Z; this project uses +Z.
    let bounds = new THREE.Box3().setFromObject(model);
    const raw = bounds.getSize(new THREE.Vector3());
    model.rotation.y = flying || definition.id === 'sports-car' ? 0 : raw.x > raw.z ? -Math.PI / 2 : Math.PI;
    bounds = new THREE.Box3().setFromObject(model);
    const scale = definition.length / bounds.getSize(new THREE.Vector3()).z;
    model.scale.multiplyScalar(scale);
    model.position.set(-(bounds.min.x + bounds.max.x) * scale / 2, -bounds.min.y * scale, -(bounds.min.z + bounds.max.z) * scale / 2);
    model.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    const root = new THREE.Group();
    root.add(model);
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
    const bike = definition.id === 'bicycle' || definition.id === 'motorcycle';
    const base = bike ? MOTO_SPEC : CAR_SPEC;
    const groundOffset = flying ? -size.y / 2 : base.groundOffset;
    const half = flying ? { x: 1.2, y: size.y / 2, z: 2.7 }
      : { x: Math.max(0.22, size.x / 2), y: Math.max(0.25, size.y / 2), z: size.z / 2 };
    const spec: VehicleSpec = {
      ...base, half, groundOffset, hideWheels: true, roofHull: false,
      flying, upright: flying || bike, label: definition.label,
      lamps: { x: half.x * .6, y: 0, zFront: half.z, zRear: -half.z, scale: bike ? .3 : flying ? .5 : 1 },
      mass: flying ? 900 : bike ? 180 : definition.id === 'bus' ? 1800 : 800,
      engine: bike ? 1800 : definition.id === 'bus' ? 9000 : 5000,
      topSpeed: definition.id === 'bicycle' ? 10 : base.topSpeed,
      wheels: base.wheels.map(w => ({ ...w, x: Math.sign(w.x) * (bike ? 0.17 : half.x * .85), z: Math.sign(w.z) * half.z * .66 })),
    };
    // Keep the collision hull aligned to the visual body above the suspension.
    return { definition, root, spec, rotor, hullCenter: size.y / 2 + groundOffset };
  }));
}

export function createImportedFleet(scene: THREE.Scene, physics: Physics, library: CarLibrary, assets: Awaited<ReturnType<typeof loadImportedFleet>>): Vehicle[] {
  return assets.map((asset, index) => {
    // Two sides of the starting road, with enough spacing for the bus and rotors.
    const position = asset.spec.flying ? new THREE.Vector3(16, 3, -16)
      : new THREE.Vector3(index % 2 === 0 ? 13 : 19, 2.5, 36 + Math.floor(index / 2) * 12);
    const vehicle = new Vehicle(scene, physics, position, library, asset.spec, asset.root);
    vehicle.mesh.name = `Imported-${asset.definition.id}`;
    vehicle.chassisCollider.setTranslationWrtParent({ x: 0, y: asset.hullCenter, z: 0 });
    vehicle.rotor = asset.rotor ?? null;
    return vehicle;
  });
}
