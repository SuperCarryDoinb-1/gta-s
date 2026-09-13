import * as THREE from 'three';
import type { PersonInstance } from './Loader';
import { wrapAngle } from './MathUtil';

/** 持有骨骼角色与当前剪辑状态的实体（行人/警察共用） */
export interface ClipHolder {
  person: PersonInstance;
  currentClip: string;
  currentAction: THREE.AnimationAction | null;
}

/** 剪辑切换（同名跳过，交叉淡入） */
export function playClip(
  holder: ClipHolder,
  name: string,
  once = false,
  timeScale = 1,
  fade = 0.2,
): void {
  const action = holder.person.actions.get(name);
  if (!action) return;
  if (holder.currentClip === name && !once) {
    action.timeScale = timeScale;
    return;
  }
  action.reset();
  action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
  action.clampWhenFinished = once;
  action.timeScale = timeScale;
  if (holder.currentAction && holder.currentAction !== action) {
    action.crossFadeFrom(holder.currentAction, fade, false);
  }
  action.play();
  holder.currentAction = action;
  holder.currentClip = name;
}

// 模块级临时量（单线程，逐实体串行使用安全）
const POSE_V = new THREE.Vector3();
const POSE_Q = new THREE.Quaternion();
const YAW_Q = new THREE.Quaternion();
const OFFSET = new THREE.Vector3();
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * 胶囊刚体插值位姿 → 骨骼角色根节点（root 原点在脚底）：
 * 位置 lerp、身体翻滚 slerp × 朝向 yaw 插值，再沿身体"下方"偏移到脚底。
 */
export function placeSkinnedRoot(
  root: THREE.Object3D,
  prevPos: THREE.Vector3,
  currPos: THREE.Vector3,
  prevQuat: THREE.Quaternion,
  currQuat: THREE.Quaternion,
  prevYaw: number,
  yaw: number,
  alpha: number,
  centerAboveFeet: number,
): void {
  POSE_V.lerpVectors(prevPos, currPos, alpha);
  POSE_Q.slerpQuaternions(prevQuat, currQuat, alpha);
  const y = prevYaw + wrapAngle(yaw - prevYaw) * alpha;
  YAW_Q.setFromAxisAngle(Y_AXIS, y);
  POSE_Q.multiply(YAW_Q);
  OFFSET.set(0, -centerAboveFeet, 0).applyQuaternion(POSE_Q);
  root.position.copy(POSE_V).add(OFFSET);
  root.quaternion.copy(POSE_Q);
}
