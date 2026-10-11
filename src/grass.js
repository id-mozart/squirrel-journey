import * as THREE from 'three';
import { WORLD } from './world.js';
import { HEIGHT_GLSL } from './terrain.js';

// Геометрия одной травинки: 3 сегмента + остриё
function bladeGeometry() {
  const rows = [0, 0.38, 0.72];
  const pos = [], side = [], t = [], idx = [];
  for (const r of rows) {
    const w = 0.5 * (1 - r * r * 0.6);
    pos.push(-w, r, 0, w, r, 0);
    side.push(-1, 1); t.push(r, r);
  }
  pos.push(0, 1, 0); side.push(0); t.push(1);
  for (let k = 0; k < rows.length - 1; k++) {
    const a = k * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const tip = rows.length * 2;
  idx.push(tip - 2, tip - 1, tip);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 1));
  g.setIndex(idx);
  return g;
}

const GRASS_PARS_VERT = /* glsl */`
attribute float aSide;
attribute float aT;
attribute vec4 aSeed;
uniform float uTime;
uniform vec2 uCenter;
uniform float uSize;
uniform float uFadeIn;
uniform float uWidth;
uniform float uHeight;
uniform sampler2D uSplat2;
uniform vec2 uSplatMin;
uniform vec2 uSplatSize;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorDry;
varying vec3 vGrassCol;
varying float vT;
${HEIGHT_GLSL}
`;

const GRASS_VERT = /* glsl */`
vec3 transformed;
{
  // ближайшая периодическая копия травинки к центру (игроку)
  vec2 p0 = aSeed.xy * uSize;
  vec2 base = p0 + floor((uCenter - p0) / uSize + 0.5) * uSize;
  vec2 suv = (base - uSplatMin) / uSplatSize;
  vec4 s2 = texture2D(uSplat2, suv);
  float density = s2.a;
  float dist = length(base - uCenter);
  float fade = 1.0 - smoothstep(uSize * 0.36, uSize * 0.5, dist);
  fade *= smoothstep(uFadeIn * 0.6, uFadeIn, dist + (aSeed.z - 0.5) * uFadeIn * 0.6);
  float keep = step(aSeed.z, density * 1.05) * fade;
  float h = uHeight * (0.65 + 0.7 * aSeed.w) * (0.6 + 0.4 * density) * keep;
  float w = uWidth * (0.8 + 0.4 * aSeed.z) * (1.0 + smoothstep(8.0, 40.0, dist) * 1.2);
  float yaw = aSeed.z * 6.2831 + aSeed.w * 3.0;
  vec2 facing = vec2(cos(yaw), sin(yaw));
  vec2 tangent = vec2(-facing.y, facing.x);
  // ветер
  float ph = dot(base, vec2(0.11, 0.07)) + uTime * 1.6;
  float gust = sin(ph) * 0.5 + sin(ph * 0.37 + base.x * 0.02) * 0.3 + sin(uTime * 3.1 + aSeed.x * 40.0) * 0.12;
  float bendAmt = 0.35 + 0.25 * aSeed.w + gust * 0.35;
  float t = aT;
  float bend = bendAmt * t * t;
  float ground = terrainHeight(base);
  vec2 xz = base + tangent * (aSide * w * 0.5 * (1.0 - t * t * 0.6)) + facing * bend * h + facing * (gust * 0.15 * h * t);
  float y = ground - 0.01 + h * t * (1.0 - bend * bend * 0.5);
  transformed = vec3(xz.x, y, xz.y);
  // нормаль: округлённая, наклонена по изгибу
  vec3 n = normalize(vec3(facing.x, 0.0, facing.y) * (-0.6) + vec3(0.0, 1.0, 0.0) * 0.8 + vec3(tangent.x, 0.0, tangent.y) * aSide * 0.45);
  objectNormal = n;
  float tint = s2.b;
  vec3 col = mix(uColorA, uColorB, t * t) * (0.8 + 0.4 * aSeed.x);
  col = mix(col, uColorDry, smoothstep(0.55, 0.85, tint) * 0.7 + aSeed.y * 0.15);
  col *= 0.75 + 0.25 * density;
  vGrassCol = col;
  vT = t;
}
`;

const GRASS_FRAG_PARS = /* glsl */`
varying vec3 vGrassCol;
varying float vT;
`;
const GRASS_COLOR = /* glsl */`
diffuseColor.rgb *= vGrassCol * (0.55 + 0.45 * vT);
`;

export class Grass {
  constructor(world, heightUniforms) {
    const splat2 = new THREE.DataTexture(world.splat2, WORLD.nx, WORLD.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    splat2.minFilter = splat2.magFilter = THREE.LinearFilter; splat2.needsUpdate = true;
    this.uniformsShared = {
      ...heightUniforms, uTime: { value: 0 }, uCenter: { value: new THREE.Vector2() },
      uSplat2: { value: splat2 },
      uSplatMin: { value: new THREE.Vector2(WORLD.minX, WORLD.minZ) },
      uSplatSize: { value: new THREE.Vector2(WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ) },
      uColorA: { value: new THREE.Color(0.06, 0.12, 0.025) },
      uColorB: { value: new THREE.Color(0.42, 0.58, 0.16) },
      uColorDry: { value: new THREE.Color(0.55, 0.48, 0.2) },
    };
    this.mesh = new THREE.Group();
    this.layers = [];
    this.addLayer(60000, 30, 0, 0.028, 0.3);
    this.addLayer(50000, 90, 13, 0.05, 0.36);
  }

  addLayer(count, size, fadeIn, width, height) {
    const geo = bladeGeometry();
    const seeds = new Float32Array(count * 4);
    let s = 12345;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < count * 4; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;
    const uniforms = { ...this.uniformsShared, uSize: { value: size }, uFadeIn: { value: fadeIn }, uWidth: { value: width }, uHeight: { value: height } };
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + GRASS_PARS_VERT)
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
        .replace('#include <begin_vertex>', GRASS_VERT + '\nvNormal = normalize(normalMatrix * objectNormal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + GRASS_FRAG_PARS)
        .replace('#include <color_fragment>', GRASS_COLOR)
        .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0; vec3 normal = normalize(vNormal); vec3 nonPerturbedNormal = normal;');
    };
    mat.customProgramCacheKey = () => 'grass' + size;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    this.mesh.add(mesh);
    this.layers.push({ mesh, uniforms });
  }

  update(camera, playerPos, time) {
    this.uniformsShared.uTime.value = time;
    this.uniformsShared.uCenter.value.set(playerPos.x, playerPos.z);
  }
}
