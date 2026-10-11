import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D, mulberry32, lerp } from './noise.js';
import { REGIONS } from './world.js';

// ---------------------------------------------------------------- Триплан для камней
const TRI_PARS_VERT = /* glsl */`varying vec3 vWPos; varying vec3 vWNormal;`;
const TRI_VERT = /* glsl */`
{
  vec4 wp = vec4(transformed, 1.0);
  vec3 wn = objectNormal;
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
    wn = mat3(instanceMatrix) * wn;
  #endif
  wp = modelMatrix * wp;
  vWPos = wp.xyz; vWNormal = normalize(mat3(modelMatrix) * wn);
}
`;
const TRI_PARS_FRAG = /* glsl */`varying vec3 vWPos; varying vec3 vWNormal; uniform float uTriScale;`;
const TRI_FRAG = /* glsl */`
vec4 triAlb; vec3 triN;
{
  vec3 wn = normalize(vWNormal);
  vec3 bw = pow(abs(wn), vec3(5.0)); bw /= (bw.x + bw.y + bw.z);
  vec2 uvX = vWPos.zy * uTriScale, uvY = vWPos.xz * uTriScale, uvZ = vWPos.xy * uTriScale;
  triAlb = texture2D(map, uvX) * bw.x + texture2D(map, uvY) * bw.y + texture2D(map, uvZ) * bw.z;
  vec3 nx = texture2D(normalMap, uvX).xyz * 2.0 - 1.0;
  vec3 ny = texture2D(normalMap, uvY).xyz * 2.0 - 1.0;
  vec3 nz = texture2D(normalMap, uvZ).xyz * 2.0 - 1.0;
  vec3 tX = vec3(0.0, nx.y, nx.x) * sign(wn.x);
  vec3 tY = vec3(ny.x, 0.0, ny.y) * sign(wn.y);
  vec3 tZ = vec3(nz.x, nz.y, 0.0) * sign(wn.z);
  triN = normalize(wn + (tX * bw.x + tY * bw.y + tZ * bw.z) * normalScale.x);
}
diffuseColor.rgb *= triAlb.rgb;
`;
const TRI_NORMAL = /* glsl */`normal = normalize((viewMatrix * vec4(triN, 0.0)).xyz);`;

function makeTriplanarMaterial(map, normalMap, scale, extra = {}) {
  const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1.2, 1.2), ...extra });
  const uniforms = { uTriScale: { value: scale } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TRI_PARS_VERT)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + TRI_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TRI_PARS_FRAG)
      .replace('#include <map_fragment>', TRI_FRAG)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * mix(0.7, 1.0, triAlb.a);')
      .replace('#include <normal_fragment_maps>', TRI_NORMAL);
  };
  mat.customProgramCacheKey = () => 'triplanar';
  return mat;
}

// ---------------------------------------------------------------- Геометрии
function rockGeometry(seed) {
  const noise = new Noise2D(seed);
  let g = new THREE.IcosahedronGeometry(1, 4);
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise.fbm(v.x * 1.3 + 3, v.y * 1.3, 3) * 0.6 + noise.fbm(v.y * 1.1, v.z * 1.1 + 7, 3) * 0.6 + noise.fbm(v.z * 2.2, v.x * 2.2 + 11, 2) * 0.25;
    const facet = Math.max(Math.abs(v.x) * 0.9, Math.abs(v.y * 0.7), Math.abs(v.z)) * 0.35 + 0.65; // слегка гранёный
    v.multiplyScalar((1 + n * 0.28) * facet);
    v.y *= 0.85;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function mushroomGeometry() {
  const capPts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const a = t * Math.PI * 0.55;
    capPts.push(new THREE.Vector2(Math.sin(a) * 1.0, Math.cos(a) * 0.62 + 0.5));
  }
  capPts.push(new THREE.Vector2(0.9, 0.42), new THREE.Vector2(0.3, 0.45));
  const cap = new THREE.LatheGeometry(capPts, 20);
  const cuv = cap.attributes.uv;
  for (let i = 0; i < cuv.count; i++) cuv.setY(i, 0.55 + 0.45 * cuv.getY(i));
  const stem = new THREE.CylinderGeometry(0.2, 0.28, 0.55, 12, 1, false);
  stem.translate(0, 0.25, 0);
  const suv = stem.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setY(i, 0.45 * suv.getY(i));
  const g = mergeGeometries([cap, stem], false);
  g.computeBoundingSphere();
  return g;
}

function flowerGeometry(kind) {
  const geoms = [];
  const stemCol = [0.12, 0.3, 0.06];
  const quad = (w, h, col, m) => {
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    const c = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    g.applyMatrix4(m);
    return g;
  };
  const H = 0.32;
  geoms.push(quad(0.012, H, stemCol, new THREE.Matrix4()));
  geoms.push(quad(0.012, H, stemCol, new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  // листик
  geoms.push(quad(0.03, 0.09, stemCol, new THREE.Matrix4().makeTranslation(0, H * 0.4, 0).multiply(new THREE.Matrix4().makeRotationZ(-0.9))));
  const petalCol = [[0.95, 0.95, 0.9], [0.35, 0.45, 0.95], [0.9, 0.12, 0.08]][kind];
  const centerCol = [[0.95, 0.75, 0.1], [0.25, 0.2, 0.5], [0.08, 0.05, 0.05]][kind];
  const petals = kind === 1 ? 8 : 6;
  const petalLen = kind === 2 ? 0.05 : 0.04, petalW = kind === 0 ? 0.016 : 0.028;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const m = new THREE.Matrix4().makeTranslation(0, H, 0)
      .multiply(new THREE.Matrix4().makeRotationY(a))
      .multiply(new THREE.Matrix4().makeRotationX(kind === 2 ? -0.45 : -0.95 + 0.0));
    geoms.push(quad(petalW, petalLen, petalCol, m));
  }
  const center = new THREE.CircleGeometry(kind === 0 ? 0.01 : 0.008, 8);
  center.rotateX(-Math.PI / 2);
  center.translate(0, H + 0.004, 0);
  const cc = new Float32Array(center.attributes.position.count * 3);
  for (let i = 0; i < center.attributes.position.count; i++) { cc[i * 3] = centerCol[0]; cc[i * 3 + 1] = centerCol[1]; cc[i * 3 + 2] = centerCol[2]; }
  center.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  geoms.push(center);
  const g = mergeGeometries(geoms, false);
  // вес покачивания — по высоте
  const sway = new Float32Array(g.attributes.position.count);
  for (let i = 0; i < sway.length; i++) sway[i] = g.attributes.position.getY(i) / H;
  g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));
  g.computeBoundingSphere();
  return g;
}

function acornGeometry() {
  const nutPts = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 — остриё, 1 — верх
    const r = 0.021 * Math.pow(Math.sin(Math.min(1, t * 0.85 + 0.15) * Math.PI * 0.5), 0.7) * (1 - t * 0.12);
    nutPts.push(new THREE.Vector2(i === 0 ? 0.001 : r, t * 0.05));
  }
  const nut = new THREE.LatheGeometry(nutPts, 18);
  const nuv = nut.attributes.uv;
  for (let i = 0; i < nuv.count; i++) nuv.setY(i, nuv.getY(i) * 0.48);
  const capPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    capPts.push(new THREE.Vector2(0.0245 * Math.pow(Math.sin(Math.PI * 0.5 * (1 - t * 0.95)), 0.6) + 0.0005, 0.038 + t * 0.026));
  }
  const cap = new THREE.LatheGeometry(capPts, 18);
  const cuv = cap.attributes.uv;
  for (let i = 0; i < cuv.count; i++) cuv.setY(i, 0.52 + cuv.getY(i) * 0.46);
  const stem = new THREE.CylinderGeometry(0.003, 0.004, 0.012, 6);
  stem.translate(0, 0.068, 0);
  const suv = stem.attributes.uv;
  for (let i = 0; i < suv.count; i++) suv.setY(i, 0.55);
  const g = mergeGeometries([nut, cap, stem], false);
  g.translate(0, -0.03, 0);
  g.computeBoundingSphere();
  return g;
}

function textTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4a2b';
  ctx.fillRect(0, 0, 512, 160);
  // доски
  for (let i = 0; i < 3; i++) { ctx.fillStyle = i % 2 ? '#7a5632' : '#6f4e2d'; ctx.fillRect(0, i * 54, 512, 52); }
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 3;
  for (let i = 0; i < 20; i++) { ctx.beginPath(); ctx.moveTo(0, 8 + i * 8 + Math.random() * 3); ctx.lineTo(512, 8 + i * 8 + Math.random() * 3); ctx.stroke(); }
  ctx.fillStyle = '#f4e6c8';
  ctx.font = 'bold 52px Georgia, serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 6;
  ctx.fillText(text, 256, 82);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const SWAY_PARS = /* glsl */`attribute float aSway; uniform float uTime;`;
const SWAY_VERT = /* glsl */`
{
  vec3 wp = transformed;
  #ifdef USE_INSTANCING
    wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  float ph = dot(wp.xz, vec2(0.11, 0.07)) + uTime * 1.6;
  transformed.xz += vec2(sin(ph) * 0.5 + sin(ph * 0.37) * 0.3, cos(ph * 0.8) * 0.3) * aSway * aSway * 0.05;
}
`;

export class Props {
  constructor(world, tex, heightUniforms) {
    this.world = world;
    this.group = new THREE.Group();
    this.uniforms = { uTime: { value: 0 } };
    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpP = new THREE.Vector3(); this.tmpS = new THREE.Vector3();
    this.buildRocks(tex);
    this.buildLogs(tex);
    this.buildMushrooms(tex);
    this.buildFlowers();
    this.buildAcorns(tex);
    this.buildSigns(tex);
  }

  setInstance(mesh, i, x, y, z, rot, sx, sy, sz, tilt = 0) {
    this.tmpP.set(x, y, z);
    this.tmpQ.setFromEuler(new THREE.Euler(tilt, rot, 0));
    this.tmpS.set(sx, sy, sz);
    this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
    mesh.setMatrixAt(i, this.tmpM);
  }

  buildRocks(tex) {
    const mat = makeTriplanarMaterial(tex.rock.map, tex.rock.normalMap, 1 / 1.8);
    const variants = [rockGeometry(11), rockGeometry(22), rockGeometry(33)];
    const lists = [[], [], []];
    this.world.rocks.forEach((r, i) => lists[i % 3].push(r));
    this.rockMeshes = lists.map((list, v) => {
      const m = new THREE.InstancedMesh(variants[v], mat, Math.max(1, list.length));
      list.forEach((r, i) => this.setInstance(m, i, r.x, r.y, r.z, r.rot, r.rx, r.ry, r.rz, r.tilt));
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = true; m.receiveShadow = true;
      m.computeBoundingSphere();
      this.group.add(m);
      return m;
    });
  }

  buildLogs(tex) {
    const mat = new THREE.MeshStandardMaterial({ map: tex.bark.barkOak.map, normalMap: tex.bark.barkOak.normalMap, roughnessMap: tex.bark.barkOak.orm, roughness: 1, metalness: 0, color: 0xb9a68e });
    const endMat = new THREE.MeshStandardMaterial({ color: 0x8a6a45, roughness: 0.9 });
    for (const l of this.world.logs) {
      const geo = new THREE.CylinderGeometry(l.r * 0.85, l.r, l.len, 14, 1, true);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(l.r * 6.28 / 2.2)), uv.getY(i) * l.len / 2.2);
      geo.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(l.x, l.y, l.z);
      mesh.rotation.y = -l.ang;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.group.add(mesh);
      for (const s of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CircleGeometry(s > 0 ? l.r * 0.85 : l.r, 14), endMat);
        cap.position.set(s * l.len / 2, 0, 0);
        cap.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
        mesh.add(cap);
      }
    }
  }

  buildMushrooms(tex) {
    const mat = new THREE.MeshStandardMaterial({ map: tex.misc.mushroom.map, normalMap: tex.misc.mushroom.normalMap, roughness: 0.6, metalness: 0 });
    const brownMat = new THREE.MeshStandardMaterial({ map: tex.misc.mushroom.map, normalMap: tex.misc.mushroom.normalMap, roughness: 0.7, metalness: 0, color: 0x9a7040 });
    const geo = mushroomGeometry();
    const red = this.world.mushrooms.filter((m) => m.kind === 0), brown = this.world.mushrooms.filter((m) => m.kind === 1);
    for (const [list, m] of [[red, mat], [brown, brownMat]]) {
      const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, list.length));
      list.forEach((r, i) => this.setInstance(mesh, i, r.x, r.y - 0.02, r.z, r.rot, r.s, r.s, r.s));
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  buildFlowers() {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + SWAY_PARS)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + SWAY_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); if (!gl_FrontFacing) normal = -normal; normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.6)); vec3 nonPerturbedNormal = normal;');
    };
    mat.customProgramCacheKey = () => 'flower';
    for (let kind = 0; kind < 3; kind++) {
      const list = this.world.flowers.filter((f) => f.kind === kind);
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(flowerGeometry(kind), mat, list.length);
      list.forEach((f, i) => this.setInstance(mesh, i, f.x, f.y - 0.01, f.z, f.rot, f.s, f.s, f.s));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
  }

  buildAcorns(tex) {
    const geo = acornGeometry();
    const mat = new THREE.MeshStandardMaterial({ map: tex.misc.acorn.map, normalMap: tex.misc.acorn.normalMap, roughness: 0.5, metalness: 0 });
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc94a, metalness: 0.85, roughness: 0.28, emissive: 0x8a5a00, emissiveIntensity: 0.9 });
    this.acorns = this.world.acorns.map((a, i) => ({ ...a, id: i, collected: false, phase: Math.random() * 6.28 }));
    this.golden = this.world.golden.map((a, i) => ({ ...a, id: 1000 + i, collected: false, phase: Math.random() * 6.28 }));
    this.totalAcorns = this.acorns.length;
    this.totalGolden = this.golden.length;
    this.acornMesh = new THREE.InstancedMesh(geo, mat, this.acorns.length);
    this.goldMesh = new THREE.InstancedMesh(geo, goldMat, this.golden.length);
    this.acornMesh.castShadow = true;
    this.acornMesh.frustumCulled = false; this.goldMesh.frustumCulled = false;
    this.group.add(this.acornMesh, this.goldMesh);
    // сияние золотых
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,225,140,0.9)'); gr.addColorStop(0.4, 'rgba(255,190,60,0.35)'); gr.addColorStop(1, 'rgba(255,170,40,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, 64, 64);
    const glowTex = new THREE.CanvasTexture(c);
    const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 });
    this.glows = this.golden.map((g) => { const s = new THREE.Sprite(glowMat); s.scale.setScalar(1.4); s.position.set(g.x, g.y, g.z); this.group.add(s); return s; });
    this.updateAcornMatrices(0);
  }

  updateAcornMatrices(time) {
    for (const [list, mesh] of [[this.acorns, this.acornMesh], [this.golden, this.goldMesh]]) {
      list.forEach((a, i) => {
        if (a.collected) { this.setInstance(mesh, i, a.x, -100, a.z, 0, 0.001, 0.001, 0.001); return; }
        const bob = Math.sin(time * 2.2 + a.phase) * 0.03;
        const s = list === this.golden ? 1.9 : 1.5;
        this.setInstance(mesh, i, a.x, a.y + 0.03 + bob, a.z, time * 1.2 + a.phase, s, s, s, 0.25);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.golden.forEach((g, i) => { this.glows[i].visible = !g.collected; this.glows[i].position.y = g.y + 0.05 + Math.sin(time * 2.2 + g.phase) * 0.03; });
  }

  buildSigns(tex) {
    const postMat = new THREE.MeshStandardMaterial({ map: tex.bark.barkOak.map, normalMap: tex.bark.barkOak.normalMap, roughness: 1, color: 0xc8b494 });
    const w = this.world;
    const signs = [
      { z: 12, text: 'Тропа к вершине →' },
      { z: REGIONS[1].z0, text: 'Берёзовый луг' },
      { z: REGIONS[2].z0, text: 'К реке' },
      { z: REGIONS[3].z0, text: 'Сосновый бор' },
      { z: REGIONS[4].z0, text: 'Осторожно, снег' },
      { z: 1975, text: 'Древний кедр' },
    ];
    for (const s of signs) {
      const x = w.trailX(s.z) + 3.2, z = s.z;
      const y = w.heightAt(x, z);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = -0.4 + (Math.random() - 0.5) * 0.3;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.5, 10), postMat);
      post.position.y = 0.7;
      post.castShadow = true;
      g.add(post);
      const board = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.28, 0.05), [postMat, postMat, postMat, postMat, new THREE.MeshStandardMaterial({ map: textTexture(s.text), roughness: 0.9 }), postMat]);
      board.position.set(0.25, 1.3, 0);
      board.castShadow = true;
      g.add(board);
      this.group.add(g);
    }
  }

  collectNear(x, y, z, r) {
    const res = { acorns: 0, golden: 0 };
    for (const a of this.acorns) {
      if (a.collected) continue;
      const d = Math.hypot(a.x - x, a.y - y, a.z - z);
      if (d < r) { a.collected = true; res.acorns++; }
    }
    for (const a of this.golden) {
      if (a.collected) continue;
      const d = Math.hypot(a.x - x, a.y - y, a.z - z);
      if (d < r + 0.25) { a.collected = true; res.golden++; }
    }
    return res;
  }

  collectedIds() { return [...this.acorns, ...this.golden].filter((a) => a.collected).map((a) => a.id); }
  restoreCollected(ids) {
    const set = new Set(ids);
    for (const a of [...this.acorns, ...this.golden]) a.collected = set.has(a.id);
  }

  update(camera, time, dt) {
    this.uniforms.uTime.value = time;
    this.updateAcornMatrices(time);
  }
}
