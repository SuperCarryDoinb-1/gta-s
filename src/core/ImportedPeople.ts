import * as THREE from 'three';

/** Adapt the source models' clips to the gameplay animation vocabulary. */
export function adaptPersonClips(scene: THREE.Group, source: THREE.AnimationClip[]): THREE.AnimationClip[] {
  // AnimationMixer only restores properties present in the source clip. Hips
  // translation is not keyed there, so restore every modified bone explicitly.
  const original: Array<{ bone: THREE.Bone; position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 }> = [];
  scene.traverse(o => {
    if (o instanceof THREE.Bone) original.push({ bone: o, position: o.position.clone(), rotation: o.quaternion.clone(), scale: o.scale.clone() });
  });
  const find = (...names: string[]) => {
    for (const name of names) {
      const clip = source.find(c => c.name.endsWith(`|${name}`) || c.name.endsWith(`|Man_${name}`));
      if (clip) return clip;
    }
    throw new Error(`Missing character animation: ${names.join(', ')}`);
  };
  const aliases: Record<string, string[]> = {
    Idle: ['Idle_Neutral', 'Idle'], Walking_A: ['Walk'], Running_A: ['Run'],
    Death_A: ['Death'],
    Interact: ['Interact', 'Punch'], Throw: ['Interact', 'Punch'],
    '1H_Ranged_Aiming': ['Idle_Gun_Pointing', 'Idle'],
    '2H_Ranged_Aiming': ['Idle_Gun', 'Idle'],
  };
  const clips = Object.entries(aliases).map(([name, choices]) => {
    const clip = find(...choices).clone(); clip.name = name; return clip;
  });
  // Bake transitions for every rig, preserving its own bone lengths and rest axes.
  const mixer = new THREE.AnimationMixer(scene);
  mixer.clipAction(find('Idle_Neutral', 'Idle')).play();
  mixer.update(0);
  scene.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [];
  scene.traverse(o => { if (o instanceof THREE.Bone) bones.push(o); });
  const standing = bones.map(b => ({ position: b.position.clone(), rotation: b.quaternion.clone() }));
  const node = (name: string) => bones.find(b => b.name.replaceAll('.', '').toLowerCase() === name.toLowerCase());
  const aim = (name: string, childName: string, direction: THREE.Vector3) => {
    const bone = node(name), child = node(childName);
    if (!bone || !child || !bone.parent) return;
    scene.updateMatrixWorld(true);
    const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
    const world = new THREE.Quaternion().setFromUnitVectors(from, direction).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(world);
  };
  // In-place airborne poses; physics owns the trajectory, including the roll.
  for (const side of ['L', 'R']) {
    aim(`UpperArm${side}`, `LowerArm${side}`, new THREE.Vector3(side === 'L' ? .2 : -.2, -.65, -.6));
    aim(`LowerArm${side}`, node(`Wrist${side}`) ? `Wrist${side}` : `Palm${side}`, new THREE.Vector3(0, -.4, -.9));
  }
  const airborne = bones.map((b, i) => ({ position: standing[i]!.position.clone(), rotation: b.quaternion.clone() }));
  for (const [name, from, to, duration] of [
    ['Jump_Rise', standing, airborne, .16],
    ['Jump_Fall', airborne, standing, .22],
    ['Jump_Idle', airborne, airborne, .3],
  ] as const) {
    const tracks: THREE.KeyframeTrack[] = [];
    bones.forEach((bone, i) => {
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, duration], [...from[i]!.position.toArray(), ...to[i]!.position.toArray()]));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, duration], [...from[i]!.rotation.toArray(), ...to[i]!.rotation.toArray()]));
      bone.position.copy(standing[i]!.position); bone.quaternion.copy(standing[i]!.rotation);
    });
    clips.push(new THREE.AnimationClip(name, duration, tracks));
  }
  const hips = node('Hips');
  const root = node('Root');
  const roll = source.find(c => c.name.endsWith('|Roll'));
  if (roll && hips && root?.parent) {
    // Keep the actual authored somersault, but remove its ground-level root
    // travel. The pelvis stays at the same model-space height while physics
    // carries the entire character up and back down.
    mixer.stopAllAction();
    bones.forEach((bone,i)=>{bone.position.copy(standing[i]!.position);bone.quaternion.copy(standing[i]!.rotation);});
    scene.updateMatrixWorld(true);
    const anchor=hips.getWorldPosition(new THREE.Vector3());
    const restRoot=root.position.clone(),times:number[]=[],values:number[]=[];
    const action=mixer.clipAction(roll);action.reset().play();action.paused=true;
    for(let frame=0;frame<=80;frame++) {
      const time=roll.duration*frame/80;
      root.position.copy(restRoot);action.time=time;mixer.update(0);scene.updateMatrixWorld(true);
      const current=hips.getWorldPosition(new THREE.Vector3());
      const delta=root.parent.worldToLocal(anchor.clone()).sub(root.parent.worldToLocal(current));
      times.push(time);values.push(...restRoot.clone().add(delta).toArray());
    }
    const clip=roll.clone();clip.name='Jump_Roll';
    clip.tracks=clip.tracks.filter(track=>track.name!==`${root.name}.position`);
    clip.tracks.push(new THREE.VectorKeyframeTrack(`${root.name}.position`,times,values));
    clips.push(clip);
    mixer.stopAllAction();
    bones.forEach((bone,i)=>{bone.position.copy(standing[i]!.position);bone.quaternion.copy(standing[i]!.rotation);});
    // Explicitly restore the root after a roll when blending to ordinary poses.
    for(const other of clips)if(other!==clip&&!other.tracks.some(t=>t.name===`${root.name}.position`)) {
      other.tracks.push(new THREE.VectorKeyframeTrack(`${root.name}.position`,[0,other.duration],[...restRoot.toArray(),...restRoot.toArray()]));
    }
  }
  scene.updateMatrixWorld(true);
  if (hips?.parent) {
    const target = hips.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -.45, 0));
    hips.position.copy(hips.parent.worldToLocal(target));
  }
  for (const side of ['L', 'R']) {
    aim(`UpperLeg${side}`, `LowerLeg${side}`, new THREE.Vector3(0, 0, -1));
    aim(`LowerLeg${side}`, `LowerLeg${side}_end`, new THREE.Vector3(0, -1, 0));
    aim(`UpperArm${side}`, `LowerArm${side}`, new THREE.Vector3(0, -.8, -.6));
    aim(`LowerArm${side}`, node(`Wrist${side}`) ? `Wrist${side}` : `Palm${side}`, new THREE.Vector3(0, 0, -1));
  }
  const seated = bones.map(b => ({ position: b.position.clone(), rotation: b.quaternion.clone() }));
  for (const [name, from, to] of [
    ['Sit_Chair_Idle', seated, seated],
    ['Sit_Chair_Down', standing, seated],
    ['Sit_Chair_StandUp', seated, standing],
  ] as const) {
    const tracks: THREE.KeyframeTrack[] = [];
    bones.forEach((bone, i) => {
      tracks.push(new THREE.VectorKeyframeTrack(`${bone.name}.position`, [0, .6], [...from[i]!.position.toArray(), ...to[i]!.position.toArray()]));
      tracks.push(new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, [0, .6], [...from[i]!.rotation.toArray(), ...to[i]!.rotation.toArray()]));
    });
    clips.push(new THREE.AnimationClip(name, .6, tracks));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  for (const pose of original) {
    pose.bone.position.copy(pose.position);
    pose.bone.quaternion.copy(pose.rotation);
    pose.bone.scale.copy(pose.scale);
  }
  scene.updateMatrixWorld(true);
  return clips;
}
