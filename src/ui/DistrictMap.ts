import { CHUNK_SIZE, generateChunk, type ChunkData } from '../world/City';
import { RIVER_WEST, RIVER_EAST, BRIDGE_Z, PEARL, isShanghaiCore } from '../world/ShanghaiLayout';

const SIZE = 250;
const RANGE = 400;
const SCALE = SIZE / RANGE;

/** North-up tactical map using the same seeded city footprints as the world. */
export class DistrictMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cache = new Map<string, ChunkData>();
  private readonly coordinate: HTMLElement;
  private px = 0;
  private pz = 0;
  private skip = false;
  private lastDraw = -Infinity;

  constructor(parent: HTMLElement = document.body) {
    const root = document.createElement('aside');
    root.id = 'district-minimap';
    root.setAttribute('aria-label', '街区小地图：北朝上，菱形为物资，红点为威胁');
    root.innerHTML = `<div class="radar-header"><span><i></i> 上海 · 滨江</span><b>N <span>↑</span></b><small>LIVE</small></div><div class="radar-surface"><canvas></canvas><span class="radar-range">400 m</span></div><div class="radar-footer"><span><i class="legend-loot"></i>物资</span><span><i class="legend-car"></i>载具</span><span class="radar-coordinate"></span></div>`;
    parent.append(root);
    const canvas = root.querySelector('canvas')!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);
    this.coordinate = root.querySelector('.radar-coordinate')!;
  }

  begin(px: number, pz: number): boolean {
    const now = performance.now();
    this.skip = now - this.lastDraw < 33;
    if (this.skip) return false;
    this.lastDraw = now; this.px = px; this.pz = pz;
    const g = this.ctx;
    g.clearRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#152526'; g.fillRect(0, 0, SIZE, SIZE);
    g.fillStyle = '#173b46'; g.fillRect(this.mx(RIVER_WEST), 0, (RIVER_EAST - RIVER_WEST) * SCALE, SIZE);
    for (const z of BRIDGE_Z) {
      g.fillStyle = '#708478'; g.fillRect(this.mx(RIVER_WEST), this.mz(z - 6), 96 * SCALE, 12 * SCALE);
    }
    const half = RANGE / 2;
    const startX = Math.floor((px - half) / 32) * 32;
    const startZ = Math.floor((pz - half) / 32) * 32;
    for (let x = startX; x < px + half + 32; x += 32) {
      if (x >= RIVER_WEST && x < RIVER_EAST) continue;
      for (let z = startZ; z < pz + half + 32; z += 32) {
        if (isShanghaiCore(Math.round(x / 96), Math.round(z / 96))) continue;
        g.fillStyle = '#263737';
        g.fillRect(this.mx(x - 12), this.mz(z - 12), 24 * SCALE, 24 * SCALE);
        g.strokeStyle = '#3b4d484a'; g.lineWidth = 0.7;
        g.strokeRect(this.mx(x - 12), this.mz(z - 12), 24 * SCALE, 24 * SCALE);
      }
    }
    const used = new Set<string>();
    for (let cx = Math.round((px - half) / CHUNK_SIZE); cx <= Math.round((px + half) / CHUNK_SIZE); cx++) {
      for (let cz = Math.round((pz - half) / CHUNK_SIZE); cz <= Math.round((pz + half) / CHUNK_SIZE); cz++) {
        const key = `${cx},${cz}`; used.add(key);
        let chunk = this.cache.get(key);
        if (!chunk) { chunk = generateChunk(cx, cz); this.cache.set(key, chunk); }
        if (isShanghaiCore(cx, cz)) {
          g.fillStyle = '#30423b';
          g.fillRect(this.mx(cx * 96 - 48), this.mz(cz * 96 - 48), 96 * SCALE, 96 * SCALE);
          for (const box of chunk.boxes) if (box.h < .05 && box.base >= 0 && box.color === 0x42494a) {
            g.fillStyle = '#172b28';
            g.fillRect(this.mx(box.x-box.w/2),this.mz(box.z-box.d/2),box.w*SCALE,box.d*SCALE);
          }
        }
        g.fillStyle = '#42534d'; g.strokeStyle = '#8b9d6d25'; g.lineWidth = .6;
        for (const box of chunk.boxes) {
          if (box.h < 2 || box.base > 0.1 || box.base < 0 || box.hidden || box.w < 1 || box.d < 1) continue;
          g.fillRect(this.mx(box.x - box.w / 2), this.mz(box.z - box.d / 2), box.w * SCALE, box.d * SCALE);
          g.strokeRect(this.mx(box.x - box.w / 2), this.mz(box.z - box.d / 2), box.w * SCALE, box.d * SCALE);
        }
        for (const prop of chunk.props) if (prop.type.startsWith('building-')) {
          g.fillStyle = prop.type.includes('skyscraper') ? '#526058' : '#3b4d46';
          g.fillRect(this.mx(prop.x - 3.5), this.mz(prop.z - 3.5), 7 * SCALE, 7 * SCALE);
        }
      }
    }
    for (const key of this.cache.keys()) if (!used.has(key)) this.cache.delete(key);
    // Persistent skyline meshes sit outside the streamed block footprints.
    g.fillStyle='#6c8478';g.strokeStyle='#b5c3a64d';g.lineWidth=.7;
    for(const [x,z,w,d] of [[216,-101,18,18],[228,48,17,17],[206,81,11,16],[-96,32,14,13],[200,192,26,20]]) {
      g.fillRect(this.mx(x!-w!/2),this.mz(z!-d!/2),w!*SCALE,d!*SCALE);
      g.strokeRect(this.mx(x!-w!/2),this.mz(z!-d!/2),w!*SCALE,d!*SCALE);
    }
    g.strokeStyle='#b7a3aa4d';g.beginPath();g.arc(this.mx(PEARL.x),this.mz(PEARL.z),16*SCALE,0,Math.PI*2);g.stroke();
    // Fine survey grid and quiet intersections give scale without drowning out markers.
    g.strokeStyle = '#bdcea908'; g.lineWidth = 1;
    for (let i = 0; i <= SIZE; i += 50) { g.beginPath(); g.moveTo(i,0); g.lineTo(i,SIZE); g.moveTo(0,i); g.lineTo(SIZE,i); g.stroke(); }
    this.coordinate.textContent = `${Math.round(px)} / ${Math.round(pz)}`;
    g.fillStyle = '#8bb0b6';g.font = '10px "Microsoft YaHei",sans-serif';g.textAlign = 'center';
    if (this.mx(96)>20 && this.mx(96)<SIZE-20) g.fillText('黄 浦 江',this.mx(96),30);
    const lx=this.mx(PEARL.x),lz=this.mz(PEARL.z);
    if (this.inside(lx,lz)) {
      g.strokeStyle='#d9b9c9';g.lineWidth=1.5;g.beginPath();g.arc(lx,lz,5,0,Math.PI*2);g.stroke();
      g.fillStyle='#e4cdd8';g.font='8px sans-serif';g.fillText('东方明珠',Math.min(SIZE-24,lx),lz-10);
    }
    g.textAlign='start';
    return true;
  }

  dot(x: number, z: number, color: string, r: number): void {
    if (this.skip) return;
    const mx = this.mx(x), mz = this.mz(z);
    if (!this.inside(mx,mz)) return;
    const g = this.ctx;
    const threat = color === '#ff5252' || color === '#ff9c9c';
    if (threat) {
      g.fillStyle = '#f08b79'; g.strokeStyle = '#301f1a'; g.lineWidth = 1.4;
      g.beginPath(); g.arc(mx,mz,Math.max(2.2,r),0,Math.PI*2);g.fill();g.stroke();
    } else {
      g.fillStyle = r > 2.5 ? '#b6c8c5' : '#809c9b80';
      g.fillRect(mx - 1.4, mz - 2.4, 2.8, 4.8);
    }
  }

  loot(x: number, z: number, color: string): void {
    if (this.skip) return;
    const mx = this.mx(x), mz = this.mz(z);
    if (!this.inside(mx,mz)) return;
    const g = this.ctx;
    g.save();g.translate(mx,mz);g.rotate(Math.PI/4);
    g.fillStyle = '#12241f';g.strokeStyle = color;g.lineWidth = 1.2;
    g.fillRect(-2.4,-2.4,4.8,4.8);g.strokeRect(-2.4,-2.4,4.8,4.8);g.restore();
  }

  objective(x: number, z: number): void {
    if (this.skip) return;
    const mx = Math.max(9,Math.min(SIZE-9,this.mx(x)));
    const mz = Math.max(9,Math.min(SIZE-9,this.mz(z)));
    const g = this.ctx;
    g.strokeStyle = '#e6d19c';g.lineWidth = 1.5;
    g.beginPath();g.arc(mx,mz,7,0,Math.PI*2);g.stroke();
    g.fillStyle = '#e6d19c';g.fillRect(mx-1.5,mz-1.5,3,3);
  }

  zone(x:number,z:number,radius:number,next:number):void {
    if(this.skip)return;const g=this.ctx;g.save();g.strokeStyle='#72b8e0';g.lineWidth=1.5;
    g.beginPath();g.arc(this.mx(x),this.mz(z),Math.max(.5,radius*SCALE),0,Math.PI*2);g.stroke();
    g.strokeStyle='#e0e4d2';g.setLineDash([4,3]);g.lineWidth=1;g.beginPath();g.arc(this.mx(x),this.mz(z),Math.max(.5,next*SCALE),0,Math.PI*2);g.stroke();g.restore();
  }

  service(x: number, z: number, color: string): void {
    if (this.skip) return;
    const mx = this.mx(x), mz = this.mz(z);
    if (!this.inside(mx, mz)) return;
    const g = this.ctx;
    g.strokeStyle = color; g.lineWidth = 1.2; g.fillStyle = '#132522';
    g.beginPath();g.arc(mx,mz,3.7,0,Math.PI*2);g.fill();g.stroke();
    g.fillStyle = color;g.fillRect(mx-1,mz-1,2,2);
  }

  end(headingX: number, headingZ: number): void {
    if (this.skip) return;
    const g = this.ctx;
    const angle = Math.atan2(headingX, -headingZ);
    g.save();g.translate(SIZE/2,SIZE/2);g.rotate(angle);
    const cone = g.createRadialGradient(0,0,0,0,0,65);
    cone.addColorStop(0,'#c6e0ba25');cone.addColorStop(1,'#c6e0ba00');g.fillStyle=cone;
    g.beginPath();g.moveTo(0,0);g.arc(0,0,65,-Math.PI/2-.46,-Math.PI/2+.46);g.closePath();g.fill();
    g.shadowBlur=8;g.shadowColor='#dbecc0';g.fillStyle='#e7f2ce';g.strokeStyle='#11231a';g.lineWidth=2;
    g.beginPath();g.moveTo(0,-8);g.lineTo(5,6);g.lineTo(0,3);g.lineTo(-5,6);g.closePath();g.fill();g.stroke();g.restore();
    const shade=g.createRadialGradient(SIZE/2,SIZE/2,80,SIZE/2,SIZE/2,175);
    shade.addColorStop(0,'#08151400');shade.addColorStop(1,'#081514bb');g.fillStyle=shade;g.fillRect(0,0,SIZE,SIZE);
    g.strokeStyle='#c7d3b280';g.lineWidth=1;g.beginPath();g.moveTo(14,SIZE-18);g.lineTo(14+50*SCALE,SIZE-18);g.moveTo(14,SIZE-21);g.lineTo(14,SIZE-15);g.moveTo(14+50*SCALE,SIZE-21);g.lineTo(14+50*SCALE,SIZE-15);g.stroke();
    g.fillStyle='#bbc9b0';g.font='8px monospace';g.fillText('50 m',14,SIZE-25);
  }
  private inside(x: number,z: number): boolean { return x>5&&x<SIZE-5&&z>5&&z<SIZE-5; }
  private mx(x: number): number { return (x-this.px)*SCALE+SIZE/2; }
  private mz(z: number): number { return (z-this.pz)*SCALE+SIZE/2; }
}
