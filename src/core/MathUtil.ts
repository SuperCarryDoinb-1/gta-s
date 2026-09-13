/** 角度差归一化到 (-π, π]（插值/阻尼转身共用） */
export function wrapAngle(a: number): number {
  return ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}
