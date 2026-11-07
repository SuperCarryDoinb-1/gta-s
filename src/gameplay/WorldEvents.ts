import * as THREE from 'three';
import { Physics, RAPIER } from '../core/Physics';
import type { SurvivalSession } from './SurvivalSession';
import type { StoredItem } from './SurvivalInventory';

interface SupplyEvent { title: string; x: number; z: number; age: number; landed: boolean; mesh: THREE.Group; body: RAPIER.RigidBody; items: StoredItem[] }

/** Optional, repeatable free-roam supplies. Landed contents use normal saved world loot. */
export class WorldEvents {
  private timer = 45;
  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly session: SurvivalSession;
  private active: SupplyEvent | null = null;
  private lastPanel = '';
  private readonly panel = document.createElement('aside');
  private readonly box = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  private readonly material = new THREE.MeshStandardMaterial({ color: 0x678173, roughness: .9 });
  private readonly canopy = new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  private readonly canopyMat = new THREE.MeshStandardMaterial({ color: 0xbcb69c, side: THREE.DoubleSide, roughness: 1 });

  constructor(scene: THREE.Scene, physics: Physics, session: SurvivalSession) {
    this.scene = scene; this.physics = physics; this.session = session;
    this.panel.id = 'world-event'; this.panel.hidden = true; document.body.append(this.panel);
  }

  update(dt: number, player: THREE.Vector3): void {
    this.timer -= dt;
    if (!this.active && this.timer <= 0) {
      const spots = [{ x:-96,z:16 },{ x:178,z:192 },{ x:40,z:-48 }].filter(p => Math.hypot(p.x-player.x,p.z-player.z)<260);
      if (spots.length) this.spawn(spots[Math.floor(Math.random()*spots.length)]!, Math.random() > .5);
      else this.timer = 20;
    }
    const event = this.active; this.panel.hidden = !event;
    if (!event) return;
    event.age += dt;
    const height = Math.max(.65, 28 - event.age * 2.8);
    event.mesh.position.y = height;
    event.body.setNextKinematicTranslation({ x:event.x, y:height, z:event.z });
    if (!event.landed && height <= .65) {
      event.landed = true; event.mesh.children[1]!.visible = false;
      this.session.createLoot(event.items, new THREE.Vector3(event.x + 1.5, .05, event.z)); this.session.save();
    }
    const distance = Math.hypot(player.x-event.x,player.z-event.z);
    const html = `<small>街区动态 / 随机补给</small><strong>${event.title}</strong><span>${event.landed ? '已落地 · 靠近后 G / I 搜集' : '正在下降'} · ${Math.round(distance)} m</span><span>坐标 ${event.x} / ${event.z}</span>`;
    if(html!==this.lastPanel){this.panel.innerHTML=html;this.lastPanel=html;}
    if (event.age > 110) {
      const resources=new Set<THREE.Material>();
      event.mesh.traverse(o=>{if(o instanceof THREE.Line){o.geometry.dispose();for(const mat of Array.isArray(o.material)?o.material:[o.material])resources.add(mat);}});
      resources.forEach(mat=>mat.dispose());
      this.scene.remove(event.mesh); this.physics.world.removeRigidBody(event.body); this.active = null;
      this.panel.hidden = true; this.timer = 100 + Math.random() * 60;
    }
  }

  private spawn(position: { x:number;z:number }, medical: boolean): void {
    const mesh = new THREE.Group(); mesh.position.set(position.x,28,position.z);
    const crate = new THREE.Mesh(this.box,this.material); crate.castShadow = true; mesh.add(crate);
    const parachute = new THREE.Mesh(this.canopy,this.canopyMat); parachute.position.y = 3; mesh.add(parachute);
    const ropeMat = new THREE.LineBasicMaterial({ color:0x9da394 });
    for (const x of [-1,1]) for (const z of [-1,1]) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x*.45,.5,z*.45),new THREE.Vector3(x*1.7,3,z*1.7)]);
      const rope = new THREE.Line(geo,ropeMat); parachute.add(rope); rope.position.y = -3;
    }
    this.scene.add(mesh);
    const body = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x,28,position.z));
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(.55,.55,.55),body);
    this.active = { title:medical ? '医疗补给投放' : '装备补给投放', ...position, age:0, landed:false, mesh, body,
      items:medical ? [{kind:'bandage',count:3},{kind:'pistolAmmo',count:24}] : [{kind:'backpack',count:1},{kind:'mgAmmo',count:60},{kind:'armor',count:1,durability:100}] };
  }

  marker(cb:(x:number,z:number)=>void):void { if(this.active)cb(this.active.x,this.active.z); }
}
