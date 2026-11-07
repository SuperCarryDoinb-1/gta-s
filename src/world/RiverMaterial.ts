import * as THREE from 'three';

/** Depth-aware transmission of the actual submerged scene, with water absorption. */
export const riverMaterial = new THREE.ShaderMaterial({
  name: 'Huangpu-River',
  side: THREE.DoubleSide,
  transparent: true,
  depthWrite: false,
  fog: true,
  uniforms: THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 }, uNight: { value: 0 }, uRain: { value: 0 },
      uDeep: { value: new THREE.Color(0x316c66) },
      uShallow: { value: new THREE.Color(0x648c78) },
      uSky: { value: new THREE.Color(0xabc3c5) },
      uRefraction:{value:null},uSceneDepth:{value:null},uRefractionReady:{value:0},
      uViewport:{value:new THREE.Vector2(1,1)},uCameraNear:{value:.1},uCameraFar:{value:1000},
    },
  ]),
  vertexShader: `
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vSurfaceDepth;
    #include <fog_pars_vertex>
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      vWorldNormal = normalize(mat3(modelMatrix) * normal);
      vec4 mvPosition = viewMatrix * worldPosition;
      vSurfaceDepth=-mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform float uTime;
    uniform float uNight;
    uniform float uRain;
    uniform vec3 uDeep;
    uniform vec3 uShallow;
    uniform vec3 uSky;
    varying vec3 vWorldPosition;
    varying vec3 vWorldNormal;
    varying float vSurfaceDepth;
    uniform sampler2D uRefraction;
    uniform sampler2D uSceneDepth;
    uniform float uRefractionReady;
    uniform vec2 uViewport;
    uniform float uCameraNear;
    uniform float uCameraFar;
    #include <fog_pars_fragment>
    float hash21(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7))) * 43758.5453); }
    float noise2(vec2 p) {
      vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);
    }
    void main() {
      vec2 p = vWorldPosition.xz;
      float drift=noise2(p*.17+vec2(uTime*.035,-uTime*.021));
      float crossFlow=noise2(p*.41+vec2(-uTime*.05,uTime*.017));
      float a = p.x * 1.05 + p.y * .31 - uTime * .8 + drift * 6.;
      float b = p.x * -.43 + p.y * 1.11 + uTime * .67 + crossFlow * 4.;
      vec3 n = normalize(vWorldNormal + vec3(.055 * sin(a), 0., .045 * cos(b)));
      vec3 viewDir = normalize(cameraPosition - vWorldPosition);
      float fresnel = pow(1. - max(dot(n, viewDir), 0.), 3.);
      float shore = 1. - smoothstep(0., 9., min(abs(p.x - 48.), abs(p.x - 144.)));
      float variation = .97 + .04 * drift;
      vec3 pigment = mix(uDeep, uShallow, shore * .55) * variation;
      vec3 sky = mix(uSky, vec3(.025,.045,.065), uNight);
      vec3 color = mix(pigment * (1. - uNight * .67), sky, .07 + fresnel * .17);
      vec3 lightDir = normalize(vec3(.35,.72,.3));
      float specular = pow(max(dot(reflect(-lightDir,n),viewDir),0.),90.);
      color += vec3(.22,.24,.18) * specular * (1. - uNight) * (1. - uRain * .5);
      // Small, broken light traces under the eastern skyline rather than a glowing sheet.
      float trace = pow(max(0., sin(p.y * 2.7 + sin(p.x * .8 + uTime) * 2.)), 14.);
      float reflected = exp(-abs(p.y) * .045) * smoothstep(54.,137.,p.x);
      color += vec3(.045,.018,.028) * trace * reflected * uNight;
      color *= 1. - uRain * .12;
      vec2 screenUv=gl_FragCoord.xy/uViewport;
      vec3 viewNormal=normalize(mat3(viewMatrix)*n);
      vec2 refractedUv=clamp(screenUv+viewNormal.xy*.008,vec2(.002),vec2(.998));
      float depth=texture2D(uSceneDepth,refractedUv).x;
      float sceneDistance=(uCameraNear*uCameraFar)/(uCameraFar-(uCameraFar-uCameraNear)*depth);
      float thickness=clamp(sceneDistance-vSurfaceDepth,0.,45.);
      vec3 transmitted=texture2D(uRefraction,refractedUv).rgb;
      vec3 absorb=exp(-vec3(.045,.019,.014)*thickness);
      vec3 waterTint=mix(uDeep,uShallow,shore*.4)*(1.-uNight*.65);
      vec3 refracted=transmitted*absorb+waterTint*(1.-absorb);
      vec3 opticalNormal=gl_FrontFacing?n:-n;
      vec3 opticalRay=refract(-viewDir,opticalNormal,gl_FrontFacing?(1./1.333):1.333);
      float reflection=.0204+.9796*pow(1.-abs(dot(n,viewDir)),5.);
      bool totalInternal=dot(opticalRay,opticalRay)<.001;
      if(totalInternal)reflection=1.;
      color=mix(refracted,color,reflection);
      float alpha=gl_FrontFacing?.82:.34;
      if(!gl_FrontFacing&&totalInternal){color=waterTint*.85;alpha=.94;}
      if(uRefractionReady<.5){color=waterTint;alpha=.28;}
      gl_FragColor = vec4(color,alpha);
      #include <fog_fragment>
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

export function updateRiverMaterial(time?: number, night?: number, rain?: number): void {
  if (time !== undefined) riverMaterial.uniforms.uTime!.value = time;
  if (night !== undefined) riverMaterial.uniforms.uNight!.value = night;
  if (rain !== undefined) riverMaterial.uniforms.uRain!.value = rain;
}
