// Библиотека периодических (бесшовных) шумов для GPU-запекания текстур.
// Все функции принимают период `per` в клетках: координата p ∈ [0, per) укладывается ровно один раз.
export const NOISE_GLSL = /* glsl */`
#define PI 3.14159265359
#define TAU 6.28318530718

float sat(float x){ return clamp(x, 0.0, 1.0); }
vec3 sat3(vec3 x){ return clamp(x, 0.0, 1.0); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec4 hash42(vec2 p){ vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }

vec2 pmod(vec2 i, vec2 per){ return mod(mod(i, per) + per, per); }

// Value noise (квинтическая интерполяция), 0..1
float vnoise(vec2 p, vec2 per, float seed){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(pmod(i, per) + seed);
  float b = hash12(pmod(i + vec2(1, 0), per) + seed);
  float c = hash12(pmod(i + vec2(0, 1), per) + seed);
  float d = hash12(pmod(i + vec2(1, 1), per) + seed);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Градиентный (перлиновский) шум, приблизительно -1..1
float gnoise(vec2 p, vec2 per, float seed){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = hash22(pmod(i, per) + seed) * 2.0 - 1.0;
  vec2 g10 = hash22(pmod(i + vec2(1, 0), per) + seed) * 2.0 - 1.0;
  vec2 g01 = hash22(pmod(i + vec2(0, 1), per) + seed) * 2.0 - 1.0;
  vec2 g11 = hash22(pmod(i + vec2(1, 1), per) + seed) * 2.0 - 1.0;
  float n00 = dot(g00, f);
  float n10 = dot(g10, f - vec2(1, 0));
  float n01 = dot(g01, f - vec2(0, 1));
  float n11 = dot(g11, f - vec2(1, 1));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 1.6;
}

// fBm на градиентном шуме, ≈ -1..1
float fbm(vec2 p, vec2 per, int oct, float seed){
  float a = 0.5, s = 0.0, norm = 0.0;
  for (int k = 0; k < 8; k++){
    if (k >= oct) break;
    s += a * gnoise(p, per, seed + float(k) * 19.37);
    norm += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / norm;
}

// fBm на value-шуме, 0..1
float vfbm(vec2 p, vec2 per, int oct, float seed){
  float a = 0.5, s = 0.0, norm = 0.0;
  for (int k = 0; k < 8; k++){
    if (k >= oct) break;
    s += a * vnoise(p, per, seed + float(k) * 7.91);
    norm += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / norm;
}

// Гребенчатый шум (ridged), 0..1
float ridged(vec2 p, vec2 per, int oct, float seed){
  float a = 0.5, s = 0.0, norm = 0.0, w = 1.0;
  for (int k = 0; k < 8; k++){
    if (k >= oct) break;
    float n = 1.0 - abs(gnoise(p, per, seed + float(k) * 11.13));
    n = n * n * w;
    w = sat(n * 1.5);
    s += a * n; norm += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / norm;
}

// Worley: x = F1, y = F2, z = id ближайшей клетки (0..1), w = сглаженный F1
vec4 worley(vec2 p, vec2 per, float seed, float jitter){
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0, f2 = 9.0, id = 0.0;
  vec2 nearest = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 c = pmod(i + o, per) + seed;
    vec2 r = o + (0.5 + (hash22(c) - 0.5) * jitter) - f;
    float d = dot(r, r);
    if (d < f1){ f2 = f1; f1 = d; id = hash12(c + 3.3); nearest = r; }
    else if (d < f2){ f2 = d; }
  }
  return vec4(sqrt(f1), sqrt(f2), id, sqrt(f1));
}

// Расстояние до границы ячейки Worley (для трещин и плиток)
float worleyEdge(vec2 p, vec2 per, float seed, float jitter){
  vec2 i = floor(p), f = fract(p);
  float f1 = 9.0; vec2 mr = vec2(0.0), mc = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 c = pmod(i + o, per) + seed;
    vec2 r = o + (0.5 + (hash22(c) - 0.5) * jitter) - f;
    float d = dot(r, r);
    if (d < f1){ f1 = d; mr = r; mc = o; }
  }
  float md = 9.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++){
    vec2 o = mc + vec2(float(x), float(y));
    vec2 c = pmod(i + o, per) + seed;
    vec2 r = o + (0.5 + (hash22(c) - 0.5) * jitter) - f;
    if (dot(mr - r, mr - r) > 1e-5){
      md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
    }
  }
  return md;
}

// sRGB OETF
vec3 toSRGB(vec3 c){
  c = sat3(c);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;
