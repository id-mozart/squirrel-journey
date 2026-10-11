import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Baker, nextFrame } from './baker.js';
import { GROUND_DEFS, BARK_DEFS, FOLIAGE_DEFS, MISC_DEFS } from './textures.js';
import { World, WORLD, REGIONS, HOME_Z, SUMMIT_Z } from './world.js';
import { Sky, timeOfDay } from './sky.js';
import { createTerrainMaterial, buildTerrain, makeHeightUniforms } from './terrain.js';
import { createWater } from './water.js';
import { Vegetation } from './vegetation.js';
import { Grass } from './grass.js';
import { Props } from './props.js';
import { Squirrel } from './squirrel.js';
import { Player } from './player.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { Particles } from './particles.js';
import { Creatures, TREATS } from './creatures.js';

const FINAL_SHADER = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.35 }, uTime: { value: 0 }, uFade: { value: 1 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uTime; uniform float uFade;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float v = 1.0 - uVignette * smoothstep(0.35, 0.95, length(p) * 1.25);
      // лёгкое зерно
      float g = fract(sin(dot(vUv * 1000.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c.rgb = c.rgb * v + g * 0.012;
      c.rgb *= uFade;
      gl_FragColor = c;
    }`,
};

export async function start() {
  const canvas = document.getElementById('game');
  const ui = new UI();
  ui.showLoading('Просыпаемся…', 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const baseDPR = Math.min(window.devicePixelRatio || 1, 2);
  let dpr = Math.min(baseDPR, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);

  // ---------------------------------------------------------------- Текстуры
  const baker = new Baker(renderer);
  const tex = { ground: { albedo: [], normal: [] }, bark: {}, foliage: {}, misc: {} };
  const totalBakes = GROUND_DEFS.length + Object.keys(BARK_DEFS).length + Object.keys(FOLIAGE_DEFS).length + Object.keys(MISC_DEFS).length;
  let done = 0;
  const tLoad0 = performance.now();
  const step = async (label) => { done++; ui.showLoading(label, (done / totalBakes) * 0.55); await nextFrame(); };
  for (const def of GROUND_DEFS) {
    const px = baker.bakePixels(def, ['albedo', 'normal']);
    tex.ground.albedo.push(px.albedo); tex.ground.normal.push(px.normal);
    await step('Рисуем землю и траву…');
  }
  const groundSize = GROUND_DEFS[0].size;
  const albedoArr = baker.makeArrayTexture(tex.ground.albedo, groundSize, { srgb: true });
  const normalArr = baker.makeArrayTexture(tex.ground.normal, groundSize, { srgb: false });
  tex.rock = { map: baker.makeTexture(tex.ground.albedo[3], groundSize, { srgb: true }), normalMap: baker.makeTexture(tex.ground.normal[3], groundSize) };
  for (const [name, def] of Object.entries(BARK_DEFS)) { tex.bark[name] = baker.bakeMaterialTextures(def, { orm: true }); await step('Растим деревья…'); }
  for (const [name, def] of Object.entries(FOLIAGE_DEFS)) { tex.foliage[name] = baker.bakeMaterialTextures(def); await step('Раскрашиваем листву…'); }
  for (const [name, def] of Object.entries(MISC_DEFS)) { tex.misc[name] = baker.bakeMaterialTextures(def); await step('Собираем жёлуди…'); }

  // ---------------------------------------------------------------- Мир
  ui.showLoading('Прокладываем тропу…', 0.6);
  await nextFrame();
  const tW0 = performance.now();
  const world = new World(7);
  world.build();
  ui.showLoading('Строим ландшафт…', 0.75);
  await nextFrame();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.05, 1500);
  scene.fog = new THREE.FogExp2(0x9fb8d0, 0.0028);

  const sky = new Sky();
  scene.add(sky.mesh);
  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x4a3a20, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  sun.shadow.radius = 2;
  const SHADOW_R = 55;
  sun.shadow.camera.left = -SHADOW_R; sun.shadow.camera.right = SHADOW_R;
  sun.shadow.camera.top = SHADOW_R; sun.shadow.camera.bottom = -SHADOW_R;
  scene.add(sun); scene.add(sun.target);
  const moon = new THREE.DirectionalLight(0x9fb4ff, 0);
  scene.add(moon); scene.add(moon.target);

  const heightUniforms = makeHeightUniforms(world);
  const terrainMat = createTerrainMaterial(world, albedoArr, normalArr);
  const terrain = buildTerrain(world, terrainMat);
  scene.add(terrain);
  const water = createWater(world, heightUniforms, tex.misc.waterNormal.normalMap);
  scene.add(water);

  ui.showLoading('Сажаем лес…', 0.82);
  await nextFrame();
  const tV0 = performance.now();
  const vegetation = new Vegetation(world, tex);
  scene.add(vegetation.group);
  ui.showLoading('Сеем траву…', 0.9);
  await nextFrame();
  const grass = new Grass(world, heightUniforms);
  scene.add(grass.mesh);
  const props = new Props(world, tex, heightUniforms);
  scene.add(props.group);
  const particles = new Particles(world);
  scene.add(particles.group);
  const creatures = new Creatures(world);
  scene.add(creatures.group);

  ui.showLoading('Будим белку…', 0.96);
  await nextFrame();
  const squirrel = new Squirrel();
  scene.add(squirrel.root);
  const player = new Player(world, squirrel, camera, canvas);
  const startX = world.trailX(HOME_Z), startZ = HOME_Z + 6;
  player.teleport(startX, startZ);
  player.yaw = Math.PI; // смотрим вперёд по маршруту (+Z)
  player.camYaw = Math.PI;

  // ---------------------------------------------------------------- Постобработка
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.6, 0.92);
  composer.addPass(bloom);
  const finalPass = new ShaderPass(FINAL_SHADER);
  composer.addPass(finalPass);
  composer.addPass(new OutputPass());

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  let envRT = null;
  let lastEnvElev = -999;
  const updateEnvironment = (force = false) => {
    const tod = state.tod;
    if (!force && Math.abs(tod.elev - lastEnvElev) < 1.5) return;
    lastEnvElev = tod.elev;
    sky.uniforms.uEnvPass.value = 1;
    const rt = pmrem.fromScene(sky.envScene, 0.04, 1, 100);
    sky.uniforms.uEnvPass.value = 0;
    if (envRT) envRT.dispose();
    envRT = rt;
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.9;
  };

  const resize = () => {
    const W = window.innerWidth || 1280, H = window.innerHeight || 900;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H);
    composer.setPixelRatio(dpr);
    composer.setSize(W, H);
  };
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- Состояние игры
  const state = {
    time: 0, progress: 0, maxZ: startZ, night: 0, finale: false,
    acorns: 0, golden: 0, region: null, tod: null, paused: false, started: false,
    fps: 60, frames: 0, fpsTime: 0,
  };
  const audio = new Audio();
  const saved = (() => { try { return JSON.parse(localStorage.getItem('squirrel-journey') || 'null'); } catch { return null; } })();

  const setTimeOfDay = () => {
    const progress = THREE.MathUtils.clamp((state.maxZ - HOME_Z) / (SUMMIT_Z - HOME_Z), 0, 1);
    state.progress = progress;
    const tod = timeOfDay(progress, state.night);
    state.tod = tod;
    sky.uniforms.uSunDir.value.copy(tod.sun);
    sky.uniforms.uNight.value = state.night;
    sky.uniforms.uAurora.value = state.night;
    sky.uniforms.uCloud.value = THREE.MathUtils.lerp(0.55, 0.25, progress);
    sun.color.copy(tod.sunColor);
    sun.intensity = tod.sunIntensity;
    hemi.color.copy(tod.ambientSky);
    hemi.groundColor.copy(tod.ambientGround);
    hemi.intensity = THREE.MathUtils.lerp(0.35, 0.5, tod.day) + 0.25 * state.night;
    hemi.color.lerp(new THREE.Color(0.35, 0.45, 0.8), state.night * 0.8);
    moon.intensity = 1.1 * state.night;
    moon.position.copy(player.pos).add(new THREE.Vector3(-60, 100, -40));
    moon.target.position.copy(player.pos);
    moon.target.updateMatrixWorld();
    scene.fog.color.copy(tod.fog);
    scene.fog.density = THREE.MathUtils.lerp(0.0022, 0.0034, 1 - tod.day) * (1 - 0.35 * progress);
    renderer.toneMappingExposure = THREE.MathUtils.lerp(0.95, 1.15, tod.day);
    scene.environmentIntensity = THREE.MathUtils.lerp(0.3, 0.65, tod.day);
  };

  // ---------------------------------------------------------------- Сбор предметов
  // лакомства и кормление зверушек
  const feeding = () => {
    const p = player.pos;
    const got = creatures.collectNear(p.x, p.y + 0.1, p.z, 0.7);
    for (const t of got) { ui.toast(`${t.icon} Нашла ${t.name}`); audio.pickup(); }
    if (got.length) ui.setInventory(creatures.inventory, TREATS);
    const a = creatures.nearestAnimal(p.x, p.z, 1.8);
    state.nearAnimal = a;
    if (a && !a.fed) {
      const has = creatures.inventory[a.def.wants] > 0;
      ui.animalHint = has ? `E — угостить: ${a.def.name} хочет ${a.want.name} ${a.want.icon}` : `${a.def.name} хочет ${a.want.name} ${a.want.icon} — поищи в лесу`;
      if (has && player.interact) {
        player.interact = false;
        if (creatures.feed(a)) {
          ui.setInventory(creatures.inventory, TREATS);
          ui.setFed(creatures.fedCount(), creatures.totalAnimals);
          ui.toast(a.def.thanks);
          audio.golden();
        }
      }
    } else ui.animalHint = '';
  };

  const collect = () => {
    const p = player.pos;
    const picked = props.collectNear(p.x, p.y + 0.15, p.z, 0.55);
    if (picked.acorns) { state.acorns += picked.acorns; audio.pickup(); ui.setAcorns(state.acorns, props.totalAcorns); }
    if (picked.golden) { state.golden += picked.golden; audio.golden(); ui.setGolden(state.golden, props.totalGolden); ui.toast('Золотой жёлудь!'); }
  };

  const updateRegion = () => {
    const r = world.regionAt(player.pos.z);
    if (r !== state.region) {
      state.region = r;
      ui.showRegion(r.name, r.sub);
      audio.setRegion(r.id);
    }
  };

  const checkFinale = () => {
    if (state.finale) return;
    const sx = world.trailX(SUMMIT_Z);
    if (Math.hypot(player.pos.x - sx, player.pos.z - (SUMMIT_Z + 6)) < 9) {
      state.finale = true;
      ui.showFinale(state.acorns, props.totalAcorns, state.golden, props.totalGolden, creatures.fedCount(), creatures.totalAnimals);
      audio.finale();
    }
  };

  const save = () => {
    try { localStorage.setItem('squirrel-journey', JSON.stringify({ x: player.pos.x, z: player.pos.z, maxZ: state.maxZ, acorns: state.acorns, golden: state.golden, collected: props.collectedIds(), creatures: creatures.saveState() })); } catch {}
  };

  // ---------------------------------------------------------------- Цикл
  const clock = new THREE.Clock();
  const shadowTarget = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  let saveTimer = 0;

  renderer.info.autoReset = false;
  const perf = { update: 0, render: 0, calls: 0, tris: 0 };
  state.perf = perf;
  const frame = () => {
    requestAnimationFrame(frame);
    tick(clock.getDelta());
  };
  const tick = (rawDt) => {
    const tFrame0 = performance.now();
    renderer.info.reset();
    const dt = Math.min(rawDt, 1 / 20);
    state.time += dt;
    // адаптивное разрешение
    state.frames++; state.fpsTime += rawDt;
    if (state.fpsTime > 2) {
      state.fps = state.frames / state.fpsTime; state.frames = 0; state.fpsTime = 0;
      if (state.fps < 38 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); resize(); }
      else if (state.fps > 57 && dpr < Math.min(baseDPR, 1.5)) { dpr = Math.min(Math.min(baseDPR, 1.5), dpr + 0.25); resize(); }
    }
    if (state.started && !state.paused) {
      feeding();
      player.update(dt, state.time);
      state.maxZ = Math.max(state.maxZ, player.pos.z);
      collect();
      updateRegion();
      checkFinale();
      if (state.finale) state.night = Math.min(1, state.night + dt * 0.08);
      saveTimer += dt; if (saveTimer > 5) { saveTimer = 0; save(); }
    } else {
      player.updateIdle(dt, state.time);
    }
    setTimeOfDay();
    updateEnvironment();
    // тени следуют за игроком, привязка к текселям против мерцания
    camera.getWorldDirection(camDir);
    shadowTarget.copy(player.pos).addScaledVector(camDir, 18);
    const texel = (SHADOW_R * 2) / 4096 * 4;
    shadowTarget.x = Math.round(shadowTarget.x / texel) * texel;
    shadowTarget.z = Math.round(shadowTarget.z / texel) * texel;
    sun.target.position.copy(shadowTarget);
    sun.position.copy(shadowTarget).addScaledVector(state.tod.sun, 220);
    sun.target.updateMatrixWorld();
    sky.mesh.position.copy(camera.position);
    sky.uniforms.uTime.value = state.time;
    water.userData.update(state.time);
    vegetation.update(camera, state.time, state.tod.sun);
    vegetation.setSun(state.tod.sunColor, state.tod.sunIntensity);
    grass.update(camera, player.pos, state.time);
    props.update(camera, state.time, dt);
    particles.update(camera, player.pos, state.time, dt, state.region ? state.region.id : 0, state.night);
    creatures.update(dt, state.time, player.pos);
    audio.update(dt, player, world, state);
    finalPass.uniforms.uTime.value = state.time;
    finalPass.uniforms.uFade.value = ui.fade;
    ui.updateHUD(state, player, world);
    const tRender0 = performance.now();
    composer.render();
    perf.update = perf.update * 0.9 + (tRender0 - tFrame0) * 0.1;
    perf.render = perf.render * 0.9 + (performance.now() - tRender0) * 0.1;
    perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;
  };

  setTimeOfDay();
  updateEnvironment(true);
  ui.showLoading('Готово', 1);
  await nextFrame();
  const tC0 = performance.now();
  renderer.compile(scene, camera);
  ui.hideLoading();
  ui.showTitle({
    hasSave: !!saved,
    onStart: (continueGame) => {
      if (continueGame && saved) {
        player.teleport(saved.x, saved.z);
        state.maxZ = saved.maxZ; state.acorns = saved.acorns; state.golden = saved.golden;
        props.restoreCollected(saved.collected || []);
        creatures.restoreState(saved.creatures);
        ui.setAcorns(state.acorns, props.totalAcorns); ui.setGolden(state.golden, props.totalGolden);
      } else {
        props.restoreCollected([]);
        creatures.restoreState(null);
        ui.setAcorns(0, props.totalAcorns); ui.setGolden(0, props.totalGolden);
      }
      ui.setInventory(creatures.inventory, TREATS);
      ui.setFed(creatures.fedCount(), creatures.totalAnimals);
      state.started = true;
      audio.start();
      player.lockPointer();
    },
  });
  ui.onPause = (p) => { state.paused = p; };
  player.onPointerUnlock = () => { if (state.started && !state.finale) ui.showPause(); };
  ui.onResume = () => { player.lockPointer(); };
  ui.onRestart = () => { try { localStorage.removeItem('squirrel-journey'); } catch {} location.reload(); };
  ui.onToggleAudio = () => audio.toggle();

  frame();
  window.__game = {
    world, player, state, scene, camera, renderer, props, vegetation, ui, sun, hemi, creatures,
    setNight: (n) => { state.night = n; },
    step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); },
    shot: (name) => new Promise((resolve) => { tick(1 / 60); canvas.toBlob((b) => fetch('/__shot?name=' + name, { method: 'POST', body: b }).then(() => resolve('saved ' + name))); }),
  };
}
