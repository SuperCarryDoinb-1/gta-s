const SIZE = 184; // 画布像素
const RANGE = 240; // 地图覆盖直径（米）
const SCALE = SIZE / RANGE;
const BEACH_X0 = -336; // 海岸线（沙滩→海洋）
const BEACH_X1 = -240; // 城市→沙滩

const COL_ASPHALT = '#3d3f44';
const COL_BLOCK = '#8f8c83';
const COL_SAND = '#d8c795';
const COL_SEA = '#2b5f80';

/**
 * 小地图：北朝上、以玩家为中心。城市布局是公式化网格，直接按公式绘制
 * （街区格 + 道路留缝 + 海岸分区），实体画点，玩家画朝向三角。30Hz 重绘。
 */
export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private px = 0;
  private pz = 0;
  private frame = 0;
  private skip = false;

  constructor(parent: HTMLElement = document.body) {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    canvas.style.cssText =
      'position:fixed;left:10px;bottom:10px;z-index:10;border-radius:10px;' +
      'border:2px solid rgba(255,255,255,0.25);box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
      'pointer-events:none;opacity:0.92;';
    parent.appendChild(canvas);
    this.ctx = canvas.getContext('2d')!;
  }

  /** 开始一帧：绘制地形底图。返回 false 表示本帧跳过（30Hz 节流） */
  begin(px: number, pz: number): boolean {
    this.frame++;
    this.skip = this.frame % 2 !== 0;
    if (this.skip) return false;
    this.px = px;
    this.pz = pz;
    const g = this.ctx;

    // 海洋打底 → 沙滩带 → 城市沥青
    g.fillStyle = COL_SEA;
    g.fillRect(0, 0, SIZE, SIZE);
    const bx0 = this.mx(BEACH_X0);
    const bx1 = this.mx(BEACH_X1);
    g.fillStyle = COL_SAND;
    g.fillRect(bx0, 0, Math.max(0, bx1 - bx0), SIZE);
    g.fillStyle = COL_ASPHALT;
    g.fillRect(bx1, 0, SIZE - bx1, SIZE);

    // 城市街区格（中心在 32 的倍数，24m 见方；只画城市区）
    g.fillStyle = COL_BLOCK;
    const half = RANGE / 2 + 32;
    const startX = Math.ceil((px - half) / 32) * 32;
    const startZ = Math.ceil((pz - half) / 32) * 32;
    for (let x = startX; x < px + half; x += 32) {
      if (x < BEACH_X1 + 16) continue;
      for (let z = startZ; z < pz + half; z += 32) {
        g.fillRect(this.mx(x - 12), this.mz(z - 12), 24 * SCALE, 24 * SCALE);
      }
    }
    return true;
  }

  /** 画一个实体点 */
  dot(x: number, z: number, color: string, r: number): void {
    if (this.skip) return;
    const mx = this.mx(x);
    const mz = this.mz(z);
    if (mx < 2 || mx > SIZE - 2 || mz < 2 || mz > SIZE - 2) return;
    const g = this.ctx;
    g.fillStyle = color;
    g.beginPath();
    g.arc(mx, mz, r, 0, Math.PI * 2);
    g.fill();
  }

  /** 结束一帧：画玩家朝向三角 + 北向标记 */
  end(headingX: number, headingZ: number): void {
    if (this.skip) return;
    const g = this.ctx;
    const rot = Math.atan2(headingX, -headingZ); // 北朝上
    g.save();
    g.translate(SIZE / 2, SIZE / 2);
    g.rotate(rot);
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -7);
    g.lineTo(4.6, 5);
    g.lineTo(-4.6, 5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();

    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = 'bold 11px system-ui';
    g.fillText('N', SIZE / 2 - 3.5, 13);
  }

  private mx(x: number): number {
    return (x - this.px) * SCALE + SIZE / 2;
  }

  private mz(z: number): number {
    return (z - this.pz) * SCALE + SIZE / 2;
  }
}
