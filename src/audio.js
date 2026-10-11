// Процедурный звук на WebAudio: ветер, птицы, река, шаги, сбор желудей.
export class Audio {
  constructor() {
    this.ctx = null; this.enabled = true; this.region = 0; this.birdTimer = 2;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const ctx = this.ctx;
    this.master = ctx.createGain(); this.master.gain.value = 0.7; this.master.connect(ctx.destination);
    // шумовой буфер
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
    }
    this.noise = buf;
    const mkNoise = (freq, q, gain, type = 'lowpass') => {
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { src, f, g };
    };
    this.wind = mkNoise(420, 0.7, 0.25);
    this.river = mkNoise(900, 0.5, 0.0, 'bandpass');
    this.riverLow = mkNoise(200, 0.8, 0.0);
    this.windLfo = 0;
    this.stepGain = ctx.createGain(); this.stepGain.gain.value = 0.5; this.stepGain.connect(this.master);
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.setTargetAtTime(this.enabled ? 0.7 : 0, this.ctx.currentTime, 0.1);
  }

  setRegion(id) { this.region = id; }

  tone(freq, dur, gain = 0.2, type = 'sine', slide = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }

  burst(freq, dur, gain, type = 'highpass') {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.stepGain); src.start(t, Math.random() * 2); src.stop(t + dur + 0.02);
  }

  pickup() { this.tone(880, 0.18, 0.12); setTimeout(() => this.tone(1320, 0.25, 0.1), 70); }
  golden() { [660, 880, 1100, 1320, 1760].forEach((f, i) => setTimeout(() => this.tone(f, 0.35, 0.1, 'triangle'), i * 80)); }
  jump() { this.burst(600, 0.18, 0.15, 'bandpass'); }
  land(hard) { this.burst(hard ? 300 : 500, hard ? 0.2 : 0.08, hard ? 0.35 : 0.18, 'lowpass'); }
  step(speed, water) { this.burst(water ? 500 : 1400, water ? 0.12 : 0.05, Math.min(0.2, 0.06 + speed * 0.012), water ? 'bandpass' : 'highpass'); }
  splash() { this.burst(700, 0.35, 0.3, 'bandpass'); }
  finale() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 2.5, 0.06, 'sine'), i * 350)); }

  bird() {
    if (!this.ctx || !this.enabled) return;
    const base = 1800 + Math.random() * 1500;
    const n = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) setTimeout(() => this.tone(base * (1 + (Math.random() - 0.5) * 0.2), 0.12, 0.03, 'sine', 1.3 + Math.random() * 0.4), i * (90 + Math.random() * 60));
  }

  update(dt, player, world, state) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // ветер сильнее в горах
    this.windLfo += dt;
    const alt = Math.min(1, Math.max(0, (player.pos.y - 20) / 150));
    const windBase = 0.12 + alt * 0.35 + (player.state === 'glide' ? 0.3 : 0);
    const lfo = 0.7 + 0.3 * Math.sin(this.windLfo * 0.35) * Math.sin(this.windLfo * 0.11 + 1);
    this.wind.g.gain.setTargetAtTime(windBase * lfo, t, 0.5);
    this.wind.f.frequency.setTargetAtTime(300 + alt * 500 + lfo * 200, t, 0.5);
    // река
    const d = Math.abs(player.pos.z - world.riverZ(player.pos.x));
    const rv = Math.max(0, 1 - d / 70);
    this.river.g.gain.setTargetAtTime(rv * rv * 0.35, t, 0.3);
    this.riverLow.g.gain.setTargetAtTime(rv * rv * 0.25, t, 0.3);
    // птицы днём в лесу и на лугу
    this.birdTimer -= dt;
    if (this.birdTimer < 0) {
      this.birdTimer = 1.5 + Math.random() * 6;
      if (this.region <= 2 && state.night < 0.3 && Math.random() < 0.75) this.bird();
      if (this.region === 3 && Math.random() < 0.3) this.bird();
    }
    for (const e of player.takeEvents()) {
      if (e === 'jump') this.jump();
      else if (e === 'land') this.land(false);
      else if (e === 'landHard') this.land(true);
      else if (e === 'step') this.step(player.speed, false);
      else if (e === 'splash') this.splash();
      else if (e === 'climb') this.burst(900, 0.1, 0.12);
    }
  }
}
