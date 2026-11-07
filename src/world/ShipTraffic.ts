import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Physics,RAPIER } from '../core/Physics';
import { wrapAngle } from '../core/MathUtil';

interface Ship {
  mesh:THREE.Group;body:RAPIER.RigidBody;
  previous:THREE.Vector3;position:THREE.Vector3;previousYaw:number;yaw:number;
  phase:number;lane:number;rate:number;moving:boolean;
}

/** Two cruising vessels turn before the low bridges; a freighter is moored south. */
export class ShipTraffic {
  readonly ships:Ship[]=[];
  private time=0;
  private readonly windows=new THREE.MeshStandardMaterial({color:0x456f7a,roughness:.45,metalness:.12,emissive:0x4c6659,emissiveIntensity:0});

  constructor(scene:THREE.Scene,physics:Physics) {
    for(const [index,kind]of(['passenger','cargo','freighter'] as const).entries()) {
      const mesh=this.build(kind);mesh.name=`Ship-${kind}`;scene.add(mesh);
      const position=new THREE.Vector3(index===0?118:index===1?83:124,.08,index===2?171:0);
      const body=physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(position.x,position.y,position.z));
      const length=index===0?22:index===1?18:26,width=index===2?8:7;
      physics.world.createCollider(RAPIER.ColliderDesc.cuboid(width*.43,.8,length*.42).setTranslation(0,.1,0),body);
      const ship:Ship={mesh,body,previous:position.clone(),position,previousYaw:0,yaw:0,phase:index===0?-.6:1.1,lane:position.x,rate:index===0?.036:.026,moving:index!==2};
      this.ships.push(ship);this.advance(ship,0);body.setTranslation(ship.position,true);body.setRotation({x:0,y:Math.sin(ship.yaw/2),z:0,w:Math.cos(ship.yaw/2)},true);
      ship.previous.copy(ship.position);ship.previousYaw=ship.yaw;mesh.position.copy(ship.position);mesh.rotation.y=ship.yaw;
    }
  }
  private advance(ship:Ship,dt:number):void {
    if(!ship.moving)return;
    ship.phase+=dt*ship.rate;
    ship.position.set(ship.lane+Math.cos(ship.phase)*3,.08+Math.sin(this.time*.8+ship.lane)*.045,8+Math.sin(ship.phase)*61);
    ship.yaw=Math.atan2(-Math.sin(ship.phase)*3,Math.cos(ship.phase)*61);
  }
  fixedUpdate(dt:number):void {
    this.time+=dt;
    for(const ship of this.ships){
      ship.previous.copy(ship.position);ship.previousYaw=ship.yaw;this.advance(ship,dt);
      ship.body.setNextKinematicTranslation(ship.position);
      ship.body.setNextKinematicRotation({x:0,y:Math.sin(ship.yaw/2),z:0,w:Math.cos(ship.yaw/2)});
    }
  }
  update(alpha:number,night:number):void {
    this.windows.emissiveIntensity=night*.25;
    for(const ship of this.ships){ship.mesh.position.lerpVectors(ship.previous,ship.position,alpha);ship.mesh.rotation.y=ship.previousYaw+wrapAngle(ship.yaw-ship.previousYaw)*alpha;}
  }
  forEachShip(cb:(x:number,z:number)=>void):void {for(const ship of this.ships)cb(ship.position.x,ship.position.z);}

  private build(kind:'passenger'|'cargo'|'freighter'):THREE.Group {
    const root=new THREE.Group(),passenger=kind==='passenger',length=passenger?22:kind==='cargo'?18:26,width=kind==='freighter'?8:7;
    const white=new THREE.MeshStandardMaterial({color:0xd8d9cb,roughness:.75});
    const hull=new THREE.MeshStandardMaterial({color:passenger?0x345b65:0x654d43,roughness:.8});
    const metal=new THREE.MeshStandardMaterial({color:0x56686b,roughness:.7,metalness:.2});
    const deck=new THREE.MeshStandardMaterial({color:0x9b9680,roughness:.95});
    const mesh=(geometry:THREE.BufferGeometry,material:THREE.Material,x:number,y:number,z:number):THREE.Mesh=>{
      const m=new THREE.Mesh(geometry,material);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;root.add(m);return m;
    };
    const box=(x:number,y:number,z:number,w:number,h:number,d:number,m:THREE.Material):void=>{mesh(new THREE.BoxGeometry(w,h,d),m,x,y,z);};
    const shell=mesh(new THREE.CylinderGeometry(1,.78,1.5,8),hull,0,.1,0);shell.scale.set(width/2,1,length/2);
    box(0,.89,0,width*.86,.12,length*.79,deck);
    box(0,1.02,length*.33,width*.45,.2,1.1,white);
    if(passenger) {
      box(0,1.9,-1,width*.76,1.8,length*.55,white);
      box(0,2.92,-1,width*.86,.22,length*.65,white);
      box(0,3.5,-4.5,3.2,1.1,3.2,white);box(0,4.13,-4.5,3.5,.15,3.5,metal);
      for(const side of [-1,1])for(let i=0;i<7;i++)box(side*width*.385,2.1,-6+i*1.65,.06,1.0,1.25,this.windows);
      box(0,3.55,-2.88,2.65,.7,.06,this.windows);
    } else {
      box(0,2.15,-length*.29,width*.7,2.5,3.8,white);box(0,3.55,-length*.29,width*.8,.2,4.2,white);
      box(0,2.7,-length*.29+1.94,width*.58,.8,.06,this.windows);
      for(const [index,color]of([0x627a72,0xa36d4f,0x7a8390]).entries()) {
        const m=new THREE.MeshStandardMaterial({color,roughness:.9});
        box(0,1.95,-2+index*3.5,width*.75,2,3.3,m);
        for(const side of [-1,1])for(let line=0;line<7;line++)box(side*width*.381,1.95,-3.35+index*3.5+line*.44,.06,1.8,.045,metal);
      }
    }
    for(const side of [-1,1])for(let z=-length*.32;z<=length*.32;z+=2.4){box(side*width*.43,1.4,z,.06,.85,.06,metal);}
    for(const side of [-1,1])box(side*width*.43,1.8,0,.07,.07,length*.65,white);
    box(0,4.7,-length*.29,.08,2,.08,metal);
    for(const [side,color]of([[-1,0xb75c4e],[1,0x73a783]] as const))mesh(new THREE.SphereGeometry(.075,8,6),new THREE.MeshBasicMaterial({color}),side*width*.42,2.9,-length*.25);
    root.updateMatrixWorld(true);
    const batches=new Map<THREE.Material,THREE.BufferGeometry[]>(),source:THREE.Mesh[]=[];
    root.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material)){
      const geometry=(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(o.matrixWorld);
      let list=batches.get(o.material);if(!list)batches.set(o.material,list=[]);list.push(geometry);source.push(o);
    }});
    for(const m of source){m.removeFromParent();m.geometry.dispose();}
    for(const [material,geometries]of batches){const geometry=mergeGeometries(geometries)!;geometries.forEach(g=>g.dispose());const m=new THREE.Mesh(geometry,material);m.castShadow=true;m.receiveShadow=true;root.add(m);}
    root.traverse(o=>{if(o instanceof THREE.Mesh)o.layers.enable(2);});
    return root;
  }
}
