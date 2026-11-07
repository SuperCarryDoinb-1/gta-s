import * as THREE from 'three';
import { riverMaterial } from './RiverMaterial';
import { WATER_LEVEL, waterSurfaceHeight } from './WaterDomain';

/** A half-resolution view of actual 3D geometry seen through the surface.
 * Above water only submerged objects are rendered; below water the pass looks
 * through the surface at the sky, ships and shore. No painted fake bottom. */
export class WaterRenderer {
  private readonly target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter});
  private readonly size=new THREE.Vector2();
  private readonly below=new THREE.Plane(new THREE.Vector3(0,-1,0),WATER_LEVEL);
  private readonly above=new THREE.Plane(new THREE.Vector3(0,1,0),-WATER_LEVEL);
  private readonly deepColor=new THREE.Color(0x305b58);
  private readonly hidden:THREE.Object3D[]=[];
  private readonly waters:(()=>THREE.Mesh[])|undefined;
  private readonly frustum=new THREE.Frustum();
  private readonly projection=new THREE.Matrix4();
  private readonly bounds=new THREE.Box3();

  constructor(waters?:()=>THREE.Mesh[]){
    this.waters=waters;
    this.target.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
    riverMaterial.uniforms.uRefraction!.value=this.target.texture;
    riverMaterial.uniforms.uSceneDepth!.value=this.target.depthTexture;
  }
  prepare(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera):void {
    const probe=camera.clone();probe.position.set(96,-2,16);
    probe.lookAt(192,14,0);this.render(renderer,scene,probe);
    probe.lookAt(-32,10,32);this.render(renderer,scene,probe);
  }
  render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera):void {
    if(this.waters) {
      camera.updateMatrixWorld();
      this.frustum.setFromProjectionMatrix(this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
      const visible=this.waters().some(water=>{
        this.bounds.min.set(water.position.x-48,water.position.y-.3,water.position.z-48);
        this.bounds.max.set(water.position.x+48,water.position.y+.3,water.position.z+48);
        return water.visible&&this.frustum.intersectsBox(this.bounds);
      });
      if(!visible)return;
    }
    renderer.getDrawingBufferSize(this.size);
    const width=Math.max(1,Math.ceil(this.size.x*.5)),height=Math.max(1,Math.ceil(this.size.y*.5));
    if(this.target.width!==width||this.target.height!==height)this.target.setSize(width,height);
    riverMaterial.uniforms.uViewport!.value.copy(this.size);
    riverMaterial.uniforms.uCameraNear!.value=camera.near;riverMaterial.uniforms.uCameraFar!.value=camera.far;
    const previousTarget=renderer.getRenderTarget(),layers=camera.layers.mask,background=scene.background;
    const clipping=renderer.clippingPlanes,shadowUpdate=renderer.shadowMap.autoUpdate;
    const underwater=camera.position.y<waterSurfaceHeight(camera.position.x,camera.position.z);
    const fog=scene.fog instanceof THREE.Fog?scene.fog:null;
    const savedFog=fog?{near:fog.near,far:fog.far,color:fog.color.clone()}:null;
    this.hidden.length=0;
    scene.traverse(o=>{
      if(o instanceof THREE.Light)o.layers.enable(2);
      if((o.name==='Huangpu-Water'||o.name==='Water-Underside')&&o.visible){this.hidden.push(o);o.visible=false;}
    });
    const sky=scene.getObjectByName('Atmosphere-Sky');
    const skyVisible=sky?.visible;
    try {
      camera.layers.set(underwater?0:2);
      renderer.clippingPlanes=[underwater?this.above:this.below];
      renderer.shadowMap.autoUpdate=false;
      scene.background=underwater?null:this.deepColor;
      if(underwater){if(sky)sky.visible=true;if(fog){fog.near=120;fog.far=650;fog.color.setHex(0x87b5d5);}}
      renderer.setRenderTarget(this.target);renderer.clear();renderer.render(scene,camera);
    } finally {
      renderer.setRenderTarget(previousTarget);renderer.clippingPlanes=clipping;renderer.shadowMap.autoUpdate=shadowUpdate;
      camera.layers.mask=layers;scene.background=background;
      if(fog&&savedFog){fog.near=savedFog.near;fog.far=savedFog.far;fog.color.copy(savedFog.color);}
      if(sky&&skyVisible!==undefined)sky.visible=skyVisible;
      for(const o of this.hidden)o.visible=true;
    }
    riverMaterial.uniforms.uRefractionReady!.value=1;
  }
}
