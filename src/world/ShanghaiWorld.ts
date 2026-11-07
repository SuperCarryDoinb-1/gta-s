import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics, RAPIER } from '../core/Physics';
import { BRIDGE_Z, PEARL, districtName } from './ShanghaiLayout';
import { addShanghaiDetails } from './ShanghaiDetails';
import { foliageMaterial } from './ShanghaiSurfaces';

/** Compact, original Shanghai-inspired scenery, built on the existing city engine. */
export class ShanghaiWorld {
  readonly root = new THREE.Group();
  readonly pearl = new THREE.Group();
  private readonly nightMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly nightLights: THREE.PointLight[] = [];
  private readonly region = document.createElement('div');
  private shownRegion = '';
  private readonly physics: Physics;
  readonly architectureCollider: RAPIER.Collider;

  constructor(scene: THREE.Scene, physics: Physics) {
    this.physics = physics;
    this.root.name = 'Shanghai-Binjiang';
    scene.add(this.root);
    const stone = this.material(0xd8d3c3), silver = this.material(0xbbc7c6, .55, .2);
    const darkGlass = this.material(0x3c6271, .3, .12), pink = this.material(0xac4168, .36, .2);
    pink.emissive.setHex(0xd81f63); this.nightMaterials.push(pink);
    pink.userData.nightStrength = .22;
    const pearlLed = this.material(0xe28caa, .45, .2);
    pearlLed.emissive.setHex(0xf55597);this.nightMaterials.push(pearlLed);
    const light = this.material(0xdcc4a1); light.emissive.setHex(0xffd390); this.nightMaterials.push(light);
    const lawn = this.material(0x667d53), bark = this.material(0x685e48);
    const steel = this.material(0x4b696b, .4, .22);

    this.pearl.name = 'Oriental-Pearl'; this.pearl.position.set(PEARL.x, 0, PEARL.z);
    this.root.add(this.pearl);
    this.mesh(new THREE.CylinderGeometry(15, 16, .3, 48), stone, PEARL.x, .15, 0);
    this.mesh(new THREE.CylinderGeometry(11, 13, 1.1, 36), silver, PEARL.x, .55, 0);
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      const low = new THREE.Vector3(PEARL.x + Math.cos(angle) * 11, .8, Math.sin(angle) * 11);
      const high = new THREE.Vector3(PEARL.x + Math.cos(angle) * 4, 28, Math.sin(angle) * 4);
      this.beam(low, high, 1.2, silver);
      this.mesh(new THREE.SphereGeometry(2.7, 16, 12), pink, low.x, 4.5, low.z);
    }
    this.mesh(new THREE.CylinderGeometry(2.1, 3, 39, 24), silver, PEARL.x, 47, 0);
    this.mesh(new THREE.CylinderGeometry(1.15, 1.8, 22, 20), silver, PEARL.x, 81, 0);
    for (const [height, radius] of [[29, 10.8], [66, 7.8], [91, 3.4]]) {
      this.mesh(new THREE.SphereGeometry(radius!, 40, 28), pink, PEARL.x, height!, 0);
      this.mesh(new THREE.CylinderGeometry(radius! * 1.005, radius! * 1.005, radius! * .25, 48), darkGlass, PEARL.x, height!, 0);
      for (const sign of [-1, 1]) this.ring(PEARL.x, height! + sign * radius! * .16, 0, radius! * .99, .16, silver);
      for (const sign of [-1, 1]) this.ring(PEARL.x, height! + sign * radius! * .45, 0, radius! * .9, .075, pearlLed);
      for (let meridian = 0; meridian < 4; meridian++) {
        const rib=this.mesh(new THREE.TorusGeometry(radius! * 1.002,.055,5,64),pearlLed,PEARL.x,height!,0);
        rib.rotation.y=meridian*Math.PI/4;
      }
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4;
        this.beam(new THREE.Vector3(PEARL.x + Math.cos(a) * radius! * .42, height! - radius! * .88, Math.sin(a) * radius! * .42),
          new THREE.Vector3(PEARL.x + Math.cos(a) * radius! * .91, height! - radius! * .4, Math.sin(a) * radius! * .91), .12, silver);
      }
    }
    this.mesh(new THREE.CylinderGeometry(.25, .8, 21, 12), silver, PEARL.x, 105, 0);
    this.mesh(new THREE.SphereGeometry(.65, 12, 8), light, PEARL.x, 116, 0);
    // Circular plaza inlays and planting beds frame the tower without closing its paths.
    this.ring(PEARL.x, .06, 0, 24, .16, steel);
    this.ring(PEARL.x, .065, 0, 29, .12, steel);
    for (const z of [-38, 38]) {
      this.cube(192, .12, z, 43, .24, 4, stone);
      this.cube(192, .25, z, 41, .2, 3, lawn);
    }

    // A recognisable, deliberately scaled skyline rather than a 1:1 reconstruction.
    const towerGlass = this.material(0x749b9f, .28, .2);
    towerGlass.emissive.setHex(0x467e9a); this.nightMaterials.push(towerGlass);
    towerGlass.userData.nightStrength = .23;
    for (let i = 0; i < 22; i++) {
      const level = this.mesh(new THREE.CylinderGeometry(8.7 - i * .21, 9 - i * .21, 4.4, 5), towerGlass, 216, i * 4.35 + 2.2, -101);
      level.rotation.y = i * .065;
    }
    for (let i = 0; i < 9; i++) {
      const w = 17 - i * 1.25;
      this.cube(228, 3 + i * 6, 48, w, 6, w, steel);
      this.cube(228, 6.2 + i * 6, 48, w + .6, .5, w + .6, silver);
    }
    this.mesh(new THREE.ConeGeometry(3.5, 10, 4), silver, 228, 61, 48);
    this.cube(206, 33, 81, 11, 66, 16, darkGlass);
    this.cube(206, 73, 75, 11, 14, 4, darkGlass);this.cube(206, 73, 87, 11, 14, 4, darkGlass);
    this.cube(206, 81, 81, 11, 2, 16, silver);
    // The exact closed building geometry also forms the fixed collision surface:
    // tower shafts, spheres, legs, twisted floors, roof bridges and antenna.
    // Build before decorative furniture is added, so leaves/signs aren't walls.
    this.root.updateMatrixWorld(true);
    const geometry: THREE.BufferGeometry[] = [];
    this.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
        geometry.push(g);
      }
    });
    const solid = mergeGeometries(geometry);
    if (!solid?.index) throw new Error('Shanghai structural collision geometry missing');
    this.architectureCollider = physics.world.createCollider(RAPIER.ColliderDesc.trimesh(
      solid.getAttribute('position').array as Float32Array, Uint32Array.from(solid.index.array),
    ).setFriction(.65).setRestitution(.02));
    geometry.forEach(g => g.dispose()); solid.dispose();

    // Riverside furniture and trees: broadleaf trees replace the old beach palms.
    for (const x of [32, 158]) for (let z = -128; z <= 128; z += 32) {
      if (BRIDGE_Z.some(v => Math.abs(v-z) < 10) || Math.abs(z-48) < 9) continue;
      this.cube(x, .2, z, 4.8, .4, 4.8, stone);this.cube(x, .42, z, 4.2, .06, 4.2, lawn);
      this.mesh(new THREE.CylinderGeometry(.18,.24,3,8), bark,x,1.9,z);
      for (const [dx,dy,dz,r] of [[0,4.7,0,1.9],[-1.2,4.1,.4,1.55],[1.25,4.5,.25,1.5],[.1,4,-1.2,1.5],[.2,6,.1,1.3]]) {
        this.mesh(new THREE.SphereGeometry(r!,14,10),foliageMaterial,x+dx!,dy!,z+dz!);
      }
      this.beam(new THREE.Vector3(x,2,z),new THREE.Vector3(x-1.2,4.1,z+.4),.09,bark);
      this.beam(new THREE.Vector3(x,2.6,z),new THREE.Vector3(x+1.25,4.5,z+.25),.08,bark);
      this.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(1.8,.22).setTranslation(x,1.8,z));
      this.cube(x+4,.5,z+4,2,.18,.6,stone);this.cube(x+4,.3,z+4.2,1.7,.6,.1,steel);
    }
    for (const x of [27, 165]) for (let z = -132; z <= 132; z += 24) {
      if (BRIDGE_Z.some(v => Math.abs(v-z) < 9)) continue;
      this.mesh(new THREE.CylinderGeometry(.07,.1,5,8),steel,x,2.5,z);
      this.cube(x,5,z,.6,.3,.6,light);
    }
    for (const z of BRIDGE_Z) {
      for (const x of [59, 133]) {
        this.cube(x,2.8,z-6.2,.6,5.5,.6,silver);this.cube(x,2.8,z+6.2,.6,5.5,.6,silver);
        this.cube(x,5.6,z,.6,.4,13,steel);
        this.beam(new THREE.Vector3(x,5.6,z-6),new THREE.Vector3(x+12,.6,z-6),.1,silver);
        this.beam(new THREE.Vector3(x,5.6,z+6),new THREE.Vector3(x-12,.6,z+6),.1,silver);
      }
    }
    // Four shallow steps at each bank let swimmers return to land.
    for (let i = 0; i < 5; i++) {
      const y = -.18 - i * .25;
      this.cube(48+i*1.2,y-.25,48,1.3,.5,6,stone);this.collider(48+i*1.2,y-.25,48,1.3,.5,6);
      this.cube(144-i*1.2,y-.25,48,1.3,.5,6,stone);this.collider(144-i*1.2,y-.25,48,1.3,.5,6);
    }
    // Searchable clothing fronts and an open patrol supply shelter, reachable on foot.
    this.sign('海派衣橱', 'CLOTHING / BLUE JACKET', 9.24, 2.6, 5, 5.5, .9, Math.PI/2);
    this.sign('工装劳保', 'WORKWEAR / ORANGE', 9.24, 2.6, 70, 5.5, .9, Math.PI/2);
    this.cube(40, 2.5, -24, 3.3, .14, 3.4, steel);
    this.cube(41.5, 1.2, -24, .12, 2.4, 3.1, steel); this.collider(41.5, 1.2, -24, .12, 2.4, 3.1);
    for (const z of [-25.5, -22.5]) {
      this.cube(38.6, 1.2, z, .12, 2.4, .12, steel); this.collider(38.6, 1.2, z, .12, 2.4, .12);
    }
    this.cube(40.8, .4, -24.7, .65, .8, .75, lawn); this.collider(40.8, .4, -24.7, .65, .8, .75);
    this.sign('滨江巡防补给', 'PATROL / PROTECTIVE GEAR', 38.4, 2.15, -24, 3.2, .55, -Math.PI/2);
    this.sign('东方明珠', 'ORIENTAL PEARL', 176, 2, -23, 10, 2, -Math.PI/2);
    this.sign('滨江便利店', 'BINJIANG MARKET · OPEN', 9.22, 3.6, 32, 11, 1.2, Math.PI/2);
    this.sign('外滩 · 滨江步道', 'THE BUND / RIVERSIDE', 35, 2.1, 19, 7, 1.1, -Math.PI/2);
    this.sign('陆家嘴  →  沿江过桥', 'LUJIAZUI / CROSS VIA BRIDGE', 33, 1.8, 65, 7, 1.1, -Math.PI/2);
    this.sign('浦江大桥', 'HUANGPU CROSSING', 37, 3, 112, 8, 1.4, -Math.PI/2);
    for (const [x,y,z] of [[35,5,16],[3,3,32]]) {
      const lamp=new THREE.PointLight(0xffdeb0,0,24,1.5);lamp.position.set(x!,y!,z!);
      this.root.add(lamp);this.nightLights.push(lamp);
    }
    // Road markings follow the same compact grid used by traffic.
    const roadPaint=this.material(0xc7af6c);
    for (let z=-140;z<144;z+=6) {
      if (Math.abs(((z+16)%32+32)%32)<6) continue;
      for(const x of [15.8,16.2])this.cube(x,.055,z,.1,.009,2,roadPaint);
    }
    this.nightMaterials.push(...addShanghaiDetails(this.root,physics));
    this.root.updateMatrixWorld(true);
    this.batchStaticMeshes();
    this.region.id = 'shanghai-location';
    document.body.append(this.region);
  }

  update(pos: THREE.Vector3, night: number): void {
    for (const mat of this.nightMaterials) mat.emissiveIntensity = .03 + night * (mat.userData.nightStrength ?? .8);
    for (const light of this.nightLights) light.intensity = night * 18;
    const name = districtName(pos.x,pos.z);
    if (name !== this.shownRegion) {
      this.shownRegion = name;
      this.region.innerHTML = `<small>SHANGHAI / 自由探索</small><strong>${name}</strong>`;
    }
  }

  private material(color: number, roughness = .85, metalness = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({color,roughness,metalness});
  }
  private mesh(geometry: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry,mat);mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;
    this.root.add(mesh);return mesh;
  }
  private cube(x:number,y:number,z:number,w:number,h:number,d:number,mat:THREE.Material): void {
    this.mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z);
  }
  private collider(x:number,y:number,z:number,w:number,h:number,d:number): void {
    this.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setTranslation(x,y,z));
  }
  private beam(from:THREE.Vector3,to:THREE.Vector3,r:number,mat:THREE.Material): void {
    const delta=to.clone().sub(from),mid=from.clone().add(to).multiplyScalar(.5);
    const mesh=this.mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),mat,mid.x,mid.y,mid.z);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  }
  private ring(x:number,y:number,z:number,r:number,tube:number,mat:THREE.Material): void {
    const mesh=this.mesh(new THREE.TorusGeometry(r,tube,6,64),mat,x,y,z);mesh.rotation.x=-Math.PI/2;
  }
  private sign(title:string,subtitle:string,x:number,y:number,z:number,w:number,h:number,yaw:number): void {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=256;
    const g=canvas.getContext('2d')!;g.fillStyle='#243b38';g.fillRect(0,0,1024,256);
    g.strokeStyle='#c9bd90';g.lineWidth=7;g.strokeRect(9,9,1006,238);
    g.fillStyle='#eee6cc';g.textAlign='center';g.font='600 76px "Microsoft YaHei",sans-serif';g.fillText(title,512,118);
    g.fillStyle='#aabfa8';g.font='27px sans-serif';g.fillText(subtitle,512,192);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const mat=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
    const mesh=this.mesh(new THREE.PlaneGeometry(w,h),mat,x,y,z);mesh.rotation.y=yaw;
  }
  private batchStaticMeshes(): void {
    const batches=new Map<THREE.Material,THREE.BufferGeometry[]>();
    const source:THREE.Mesh[]=[];
    this.root.traverse(o=>{if(o instanceof THREE.Mesh && !Array.isArray(o.material)) {
      const geometry=o.geometry.clone().applyMatrix4(o.matrixWorld);
      let list=batches.get(o.material);if(!list)batches.set(o.material,list=[]);list.push(geometry);source.push(o);
    }});
    for(const mesh of source){mesh.removeFromParent();mesh.geometry.dispose();}
    for(const [mat,geometries] of batches){
      const merged=mergeGeometries(geometries);if(!merged)throw Error('Shanghai geometry batching failed');
      const mesh=new THREE.Mesh(merged,mat);mesh.castShadow=mat.userData.castShadow!==false;mesh.receiveShadow=true;this.root.add(mesh);
      geometries.forEach(g=>g.dispose());
    }
  }
}
