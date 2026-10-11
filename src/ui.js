// Интерфейс: загрузка, титульный экран, HUD, пауза, финал.
import { REGIONS, HOME_Z, SUMMIT_Z } from './world.js';

const html = String.raw;

export class UI {
  constructor() {
    this.root = document.getElementById('ui');
    this.root.innerHTML = html`
      <div id="loading" class="screen">
        <div class="title">Белка‑путешественница</div>
        <div class="sub" id="loading-label">Просыпаемся…</div>
        <div class="bar"><div id="loading-fill"></div></div>
      </div>
      <div id="title" class="screen hidden">
        <div class="panel">
          <div class="title">Белка‑путешественница</div>
          <div class="tagline">Белка‑летяга и один день пути — от родного дуба до Древнего кедра на снежной вершине</div>
          <div class="buttons">
            <button id="btn-start">Начать путешествие</button>
            <button id="btn-continue" class="hidden">Продолжить</button>
          </div>
          <div class="controls">
            <div><b>W A S D</b> — бег &nbsp;·&nbsp; <b>Shift</b> — спринт &nbsp;·&nbsp; <b>Пробел</b> — прыжок, удерживать в воздухе — расправить перепонку и планировать</div>
            <div><b>Мышь</b> — камера &nbsp;·&nbsp; <b>Колесо</b> — приближение &nbsp;·&nbsp; беги в ствол или <b>E</b> — карабкаться по дереву</div>
            <div>На стволе: <b>W/S</b> — вверх/вниз, <b>A/D</b> — вокруг, <b>Пробел</b> — спрыгнуть &nbsp;·&nbsp; <b>M</b> — звук &nbsp;·&nbsp; <b>Esc</b> — пауза</div>
          </div>
        </div>
      </div>
      <div id="pause" class="screen hidden">
        <div class="panel">
          <div class="title small">Пауза</div>
          <div class="buttons">
            <button id="btn-resume">Продолжить</button>
            <button id="btn-audio">Звук вкл/выкл</button>
            <button id="btn-restart" class="secondary">Начать заново</button>
          </div>
        </div>
      </div>
      <div id="finale" class="screen hidden">
        <div class="panel">
          <div class="title small">Древний кедр</div>
          <div class="tagline" id="finale-text"></div>
          <div class="buttons"><button id="btn-finale-continue">Остаться под звёздами</button></div>
        </div>
      </div>
      <div id="hud" class="hidden">
        <div id="counters">
          <div class="counter"><span class="icon acorn"></span><span id="acorn-count">0</span><span class="dim" id="acorn-total"></span></div>
          <div class="counter"><span class="icon golden"></span><span id="golden-count">0</span><span class="dim" id="golden-total"></span></div>
        </div>
        <div id="region"><div id="region-name"></div><div id="region-sub"></div></div>
        <div id="toast"></div>
        <div id="hint"></div>
        <div id="progress"><div id="progress-fill"></div><div id="progress-marks"></div><div id="progress-squirrel"></div></div>
      </div>
    `;
    this.$ = (id) => document.getElementById(id);
    this.fade = 0;
    this.fadeTarget = 0;
    this.regionTimer = 0;
    this.toastTimer = 0;
    this.paused = false;
    this.lastHint = '';
    // метки регионов на шкале прогресса
    const marks = this.$('progress-marks');
    for (const r of REGIONS) {
      const m = document.createElement('div');
      m.className = 'mark';
      m.style.left = `${((Math.max(r.z0, HOME_Z) - HOME_Z) / (SUMMIT_Z - HOME_Z)) * 100}%`;
      m.title = r.name;
      marks.appendChild(m);
    }
    this.$('btn-resume').onclick = () => this.hidePause();
    this.$('btn-restart').onclick = () => this.onRestart?.();
    this.$('btn-audio').onclick = () => this.onToggleAudio?.();
    this.$('btn-finale-continue').onclick = () => { this.$('finale').classList.add('hidden'); this.onResume?.(); };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.started) {
        // при захвате курсора паузу вызовет pointerlockchange; иначе — переключаем вручную
        if (this.paused) { if (performance.now() - this.pausedAt > 300) this.hidePause(); }
        else if (document.pointerLockElement == null) this.showPause();
      }
      if (e.code === 'KeyM') this.onToggleAudio?.();
    });
  }

  showLoading(label, p) {
    this.$('loading-label').textContent = label;
    this.$('loading-fill').style.width = `${Math.round(p * 100)}%`;
  }
  hideLoading() { this.$('loading').classList.add('hidden'); }

  showTitle({ hasSave, onStart }) {
    this.$('title').classList.remove('hidden');
    const cont = this.$('btn-continue');
    if (hasSave) cont.classList.remove('hidden');
    const begin = (c) => {
      this.$('title').classList.add('hidden');
      this.$('hud').classList.remove('hidden');
      this.started = true;
      this.fadeTarget = 1;
      onStart(c);
    };
    this.$('btn-start').onclick = () => begin(false);
    cont.onclick = () => begin(true);
    this.fade = 0.15;
    this.fadeTarget = 0.85;
  }

  showPause() { if (this.paused) return; this.paused = true; this.pausedAt = performance.now(); this.$('pause').classList.remove('hidden'); this.onPause?.(true); }
  hidePause() { this.paused = false; this.$('pause').classList.add('hidden'); this.onPause?.(false); this.onResume?.(); }

  showRegion(name, sub) {
    this.$('region-name').textContent = name;
    this.$('region-sub').textContent = sub;
    this.$('region').classList.add('show');
    this.regionTimer = 4.5;
  }

  toast(text) {
    this.$('toast').textContent = text;
    this.$('toast').classList.add('show');
    this.toastTimer = 2.2;
  }

  setAcorns(n, total) { this.$('acorn-count').textContent = n; this.$('acorn-total').textContent = `/ ${total}`; }
  setGolden(n, total) { this.$('golden-count').textContent = n; this.$('golden-total').textContent = `/ ${total}`; }

  showFinale(acorns, totalAcorns, golden, totalGolden) {
    this.$('finale-text').innerHTML = `Ты дошла до вершины. Солнце садится, зажигаются звёзды.<br>Собрано желудей: <b>${acorns} / ${totalAcorns}</b>, золотых: <b>${golden} / ${totalGolden}</b>.<br>${golden === totalGolden ? 'Все золотые жёлуди найдены — ты настоящая путешественница!' : 'Золотые жёлуди прячутся на макушках деревьев вдоль всей тропы.'}`;
    this.$('finale').classList.remove('hidden');
    try { document.exitPointerLock?.(); } catch {}
  }

  updateHUD(state, player, world) {
    const dt = 1 / 60;
    this.fade += (this.fadeTarget - this.fade) * 0.04;
    if (this.regionTimer > 0) { this.regionTimer -= dt; if (this.regionTimer <= 0) this.$('region').classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) this.$('toast').classList.remove('show'); }
    if (!this.started) return;
    const p = Math.max(0, Math.min(1, (player.pos.z - HOME_Z) / (SUMMIT_Z - HOME_Z)));
    this.$('progress-fill').style.width = `${state.progress * 100}%`;
    this.$('progress-squirrel').style.left = `${p * 100}%`;
    let hint = '';
    if (player.state === 'climb') hint = 'W/S — вверх и вниз · A/D — вокруг ствола · Пробел — спрыгнуть';
    else if (player.state === 'glide') hint = 'Планируем! Отпусти пробел, чтобы снизиться';
    else if (player.state === 'air') hint = 'Удерживай пробел, чтобы расправить перепонку и планировать';
    else if (player.state === 'swim') hint = 'Брр, холодно! Плыви к берегу';
    else if (player.nearTree) hint = 'Беги в ствол или нажми E, чтобы забраться на дерево';
    if (hint !== this.lastHint) { this.$('hint').textContent = hint; this.lastHint = hint; }
  }
}
