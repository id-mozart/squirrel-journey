import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp } from './noise.js';

const SHELLS = 14;

// ---------------------------------------------------------------- Шейдер меха (shell-техника)
const FUR_PARS_VERT = /* glsl */`
attribute vec3 aDir;
uniform float uShells;
uniform float uFurLen;
uniform vec3 uComb;
uniform float uTime;
varying float vShell;
varying vec3 vDir;
`;
const FUR_VERT = /* glsl */`
float shell = float(gl_InstanceID) / (uShells - 1.0);
vShell = shell; vDir = aDir;
vec3 transformed = position + normal * (uFurLen * shell) + uComb * (uFurLen * shell * shell * 1.4) + vec3(0.0, -1.0, 0.0) * (uFurLen * shell * shell * 0.3);
`;
const FUR_PARS_FRAG = /* glsl */`
uniform vec3 uColorTop;
uniform vec3 uColorBelly;
uniform vec3 uBellyDir;
uniform float uBellyAmt;
uniform float uDensity;
uniform float uTipLight;
varying float vShell;
varying vec3 vDir;
float hashF(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;
const FUR_FRAG = /* glsl */`
{
  vec3 d = normalize(vDir);
  vec3 a = abs(d); vec2 uv; float face;
  if (a.x >= a.y && a.x >= a.z){ uv = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z){ uv = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { uv = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  uv = uv * uDensity + face * 37.0;
  vec2 cell = floor(uv); vec2 f = fract(uv) - 0.5;
  float r1 = hashF(cell), r2 = hashF(cell + 0.37), r3 = hashF(cell + 0.71);
  f -= (vec2(r2, r3) - 0.5) * 0.5;
  float strandH = 0.45 + 0.55 * r1;
  float t = vShell / strandH;
  float rad = 0.78 * pow(max(0.0, 1.0 - t), 0.75) * (0.8 + 0.2 * r2);
  float alpha = vShell < 0.001 ? 1.0 : smoothstep(rad, rad - 0.3, length(f)) * step(vShell, strandH);
  float belly = smoothstep(0.1, 0.6, dot(d, uBellyDir)) * uBellyAmt;
  vec3 base = mix(uColorTop, uColorBelly, belly);
  float ao = mix(0.35, 1.0, vShell);
  vec3 col = base * ao * (0.88 + 0.24 * r3);
  col = mix(col, col * 1.45, smoothstep(0.55, 1.0, t) * uTipLight);
  diffuseColor = vec4(col, alpha);
}
`;

function furMaterial({ top, belly, bellyDir = [0, -1, 0.2], bellyAmt = 1, furLen = 0.02, density = 40, tipLight = 0.5, comb = [0, 0, -0.6] }) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, alphaTest: 0.5, alphaToCoverage: true, side: THREE.FrontSide });
  const uniforms = {
    uShells: { value: SHELLS }, uFurLen: { value: furLen }, uComb: { value: new THREE.Vector3(...comb) }, uTime: { value: 0 },
    uColorTop: { value: new THREE.Color(...top) }, uColorBelly: { value: new THREE.Color(...belly) },
    uBellyDir: { value: new THREE.Vector3(...bellyDir).normalize() }, uBellyAmt: { value: bellyAmt },
    uDensity: { value: density }, uTipLight: { value: tipLight },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + FUR_PARS_VERT)
      .replace('#include <begin_vertex>', FUR_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FUR_PARS_FRAG)
      .replace('#include <map_fragment>', FUR_FRAG);
  };
  mat.customProgramCacheKey = () => 'fur';
  mat.userData.uniforms = uniforms;
  return mat;
}

function ellipsoidGeometry(rx, ry, rz, detail = 3, deform = null) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const dir = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    d.copy(v).normalize();
    dir[i * 3] = d.x; dir[i * 3 + 1] = d.y; dir[i * 3 + 2] = d.z;
    v.set(d.x * rx, d.y * ry, d.z * rz);
    if (deform) deform(v, d);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

const smoothTo = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class Squirrel {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.position.set(0, 0.135, 0);
    this.root.add(this.body);
    this.furMats = [];
    this.time = 0;

    const top = [0.2, 0.19, 0.22], belly = [0.8, 0.8, 0.76], dark = [0.13, 0.13, 0.16];
    const addFur = (parent, geo, pos, opts, rot = null) => {
      const mat = furMaterial(opts);
      const mesh = new THREE.InstancedMesh(geo, mat, SHELLS);
      const m = new THREE.Matrix4();
      for (let i = 0; i < SHELLS; i++) mesh.setMatrixAt(i, m);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.position.set(...pos);
      if (rot) mesh.rotation.set(...rot);
      mesh.castShadow = geo.attributes.position.count > 700; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      this.furMats.push(mat);
      return mesh;
    };

    // Туловище
    this.torso = addFur(this.body, ellipsoidGeometry(0.082, 0.08, 0.15, 4, (v, d) => { v.y += 0.012 * Math.max(0, -d.z) * (1 - Math.abs(d.y)); }), [0, 0, 0], { top, belly, furLen: 0.022, density: 55, tipLight: 0.3 });
    this.chest = addFur(this.body, ellipsoidGeometry(0.068, 0.066, 0.078, 4), [0, 0.008, 0.1], { top, belly, bellyDir: [0, -1, 0.5], furLen: 0.018, density: 45, tipLight: 0.3 });
    // Голова
    this.neck = new THREE.Group();
    this.neck.position.set(0, 0.055, 0.145);
    this.body.add(this.neck);
    const headGeo = ellipsoidGeometry(0.05, 0.047, 0.06, 4, (v, d) => {
      const s = clamp((d.z - 0.25) / 0.75, 0, 1);
      v.z += 0.022 * s * s * (1 - Math.abs(d.y) * 0.6);
      v.x *= 1 - 0.38 * s * s;
      v.y -= 0.01 * s * s;
      // лоб чуть выше
      v.y += 0.006 * Math.max(0, d.y) * (1 - s);
    });
    this.head = addFur(this.neck, headGeo, [0, 0.02, 0.05], { top: [0.22, 0.21, 0.24], belly, bellyDir: [0, -1, 0.75], bellyAmt: 0.9, furLen: 0.011, density: 34, tipLight: 0.2, comb: [0, -0.2, -0.7] });
    const hc = new THREE.Vector3(0, 0.02, 0.05);
    // Щёки
    for (const s of [-1, 1]) addFur(this.neck, ellipsoidGeometry(0.02, 0.018, 0.024, 3), [hc.x + s * 0.03, hc.y - 0.012, hc.z + 0.03], { top: [0.26, 0.25, 0.28], belly, bellyDir: [0, -1, 0.3], bellyAmt: 0.8, furLen: 0.01, density: 12, tipLight: 0.2 });
    // Уши
    this.ears = [];
    for (const s of [-1, 1]) {
      const ear = addFur(this.neck, ellipsoidGeometry(0.013, 0.019, 0.006, 3), [hc.x + s * 0.03, hc.y + 0.043, hc.z - 0.008], { top: [0.24, 0.24, 0.27], belly: [0.6, 0.52, 0.5], bellyDir: [0, 0, 1], bellyAmt: 0.6, furLen: 0.008, density: 9, tipLight: 0.3, comb: [0, 1, 0] }, [-0.25, 0, -s * 0.45]);
      this.ears.push(ear);
    }
    // Глаза, нос, усы
    const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0806, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.5 });
    const eyeGeo = new THREE.SphereGeometry(0.0175, 24, 16);
    this.eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(hc.x + s * 0.034, hc.y + 0.015, hc.z + 0.03);
      eye.scale.set(1, 1.08, 0.8);
      this.neck.add(eye);
      this.eyes.push(eye);
      // обводка глаза (светлая)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0185, 0.0022, 8, 24), new THREE.MeshStandardMaterial({ color: 0x1c1816, roughness: 0.95 }));
      ring.position.copy(eye.position).add(new THREE.Vector3(s * 0.002, 0, 0.001));
      ring.lookAt(ring.position.clone().add(new THREE.Vector3(s * 1, 0.1, 0.5)));
      this.neck.add(ring);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 12, 10), new THREE.MeshPhysicalMaterial({ color: 0x1a0d0a, roughness: 0.35, clearcoat: 0.6 }));
    nose.position.set(hc.x, hc.y - 0.008, hc.z + 0.081);
    nose.scale.set(1.2, 0.9, 1);
    this.neck.add(nose);
    const whiskerPts = [];
    for (const s of [-1, 1]) for (let k = 0; k < 4; k++) {
      const a = (k - 1.5) * 0.28;
      whiskerPts.push(hc.x + s * 0.02, hc.y - 0.005 + k * 0.004, hc.z + 0.06);
      whiskerPts.push(hc.x + s * 0.11, hc.y - 0.01 + Math.sin(a) * 0.045 + 0.01, hc.z + 0.08 + Math.cos(a) * 0.02 - 0.02);
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(whiskerPts, 3));
    this.neck.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xd9cbb0, transparent: true, opacity: 0.7 })));

    // Передние лапы
    this.shoulders = []; this.elbows = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.05, -0.005, 0.1); this.body.add(sh);
      addFur(sh, ellipsoidGeometry(0.02, 0.05, 0.021, 3), [0, -0.032, 0], { top, belly, bellyDir: [-s, -0.5, 0.5], bellyAmt: 0.6, furLen: 0.011, density: 10, tipLight: 0.3, comb: [0, -0.6, 0] });
      const el = new THREE.Group(); el.position.set(0, -0.07, 0); sh.add(el);
      addFur(el, ellipsoidGeometry(0.015, 0.012, 0.027, 3), [0, -0.005, 0.012], { top: dark, belly: dark, bellyAmt: 0, furLen: 0.007, density: 8, tipLight: 0.3, comb: [0, 0, 0.6] });
      this.shoulders.push(sh); this.elbows.push(el);
    }
    // Задние лапы
    this.hips = []; this.knees = []; this.ankles = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(s * 0.055, -0.01, -0.085); this.body.add(hip);
      addFur(hip, ellipsoidGeometry(0.045, 0.068, 0.072, 3), [0, 0, 0], { top, belly, bellyDir: [-s * 0.6, -1, 0.2], bellyAmt: 0.7, furLen: 0.02, density: 30, tipLight: 0.3 });
      const knee = new THREE.Group(); knee.position.set(s * 0.012, -0.045, -0.02); hip.add(knee);
      addFur(knee, ellipsoidGeometry(0.017, 0.042, 0.018, 3), [0, -0.03, 0.01], { top, belly, bellyAmt: 0.3, furLen: 0.01, density: 10, tipLight: 0.3, comb: [0, -0.6, 0] });
      const ankle = new THREE.Group(); ankle.position.set(0, -0.062, 0.006); knee.add(ankle);
      addFur(ankle, ellipsoidGeometry(0.016, 0.011, 0.045, 3), [0, -0.004, 0.028], { top: dark, belly: dark, bellyAmt: 0, furLen: 0.007, density: 10, tipLight: 0.3, comb: [0, 0, 0.6] });
      this.hips.push(hip); this.knees.push(knee); this.ankles.push(ankle);
    }
    // Хвост — у летяги плоский и широкий, работает как руль
    this.tail = [];
    const NT = 13;
    for (let i = 0; i < NT; i++) {
      const t = i / (NT - 1);
      const r = 0.026 + 0.046 * Math.pow(Math.sin(t * Math.PI), 0.7) * (1 - t * 0.2);
      const mesh = addFur(this.root, ellipsoidGeometry(r * 1.25, r * 0.5, r, 3), [0, 0.14, -0.15 - i * 0.035], {
        top: [0.18, 0.18, 0.21], belly: [0.55, 0.55, 0.55], bellyDir: [0, -1, 0], bellyAmt: 0.5,
        furLen: 0.024 + 0.012 * Math.sin(t * Math.PI), density: 22, tipLight: 0.45, comb: [0, 0, 0.9],
      });
      this.tail.push({ mesh, pos: new THREE.Vector3(), target: new THREE.Vector3(), init: false, k: lerp(45, 12, t) });
    }
    this.buildMembranes();

    // Текущие значения анимации
    this.cur = { pitch: 0, lift: 0, hip: [0, 0], knee: [0.5, 0.5], shoulder: [0, 0], elbow: [0, 0], spread: 0, headPitch: 0, headYaw: 0, earTilt: 0, sit: 0, climb: 0, glide: 0, air: 0, swim: 0, run: 0 };
    this.phase = 0;
    this.blink = 0;
    this.lookTimer = 0; this.lookYaw = 0;
    this.pose = { state: 'idle', speed: 0, vy: 0, moving: false, climbDir: 0 };
    this.forward = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._v3 = new THREE.Vector3();
  }

  // Ориентация: forward (направление тела) и up (нормаль опоры)
  setTransform(position, forward, up) {
    this.root.position.copy(position);
    const z = this._v1.copy(forward).normalize();
    const y = this._v2.copy(up).normalize();
    const x = this._v3.crossVectors(y, z).normalize();
    y.crossVectors(z, x).normalize();
    this._m.makeBasis(x, y, z);
    this._q.setFromRotationMatrix(this._m);
    this.root.quaternion.slerp(this._q, 0.35);
    this.forward.copy(forward); this.up.copy(up);
  }

  setPose(p) { Object.assign(this.pose, p); }
  resetTail() { for (const seg of this.tail) seg.init = false; }

  // Летательная перепонка (патагий) между передними и задними лапами
  buildMembranes() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5, alphaToCoverage: true });
    const uniforms = { uTop: { value: new THREE.Color(0.15, 0.14, 0.17) }, uBelly: { value: new THREE.Color(0.78, 0.78, 0.74) }, uBodyUp: { value: new THREE.Vector3(0, 1, 0) } };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMemUv; varying vec3 vMemN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMemUv = uv; vMemN = normalize(mat3(modelMatrix) * normal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMemUv; varying vec3 vMemN; uniform vec3 uTop; uniform vec3 uBelly; uniform vec3 uBodyUp;\nfloat mhash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }\nfloat mnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(mhash(i), mhash(i + vec2(1, 0)), u.x), mix(mhash(i + vec2(0, 1)), mhash(i + vec2(1, 1)), u.x), u.y); }')
        .replace('#include <map_fragment>', `{
          vec3 fn = gl_FrontFacing ? vMemN : -vMemN;
          float topSide = smoothstep(-0.2, 0.2, dot(normalize(fn), uBodyUp));
          float n = mnoise(vMemUv * vec2(70.0, 40.0)) * 0.6 + mnoise(vMemUv * vec2(200.0, 120.0)) * 0.4;
          vec3 col = mix(uBelly, uTop, topSide) * (0.78 + 0.44 * n);
          // светлая кромка перепонки
          col = mix(col, vec3(0.95, 0.95, 0.93), smoothstep(0.2, 0.0, 1.0 - vMemUv.x) * 0.6);
          float edge = min(1.0 - vMemUv.x, min(vMemUv.y, 1.0 - vMemUv.y) * 2.5);
          float fringe = smoothstep(0.0, 0.14, edge + (mnoise(vMemUv * vec2(90.0, 60.0)) - 0.5) * 0.16);
          diffuseColor = vec4(col, fringe);
        }`);
    };
    mat.customProgramCacheKey = () => 'membrane';
    this.membraneUniforms = uniforms;
    this.membranes = [];
    const NU = 8, NV = 6;
    for (const s of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(1, 1, NU - 1, NV - 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.membranes.push({ mesh, side: s, NU, NV });
    }
  }

  updateMembranes() {
    this.root.updateMatrixWorld(true);
    const c = this.cur;
    const open = clamp(c.glide * 1.0 + c.air * 0.5 + c.spread * 0.4, 0, 1);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3();
    const bodyUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.root.quaternion);
    this.membraneUniforms.uBodyUp.value.copy(bodyUp);
    const localUp = new THREE.Vector3(0, 1, 0);
    this.membranes.forEach((mb, idx) => {
      const s = mb.side;
      // опорные точки в мировых координатах → в координаты root
      this.body.localToWorld(A.set(s * 0.07, -0.005, 0.09));
      this.elbows[idx].localToWorld(B.set(0, -0.008, 0.006));
      this.body.localToWorld(D.set(s * 0.072, -0.012, -0.08));
      this.ankles[idx].localToWorld(C.set(0, -0.002, 0.012));
      for (const v of [A, B, C, D]) this.root.worldToLocal(v);
      // хрящевой вырост у запястья и щиколотки растягивает перепонку дальше лап
      B.addScaledVector(new THREE.Vector3().subVectors(B, A).normalize(), 0.03 * open + 0.01);
      C.addScaledVector(new THREE.Vector3().subVectors(C, D).normalize(), 0.03 * open + 0.01);
      // в полёте перепонка натянута горизонтально вбок — силуэт летяги почти квадратный
      const reach = 0.17;
      B.lerp(new THREE.Vector3(A.x + s * reach, A.y + 0.008, A.z + 0.015), open * 0.85);
      C.lerp(new THREE.Vector3(D.x + s * reach, D.y + 0.008, D.z - 0.02), open * 0.85);
      // при сложенных лапах перепонка прячется к боку
      const pos = mb.mesh.geometry.attributes.position;
      const p = new THREE.Vector3(), front = new THREE.Vector3(), back = new THREE.Vector3();
      for (let j = 0; j < mb.NV; j++) {
        const v = j / (mb.NV - 1);
        for (let i = 0; i < mb.NU; i++) {
          const u = i / (mb.NU - 1);
          front.lerpVectors(A, B, u);
          back.lerpVectors(D, C, u);
          p.lerpVectors(front, back, v);
          // прогиб и лёгкое натяжение в полёте
          const sag = Math.sin(u * Math.PI) * Math.sin(v * Math.PI);
          p.addScaledVector(localUp, -0.006 * sag * open - 0.004 * sag);
          // в сложенном виде — ближе к телу, чуть ниже
          const fold = 1 - open;
          const flank = new THREE.Vector3().lerpVectors(A, D, v).addScaledVector(new THREE.Vector3(s, 0, 0), 0.012 * u).addScaledVector(localUp, -0.02 * u);
          p.lerp(flank, fold * 0.85);
          pos.setXYZ(j * mb.NU + i, p.x, p.y, p.z);
        }
      }
      pos.needsUpdate = true;
      mb.mesh.geometry.computeVertexNormals();
      mb.mesh.visible = true;
    });
  }


  update(dt, time) {
    this.time = time;
    const p = this.pose, c = this.cur;
    // веса состояний
    const w = { sit: 0, run: 0, climb: 0, glide: 0, air: 0, swim: 0 };
    if (p.state === 'ground') { if (p.moving) w.run = 1; else w.sit = 1; }
    else w[p.state === 'air' ? 'air' : p.state] = 1;
    for (const k of Object.keys(w)) c[k] = smoothTo(c[k], w[k], 9, dt);
    // фаза шага
    let freq = 0;
    if (p.state === 'ground' && p.moving) freq = clamp(p.speed / 0.85, 2.5, 10);
    else if (p.state === 'climb') freq = Math.abs(p.climbDir) > 0.01 ? 4 : 0;
    else if (p.state === 'swim') freq = 3;
    this.phase += freq * dt * Math.PI * 2;
    const ph = this.phase;
    // целевые значения
    const sinP = Math.sin(ph);
    const hop = Math.max(0, Math.sin(ph + 0.4));
    const t = {
      pitch: c.run * (-0.12 * Math.sin(ph + 1.0) - 0.05 * clamp(p.speed / 8, 0, 1)) + c.sit * -1.05 + c.air * clamp(-p.vy * 0.06, -0.35, 0.35) + c.glide * 0.08 + c.swim * -0.2 + c.climb * 0.12,
      lift: c.run * hop * 0.045 * clamp(p.speed / 6, 0.3, 1) + c.sit * 0.03 + c.glide * 0.01 + c.swim * -0.06 + c.climb * -0.02,
      hip0: c.run * sinP * 0.9 + c.sit * 1.25 + c.air * -0.9 + c.glide * -0.7 + c.swim * Math.sin(ph) * 0.6 + c.climb * (-0.4 + Math.sin(ph) * 0.35 * Math.sign(p.climbDir || 1)),
      hip1: c.run * sinP * 0.9 + c.sit * 1.25 + c.air * -0.9 + c.glide * -0.7 + c.swim * Math.sin(ph + Math.PI) * 0.6 + c.climb * (-0.4 + Math.sin(ph + Math.PI) * 0.35 * Math.sign(p.climbDir || 1)),
      knee: c.run * (0.5 + Math.max(0, -sinP) * 0.9) + c.sit * 2.1 + c.air * 0.3 + c.glide * 0.2 + c.swim * 0.9 + c.climb * 1.3,
      shoulder0: c.run * Math.sin(ph + 2.0) * 0.85 + c.sit * -1.15 + c.air * 0.9 + c.glide * 0.9 + c.swim * Math.sin(ph + Math.PI) * 0.7 + c.climb * (0.5 + Math.sin(ph + Math.PI) * 0.4 * Math.sign(p.climbDir || 1)),
      shoulder1: c.run * Math.sin(ph + 2.0) * 0.85 + c.sit * -1.15 + c.air * 0.9 + c.glide * 0.9 + c.swim * Math.sin(ph) * 0.7 + c.climb * (0.5 + Math.sin(ph) * 0.4 * Math.sign(p.climbDir || 1)),
      elbow: c.run * (0.3 + Math.max(0, Math.sin(ph + 2.0)) * 0.6) + c.sit * 1.5 + c.air * 0.4 + c.glide * 0.1 + c.swim * 0.8 + c.climb * 0.9,
      spread: c.glide * 1.45 + c.climb * 0.45 + c.sit * 0.1 + c.air * 0.35,
      headPitch: c.sit * 0.55 + c.run * 0.12 + c.glide * -0.2 + c.swim * -0.35 + c.climb * -0.35 + c.air * -0.1,
      earTilt: c.run * 0.15 + c.glide * 0.4,
    };
    // взгляд по сторонам в покое
    this.lookTimer -= dt;
    if (this.lookTimer < 0) { this.lookTimer = 1.5 + Math.random() * 3; this.lookYaw = (Math.random() - 0.5) * 1.2; }
    t.headYaw = c.sit * this.lookYaw;
    const rate = 12;
    c.pitch = smoothTo(c.pitch, t.pitch, rate, dt);
    c.lift = smoothTo(c.lift, t.lift, rate * 2, dt);
    c.hip[0] = smoothTo(c.hip[0], t.hip0, rate * 2, dt); c.hip[1] = smoothTo(c.hip[1], t.hip1, rate * 2, dt);
    c.knee[0] = c.knee[1] = smoothTo(c.knee[0], t.knee, rate * 2, dt);
    c.shoulder[0] = smoothTo(c.shoulder[0], t.shoulder0, rate * 2, dt); c.shoulder[1] = smoothTo(c.shoulder[1], t.shoulder1, rate * 2, dt);
    c.elbow[0] = c.elbow[1] = smoothTo(c.elbow[0], t.elbow, rate * 2, dt);
    c.spread = smoothTo(c.spread, t.spread, rate, dt);
    c.headPitch = smoothTo(c.headPitch, t.headPitch, rate * 0.6, dt);
    c.headYaw = smoothTo(c.headYaw, t.headYaw, 4, dt);
    c.earTilt = smoothTo(c.earTilt, t.earTilt, rate, dt);
    // дыхание
    const breath = Math.sin(time * 2.2) * 0.004 * (0.3 + c.sit);
    // применяем
    this.body.rotation.set(c.pitch, 0, 0);
    this.body.position.y = 0.135 + c.lift + breath;
    this.torso.scale.setScalar(1 + breath * 2);
    this.hips.forEach((h, i) => { const s = i === 0 ? -1 : 1; h.rotation.set(c.hip[i], 0, s * c.spread * 0.6); });
    this.knees.forEach((k, i) => { k.rotation.x = c.knee[i] * 0.9 - 0.3; });
    this.shoulders.forEach((s, i) => { const sg = i === 0 ? -1 : 1; s.rotation.set(c.shoulder[i], 0, sg * c.spread * 0.9); });
    this.elbows.forEach((e, i) => { e.rotation.x = -c.elbow[i]; });
    this.neck.rotation.set(-c.pitch * 0.85 + c.headPitch, c.headYaw, 0);
    this.ears.forEach((e, i) => { const s = i === 0 ? -1 : 1; e.rotation.set(-0.25 - c.earTilt, 0, -s * (0.4 + c.earTilt * 0.5) + Math.sin(time * 7 + i) * 0.02); });
    // моргание
    this.blink -= dt;
    if (this.blink < -0.12) this.blink = 2 + Math.random() * 4;
    const blinkS = this.blink < 0 ? 0.15 : 1;
    this.eyes.forEach((e) => { e.scale.y = 1.05 * blinkS; });
    // хвост
    this.updateTail(dt, time);
    this.updateMembranes();
    for (const m of this.furMats) m.userData.uniforms.uTime.value = time;
  }

  updateTail(dt, time) {
    const c = this.cur;
    // основание хвоста — крестец в координатах root
    const base = this._v1.set(0, -0.015, -0.135).applyEuler(this.body.rotation).add(this.body.position);
    const n = this.tail.length;
    const wig = Math.sin(time * 1.3) * 0.05 + Math.sin(time * 2.7) * 0.02;
    const flick = c.sit * (Math.sin(time * 0.9) > 0.92 ? Math.sin(time * 25) * 0.08 : 0);
    const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const tp = new THREE.Vector3();
      // бег: дуга назад-вверх
      const run = new THREE.Vector3(wig * t, 0.03 + 0.24 * t - 0.14 * t * t, -0.43 * t);
      // сидя: S-образно вверх и вперёд над спиной
      P0.set(0, 0, 0); P1.set(0, -0.02, -0.17); P2.set(flick, 0.33, -0.23); P3.set(flick * 2 + wig * 0.5, 0.41, -0.01);
      const u = 1 - t;
      const sit = new THREE.Vector3().addScaledVector(P0, u * u * u).addScaledVector(P1, 3 * u * u * t).addScaledVector(P2, 3 * u * t * t).addScaledVector(P3, t * t * t);
      const climb = new THREE.Vector3(wig * t * 0.5, 0.02 + 0.05 * Math.sin(t * Math.PI), -0.44 * t);
      const glide = new THREE.Vector3(0, 0.015 * t, -0.46 * t);
      const air = new THREE.Vector3(0, 0.3 * t - 0.05 * t * t, -0.38 * t);
      const swim = new THREE.Vector3(wig * t * 2, 0.06 * t, -0.42 * t);
      tp.addScaledVector(run, c.run).addScaledVector(sit, c.sit).addScaledVector(climb, c.climb).addScaledVector(glide, c.glide).addScaledVector(air, c.air).addScaledVector(swim, c.swim);
      const wsum = c.run + c.sit + c.climb + c.glide + c.air + c.swim;
      if (wsum > 1e-4) tp.multiplyScalar(1 / wsum);
      tp.add(base);
      this.root.localToWorld(tp);
      const seg = this.tail[i];
      if (!seg.init) { seg.pos.copy(tp); seg.init = true; }
      else seg.pos.lerp(tp, 1 - Math.exp(-seg.k * dt));
      seg.target.copy(tp);
    }
    // позиции и ориентация сегментов: +Z вдоль хвоста, тонкая ось Y перпендикулярна плоскости хвоста
    const invQ = this.root.quaternion.clone().invert();
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const seg = this.tail[i];
      const local = this.root.worldToLocal(seg.pos.clone());
      seg.mesh.position.copy(local);
      const nxt = this.tail[Math.min(n - 1, i + 1)].pos, prv = this.tail[Math.max(0, i - 1)].pos;
      const dir = new THREE.Vector3().subVectors(nxt, prv).normalize().applyQuaternion(invQ);
      // тонкая ось (локальный Y) — «вверх» хвоста: проекция чуть наклонённой вертикали на плоскость, перпендикулярную dir
      const y = new THREE.Vector3(0, 1, 0.35).normalize();
      y.addScaledVector(dir, -y.dot(dir));
      if (y.lengthSq() < 1e-6) y.set(0, 0, 1);
      y.normalize();
      const x = new THREE.Vector3().crossVectors(y, dir).normalize();
      m.makeBasis(x, y, dir);
      seg.mesh.quaternion.setFromRotationMatrix(m);
    }
  }
}
