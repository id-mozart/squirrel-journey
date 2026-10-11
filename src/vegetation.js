import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, lerp } from './noise.js';

// Породы: 0 дуб, 1 берёза, 2 сосна, 3 ель
const SPECIES = [
  { name: 'oak', height: 16, radius: 0.42, crown: 6.5, bark: 'barkOak', foliage: 'twigOak', segments: 16 },
  { name: 'birch', height: 15, radius: 0.24, crown: 3.2, bark: 'barkBirch', foliage: 'twigBirch', segments: 12 },
  { name: 'pine', height: 20, radius: 0.34, crown: 4.0, bark: 'barkPine', foliage: 'branchPine', segments: 12 },
  { name: 'spruce', height: 17, radius: 0.3, crown: 3.4, bark: 'barkPine', foliage: 'branchSpruce', segments: 10 },
];
const VARIANTS = 2;
const CHUNK = 120;
const BARK_TILE = 1.25;

// Конусообразная труба вдоль ломаной (для ствола и ветвей)
function tube(points, radii, segments, uRep, geoms, vScale = BARK_TILE) {
  const n = points.length;
  const pos = [], nor = [], uv = [], idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tangent = new THREE.Vector3(), nrm = new THREE.Vector3(), bin = new THREE.Vector3();
  const frames = [];
  let prevN = null;
  for (let k = 0; k < n; k++) {
    const p = points[k];
    if (k < n - 1) tangent.subVectors(points[k + 1], p).normalize();
    else tangent.subVectors(p, points[k - 1]).normalize();
    if (!prevN) {
      nrm.crossVectors(tangent, Math.abs(tangent.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    } else {
      // параллельный перенос
      nrm.copy(prevN).sub(tangent.clone().multiplyScalar(prevN.dot(tangent))).normalize();
    }
    bin.crossVectors(tangent, nrm).normalize();
    frames.push({ n: nrm.clone(), b: bin.clone() });
    prevN = nrm.clone();
  }
  let vAcc = 0;
  for (let k = 0; k < n; k++) {
    if (k > 0) vAcc += points[k].distanceTo(points[k - 1]);
    const f = frames[k], r = radii[k], p = points[k];
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const dir = f.n.clone().multiplyScalar(c).add(f.b.clone().multiplyScalar(sn));
      pos.push(p.x + dir.x * r, p.y + dir.y * r, p.z + dir.z * r);
      nor.push(dir.x, dir.y, dir.z);
      uv.push((s / segments) * uRep, vAcc / vScale);
    }
  }
  const row = segments + 1;
  for (let k = 0; k < n - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = k * row + s, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  geoms.push(g);
}

// Ствол с ветвями; возвращает геометрию и список концов ветвей
function buildTrunk(species, rnd, low = false) {
  const sp = SPECIES[species];
  const H = sp.height, R = sp.radius;
  const geoms = [];
  const rings = low ? 6 : 14;
  const points = [], radii = [];
  const bendA = (rnd() - 0.5) * 0.6, bendB = (rnd() - 0.5) * 0.6, bendF = 0.6 + rnd() * 0.8;
  const topY = species >= 2 ? H : H * 0.82;
  for (let k = 0; k <= rings; k++) {
    const t = Math.pow(k / rings, 1.35);
    const y = t * topY;
    const flare = species === 0 ? 0.9 : 0.45;
    let r = R * Math.pow(1 - t * 0.92, species === 3 ? 0.9 : 0.75) * (1 + flare * Math.exp(-y / (R * 1.6)));
    if (species === 3) r = R * (1 - t * 0.96) * (1 + flare * Math.exp(-y / (R * 1.6)));
    r = Math.max(r, 0.03);
    const bx = Math.sin(y * bendF / H * 3.1) * bendA * (species === 1 ? 1.4 : 0.8);
    const bz = Math.sin(y * bendF / H * 2.3 + 1) * bendB * (species === 1 ? 1.4 : 0.8);
    points.push(new THREE.Vector3(bx, y, bz));
    radii.push(r);
  }
  const circ = 2 * Math.PI * R;
  tube(points, radii, low ? 7 : sp.segments, Math.max(1, Math.round(circ / BARK_TILE)), geoms);
  const spineAt = (y) => {
    const t = Math.pow(Math.max(0, y / topY), 1 / 1.35) * rings;
    const k = Math.min(rings - 1, Math.floor(t)), f = t - k;
    return points[k].clone().lerp(points[k + 1], f);
  };
  const tips = [];
  const branch = (y, az, pitch, len, r0, droop = 0) => {
    const start = spineAt(y);
    const pts = [], rs = [];
    const segs = 4;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch));
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      const p = start.clone().addScaledVector(dir, len * t);
      p.y += droop * t * t * len + Math.sin(t * 3 + az) * len * 0.05;
      pts.push(p); rs.push(r0 * (1 - t * 0.85) + 0.02);
    }
    if (!low) tube(pts, rs, 6, 1, geoms);
    tips.push({ p: pts[segs], dir, len });
  };
  if (species === 0) {
    const n = 5 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const y = H * (0.42 + 0.38 * (i / n) + rnd() * 0.08);
      const az = (i / n) * Math.PI * 2 + rnd() * 0.8;
      branch(y, az, 0.35 + rnd() * 0.55, sp.crown * (0.7 + rnd() * 0.45), R * 0.32 * (1 - y / H * 0.5), 0.1);
    }
  } else if (species === 1) {
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const y = H * (0.45 + 0.4 * (i / n) + rnd() * 0.06);
      const az = (i / n) * Math.PI * 2 + rnd();
      branch(y, az, 0.75 + rnd() * 0.5, sp.crown * (0.9 + rnd() * 0.6), R * 0.35, -0.15);
    }
  } else if (species === 2) {
    const n = 7 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const y = H * (0.6 + 0.36 * (i / n) + rnd() * 0.05);
      const az = (i / n) * Math.PI * 2 + rnd() * 0.9;
      branch(y, az, 0.15 + rnd() * 0.4, sp.crown * (0.55 + rnd() * 0.5) * (1 - (y / H - 0.6) * 0.8), R * 0.3, 0.08);
    }
  } else {
    const tiers = 9;
    for (let t = 0; t < tiers; t++) {
      const y = H * (0.18 + 0.75 * (t / tiers)) + rnd() * 0.5;
      const cnt = 4;
      const rad = sp.crown * (1 - y / H) + 0.3;
      for (let i = 0; i < cnt; i++) {
        const az = (i / cnt) * Math.PI * 2 + t * 0.7 + rnd() * 0.5;
        branch(y, az, -0.1 + rnd() * 0.2, rad * 0.8, R * 0.18 * (1 - y / H) + 0.02, -0.25);
      }
    }
  }
  const merged = mergeGeometries(geoms, false);
  for (const g of geoms) g.dispose();
  return { geometry: merged, tips, topY, spineAt };
}

// Крона из карточек
function buildCrown(species, trunk, rnd, low) {
  const sp = SPECIES[species];
  const H = sp.height, Rc = sp.crown;
  const pos = [], nor = [], uv = [], col = [], sway = [], idx = [];
  const tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4();
  const addCard = (center, quat, size, normal, tint, sw) => {
    const base = pos.length / 3;
    const hw = size * 0.5;
    const corners = [[-hw, 0, 0], [hw, 0, 0], [hw, size, 0], [-hw, size, 0]];
    tmpM.makeRotationFromQuaternion(quat);
    for (const c of corners) {
      const v = new THREE.Vector3(c[0], c[1] - size * 0.1, c[2]).applyMatrix4(tmpM).add(center);
      pos.push(v.x, v.y, v.z);
      nor.push(normal.x, normal.y, normal.z);
      col.push(tint[0], tint[1], tint[2]);
      sway.push(sw);
    }
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const crownCenter = new THREE.Vector3(0, trunk.topY * (species === 1 ? 0.9 : 0.95), 0);
  const randomQuat = (lookDir, roll) => {
    // карточка «стоит» вдоль lookDir (локальный +Y), поворачивается вокруг него на roll
    const m = new THREE.Matrix4();
    const y = lookDir.clone().normalize();
    const x = new THREE.Vector3().crossVectors(y, Math.abs(y.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    m.makeBasis(x, y, z);
    tmpQ.setFromRotationMatrix(m);
    const q2 = new THREE.Quaternion().setFromAxisAngle(y, roll);
    return q2.multiply(tmpQ);
  };
  const tintOf = () => { const b = 0.75 + rnd() * 0.5; const h = (rnd() - 0.5) * 0.12; return [b * (1 + h), b, b * (1 - h)]; };
  if (species === 0 || species === 1 || species === 2) {
    const clusters = trunk.tips.map((t) => ({ c: t.p.clone().addScaledVector(t.dir, species === 1 ? 0.3 : 0.6), r: Rc * (species === 0 ? 0.55 : species === 1 ? 0.55 : 0.5) }));
    clusters.push({ c: crownCenter.clone().add(new THREE.Vector3(0, species === 1 ? Rc * 0.6 : Rc * 0.35, 0)), r: Rc * (species === 1 ? 0.7 : 0.7) });
    if (species === 0) clusters.push({ c: crownCenter.clone(), r: Rc * 0.9 });
    const total = low ? (species === 1 ? 60 : 70) : (species === 0 ? 240 : species === 1 ? 170 : 150);
    const size = (low ? 2.2 : 1.35) * (species === 0 ? 1.7 : species === 1 ? 1.25 : 1.6);
    for (let i = 0; i < total; i++) {
      const cl = clusters[Math.floor(rnd() * clusters.length)];
      // точка внутри сферы с концентрацией у поверхности
      const u = rnd(), v = rnd(), w = rnd();
      const th = u * Math.PI * 2, ph = Math.acos(2 * v - 1), rr = cl.r * Math.pow(w, 0.4);
      const p = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph) * (species === 1 ? 1.5 : 0.85), Math.sin(ph) * Math.sin(th)).multiplyScalar(rr).add(cl.c);
      const n = p.clone().sub(crownCenter).normalize().lerp(up, 0.35).normalize();
      let look;
      if (species === 1) look = new THREE.Vector3((rnd() - 0.5), -0.5 - rnd() * 0.8, (rnd() - 0.5)).normalize(); // берёза — свисающие ветки
      else look = new THREE.Vector3(rnd() - 0.5, (rnd() - 0.2) * 1.2, rnd() - 0.5).normalize();
      const q = randomQuat(look, rnd() * Math.PI * 2);
      const s = size * (0.75 + rnd() * 0.5);
      const swayW = 0.4 + 0.6 * (p.y / H) + rr / Rc * 0.3;
      addCard(p, q, s, n, tintOf(), swayW);
    }
  } else {
    // ель: ярусы свисающих лап из множества небольших карточек
    const tiers = low ? 10 : 18;
    const y0 = H * 0.12;
    for (let t = 0; t < tiers; t++) {
      const ft = t / (tiers - 1);
      const y = y0 + (H - y0 - 0.6) * ft + (rnd() - 0.5) * 0.4;
      const rad = Rc * Math.pow(1 - ft, 0.8) + 0.3;
      const cnt = low ? Math.max(3, Math.round(rad * 2.2)) : Math.max(5, Math.round(rad * 5.5));
      for (let i = 0; i < cnt; i++) {
        const az = (i / cnt) * Math.PI * 2 + t * 0.9 + rnd() * 0.7;
        const radial = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
        const droop = -0.35 - rnd() * 0.4;
        const look = radial.clone().add(new THREE.Vector3(0, droop, 0)).normalize();
        const along = rnd();
        const start = trunk.spineAt(y).addScaledVector(radial, 0.1 + along * rad * 0.55);
        start.y += 0.25 - along * rad * 0.35;
        const size = (low ? rad * 1.1 : rad * 0.62) * (0.8 + rnd() * 0.4) + 0.3;
        const q = randomQuat(look, rnd() * Math.PI * 2);
        const n = radial.clone().lerp(up, 0.65).normalize();
        addCard(start, q, size, n, tintOf(), 0.3 + 0.7 * ft);
      }
    }
    // макушка
    for (let i = 0; i < (low ? 2 : 4); i++) {
      const look = new THREE.Vector3((rnd() - 0.5) * 0.3, 1, (rnd() - 0.5) * 0.3).normalize();
      addCard(new THREE.Vector3(0, H - 1.2, 0), randomQuat(look, rnd() * Math.PI), 1.5, up, tintOf(), 1.0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const FOLIAGE_PARS_VERT = /* glsl */`
attribute float aSway;
uniform float uTime;
uniform float uWind;
`;
const FOLIAGE_VERT = /* glsl */`
{
  vec3 wp = transformed;
  #ifdef USE_INSTANCING
    wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  #ifdef USE_BATCHING
    wp = (batchingMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  float ph = dot(wp.xz, vec2(0.045, 0.07)) + uTime * 1.25;
  vec3 off = vec3(sin(ph) * 0.6 + sin(ph * 2.3 + 1.0) * 0.3, sin(ph * 1.7 + 0.5) * 0.18, cos(ph * 0.8) * 0.5) * (aSway * uWind);
  off += vec3(sin(ph * 5.1 + wp.y), 0.0, cos(ph * 4.3)) * aSway * uWind * 0.12;
  transformed += off;
}
`;
const FOLIAGE_PARS_FRAG = /* glsl */`
uniform vec3 uSunDirView;
uniform vec3 uSunColor;
uniform float uTransl;
`;
const FOLIAGE_TRANSL = /* glsl */`
#include <emissivemap_fragment>
{
  vec3 V = normalize(vViewPosition);
  float back = pow(max(dot(-V, uSunDirView), 0.0), 5.0);
  float thin = 0.55 + 0.45 * abs(dot(normalize(vNormal), V));
  totalEmissiveRadiance += diffuseColor.rgb * uSunColor * back * uTransl * thin;
}
`;
const NORMAL_NOFLIP = /* glsl */`
float faceDirection = 1.0;
vec3 normal = normalize( vNormal );
mat3 tbn = getTangentFrame( - vViewPosition, normal, vNormalMapUv );
vec3 nonPerturbedNormal = normal;
`;

export class Vegetation {
  constructor(world, tex) {
    this.world = world;
    this.group = new THREE.Group();
    this.time = 0;
    this.uniforms = {
      uTime: { value: 0 }, uWind: { value: 0.12 },
      uSunDirView: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uTransl: { value: 0.45 },
    };
    // материалы коры
    this.barkMats = {};
    for (const [name, t] of Object.entries(tex.bark)) {
      const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.orm, aoMap: t.orm, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1) });
      this.barkMats[name] = m;
    }
    this.barkMats.barkSpruce = this.barkMats.barkPine.clone();
    this.barkMats.barkSpruce.color.setRGB(0.6, 0.55, 0.5);
    // материалы листвы
    this.foliageMats = {};
    for (const [name, t] of Object.entries(tex.foliage)) {
      const m = new THREE.MeshStandardMaterial({
        map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.85, metalness: 0,
        alphaTest: 0.4, alphaToCoverage: true, side: THREE.DoubleSide, vertexColors: true, shadowSide: THREE.DoubleSide,
      });
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, this.uniforms);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\n' + FOLIAGE_PARS_VERT)
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + FOLIAGE_VERT);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + FOLIAGE_PARS_FRAG)
          .replace('#include <normal_fragment_begin>', NORMAL_NOFLIP)
          .replace('#include <emissivemap_fragment>', FOLIAGE_TRANSL);
      };
      m.customProgramCacheKey = () => 'foliage';
      this.foliageMats[name] = m;
    }
    // геометрии
    this.geo = [];
    for (let s = 0; s < 4; s++) {
      this.geo[s] = [];
      for (let v = 0; v < VARIANTS; v++) {
        const rnd = mulberry32(1000 + s * 17 + v * 101);
        const trunk = buildTrunk(s, rnd);
        const trunkLow = buildTrunk(s, mulberry32(1000 + s * 17 + v * 101), true);
        const rnd2 = mulberry32(2000 + s * 17 + v * 101);
        const crown = buildCrown(s, trunk, rnd2, false);
        const rnd3 = mulberry32(2000 + s * 17 + v * 101);
        const crownLow = buildCrown(s, trunk, rnd3, true);
        this.geo[s][v] = { trunk: trunk.geometry, trunkLow: trunkLow.geometry, crown, crownLow };
      }
    }
    this.buildChunks();
  }

  buildChunks() {
    // Группируем деревья по чанку и породе; на каждую группу — два BatchedMesh (стволы и кроны).
    const buckets = new Map();
    for (const t of this.world.trees) {
      const key = `${Math.floor(t.x / CHUNK)},${Math.floor(t.z / CHUNK)},${t.species}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(t);
    }
    this.chunks = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const color = new THREE.Color();
    const countVerts = (geos) => geos.reduce((a, g) => a + g.attributes.position.count, 0);
    const countIdx = (geos) => geos.reduce((a, g) => a + (g.index ? g.index.count : g.attributes.position.count), 0);
    for (const [key, list] of buckets) {
      const [cx, cz, species] = key.split(',').map(Number);
      const sp = SPECIES[species];
      const variants = this.geo[species];
      const trunkGeos = variants.flatMap((v) => [v.trunk, v.trunkLow]);
      const crownGeos = variants.flatMap((v) => [v.crown, v.crownLow]);
      const trunkMesh = new THREE.BatchedMesh(list.length, countVerts(trunkGeos), countIdx(trunkGeos), this.barkMats[species === 3 ? 'barkSpruce' : sp.bark]);
      const crownMesh = new THREE.BatchedMesh(list.length, countVerts(crownGeos), countIdx(crownGeos), this.foliageMats[sp.foliage]);
      const trunkIds = variants.map((v) => [trunkMesh.addGeometry(v.trunk), trunkMesh.addGeometry(v.trunkLow)]);
      const crownIds = variants.map((v) => [crownMesh.addGeometry(v.crown), crownMesh.addGeometry(v.crownLow)]);
      const instances = [];
      list.forEach((t) => {
        const v = t.variant % VARIANTS;
        p.set(t.x, t.y - 0.25 * t.scale, t.z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        s.setScalar(t.scale);
        m.compose(p, q, s);
        const ti = trunkMesh.addInstance(trunkIds[v][0]);
        trunkMesh.setMatrixAt(ti, m);
        const ci = crownMesh.addInstance(crownIds[v][0]);
        crownMesh.setMatrixAt(ci, m);
        color.setRGB(t.color[0], t.color[1], t.color[2]);
        crownMesh.setColorAt(ci, color);
        instances.push({ ci, ti, v });
      });
      for (const mesh of [trunkMesh, crownMesh]) {
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.perObjectFrustumCulled = true;
        mesh.sortObjects = false;
        mesh.computeBoundingSphere();
        this.group.add(mesh);
      }
      const center = new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK);
      this.chunks.push({ center, trunkMesh, crownMesh, crownIds, trunkIds, instances, lod: 0 });
    }
  }

  update(camera, time, sunDir) {
    this.uniforms.uTime.value = time;
    const sv = this.uniforms.uSunDirView.value;
    sv.copy(sunDir).transformDirection(camera.matrixWorldInverse);
    const cx = camera.position.x, cz = camera.position.z;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(c.center.x - cx) - CHUNK / 2), dz = Math.max(0, Math.abs(c.center.z - cz) - CHUNK / 2);
      const d = Math.hypot(dx, dz);
      const lod = d < 110 ? 0 : 1;
      const far = d < 480;
      c.crownMesh.visible = far;
      c.trunkMesh.visible = far;
      c.trunkMesh.castShadow = d < 200;
      c.crownMesh.castShadow = d < 160;
      if (lod !== c.lod) {
        c.lod = lod;
        for (const inst of c.instances) {
          c.crownMesh.setGeometryIdAt(inst.ci, c.crownIds[inst.v][lod]);
          c.trunkMesh.setGeometryIdAt(inst.ti, c.trunkIds[inst.v][lod]);
        }
      }
    }
  }

  setSun(color, intensity) {
    this.uniforms.uSunColor.value.copy(color).multiplyScalar(intensity * 0.35);
  }
}
