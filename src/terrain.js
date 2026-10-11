import * as THREE from 'three';
import { WORLD } from './world.js';

// GLSL: выборка высоты террейна из float-текстуры с той же триангуляцией, что и у сетки
export const HEIGHT_GLSL = /* glsl */`
uniform highp sampler2D uHeightTex;
uniform vec2 uWorldMin;
uniform vec2 uWorldCell;
uniform vec2 uWorldN;
float terrainHeight(vec2 p){
  vec2 f = (p - uWorldMin) / uWorldCell;
  f = clamp(f, vec2(0.0), uWorldN - 1.001);
  vec2 i = floor(f); vec2 t = f - i;
  ivec2 ii = ivec2(i);
  float a = texelFetch(uHeightTex, ii, 0).r;
  float b = texelFetch(uHeightTex, ii + ivec2(1, 0), 0).r;
  float c = texelFetch(uHeightTex, ii + ivec2(0, 1), 0).r;
  float d = texelFetch(uHeightTex, ii + ivec2(1, 1), 0).r;
  if (t.x + t.y <= 1.0) return a + (b - a) * t.x + (c - a) * t.y;
  return d + (c - d) * (1.0 - t.x) + (b - d) * (1.0 - t.y);
}
`;

export function makeHeightUniforms(world) {
  const tex = new THREE.DataTexture(world.heights, WORLD.nx, WORLD.nz, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return {
    uHeightTex: { value: tex },
    uWorldMin: { value: new THREE.Vector2(WORLD.minX, WORLD.minZ) },
    uWorldCell: { value: new THREE.Vector2(WORLD.cell, WORLD.cell) },
    uWorldN: { value: new THREE.Vector2(WORLD.nx, WORLD.nz) },
  };
}

function makeSplatTexture(data) {
  const tex = new THREE.DataTexture(data, WORLD.nx, WORLD.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const TERRAIN_PARS_VERT = /* glsl */`
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
`;
const TERRAIN_VERT = /* glsl */`
vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
vWorldNormal = normalize(mat3(modelMatrix) * normal);
`;

const TERRAIN_PARS_FRAG = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAlbedoArr;
uniform sampler2DArray uNormalArr;
uniform sampler2D uSplat1;
uniform sampler2D uSplat2;
uniform vec2 uSplatMin;
uniform vec2 uSplatSize;
uniform float uTileScale;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
float thash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float tnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(thash(i), thash(i + vec2(1, 0)), u.x), mix(thash(i + vec2(0, 1)), thash(i + vec2(1, 1)), u.x), u.y); }
`;

// Смешивание 7 слоёв по весам с учётом карты высот слоёв
const TERRAIN_FRAG = /* glsl */`
vec3 terrainAlbedo; float terrainRough; vec3 terrainNormalTS;
{
  vec2 wuv = (vWorldPos.xz - uSplatMin) / uSplatSize;
  vec4 s1 = texture2D(uSplat1, wuv);
  vec4 s2 = texture2D(uSplat2, wuv);
  vec3 gN = normalize(vWorldNormal);
  float slope = 1.0 - gN.y;
  float tint = s2.b;
  float rockW = smoothstep(0.16, 0.36, slope + (tint - 0.5) * 0.14);
  float w[7];
  w[0] = s1.r; w[1] = s1.g; w[2] = s1.b; w[4] = s1.a; w[5] = s2.r; w[6] = s2.g;
  float keep = 1.0 - rockW;
  w[0] *= keep; w[1] *= keep; w[2] *= keep; w[5] *= keep; w[6] *= keep;
  w[4] *= 1.0 - smoothstep(0.3, 0.55, slope);
  float sum = w[0] + w[1] + w[2] + w[4] + w[5] + w[6];
  w[3] = max(0.0, 1.0 - sum);
  float dist = length(vWorldPos - cameraPosition);
  vec2 uv = vWorldPos.xz * uTileScale;
  vec2 uvFar = vWorldPos.xz * uTileScale * 0.17 + vec2(0.37, 0.11);
  vec2 uvDet = vWorldPos.xz * uTileScale * 4.7 + vec2(0.5);
  float farMix = smoothstep(18.0, 80.0, dist);
  float detMix = 1.0 - smoothstep(2.0, 9.0, dist);
  // стохастическое разбиение повторов: вторая выборка повёрнута/сдвинута, смешивание по мягкой маске шума
  float stoch = tnoise(vWorldPos.xz * 0.19 + vec2(3.1, 7.7));
  float sm = smoothstep(0.38, 0.62, stoch);
  mat2 R = mat2(0.5, -0.866, 0.866, 0.5);
  mat2 Ri = mat2(0.5, 0.866, -0.866, 0.5);
  vec2 uvB = R * uv + vec2(0.37, 0.71);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 dxB = dFdx(uvB), dyB = dFdy(uvB);
  vec2 dxF = dFdx(uvFar), dyF = dFdy(uvFar);
  vec2 dxD = dFdx(uvDet), dyD = dFdy(uvDet);
  vec4 nrm[7]; float b[7]; float maxB = 0.0;
  for (int i = 0; i < 7; i++){
    b[i] = 0.0;
    if (w[i] > 0.004){
      vec4 nA = textureGrad(uNormalArr, vec3(uv, float(i)), dx, dy);
      vec4 nB = textureGrad(uNormalArr, vec3(uvB, float(i)), dxB, dyB);
      nB.xy = Ri * (nB.xy * 2.0 - 1.0) * 0.5 + 0.5;
      nrm[i] = mix(nA, nB, sm);
      b[i] = w[i] * (0.45 + nrm[i].a);
      maxB = max(maxB, b[i]);
    }
  }
  float m = maxB - 0.22;
  float fsum = 0.0; float f[7];
  for (int i = 0; i < 7; i++){ f[i] = max(b[i] - m, 0.0); fsum += f[i]; }
  vec3 col = vec3(0.0); float rough = 0.0; vec3 nts = vec3(0.0);
  for (int i = 0; i < 7; i++){
    if (f[i] <= 0.0) continue;
    float k = f[i] / fsum;
    vec4 alb = mix(textureGrad(uAlbedoArr, vec3(uv, float(i)), dx, dy), textureGrad(uAlbedoArr, vec3(uvB, float(i)), dxB, dyB), sm);
    if (farMix > 0.001){
      vec4 albF = textureGrad(uAlbedoArr, vec3(uvFar, float(i)), dxF, dyF);
      alb.rgb = mix(alb.rgb, albF.rgb, farMix * 0.8);
    }
    vec3 n = nrm[i].xyz * 2.0 - 1.0;
    if (detMix > 0.001){
      vec3 nd = textureGrad(uNormalArr, vec3(uvDet, float(i)), dxD, dyD).xyz * 2.0 - 1.0;
      n = normalize(vec3(n.xy + nd.xy * 0.35 * detMix, n.z));
    }
    col += alb.rgb * k; rough += alb.a * k; nts += n * k;
  }
  col *= mix(0.86, 1.14, tint);
  terrainAlbedo = col; terrainRough = rough;
  nts.xy *= mix(1.0, 0.12, farMix);
  terrainNormalTS = normalize(nts);
}
diffuseColor.rgb = terrainAlbedo;
`;

const TERRAIN_NORMAL_FRAG = /* glsl */`
{
  vec3 gN = normalize(vWorldNormal);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - gN * gN.x);
  vec3 B = cross(T, gN);
  vec3 wN = normalize(T * terrainNormalTS.x + B * terrainNormalTS.y + gN * terrainNormalTS.z);
  normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
}
`;

export function createTerrainMaterial(world, albedoArr, normalArr) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    uAlbedoArr: { value: albedoArr },
    uNormalArr: { value: normalArr },
    uSplat1: { value: makeSplatTexture(world.splat1) },
    uSplat2: { value: makeSplatTexture(world.splat2) },
    uSplatMin: { value: new THREE.Vector2(WORLD.minX, WORLD.minZ) },
    uSplatSize: { value: new THREE.Vector2(WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ) },
    uTileScale: { value: 1 / 1.8 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_PARS_VERT)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + TERRAIN_VERT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_PARS_FRAG)
      .replace('#include <map_fragment>', TERRAIN_FRAG)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = terrainRough;')
      .replace('#include <normal_fragment_maps>', TERRAIN_NORMAL_FRAG);
  };
  mat.customProgramCacheKey = () => 'terrain';
  mat.userData.uniforms = uniforms;
  return mat;
}

// Чанки террейна из карты высот
export function buildTerrain(world, material) {
  const group = new THREE.Group();
  const { nx, nz, minX, minZ, cell } = WORLD;
  const CH = 50; // клеток в чанке
  const h = world.heights;
  const hAt = (i, j) => h[Math.min(nz - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let cj = 0; cj < nz - 1; cj += CH) {
    for (let ci = 0; ci < nx - 1; ci += CH) {
      const w = Math.min(CH, nx - 1 - ci), d = Math.min(CH, nz - 1 - cj);
      const vw = w + 1, vd = d + 1;
      const pos = new Float32Array(vw * vd * 3), nor = new Float32Array(vw * vd * 3);
      for (let j = 0; j < vd; j++) {
        for (let i = 0; i < vw; i++) {
          const gi = ci + i, gj = cj + j;
          const o = (j * vw + i) * 3;
          pos[o] = minX + gi * cell; pos[o + 1] = hAt(gi, gj); pos[o + 2] = minZ + gj * cell;
          const dx = (hAt(gi + 1, gj) - hAt(gi - 1, gj)) / (2 * cell);
          const dz = (hAt(gi, gj + 1) - hAt(gi, gj - 1)) / (2 * cell);
          const len = Math.hypot(dx, 1, dz);
          nor[o] = -dx / len; nor[o + 1] = 1 / len; nor[o + 2] = -dz / len;
        }
      }
      const idx = new Uint32Array(w * d * 6);
      let k = 0;
      for (let j = 0; j < d; j++) {
        for (let i = 0; i < w; i++) {
          const a = j * vw + i, b = a + 1, c = a + vw, dd = c + 1;
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = dd;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }
  return group;
}
