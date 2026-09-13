import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * 程序化快艇造型（原创）：白色船体 + 菱形船首 + 深蓝驾驶舱 + 尾挂马达。
 * 原点在船底中心，+Z 为船首。三个材质槽共 3 个 draw call。
 */

const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: 0x18242f,
  roughness: 0.12,
  metalness: 0.6,
});

function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx !== 0) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

export function buildBoatModel(): THREE.Group {
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f4f0, roughness: 0.4 });
  const navyMat = new THREE.MeshStandardMaterial({ color: 0x1f3a5c, roughness: 0.5 });

  const hull = mergeGeometries([
    box(2.2, 0.7, 3.9, 0, 0.45, -0.35), // 主船体
    (() => {
      // 菱形船首（方盒转 45°）
      const g = new THREE.BoxGeometry(1.56, 0.7, 1.56);
      g.rotateY(Math.PI / 4);
      g.translate(0, 0.45, 1.7);
      return g;
    })(),
  ])!;

  const navy = mergeGeometries([
    box(2.24, 0.14, 3.6, 0, 0.86, -0.4), // 甲板包边
    box(1.5, 0.72, 1.3, 0, 1.28, -0.7), // 驾驶舱
    box(0.5, 0.62, 0.28, 0, 0.75, -2.42), // 尾挂马达
  ])!;

  const glass = box(1.42, 0.4, 0.08, 0, 1.42, -0.02, -0.4); // 前风挡（后倾）

  const group = new THREE.Group();
  const h = new THREE.Mesh(hull, hullMat);
  h.castShadow = true;
  const n = new THREE.Mesh(navy, navyMat);
  n.castShadow = true;
  group.add(h, n, new THREE.Mesh(glass, GLASS_MAT));
  return group;
}
