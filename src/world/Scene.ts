import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

const DAY_LENGTH_S = 240; // 一昼夜的真实秒数
const START_TIME = 0.38; // ≈ 09:07 开局

const FOG_DAY = new THREE.Color(0x87b5d5);
const FOG_NIGHT = new THREE.Color(0x0b1220);
const FOG_RAIN = new THREE.Color(0x76828c);
const SUN_DAY = new THREE.Color(0xfff4e0);
const SUN_DUSK = new THREE.Color(0xff9550);
const MOON = new THREE.Color(0x9db4ff);

export interface Environment {
  /** 每帧调用：推进昼夜、更新光照/天空/雾，并让光照跟随玩家。rain 为雨量 0~1 */
  update(dt: number, target: THREE.Vector3, rain?: number): void;
  /** 快进时间（0~1 的昼夜比例，0.08 ≈ 2 小时） */
  skip(amount: number): void;
  /** 夜晚程度 0（白天）~1（深夜），供路灯/窗灯/车灯使用 */
  readonly nightFactor: number;
  /** 时钟文本 HH:MM */
  readonly clock: string;
}

/**
 * 昼夜循环环境：物理散射天空 + 太阳/月光方向光 + 半球光/环境光/雾随时间渐变。
 * 太阳沿东西向圆轨道运行，落山后切换为高角度微弱月光（保证夜间阴影方向稳定）。
 */
export function setupEnvironment(scene: THREE.Scene): Environment {
  scene.fog = new THREE.Fog(FOG_DAY.getHex(), 80, 300);

  const sky = new Sky();
  sky.scale.setScalar(900);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity']!.value = 6;
  skyUniforms['rayleigh']!.value = 2.2;
  skyUniforms['mieCoefficient']!.value = 0.004;
  skyUniforms['mieDirectionalG']!.value = 0.8;
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0x87b5d5, 0xb0a890, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sun.castShadow = true;
  // 2048 贴图 + ±45m 覆盖：范围更大（停靠车/行道树都有影子）且影缘更细腻
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -45;
  sun.shadow.camera.right = 45;
  sun.shadow.camera.top = 45;
  sun.shadow.camera.bottom = -45;
  sun.shadow.radius = 4; // 软化影缘（硬锯齿边一眼假）
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  let time01 = START_TIME;
  let night = 0;
  const sunDir = new THREE.Vector3();
  const lightDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3(-0.35, 0.75, -0.3).normalize();
  const fogColor = new THREE.Color();

  return {
    get nightFactor(): number {
      return night;
    },

    get clock(): string {
      const mins = Math.floor(time01 * 24 * 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    },

    skip(amount: number): void {
      time01 = (time01 + amount) % 1;
    },

    update(dt: number, target: THREE.Vector3, rain = 0): void {
      time01 = (time01 + dt / DAY_LENGTH_S) % 1;
      // t=0.25 日出，0.5 正午，0.75 日落
      const theta = (time01 - 0.25) * Math.PI * 2;
      const elev = Math.sin(theta);
      sunDir.set(Math.cos(theta), elev, 0.35).normalize();

      const day = THREE.MathUtils.smoothstep(elev, -0.06, 0.28);
      night = 1 - day;
      const horizon = Math.max(0, 1 - Math.abs(elev) / 0.35); // 日出日落程度

      // 方向光：白天跟太阳走，夜里切月光方向（高角度，阴影不乱甩）；雨天整体压暗
      lightDir.copy(elev > 0.12 ? sunDir : moonDir);
      sun.position.copy(target).addScaledVector(lightDir, 60);
      sun.target.position.copy(target);
      sun.intensity = (1.9 * day + 0.14) * (1 - 0.55 * rain);
      sun.color.copy(SUN_DAY).lerp(SUN_DUSK, horizon).lerp(MOON, night);

      hemi.intensity = (0.55 * day + 0.09) * (1 - 0.3 * rain);
      ambient.intensity = 0.15 * day + 0.06;

      // 雨雾：更浓更灰（夜里保留夜色基调）
      fogColor.copy(FOG_DAY).lerp(FOG_NIGHT, night).lerp(FOG_RAIN, rain * (1 - night * 0.65));
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(fogColor);
      fog.near = 80 - 38 * rain;
      fog.far = 300 - 115 * rain;

      skyUniforms['sunPosition']!.value.copy(sunDir);
      skyUniforms['turbidity']!.value = 6 + 10 * rain; // 阴沉天
      sky.position.copy(target);
    },
  };
}
