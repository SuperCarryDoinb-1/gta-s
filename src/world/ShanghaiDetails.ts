import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/Physics';
import { BRIDGE_Z, onBridge } from './ShanghaiLayout';
import { foliageMaterial, groundPlane, limestoneMaterial, pavingMaterial, woodMaterial } from './ShanghaiSurfaces';

/** Human-scale details inspired by city builds and Shanghai's riverside streets. */
export function addShanghaiDetails(root:THREE.Group,physics:Physics):THREE.MeshStandardMaterial[] {
  const concrete=new THREE.MeshStandardMaterial({color:0xa7aaa2,roughness:.95});
  const metal=new THREE.MeshStandardMaterial({color:0x485653,roughness:.68,metalness:.18});
  const glass=new THREE.MeshStandardMaterial({color:0x78999f,roughness:.38,metalness:.12});
  const white=new THREE.MeshStandardMaterial({color:0xd6d4bf,roughness:.85});
  const yellow=new THREE.MeshStandardMaterial({color:0xb9a05f,roughness:.92});
  const green=new THREE.MeshStandardMaterial({color:0x496e65,roughness:.8});
  const warmWindow=new THREE.MeshStandardMaterial({color:0x9d987d,roughness:.5,emissive:0xa48248,emissiveIntensity:.05});
  warmWindow.userData.nightStrength=.26;
  const mesh=(geometry:THREE.BufferGeometry,mat:THREE.Material,x:number,y:number,z:number):THREE.Mesh=>{
    // Primary walls/trunks cast shadows; cosmetic trim doesn't need that pass.
    if(mat!==foliageMaterial)mat.userData.castShadow=false;
    const m=new THREE.Mesh(geometry,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;root.add(m);return m;
  };
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,mat:THREE.Material):void=>{mesh(new THREE.BoxGeometry(w,h,d),mat,x,y,z);};
  const collider=(x:number,y:number,z:number,w:number,h:number,d:number):void=>{
    physics.world.createCollider(RAPIER.ColliderDesc.cuboid(w/2,h/2,d/2).setTranslation(x,y,z));
  };
  const label=(text:string,x:number,y:number,z:number,w:number,h:number,yaw=0):void=>{
    const c=document.createElement('canvas');c.width=512;c.height=128;const g=c.getContext('2d')!;
    g.fillStyle='#263f3b';g.fillRect(0,0,512,128);g.strokeStyle='#aab6a0';g.lineWidth=4;g.strokeRect(6,6,500,116);
    g.fillStyle='#e5dfc7';g.font='500 52px "Microsoft YaHei",sans-serif';g.textAlign='center';g.fillText(text,256,85);
    const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
    const m=mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({map:t,roughness:.8,side:THREE.DoubleSide}),x,y,z);m.rotation.y=yaw;
  };
  // Limestone courses, recessed window frames and roof equipment break up blank boxes.
  for(let cz=-1;cz<=1;cz++)for(const x of [-32,0])for(const dz of [-32,0,32]) {
    const z=cz*96+dz;
    if(x===0&&z===32)continue;
    const h=13+((Math.abs(z+x)/32)%3)*3;
    const wall=new THREE.PlaneGeometry(18,h);
    const uv=wall.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*6,uv.getY(i)*h/3);
    const facade=mesh(wall,limestoneMaterial,x+9.012,h/2,z);facade.rotation.y=Math.PI/2;
    for(let floor=1;floor<h/3.1;floor++)for(const offset of [-6,-2,2,6]) {
      const y=floor*3+.9;
      box(x+9.132,y,z+offset,.025,1.72,1.58,(floor+offset+z/32)%5===0?warmWindow:glass);
      for(const edge of [-1,1]) {
        box(x+9.2,y+edge*.96,z+offset,.26,.17,2.08,limestoneMaterial);
        box(x+9.18,y,z+offset+edge*.95,.22,1.9,.12,limestoneMaterial);
      }
      box(x+9.19,y,z+offset,.08,1.74,.055,metal);
      box(x+9.19,y+.2,z+offset,.08,.055,1.65,metal);
      if(floor===1) {
        box(x+9.55,3.08,z+offset,.9,.25,2.2,limestoneMaterial);
        box(x+9.55,3.29,z+offset,.65,.17,1.95,foliageMaterial);
      }
    }
    box(x-3,h+1.15,z+1,3.5,1,2.2,concrete);
    for(let i=0;i<5;i++)box(x-3,h+1.66,z+.2+i*.35,2.9,.04,.08,metal);
    mesh(new THREE.CylinderGeometry(1.1,1.1,1.6,16),metal,x+3,h+1.45,z-3);
    box(x+3,h+2.3,z-3,2.4,.12,2.4,concrete);
    // Ground-floor entrances and striped shop awnings.
    box(x+9.15,1.35,z,.12,2.65,1.9,metal);
    box(x+9.23,1.55,z,.05,1.9,1.5,glass);
    box(x+9.32,1.18,z+.42,.13,.25,.035,white);
    const awning=mesh(new THREE.BoxGeometry(2.3,.12,7),green,x+10,3.1,z);awning.rotation.z=-.12;
    for(let stripe=0;stripe<7;stripe++)box(x+10,3.14,z-3+stripe,2.2,.025,.14,white);
    label((z/32)%2===0?'滨江咖啡':'老街书店',x+9.33,3.85,z,5.8,.7,Math.PI/2);
  }
  root.add(groundPlane(0,32,17.6,13.6,.044,4,pavingMaterial));
  // The convenience store gains glazed display windows, a striped canopy and real shelf stock.
  for(const z of [27.6,36.4]) {
    box(9.17,1.7,z,.09,2,3.4,glass);
    for(const edge of [-1,1])box(9.24,1.7,z+edge*1.75,.1,2.2,.1,white);
    box(9.25,1.7,z,.09,.08,3.5,white);
  }
  box(10.1,3.05,32,2.4,.16,13.8,green);
  for(let i=0;i<14;i++)box(10.1,3.15,25.5+i,2.4,.04,.18,white);
  box(-7.5,1.1,32,1,2.2,3.3,white);box(-6.96,1.25,32,.035,1.7,2.8,glass);
  for(const z of [27.8,36.2])for(let row=0;row<3;row++)for(let i=0;i<5;i++) {
    const bottle=mesh(new THREE.CylinderGeometry(.08,.1,.3,8),i%2?green:white,-4.45+row*.26,1.65,z-1.1+i*.5);
    bottle.rotation.z=(i%3-1)*.04;
  }
  label('营业中  OPEN',9.35,2.85,30.6,1.9,.5,Math.PI/2);
  label('滨江路  BINJIANG RD',25,2.4,5,3.1,.6,-Math.PI/2);
  // Slatted benches, bins, bollards and inspection covers provide an everyday scale.
  for(const x of [32,158])for(let z=-128;z<=128;z+=32) {
    if(BRIDGE_Z.some(v=>Math.abs(v-z)<10)||Math.abs(z-48)<9)continue;
    for(let slat=0;slat<5;slat++) {
      box(x+4,.65,z+3.72+slat*.13,2,.08,.105,woodMaterial);
      box(x+4,.9+slat*.12,z+4.38,2,.09,.07,woodMaterial);
    }
    collider(x+4,.6,z+4.1,2,1.2,.8);
    for(const off of [-.75,.75])box(x+4+off,.3,z+4.1,.08,.6,.5,metal);
    box(x+5.5,.5,z-2,.7,1,.7,green);box(x+5.5,1.04,z-2,.76,.12,.76,metal);
    box(x+5.5,.82,z-1.63,.4,.15,.02,metal);
    collider(x+5.5,.55,z-2,.7,1.1,.7);
    for(let bush=0;bush<3;bush++)mesh(new THREE.SphereGeometry(.55,10,7),foliageMaterial,x-1.3+bush*1.3,.8,z+1.45);
  }
  for(let z=-136;z<=136;z+=8) {
    if(onBridge(z,7)||Math.abs(z-48)<9)continue;
    for(const x of [29,163]) {
      mesh(new THREE.CylinderGeometry(.09,.11,.72,10),metal,x,.4,z);
      mesh(new THREE.CylinderGeometry(.095,.095,.09,10),white,x,.64,z);
    }
  }
  for(let z=-128;z<=128;z+=32) {
    const cover=mesh(new THREE.CylinderGeometry(.43,.43,.025,28),metal,18,.06,z+6);
    cover.receiveShadow=true;
    for(let i=0;i<5;i++)box(18,.077,z+5.72+i*.14,.55,.005,.025,concrete);
    for(let i=0;i<9;i++)box(22,.052,z-1.25+i*.3,.6,.025,.1,metal);
    // Raised tactile paving remains visual only and doesn't obstruct movement.
    box(25,.052,z, .5,.025,20,yellow);
    for(let i=0;i<3;i++)box(24.86+i*.14,.073,z,.035,.018,20,concrete);
    for(const x of [-16,16])for(const side of [-1,1])for(let i=0;i<6;i++) {
      box(x-2.65+i*1.05,.057,z+16+side*5.1,.43,.013,1.7,white);
    }
  }
  // Store-side parcels leave the teaching route and doorway clear.
  for(const [x,z] of [[-6,41],[-7,43],[5,42]]) {
    box(x!, .35,z!, .8,.7,.65,woodMaterial);box(x!,.72,z!,.84,.08,.7,concrete);
  }
  // Structural glass mullions turn distant solid towers into legible facades.
  for(let floor=1;floor<22;floor++)box(206,floor*3,89.06,11,.1,.08,white);
  for(let floor=1;floor<22;floor++)box(200.44,floor*3,81,.08,.07,16,concrete);
  for(let strip=0;strip<6;strip++)box(200.43,33,74+strip*2.8,.055,66,.055,concrete);
  for(let strip=0;strip<6;strip++)box(206,33,73.95+strip*2.8,.045,66,.055,metal);
  for(let level=0;level<22;level++) {
    const radius=8.85-level*.21;
    const rim=mesh(new THREE.CylinderGeometry(radius,radius,.09,5),concrete,216,level*4.35+4.3,-101);
    rim.rotation.y=level*.065;
    for(let side=0;side<5;side++)for(const offset of [-1,1]) {
      const angle=(side+.5)*Math.PI*2/5+level*.065;
      const distance=radius*Math.cos(Math.PI/5)+.04;
      const px=216+Math.sin(angle)*distance+Math.cos(angle)*radius*.16*offset;
      const pz=-101+Math.cos(angle)*distance-Math.sin(angle)*radius*.16*offset;
      const pane=mesh(new THREE.BoxGeometry(radius*.24,2.7,.04),(side+level)%7===0?warmWindow:glass,px,level*4.35+2.2,pz);
      pane.rotation.y=angle;
    }
  }
  return [warmWindow];
}
