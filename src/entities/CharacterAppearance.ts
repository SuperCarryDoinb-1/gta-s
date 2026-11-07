import * as THREE from 'three';
import type { SurvivalInventory } from '../gameplay/SurvivalInventory';

/** Player-only material instances keep pedestrian clothing untouched. */
export class CharacterAppearance {
  private readonly clothes: Array<{ material: THREE.MeshStandardMaterial; original: THREE.Color; area: string }> = [];
  private readonly bags: THREE.Object3D[] = [];
  private readonly vest = new THREE.Group();
  private readonly plate = new THREE.MeshStandardMaterial({ color: 0x414e50, roughness: .92, metalness: .05 });

  constructor(model: THREE.Group) {
    model.updateMatrixWorld(true);
    model.traverse(o => {
      if (o.name === 'Backpack') this.bags.push(o);
      if (!(o instanceof THREE.Mesh)) return;
      let area = o.name;
      for (let p = o.parent; p && p !== model; p = p.parent) area += `/${p.name}`;
      if (!/Adventurer_(Body|Legs|Feet)/.test(area)) return;
      const clone = (source: THREE.Material): THREE.Material => {
        if (!(source instanceof THREE.MeshStandardMaterial) || source.name === 'Skin') return source;
        const material = source.clone();
        this.clothes.push({ material, original: material.color.clone(), area });
        material.roughness = .88; material.metalness = 0;
        return material;
      };
      o.material = Array.isArray(o.material) ? o.material.map(clone) : clone(o.material);
    });
    const chest = model.getObjectByName('Chest');
    if (!chest) throw new Error('Missing player chest attachment');
    this.vest.name = 'Equipped-Armor';
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, material = this.plate) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.layers.enable(2); this.vest.add(mesh);
    };
    const strap = new THREE.MeshStandardMaterial({ color: 0x222d30, roughness: 1 });
    const outline = new THREE.Shape();
    outline.moveTo(-.20, -.20); outline.lineTo(.20, -.20); outline.lineTo(.20, .10);
    outline.lineTo(.14, .20); outline.lineTo(.08, .20); outline.lineTo(.055, .11);
    outline.lineTo(-.055, .11); outline.lineTo(-.08, .20); outline.lineTo(-.14, .20);
    outline.lineTo(-.20, .10); outline.closePath();
    const shell = new THREE.ExtrudeGeometry(outline, { depth: .035, bevelEnabled: true, bevelThickness: .008, bevelSize: .008, bevelSegments: 1, steps: 1 });
    for (const z of [-.18, .145]) {
      const mesh = new THREE.Mesh(shell, this.plate); mesh.position.z = z;
      mesh.castShadow = true; mesh.layers.enable(2); this.vest.add(mesh);
    }
    for (const x of [-.17, .17]) {
      add(.055, .025, .33, x, .20, 0, strap);
      add(.115, .125, .045, x * .65, -.06, -.203);
      add(.055, .03, .015, x * .65, .04, -.204, strap);
    }
    add(.43, .045, .30, 0, -.17, 0, strap);
    // Attach in metre-sized player space while compensating the imported rig's scale.
    const desired = new THREE.Matrix4().multiplyMatrices(model.matrixWorld,
      new THREE.Matrix4().makeTranslation(0, .30, 0));
    const local = new THREE.Matrix4().copy(chest.matrixWorld).invert().multiply(desired);
    local.decompose(this.vest.position, this.vest.quaternion, this.vest.scale);
    chest.add(this.vest); this.vest.visible = false;
  }

  apply(inventory: SurvivalInventory): void {
    for (const { material, original, area } of this.clothes) {
      if (inventory.outfit === 'base') material.color.copy(original);
      else {
        const feet = area.includes('Adventurer_Feet'), legs = area.includes('Adventurer_Legs');
        const detail = /LightGreen|Brown2|Grey/.test(material.name);
        material.color.setHex(feet ? 0x242c33 : legs ? (detail ? 0x4c5b67 : 0x303e4b) :
          inventory.outfit === 'jacket' ? (detail ? 0x7aacc0 : 0x266a95) : (detail ? 0xf0c56b : 0xcc652e));
      }
    }
    for (const bag of this.bags) bag.visible = inventory.hasBackpack;
    this.vest.visible = inventory.armorEquipped;
    this.plate.color.setHex(inventory.armorDurability > 0 ? 0x414e50 : 0x6a4234);
  }
}
