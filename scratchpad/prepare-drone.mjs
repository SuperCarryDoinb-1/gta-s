import fs from 'node:fs';
const input=fs.readFileSync('scratchpad/drone-source-original/source/Dron volando_.glb');
const jsonLength=input.readUInt32LE(12);
const doc=JSON.parse(input.subarray(20,20+jsonLength));
// Migrate legacy diffuse texture to standard glTF metallic/roughness shading.
for(const mat of doc.materials){
 const legacy=mat.extensions?.KHR_materials_pbrSpecularGlossiness;
 if(!legacy)continue;
 mat.pbrMetallicRoughness={baseColorTexture:legacy.diffuseTexture,baseColorFactor:legacy.diffuseFactor??[1,1,1,1],metallicFactor:.25,roughnessFactor:.5};
 delete mat.extensions.KHR_materials_pbrSpecularGlossiness;
 if(!Object.keys(mat.extensions).length)delete mat.extensions;
}
for(const key of ['extensionsUsed','extensionsRequired'])if(doc[key])doc[key]=doc[key].filter(x=>x!=='KHR_materials_pbrSpecularGlossiness');
// Exporter duplicated the same texture/material for each screw. Share them.
const samplers=[], samplerKeys=new Map();
const samplerRemap=doc.samplers.map(s=>{const k=JSON.stringify(s);if(!samplerKeys.has(k)){samplerKeys.set(k,samplers.length);samplers.push(s);}return samplerKeys.get(k);});
for(const t of doc.textures)if(t.sampler!==undefined)t.sampler=samplerRemap[t.sampler];
doc.samplers=samplers;
const textures=[], textureKeys=new Map();
const remap=doc.textures.map(t=>{const k=JSON.stringify(t);if(!textureKeys.has(k)){textureKeys.set(k,textures.length);textures.push(t);}return textureKeys.get(k);});
for(const m of doc.materials)for(const info of [m.pbrMetallicRoughness.baseColorTexture,m.normalTexture,m.occlusionTexture])if(info)info.index=remap[info.index];
doc.textures=textures;
const materials=[], materialKeys=new Map();
const matRemap=doc.materials.map(m=>{const k=JSON.stringify(m);if(!materialKeys.has(k)){materialKeys.set(k,materials.length);materials.push(m);}return materialKeys.get(k);});
for(const mesh of doc.meshes)for(const p of mesh.primitives)p.material=matRemap[p.material];
doc.materials=materials;
const json=Buffer.from(JSON.stringify(doc));const padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
const tail=input.subarray(20+jsonLength);const out=Buffer.alloc(20+padded.length+tail.length);
out.writeUInt32LE(0x46546c67,0);out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);
padded.copy(out,20);tail.copy(out,20+padded.length);
fs.writeFileSync('public/models/drone/flying-drone.glb',out);
console.log({materials:materials.length,textures:textures.length,bytes:out.length});
