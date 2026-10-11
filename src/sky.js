import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

// Небо: атмосферный градиент, солнце, облака (fbm), звёзды и северное сияние для финала.
const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999; // всегда на дальней плоскости
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uCloud;
uniform float uNight;
uniform float uAurora;
uniform float uEnvPass;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int k = 0; k < 6; k++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}

void main(){
  vec3 d = normalize(vDir);
  float sunH = uSunDir.y;
  float day = smoothstep(-0.12, 0.22, sunH);
  float dusk = (1.0 - smoothstep(0.0, 0.38, abs(sunH - 0.04))) * smoothstep(-0.2, 0.0, sunH);
  vec3 zenith = mix(vec3(0.012, 0.02, 0.05), vec3(0.15, 0.36, 0.78), day);
  vec3 horizon = mix(vec3(0.05, 0.06, 0.1), vec3(0.6, 0.74, 0.9), day);
  vec2 dxz = normalize(d.xz + 1e-5);
  vec2 sxz = normalize(uSunDir.xz + 1e-5);
  float sunAz = max(dot(dxz, sxz), 0.0);
  vec3 warm = mix(vec3(1.0, 0.42, 0.12), vec3(0.95, 0.3, 0.25), 1.0 - smoothstep(0.0, 0.1, sunH));
  horizon = mix(horizon, warm, dusk * (0.3 + 0.7 * pow(sunAz, 2.0)));
  zenith = mix(zenith, vec3(0.35, 0.25, 0.4), dusk * 0.35);
  float y = d.y;
  float t = pow(1.0 - clamp(y, 0.0, 1.0), 2.4);
  vec3 col = mix(zenith, horizon, t);
  col = mix(col, horizon * 0.55, smoothstep(0.0, -0.25, y)); // под горизонтом
  // Солнце
  float cosSun = dot(d, uSunDir);
  vec3 sunCol = mix(vec3(1.0, 0.5, 0.2), vec3(1.0, 0.96, 0.9), smoothstep(0.0, 0.3, sunH));
  float disc = smoothstep(0.9993, 0.9997, cosSun);
  float glow = pow(max(cosSun, 0.0), 48.0) * 0.5 + pow(max(cosSun, 0.0), 8.0) * 0.12;
  col += sunCol * (disc * 12.0 + glow * (1.0 + dusk * 2.0)) * smoothstep(-0.08, 0.02, sunH);
  // Звёзды
  float night = 1.0 - day;
  if (night > 0.01 && y > 0.0){
    vec3 sp = d * 220.0;
    vec3 cell = floor(sp);
    float star = step(0.996, hash13(cell)) * pow(hash13(cell + 7.0), 3.0);
    float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + hash13(cell) * 30.0);
    col += vec3(0.9, 0.95, 1.0) * star * 6.0 * twinkle * night * smoothstep(0.0, 0.25, y);
    // млечный путь
    float mw = fbm(d.xy * 3.0 + d.z * 2.0) * smoothstep(0.35, 0.0, abs(d.x * 0.6 - d.y * 0.8 + 0.1));
    col += vec3(0.35, 0.4, 0.55) * mw * 0.12 * night * smoothstep(0.0, 0.2, y);
  }
  // Северное сияние
  if (uAurora > 0.001 && y > 0.05){
    vec2 auv = vec2(d.x / (y + 0.3), y);
    float band = 0.0;
    for (int k = 0; k < 3; k++){
      float fk = float(k);
      float w = fbm(vec2(auv.x * 1.5 + fk * 3.1, uTime * 0.06 + fk));
      float center = 0.25 + fk * 0.18 + w * 0.2;
      float b = exp(-pow((auv.y - center) * 9.0, 2.0));
      float curtain = fbm(vec2(auv.x * 6.0 + uTime * 0.15, fk * 5.0)) ;
      band += b * curtain * (1.0 - fk * 0.25);
    }
    vec3 ac = mix(vec3(0.1, 0.9, 0.45), vec3(0.5, 0.2, 0.8), smoothstep(0.3, 0.7, y));
    col += ac * band * uAurora * 0.9 * smoothstep(0.0, 0.3, y);
  }
  // Облака на плоскости
  if (y > 0.0 && uCloud > 0.001){
    vec2 cuv = d.xz / (y + 0.12) * 0.55;
    vec2 off = vec2(uTime * 0.008, uTime * 0.003);
    float n = fbm(cuv * 1.6 + off);
    float n2 = fbm(cuv * 4.5 + off * 2.0 + 5.0);
    float cover = smoothstep(0.55 - uCloud * 0.25, 0.75, n + n2 * 0.25);
    float fade = smoothstep(0.0, 0.18, y);
    vec3 litCol = mix(vec3(0.45, 0.5, 0.6), vec3(1.0, 0.98, 0.95), day);
    litCol = mix(litCol, vec3(1.0, 0.6, 0.35), dusk * 0.7);
    vec3 shadeCol = mix(vec3(0.15, 0.17, 0.22), vec3(0.55, 0.6, 0.72), day);
    shadeCol = mix(shadeCol, vec3(0.5, 0.3, 0.4), dusk * 0.5);
    float thick = smoothstep(0.5, 0.95, n + n2 * 0.25);
    float towardSun = 0.5 + 0.5 * dot(d, uSunDir);
    vec3 cloudCol = mix(litCol, shadeCol, thick * 0.8) * (0.7 + 0.5 * towardSun);
    col = mix(col, cloudCol, cover * fade * 0.95);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uCloud: { value: 0.5 },
      uNight: { value: 0 },
      uAurora: { value: 0 },
      uEnvPass: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
    });
    const geo = new THREE.SphereGeometry(1, 48, 24);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(4000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    // копия для рендера окружения (PMREM)
    this.envMesh = new THREE.Mesh(geo, this.material);
    this.envMesh.scale.setScalar(50);
    this.envScene = new THREE.Scene();
    this.envScene.add(this.envMesh);
  }
}

// Параметры освещения по прогрессу пути (0..1) — день от утра до заката; night — финальная ночь 0..1
export function timeOfDay(progress, night = 0) {
  // элевация солнца в градусах и азимут (0 = +Z, вперёд по маршруту)
  const keys = [[0, 22, 70], [0.2, 48, 40], [0.4, 46, -20], [0.6, 24, -35], [0.8, 10, 10], [1.0, 4, 20]];
  let elev = keys[0][1], az = keys[0][2];
  for (let i = 1; i < keys.length; i++) {
    if (progress <= keys[i][0]) {
      const t = smoothstep(keys[i - 1][0], keys[i][0], progress);
      elev = lerp(keys[i - 1][1], keys[i][1], t);
      az = lerp(keys[i - 1][2], keys[i][2], t);
      break;
    }
    elev = keys[i][1]; az = keys[i][2];
  }
  elev = lerp(elev, -12, night);
  const e = THREE.MathUtils.degToRad(elev), a = THREE.MathUtils.degToRad(az);
  const sun = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  const sunH = sun.y;
  const day = smoothstep(-0.12, 0.22, sunH);
  const dusk = (1 - smoothstep(0, 0.38, Math.abs(sunH - 0.04))) * smoothstep(-0.2, 0, sunH);
  const sunColor = new THREE.Color(1, 0.5, 0.2).lerp(new THREE.Color(1, 0.96, 0.9), smoothstep(0, 0.3, sunH));
  const sunIntensity = 3.4 * smoothstep(-0.06, 0.12, sunH);
  const horizon = new THREE.Color(0.05, 0.06, 0.1).lerp(new THREE.Color(0.6, 0.74, 0.9), day);
  const warm = new THREE.Color(1.0, 0.42, 0.12);
  horizon.lerp(warm, dusk * 0.4);
  const zenith = new THREE.Color(0.012, 0.02, 0.05).lerp(new THREE.Color(0.15, 0.36, 0.78), day);
  const fog = horizon.clone().lerp(zenith, 0.25);
  const ambientSky = zenith.clone().lerp(horizon, 0.5).multiplyScalar(lerp(0.35, 1.0, day));
  const ambientGround = new THREE.Color(0.2, 0.16, 0.1).multiplyScalar(lerp(0.3, 1.0, day));
  const moon = 1 - day;
  return { sun, sunColor, sunIntensity, fog, ambientSky, ambientGround, day, dusk, moon, elev };
}
