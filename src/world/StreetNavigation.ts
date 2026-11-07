import * as THREE from 'three';

/** Surveyed in the supplied Street City 7 scene (6x scale, offset 34, 16). */
export const STREET_ROUTE: ReadonlyArray<readonly [number, number]> = [
  [14, 70], [14, 6], [19, -10], [32, -27], [54, -42],
  [62, -42], [63, -36], [43, -22], [27, -5], [20, 9], [20, 70], [17, 76],
];
export const STREET_WALKS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [[2, 70], [2, 18], [4, -2], [14, -23], [34, -43], [51, -52]],
  [[29, 65], [29, 20], [29, 8], [34, -7], [49, -20], [67, -32]],
];
export let streetNavigation = false;
export function enableStreetNavigation(): void { streetNavigation = true; }

interface Runner { dir: number; currPos: { x: number; y?: number; z: number } }
const targets = new WeakMap<Runner, number>();

export function placeOnStreet(car: Runner, index: number): number {
  const i = ((index % STREET_ROUTE.length) + STREET_ROUTE.length) % STREET_ROUTE.length;
  const a = STREET_ROUTE[i]!, b = STREET_ROUTE[(i + 1) % STREET_ROUTE.length]!;
  car.currPos.x = a[0]; car.currPos.z = a[1]; car.currPos.y = .12;
  targets.set(car, (i + 1) % STREET_ROUTE.length);
  const yaw = Math.atan2(b[0] - a[0], b[1] - a[1]);
  car.dir = (Math.round(yaw / (Math.PI / 2)) + 4) % 4;
  return yaw;
}

export function followStreet(car: Runner, speed: number, dt: number): number {
  let i = targets.get(car);
  if (i === undefined) {
    let best = Infinity;
    STREET_ROUTE.forEach((p, n) => {
      const d = Math.hypot(p[0] - car.currPos.x, p[1] - car.currPos.z);
      if (d < best) { best = d; i = (n + 1) % STREET_ROUTE.length; }
    });
  }
  let target = STREET_ROUTE[i!]!;
  if (Math.hypot(target[0] - car.currPos.x, target[1] - car.currPos.z) < 3) {
    i = (i! + 1) % STREET_ROUTE.length;
    target = STREET_ROUTE[i]!;
  }
  targets.set(car, i!);
  const dx = target[0] - car.currPos.x, dz = target[1] - car.currPos.z;
  const yaw = Math.atan2(dx, dz), step = Math.min(Math.hypot(dx, dz), speed * dt);
  car.currPos.x += Math.sin(yaw) * step;
  car.currPos.z += Math.cos(yaw) * step;
  car.dir = (Math.round(yaw / (Math.PI / 2)) + 4) % 4;
  return yaw;
}

export function streetStop(from: THREE.Vector3, out: THREE.Vector3): void {
  const stops = [[5, 65], [5, 25], [10, -12], [30, -36], [60, -31], [28, 54]];
  const choices = stops.filter(p => Math.hypot(p[0]! - from.x, p[1]! - from.z) > 25);
  const p = choices[Math.floor(Math.random() * choices.length)] ?? stops[0]!;
  out.set(p[0]!, .4, p[1]!);
}
