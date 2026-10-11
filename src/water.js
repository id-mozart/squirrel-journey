import * as THREE from 'three';
import { WORLD, RIVER_LEVEL, POND } from './world.js';
import { HEIGHT_GLSL } from './terrain.js';

const WATER_PARS_VERT = /* glsl */`varying vec3 vWorldPosW;`;
const WATER_VERT = /* glsl */`vWorldPosW = (modelMatrix * vec4(position, 1.0)).xyz;`;

const WATER_PARS_FRAG = /* glsl */`
varying vec3 vWorldPosW;
uniform float uTime;
uniform float uLevel;
uniform float uFlowX;
${HEIGHT_GLSL}
float hashw(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoisew(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hashw(i), hashw(i + vec2(1, 0)), u.x), mix(hashw(i + vec2(0, 1)), hashw(i + vec2(1, 1)), u.x), u.y); }
`;

const WATER_FRAG = /* glsl */`
float wdepth = uLevel - terrainHeight(vWorldPosW.xz);
{
  vec3 shallow = vec3(0.16, 0.36, 0.34);
  vec3 deep = vec3(0.015, 0.06, 0.09);
  diffuseColor.rgb = mix(shallow, deep, smoothstep(0.0, 2.2, wdepth));
  float alpha = mix(0.35, 0.92, smoothstep(0.0, 1.6, wdepth)) * smoothstep(-0.25, 0.1, wdepth);
  float n = vnoisew(vWorldPosW.xz * 3.0 + vec2(uTime * uFlowX * 0.4, uTime * 0.2)) * 0.6 + vnoisew(vWorldPosW.xz * 9.0 - uTime * 0.3) * 0.4;
  float foam = (1.0 - smoothstep(0.02, 0.55, wdepth + (n - 0.5) * 0.3)) * smoothstep(-0.15, 0.05, wdepth);
  foam *= 0.4 + 0.6 * smoothstep(0.35, 0.7, n);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.9, 0.9), foam * 0.8);
  diffuseColor.a = max(alpha, foam * 0.85) * opacity;
}
`;

const WATER_NORMAL_FRAG = /* glsl */`
{
  vec2 wuv = vWorldPosW.xz * 0.28;
  vec2 flow = vec2(uFlowX, 0.0);
  vec3 n1 = texture2D(normalMap, wuv + uTime * (vec2(0.022, 0.011) + flow * 0.05)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(normalMap, wuv * 1.9 + vec2(0.3) - uTime * (vec2(0.017, 0.026) - flow * 0.04)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(normalMap, wuv * 5.0 + uTime * vec2(0.05, -0.03)).xyz * 2.0 - 1.0;
  vec3 nts = normalize(vec3((n1.xy + n2.xy) * 0.55 + n3.xy * 0.25, 1.0));
  float calm = 1.0 - smoothstep(0.0, 0.8, wdepth) * 0.4;
  nts.xy *= normalScale.x * calm;
  nts = normalize(nts);
  vec3 T = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
  vec3 B = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec3 N = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  normal = normalize(T * nts.x + B * nts.y + N * nts.z);
}
`;

export function createWater(world, heightUniforms, normalTex) {
  const group = new THREE.Group();
  const makeMat = (level, flowX) => {
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 1,
      normalMap: normalTex, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.0,
      depthWrite: false, side: THREE.FrontSide,
    });
    const uniforms = { ...heightUniforms, uTime: { value: 0 }, uLevel: { value: level }, uFlowX: { value: flowX } };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + WATER_PARS_VERT)
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + WATER_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + WATER_PARS_FRAG)
        .replace('#include <map_fragment>', WATER_FRAG)
        .replace('#include <normal_fragment_maps>', WATER_NORMAL_FRAG);
    };
    mat.customProgramCacheKey = () => 'water';
    mat.userData.uniforms = uniforms;
    return mat;
  };
  // река
  const riverGeo = new THREE.PlaneGeometry(WORLD.maxX - WORLD.minX, 200, 60, 20);
  riverGeo.rotateX(-Math.PI / 2);
  const river = new THREE.Mesh(riverGeo, makeMat(RIVER_LEVEL, 1.0));
  river.position.set(0, RIVER_LEVEL, 950);
  river.receiveShadow = true;
  group.add(river);
  // пруд
  const pondGeo = new THREE.CircleGeometry(POND.r + 6, 48);
  pondGeo.rotateX(-Math.PI / 2);
  const pond = new THREE.Mesh(pondGeo, makeMat(POND.level, 0.0));
  pond.position.set(POND.x, POND.level, POND.z);
  pond.receiveShadow = true;
  group.add(pond);
  group.userData.materials = [river.material, pond.material];
  group.userData.update = (t) => { for (const m of group.userData.materials) m.userData.uniforms.uTime.value = t; };
  return group;
}
