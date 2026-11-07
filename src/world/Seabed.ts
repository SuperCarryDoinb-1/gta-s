import * as THREE from 'three';
import { seabedHeight } from './WaterDomain';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function sandMap():THREE.CanvasTexture {
  const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d')!;
  g.fillStyle='#c1baa0';g.fillRect(0,0,256,256);
  let seed=76123;const rnd=():number=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<14000;i++){const v=90+rnd()*140;g.fillStyle=`rgba(${v},${v*.96},${v*.78},.22)`;g.fillRect(rnd()*256,rnd()*256,1,1);}
  for(let y=0;y<256;y+=9){g.strokeStyle='#a8a08944';g.beginPath();for(let x=0;x<=256;x+=4){const py=y+Math.sin(x*.045+y)*2;if(x===0)g.moveTo(x,py);else g.lineTo(x,py);}g.stroke();}
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=4;return t;
}
const material=new THREE.MeshStandardMaterial({map:sandMap(),color:0xd2c6a1,roughness:1});
const rockMaterial=new THREE.MeshStandardMaterial({color:0x68766e,roughness:1,flatShading:true});
/** The same triangle grid is used for visible terrain and Rapier collision. */
export function makeSeabed(cx:number,cz:number):THREE.Mesh {
  const segments=24,side=segments+1;
  const vertices=new Float32Array(side*side*3),indices=new Uint32Array(segments*segments*6);
  for(let row=0;row<side;row++)for(let col=0;col<side;col++) {
    const x=-48+col*4,z=-48+row*4,i=(row*side+col)*3;
    vertices[i]=x;vertices[i+1]=seabedHeight(cx*96+x,cz*96+z);vertices[i+2]=z;
  }
  let n=0;
  for(let row=0;row<segments;row++)for(let col=0;col<segments;col++) {
    const a=row*side+col,b=a+1,c=a+side,d=c+1;
    indices.set([a,c,b,b,c,d],n);n+=6;
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();
  const color=new Float32Array(side*side*3),tint=new THREE.Color();
  for(let i=0;i<side*side;i++) {
    const depth=-vertices[i*3+1]!,variation=.85+Math.sin(vertices[i*3]!*.6+vertices[i*3+2]!*.4)*.09;
    tint.setRGB(.85-depth*.008,.84-depth*.005,.70-depth*.003).multiplyScalar(variation);
    color.set(tint.toArray(),i*3);
  }
  geometry.setAttribute('color',new THREE.BufferAttribute(color,3));material.vertexColors=true;
  const uv=new Float32Array(side*side*2);for(let i=0;i<side*side;i++){uv[i*2]=(vertices[i*3]!+cx*96)/6;uv[i*2+1]=(vertices[i*3+2]!+cz*96)/6;}
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Water-Seabed';mesh.position.set(cx*96,0,cz*96);mesh.receiveShadow=true;
  return mesh;
}

export function makeSeabedRocks(cx:number,cz:number):{mesh:THREE.Mesh;rocks:{x:number;y:number;z:number;r:number}[]} {
  const pieces:THREE.BufferGeometry[]=[],rocks:{x:number;y:number;z:number;r:number}[]=[];
  for(const [i,[dx,dz]]of([[-23,-28],[-8,0],[8,32],[24,-12],[34,20]] as const).entries()) {
    const x=cx*96+dx,z=cz*96+dz,r=.75+(i%3)*.28,y=seabedHeight(x,z)+.2;
    const geometry=new THREE.IcosahedronGeometry(r,1);geometry.scale(1.2,.75,.85);geometry.rotateY(i*.8);geometry.translate(x,y,z);pieces.push(geometry);
    rocks.push({x,y,z,r:r*.7});
  }
  const geometry=mergeGeometries(pieces)!;pieces.forEach(g=>g.dispose());
  const mesh=new THREE.Mesh(geometry,rockMaterial);mesh.name='Water-Seabed-Rocks';mesh.receiveShadow=true;
  return {mesh,rocks};
}
