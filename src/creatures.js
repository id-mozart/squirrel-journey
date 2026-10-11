import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { furMaterial, ellipsoidGeometry } from './squirrel.js';
import { mulberry32, lerp, clamp } from './noise.js';

// Лесные лакомства и зверушки, которых можно угощать.
export const TREATS = [
  { id: 'mushroom', name: 'белый гриб', icon: '🍄', z0: 20, z1: 380 },
  { id: 'apple', name: 'дикое яблоко', icon: '🍎', z0: 420, z1: 780 },
  { id: 'nut', name: 'лесной орех', icon: '🌰', z0: 820, z1: 1090 },
  { id: 'cone', name: 'шишку', icon: '🌲', z0: 1120, z1: 1560 },
  { id: 'berry', name: 'бруснику', icon: '🍒', z0: 1480, z1: 1780 },
];
export const ANIMALS = [
  { id: 'hedgehog', name: 'Ёжик', wants: 'mushroom', z: 230, side: 1, scale: 2.1, thanks: 'Ёжик довольно фыркает и уносит гриб в норку.' },
  { id: 'hare', name: 'Зайчиха', wants: 'apple', z: 650, side: -1, scale: 1.6, thanks: 'Зайчиха хрустит яблоком и шевелит ушами.' },
  { id: 'jay', name: 'Сойка', wants: 'nut', z: 1045, side: 1, scale: 2.8, thanks: 'Сойка прячет орех в дупло и трещит от радости.' },
  { id: 'chipmunk', name: 'Бурундук', wants: 'cone', z: 1385, side: -1, scale: 3.4, thanks: 'Бурундук набивает щёки семечками из шишки.' },
  { id: 'bear', name: 'Медвежонок', wants: 'berry', z: 1635, side: 1, scale: 1.35, thanks: 'Медвежонок урчит и облизывает лапу.' },
];

// ---------------------------------------------------------------- Геометрии лакомств (vertex colors)
function colored(geo, col) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function sphere(r, col, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz); g.translate(x, y, z);
  return colored(g, col);
}
function treatGeometry(id) {
  const parts = [];
  if (id === 'mushroom') {
    parts.push(sphere(0.055, [0.45, 0.28, 0.12], 0, 0.07, 0, 1, 0.6, 1));
    parts.push(sphere(0.05, [0.85, 0.78, 0.6], 0, 0.06, 0, 1, 0.25, 1));
    const stem = new THREE.CylinderGeometry(0.018, 0.026, 0.07, 10); stem.translate(0, 0.035, 0);
    parts.push(colored(stem, [0.9, 0.85, 0.7]));
  } else if (id === 'apple') {
    parts.push(sphere(0.042, [0.75, 0.12, 0.08], 0, 0.04, 0, 1, 0.92, 1));
    const stem = new THREE.CylinderGeometry(0.003, 0.004, 0.025, 6); stem.translate(0, 0.085, 0);
    parts.push(colored(stem, [0.3, 0.2, 0.1]));
    const leaf = new THREE.PlaneGeometry(0.018, 0.03); leaf.rotateX(-1.1); leaf.translate(0.01, 0.085, 0.005);
    parts.push(colored(leaf, [0.25, 0.5, 0.15]));
  } else if (id === 'nut') {
    parts.push(sphere(0.028, [0.5, 0.3, 0.12], 0, 0.028, 0, 1, 1.05, 1));
    parts.push(sphere(0.03, [0.65, 0.55, 0.3], 0, 0.045, 0, 1, 0.45, 1));
  } else if (id === 'cone') {
    const g = new THREE.SphereGeometry(0.03, 16, 14); g.scale(1, 1.9, 1); g.translate(0, 0.057, 0);
    const pos = g.attributes.position; const c = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i), ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const scale = 0.5 + 0.5 * Math.sin(y * 180 + ang * 5);
      const k = 0.55 + 0.45 * scale;
      c[i * 3] = 0.42 * k; c[i * 3 + 1] = 0.26 * k; c[i * 3 + 2] = 0.1 * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  } else {
    const rnd = mulberry32(5);
    for (let i = 0; i < 7; i++) parts.push(sphere(0.011, [0.72, 0.08, 0.1], (rnd() - 0.5) * 0.04, 0.012 + rnd() * 0.03, (rnd() - 0.5) * 0.04));
    const leaf = new THREE.PlaneGeometry(0.03, 0.045); leaf.rotateX(-1.3); leaf.translate(0, 0.012, 0.02);
    parts.push(colored(leaf, [0.15, 0.4, 0.12]));
    const leaf2 = new THREE.PlaneGeometry(0.03, 0.045); leaf2.rotateX(-1.3); leaf2.rotateY(2.2); leaf2.translate(-0.015, 0.012, -0.015);
    parts.push(colored(leaf2, [0.18, 0.45, 0.14]));
  }
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- Зверушки из меховых эллипсоидов
function addFurPart(parent, geo, pos, opts, rot) {
  const mat = furMaterial(opts);
  const SH = 12;
  mat.userData.uniforms.uShells.value = SH;
  const mesh = new THREE.InstancedMesh(geo, mat, SH);
  const m = new THREE.Matrix4();
  for (let i = 0; i < SH; i++) mesh.setMatrixAt(i, m);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  parent.add(mesh);
  return mesh;
}
const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0806, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
const noseMat = new THREE.MeshPhysicalMaterial({ color: 0x15100c, roughness: 0.4, clearcoat: 0.5 });
function addEyes(parent, pts, r) {
  for (const p of pts) { const e = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), eyeMat); e.position.set(...p); parent.add(e); }
}
function addNose(parent, p, r, mat = noseMat) { const n = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat); n.position.set(...p); parent.add(n); return n; }

function buildAnimal(id) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const anim = { body, head: null, extra: [], kind: id };
  if (id === 'hedgehog') {
    const spikes = { top: [0.12, 0.09, 0.06], belly: [0.55, 0.45, 0.35], bellyDir: [0, -1, 0.3], bellyAmt: 0.9, furLen: 0.04, density: 26, tipLight: 0.9 };
    addFurPart(body, ellipsoidGeometry(0.075, 0.06, 0.1, 4), [0, 0.065, 0], spikes);
    const head = new THREE.Group(); head.position.set(0, 0.06, 0.08); body.add(head); anim.head = head;
    addFurPart(head, ellipsoidGeometry(0.032, 0.028, 0.05, 3, (v, d) => { v.x *= 1 - 0.4 * Math.max(0, d.z); v.y -= 0.008 * Math.max(0, d.z); }), [0, 0, 0.015], { top: [0.42, 0.32, 0.22], belly: [0.6, 0.5, 0.4], bellyAmt: 0.7, furLen: 0.006, density: 14, tipLight: 0.3 });
    addEyes(head, [[-0.017, 0.008, 0.045], [0.017, 0.008, 0.045]], 0.0055);
    addNose(head, [0, -0.004, 0.068], 0.006);
    for (const s of [-1, 1]) for (const z of [0.05, -0.05]) addFurPart(body, ellipsoidGeometry(0.012, 0.012, 0.02, 2), [s * 0.045, 0.012, z], { top: [0.3, 0.22, 0.15], belly: [0.3, 0.22, 0.15], bellyAmt: 0, furLen: 0.004, density: 8 });
  } else if (id === 'hare') {
    const fur = { top: [0.42, 0.34, 0.24], belly: [0.9, 0.88, 0.82], furLen: 0.014, density: 36, tipLight: 0.35 };
    addFurPart(body, ellipsoidGeometry(0.08, 0.09, 0.13, 4), [0, 0.11, -0.02], fur);
    for (const s of [-1, 1]) addFurPart(body, ellipsoidGeometry(0.045, 0.06, 0.065, 3), [s * 0.055, 0.075, -0.07], fur);
    for (const s of [-1, 1]) addFurPart(body, ellipsoidGeometry(0.02, 0.018, 0.06, 3), [s * 0.05, 0.02, -0.04], { ...fur, furLen: 0.008 });
    for (const s of [-1, 1]) addFurPart(body, ellipsoidGeometry(0.018, 0.045, 0.02, 3), [s * 0.04, 0.05, 0.08], { ...fur, furLen: 0.008 });
    addFurPart(body, ellipsoidGeometry(0.03, 0.03, 0.03, 3), [0, 0.11, -0.16], { ...fur, top: [0.85, 0.85, 0.8], furLen: 0.02 });
    const head = new THREE.Group(); head.position.set(0, 0.2, 0.09); body.add(head); anim.head = head;
    addFurPart(head, ellipsoidGeometry(0.046, 0.045, 0.062, 4, (v, d) => { v.x *= 1 - 0.3 * Math.max(0, d.z) ** 2; }), [0, 0, 0.01], { ...fur, furLen: 0.01, bellyDir: [0, -1, 0.6], bellyAmt: 0.8 });
    for (const s of [-1, 1]) addFurPart(head, ellipsoidGeometry(0.014, 0.07, 0.022, 3), [s * 0.028, 0.08, -0.015], { ...fur, belly: [0.75, 0.6, 0.6], bellyDir: [0, 0, 1], bellyAmt: 0.6, furLen: 0.006 }, [-0.25, 0, -s * 0.3]);
    addEyes(head, [[-0.03, 0.012, 0.03], [0.03, 0.012, 0.03]], 0.011);
    addNose(head, [0, -0.008, 0.07], 0.007, new THREE.MeshPhysicalMaterial({ color: 0x5a2a2a, roughness: 0.5 }));
  } else if (id === 'jay') {
    const feather = { top: [0.55, 0.42, 0.35], belly: [0.9, 0.86, 0.8], furLen: 0.004, density: 30, tipLight: 0.2 };
    addFurPart(body, ellipsoidGeometry(0.038, 0.04, 0.07, 4), [0, 0.075, 0], feather);
    for (const s of [-1, 1]) addFurPart(body, ellipsoidGeometry(0.012, 0.03, 0.055, 3), [s * 0.034, 0.08, -0.01], { top: [0.25, 0.45, 0.85], belly: [0.1, 0.1, 0.15], bellyDir: [0, 0, -1], bellyAmt: 0.8, furLen: 0.003, density: 20, tipLight: 0.3 }, [0.3, 0, s * 0.35]);
    addFurPart(body, ellipsoidGeometry(0.014, 0.005, 0.06, 3), [0, 0.08, -0.1], { top: [0.15, 0.15, 0.2], belly: [0.3, 0.3, 0.35], furLen: 0.002, density: 10, tipLight: 0.2 });
    const head = new THREE.Group(); head.position.set(0, 0.11, 0.055); body.add(head); anim.head = head;
    addFurPart(head, ellipsoidGeometry(0.028, 0.028, 0.03, 3), [0, 0, 0], { top: [0.6, 0.5, 0.42], belly: [0.9, 0.85, 0.8], furLen: 0.003, density: 16, tipLight: 0.2 });
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.028, 8), new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6 }));
    beak.rotation.x = Math.PI / 2; beak.position.set(0, -0.003, 0.04); head.add(beak);
    addEyes(head, [[-0.02, 0.006, 0.014], [0.02, 0.006, 0.014]], 0.006);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 6), new THREE.MeshStandardMaterial({ color: 0x3a3030 })); leg.position.set(s * 0.012, 0.02, 0.01); body.add(leg); }
  } else if (id === 'chipmunk') {
    const fur = { top: [0.6, 0.38, 0.16], belly: [0.92, 0.88, 0.78], furLen: 0.007, density: 24, tipLight: 0.35 };
    addFurPart(body, ellipsoidGeometry(0.03, 0.03, 0.062, 4), [0, 0.035, 0], fur);
    addFurPart(body, ellipsoidGeometry(0.016, 0.03, 0.01, 3), [0, 0.05, -0.065], { ...fur, furLen: 0.014, density: 14 }, [-0.5, 0, 0]);
    const head = new THREE.Group(); head.position.set(0, 0.05, 0.05); body.add(head); anim.head = head;
    addFurPart(head, ellipsoidGeometry(0.022, 0.02, 0.03, 3, (v, d) => { v.x *= 1 - 0.3 * Math.max(0, d.z) ** 2; }), [0, 0, 0.005], { ...fur, furLen: 0.005, bellyDir: [0, -1, 0.5], bellyAmt: 0.8 });
    for (const s of [-1, 1]) addFurPart(head, ellipsoidGeometry(0.007, 0.011, 0.004, 2), [s * 0.015, 0.02, -0.005], { ...fur, furLen: 0.004, density: 6 });
    addEyes(head, [[-0.016, 0.006, 0.016], [0.016, 0.006, 0.016]], 0.005);
    addNose(head, [0, -0.002, 0.036], 0.003);
    // полоски на спине
    for (const s of [-1, 0, 1]) { const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.002, 0.05), new THREE.MeshStandardMaterial({ color: 0x2a1a0c, roughness: 0.9 })); stripe.position.set(s * 0.012, 0.067, 0); body.add(stripe); }
  } else {
    const fur = { top: [0.28, 0.17, 0.08], belly: [0.45, 0.32, 0.2], bellyAmt: 0.6, furLen: 0.026, density: 50, tipLight: 0.3 };
    addFurPart(body, ellipsoidGeometry(0.17, 0.16, 0.21, 4), [0, 0.2, 0], fur);
    for (const s of [-1, 1]) for (const z of [0.12, -0.12]) addFurPart(body, ellipsoidGeometry(0.055, 0.1, 0.06, 3), [s * 0.1, 0.09, z], { ...fur, furLen: 0.016 });
    const head = new THREE.Group(); head.position.set(0, 0.32, 0.15); body.add(head); anim.head = head;
    addFurPart(head, ellipsoidGeometry(0.1, 0.09, 0.11, 4), [0, 0, 0], { ...fur, furLen: 0.016, density: 36 });
    addFurPart(head, ellipsoidGeometry(0.045, 0.038, 0.05, 3), [0, -0.025, 0.09], { ...fur, top: [0.55, 0.42, 0.28], furLen: 0.006, density: 14 });
    for (const s of [-1, 1]) addFurPart(head, ellipsoidGeometry(0.03, 0.03, 0.015, 3), [s * 0.07, 0.075, -0.02], { ...fur, furLen: 0.01, density: 12 });
    addEyes(head, [[-0.04, 0.02, 0.085], [0.04, 0.02, 0.085]], 0.012);
    addNose(head, [0, -0.012, 0.138], 0.014);
  }
  g.userData.anim = anim;
  return g;
}

// ---------------------------------------------------------------- Пузырь с иконкой и сердечки
function bubbleTexture(text) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.beginPath(); ctx.arc(64, 56, 48, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,250,240,0.92)'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(52, 98); ctx.lineTo(64, 122); ctx.lineTo(76, 98); ctx.fill();
  ctx.font = '60px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 64, 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function heartTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d'); ctx.font = '48px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('❤️', 32, 36);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Creatures {
  constructor(world) {
    this.world = world;
    this.group = new THREE.Group();
    this.inventory = Object.fromEntries(TREATS.map((t) => [t.id, 0]));
    this.treatDefs = Object.fromEntries(TREATS.map((t) => [t.id, t]));
    this.tmpM = new THREE.Matrix4(); this.tmpQ = new THREE.Quaternion(); this.tmpP = new THREE.Vector3(); this.tmpS = new THREE.Vector3();
    this.buildTreats();
    this.buildAnimals();
    this.hearts = [];
    this.heartMat = new THREE.SpriteMaterial({ map: heartTexture(), transparent: true, depthWrite: false });
  }

  buildTreats() {
    const rnd = mulberry32(777);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
    this.treats = [];
    this.treatMeshes = {};
    for (const def of TREATS) {
      const items = [];
      let tries = 0;
      while (items.length < 9 && tries++ < 200) {
        const z = lerp(def.z0, def.z1, rnd());
        const x = this.world.trailX(z) + (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 14);
        if (this.world.isWater(x, z) || Math.abs(x) > 230) continue;
        if (this.world.slopeAt(x, z) > 0.8) continue;
        items.push({ id: `${def.id}-${items.length}`, type: def.id, x, z, y: this.world.groundAt(x, z), collected: false, phase: rnd() * 6.28 });
      }
      const mesh = new THREE.InstancedMesh(treatGeometry(def.id), mat, items.length);
      mesh.castShadow = true; mesh.frustumCulled = false;
      this.group.add(mesh);
      this.treatMeshes[def.id] = { mesh, items };
      this.treats.push(...items);
    }
    this.totalTreats = this.treats.length;
    this.updateTreatMatrices(0);
  }

  updateTreatMatrices(time) {
    for (const { mesh, items } of Object.values(this.treatMeshes)) {
      items.forEach((it, i) => {
        if (it.collected) { this.tmpP.set(it.x, -100, it.z); this.tmpS.setScalar(0.001); }
        else { this.tmpP.set(it.x, it.y + 0.02 + Math.sin(time * 2 + it.phase) * 0.015, it.z); this.tmpS.setScalar(it.type === 'nut' || it.type === 'berry' ? 2.4 : 1.8); }
        this.tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), time * 0.8 + it.phase);
        this.tmpM.compose(this.tmpP, this.tmpQ, this.tmpS);
        mesh.setMatrixAt(i, this.tmpM);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  buildAnimals() {
    this.animals = [];
    for (const def of ANIMALS) {
      const z = def.z;
      let x = this.world.trailX(z) + def.side * 5.5;
      if (this.world.isWater(x, z)) x = this.world.trailX(z) - def.side * 5.5;
      const y = this.world.groundAt(x, z);
      const mesh = buildAnimal(def.id);
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(def.scale || 1);
      mesh.rotation.y = Math.atan2(this.world.trailX(z) - x, 0) + (def.side > 0 ? -0.3 : 0.3);
      this.group.add(mesh);
      const want = this.treatDefs[def.wants];
      const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(want.icon), transparent: true, depthWrite: false }));
      const headH = def.id === 'bear' ? 0.55 : def.id === 'hare' ? 0.36 : 0.2;
      bubble.position.set(0, headH + 0.22 / (def.scale || 1), 0);
      bubble.scale.setScalar(0.28 / (def.scale || 1));
      mesh.add(bubble);
      this.animals.push({ def, mesh, bubble, fed: false, happy: 0, yaw: mesh.rotation.y, baseY: y, headH, want });
    }
    this.totalAnimals = this.animals.length;
  }

  // Подбор лакомств рядом с игроком
  collectNear(x, y, z, r) {
    const got = [];
    for (const it of this.treats) {
      if (it.collected) continue;
      if (Math.hypot(it.x - x, it.y - y, it.z - z) < r) { it.collected = true; this.inventory[it.type]++; got.push(this.treatDefs[it.type]); }
    }
    return got;
  }

  nearestAnimal(x, z, r) {
    let best = null, bd = r;
    for (const a of this.animals) {
      const d = Math.hypot(a.mesh.position.x - x, a.mesh.position.z - z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  feed(a) {
    if (a.fed || this.inventory[a.def.wants] <= 0) return false;
    this.inventory[a.def.wants]--;
    a.fed = true; a.happy = 2.5;
    a.bubble.material.map = bubbleTexture('❤️'); a.bubble.material.needsUpdate = true;
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(this.heartMat);
      s.position.copy(a.mesh.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, a.headH * (a.def.scale || 1) + 0.1, (Math.random() - 0.5) * 0.4));
      s.scale.setScalar(0.12 + Math.random() * 0.1);
      this.group.add(s);
      this.hearts.push({ s, life: 1.4 + Math.random() * 0.6, vy: 0.5 + Math.random() * 0.4 });
    }
    return true;
  }

  fedCount() { return this.animals.filter((a) => a.fed).length; }

  update(dt, time, playerPos) {
    this.updateTreatMatrices(time);
    for (const a of this.animals) {
      const m = a.mesh, an = m.userData.anim;
      const dx = playerPos.x - m.position.x, dz = playerPos.z - m.position.z;
      const d = Math.hypot(dx, dz);
      // поворачивается к игроку, когда он близко
      if (d < 7) { const ty = Math.atan2(dx, dz); let dd = ty - m.rotation.y; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); m.rotation.y += dd * (1 - Math.exp(-3 * dt)); }
      const k = a.def.id === 'jay' ? 6 : a.def.id === 'bear' ? 1.6 : 3;
      let lift = Math.sin(time * k + m.position.x) * 0.004;
      if (a.happy > 0) { a.happy -= dt; lift += Math.abs(Math.sin(a.happy * 9)) * (a.def.id === 'bear' ? 0.05 : 0.08); }
      an.body.position.y = lift;
      if (an.head) an.head.rotation.set(Math.sin(time * 1.3 + m.position.z) * 0.08 - (a.happy > 0 ? 0.25 : 0), Math.sin(time * 0.7 + m.position.x) * 0.25, 0);
      a.bubble.position.y = a.headH + (0.22 + Math.sin(time * 2.5) * 0.02) / (a.def.scale || 1);
      a.bubble.visible = !a.fed || a.happy > 0;
    }
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const h = this.hearts[i];
      h.life -= dt; h.s.position.y += h.vy * dt; h.s.material = this.heartMat;
      if (h.life <= 0) { this.group.remove(h.s); this.hearts.splice(i, 1); }
    }
  }

  saveState() { return { inv: this.inventory, treats: this.treats.filter((t) => t.collected).map((t) => t.id), fed: this.animals.filter((a) => a.fed).map((a) => a.def.id) }; }
  restoreState(st) {
    for (const t of TREATS) this.inventory[t.id] = (st && st.inv && st.inv[t.id]) || 0;
    const set = new Set((st && st.treats) || []);
    for (const t of this.treats) t.collected = set.has(t.id);
    const fed = new Set((st && st.fed) || []);
    for (const a of this.animals) { a.fed = fed.has(a.def.id); a.happy = 0; if (a.fed) { a.bubble.material.map = bubbleTexture('❤️'); a.bubble.material.needsUpdate = true; } }
  }
}
