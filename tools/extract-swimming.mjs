import fs from 'node:fs';
import crypto from 'node:crypto';
const source='scratchpad/animation-source/';
const json=JSON.parse(fs.readFileSync(source+'AnimationLibrary_Godot_Standard.gltf'));
const binary=fs.readFileSync(source+'AnimationLibrary_Godot_Standard.bin');
const accessor=index=>{
 const a=json.accessors[index],v=json.bufferViews[a.bufferView],size={SCALAR:1,VEC3:3,VEC4:4}[a.type];
 if(a.componentType!==5126||!size)throw Error('Unexpected animation accessor');
 const offset=(v.byteOffset??0)+(a.byteOffset??0),stride=v.byteStride??size*4,result=[];
 for(let i=0;i<a.count;i++)for(let k=0;k<size;k++)result.push(binary.readFloatLE(offset+i*stride+k*4));
 return result;
};
const names=['A_TPose','Swim_Fwd_Loop','Swim_Idle_Loop'];
const clips=names.map(name=>{
 const animation=json.animations.find(a=>a.name===name);if(!animation)throw Error('Animation missing: '+name);
 return{name,tracks:animation.channels.filter(c=>c.target.path!=='scale'&&/^(root|DEF-(hips|spine|head|neck|shoulder|upper_arm|forearm|hand|thigh|shin|foot|toe))/.test(json.nodes[c.target.node].name)).map(c=>{
  const s=animation.samplers[c.sampler],times=accessor(s.input),values=accessor(s.output),size=c.target.path==='rotation'?4:3;
  const constant=values.every((v,i)=>Math.abs(v-values[i%size])<1e-6);
  return{node:c.target.node,path:c.target.path,times:constant?[times[0],times.at(-1)]:times,values:constant?[...values.slice(0,size),...values.slice(0,size)]:values,interpolation:s.interpolation??'LINEAR'};
 })};
});
const result={author:'Quaternius',license:'CC0-1.0',source:'https://quaternius.com/packs/universalanimationlibrary.html',
 mirror:'https://github.com/J-Ponzo/gltf-universal-animation-library',
 sha256:crypto.createHash('sha256').update(binary).digest('hex'),
 roots:json.scenes[json.scene].nodes,nodes:json.nodes.map(n=>({name:n.name,children:n.children,translation:n.translation,rotation:n.rotation,scale:n.scale})),clips};
const dir='public/animations/quaternius';fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(dir+'/swimming.json',JSON.stringify(result));fs.copyFileSync(source+'LICENSE',dir+'/LICENSE.txt');
console.log('Extracted authored swim clips:',names,'bytes:',fs.statSync(dir+'/swimming.json').size);
