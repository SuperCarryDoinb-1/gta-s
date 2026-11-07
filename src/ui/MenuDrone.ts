import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** Flying Drone 首页交互；只有指定模型成功加载后才显示。 */
export class MenuDrone {
  private readonly host = document.createElement('div');
  private readonly panel = document.createElement('div');
  private readonly events = new AbortController();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, .1, 30);
  private readonly rig = new THREE.Group();
  private renderer: THREE.WebGLRenderer | null = null;
  private environment: THREE.WebGLRenderTarget | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private model: THREE.Object3D | null = null;
  private labelAnchor: THREE.Object3D | null = null;
  private readonly projectedAnchor = new THREE.Vector3();
  private frame = 0;
  private last = 0;
  private time = 0;
  private x = innerWidth * .78;
  private y = innerHeight * .4;
  private mouse = { x: -1000, y: -1000 };
  private following = false;
  private confirming = false;
  private ready = false;
  private disposed = false;
  private enabled = true;
  private active = true;
  private readonly size = 300;
  private vx = 0;
  private vy = 0;
  private proximityUntil = 0;

  constructor(menu: HTMLElement) {
    this.host.className = 'menu-drone';
    this.host.hidden = true;
    this.panel.className = 'drone-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('role', 'group');
    this.panel.setAttribute('aria-label', '无人机控制');
    this.host.innerHTML = '<button class="drone-hit" aria-label="无人机控制"><span>侦察无人机</span></button>';
    menu.append(this.host, this.panel);
    const signal = this.events.signal;
    window.addEventListener('pointermove', e => { this.mouse = { x: e.clientX, y: e.clientY }; }, { signal });
    document.documentElement.addEventListener('pointerleave', () => { this.mouse.x = -1000; }, { signal });
    this.host.querySelector('button')!.addEventListener('click', () => this.showPanel(this.following), { signal });
    this.host.querySelector('button')!.addEventListener('focus', () => this.showPanel(this.following), { signal });
    menu.addEventListener('contextmenu', e => {
      if (!this.ready || !this.following || this.disposed || document.querySelector('dialog[open]')) return;
      e.preventDefault(); this.showPanel(true);
    }, { signal });
    this.panel.addEventListener('click', e => {
      const action = (e.target as Element).closest<HTMLButtonElement>('button')?.dataset.action;
      if (!action) return;
      if (action === 'follow') this.following = true;
      if (action === 'detach') this.following = false;
      this.confirming = false; this.panel.hidden = true;
      // 脱离时从当前位置继续巡航，不跳回固定起点。
      if (action === 'detach') this.mouse.x = -1000;
    }, { signal });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.confirming = false; this.panel.hidden = true; this.mouse.x = -1000; }
    }, { signal });
    window.addEventListener('blur', () => { this.mouse.x = -1000; }, { signal });
    window.addEventListener('intro:started', () => this.setActive(false), { signal });
    window.addEventListener('game:started', () => this.setActive(false), { signal });
    window.addEventListener('game:home', () => this.setActive(true), { signal });
    void this.load();
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  private setActive(active: boolean): void {
    this.active = active;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.last = 0;
    this.mouse.x = -1000;
    this.confirming = false;
    this.panel.hidden = true;
    this.host.hidden = !active || !this.ready;
    if (active && this.ready && !this.disposed) this.frame = requestAnimationFrame(this.tick);
  }

  private async load(): Promise<void> {
    const decoder = new DRACOLoader().setDecoderPath('/draco/');
    try {
      const gltf = await new GLTFLoader().setDRACOLoader(decoder).loadAsync('/models/drone/flying-drone.glb');
      this.model = gltf.scene;
      this.labelAnchor = this.model.getObjectByName('camera_jnt56') ?? this.model.getObjectByName('camera_jnt.56') ?? null;
      // GLTFLoader 会净化节点名称；优先使用相机骨骼，让标签随原生悬停动画移动。
      this.model.traverse(o => { if (/^camera_jnt[._]?56$/.test(o.name)) this.labelAnchor = o; });
      if (this.disposed) { this.releaseModel(); return; }
      const box = new THREE.Box3().setFromObject(this.model);
      const scale = 2.6 / Math.max(...box.getSize(new THREE.Vector3()).toArray());
      this.model.scale.setScalar(scale);
      this.model.position.copy(box.getCenter(new THREE.Vector3())).multiplyScalar(-scale);
      this.rig.add(this.model); this.scene.add(this.rig);
      this.camera.position.set(3, 2.3, 4.5); this.camera.lookAt(0, 0, 0);
      this.scene.add(new THREE.HemisphereLight(0x9ebedb, 0x141622, .85));
      const light = new THREE.DirectionalLight(0xc7dded, 1.5); light.position.set(2, 4, 3); this.scene.add(light);
      const rim = new THREE.DirectionalLight(0x468fff, 2.2); rim.position.set(-3, 1, -2); this.scene.add(rim);
      const warm = new THREE.DirectionalLight(0xff8c48, .8); warm.position.set(3, 0, -3); this.scene.add(warm);
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      this.renderer.setSize(this.size, this.size);
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = .85;
      this.renderer.domElement.setAttribute('aria-hidden', 'true');
      const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(this.renderer);
      this.environment = pmrem.fromScene(room, .04);
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = .4;
      room.dispose(); pmrem.dispose();
      this.host.prepend(this.renderer.domElement);
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(this.model);
        const hover = gltf.animations.find(clip => clip.name === 'hover');
        if (hover) this.mixer.clipAction(hover).play();
      }
      this.ready = true; this.host.hidden = !this.active;
      this.host.animate([{ opacity: 0, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: this.enabled ? 800 : 0 });
      if (this.active) this.frame = requestAnimationFrame(this.tick);
    } catch (error) {
      console.warn('Flying Drone 尚未加载；首页其余功能保持可用。', error);
      this.dispose();
    } finally { decoder.dispose(); }
  }

  private showPanel(confirm: boolean): void {
    if (!this.ready || this.disposed || !this.active) return;
    if (!this.panel.hidden && this.confirming === confirm) return;
    this.confirming = confirm;
    this.panel.innerHTML = confirm
      ? '<p>是否脱离鼠标跟随？</p><button data-action="detach">是，自由飞行</button><button data-action="cancel">否，继续跟随</button>'
      : '<p>侦察无人机 · 待命</p><button data-action="follow">无人机跟随</button>';
    this.panel.hidden = false;
    this.placePanel();
  }

  private placePanel(): void {
    if (this.panel.hidden) return;
    this.rig.updateWorldMatrix(true, true);
    this.camera.updateMatrixWorld();
    if (this.labelAnchor) this.labelAnchor.getWorldPosition(this.projectedAnchor);
    else this.rig.getWorldPosition(this.projectedAnchor);
    this.projectedAnchor.project(this.camera);
    const anchorX = this.x + this.projectedAnchor.x * this.size / 2;
    const anchorY = this.y - this.projectedAnchor.y * this.size / 2;
    const width = this.panel.offsetWidth, height = this.panel.offsetHeight;
    const left = THREE.MathUtils.clamp(anchorX - width / 2, 8, Math.max(8, innerWidth - width - 8));
    const above = anchorY + 18 + height > innerHeight - 8;
    const top = THREE.MathUtils.clamp(above ? anchorY - height - 22 : anchorY + 18, 8, Math.max(8, innerHeight - height - 8));
    this.panel.style.left = '0'; this.panel.style.top = '0';
    this.panel.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    this.panel.style.setProperty('--drone-anchor-x', `${THREE.MathUtils.clamp(anchorX - left, 12, width - 12)}px`);
    this.panel.dataset.side = above ? 'above' : 'below';
  }

  private tick = (now: number): void => {
    if (this.disposed || !this.active) return;
    const dt = Math.min((now - (this.last || now)) / 1000, .04); this.last = now;
    const paused = document.hidden || !!document.querySelector('dialog[open]');
    this.host.hidden = paused;
    if (paused) { this.panel.hidden = true; this.confirming = false; }
    if (!paused) {
      const near = Math.hypot(this.mouse.x - this.x, this.mouse.y - this.y) < 160;
      if (near) this.proximityUntil = now + 450;
      const panelHovered = this.panel.matches(':hover') || this.panel.contains(document.activeElement);
      if (!this.following && near) this.showPanel(false);
      if (!this.following && !near && !panelHovered && now > this.proximityUntil) this.panel.hidden = true;
      if (this.enabled) {
        this.time += dt;
        let tx = this.x, ty = this.y;
        if (this.panel.hidden) {
          if (this.following && this.mouse.x >= 0) {
            tx = this.mouse.x + (this.mouse.x > innerWidth - 300 ? -120 : 120);
            ty = this.mouse.y - 95;
          } else if (!this.following) {
            // 主要巡航于右侧街景，给标题和开始按钮留出阅读空间。
            tx = innerWidth * (innerWidth > 800 ? .77 : .62) + Math.sin(this.time * .23) * Math.min(110, innerWidth * .13);
            ty = innerHeight * .4 + Math.sin(this.time * .34) * Math.min(85, innerHeight * .12);
          }
        }
        tx = THREE.MathUtils.clamp(tx, 150, Math.max(150, innerWidth - 150));
        ty = THREE.MathUtils.clamp(ty, 190, Math.max(190, innerHeight - 180));
        // 临界阻尼弹簧的解析解：跟随有惯性，停靠不振荡，帧率变化不影响手感。
        const omega = this.following ? 8 : 2.2;
        const decay = Math.exp(-omega * dt);
        const dx = this.x - tx, dy = this.y - ty;
        const sx = this.vx + omega * dx, sy = this.vy + omega * dy;
        this.x = tx + (dx + sx * dt) * decay;
        this.y = ty + (dy + sy * dt) * decay;
        this.vx = (this.vx - omega * sx * dt) * decay;
        this.vy = (this.vy - omega * sy * dt) * decay;
        const turn = 1 - Math.exp(-4 * dt);
        this.rig.rotation.x = THREE.MathUtils.lerp(this.rig.rotation.x, THREE.MathUtils.clamp(this.vy * .00045, -.12, .12), turn);
        this.rig.rotation.y = THREE.MathUtils.lerp(this.rig.rotation.y, Math.sin(this.time * .4) * .12 + THREE.MathUtils.clamp(this.vx * .0008, -.28, .28), turn);
        this.rig.rotation.z = THREE.MathUtils.lerp(this.rig.rotation.z, THREE.MathUtils.clamp(-this.vx * .0005, -.16, .16), turn);
        this.mixer?.update(dt);
      }
      this.x = THREE.MathUtils.clamp(this.x, 150, Math.max(150, innerWidth - 150));
      this.y = THREE.MathUtils.clamp(this.y, 190, Math.max(190, innerHeight - 180));
      this.host.style.transform = `translate3d(${this.x - this.size / 2}px, ${this.y - this.size / 2}px, 0)`;
      this.host.dataset.state = this.following ? 'following' : 'free';
      this.placePanel();
      this.renderer?.render(this.scene, this.camera);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private releaseModel(): void {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    this.model?.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(mat);
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.events.abort();
    this.mixer?.stopAllAction();
    this.releaseModel(); this.environment?.dispose(); this.renderer?.dispose();
    this.host.remove(); this.panel.remove();
  }
}
