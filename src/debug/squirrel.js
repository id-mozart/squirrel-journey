import * as THREE from 'three';
import { Squirrel } from '../squirrel.js';
import { Sky, timeOfDay } from '../sky.js';

export async function run() {
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const W = innerWidth || 1280, H = innerHeight || 900;
  renderer.setSize(W, H);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, W / H, 0.02, 100);
  const q = new URLSearchParams(location.search);
  const sky = new Sky();
  const tod = timeOfDay(parseFloat(q.get('p') || '0.2'));
  sky.uniforms.uSunDir.value.copy(tod.sun);
  scene.add(sky.mesh);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky.envScene, 0.04, 1, 100).texture;
  scene.background = new THREE.Color(0x88a0b8);
  const sun = new THREE.DirectionalLight(tod.sunColor, tod.sunIntensity);
  sun.position.copy(tod.sun).multiplyScalar(10);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -2; sun.shadow.camera.right = sun.shadow.camera.top = 2;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 30; sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.01;
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(tod.ambientSky, tod.ambientGround, 0.6);
  scene.add(hemi);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.MeshStandardMaterial({ color: 0x5a4a30, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  const squirrel = new Squirrel();
  scene.add(squirrel.root);
  const poses = {
    sit: { state: 'ground', speed: 0, vy: 0, moving: false },
    run: { state: 'ground', speed: 6, vy: 0, moving: true },
    climb: { state: 'climb', speed: 0, vy: 0, moving: false, climbDir: 1 },
    glide: { state: 'glide', speed: 8, vy: -2, moving: false },
    air: { state: 'air', speed: 5, vy: 4, moving: false },
  };
  let pose = q.get('pose') || 'sit';
  let angle = parseFloat(q.get('a') || '0.6');
  let dist = parseFloat(q.get('d') || '1.3');
  let elev = parseFloat(q.get('e') || '0.35');
  window.addEventListener('keydown', (e) => {
    if (e.key === '1') pose = 'sit'; if (e.key === '2') pose = 'run'; if (e.key === '3') pose = 'climb'; if (e.key === '4') pose = 'glide'; if (e.key === '5') pose = 'air';
    if (e.key === 'ArrowLeft') angle -= 0.2; if (e.key === 'ArrowRight') angle += 0.2;
    if (e.key === 'ArrowUp') dist *= 0.9; if (e.key === 'ArrowDown') dist /= 0.9;
  });
  const clock = new THREE.Clock();
  const fwd = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
  const spin = q.get('spin') === '1';
  let simT = 0;
  const frame = (dt) => {
    const t = simT += dt;
    if (spin) angle += dt * 0.5;
    squirrel.setPose(poses[pose]);
    if (pose === 'climb') { fwd.set(0, 1, 0); up.set(0, 0, -1); squirrel.root.position.set(0, 0.6, 0); }
    else { fwd.set(0, 0, 1); up.set(0, 1, 0); squirrel.root.position.set(0, pose === 'glide' || pose === 'air' ? 0.5 : 0, 0); }
    squirrel.setTransform(squirrel.root.position, fwd, up);
    squirrel.update(dt, t);
    const focus = new THREE.Vector3(0, squirrel.root.position.y + 0.22, 0);
    camera.position.set(Math.sin(angle) * dist, focus.y + elev * dist, Math.cos(angle) * dist);
    camera.lookAt(focus);
    sky.mesh.position.copy(camera.position);
    renderer.render(scene, camera);
  };
  const loop = () => { requestAnimationFrame(loop); frame(Math.min(0.05, clock.getDelta())); };
  loop();
  window.__dbg = { squirrel, setPose: (p) => { pose = p; }, setView: (a, d, e) => { angle = a; dist = d; elev = e; },
    step: (n) => { for (let i = 0; i < n; i++) frame(1 / 60); },
    shot: (name) => new Promise((res) => { frame(1 / 60); canvas.toBlob((b) => fetch('/__shot?name=' + name, { method: 'POST', body: b }).then(() => res('saved'))); }) };
}
