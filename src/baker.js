import * as THREE from 'three';
import { NOISE_GLSL } from './glsl/noise.js';

const VERT = /* glsl */`
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Каждый материал определяет:
//   float H(vec2 uv)                       — высота 0..1 (бесшовно по uv)
//   void surface(vec2 uv, float h, out vec3 col, out float rough, out float alpha)
// Запекатель за один проход рендерит альбедо (rgb + rough/alpha), карту нормалей (rgb + высота) и ORM (ao, rough).
function buildFragment(def) {
  return /* glsl */`
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 fragColor;
uniform int uPass;
uniform float uSize;
uniform float uNormalStrength;
${NOISE_GLSL}
${def.glsl}
void main(){
  vec2 uv = vUv;
  float e = 1.0 / uSize;
  if (uPass == 0) {
    vec3 col; float rough; float alpha;
    surface(uv, H(uv), col, rough, alpha);
    fragColor = vec4(toSRGB(col), ${def.cutout ? 'alpha' : 'rough'});
  } else if (uPass == 1) {
    float h  = H(uv);
    float hx = H(uv + vec2(e, 0.0));
    float hy = H(uv + vec2(0.0, e));
    float hx2 = H(uv - vec2(e, 0.0));
    float hy2 = H(uv - vec2(0.0, e));
    float k = uNormalStrength * uSize * 0.5;
    vec3 n = normalize(vec3(-(hx - hx2) * k, -(hy - hy2) * k, 1.0));
    fragColor = vec4(n * 0.5 + 0.5, h);
  } else {
    float h = H(uv);
    float avg = 0.0;
    for (int r = 1; r <= 3; r++) {
      float rad = float(r) * float(r) * 2.0 * e;
      for (int a = 0; a < 8; a++) {
        float ang = float(a) * TAU / 8.0 + float(r) * 0.4;
        avg += H(uv + vec2(cos(ang), sin(ang)) * rad);
      }
    }
    avg /= 24.0;
    float ao = sat(1.0 - (avg - h) * uNormalStrength * 2.5);
    ao = mix(1.0, ao, float(${def.aoStrength ?? 1.0}));
    vec3 col; float rough; float alpha;
    surface(uv, h, col, rough, alpha);
    fragColor = vec4(ao, rough, 0.0, 1.0);
  }
}
`;
}

export class Baker {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.targets = new Map();
  }

  target(size) {
    if (!this.targets.has(size)) {
      this.targets.set(size, new THREE.WebGLRenderTarget(size, size, {
        format: THREE.RGBAFormat, type: THREE.UnsignedByteType,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      }));
    }
    return this.targets.get(size);
  }

  // Возвращает { albedo, normal, orm } как Uint8Array (rgba, размер size*size*4)
  bakePixels(def, passes = ['albedo', 'normal']) {
    const size = def.size || 1024;
    const rt = this.target(size);
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: buildFragment(def),
      uniforms: {
        uPass: { value: 0 },
        uSize: { value: size },
        uNormalStrength: { value: def.normalStrength ?? 1.0 },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad.material = mat;
    const out = {};
    const prev = this.renderer.getRenderTarget();
    const passIndex = { albedo: 0, normal: 1, orm: 2 };
    for (const p of passes) {
      mat.uniforms.uPass.value = passIndex[p];
      this.renderer.setRenderTarget(rt);
      this.renderer.render(this.scene, this.camera);
      const buf = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
      out[p] = buf;
    }
    this.renderer.setRenderTarget(prev);
    mat.dispose();
    return out;
  }

  makeTexture(pixels, size, { srgb = false, repeat = true, aniso = true } = {}) {
    const tex = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = aniso ? this.maxAniso : 1;
    tex.needsUpdate = true;
    return tex;
  }

  makeArrayTexture(layers, size, { srgb = false } = {}) {
    const data = new Uint8Array(size * size * 4 * layers.length);
    layers.forEach((l, i) => data.set(l, i * size * size * 4));
    const tex = new THREE.DataArrayTexture(data, size, size, layers.length);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = this.maxAniso;
    tex.needsUpdate = true;
    return tex;
  }

  // Полный набор PBR-текстур для стандартного материала
  bakeMaterialTextures(def, { orm = false } = {}) {
    const size = def.size || 1024;
    const px = this.bakePixels(def, orm ? ['albedo', 'normal', 'orm'] : ['albedo', 'normal']);
    const res = {
      map: this.makeTexture(px.albedo, size, { srgb: true, repeat: def.repeat !== false }),
      normalMap: this.makeTexture(px.normal, size, { repeat: def.repeat !== false }),
    };
    if (orm) res.orm = this.makeTexture(px.orm, size, { repeat: def.repeat !== false });
    return res;
  }

  dispose() {
    for (const rt of this.targets.values()) rt.dispose();
  }
}

export const nextFrame = () => new Promise((r) => setTimeout(r, 0));
