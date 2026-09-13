import * as THREE from 'three';

// 曳光弹共享资源（Weapons 玩家射击 / Wanted 警察还击共用同一份 geo/mat）
const TRACER_GEO = new THREE.BoxGeometry(0.03, 0.03, 1);
const TRACER_MAT = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });

/** 曳光弹网格：from→to 半程放置、朝向目标、按弹道长度拉伸；生命周期由调用方管理 */
export function makeTracer(from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh {
  const tracer = new THREE.Mesh(TRACER_GEO, TRACER_MAT);
  const len = from.distanceTo(to);
  tracer.position.lerpVectors(from, to, 0.5);
  tracer.lookAt(to);
  tracer.scale.z = len;
  return tracer;
}
