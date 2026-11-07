import * as THREE from 'three';

interface SourceTrack { node: number; path: 'translation'|'rotation'|'scale'; times: number[]; values: number[]; interpolation: string }
interface SwimData {
  roots: number[];
  nodes: Array<{ name: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }>;
  clips: Array<{ name: string; tracks: SourceTrack[] }>;
}

export async function loadSwimAnimations(): Promise<SwimData> {
  const response = await fetch('/animations/quaternius/swimming.json');
  if (!response.ok) throw new Error('Cannot load authored swimming animations');
  return response.json() as Promise<SwimData>;
}

/** Transfer authored full-body motion in a shared reference frame. The imported
 * rigs have different rest axes and root-parented IK feet, so renaming tracks or
 * rotating only arms/legs is insufficient. Bone lengths remain the target's. */
export function retargetSwimAnimations(target: THREE.Group, data: SwimData): THREE.AnimationClip[] {
  const saved: Array<{ object: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }> = [];
  let skin: THREE.SkinnedMesh | undefined;
  const bones: THREE.Bone[] = [];
  target.traverse(o => {
    saved.push({ object:o, p:o.position.clone(), q:o.quaternion.clone(), s:o.scale.clone() });
    if (o instanceof THREE.Bone) bones.push(o);
    if (!skin && o instanceof THREE.SkinnedMesh) skin=o;
  });
  if (!skin) throw new Error('Swimming requires a skinned character');
  target.updateMatrixWorld(true);
  const bindTransform = skin.matrixWorld.clone().multiply(skin.bindMatrix.clone().invert());
  const bindWorld = new Map<THREE.Bone, THREE.Matrix4>();
  skin.skeleton.bones.forEach((b,i) => bindWorld.set(b,bindTransform.clone().multiply(skin!.skeleton.boneInverses[i]!.clone().invert())));
  // Traverse parent-first, including the separately parented feet.
  for (const bone of bones) {
    const world=bindWorld.get(bone); if (!world) continue;
    bone.parent!.updateWorldMatrix(true,false);
    const local=bone.parent!.matrixWorld.clone().invert().multiply(world);
    local.decompose(bone.position,bone.quaternion,bone.scale);bone.updateMatrixWorld(true);
  }
  target.updateMatrixWorld(true);
  const rest=bones.map(b=>({p:b.position.clone(),q:b.quaternion.clone(),s:b.scale.clone(),world:b.getWorldQuaternion(new THREE.Quaternion())}));
  const key=(name:string)=>name.replaceAll('.','').toLowerCase();
  const bone=(name:string)=>bones.find(b=>key(b.name)===key(name));
  const body=bone('Body')!;
  if (!body) throw new Error('Swimming body root missing');
  const anchor=body.getWorldPosition(new THREE.Vector3());
  const source=new THREE.Group();
  const nodes=data.nodes.map(n=>{const b=new THREE.Bone();b.name=n.name.replaceAll('.','');if(n.translation)b.position.fromArray(n.translation);if(n.rotation)b.quaternion.fromArray(n.rotation);if(n.scale)b.scale.fromArray(n.scale);return b;});
  data.nodes.forEach((n,i)=>n.children?.forEach(child=>nodes[i]!.add(nodes[child]!)));
  data.roots.forEach(i=>source.add(nodes[i]!));
  const sourceClips=data.clips.map(c=>new THREE.AnimationClip(c.name,-1,c.tracks.map(t=>{
    const name=`${nodes[t.node]!.name}.${t.path==='translation'?'position':t.path==='rotation'?'quaternion':'scale'}`;
    return t.path==='rotation'?new THREE.QuaternionKeyframeTrack(name,t.times,t.values):new THREE.VectorKeyframeTrack(name,t.times,t.values);
  })));
  const sourceBone=(name:string)=>nodes.find(n=>key(n.name)===key(name))!;
  const mixer=new THREE.AnimationMixer(source), reference=mixer.clipAction(sourceClips.find(c=>c.name==='A_TPose')!);
  reference.play();mixer.update(0);source.updateMatrixWorld(true);
  const basis=(head:THREE.Object3D,left:THREE.Object3D,right:THREE.Object3D,hip:THREE.Object3D)=>{
    const x=left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3())).normalize();
    const y=head.getWorldPosition(new THREE.Vector3()).sub(hip.getWorldPosition(new THREE.Vector3()));y.addScaledVector(x,-y.dot(x)).normalize();
    const z=new THREE.Vector3().crossVectors(x,y).normalize();return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,y,z));
  };
  const align=basis(bone('Head')!,bone('ShoulderL')!,bone('ShoulderR')!,body)
    .multiply(basis(sourceBone('DEF-head'),sourceBone('DEF-shoulderL'),sourceBone('DEF-shoulderR'),sourceBone('DEF-hips')).invert());
  const mapping:Record<string,string>={body:'DEF-hips',hips:'DEF-hips',abdomen:'DEF-spine001',torso:bone('Chest')?'DEF-spine002':'DEF-spine003',chest:'DEF-spine003',neck:'DEF-neck',head:'DEF-head'};
  for(const side of ['L','R'])for(const [to,from] of [['Shoulder','shoulder'],['UpperArm','upper_arm'],['LowerArm','forearm'],['Wrist','hand'],['Palm','hand'],['UpperLeg','thigh'],['LowerLeg','shin'],['Foot','foot']])mapping[key(to!+side)]=`DEF-${from}${side}`;
  const transfers=bones.map((b,i)=>{
    const src=mapping[key(b.name)]?sourceBone(mapping[key(b.name)]!):undefined;
    return src?{target:b,source:src,offset:src.getWorldQuaternion(new THREE.Quaternion()).premultiply(align).invert().multiply(rest[i]!.world)}:null;
  });
  const feet=['L','R'].map(side=>{
    const foot=bone(`Foot${side}`),shin=bone(`LowerLeg${side}`);
    return foot&&shin?{foot,shin,offset:shin.worldToLocal(foot.getWorldPosition(new THREE.Vector3()))}:null;
  }).filter(p=>p!==null);
  const result:THREE.AnimationClip[]=[];
  mixer.stopAllAction();
  for(const [sourceName,name] of [['Swim_Fwd_Loop','Swim_Forward'],['Swim_Idle_Loop','Swim_Idle']]) {
    const clip=sourceClips.find(c=>c.name===sourceName)!;if(!clip)throw new Error(`Authored swim missing: ${sourceName}`);
    const action=mixer.clipAction(clip);action.reset().play();action.paused=true;
    const count=Math.ceil(clip.duration*30),times:number[]=[],positions=bones.map(()=>[] as number[]),rotations=bones.map(()=>[] as number[]);
    for(let frame=0;frame<=count;frame++) {
      const time=clip.duration*frame/count;action.time=time;mixer.update(0);source.updateMatrixWorld(true);
      bones.forEach((b,i)=>{b.position.copy(rest[i]!.p);b.quaternion.copy(rest[i]!.q);b.scale.copy(rest[i]!.s);});
      target.updateMatrixWorld(true);
      for(const transfer of transfers) {
        if(!transfer)continue;
        const b=transfer.target;b.parent!.updateWorldMatrix(true,false);
        const world=transfer.source.getWorldQuaternion(new THREE.Quaternion()).premultiply(align).multiply(transfer.offset);
        b.quaternion.copy(b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(world);
        if(b===body)b.position.copy(b.parent!.worldToLocal(anchor.clone()));
        b.updateMatrixWorld(true);
      }
      // Feet are IK bones under Root, not children of their shins in these rigs.
      // Attach their translation to the animated ankle, preserving bind offsets.
      for(const {foot,shin,offset}of feet){foot.position.copy(foot.parent!.worldToLocal(shin.localToWorld(offset.clone())));foot.updateMatrixWorld(true);}
      times.push(time);bones.forEach((b,i)=>{positions[i]!.push(...b.position.toArray());rotations[i]!.push(...b.quaternion.toArray());});
    }
    const tracks:THREE.KeyframeTrack[]=[];
    bones.forEach((b,i)=>{
      tracks.push(new THREE.VectorKeyframeTrack(`${b.name}.position`,times,positions[i]!));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`,times,rotations[i]!));
    });
    result.push(new THREE.AnimationClip(name!,clip.duration,tracks));mixer.stopAllAction();
  }
  mixer.uncacheRoot(source);
  saved.forEach(p=>{p.object.position.copy(p.p);p.object.quaternion.copy(p.q);p.object.scale.copy(p.s);});target.updateMatrixWorld(true);
  target.userData.swimAnimationSource='Quaternius Universal Animation Library / Swim_Fwd_Loop + Swim_Idle_Loop';
  return result;
}
