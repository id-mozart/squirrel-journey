// Генерация мира: карта высот, биомы, сплат-карта поверхностей и расстановка объектов.
import { Noise2D, hash2, mulberry32, clamp, lerp, smoothstep } from './noise.js';

export const WORLD = { minX: -300, maxX: 300, minZ: -100, maxZ: 2100, cell: 2 };
WORLD.nx = Math.round((WORLD.maxX - WORLD.minX) / WORLD.cell) + 1;
WORLD.nz = Math.round((WORLD.maxZ - WORLD.minZ) / WORLD.cell) + 1;

export const RIVER_LEVEL = 9.0;
export const POND = { x: -90, z: 600, r: 26, level: 15.5 };
export const HOME_Z = 0;
export const SUMMIT_Z = 2000;

export const REGIONS = [
  { id: 0, name: 'Дубовая роща', sub: 'Утро. Дом под старым дубом', z0: -100, z1: 400 },
  { id: 1, name: 'Берёзовый луг', sub: 'Полдень. Пыльца и стрекозы', z0: 400, z1: 800 },
  { id: 2, name: 'Речная долина', sub: 'После полудня. Холодная вода', z0: 800, z1: 1100 },
  { id: 3, name: 'Сосновое предгорье', sub: 'Золотой час. Смола и камень', z0: 1100, z1: 1600 },
  { id: 4, name: 'Снежные вершины', sub: 'Закат. Дорога к Древнему кедру', z0: 1600, z1: 2100 },
];

// Кусочно-гладкая интерполяция по ключевым точкам
function profile(keys) {
  return (z) => {
    if (z <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (z <= keys[i][0]) {
        const t = smoothstep(keys[i - 1][0], keys[i][0], z);
        return lerp(keys[i - 1][1], keys[i][1], t);
      }
    }
    return keys[keys.length - 1][1];
  };
}

const baseProfile = profile([[-100, 12], [0, 12], [400, 16], [800, 15], [950, 12], [1100, 18], [1400, 52], [1700, 105], [1950, 165], [2100, 185]]);
const ampProfile = profile([[-100, 5], [0, 5], [400, 4], [800, 3], [950, 2], [1100, 6], [1400, 16], [1700, 28], [2100, 30]]);

export class World {
  constructor(seed = 7) {
    this.seed = seed;
    this.noise = new Noise2D(seed);
    this.noiseB = new Noise2D(seed + 100);
    this.rnd = mulberry32(seed * 7919);
    this.colliders = [];
    this.colliderGrid = new Map();
    this.treeGrid = new Map();
  }

  trailX(z) {
    return 60 * Math.sin(z / 210) + 30 * Math.sin(z / 97 + 1.3) + 12 * Math.sin(z / 41 + 0.7);
  }

  riverZ(x) {
    return 950 + 35 * Math.sin(x / 70) + 15 * Math.sin(x / 31 + 1.0);
  }

  // Биом по продольной координате с шумовой границей. Возвращает индекс и веса (5 биомов).
  biomeWeights(x, z, out = new Float32Array(5)) {
    const zn = z + 45 * this.noiseB.noise(x / 160, z / 160);
    const edges = [400, 800, 1100, 1600];
    // beyond[i] — доля «за» границей i; вес биома i = beyond[i-1] - beyond[i]
    let prevBeyond = 1;
    for (let i = 0; i < edges.length; i++) {
      const beyond = smoothstep(edges[i] - 40, edges[i] + 40, zn);
      out[i] = prevBeyond - beyond;
      prevBeyond = beyond;
    }
    out[4] = prevBeyond;
    return out;
  }

  regionAt(z) {
    for (const r of REGIONS) if (z < r.z1) return r;
    return REGIONS[REGIONS.length - 1];
  }

  // Аналитическая высота (используется только при построении сетки)
  computeHeight(x, z) {
    const n = this.noise;
    let h = baseProfile(z);
    const amp = ampProfile(z);
    const trailD = Math.abs(x - this.trailX(z));
    const trailF = smoothstep(4, 30, trailD);
    const n1 = n.fbm(x / 140, z / 140, 5);
    const n2 = n.fbm(x / 25 + 3, z / 25, 3);
    let hills = amp * n1 * lerp(0.2, 1, trailF) + 1.3 * n2 * lerp(0.3, 1, trailF);
    const mountain = smoothstep(1350, 1650, z);
    if (mountain > 0) {
      const r = n.ridged(x / 240 + 9, z / 240, 5);
      hills += mountain * amp * 0.9 * (r - 0.5) * 2 * trailF;
    }
    h += hills;
    // пограничные горы
    const bx = smoothstep(232, 300, Math.abs(x));
    const bz = Math.max(smoothstep(2035, 2100, z), smoothstep(-40, -100, z));
    const bn = 0.8 + 0.5 * n.fbm(x / 60, z / 60, 3);
    h += (bx * bx + bz * bz) * 95 * bn;
    // река
    const d = Math.abs(z - this.riverZ(x));
    const carve = smoothstep(34, 10, d);
    if (carve > 0) {
      const bed = RIVER_LEVEL - 2.5 + 0.5 * n2 + 0.6 * smoothstep(10, 0, d) * -1;
      h = lerp(h, bed, carve);
    }
    // пруд
    const pd = Math.hypot(x - POND.x, z - POND.z);
    if (pd < 64) {
      h = lerp(h, POND.level + 0.8 + 0.3 * n2, smoothstep(64, 36, pd));
      h = lerp(h, POND.level - 1.8, smoothstep(30, 15, pd));
    }
    // поляна у дома и вершина
    const hd = Math.hypot(x - this.trailX(HOME_Z), z - HOME_Z);
    if (hd < 34) h = lerp(h, baseProfile(HOME_Z) + 0.6 + 0.3 * n2, smoothstep(34, 12, hd));
    const sd = Math.hypot(x - this.trailX(SUMMIT_Z), z - SUMMIT_Z);
    if (sd < 44) h = lerp(h, baseProfile(SUMMIT_Z) + 3 + 0.3 * n2, smoothstep(44, 18, sd));
    return h;
  }

  build(onProgress) {
    const { nx, nz, minX, minZ, cell } = WORLD;
    const heights = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * cell;
      for (let i = 0; i < nx; i++) heights[j * nx + i] = this.computeHeight(minX + i * cell, z);
    }
    this.heights = heights;
    onProgress?.(0.3);
    this.buildSplat();
    onProgress?.(0.5);
    this.placeTrees();
    onProgress?.(0.7);
    this.placeProps();
    onProgress?.(0.9);
    this.placeCollectibles();
    onProgress?.(1);
  }

  heightAt(x, z) {
    const { nx, nz, minX, minZ, cell } = WORLD;
    const fx = clamp((x - minX) / cell, 0, nx - 1.001), fz = clamp((z - minZ) / cell, 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const h = this.heights;
    const a = h[j * nx + i], b = h[j * nx + i + 1], c = h[(j + 1) * nx + i], d = h[(j + 1) * nx + i + 1];
    // та же триангуляция, что у сетки террейна (диагональ a-d)
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  normalAt(x, z, out) {
    const e = 0.6;
    const hx1 = this.heightAt(x + e, z), hx0 = this.heightAt(x - e, z);
    const hz1 = this.heightAt(x, z + e), hz0 = this.heightAt(x, z - e);
    const nx = -(hx1 - hx0) / (2 * e), nz = -(hz1 - hz0) / (2 * e);
    const len = Math.hypot(nx, 1, nz);
    out.set(nx / len, 1 / len, nz / len);
    return out;
  }

  slopeAt(x, z) {
    const e = 1.0;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  // Уровень воды в точке (или -Infinity если воды нет)
  waterLevelAt(x, z) {
    const d = Math.abs(z - this.riverZ(x));
    if (d < 40) return RIVER_LEVEL;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 6) return POND.level;
    return -Infinity;
  }

  buildSplat() {
    const { nx, nz, minX, minZ, cell } = WORLD;
    const s1 = new Uint8Array(nx * nz * 4);
    const s2 = new Uint8Array(nx * nz * 4);
    const bw = new Float32Array(5);
    const n = this.noise, nb = this.noiseB;
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * cell;
      for (let i = 0; i < nx; i++) {
        const x = minX + i * cell;
        const h = this.heights[j * nx + i];
        this.biomeWeights(x, z, bw);
        const patch = nb.fbm(x / 30, z / 30, 3) * 0.5 + 0.5;       // пятна 0..1
        const patch2 = n.fbm(x / 12 + 50, z / 12, 2) * 0.5 + 0.5;
        const trailD = Math.abs(x - this.trailX(z));
        const trail = smoothstep(6.5, 2.5, trailD + (patch2 - 0.5) * 3);
        let grass = 0, leaves = 0, dirt = 0, snow = 0, pebbles = 0, needles = 0, blades = 0;
        // дубрава
        { const w = bw[0]; leaves += w * lerp(0.55, 0.95, patch); dirt += w * lerp(0.35, 0.05, patch); grass += w * 0.1 * patch2; blades += w * lerp(0.15, 0.45, patch); }
        // луг
        { const w = bw[1]; grass += w * lerp(0.75, 0.98, patch); dirt += w * lerp(0.2, 0.02, patch); blades += w * lerp(0.7, 1.0, patch); }
        // долина
        { const w = bw[2]; grass += w * lerp(0.5, 0.9, patch); dirt += w * lerp(0.4, 0.1, patch); blades += w * lerp(0.4, 0.8, patch); }
        // предгорье
        { const w = bw[3]; needles += w * lerp(0.5, 0.9, patch); dirt += w * lerp(0.3, 0.05, patch); grass += w * 0.15 * patch2; blades += w * lerp(0.1, 0.35, patch2); }
        // вершины
        { const w = bw[4]; needles += w * 0.4 * (1 - patch); dirt += w * 0.3; blades += w * 0.05; }
        // тропа
        const trailMix = trail * 0.85;
        grass *= 1 - trailMix; leaves *= 1 - trailMix; needles *= 1 - trailMix; blades *= 1 - trail;
        dirt = dirt * (1 - trailMix) + trailMix;
        // галька у воды
        const wl = this.waterLevelAt(x, z);
        if (wl > -1e9) {
          const near = smoothstep(wl + 2.2 + patch * 1.2, wl + 0.6, h);
          pebbles = near;
          const k = 1 - near;
          grass *= k; leaves *= k; dirt *= k; needles *= k; blades *= k * k;
        }
        // снег
        const snowLine = smoothstep(1560, 1720, z + 70 * (patch - 0.5) + (h - baseProfile(z)) * 1.5);
        const slope = this.slopeAtIdx(i, j);
        const snowW = snowLine * (1 - smoothstep(0.55, 1.1, slope));
        snow = snowW;
        const ks = 1 - snowW;
        grass *= ks; leaves *= ks; dirt *= ks; needles *= ks; pebbles *= ks; blades *= ks * ks;
        // нормализация (остаток — камень в шейдере по уклону)
        const sum = grass + leaves + dirt + snow + pebbles + needles;
        if (sum > 1) { const k = 1 / sum; grass *= k; leaves *= k; dirt *= k; snow *= k; pebbles *= k; needles *= k; }
        const o = (j * nx + i) * 4;
        s1[o] = grass * 255; s1[o + 1] = leaves * 255; s1[o + 2] = dirt * 255; s1[o + 3] = snow * 255;
        s2[o] = pebbles * 255; s2[o + 1] = needles * 255; s2[o + 2] = patch * 255; s2[o + 3] = clamp(blades, 0, 1) * 255;
      }
    }
    this.splat1 = s1; this.splat2 = s2;
  }

  slopeAtIdx(i, j) {
    const { nx, nz, cell } = WORLD;
    const h = this.heights;
    const i0 = Math.max(0, i - 1), i1 = Math.min(nx - 1, i + 1);
    const j0 = Math.max(0, j - 1), j1 = Math.min(nz - 1, j + 1);
    const dx = (h[j * nx + i1] - h[j * nx + i0]) / ((i1 - i0) * cell);
    const dz = (h[j1 * nx + i] - h[j0 * nx + i]) / ((j1 - j0) * cell);
    return Math.hypot(dx, dz);
  }

  bladesAt(x, z) {
    const { nx, nz, minX, minZ, cell } = WORLD;
    const i = clamp(Math.round((x - minX) / cell), 0, nx - 1), j = clamp(Math.round((z - minZ) / cell), 0, nz - 1);
    return this.splat2[(j * nx + i) * 4 + 3] / 255;
  }

  isWater(x, z) {
    const wl = this.waterLevelAt(x, z);
    return wl > -1e9 && this.heightAt(x, z) < wl + 0.3;
  }

  // ------------------------------------------------------------ Деревья
  placeTrees() {
    const trees = [];
    const bw = new Float32Array(5);
    const cellSize = 7.5;
    const nb = this.noiseB;
    const homeX = this.trailX(HOME_Z), summitX = this.trailX(SUMMIT_Z);
    for (let gz = WORLD.minZ + 20; gz < WORLD.maxZ - 20; gz += cellSize) {
      for (let gx = WORLD.minX + 20; gx < WORLD.maxX - 20; gx += cellSize) {
        const r1 = hash2(gx * 10, gz * 10, 1), r2 = hash2(gx * 10, gz * 10, 2), r3 = hash2(gx * 10, gz * 10, 3), r4 = hash2(gx * 10, gz * 10, 4);
        const x = gx + (r1 - 0.5) * cellSize * 0.95, z = gz + (r2 - 0.5) * cellSize * 0.95;
        if (Math.abs(x) > 248 || z < -55 || z > 2055) continue;
        const trailD = Math.abs(x - this.trailX(z));
        if (trailD < 4.5) continue;
        if (this.isWater(x, z)) continue;
        if (this.waterLevelAt(x, z) > -1e9 && this.heightAt(x, z) < this.waterLevelAt(x, z) + 1.0) continue;
        if (this.slopeAt(x, z) > 0.75) continue;
        if (Math.hypot(x - homeX, z - HOME_Z) < 15) continue;
        if (Math.hypot(x - summitX, z - SUMMIT_Z) < 18) continue;
        this.biomeWeights(x, z, bw);
        const clearing = nb.fbm(x / 70 + 200, z / 70, 3);        // -1..1
        const cluster = nb.fbm(x / 45 + 400, z / 45, 2);
        let density = 0, species = 0;
        // выбираем биом по максимальному весу
        let bi = 0; for (let k = 1; k < 5; k++) if (bw[k] > bw[bi]) bi = k;
        if (bi === 0) { density = 0.6 * smoothstep(-0.55, 0.1, clearing); species = r3 < 0.85 ? 0 : 1; }
        else if (bi === 1) { density = cluster > 0.12 ? 0.6 : 0.04; species = r3 < 0.9 ? 1 : 0; }
        else if (bi === 2) { density = 0.28 * smoothstep(-0.4, 0.2, clearing); species = r3 < 0.55 ? 1 : (r3 < 0.85 ? 0 : 2); }
        else if (bi === 3) { density = 0.55 * smoothstep(-0.6, 0.0, clearing); species = r3 < 0.6 ? 2 : 3; }
        else { const line = 1 - smoothstep(1780, 1900, z); density = 0.45 * line * smoothstep(-0.5, 0.1, clearing); species = r3 < 0.25 ? 2 : 3; }
        if (r4 > density) continue;
        const scale = lerp(0.8, 1.35, hash2(gx * 10, gz * 10, 5));
        const y = this.heightAt(x, z);
        const color = this.treeColor(species, bi, hash2(gx * 10, gz * 10, 6), z);
        trees.push(this.makeTree(x, y, z, species, scale, hash2(gx * 10, gz * 10, 7) * Math.PI * 2, color, hash2(gx * 10, gz * 10, 8)));
      }
    }
    // Домашний дуб и Древний кедр
    trees.push(this.makeTree(homeX + 6, this.heightAt(homeX + 6, HOME_Z - 4), HOME_Z - 4, 0, 2.1, 0.4, [0.95, 0.55, 0.18], 0.5, 'home'));
    trees.push(this.makeTree(summitX, this.heightAt(summitX, SUMMIT_Z + 6), SUMMIT_Z + 6, 3, 2.6, 0.2, [0.9, 1.0, 0.95], 0.5, 'cedar'));
    this.trees = trees;
    // сетка деревьев для коллизий
    this.treeGrid.clear();
    trees.forEach((t, idx) => {
      const key = this.gridKey(t.x, t.z);
      if (!this.treeGrid.has(key)) this.treeGrid.set(key, []);
      this.treeGrid.get(key).push(idx);
    });
  }

  treeColor(species, biome, r, z) {
    // цвет умножается на текстуру-карточку (светлая нейтральная), поэтому задаёт оттенок кроны
    if (species === 0) {
      // осенний дуб/клён: от зелёного к жёлтому, оранжевому и красному
      const t = r;
      if (biome === 2) return [0.55 + 0.2 * t, 0.62, 0.2];
      if (t < 0.2) return [0.5, 0.6, 0.18];
      if (t < 0.45) return [0.95, 0.75, 0.2];
      if (t < 0.75) return [0.95, 0.45, 0.12];
      return [0.85, 0.22, 0.1];
    }
    if (species === 1) {
      // берёза: жёлто-зелёная, к осени золотая
      return [0.75 + 0.2 * r, 0.7 + 0.1 * r, 0.2];
    }
    if (species === 2) return [0.9 + 0.15 * r, 0.95 + 0.1 * r, 0.75];
    // ель: тёмно-зелёная; на снегу — светлее и холоднее
    const snowy = smoothstep(1580, 1750, z);
    return [lerp(0.8, 1.05, snowy), lerp(0.85, 1.1, snowy), lerp(0.7, 1.15, snowy)];
  }

  makeTree(x, y, z, species, scale, rot, color, variant, tag = null) {
    const base = [[16, 0.42, 6.5], [15, 0.24, 3.2], [20, 0.34, 4.0], [17, 0.3, 3.4]][species]; // высота, радиус ствола, радиус кроны
    return {
      x, y, z, species, scale, rot, color, variant: Math.floor(variant * 3), tag,
      height: base[0] * scale, radius: base[1] * scale, crown: base[2] * scale,
      climbTop: base[0] * scale * (species >= 2 ? 0.75 : 0.62),
    };
  }

  gridKey(x, z) { return `${Math.floor(x / 16)},${Math.floor(z / 16)}`; }

  nearbyTrees(x, z, out = []) {
    out.length = 0;
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const list = this.treeGrid.get(`${gx + i},${gz + j}`);
      if (list) for (const idx of list) out.push(this.trees[idx]);
    }
    return out;
  }

  // ------------------------------------------------------------ Камни, брёвна, грибы, цветы
  placeProps() {
    const rocks = [], mushrooms = [], flowers = [], logs = [];
    const bw = new Float32Array(5);
    const homeX = this.trailX(HOME_Z), summitX = this.trailX(SUMMIT_Z);
    const cellSize = 11;
    for (let gz = WORLD.minZ + 10; gz < WORLD.maxZ - 10; gz += cellSize) {
      for (let gx = WORLD.minX + 10; gx < WORLD.maxX - 10; gx += cellSize) {
        const r = [1, 2, 3, 4, 5, 6, 7].map((k) => hash2(gx * 3, gz * 3, 40 + k));
        const x = gx + (r[0] - 0.5) * cellSize, z = gz + (r[1] - 0.5) * cellSize;
        if (Math.abs(x) > 260 || z < -70 || z > 2070) continue;
        if (Math.abs(x - this.trailX(z)) < 3.5) continue;
        if (this.isWater(x, z)) continue;
        this.biomeWeights(x, z, bw);
        let bi = 0; for (let k = 1; k < 5; k++) if (bw[k] > bw[bi]) bi = k;
        const slope = this.slopeAt(x, z);
        const density = [0.14, 0.08, 0.3, 0.42, 0.55][bi] + smoothstep(0.35, 0.8, slope) * 0.4;
        if (r[2] < density) {
          const size = lerp(0.5, 3.2, r[3] * r[3]) * (bi >= 3 ? 1.4 : 1);
          rocks.push({ x, y: this.heightAt(x, z) - size * 0.25, z, rx: size * lerp(0.8, 1.4, r[4]), ry: size * lerp(0.5, 0.9, r[5]), rz: size * lerp(0.8, 1.3, r[6]), rot: r[4] * Math.PI * 2, tilt: (r[5] - 0.5) * 0.5 });
        }
        // грибы: в дубраве и бору, у деревьев
        if ((bi === 0 || bi === 3) && r[4] < 0.35) {
          const nt = this.nearbyTrees(x, z);
          for (let k = 0; k < 3 && k < nt.length; k++) {
            const t = nt[k];
            const a = r[5] * Math.PI * 2 + k * 2.1, d = t.radius + 0.4 + r[6] * 1.5;
            const mx = t.x + Math.cos(a) * d, mz = t.z + Math.sin(a) * d;
            if (this.isWater(mx, mz)) continue;
            mushrooms.push({ x: mx, y: this.heightAt(mx, mz), z: mz, s: lerp(0.12, 0.3, hash2(mx * 100, mz * 100, 9)), rot: hash2(mx * 10, mz * 10, 10) * 6.28, kind: hash2(mx * 10, mz * 10, 11) < 0.6 ? 0 : 1 });
          }
        }
        // цветы на лугу и в долине
        if ((bi === 1 || bi === 2) && r[5] < 0.5) {
          const count = 6 + Math.floor(r[6] * 10);
          const kind = Math.floor(hash2(gx, gz, 12) * 3);
          for (let k = 0; k < count; k++) {
            const fx = x + (hash2(gx * 7 + k, gz, 13) - 0.5) * 6, fz = z + (hash2(gx, gz * 7 + k, 14) - 0.5) * 6;
            if (this.isWater(fx, fz) || Math.abs(fx - this.trailX(fz)) < 2.5) continue;
            flowers.push({ x: fx, y: this.heightAt(fx, fz), z: fz, kind, s: lerp(0.7, 1.3, hash2(fx * 50, fz * 50, 15)), rot: hash2(fx * 5, fz * 5, 16) * 6.28 });
          }
        }
      }
    }
    // камни-ступени через реку на тропе
    const crossX = this.trailX(950);
    const zr = this.riverZ(crossX);
    for (let k = -3; k <= 3; k++) {
      const sx = crossX + (hash2(k, 1, 17) - 0.5) * 1.6, sz = zr + k * 2.6;
      rocks.push({ x: sx, y: RIVER_LEVEL - 0.7, z: sz, rx: 1.35, ry: 1.0, rz: 1.25, rot: hash2(k, 2, 18) * 6.28, tilt: 0, stepping: true });
    }
    // упавшее бревно через реку в стороне от тропы
    for (const dx of [-45, 60]) {
      const lx = crossX + dx, lz = this.riverZ(lx);
      const ang = 0.25 * (hash2(dx, 3, 19) - 0.5);
      logs.push({ x: lx, z: lz, y: RIVER_LEVEL + 0.35, len: 34, r: 0.55, ang: Math.PI / 2 + ang });
    }
    // бревно у пруда и несколько в лесу
    logs.push({ x: POND.x + POND.r + 8, z: POND.z + 4, y: this.heightAt(POND.x + POND.r + 8, POND.z + 4) + 0.35, len: 9, r: 0.45, ang: 0.6 });
    for (let k = 0; k < 14; k++) {
      const z = 40 + k * 130 + hash2(k, 5, 21) * 60, x = this.trailX(z) + (hash2(k, 6, 22) > 0.5 ? 1 : -1) * (7 + hash2(k, 7, 23) * 25);
      if (this.isWater(x, z) || Math.abs(x) > 240) continue;
      logs.push({ x, z, y: this.heightAt(x, z) + 0.3, len: 6 + hash2(k, 8, 24) * 6, r: 0.35 + hash2(k, 9, 25) * 0.25, ang: hash2(k, 10, 26) * Math.PI });
    }
    this.rocks = rocks; this.mushrooms = mushrooms; this.flowers = flowers; this.logs = logs;
    // коллайдеры
    this.colliders = [];
    for (const r of rocks) this.colliders.push({ type: 'ellipsoid', ...r });
    for (const l of logs) this.colliders.push({ type: 'capsule', ...l, ax: Math.cos(l.ang), az: Math.sin(l.ang) });
    this.colliderGrid.clear();
    this.colliders.forEach((c, idx) => {
      const reach = c.type === 'capsule' ? c.len / 2 + c.r : Math.max(c.rx, c.rz);
      const g0x = Math.floor((c.x - reach) / 16), g1x = Math.floor((c.x + reach) / 16);
      const g0z = Math.floor((c.z - reach) / 16), g1z = Math.floor((c.z + reach) / 16);
      for (let gz = g0z; gz <= g1z; gz++) for (let gx = g0x; gx <= g1x; gx++) {
        const key = `${gx},${gz}`;
        if (!this.colliderGrid.has(key)) this.colliderGrid.set(key, []);
        this.colliderGrid.get(key).push(idx);
      }
    });
  }

  // Высота опоры с учётом камней и брёвен (по которым можно ходить)
  groundAt(x, z) {
    let h = this.heightAt(x, z);
    const list = this.colliderGrid.get(this.gridKey(x, z));
    if (!list) return h;
    for (const idx of list) {
      const c = this.colliders[idx];
      if (c.type === 'ellipsoid') {
        const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        const q = (lx * lx) / (c.rx * c.rx) + (lz * lz) / (c.rz * c.rz);
        if (q < 1) h = Math.max(h, c.y + c.ry * Math.sqrt(1 - q));
      } else {
        const dx = x - c.x, dz = z - c.z;
        const t = clamp(dx * c.ax + dz * c.az, -c.len / 2, c.len / 2);
        const px = c.x + c.ax * t, pz = c.z + c.az * t;
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < c.r * c.r) h = Math.max(h, c.y + Math.sqrt(c.r * c.r - d2));
      }
    }
    return h;
  }

  // ------------------------------------------------------------ Жёлуди
  placeCollectibles() {
    const acorns = [], golden = [];
    const rnd = mulberry32(this.seed * 31 + 5);
    // вдоль тропы и рядом с дубами
    for (let z = 15; z < 1990; z += 11) {
      if (rnd() > 0.55) continue;
      const side = (rnd() - 0.5) * 9;
      const x = this.trailX(z) + side;
      if (this.isWater(x, z)) continue;
      acorns.push({ x, z, y: this.groundAt(x, z) + 0.22 });
    }
    for (const t of this.trees) {
      if (t.species === 0 && rnd() < 0.35) {
        const a = rnd() * 6.28, d = t.radius + 0.6 + rnd() * 2.5;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        if (this.isWater(x, z)) continue;
        acorns.push({ x, z, y: this.groundAt(x, z) + 0.22 });
      }
    }
    // золотые жёлуди на вершинах деревьев — равномерно по маршруту
    const candidates = this.trees.filter((t) => !t.tag && Math.abs(t.x - this.trailX(t.z)) < 45 && t.height > 12);
    candidates.sort((a, b) => a.z - b.z);
    const want = 24;
    for (let k = 0; k < want; k++) {
      const zTarget = 30 + (k / (want - 1)) * 1900;
      let best = null, bd = 1e9;
      for (const t of candidates) { const d = Math.abs(t.z - zTarget); if (d < bd && !t.golden) { bd = d; best = t; } }
      if (best) { best.golden = true; golden.push({ x: best.x, z: best.z, y: best.y + best.climbTop + 0.6, tree: best }); }
    }
    this.acorns = acorns; this.golden = golden;
  }
}
