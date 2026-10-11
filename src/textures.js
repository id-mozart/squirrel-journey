// Определения процедурных PBR-текстур. Каждый материал задаёт H(uv) — высоту и surface(...) — цвет/шероховатость/альфу.
// Все наземные текстуры и кора — бесшовные (периодические шумы), карточки листвы — вырезные (cutout).

const COMMON = /* glsl */`
// Слой «штрихов» (травинки, хвоинки, веточки): в каждой клетке один штрих со случайной ориентацией.
// Композиция по высоте: побеждает штрих с наибольшей h.
struct Stroke { float h; vec3 col; float t; float m; bool hit; };

void strokeLayer(vec2 uv, float freq, float seed, float len, float wid, float hBase, vec3 cRoot, vec3 cTip, float px, inout Stroke s){
  vec2 p = uv * freq; vec2 i = floor(p), f = fract(p);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 c = pmod(i + o, vec2(freq)) + seed;
    vec4 r = hash42(c);
    vec2 center = o + r.xy;
    float ang = r.z * TAU;
    vec2 d = rot(ang) * (f - center);
    float t01 = d.x / len + 0.5;
    if (t01 < 0.0 || t01 > 1.0) continue;
    float w = wid * (1.0 - t01 * t01 * 0.85) * (0.7 + 0.5 * r.w);
    float m = sat((w - abs(d.y)) / (px * 1.5));
    if (m <= 0.0) continue;
    float h = hBase + 0.45 * t01 + r.w * 0.12 + m * 0.06;
    if (h > s.h){
      s.h = h; s.t = t01; s.m = m; s.hit = true;
      s.col = mix(cRoot, cTip, t01) * (0.78 + 0.44 * hash11(r.w * 91.7));
    }
  }
}

// Форма листа в локальных координатах (x — вдоль от черешка к кончику, y — поперёк). Возвращает маску 0..1.
// kind: 0 — овальный (берёза), 1 — лопастной (дуб), 2 — кленовый
float leafMask(vec2 d, float len, float wid, float kind, float px, out float t01, out float across){
  t01 = d.x / len + 0.5;
  across = 0.0;
  if (t01 < -0.05 || t01 > 1.05) return 0.0;
  float prof = pow(sat(sin(sat(t01) * PI)), 0.65);
  float lobes = 1.0;
  if (kind > 0.5 && kind < 1.5) lobes = 1.0 + 0.32 * sin(t01 * PI * 4.0 - 0.9) * smoothstep(0.0, 0.3, t01);
  if (kind >= 1.5) lobes = 1.0 + 0.45 * pow(abs(sin(t01 * PI * 2.5 + 0.4)), 3.0);
  if (kind < 0.5) prof = pow(sat(sin(sat(t01) * PI)), 0.8) * (1.0 - 0.25 * t01);
  float w = wid * prof * lobes;
  // зубчики по краю берёзового листа
  if (kind < 0.5) w *= 1.0 + 0.05 * sin(t01 * 60.0);
  across = abs(d.y) / max(w, 1e-4);
  return sat((w - abs(d.y)) / (px * 1.5));
}

// Слой опавших листьев
struct Leaf { float h; vec3 col; float rough; bool hit; };

vec3 leafPalette(float r){
  vec3 c;
  if (r < 0.22) c = vec3(0.78, 0.56, 0.09);        // жёлтый
  else if (r < 0.48) c = vec3(0.82, 0.32, 0.06);   // оранжевый
  else if (r < 0.66) c = vec3(0.55, 0.11, 0.05);   // красный
  else if (r < 0.88) c = vec3(0.36, 0.2, 0.07);    // бурый
  else c = vec3(0.4, 0.42, 0.1);                   // ещё зелёный
  return c;
}

void leafLayer(vec2 uv, float freq, float seed, float len, float wid, float hBase, float px, inout Leaf L){
  vec2 p = uv * freq; vec2 i = floor(p), f = fract(p);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 c = pmod(i + o, vec2(freq)) + seed;
    vec4 r = hash42(c);
    vec2 center = o + r.xy;
    vec2 d = rot(r.z * TAU) * (f - center);
    float t01, across;
    float kind = r.w < 0.55 ? 1.0 : (r.w < 0.8 ? 0.0 : 2.0);
    float m = leafMask(d, len * (0.8 + 0.4 * r.w), wid * (0.8 + 0.4 * hash11(r.z * 33.1)), kind, px, t01, across);
    if (m <= 0.0) continue;
    float curl = across * across * 0.18 + sin(t01 * 6.0 + r.x * 9.0) * 0.04;
    float h = hBase + r.w * 0.25 + curl + 0.05 * m;
    if (h > L.h){
      L.h = h; L.hit = true;
      vec3 base = leafPalette(hash11(r.x * 57.3 + seed));
      float vein = 1.0 - 0.35 * smoothstep(0.06, 0.0, abs(d.y)) * smoothstep(0.0, 0.1, t01);
      float side = 1.0 - 0.18 * smoothstep(0.02, 0.0, abs(fract(t01 * 7.0 + across * 0.9) - 0.5) - 0.42);
      float shade = mix(0.75, 1.15, hash11(r.y * 71.9)) * (0.85 + 0.15 * (1.0 - across)) * vein * side;
      L.col = base * shade * (0.9 + 0.2 * t01);
      L.rough = 0.65 + 0.2 * across;
    }
  }
}

// Купол камешка/гальки на основе Worley
float pebbleDome(vec2 p, vec2 per, float seed, float jitter, float rMin, float rMax, out float id, out float inside){
  vec4 w = worley(p, per, seed, jitter);
  id = w.z;
  float r = mix(rMin, rMax, hash11(w.z * 13.7));
  float q = sat(1.0 - w.x / r);
  inside = q;
  return sqrt(sat(1.0 - pow(1.0 - q, 2.0))) * (0.7 + 0.3 * hash11(w.z * 5.1));
}
`;

// ---------------------------------------------------------------- Наземные
const grass = {
  name: 'grass', size: 1024, normalStrength: 1.2, glsl: COMMON + /* glsl */`
Stroke blades(vec2 uv){
  Stroke s; s.h = -1.0; s.hit = false; s.col = vec3(0.0); s.t = 0.0; s.m = 0.0;
  float px = 26.0 / uSize;
  vec3 root = vec3(0.07, 0.12, 0.025), tip = vec3(0.36, 0.55, 0.14);
  vec3 dryRoot = vec3(0.2, 0.17, 0.06), dryTip = vec3(0.6, 0.55, 0.25);
  for (int k = 0; k < 9; k++){
    float fk = float(k);
    float freq = 18.0 + fk * 4.0;
    float dry = step(0.75, hash11(fk * 3.7 + 0.2)) * 0.6;
    vec3 r = mix(root, dryRoot, dry), t = mix(tip, dryTip, dry);
    strokeLayer(uv, freq, 1.0 + fk * 2.0, 1.1, 0.085 - fk * 0.004, 0.15 + fk * 0.06, r, t, px, s);
  }
  return s;
}
float H(vec2 uv){
  Stroke s = blades(uv);
  float soil = vfbm(uv * 8.0, vec2(8.0), 4, 5.0) * 0.2;
  return s.hit ? s.h : soil;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Stroke s = blades(uv);
  float n = vfbm(uv * 8.0, vec2(8.0), 4, 5.0);
  float n2 = vfbm(uv * 3.0, vec2(3.0), 3, 9.0);
  vec3 soil = mix(vec3(0.07, 0.06, 0.03), vec3(0.14, 0.12, 0.06), n);
  if (s.hit){
    // нижние травинки в тени
    col = s.col * mix(0.8, 1.15, n2) * mix(0.45, 1.0, sat((s.h - 0.15) / 0.75));
    rough = 0.7;
  } else { col = soil; rough = 0.95; }
  alpha = 1.0;
}`,
};

const leaves = {
  name: 'leaves', size: 1024, normalStrength: 1.6, glsl: COMMON + /* glsl */`
Leaf litter(vec2 uv){
  Leaf L; L.h = -1.0; L.hit = false; L.col = vec3(0.0); L.rough = 0.8;
  float px = 22.0 / uSize;
  leafLayer(uv, 14.0, 11.0, 0.95, 0.30, 0.20, px, L);
  leafLayer(uv, 18.0, 12.0, 0.95, 0.30, 0.30, px, L);
  leafLayer(uv, 22.0, 13.0, 0.9, 0.28, 0.40, px, L);
  leafLayer(uv, 27.0, 14.0, 0.9, 0.28, 0.50, px, L);
  return L;
}
Stroke twigs(vec2 uv){
  Stroke s; s.h = -1.0; s.hit = false; s.col = vec3(0.0); s.t = 0.0; s.m = 0.0;
  float px = 8.0 / uSize;
  strokeLayer(uv, 5.0, 21.0, 1.4, 0.03, 0.05, vec3(0.2, 0.14, 0.08), vec3(0.28, 0.2, 0.12), px, s);
  strokeLayer(uv, 8.0, 22.0, 1.2, 0.022, 0.08, vec3(0.16, 0.11, 0.06), vec3(0.24, 0.17, 0.1), px, s);
  return s;
}
float H(vec2 uv){
  Leaf L = litter(uv);
  Stroke t = twigs(uv);
  float soil = vfbm(uv * 12.0, vec2(12.0), 4, 3.0) * 0.15;
  float h = soil;
  if (t.hit) h = max(h, t.h);
  if (L.hit) h = L.h;
  return h;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Leaf L = litter(uv);
  Stroke t = twigs(uv);
  float n = vfbm(uv * 12.0, vec2(12.0), 4, 3.0);
  vec3 soil = mix(vec3(0.09, 0.065, 0.04), vec3(0.19, 0.14, 0.08), n);
  col = soil; rough = 0.95;
  if (t.hit){ col = t.col; rough = 0.85; }
  if (L.hit){ col = L.col; rough = L.rough; }
  alpha = 1.0;
}`,
};

const dirt = {
  name: 'dirt', size: 1024, normalStrength: 1.0, glsl: COMMON + /* glsl */`
vec2 warpUV(vec2 uv, float amt, float seed){
  return uv + vec2(fbm(uv * 4.0, vec2(4.0), 3, seed), fbm(uv * 4.0, vec2(4.0), 3, seed + 5.0)) * amt;
}
float stones(vec2 uv, out float id, out float inside){
  vec2 p = warpUV(uv, 0.05, 30.0) * 36.0;
  float peb = pebbleDome(p, vec2(36.0), 32.0, 1.0, 0.14, 0.3, id, inside);
  float mask = step(0.8, hash11(id * 7.7));
  inside *= mask;
  return peb * mask;
}
float H(vec2 uv){
  float base = vfbm(uv * 4.0, vec2(4.0), 6, 31.0) * 0.4;
  vec4 cl = worley(warpUV(uv, 0.03, 38.0) * 16.0, vec2(16.0), 39.0, 1.0);
  float clods = sat(1.0 - cl.x * 1.3) * 0.12 * (0.5 + 0.5 * hash11(cl.z * 3.0));
  float id, inside;
  float peb = stones(uv, id, inside);
  float roots = 0.0;
  float fine = vnoise(uv * 260.0, vec2(260.0), 34.0) * 0.07 + vfbm(uv * 60.0, vec2(60.0), 3, 40.0) * 0.1;
  return base + clods + fine + peb * 0.3;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float n = vfbm(uv * 4.0, vec2(4.0), 6, 31.0);
  float n2 = vfbm(uv * 2.0, vec2(2.0), 3, 35.0);
  float fine = vnoise(uv * 260.0, vec2(260.0), 34.0);
  vec3 dark = vec3(0.14, 0.09, 0.05), light = vec3(0.4, 0.3, 0.19);
  vec3 c = mix(dark, light, sat((h - 0.15) / 0.7));
  c = mix(c, vec3(0.33, 0.28, 0.2), smoothstep(0.55, 0.75, n2) * 0.5);
  c = mix(c, vec3(0.1, 0.07, 0.04), smoothstep(0.6, 0.8, vfbm(uv * 6.0, vec2(6.0), 3, 41.0)) * 0.5); // влажные пятна
  float id, inside;
  float peb = stones(uv, id, inside);
  float pebMask = smoothstep(0.0, 0.03, inside);
  vec3 pc = mix(vec3(0.2, 0.18, 0.16), vec3(0.4, 0.33, 0.26), hash11(id * 3.1)) * (0.55 + 0.5 * peb);
  c = mix(c, pc, pebMask);
  c *= 0.85 + 0.3 * fine;
  col = c; rough = mix(0.95, 0.88, pebMask); alpha = 1.0;
}`,
};

const rock = {
  name: 'rock', size: 1024, normalStrength: 2.4, glsl: COMMON + /* glsl */`
vec2 warp(vec2 uv){
  return uv + vec2(fbm(uv * 3.0, vec2(3.0), 4, 40.0), fbm(uv * 3.0, vec2(3.0), 4, 45.5)) * 0.06;
}
float cracks(vec2 uv){
  vec2 w = warp(uv);
  float e1 = worleyEdge(w * 3.0, vec2(3.0), 43.0, 0.9);
  float e2 = worleyEdge(w * 7.0 + 0.3, vec2(7.0), 44.0, 0.9);
  float m1 = smoothstep(0.5, 0.68, vfbm(uv * 2.0, vec2(2.0), 3, 46.0));
  float m2 = smoothstep(0.55, 0.72, vfbm(uv * 3.0 + 1.0, vec2(3.0), 3, 47.0));
  return smoothstep(0.02, 0.0, e1) * m1 * 0.8 + smoothstep(0.012, 0.0, e2) * m2 * 0.5;
}
float H(vec2 uv){
  vec2 w = warp(uv);
  float big = ridged(w * 2.0, vec2(2.0), 5, 41.0);
  float mid = fbm(w * 7.0, vec2(7.0), 5, 42.0) * 0.5 + 0.5;
  float fine = vfbm(uv * 45.0, vec2(45.0), 3, 48.0);
  float strata = smoothstep(0.3, 0.7, fract((uv.y + fbm(uv * 2.0, vec2(2.0), 3, 45.0) * 0.12) * 5.0)) * 0.08;
  float h = big * 0.5 + mid * 0.32 + fine * 0.12 + strata - cracks(uv) * 0.28;
  return sat(h);
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float low = vfbm(uv * 2.0, vec2(2.0), 3, 46.0);
  float speck = hash12(floor(uv * 1024.0));
  float mineral = vnoise(uv * 180.0, vec2(180.0), 49.0);
  float facet = fbm(warp(uv) * 7.0, vec2(7.0), 5, 42.0) * 0.5 + 0.5;
  vec3 grey = mix(vec3(0.16, 0.16, 0.17), vec3(0.6, 0.58, 0.55), pow(sat((h - 0.05) / 0.85), 1.4));
  grey *= 0.7 + 0.6 * facet;
  vec3 warm = vec3(0.45, 0.36, 0.28) * (0.5 + 0.9 * h);
  vec3 c = mix(grey, warm, smoothstep(0.45, 0.8, low) * 0.4);
  c = mix(c, c * 1.5, step(0.94, speck) * 0.5);
  c = mix(c, c * 0.45, step(0.965, speck) * 0.6);
  c *= 0.85 + 0.3 * mineral;
  float cr = cracks(uv);
  c *= 1.0 - 0.45 * sat(cr);
  float lich = vfbm(uv * 9.0, vec2(9.0), 5, 50.0);
  float lichen = smoothstep(0.64, 0.7, lich) * smoothstep(0.35, 0.6, h);
  vec3 lc = mix(vec3(0.62, 0.66, 0.2), vec3(0.75, 0.76, 0.68), step(0.5, vfbm(uv * 3.0, vec2(3.0), 2, 51.0)));
  c = mix(c, lc * (0.7 + 0.4 * vnoise(uv * 120.0, vec2(120.0), 52.0)), lichen * 0.9);
  float moss = smoothstep(0.62, 0.74, vfbm(uv * 5.0, vec2(5.0), 4, 53.0)) * smoothstep(0.55, 0.2, h);
  c = mix(c, vec3(0.14, 0.26, 0.07) * (0.7 + 0.5 * vfbm(uv * 50.0, vec2(50.0), 2, 54.0)), moss * 0.85);
  col = c; rough = mix(0.78, 0.95, sat(lichen + moss)) - 0.1 * sat(cr); alpha = 1.0;
}`,
};

const snow = {
  name: 'snow', size: 1024, normalStrength: 0.7, glsl: COMMON + /* glsl */`
float H(vec2 uv){
  float drift = vfbm(uv * 2.0, vec2(2.0), 4, 51.0);
  float grain = vfbm(uv * 40.0, vec2(40.0), 3, 52.0);
  float crust = smoothstep(0.55, 0.7, vfbm(uv * 6.0, vec2(6.0), 3, 53.0));
  return drift * 0.7 + grain * 0.12 + crust * 0.08;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float drift = vfbm(uv * 2.0, vec2(2.0), 4, 51.0);
  float sparkle = step(0.988, hash12(floor(uv * 700.0)));
  vec3 c = mix(vec3(0.72, 0.8, 0.94), vec3(0.95, 0.965, 0.99), smoothstep(0.2, 0.8, drift));
  c = mix(c, vec3(1.0), sparkle);
  col = c; rough = mix(0.62, 0.2, sparkle); alpha = 1.0;
}`,
};

const pebbles = {
  name: 'pebbles', size: 1024, normalStrength: 1.6, glsl: COMMON + /* glsl */`
vec2 warp(vec2 uv, float seed){
  return uv + vec2(fbm(uv * 5.0, vec2(5.0), 3, seed), fbm(uv * 5.0, vec2(5.0), 3, seed + 3.0)) * 0.035;
}
float bigStones(vec2 uv, out float id, out float inside){
  float d = pebbleDome(warp(uv, 60.0) * 11.0, vec2(11.0), 61.0, 1.0, 0.3, 0.5, id, inside);
  float mask = step(0.35, hash11(id * 4.4));
  inside *= mask; return d * mask;
}
float smallStones(vec2 uv, out float id, out float inside){
  float d = pebbleDome(warp(uv, 65.0) * 24.0, vec2(24.0), 62.0, 1.0, 0.25, 0.45, id, inside);
  float mask = step(0.25, hash11(id * 4.4));
  inside *= mask; return d * mask;
}
float H(vec2 uv){
  float id, inside, id2, inside2;
  float big = bigStones(uv, id, inside);
  float small = smallStones(uv, id2, inside2);
  float sand = vfbm(uv * 30.0, vec2(30.0), 3, 63.0) * 0.12 + vnoise(uv * 300.0, vec2(300.0), 64.0) * 0.05;
  float h = sand;
  h = max(h, small * 0.4 + 0.04);
  h = max(h, big * 0.6 + 0.08);
  return h;
}
vec3 pebbleColor(float id){
  float r = hash11(id * 17.3);
  vec3 c;
  if (r < 0.35) c = vec3(0.45, 0.44, 0.42);
  else if (r < 0.6) c = vec3(0.52, 0.45, 0.36);
  else if (r < 0.78) c = vec3(0.3, 0.3, 0.31);
  else if (r < 0.9) c = vec3(0.46, 0.34, 0.27);
  else c = vec3(0.66, 0.64, 0.6);
  return c * (0.8 + 0.4 * hash11(id * 3.3));
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float id, inside, id2, inside2;
  float big = bigStones(uv, id, inside);
  float small = smallStones(uv, id2, inside2);
  float fine = vfbm(uv * 30.0, vec2(30.0), 3, 63.0);
  float speck = vnoise(uv * 300.0, vec2(300.0), 64.0);
  float grain = hash12(floor(uv * 700.0));
  vec3 sand = mix(vec3(0.22, 0.18, 0.13), vec3(0.34, 0.29, 0.22), fine) * (0.8 + 0.4 * speck);
  sand = mix(sand, vec3(0.5, 0.46, 0.4), step(0.96, grain) * 0.6);
  vec3 c = sand; rough = 0.9;
  float sm = smoothstep(0.0, 0.05, inside2);
  vec3 sc = pebbleColor(id2) * (0.6 + 0.5 * small) * (0.85 + 0.3 * speck);
  sc *= 1.0 - 0.25 * step(0.9, vnoise(uv * 150.0, vec2(150.0), 66.0));
  c = mix(c, sc, sm); rough = mix(rough, 0.6, sm);
  float bm = smoothstep(0.0, 0.035, inside);
  vec3 bc = pebbleColor(id) * (0.5 + 0.6 * big) * (0.85 + 0.3 * speck);
  bc *= 0.8 + 0.4 * vfbm(uv * 40.0, vec2(40.0), 3, 67.0 + id * 10.0);
  c = mix(c, bc, bm); rough = mix(rough, 0.55, bm);
  col = c; alpha = 1.0;
}`,
};

const needles = {
  name: 'needles', size: 1024, normalStrength: 1.2, glsl: COMMON + /* glsl */`
Stroke strokes(vec2 uv){
  Stroke s; s.h = -1.0; s.hit = false; s.col = vec3(0.0); s.t = 0.0; s.m = 0.0;
  float px = 30.0 / uSize;
  vec3 a = vec3(0.33, 0.17, 0.06), b = vec3(0.62, 0.36, 0.13);
  for (int k = 0; k < 10; k++){
    float fk = float(k);
    float freq = 20.0 + fk * 4.0;
    float tone = hash11(fk * 2.1);
    vec3 r = mix(a, a * 0.6, tone), t = mix(b, vec3(0.5, 0.4, 0.2), tone * 0.5);
    strokeLayer(uv, freq, 70.0 + fk * 3.0, 1.45, 0.045 - fk * 0.0015, 0.1 + fk * 0.07, r, t, px, s);
  }
  return s;
}
float H(vec2 uv){
  Stroke s = strokes(uv);
  float soil = vfbm(uv * 10.0, vec2(10.0), 4, 75.0) * 0.15;
  return s.hit ? s.h : soil;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Stroke s = strokes(uv);
  float n = vfbm(uv * 10.0, vec2(10.0), 4, 75.0);
  vec3 soil = mix(vec3(0.1, 0.07, 0.04), vec3(0.2, 0.14, 0.08), n);
  if (s.hit){ col = s.col * mix(0.5, 1.0, sat((s.h - 0.1) / 0.8)); rough = 0.72; }
  else { col = soil; rough = 0.95; }
  alpha = 1.0;
}`,
};

// ---------------------------------------------------------------- Кора
const barkOak = {
  name: 'barkOak', size: 1024, normalStrength: 2.4, glsl: COMMON + /* glsl */`
vec2 warp(vec2 uv){
  return uv + vec2(fbm(uv * vec2(3.0, 1.5), vec2(3.0, 1.5), 3, 81.0) * 0.045, fbm(uv * vec2(3.0, 2.0), vec2(3.0, 2.0), 3, 82.0) * 0.02);
}
// Глубокие вертикальные борозды: тонкие тёмные границы вытянутых ячеек, широкие шероховатые гребни
void bark(vec2 uv, out float furrow, out float plateau, out float id){
  vec2 w = warp(uv);
  vec2 f1 = vec2(11.0, 2.2), f2 = vec2(24.0, 5.0);
  vec4 c1 = worley(w * f1, f1, 83.0, 1.0);
  vec4 c2 = worley(w * f2 + 0.5, f2, 84.0, 1.0);
  float e1 = worleyEdge(w * f1, f1, 83.0, 1.0);
  float e2 = worleyEdge(w * f2 + 0.5, f2, 84.0, 1.0);
  float fur1 = smoothstep(0.09, 0.015, e1);
  float fur2 = smoothstep(0.05, 0.008, e2) * 0.55;
  furrow = sat(fur1 + fur2);
  id = c1.z;
  plateau = 0.55 + 0.35 * hash11(c1.z * 5.3) + 0.12 * hash11(c2.z * 3.1);
}
float H(vec2 uv){
  float furrow, plateau, id; bark(uv, furrow, plateau, id);
  float rough = fbm(uv * 18.0, vec2(18.0), 4, 86.0) * 0.5 + 0.5;
  float stri = vnoise(uv * vec2(140.0, 10.0), vec2(140.0, 10.0), 87.0);
  float breakup = 0.75 + 0.25 * vnoise(uv * vec2(5.0, 30.0), vec2(5.0, 30.0), 85.0);
  float h = plateau * breakup * (1.0 - furrow * 0.85) + rough * 0.18 + stri * 0.07;
  return sat(h);
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float furrow, plateau, id; bark(uv, furrow, plateau, id);
  float low = vfbm(uv * 2.0, vec2(2.0), 3, 88.0);
  float speck = vnoise(uv * 260.0, vec2(260.0), 89.0);
  float mid = vfbm(uv * 9.0, vec2(9.0), 3, 90.0);
  vec3 dark = vec3(0.06, 0.05, 0.04);
  vec3 ridge = mix(vec3(0.3, 0.26, 0.22), vec3(0.5, 0.47, 0.43), low);
  ridge = mix(ridge, vec3(0.38, 0.3, 0.22), mid * 0.5);
  ridge *= 0.8 + 0.3 * hash11(id * 7.7);
  vec3 c = mix(dark, ridge, smoothstep(0.1, 0.55, h));
  c *= 0.85 + 0.3 * speck;
  float moss = smoothstep(0.62, 0.74, vfbm(uv * 3.0, vec2(3.0), 4, 91.0)) * smoothstep(0.5, 0.2, h);
  c = mix(c, vec3(0.16, 0.26, 0.07) * (0.7 + 0.5 * speck), moss * 0.6);
  col = c; rough = 0.93; alpha = 1.0;
}`,
};

const barkBirch = {
  name: 'barkBirch', size: 1024, normalStrength: 1.0, glsl: COMMON + /* glsl */`
float lenticels(vec2 uv){
  vec2 f = vec2(9.0, 44.0);
  vec2 p = uv * f; vec2 i = floor(p), fr = fract(p);
  float m = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec4 r = hash42(pmod(i + o, f) + 91.0);
    if (r.w < 0.5) continue;
    vec2 d = fr - (o + vec2(r.x, 0.3 + 0.4 * r.y));
    float len = 0.15 + 0.5 * r.z;
    float thick = 0.06 + 0.06 * hash11(r.z * 9.0);
    float taper = 1.0 - pow(sat(abs(d.x) / len), 4.0);
    float v = sat((len - abs(d.x)) / 0.08) * sat((thick * taper - abs(d.y)) / 0.05);
    v *= 0.6 + 0.4 * vnoise(uv * vec2(200.0, 40.0), vec2(200.0, 40.0), 92.0 + r.w);
    m = max(m, v);
  }
  return m;
}
float scars(vec2 uv, out float tex){
  vec2 f = vec2(2.0, 3.0);
  vec2 p = uv * f; vec2 i = floor(p), fr = fract(p);
  float m = 0.0; tex = 0.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec4 r = hash42(pmod(i + o, f) + 93.0);
    if (r.w < 0.55) continue;
    vec2 d = fr - (o + vec2(0.2 + 0.6 * r.x, 0.2 + 0.6 * r.y));
    float sz = 0.12 + 0.18 * r.z;
    float edge = fbm(uv * 25.0, vec2(25.0), 3, 94.0 + r.w * 3.0) * 0.08;
    float shape = (abs(d.x) * 1.3 + abs(d.y) * 0.7) + edge;
    m = max(m, smoothstep(sz, sz * 0.75, shape));
    tex = max(tex, smoothstep(sz * 1.3, sz * 0.9, shape));
  }
  return m;
}
float H(vec2 uv){
  float len = lenticels(uv);
  float st; float sc = scars(uv, st);
  float stri = vnoise(uv * vec2(3.0, 120.0), vec2(3.0, 120.0), 95.0);
  float peel = smoothstep(0.5, 0.6, vfbm(uv * vec2(2.0, 7.0), vec2(2.0, 7.0), 3, 96.0));
  float rough = vfbm(uv * 40.0, vec2(40.0), 3, 97.0);
  return sat(0.55 + stri * 0.1 - len * 0.1 - sc * 0.22 + peel * 0.07 + sc * rough * 0.12);
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float len = lenticels(uv);
  float st; float sc = scars(uv, st);
  float stri = vnoise(uv * vec2(3.0, 120.0), vec2(3.0, 120.0), 95.0);
  float band = vfbm(uv * vec2(2.0, 7.0), vec2(2.0, 7.0), 3, 96.0);
  float fine = vnoise(uv * 160.0, vec2(160.0), 98.0);
  vec3 white = mix(vec3(0.78, 0.76, 0.7), vec3(0.94, 0.93, 0.9), stri);
  vec3 pink = vec3(0.68, 0.58, 0.5);
  vec3 c = mix(white, pink, smoothstep(0.5, 0.62, band) * 0.55);
  c = mix(c, vec3(0.55, 0.52, 0.48), smoothstep(0.6, 0.75, vfbm(uv * vec2(4.0, 3.0), vec2(4.0, 3.0), 3, 99.0)) * 0.5);
  c *= 0.9 + 0.2 * fine;
  vec3 dark = vec3(0.09, 0.075, 0.07);
  c = mix(c, dark, len * 0.9);
  vec3 scarCol = mix(vec3(0.06, 0.05, 0.045), vec3(0.2, 0.17, 0.15), vfbm(uv * 40.0, vec2(40.0), 3, 97.0));
  c = mix(c, mix(c, dark * 1.6, 0.5), st * 0.5);
  c = mix(c, scarCol, sc);
  col = c; rough = mix(0.5, 0.92, max(len, sc)); alpha = 1.0;
}`,
};

const barkPine = {
  name: 'barkPine', size: 1024, normalStrength: 2.0, glsl: COMMON + /* glsl */`
vec2 warp(vec2 uv){
  return uv + vec2(fbm(uv * 4.0, vec2(4.0), 3, 101.0), fbm(uv * 4.0, vec2(4.0), 3, 102.0)) * 0.025;
}
void plates(vec2 uv, out float crack, out float id, out float plateH){
  vec2 w = warp(uv);
  vec2 fb = vec2(7.0, 12.0), fs = vec2(16.0, 28.0);
  float eb = worleyEdge(w * fb, fb, 103.0, 0.9);
  float es = worleyEdge(w * fs + 0.3, fs, 104.0, 0.9);
  vec4 cb = worley(w * fb, fb, 103.0, 0.9);
  vec4 cs = worley(w * fs + 0.3, fs, 104.0, 0.9);
  crack = smoothstep(0.05, 0.008, eb) + smoothstep(0.025, 0.003, es) * 0.55;
  crack = sat(crack);
  id = cb.z + cs.z * 0.37;
  plateH = 0.45 + 0.3 * hash11(cb.z * 7.0) + 0.2 * hash11(cs.z * 5.0);
}
float H(vec2 uv){
  float crack, id, ph; plates(uv, crack, id, ph);
  float flakes = vfbm(uv * 30.0, vec2(30.0), 3, 105.0);
  float layered = fract(flakes * 2.5 + hash11(id * 3.0)) * 0.12;
  float fine = vnoise(uv * 200.0, vec2(200.0), 106.0) * 0.05;
  return sat((ph + layered) * (1.0 - crack * 0.8) + fine);
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  float crack, id, ph; plates(uv, crack, id, ph);
  float r = hash11(id * 7.0);
  float low = vfbm(uv * 3.0, vec2(3.0), 3, 107.0);
  vec3 plate = mix(vec3(0.42, 0.23, 0.12), vec3(0.6, 0.37, 0.22), r);
  plate = mix(plate, vec3(0.33, 0.19, 0.12), hash11(id * 2.3) * 0.5);
  plate = mix(plate, vec3(0.5, 0.44, 0.38), smoothstep(0.5, 0.7, low) * 0.6);
  plate *= 0.75 + 0.5 * vfbm(uv * 30.0, vec2(30.0), 3, 105.0);
  plate *= 0.9 + 0.2 * vnoise(uv * 200.0, vec2(200.0), 106.0);
  vec3 c = mix(plate, vec3(0.07, 0.045, 0.03), crack);
  col = c; rough = mix(0.82, 0.95, crack); alpha = 1.0;
}`,
};

// ---------------------------------------------------------------- Карточки листвы (cutout)
// Ветка с листьями: черешок снизу, листья по спирали.
const twigCommon = /* glsl */`
struct Card { float h; vec3 col; float alpha; float rough; };

float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = sat(dot(pa, ba) / dot(ba, ba)); return length(pa - ba * t); }

void placeLeaf(vec2 uv, vec2 pos, float ang, float len, float wid, float kind, vec3 base, float shade, float px, inout Card C){
  vec2 d = rot(ang) * (uv - pos);
  float t01, across;
  float m = leafMask(d, len, wid, kind, px, t01, across);
  if (m <= 0.0) return;
  float vein = 1.0 - 0.3 * smoothstep(0.012 * len / 0.2, 0.0, abs(d.y)) * smoothstep(0.0, 0.08, t01);
  float side = 1.0 - 0.14 * smoothstep(0.015, 0.0, abs(fract(t01 * 6.0 + across * 0.8) - 0.5) - 0.44) * step(0.05, across);
  float h = 0.5 + shade * 0.3 + across * across * 0.15 - vein * 0.05;
  if (m > C.alpha * 0.5 || h > C.h){
    C.col = base * shade * vein * side * (0.85 + 0.25 * (1.0 - across * 0.6)) * (0.92 + 0.16 * t01);
    C.h = max(C.h, h);
    C.rough = 0.62;
  }
  C.alpha = max(C.alpha, m);
}
`;

const twigOak = {
  name: 'twigOak', size: 1024, cutout: true, repeat: false, normalStrength: 1.0, glsl: COMMON + twigCommon + /* glsl */`
Card build(vec2 uv){
  Card C; C.h = 0.0; C.col = vec3(0.6, 0.55, 0.4); C.alpha = 0.0; C.rough = 0.7;
  float px = 1.2 / uSize;
  float stem = 0.0;
  vec2 prev = vec2(0.5, 0.02);
  for (int k = 1; k <= 8; k++){
    float t = float(k) / 8.0;
    vec2 pt = vec2(0.5 + 0.08 * sin(t * 3.0), 0.02 + t * 0.9);
    stem = max(stem, sat((0.011 * (1.0 - t * 0.6) - segDist(uv, prev, pt)) / px));
    prev = pt;
  }
  for (int k = 0; k < 6; k++){
    float t = 0.12 + float(k) * 0.15;
    vec2 a = vec2(0.5 + 0.08 * sin(t * 3.0), 0.02 + t * 0.9);
    float side = (mod(float(k), 2.0) == 0.0) ? 1.0 : -1.0;
    vec2 b = a + vec2(side * (0.28 + 0.1 * hash11(float(k) * 2.0)), 0.1 + 0.08 * hash11(float(k)));
    stem = max(stem, sat((0.006 - segDist(uv, a, b)) / px));
  }
  if (stem > 0.0){ C.col = vec3(0.3, 0.22, 0.14); C.h = 0.4; C.rough = 0.9; C.alpha = max(C.alpha, stem); }
  for (int k = 0; k < 26; k++){
    float fk = float(k);
    vec4 r = hash42(vec2(fk * 3.1, 7.7));
    float t = 0.06 + fract(fk * 0.618) * 0.9;
    vec2 a = vec2(0.5 + 0.08 * sin(t * 3.0), 0.02 + t * 0.9);
    float side = (mod(fk, 2.0) == 0.0) ? 1.0 : -1.0;
    vec2 pos = a + vec2(side * (0.02 + 0.3 * r.x), -0.02 + 0.14 * r.y);
    float ang = -side * (0.3 + 0.9 * r.z) + (r.w - 0.5) * 0.9 + PI * 0.5;
    float len = 0.26 + 0.12 * r.w;
    vec3 base = vec3(0.86, 0.8, 0.62) * (0.8 + 0.4 * hash11(fk * 1.7));
    placeLeaf(uv, pos, ang, len, len * 0.4, 1.0, base, 0.8 + 0.4 * r.y, px, C);
  }
  return C;
}
float H(vec2 uv){ return build(uv).h; }
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Card C = build(uv); col = C.col; rough = C.rough; alpha = C.alpha;
}`,
};

const twigBirch = {
  name: 'twigBirch', size: 1024, cutout: true, repeat: false, normalStrength: 1.0, glsl: COMMON + twigCommon + /* glsl */`
Card build(vec2 uv){
  Card C; C.h = 0.0; C.col = vec3(0.7, 0.68, 0.45); C.alpha = 0.0; C.rough = 0.7;
  float px = 1.2 / uSize;
  float stem = 0.0;
  vec2 prev = vec2(0.5, 0.02);
  for (int k = 1; k <= 8; k++){
    float t = float(k) / 8.0;
    vec2 pt = vec2(0.5 + 0.1 * sin(t * 2.5 + 1.0), 0.02 + t * 0.92);
    stem = max(stem, sat((0.007 * (1.0 - t * 0.6) - segDist(uv, prev, pt)) / px));
    prev = pt;
  }
  for (int k = 0; k < 8; k++){
    float t = 0.08 + float(k) * 0.12;
    vec2 a = vec2(0.5 + 0.1 * sin(t * 2.5 + 1.0), 0.02 + t * 0.92);
    float side = (mod(float(k), 2.0) == 0.0) ? 1.0 : -1.0;
    vec2 b = a + vec2(side * (0.3 + 0.1 * hash11(float(k) * 5.0)), 0.06 + 0.1 * hash11(float(k) + 3.0));
    stem = max(stem, sat((0.004 - segDist(uv, a, b)) / px));
  }
  if (stem > 0.0){ C.col = vec3(0.25, 0.17, 0.12); C.h = 0.4; C.rough = 0.9; C.alpha = max(C.alpha, stem); }
  for (int k = 0; k < 40; k++){
    float fk = float(k);
    vec4 r = hash42(vec2(fk * 2.3, 5.1));
    float t = 0.05 + fract(fk * 0.618 + 0.3) * 0.92;
    vec2 a = vec2(0.5 + 0.1 * sin(t * 2.5 + 1.0), 0.02 + t * 0.92);
    float side = (mod(fk, 2.0) == 0.0) ? 1.0 : -1.0;
    vec2 pos = a + vec2(side * (0.02 + 0.34 * r.x), -0.02 + 0.12 * r.y);
    float ang = -side * (0.3 + 1.0 * r.z) + (r.w - 0.5) * 1.0 + PI * 0.5;
    float len = 0.15 + 0.08 * r.w;
    vec3 base = vec3(0.86, 0.82, 0.6) * (0.8 + 0.4 * hash11(fk * 1.3));
    placeLeaf(uv, pos, ang, len, len * 0.45, 0.0, base, 0.8 + 0.4 * r.y, px, C);
  }
  return C;
}
float H(vec2 uv){ return build(uv).h; }
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Card C = build(uv); col = C.col; rough = C.rough; alpha = C.alpha;
}`,
};

const branchPine = {
  name: 'branchPine', size: 1024, cutout: true, repeat: false, normalStrength: 0.8, glsl: COMMON + twigCommon + /* glsl */`
void needleBundle(vec2 uv, vec2 a, float baseAng, float seed, int count, float len, float spread, float px, inout Card C){
  for (int k = 0; k < 60; k++){
    if (k >= count) break;
    float fk = float(k);
    vec4 r = hash42(vec2(fk * 1.7 + seed, 2.9 + seed));
    float ang = baseAng + (r.x - 0.5) * spread;
    float L = len * (0.7 + 0.5 * r.y);
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 b = a + dir * L;
    float d = segDist(uv, a, b);
    float tt = sat(dot(uv - a, dir) / L);
    float w = 0.0055 * (1.0 - tt * 0.6);
    float m = sat((w - d) / px);
    if (m > 0.0){
      float h = 0.45 + 0.3 * r.z + 0.25 * tt;
      if (h > C.h || C.alpha < 0.5){
        vec3 g = mix(vec3(0.09, 0.24, 0.09), vec3(0.3, 0.48, 0.2), r.w);
        C.col = g * (0.7 + 0.5 * tt) * (0.85 + 0.3 * hash11(fk + seed));
        C.h = max(C.h, h);
      }
      C.alpha = max(C.alpha, m);
    }
  }
}
Card build(vec2 uv){
  Card C; C.h = 0.0; C.col = vec3(0.12, 0.3, 0.12); C.alpha = 0.0; C.rough = 0.7;
  float px = 1.3 / uSize;
  // три веточки веером
  for (int b = 0; b < 3; b++){
    float fb = float(b);
    float ang = PI * 0.5 + (fb - 1.0) * 0.55;
    vec2 root = vec2(0.5, 0.04);
    vec2 dir = vec2(cos(ang), sin(ang));
    float L = 0.55 + 0.12 * hash11(fb);
    vec2 tip = root + dir * L;
    float stem = sat((0.012 * (1.0 - 0.5 * sat(dot(uv - root, dir) / L)) - segDist(uv, root, tip)) / px);
    if (stem > 0.0 && C.alpha < 0.9){ C.col = vec3(0.32, 0.2, 0.1); C.h = max(C.h, 0.45); C.alpha = max(C.alpha, stem); }
    // пучки вдоль веточки
    for (int k = 0; k < 9; k++){
      float t = 0.2 + float(k) * 0.1;
      vec2 a = root + dir * (L * t);
      needleBundle(uv, a, ang, fb * 10.0 + float(k) * 3.0, 14, 0.2 + 0.05 * float(k) / 9.0, 2.4 + 0.4 * (1.0 - t), px, C);
    }
  }
  return C;
}
float H(vec2 uv){ return build(uv).h; }
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Card C = build(uv); col = C.col; rough = 0.75; alpha = C.alpha;
}`,
};

const branchSpruce = {
  name: 'branchSpruce', size: 1024, cutout: true, repeat: false, normalStrength: 0.8, glsl: COMMON + twigCommon + /* glsl */`
// гребёнка хвоинок вдоль веточки a→b
void comb(vec2 uv, vec2 a, vec2 b, float nlen, float spacing, float lean, float seed, float px, inout Card C){
  vec2 ab = b - a; float L = length(ab); vec2 dir = ab / L; vec2 nrm = vec2(-dir.y, dir.x);
  vec2 rel = uv - a;
  float along = dot(rel, dir), perp = dot(rel, nrm);
  if (along < -0.02 || along > L + 0.02 || abs(perp) > nlen * 1.2) return;
  float kc = floor(along / spacing + 0.5);
  for (int j = -1; j <= 1; j++){
    float k = kc + float(j);
    if (k < 1.0 || k * spacing > L) continue;
    for (int sgn = -1; sgn <= 1; sgn += 2){
      float sg = float(sgn);
      float rr = hash11(k * 3.7 + seed + sg * 11.0);
      vec2 base = a + dir * (k * spacing);
      float taper = 1.0 - 0.55 * sat(k * spacing / L);
      float nl = nlen * taper * (0.75 + 0.35 * rr);
      vec2 ndir = normalize(nrm * sg + dir * lean * (0.8 + 0.4 * rr));
      vec2 tip = base + ndir * nl;
      float d = segDist(uv, base, tip);
      float tt = sat(dot(uv - base, ndir) / nl);
      float m = sat((0.0036 * (1.0 - 0.5 * tt) - d) / px);
      if (m > 0.0){
        vec3 g = mix(vec3(0.06, 0.17, 0.1), vec3(0.2, 0.4, 0.22), rr);
        float h = 0.5 + 0.3 * rr + 0.2 * tt;
        if (h > C.h || C.alpha < 0.5){ C.col = g * (0.75 + 0.45 * tt); C.h = max(C.h, h); }
        C.alpha = max(C.alpha, m);
      }
    }
  }
}
Card build(vec2 uv){
  Card C; C.h = 0.0; C.col = vec3(0.1, 0.22, 0.12); C.alpha = 0.0; C.rough = 0.7;
  float px = 1.3 / uSize;
  vec2 root = vec2(0.5, 0.03), tip = vec2(0.5, 0.97);
  float stem = sat((0.008 * (1.0 - uv.y * 0.6) - segDist(uv, root, tip)) / px);
  if (stem > 0.0){ C.col = vec3(0.3, 0.2, 0.12); C.h = 0.45; C.rough = 0.9; C.alpha = stem; }
  comb(uv, root, tip, 0.05, 0.006, 0.6, 99.0, px, C);
  for (int k = 0; k < 22; k++){
    float fk = float(k);
    float side = (mod(fk, 2.0) == 0.0) ? 1.0 : -1.0;
    float t = 0.05 + floor(fk / 2.0) * 0.082 + hash11(fk) * 0.02;
    vec2 a = vec2(0.5, 0.03 + t * 0.94);
    float ang = PI * 0.5 - side * (1.05 - 0.3 * t);
    float len = (0.36 + 0.1 * hash11(fk * 3.0)) * (1.0 - t * 0.8) + 0.05;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 b = a + dir * len;
    float m = sat((0.0035 * (1.0 - 0.4 * sat(dot(uv - a, dir) / len)) - segDist(uv, a, b)) / px);
    if (m > 0.0 && C.alpha < 0.9){ C.col = vec3(0.3, 0.2, 0.12); C.h = max(C.h, 0.48); C.alpha = max(C.alpha, m); }
    comb(uv, a, b, 0.045, 0.0052, 0.55, fk * 7.0, px, C);
  }
  return C;
}
float H(vec2 uv){ return build(uv).h; }
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  Card C = build(uv); col = C.col; rough = 0.75; alpha = C.alpha;
}`,
};

// ---------------------------------------------------------------- Прочее
const waterNormal = {
  name: 'waterNormal', size: 512, normalStrength: 0.35, glsl: COMMON + /* glsl */`
float H(vec2 uv){
  float a = fbm(uv * 4.0, vec2(4.0), 5, 111.0);
  float b = fbm(uv * 9.0 + 3.0, vec2(9.0), 3, 112.0);
  return 0.5 + a * 0.4 + b * 0.15;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){ col = vec3(h); rough = 0.05; alpha = 1.0; }`,
};

const mushroom = {
  name: 'mushroom', size: 256, normalStrength: 1.0, repeat: false, glsl: COMMON + /* glsl */`
float H(vec2 uv){
  vec4 w = worley(uv * vec2(9.0, 5.0), vec2(9.0, 5.0), 121.0, 0.9);
  float wart = step(0.45, hash11(w.z * 3.0)) * smoothstep(0.22, 0.12, w.x);
  return 0.5 + wart * 0.35 * step(0.5, uv.y);
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  vec4 w = worley(uv * vec2(9.0, 5.0), vec2(9.0, 5.0), 121.0, 0.9);
  float wart = step(0.45, hash11(w.z * 3.0)) * smoothstep(0.22, 0.12, w.x);
  vec3 cap = mix(vec3(0.7, 0.08, 0.03), vec3(0.95, 0.25, 0.06), vfbm(uv * 6.0, vec2(6.0), 3, 122.0));
  cap = mix(cap, vec3(0.95, 0.92, 0.82), wart);
  vec3 stalk = mix(vec3(0.85, 0.8, 0.68), vec3(0.95, 0.92, 0.85), vnoise(uv * vec2(20.0, 4.0), vec2(20.0, 4.0), 123.0));
  col = uv.y > 0.5 ? cap : stalk;
  rough = uv.y > 0.5 ? mix(0.35, 0.8, wart) : 0.85; alpha = 1.0;
}`,
};

const acorn = {
  name: 'acorn', size: 256, normalStrength: 1.5, repeat: true, glsl: COMMON + /* glsl */`
float H(vec2 uv){
  // верхняя половина текстуры — шляпка с чешуйками, нижняя — орех
  if (uv.y > 0.5){
    vec2 p = vec2(uv.x * 14.0, (uv.y - 0.5) * 2.0 * 7.0);
    p.x += floor(p.y) * 0.5;
    vec2 f = fract(p) - 0.5;
    float scale = smoothstep(0.5, 0.2, length(f * vec2(1.0, 1.6)));
    return 0.5 + scale * 0.4;
  }
  return 0.5 + vnoise(uv * vec2(40.0, 6.0), vec2(40.0, 6.0), 131.0) * 0.08;
}
void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha){
  if (uv.y > 0.5){
    col = mix(vec3(0.32, 0.2, 0.09), vec3(0.55, 0.38, 0.18), (h - 0.5) * 2.5);
    rough = 0.8;
  } else {
    float s = vnoise(uv * vec2(40.0, 6.0), vec2(40.0, 6.0), 131.0);
    col = mix(vec3(0.42, 0.24, 0.08), vec3(0.72, 0.5, 0.2), s) * (0.8 + 0.4 * uv.y * 2.0);
    rough = 0.35;
  }
  alpha = 1.0;
}`,
};

export const GROUND_DEFS = [grass, leaves, dirt, rock, snow, pebbles, needles];
export const GROUND_INDEX = { grass: 0, leaves: 1, dirt: 2, rock: 3, snow: 4, pebbles: 5, needles: 6 };
export const BARK_DEFS = { barkOak, barkBirch, barkPine };
export const FOLIAGE_DEFS = { twigOak, twigBirch, branchPine, branchSpruce };
export const MISC_DEFS = { waterNormal, mushroom, acorn };
