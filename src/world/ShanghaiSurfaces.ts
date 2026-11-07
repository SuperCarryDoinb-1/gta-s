import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BRIDGE_Z } from './ShanghaiLayout';

const loader = new THREE.TextureLoader();
function texture(url: string): THREE.Texture {
  const t=loader.load(url);t.colorSpace=THREE.SRGBColorSpace;
  t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
}
const paving = texture('/textures/ground/paving_color.jpg');
const asphalt = texture('/textures/ground/asphalt_color.jpg');
const asphaltNormal = loader.load('/textures/ground/asphalt_normal.jpg');
asphaltNormal.wrapS=asphaltNormal.wrapT=THREE.RepeatWrapping;asphaltNormal.anisotropy=8;
export const pavingMaterial = new THREE.MeshStandardMaterial({map:paving,color:0xc3c0b4,roughness:.92});
const asphaltMaterial = new THREE.MeshStandardMaterial({map:asphalt,normalMap:asphaltNormal,normalScale:new THREE.Vector2(.3,.3),color:0x8c9191,roughness:.91});

/** Small, deterministic original surface maps supplement the existing CC0 ground assets. */
function surfaceMap(kind: 'stone'|'wood'|'leaves'): THREE.CanvasTexture {
  const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d')!;
  let seed=93217;
  const rnd=():number=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  g.fillStyle=kind==='stone'?'#c8c0ac':kind==='wood'?'#82735a':'#66805c';g.fillRect(0,0,512,512);
  for(let i=0;i<18000;i++) {
    const shade=kind==='leaves'?45+rnd()*85:kind==='wood'?50+rnd()*90:115+rnd()*105;
    g.fillStyle=`rgba(${shade},${kind==='leaves'?shade+22:shade},${kind==='wood'?shade*.7:shade*.9},.13)`;
    g.fillRect(rnd()*512,rnd()*512,kind==='wood'?1:2,kind==='wood'?15+rnd()*35:2);
  }
  if(kind==='stone') for(let row=0;row<4;row++) {
    const y=row*128;g.strokeStyle='#968e7b';g.lineWidth=3;g.beginPath();g.moveTo(0,y);g.lineTo(512,y);g.stroke();
    g.strokeStyle='#e3ddcb';g.lineWidth=2;g.beginPath();g.moveTo(0,y+4);g.lineTo(512,y+4);g.stroke();
    for(let col=-1;col<3;col++) {const x=col*256+(row%2)*128;g.strokeStyle='#a29a87';g.lineWidth=3;g.beginPath();g.moveTo(x,y);g.lineTo(x,y+128);g.stroke();}
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;return t;
}
export const limestoneMaterial = new THREE.MeshStandardMaterial({map:surfaceMap('stone'),color:0xd2c8b6,roughness:.93});
export const woodMaterial = new THREE.MeshStandardMaterial({map:surfaceMap('wood'),color:0xc2b69d,roughness:.83});
export const foliageMaterial = new THREE.MeshStandardMaterial({map:surfaceMap('leaves'),color:0x6f8c60,roughness:1});

export function groundPlane(x:number,z:number,w:number,d:number,y:number,scale:number,material:THREE.Material):THREE.Mesh {
  const geometry=new THREE.PlaneGeometry(w,d);geometry.rotateX(-Math.PI/2);
  const uv=geometry.getAttribute('uv'),p=geometry.getAttribute('position');
  for(let i=0;i<uv.count;i++)uv.setXY(i,(p.getX(i)+x)/scale,(p.getZ(i)+z)/scale);
  const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.receiveShadow=true;return mesh;
}

export function shanghaiGround(cx:number,cz:number):THREE.Mesh[] {
  const ox=cx*96,oz=cz*96;
  const base=groundPlane(ox,oz,96,96,.033,4,pavingMaterial);
  base.name=`Shanghai-Paving-${cx}-${cz}`;
  const parts:THREE.BufferGeometry[]=[];
  const road=(x:number,z:number,w:number,d:number):void=>{
    const mesh=groundPlane(x,z,w,d,.039,8,asphaltMaterial);mesh.updateMatrix();
    mesh.geometry.applyMatrix4(mesh.matrix);parts.push(mesh.geometry);
  };
  if(cx===0) {
    for(const x of [-48,-16,16])road(x,oz,8,96);
    for(const z of [oz-48,oz-16,oz+16,oz+48])road(-10,z,76,8);
  } else if(cx===-1&&cz===0) {
    for(const x of [-144,-112,-80,-48])road(x,oz,8,96);
    for(const z of [-48,-16,16,48])road(ox,z,96,8);
  } else if(cx===2&&cz===2) {
    for(const x of [176,240])road(x,oz,8,96);
    for(const z of [144,176,208,240])road(ox,z,96,8);
  } else {
    road(238,oz,4,96);
    for(const z of BRIDGE_Z)if(Math.abs(z-oz)<=48)road(192,z,96,12);
  }
  // Each chunk owns these geometries; shared maps/materials survive unloading.
  const merged=mergeGeometries(parts)!;parts.forEach(p=>p.dispose());
  const roads=new THREE.Mesh(merged,asphaltMaterial);roads.receiveShadow=true;
  roads.name=`Shanghai-Road-${cx}-${cz}`;
  return [base,roads];
}
