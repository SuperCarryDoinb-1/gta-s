import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/** Render on demand only while the inventory is paused, using the actual equipped model. */
export class CharacterPortrait {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 360 / 460, .05, 15);
  private readonly target = new THREE.WebGLRenderTarget(360, 460);
  private readonly canvas = document.createElement('canvas');
  private readonly pixels = new Uint8Array(360 * 460 * 4);

  constructor() {
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x182822);
    this.scene.add(new THREE.HemisphereLight(0xd6eaff, 0x676c52, 2.8));
    const key = new THREE.DirectionalLight(0xffecc9, 3.5); key.position.set(-3, 4, 5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x83c9ff, 2); rim.position.set(3, 1, -3); this.scene.add(rim);
    this.camera.position.set(2.4, 1.05, -4); this.camera.lookAt(0, .05, 0);
    this.canvas.width = 360; this.canvas.height = 460;
  }

  capture(renderer: THREE.WebGLRenderer, player: THREE.Group): string {
    const hero = clone(player); hero.position.set(0, 0, 0); hero.rotation.set(0, 0, 0); hero.visible = true;
    hero.updateMatrixWorld(true); this.scene.add(hero);
    const previous = renderer.getRenderTarget(), clipping = renderer.clippingPlanes;
    const shadows = renderer.shadowMap.autoUpdate;
    try {
      renderer.clippingPlanes = []; renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(this.target); renderer.clear(); renderer.render(this.scene, this.camera);
      renderer.readRenderTargetPixels(this.target, 0, 0, 360, 460, this.pixels);
      const context = this.canvas.getContext('2d')!;
      const frame = context.createImageData(360, 460);
      for (let y = 0; y < 460; y++) frame.data.set(this.pixels.subarray((459 - y) * 1440, (460 - y) * 1440), y * 1440);
      context.putImageData(frame, 0, 0);
      return this.canvas.toDataURL('image/png');
    } finally {
      this.scene.remove(hero);
      const skeletons = new Set<THREE.Skeleton>();
      hero.traverse(o => { if (o instanceof THREE.SkinnedMesh) skeletons.add(o.skeleton); });
      for (const skeleton of skeletons) skeleton.dispose();
      renderer.setRenderTarget(previous);
      renderer.clippingPlanes = clipping; renderer.shadowMap.autoUpdate = shadows;
    }
  }
}
