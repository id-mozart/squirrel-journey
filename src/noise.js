// Детерминированный шум на CPU (перлин 2D + fbm) для генерации ландшафта и расстановки объектов.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class Noise2D {
  constructor(seed = 1) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(512);
    const base = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [base[i], base[j]] = [base[j], base[i]];
    }
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    this.p = p;
    this.grad = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  }

  // Перлин, приблизительно -1..1
  noise(x, y) {
    const p = this.p;
    const X = Math.floor(x), Y = Math.floor(y);
    const xf = x - X, yf = y - Y;
    const xi = X & 255, yi = Y & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const g = this.grad;
    const aa = g[p[p[xi] + yi] & 7], ba = g[p[p[xi + 1] + yi] & 7];
    const ab = g[p[p[xi] + yi + 1] & 7], bb = g[p[p[xi + 1] + yi + 1] & 7];
    const n00 = aa[0] * xf + aa[1] * yf;
    const n10 = ba[0] * (xf - 1) + ba[1] * yf;
    const n01 = ab[0] * xf + ab[1] * (yf - 1);
    const n11 = bb[0] * (xf - 1) + bb[1] * (yf - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  }

  fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let a = 1, s = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * this.noise(x, y);
      norm += a;
      x = x * lacunarity + 17.3; y = y * lacunarity + 9.1; a *= gain;
    }
    return s / norm;
  }

  ridged(x, y, octaves = 4) {
    let a = 1, s = 0, norm = 0, w = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(x, y));
      n = n * n * w;
      w = Math.min(1, n * 1.6);
      s += a * n; norm += a;
      x = x * 2 + 5.7; y = y * 2 + 3.3; a *= 0.5;
    }
    return s / norm;
  }
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
