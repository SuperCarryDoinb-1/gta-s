import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const DURATION = 3.8;
const clamp = THREE.MathUtils.clamp;
const smooth = (v: number) => { const x = clamp(v, 0, 1); return x * x * (3 - 2 * x); };

/** Self-contained title cinematic; no game physics run until completion. */
export class DriftIntro {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(37, 1, .1, 90);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly car = new THREE.Group();
  private readonly suspension = new THREE.Group();
  private readonly geometry = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.Material>();
  private readonly textures = new Set<THREE.Texture>();
  private environment: THREE.WebGLRenderTarget | null = null;
  private readonly wheels: { mesh: THREE.Object3D; base: THREE.Quaternion; steer: THREE.Group; front: boolean }[] = [];
  private readonly smoke: { sprite: THREE.Sprite; offset: number; side: number }[] = [];
  private readonly rearLight = new THREE.PointLight(0xff3824, 0, 9);
  private readonly skip = document.createElement('button');
  private readonly caption = document.createElement('div');
  private readonly events = new AbortController();
  private readonly menu: HTMLElement;
  private elapsed = 0;
  private frame = 0;
  private lastTime = 0;
  private disposed = false;
  private playing = false;
  private complete: (() => void) | null = null;
  private sound: ((speed: number, skid: number) => void) | null = null;
  private phase = '';

  private constructor(menu: HTMLElement) {
    this.menu = menu;
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = .85;
    this.renderer.domElement.className = 'drift-stage';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.skip.id = 'intro-skip';
    this.skip.className = 'intro-skip';
    this.skip.textContent = '跳过开场  ↗';
    this.caption.className = 'intro-caption';
    this.caption.setAttribute('role', 'status');
    menu.append(this.renderer.domElement, this.caption, this.skip);
    this.car.add(this.suspension);
    this.scene.add(this.car);
    this.scene.add(new THREE.HemisphereLight(0xb9d5ff, 0x283654, 1));
    const key = new THREE.DirectionalLight(0xd2e3ff, 1.6);
    key.position.set(3, 7, -5);
    this.scene.add(key);
    for (const [color, x, z, intensity] of [[0x3187ff, -4, 1, 130], [0xff652c, 4, 2, 150], [0xe1f6ff, 0, -5, 70]]) {
      const light = new THREE.PointLight(color, intensity, 25);
      light.position.set(x, 3, z); this.scene.add(light);
    }
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, .04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = .65;
    room.dispose(); pmrem.dispose();
    this.resize();
    const signal = this.events.signal;
    window.addEventListener('resize', this.resize, { signal });
    this.skip.addEventListener('click', this.finish, { signal });
    window.addEventListener('keydown', event => {
      if (this.playing && event.code === 'Space' && !event.repeat) {
        event.preventDefault(); this.finish();
      }
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      this.lastTime = performance.now();
      if (document.hidden) this.sound?.(0, 0);
    }, { signal });
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
      if (event.matches) this.finish();
    }, { signal });
    this.renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.finish();
    }, { signal });
  }

  static async create(menu: HTMLElement): Promise<DriftIntro> {
    const intro = new DriftIntro(menu);
    const loader = new GLTFLoader();
    try {
      const gltf = await loader.loadAsync('/models/intro/concept-car.glb');
      intro.setupCar(gltf.scene);
      intro.setupEffects();
      // Compile before accepting a click, so first movement has no shader hitch.
      intro.renderAt(2.9);
      intro.resize();
      return intro;
    } catch (error) {
      intro.dispose();
      throw error;
    }
  }

  private setupCar(model: THREE.Group): void {
    model.rotation.y = Math.PI; // Asset front is +Z; cinematic uses -Z.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 4.5 / size.z;
    model.scale.multiplyScalar(scale);
    model.position.set(-(box.min.x + box.max.x) * .5 * scale, -box.min.y * scale, -(box.min.z + box.max.z) * .5 * scale);
    this.suspension.add(model);
    const paint = new THREE.MeshPhysicalMaterial({ color: 0x183047, metalness: .92, roughness: .24, clearcoat: 1, clearcoatRoughness: .12 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x14202d, metalness: .4, roughness: .08, clearcoat: 1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x465262, metalness: .9, roughness: .32 });
    this.materials.add(paint); this.materials.add(glass); this.materials.add(trim);
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      this.geometry.add(object.geometry);
      const existing = Array.isArray(object.material) ? object.material : [object.material];
      existing.forEach(mat => {
        this.materials.add(mat);
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.envMapIntensity = .65;
          if (/interior|leather|carpet/i.test(object.name)) mat.color.set(0x11151a);
        }
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) this.textures.add(value);
      });
      const materialName = existing[0]?.name ?? '';
      if (materialName.startsWith('Paint')) object.material = paint;
      if (materialName === 'Glass') object.material = glass;
      if (materialName.startsWith('Rim')) object.material = trim;
      if (materialName === 'License' || /Emblem/.test(object.name)) object.visible = false;
      if (materialName === 'Headlight') {
        object.material = this.material(new THREE.MeshBasicMaterial({ color: 0xd9f2ff }));
      }
      if (materialName === 'Brakelight') object.material = this.material(new THREE.MeshBasicMaterial({ color: 0xff3021 }));
    });
    this.scene.updateMatrixWorld(true);
    for (const name of ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR']) {
      const mesh = model.getObjectByName(name);
      if (!mesh) continue;
      const pos = mesh.getWorldPosition(new THREE.Vector3());
      const steer = new THREE.Group();
      this.suspension.add(steer);
      steer.position.copy(this.suspension.worldToLocal(pos));
      steer.updateMatrixWorld(true);
      const spin = new THREE.Group();
      steer.add(spin);
      // The showcase asset has baked display rotations on its tires. Use upright
      // cinematic wheels so steering and spin share a physically consistent axle.
      const wheelSize = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
      const radius = Math.max(wheelSize.y, wheelSize.z) * .48;
      mesh.visible = false;
      const rubber = this.material(new THREE.MeshStandardMaterial({ color: 0x090b0d, roughness: .88 }));
      const tireGeo = new THREE.CylinderGeometry(radius, radius, .23, 48);
      tireGeo.rotateZ(Math.PI / 2); this.geometry.add(tireGeo);
      spin.add(new THREE.Mesh(tireGeo, rubber));
      const rimGeo = new THREE.TorusGeometry(radius * .74, .027, 8, 40);
      rimGeo.rotateY(Math.PI / 2); this.geometry.add(rimGeo);
      const spokeGeo = new THREE.BoxGeometry(.04, radius * 1.4, .035);
      this.geometry.add(spokeGeo);
      for (const side of [-1, 1]) {
        const rim = new THREE.Mesh(rimGeo, trim); rim.position.x = side * .12; spin.add(rim);
        for (let i = 0; i < 5; i++) {
          const spoke = new THREE.Mesh(spokeGeo, trim);
          spoke.position.x = side * .125; spoke.rotation.x = i * Math.PI / 5; spin.add(spoke);
        }
      }
      this.wheels.push({ mesh: spin, base: spin.quaternion.clone(), steer, front: name.includes('Front') });
    }
  }

  private radialTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 2, 64, 64, 63);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(.3, 'rgba(255,255,255,.55)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    this.textures.add(texture); return texture;
  }

  private setupEffects(): void {
    const texture = this.radialTexture();
    const shadowGeo = new THREE.PlaneGeometry(3.6, 6.2);
    this.geometry.add(shadowGeo);
    const shadow = new THREE.Mesh(shadowGeo, this.material(new THREE.MeshBasicMaterial({
      map: texture, color: 0x000000, transparent: true, opacity: .65, depthWrite: false,
    })));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .012;
    this.car.add(shadow);
    for (const side of [-1, 1]) {
      const headlight = new THREE.Sprite(this.material(new THREE.SpriteMaterial({
        map: texture, color: 0xbcdfff, transparent: true, opacity: .7, depthWrite: false, blending: THREE.AdditiveBlending,
      })));
      headlight.position.set(side * .73, .57, -1.83);
      headlight.scale.set(1, .48, 1); this.car.add(headlight);
      const beamGeo = new THREE.PlaneGeometry(1.5, 6);
      this.geometry.add(beamGeo);
      const beam = new THREE.Mesh(beamGeo, this.material(new THREE.MeshBasicMaterial({
        map: texture, color: 0x86caff, transparent: true, opacity: .18, depthWrite: false, blending: THREE.AdditiveBlending,
      })));
      beam.rotation.x = -Math.PI / 2; beam.position.set(side * .8, .02, -4.2); this.car.add(beam);
    }
    this.rearLight.position.set(0, .6, 1.7); this.car.add(this.rearLight);
    for (let i = 0; i < 36; i++) {
      const sprite = new THREE.Sprite(this.material(new THREE.SpriteMaterial({
        map: texture, color: i % 3 === 0 ? 0x9cacbe : 0x647891,
        transparent: true, opacity: 0, depthWrite: false,
      })));
      this.scene.add(sprite);
      this.smoke.push({ sprite, offset: 1.05 + i * .037, side: i % 2 ? -1 : 1 });
    }
    // Tire ribbons follow the same rear-wheel path as the drift timeline.
    for (const side of [-1, 1]) {
      const points: number[] = [];
      for (let i = 0; i < 45; i++) {
        const pose = this.pose(1.15 + i / 44 * 1.5);
        const center = new THREE.Vector3(side * .77, .008, 1.25).applyAxisAngle(THREE.Object3D.DEFAULT_UP, pose.yaw).add(pose.position);
        points.push(center.x - .065, .008, center.z, center.x + .065, .008, center.z);
      }
      const indices: number[] = [];
      for (let i = 0; i < 44; i++) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      geo.setIndex(indices); geo.computeVertexNormals(); geo.setDrawRange(0, 0);
      this.geometry.add(geo);
      const mesh = new THREE.Mesh(geo, this.material(new THREE.MeshBasicMaterial({ color: 0x090d13, transparent: true, opacity: .5, side: THREE.DoubleSide, depthWrite: false })));
      mesh.name = 'skid-ribbon'; this.scene.add(mesh);
    }
  }

  private pose(time: number): { position: THREE.Vector3; yaw: number } {
    if (time < .4) return { position: new THREE.Vector3(-12, 0, .3), yaw: -Math.PI / 2 };
    if (time < 1.4) {
      const p = (time - .4);
      return { position: new THREE.Vector3(-12 + 8.4 * p, 0, .3), yaw: -Math.PI / 2 - .12 * p };
    }
    const p = clamp((time - 1.4) / 1.3, 0, 1);
    const e = 1 - (1 - p) ** 3;
    return { position: new THREE.Vector3(-3.6 * (1 - e), 0, .3 * (1 - e) + Math.sin(p * Math.PI) * .8), yaw: THREE.MathUtils.lerp(-Math.PI / 2 - .12, .22, smooth(p)) };
  }

  private renderAt(time: number): void {
    const pose = this.pose(time);
    this.car.position.copy(pose.position); this.car.rotation.y = pose.yaw;
    const drift = Math.sin(clamp((time - 1.2) / 1.5, 0, 1) * Math.PI);
    this.suspension.rotation.z = drift * -.035;
    this.suspension.position.y = time > 2.65 ? Math.sin((time - 2.65) * 22) * Math.exp(-(time - 2.65) * 8) * .028 : .015 * drift;
    const wheelAngle = time < 1.4 ? -(time - .4) * 40 : -40 - (1 - (1 - clamp((time - 1.4) / 1.3, 0, 1)) ** 3) * 15;
    for (const wheel of this.wheels) {
      wheel.mesh.quaternion.copy(wheel.base).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wheelAngle));
      wheel.steer.rotation.y = wheel.front ? -.45 * drift : 0;
    }
    this.rearLight.intensity = time > 1.35 && time < 3 ? 12 : 2;
    for (const puff of this.smoke) {
      const age = time - puff.offset;
      const material = puff.sprite.material;
      if (age < 0 || age > 1.65) { material.opacity = 0; continue; }
      const origin = this.pose(puff.offset);
      puff.sprite.position.set(puff.side * .85, .13, 1.45).applyAxisAngle(THREE.Object3D.DEFAULT_UP, origin.yaw).add(origin.position);
      puff.sprite.position.x += puff.side * age * .7;
      puff.sprite.position.y += age * .35;
      puff.sprite.position.z += age * .4;
      puff.sprite.scale.setScalar(.35 + age * 1.45);
      material.opacity = Math.sin(age / 1.65 * Math.PI) * .22;
    }
    for (const object of this.scene.children) {
      if (object instanceof THREE.Mesh && object.name === 'skid-ribbon') {
        object.geometry.setDrawRange(0, Math.floor(clamp((time - 1.15) / 1.5, 0, 1) * 44) * 6);
      }
    }
    const mobile = innerWidth < 700;
    const distance = mobile ? 15 : 8.1;
    const jolt = time > 2.65 && time < 2.9 ? Math.sin((time - 2.65) * 80) * .018 : 0;
    this.camera.position.set(4.8 + smooth(time / DURATION) * -.35, 2.5 + jolt, -distance);
    this.camera.lookAt(0, mobile ? 2.65 : 1.6, 0);
    this.renderer.render(this.scene, this.camera);
    this.menu.dataset.introPhase = time < .4 ? 'ignition' : time < 1.4 ? 'arrival' : time < 2.7 ? 'drift' : 'settled';
    const phase = this.menu.dataset.introPhase;
    if (phase !== this.phase) {
      this.phase = phase;
      this.caption.innerHTML = '<small>MIDNIGHT PURSUIT / 序章</small><strong>' +
        ({ ignition: '夜幕之下，引擎苏醒。', arrival: '属于你的，亲手拿回。', drift: '甩开追逐，改写规则。', settled: '你的夜晚，现在开始。' }[phase] ?? '') +
        '</strong><span><i></i></span>';
    }
    this.caption.style.setProperty('--intro-progress', String(clamp(time / DURATION, 0, 1)));
  }

  play(complete: () => void, sound: (speed: number, skid: number) => void): void {
    if (this.playing || this.disposed) return;
    this.complete = complete; this.sound = sound; this.playing = true; this.elapsed = 0;
    this.menu.classList.add('intro-playing');
    this.menu.querySelectorAll<HTMLElement>('.hero-body, .menu-top, .chapter-strip, .menu-bottom').forEach(el => { el.inert = true; });
    window.dispatchEvent(new Event('intro:started'));
    this.renderAt(0); this.skip.focus({ preventScroll: true });
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    this.frame = 0;
    if (!this.playing) return;
    if (!document.hidden) {
      this.elapsed += Math.min((now - this.lastTime) / 1000, .1);
      this.renderAt(this.elapsed);
      const decel = 1 - smooth((this.elapsed - 1.3) / 1.4);
      this.sound?.(this.elapsed < .4 ? 15 : 95 * decel, Math.sin(clamp((this.elapsed - 1.2) / 1.5, 0, 1) * Math.PI));
    }
    this.lastTime = now;
    if (this.elapsed >= DURATION) this.finish();
    else this.frame = requestAnimationFrame(this.tick);
  };

  private resize = (): void => {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / Math.max(1, innerHeight);
    this.camera.updateProjectionMatrix();
  };

  private finish = (): void => {
    if (!this.playing) return;
    this.playing = false;
    this.sound?.(0, 0);
    const complete = this.complete; this.complete = null;
    cancelAnimationFrame(this.frame);
    complete?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.playing = false;
    cancelAnimationFrame(this.frame); this.events.abort();
    this.sound?.(0, 0); this.sound = null; this.complete = null;
    this.geometry.forEach(g => g.dispose());
    this.materials.forEach(m => m.dispose());
    this.textures.forEach(t => t.dispose());
    this.environment?.dispose();
    this.scene.clear(); this.renderer.dispose();
    this.renderer.domElement.remove(); this.caption.remove(); this.skip.remove();
  }

  private material<T extends THREE.Material>(material: T): T {
    this.materials.add(material); return material;
  }
}
