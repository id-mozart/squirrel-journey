import * as THREE from 'three';

// Атмосферные частицы вокруг игрока: листья, пыльца, снег, светлячки. Всё считается в шейдере по времени.
const VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform float uMode; // 0 листья, 1 пыльца, 2 снег, 3 светлячки
uniform float uAmount;
uniform float uPixelRatio;
varying float vRot;
varying float vSeed;
varying float vAlpha;
varying float vMode;
void main(){
  vSeed = aSeed.x; vMode = uMode;
  float t = uTime;
  vec3 p0 = aSeed.xyz * uBox;
  float fall = uMode < 0.5 ? 0.35 + 0.4 * aSeed.w : (uMode < 1.5 ? 0.05 : (uMode < 2.5 ? 0.6 + 0.4 * aSeed.w : 0.0));
  vec3 drift = vec3(sin(t * 0.7 + aSeed.w * 20.0) * 0.6 + t * 0.15, -t * fall, cos(t * 0.5 + aSeed.z * 17.0) * 0.4);
  if (uMode > 2.5) drift = vec3(sin(t * 0.4 + aSeed.w * 30.0), sin(t * 0.9 + aSeed.y * 25.0) * 0.4, cos(t * 0.35 + aSeed.x * 21.0));
  if (uMode > 0.5 && uMode < 1.5) drift *= 0.5;
  vec3 p = p0 + drift;
  vec3 rel = mod(p - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 wp = uCenter + rel;
  float edge = 1.0 - smoothstep(uBox.x * 0.35, uBox.x * 0.5, length(rel.xz));
  vAlpha = edge * step(aSeed.w, uAmount);
  vRot = t * (1.5 + aSeed.w * 2.0) + aSeed.z * 6.28;
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  float size = uMode < 0.5 ? 0.09 + 0.05 * aSeed.w : (uMode < 1.5 ? 0.02 : (uMode < 2.5 ? 0.04 + 0.02 * aSeed.w : 0.05));
  gl_PointSize = size * 900.0 * uPixelRatio / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */`
uniform float uMode;
uniform vec3 uColor;
uniform float uTime;
varying float vRot;
varying float vSeed;
varying float vAlpha;
varying float vMode;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  vec2 q = mat2(c, -s, s, c) * p;
  float a = 0.0; vec3 col = uColor;
  if (uMode < 0.5){
    // листик: заострённый эллипс
    float t = q.x / 0.42 + 0.5;
    float w = 0.2 * pow(clamp(sin(clamp(t, 0.0, 1.0) * 3.1416), 0.0, 1.0), 0.7);
    a = step(0.0, t) * step(t, 1.0) * smoothstep(w, w - 0.05, abs(q.y));
    float r = fract(vSeed * 7.3);
    col = r < 0.3 ? vec3(0.8, 0.55, 0.1) : (r < 0.6 ? vec3(0.8, 0.3, 0.06) : (r < 0.85 ? vec3(0.55, 0.12, 0.05) : vec3(0.4, 0.22, 0.08)));
    col *= 0.8 + 0.4 * fract(vSeed * 3.1);
    col *= 1.0 - 0.35 * smoothstep(0.03, 0.0, abs(q.y)) * step(0.1, t);
  } else if (uMode < 1.5){
    a = smoothstep(0.5, 0.1, length(p));
    col = vec3(1.0, 0.95, 0.7);
  } else if (uMode < 2.5){
    float r = length(p);
    a = smoothstep(0.5, 0.25, r) * 0.9;
    col = vec3(0.95, 0.97, 1.0);
  } else {
    float r = length(p);
    float pulse = 0.5 + 0.5 * sin(uTime * 3.0 + vSeed * 40.0);
    a = smoothstep(0.5, 0.0, r) * (0.3 + 0.7 * pulse);
    col = vec3(0.7, 1.0, 0.35) * 2.5;
  }
  if (a * vAlpha < 0.02) discard;
  gl_FragColor = vec4(col, a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Particles {
  constructor(world) {
    this.group = new THREE.Group();
    this.systems = [];
    const make = (count, box, mode, blending) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      const seeds = new Float32Array(count * 4);
      for (let i = 0; i < count * 4; i++) seeds[i] = Math.random();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
      const uniforms = {
        uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(box, box * 0.6, box) },
        uMode: { value: mode }, uAmount: { value: 0 }, uPixelRatio: { value: 1 }, uColor: { value: new THREE.Color(1, 1, 1) },
      };
      const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      this.group.add(pts);
      this.systems.push({ pts, uniforms, mode });
    };
    make(500, 36, 0, THREE.NormalBlending);   // листья
    make(700, 30, 1, THREE.AdditiveBlending); // пыльца
    make(1800, 40, 2, THREE.NormalBlending);  // снег
    make(300, 40, 3, THREE.AdditiveBlending); // светлячки
    this.targets = [0, 0, 0, 0];
  }

  update(camera, playerPos, time, dt, region, night) {
    const want = [0, 0, 0, 0];
    if (region === 0) want[0] = 1;
    if (region === 1) want[1] = 1;
    if (region === 2) want[1] = 0.5;
    if (region === 4) want[2] = 1;
    if (night > 0.3) want[3] = night;
    this.systems.forEach((s, i) => {
      this.targets[i] += (want[i] - this.targets[i]) * Math.min(1, dt * 0.8);
      s.uniforms.uAmount.value = this.targets[i];
      s.uniforms.uTime.value = time;
      s.uniforms.uCenter.value.copy(playerPos).y += 4;
      s.uniforms.uPixelRatio.value = window.devicePixelRatio || 1;
      s.pts.visible = this.targets[i] > 0.01;
    });
  }
}
