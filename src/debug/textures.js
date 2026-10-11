import * as THREE from 'three';
import { Baker } from '../baker.js';
import { GROUND_DEFS, BARK_DEFS, FOLIAGE_DEFS, MISC_DEFS } from '../textures.js';

export async function run() {
  const canvas = document.getElementById('game');
  canvas.style.display = 'none';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  const baker = new Baker(renderer);
  const defs = [...GROUND_DEFS, ...Object.values(BARK_DEFS), ...Object.values(FOLIAGE_DEFS), ...Object.values(MISC_DEFS)];
  const q = new URLSearchParams(location.search);
  const only = q.get('only');
  const showNormal = q.get('n') === '1';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#222;color:#eee;font:12px monospace;padding:8px';
  document.body.appendChild(wrap);
  const toCanvas = (src, size, opaque) => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      const srcRow = (size - 1 - y) * size * 4;
      img.data.set(src.subarray(srcRow, srcRow + size * 4), y * size * 4);
    }
    if (opaque) for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    ctx.putImageData(img, 0, 0);
    return c;
  };
  for (const def of defs) {
    if (only && !only.split(',').includes(def.name)) continue;
    const t0 = performance.now();
    const px = baker.bakePixels(def, showNormal ? ['albedo', 'normal'] : ['albedo']);
    const dt = performance.now() - t0;
    const size = def.size || 1024;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;align-items:flex-start;flex-wrap:wrap';
    const label = document.createElement('div');
    label.style.width = '90px';
    label.textContent = `${def.name} ${dt.toFixed(0)}ms`;
    row.appendChild(label);
    const full = toCanvas(px.albedo, size, !def.cutout);
    full.style.cssText = 'width:340px;height:340px;background:#f0f';
    row.appendChild(full);
    // фрагмент 340x340 в масштабе 1:1
    const crop = document.createElement('canvas');
    crop.width = 340; crop.height = 340;
    crop.style.cssText = 'width:340px;height:340px;background:#f0f';
    crop.getContext('2d').drawImage(full, 0, 0, 340, 340, 0, 0, 340, 340);
    row.appendChild(crop);
    if (showNormal) {
      const n = toCanvas(px.normal, size, true);
      n.style.cssText = 'width:340px;height:340px';
      row.appendChild(n);
    }
    wrap.appendChild(row);
    await new Promise((r) => requestAnimationFrame(r));
  }
  window.__done = true;
}
