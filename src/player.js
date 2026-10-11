import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';
import { WORLD } from './world.js';

const RUN = 6.5, SPRINT = 10.5, ACCEL = 34, JUMP = 6.8, GRAVITY = 20, GLIDE_FALL = 1.7, GLIDE_SPEED = 10.5;
const CLIMB_SPEED = 3.4, SWIM = 2.6;

// Радиус ствола на высоте y над основанием (согласовано с геометрией в vegetation.js)
export function trunkRadiusAt(tree, y) {
  const topFrac = tree.species >= 2 ? 1.0 : 0.82;
  const t = clamp(y / (tree.height * topFrac), 0, 1);
  const flare = tree.species === 0 ? 0.9 : 0.45;
  let r = tree.radius * Math.pow(Math.max(0.02, 1 - t * 0.92), tree.species === 3 ? 0.9 : 0.75) * (1 + flare * Math.exp(-y / (tree.radius * 1.6)));
  return Math.max(r, 0.04);
}

export class Player {
  constructor(world, squirrel, camera, canvas) {
    this.world = world; this.squirrel = squirrel; this.camera = camera; this.canvas = canvas;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.state = 'ground'; this.speed = 0;
    this.camYaw = Math.PI; this.camPitch = 0.28; this.camDist = 2.6;
    this.keys = {}; this.mouseIdle = 0; this.locked = false;
    this.climb = null; // { tree, angle, y }
    this.idleTime = 0;
    this.glideHeld = false;
    this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1); this.up = new THREE.Vector3(0, 1, 0);
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.nearTree = null;
    this.onPointerUnlock = null;
    this.jumpBuffer = 0;
    this.stepEvent = 0; this.lastPhase = 0;
    this.events = [];
    this.bindInput();
  }

  bindInput() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Space') { this.jumpBuffer = 0.15; e.preventDefault(); }
      if (e.code === 'KeyE') this.interact = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
    this.canvas.addEventListener('mousedown', (e) => { if (!this.locked) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; } });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      let dx = 0, dy = 0;
      if (this.locked) { dx = e.movementX; dy = e.movementY; }
      else if (this.dragging) { dx = e.clientX - this.lastX; dy = e.clientY - this.lastY; this.lastX = e.clientX; this.lastY = e.clientY; }
      else return;
      this.camYaw -= dx * 0.0022;
      this.camPitch = clamp(this.camPitch + dy * 0.0018, -0.45, 1.15);
      this.mouseIdle = 0;
    });
    window.addEventListener('wheel', (e) => { this.camDist = clamp(this.camDist + e.deltaY * 0.002, 1.2, 7); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked && this.onPointerUnlock) this.onPointerUnlock();
    });
  }

  lockPointer() { try { const p = this.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch {} }

  teleport(x, z) {
    this.pos.set(x, this.world.groundAt(x, z), z);
    this.vel.set(0, 0, 0); this.state = 'ground'; this.climb = null;
    this.camPos.copy(this.pos).add(new THREE.Vector3(0, 1, -3));
    this.squirrel.resetTail();
  }

  inputVector() {
    const k = this.keys;
    let ix = 0, iz = 0;
    if (k.KeyW || k.ArrowUp) iz += 1;
    if (k.KeyS || k.ArrowDown) iz -= 1;
    if (k.KeyA || k.ArrowLeft) ix -= 1;
    if (k.KeyD || k.ArrowRight) ix += 1;
    const len = Math.hypot(ix, iz);
    if (len > 1) { ix /= len; iz /= len; }
    return { ix, iz, len: Math.min(1, len) };
  }

  // направление движения в мире по камере
  moveDir(ix, iz, out) {
    const fx = -Math.sin(this.camYaw), fz = -Math.cos(this.camYaw);
    const rx = -fz, rz = fx;
    out.set(fx * iz + rx * ix, 0, fz * iz + rz * ix);
    return out;
  }

  update(dt, time) {
    this.mouseIdle += dt;
    this.jumpBuffer -= dt;
    const w = this.world;
    const { ix, iz, len } = this.inputVector();
    const sprint = !!(this.keys.ShiftLeft || this.keys.ShiftRight);
    const dir = this.moveDir(ix, iz, new THREE.Vector3());
    const pos = this.pos, vel = this.vel;
    const wl = w.waterLevelAt(pos.x, pos.z);
    const ground = w.groundAt(pos.x, pos.z);
    this.interactNow = this.interact; this.interact = false;

    if (this.state === 'climb') this.updateClimb(dt, ix, iz);
    else {
      // горизонтальное движение
      const inWater = wl > -1e9 && ground < wl - 0.3 && pos.y <= wl + 0.05;
      if (inWater && this.state !== 'air' || (inWater && this.state === 'air' && vel.y < 0 && pos.y < wl - 0.05)) this.state = 'swim';
      if (this.state === 'swim' && !(wl > -1e9 && ground < wl - 0.25)) { this.state = 'ground'; }
      const target = this.state === 'swim' ? SWIM : (this.state === 'glide' ? GLIDE_SPEED : (sprint ? SPRINT : RUN));
      const control = this.state === 'ground' || this.state === 'swim' ? 1 : (this.state === 'glide' ? 0.7 : 0.35);
      const tvx = dir.x * target * len, tvz = dir.z * target * len;
      const acc = ACCEL * control * (len > 0 ? 1 : 0.8);
      vel.x += clamp(tvx - vel.x, -acc * dt, acc * dt);
      vel.z += clamp(tvz - vel.z, -acc * dt, acc * dt);
      if (this.state === 'glide') {
        // планирование: скорость держится по направлению взгляда
        const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        const spd = Math.max(GLIDE_SPEED * 0.8, Math.hypot(vel.x, vel.z));
        if (len > 0) { vel.x = lerp(vel.x, dir.x * spd, 1 - Math.exp(-3 * dt)); vel.z = lerp(vel.z, dir.z * spd, 1 - Math.exp(-3 * dt)); }
        else { vel.x = lerp(vel.x, fwd.x * spd, 1 - Math.exp(-2 * dt)); vel.z = lerp(vel.z, fwd.z * spd, 1 - Math.exp(-2 * dt)); }
      }
      // прыжок
      if (this.jumpBuffer > 0 && (this.state === 'ground' || this.state === 'swim')) {
        vel.y = this.state === 'swim' ? JUMP * 0.55 : JUMP; this.state = 'air'; this.jumpBuffer = 0; this.events.push('jump');
      }
      // вертикаль
      if (this.state === 'air' || this.state === 'glide') {
        const holding = !!this.keys.Space;
        const above = pos.y - ground;
        if (holding && vel.y < 0 && above > 1.0 && this.state === 'air') { this.state = 'glide'; this.events.push('glide'); }
        if (this.state === 'glide' && (!holding || vel.y > 0)) this.state = 'air';
        vel.y -= GRAVITY * dt * (this.state === 'glide' ? 0.35 : 1);
        if (this.state === 'glide') vel.y = Math.max(vel.y, -GLIDE_FALL);
        vel.y = Math.max(vel.y, -30);
      }
      // перемещение с проверкой ступеней
      const nx = pos.x + vel.x * dt, nz = pos.z + vel.z * dt;
      const tryMove = (x, z) => {
        if (x < WORLD.minX + 12 || x > WORLD.maxX - 12 || z < WORLD.minZ + 12 || z > WORLD.maxZ - 12) return false;
        const g = w.groundAt(x, z);
        const feet = this.state === 'ground' || this.state === 'swim' ? pos.y : pos.y;
        if (g - feet > 0.55) return false;
        return true;
      };
      if (tryMove(nx, nz)) { pos.x = nx; pos.z = nz; }
      else if (tryMove(nx, pos.z)) { pos.x = nx; vel.z = 0; }
      else if (tryMove(pos.x, nz)) { pos.z = nz; vel.x = 0; }
      else { vel.x *= 0.2; vel.z *= 0.2; }
      // столкновения со стволами и залезание
      this.nearTree = null;
      const trees = w.nearbyTrees(pos.x, pos.z);
      for (const t of trees) {
        const hy = pos.y - t.y;
        if (hy < -1 || hy > t.height) continue;
        const r = trunkRadiusAt(t, Math.max(0, hy)) + 0.12;
        const dx = pos.x - t.x, dz = pos.z - t.z;
        const d = Math.hypot(dx, dz);
        if (d < r + 0.7) this.nearTree = t;
        if (d < r) {
          const toTrunk = new THREE.Vector3(-dx / (d || 1), 0, -dz / (d || 1));
          const pushing = len > 0 && dir.dot(toTrunk) > 0.35;
          if ((pushing || this.interactNow) && this.state !== 'swim') { this.startClimb(t); break; }
          pos.x = t.x + (dx / (d || 1)) * r; pos.z = t.z + (dz / (d || 1)) * r;
          const vn = vel.x * toTrunk.x + vel.z * toTrunk.z;
          if (vn > 0) { vel.x -= toTrunk.x * vn; vel.z -= toTrunk.z * vn; }
        }
      }
      if (this.state !== 'climb' && this.interactNow && this.nearTree && this.state !== 'swim') this.startClimb(this.nearTree);
      // вертикальное положение
      if (this.state !== 'climb') {
        const g2 = w.groundAt(pos.x, pos.z);
        const wl2 = w.waterLevelAt(pos.x, pos.z);
        if (this.state === 'ground') {
          pos.y = g2;
          // спуск по крутому склону
          const slope = w.slopeAt(pos.x, pos.z);
          if (slope > 1.25 && g2 === w.heightAt(pos.x, pos.z)) {
            const n = w.normalAt(pos.x, pos.z, new THREE.Vector3());
            vel.x += n.x * 25 * dt; vel.z += n.z * 25 * dt;
          }
          if (pos.y > g2 + 0.01) this.state = 'air';
        } else if (this.state === 'swim') {
          pos.y = wl2 - 0.1;
          if (g2 > wl2 - 0.25) { pos.y = g2; this.state = 'ground'; }
        } else {
          pos.y += vel.y * dt;
          if (pos.y <= g2) {
            pos.y = g2;
            const hard = vel.y < -9;
            vel.y = 0;
            if (wl2 > -1e9 && g2 < wl2 - 0.3) { this.state = 'swim'; this.events.push('splash'); }
            else { this.state = 'ground'; this.events.push(hard ? 'landHard' : 'land'); }
          }
        }
      }
    }
    // поворот тела по движению
    const hv = Math.hypot(vel.x, vel.z);
    this.speed = hv;
    if (this.state !== 'climb') {
      if (hv > 0.3 || (len > 0 && this.state === 'glide')) {
        const targetYaw = Math.atan2(vel.x, vel.z);
        let d = targetYaw - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * (1 - Math.exp(-12 * dt));
      }
      this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      const n = w.normalAt(pos.x, pos.z, this.groundNormal);
      const upTarget = this.state === 'ground' ? new THREE.Vector3(0, 1, 0).lerp(n, 0.7).normalize() : new THREE.Vector3(0, 1, 0);
      this.up.lerp(upTarget, 1 - Math.exp(-8 * dt)).normalize();
      // при планировании — наклон по вертикальной скорости
      if (this.state === 'glide' || this.state === 'air') this.forward.y = clamp(vel.y * 0.04, -0.35, 0.3);
    }
    this.idleTime = hv < 0.2 && this.state === 'ground' ? this.idleTime + dt : 0;
    // белка
    const moving = this.state === 'ground' ? hv > 0.35 : false;
    this.squirrel.setPose({ state: this.state, speed: hv, vy: vel.y, moving, climbDir: this.climbDir || 0 });
    this.squirrel.setTransform(pos, this.forward, this.up);
    this.squirrel.update(dt, time);
    // события шагов
    if (moving) {
      const ph = this.squirrel.phase % (Math.PI * 2);
      if (ph < this.lastPhase) this.events.push('step');
      this.lastPhase = ph;
    }
    this.updateCamera(dt);
  }

  startClimb(tree) {
    this.state = 'climb';
    const dx = this.pos.x - tree.x, dz = this.pos.z - tree.z;
    this.climb = { tree, angle: Math.atan2(dz, dx), y: clamp(this.pos.y - tree.y, 0, tree.climbTop) };
    this.vel.set(0, 0, 0);
    this.events.push('climb');
  }

  updateClimb(dt, ix, iz) {
    const c = this.climb, t = c.tree, w = this.world;
    // W/S — вверх/вниз, A/D — вокруг ствола
    this.climbDir = iz;
    c.y += iz * CLIMB_SPEED * dt;
    const r = trunkRadiusAt(t, c.y);
    c.angle -= ix * (1.6 / (r + 0.1)) * dt;
    if (c.y > t.climbTop) c.y = t.climbTop;
    const px = t.x + Math.cos(c.angle) * (r + 0.05), pz = t.z + Math.sin(c.angle) * (r + 0.05);
    const gy = w.groundAt(px, pz) - t.y;
    if (c.y < gy + 0.05) {
      c.y = gy + 0.05;
      if (iz < 0 || this.interactNow) { this.state = 'ground'; this.pos.set(px, w.groundAt(px, pz), pz); this.climb = null; return; }
    }
    this.pos.set(px, t.y + c.y, pz);
    const outward = new THREE.Vector3(Math.cos(c.angle), 0, Math.sin(c.angle));
    // прыжок со ствола
    if (this.jumpBuffer > 0 || (this.interactNow && c.y > gy + 0.5)) {
      this.jumpBuffer = 0;
      this.state = 'air';
      const camF = new THREE.Vector3(-Math.sin(this.camYaw), 0, -Math.cos(this.camYaw));
      const jdir = outward.clone().multiplyScalar(0.6).add(camF.multiplyScalar(0.7)).normalize();
      this.vel.set(jdir.x * 4.5, 4.5, jdir.z * 4.5);
      this.pos.x += outward.x * 0.2; this.pos.z += outward.z * 0.2;
      this.yaw = Math.atan2(jdir.x, jdir.z);
      this.climb = null;
      this.events.push('jump');
      return;
    }
    // ориентация: вперёд = вверх по стволу, «верх» тела = от ствола
    this.forward.set(0, 1, 0);
    this.up.copy(outward);
    this.yaw = Math.atan2(outward.x, outward.z);
  }

  updateCamera(dt) {
    const pos = this.pos;
    // автоматический разворот камеры за спиной при движении
    if (this.mouseIdle > 1.2 && this.speed > 1 && this.state !== 'climb') {
      const behind = this.yaw + Math.PI;
      let d = behind - this.camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.camYaw += d * (1 - Math.exp(-1.2 * dt));
    }
    if (this.keys.KeyQ) this.camYaw += 1.8 * dt;
    if (this.keys.KeyE && this.state === 'climb') {}
    const dist = this.camDist;
    const cp = this.camPitch;
    const focus = new THREE.Vector3(pos.x, pos.y + 0.32, pos.z);
    if (this.state === 'climb') focus.y += 0.15;
    const off = new THREE.Vector3(Math.sin(this.camYaw) * Math.cos(cp) * dist, Math.sin(cp) * dist + 0.15, Math.cos(this.camYaw) * Math.cos(cp) * dist);
    const desired = focus.clone().add(off);
    // не проваливаться под землю
    const g = this.world.groundAt(desired.x, desired.z) + 0.3;
    if (desired.y < g) desired.y = g;
    // не входить в стволы: отодвигаем камеру к фокусу, если ствол между ними
    const trees = this.world.nearbyTrees(desired.x, desired.z);
    for (const t of trees) {
      const hy = desired.y - t.y; if (hy < 0 || hy > t.height) continue;
      const r = trunkRadiusAt(t, hy) + 0.2;
      const dx = desired.x - t.x, dz = desired.z - t.z, d = Math.hypot(dx, dz);
      if (d < r) { desired.x = t.x + dx / (d || 1) * r; desired.z = t.z + dz / (d || 1) * r; }
    }
    const k = 1 - Math.exp(-14 * dt);
    this.camPos.lerp(desired, k);
    this.camLook.lerp(focus, 1 - Math.exp(-20 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // Титульный экран: белка сидит, камера медленно облетает
  updateIdle(dt, time) {
    const pos = this.pos;
    pos.y = this.world.groundAt(pos.x, pos.z);
    this.squirrel.setPose({ state: 'ground', speed: 0, vy: 0, moving: false, climbDir: 0 });
    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.squirrel.setTransform(pos, this.forward, this.up);
    this.squirrel.update(dt, time);
    const a = time * 0.12 + Math.PI;
    const focus = new THREE.Vector3(pos.x, pos.y + 0.3, pos.z);
    const desired = new THREE.Vector3(pos.x + Math.sin(a) * 1.9, pos.y + 0.55, pos.z + Math.cos(a) * 1.9);
    const g = this.world.groundAt(desired.x, desired.z) + 0.25;
    if (desired.y < g) desired.y = g;
    this.camPos.lerp(desired, 1 - Math.exp(-3 * dt));
    this.camLook.lerp(focus, 1 - Math.exp(-3 * dt));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
