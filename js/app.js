import { UI, LANGS } from './i18n.js';
import { unlockAudio, sounds, loadClips, playClip } from './audio.js';

// ---------- constants ----------
const READY_SECONDS = 5;          // lead-in before the first exercise (not scaled)
const BACK_RESTART_AFTER = 3;     // "back" restarts the current exercise if more than this many seconds in
const MIN_STEP_SECONDS = 5;       // scaled intervals never drop below this
const SCALE_MIN = 50, SCALE_MAX = 150, SCALE_STEP = 5;
const RING_C = 2 * Math.PI * 46;  // circumference of the SVG ring (r = 46)
const ACCENTS = ['#e5483a', '#2f9e6b', '#3a7be5', '#d98a1c', '#9b51e0', '#d6457f'];
const STORE_KEY = 'fittomato.settings.v1';

// ---------- state ----------
const app = document.getElementById('app');
let DATA = null;                          // workouts.json
let VOICE = { start: [], half: [], last10: [], end: [] };
let settings = loadSettings();
let P = null;                             // running player, see startPlayer()
let wakeLock = null;

// ---------- helpers ----------
function loadSettings() {
  const defaults = {
    lang: (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en',
    scale: 100,
    voice: true,
  };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; }
  catch { return defaults; }
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
}
const t = (key) => UI[settings.lang][key] ?? UI.en[key] ?? key;
/** Pick the current language out of a {en, de} object (plain strings pass through). */
const tx = (v) => (v && typeof v === 'object') ? (v[settings.lang] ?? v.en ?? Object.values(v)[0]) : (v ?? '');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => performance.now() / 1000;
function fmt(sec) {
  sec = Math.max(0, Math.ceil(sec));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
const voiceClipCount = () => Object.values(VOICE).reduce((n, a) => n + a.length, 0);

function buildPlan(workout, scalePct) {
  return workout.steps.map((s) => ({
    id: s.exercise,
    ex: DATA.exercises[s.exercise] || { name: s.exercise },
    // Not rounded per step, so 75% of 12:00 is exactly 9:00 (rounding 22.5 s up to 23 s 24 times would give 9:12).
    duration: Math.max(MIN_STEP_SECONDS, s.duration * scalePct / 100),
  }));
}
const fmtStep = (d) => `${+d.toFixed(1)}s`;
const planTotal = (plan) => plan.reduce((n, s) => n + s.duration, 0);

function langSwitch() {
  return `<div class="lang" role="group" aria-label="Language">${LANGS.map((l) =>
    `<button data-lang="${l}" aria-pressed="${l === settings.lang}">${l.toUpperCase()}</button>`).join('')}</div>`;
}
function bindLangSwitch(rerender) {
  app.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    settings.lang = b.dataset.lang; saveSettings(); rerender();
  }));
}

/** Show the exercise picture, or a placeholder with the description until a picture exists. */
function setMedia(container, step) {
  const placeholder = () => {
    container.innerHTML = `<div class="placeholder"><span>${esc(tx(step.ex.description) || tx(step.ex.name))}</span></div>`;
  };
  if (!step.ex.media) return placeholder();
  const isVideo = /\.(webm|mp4)$/i.test(step.ex.media);
  const el = document.createElement(isVideo ? 'video' : 'img');
  if (isVideo) Object.assign(el, { autoplay: true, loop: true, muted: true, playsInline: true });
  else el.alt = '';
  // Only fall back if this element is still the one on screen (the user may have skipped on).
  el.addEventListener('error', () => { if (el.isConnected) placeholder(); });
  el.src = step.ex.media;
  container.replaceChildren(el);
}

// ---------- routing ----------
function route() {
  if (P) stopPlayer();
  const m = location.hash.match(/^#\/w\/([\w-]+)/);
  if (m) showOverview(m[1]); else showHome();
  window.scrollTo(0, 0);
}

// ---------- home ----------
function showHome() {
  document.documentElement.lang = settings.lang;
  const groups = {};
  for (const w of DATA.workouts) (groups[w.category] ||= []).push(w);

  app.className = 'view home';
  app.innerHTML = `
    <header class="top">
      <h1><span aria-hidden="true">🍅</span> fit tomato</h1>
      ${langSwitch()}
    </header>
    <p class="tagline">${esc(t('tagline'))}</p>
    ${Object.entries(groups).map(([cat, list]) => `
      <section>
        <h2 class="cat">${esc(tx(DATA.categories?.[cat]) || cat)}</h2>
        <ul class="cards">
          ${list.map((w) => {
            const plan = buildPlan(w, settings.scale);
            return `<li><a class="card" href="#/w/${esc(w.id)}">
              <span class="card-title">${esc(tx(w.name))}</span>
              <span class="card-meta">${fmt(planTotal(plan))} · ${plan.length} ${esc(t('exercises'))}${w.author ? ` · ${esc(w.author)}` : ''}</span>
            </a></li>`;
          }).join('')}
        </ul>
      </section>`).join('')}
  `;
  bindLangSwitch(showHome);
}

// ---------- overview ----------
function showOverview(id) {
  document.documentElement.lang = settings.lang;
  const w = DATA.workouts.find((x) => x.id === id);
  if (!w) { app.className = 'view'; app.innerHTML = `<p>${esc(t('notFound'))}</p><p><a href="#/">${esc(t('back'))}</a></p>`; return; }

  const hasVoice = voiceClipCount() > 0;
  const render = () => {
    const plan = buildPlan(w, settings.scale);
    app.className = 'view overview';
    app.innerHTML = `
      <header class="top">
        <a class="backlink" href="#/">← ${esc(t('back'))}</a>
        ${langSwitch()}
      </header>
      <h1>${esc(tx(w.name))}</h1>
      <p class="meta">
        ${esc(tx(DATA.categories?.[w.category]) || w.category)} · ${plan.length} ${esc(t('exercises'))}
        ${w.credit ? `<br>${esc(t('credit'))} ${esc(w.credit)}` : ''}
        ${w.author ? ` · ${esc(t('by'))} ${esc(w.author)}` : ''}
      </p>

      <div class="settings">
        <label class="row">
          <span>${esc(t('length'))}</span>
          <output id="total">${fmt(planTotal(plan))} <small>(${settings.scale}%)</small></output>
        </label>
        <input id="scale" type="range" min="${SCALE_MIN}" max="${SCALE_MAX}" step="${SCALE_STEP}" value="${settings.scale}" aria-label="${esc(t('length'))}">
        <label class="row toggle ${hasVoice ? '' : 'disabled'}">
          <span>${esc(t('voice'))}${hasVoice ? '' : ` <small>(${esc(t('voiceNone'))})</small>`}</span>
          <input id="voice" type="checkbox" ${settings.voice && hasVoice ? 'checked' : ''} ${hasVoice ? '' : 'disabled'}>
        </label>
      </div>

      <ol class="steps">
        ${plan.map((s) => `<li><span>${esc(tx(s.ex.name))}</span><span class="dur">${fmtStep(s.duration)}</span></li>`).join('')}
      </ol>

      <div class="start-bar"><button id="start" class="btn-start">${esc(t('start'))}</button></div>
    `;
    bindLangSwitch(render);

    const scaleEl = app.querySelector('#scale');
    scaleEl.addEventListener('input', () => {
      settings.scale = Number(scaleEl.value); saveSettings();
      const p = buildPlan(w, settings.scale);
      app.querySelector('#total').innerHTML = `${fmt(planTotal(p))} <small>(${settings.scale}%)</small>`;
      app.querySelectorAll('.steps .dur').forEach((el, i) => { el.textContent = fmtStep(p[i].duration); });
    });
    app.querySelector('#voice').addEventListener('change', (e) => { settings.voice = e.target.checked; saveSettings(); });
    app.querySelector('#start').addEventListener('click', () => {
      unlockAudio();   // must happen inside the tap (iOS)
      startPlayer(w, buildPlan(w, settings.scale));
    });
  };
  render();
}

// ---------- player ----------
function startPlayer(workout, plan) {
  const offsets = [];  // seconds of workout elapsed before each step
  plan.reduce((acc, s, i) => (offsets[i] = acc, acc + s.duration), 0);

  P = {
    workout, plan, offsets,
    total: planTotal(plan),
    phase: 'ready',            // 'ready' -> 'work' -> 'done'
    index: 0,
    segStart: now(),
    pausedAt: null,
    lastTick: null,
    fired: new Set(),          // voice moments already played
    voiceOn: settings.voice && voiceClipCount() > 0,
    raf: 0, interval: 0,
  };
  if (P.voiceOn) loadClips(Object.values(VOICE).flat());

  renderPlayerShell();
  enterStep();
  requestWake();

  const loop = () => { tick(); P && (P.raf = requestAnimationFrame(loop)); };
  P.raf = requestAnimationFrame(loop);
  P.interval = setInterval(tick, 250);   // keeps time moving when rAF is throttled
}

function stopPlayer() {
  if (!P) return;
  cancelAnimationFrame(P.raf);
  clearInterval(P.interval);
  P = null;
  releaseWake();
  document.body.classList.remove('playing');
}

const segDuration = () => (P.phase === 'ready' ? READY_SECONDS : P.plan[P.index].duration);
const segElapsed = () => (P.pausedAt ?? now()) - P.segStart;
function workoutElapsed() {
  if (P.phase === 'ready') return 0;
  if (P.phase === 'done') return P.total;
  return P.offsets[P.index] + Math.min(segElapsed(), segDuration());
}

function setSegment(phase, index) {
  P.phase = phase;
  P.index = index;
  P.segStart = now();
  if (P.pausedAt != null) P.pausedAt = P.segStart;
  P.lastTick = null;
  enterStep();
}

function tick() {
  if (!P || P.pausedAt != null || P.phase === 'done') return;

  // Advance through as many segments as have passed (catches up after the tab was in the background).
  let el = segElapsed();
  while (el >= segDuration()) {
    const end = P.segStart + segDuration();
    if (P.phase === 'ready') { P.phase = 'work'; P.index = 0; }
    else if (P.index < P.plan.length - 1) { P.index++; }
    else { finish(); return; }
    P.segStart = end;
    P.lastTick = null;
    enterStep();
    el = segElapsed();
  }

  if (P.phase === 'ready') {
    const left = Math.ceil(READY_SECONDS - el);
    if (left <= 3 && left !== P.lastTick) { P.lastTick = left; sounds.tick(); }
  } else {
    const done = workoutElapsed();
    if (done >= P.total / 2) voiceMoment('half');
    if (P.total > 20 && P.total - done <= 10) voiceMoment('last10');
  }
  renderPlayerFrame();
}

function voiceMoment(name) {
  if (!P.voiceOn || P.fired.has(name)) return;
  P.fired.add(name);
  const list = VOICE[name] || [];
  if (list.length) playClip(list[Math.floor(Math.random() * list.length)]);
}

function finish() {
  P.phase = 'done';
  sounds.finish();
  voiceMoment('end');
  const { workout, total } = P;
  stopPlayer();
  showDone(workout, total);
}

// player controls
function togglePause() {
  if (P.pausedAt == null) P.pausedAt = now();
  else { P.segStart += now() - P.pausedAt; P.pausedAt = null; }
  renderPlayerFrame();
}
function skip() {
  if (P.phase === 'ready') setSegment('work', 0);
  else if (P.index < P.plan.length - 1) setSegment('work', P.index + 1);
  else finish();
}
function back() {
  if (P.phase === 'ready') setSegment('ready', 0);
  else if (segElapsed() > BACK_RESTART_AFTER || P.index === 0) setSegment('work', P.index);
  else setSegment('work', P.index - 1);
}
function exitPlayer() {
  if (!confirm(t('quit'))) return;
  const id = P.workout.id;
  stopPlayer();
  showOverview(id);
}

function renderPlayerShell() {
  document.body.classList.add('playing');
  app.className = 'view player';
  app.innerHTML = `
    <header class="ptop">
      <button class="icon" id="exit" aria-label="${esc(t('ctlExit'))}">✕</button>
      <span class="counter" id="counter"></span>
      <span class="total" id="total"></span>
    </header>
    <div class="pmain">
      <p class="ready-label" id="readyLabel"></p>
      <h1 class="ex-name" id="exName"></h1>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ring-track" cx="50" cy="50" r="46"/>
          <circle class="ring-bar" id="ringBar" cx="50" cy="50" r="46" stroke-dasharray="${RING_C}" stroke-dashoffset="0"/>
        </svg>
        <div class="media" id="media"></div>
        <div class="secs" id="secs"></div>
      </div>
      <p class="paused-label" id="pausedLabel">${esc(t('paused'))}</p>
    </div>
    <nav class="controls">
      <button class="icon" id="back" aria-label="${esc(t('ctlBack'))}">⏮</button>
      <button class="icon big" id="pause" aria-label="${esc(t('ctlPause'))}">⏸</button>
      <button class="icon" id="skip" aria-label="${esc(t('ctlSkip'))}">⏭</button>
    </nav>
  `;
  app.querySelector('#exit').addEventListener('click', exitPlayer);
  app.querySelector('#pause').addEventListener('click', togglePause);
  app.querySelector('#skip').addEventListener('click', skip);
  app.querySelector('#back').addEventListener('click', back);
}

/** Called whenever a new segment begins: swap name + picture, beep, flash. */
function enterStep() {
  const step = P.plan[P.index];
  const ready = P.phase === 'ready';
  app.querySelector('#readyLabel').textContent = ready ? `${t('getReady')} · ${t('first')}:` : '';
  app.querySelector('#exName').textContent = tx(step.ex.name);
  setMedia(app.querySelector('#media'), step);
  app.style.setProperty('--ex-accent', ready ? 'var(--muted)' : ACCENTS[P.index % ACCENTS.length]);
  app.classList.toggle('is-ready', ready);

  // preload the next picture
  const next = P.plan[ready ? 0 : P.index + 1];
  if (next?.ex.media && !/\.(webm|mp4)$/i.test(next.ex.media)) new Image().src = next.ex.media;

  if (!ready) {
    sounds.change();
    if (P.index === 0) voiceMoment('start');
    app.classList.remove('flash');
    void app.offsetWidth;          // restart the CSS animation
    app.classList.add('flash');
  }
  renderPlayerFrame();
}

function renderPlayerFrame() {
  if (!P) return;
  const dur = segDuration();
  const left = Math.max(0, dur - segElapsed());
  app.querySelector('#ringBar').setAttribute('stroke-dashoffset', String(RING_C * (1 - left / dur)));
  app.querySelector('#secs').textContent = Math.ceil(left);
  app.querySelector('#total').textContent = `${fmt(P.total - workoutElapsed())} ${t('left')}`;
  app.querySelector('#counter').textContent = P.phase === 'ready' ? '' : `${P.index + 1} / ${P.plan.length}`;
  const paused = P.pausedAt != null;
  app.classList.toggle('is-paused', paused);
  const pb = app.querySelector('#pause');
  pb.textContent = paused ? '▶' : '⏸';
  pb.setAttribute('aria-label', t(paused ? 'ctlPlay' : 'ctlPause'));
}

// ---------- done ----------
function showDone(workout, total) {
  app.className = 'view done';
  app.innerHTML = `
    <div class="done-box">
      <div class="big-tomato" aria-hidden="true">🍅</div>
      <h1>${esc(t('done'))}</h1>
      <p>${esc(t('doneText').replace('{name}', tx(workout.name)).replace('{time}', fmt(total)))}</p>
      <p class="done-actions">
        <a class="btn-secondary" href="#/w/${esc(workout.id)}" id="again">${esc(t('again'))}</a>
        <a class="btn-secondary" href="#/">${esc(t('back'))}</a>
      </p>
    </div>`;
  // hash is already #/w/<id>, so "again" would not trigger hashchange
  app.querySelector('#again').addEventListener('click', (e) => { e.preventDefault(); showOverview(workout.id); });
}

// ---------- wake lock ----------
async function requestWake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch { /* not supported or denied: nothing to do */ }
}
function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (P && document.visibilityState === 'visible') requestWake();  // the lock is dropped when the tab is hidden
});

// keyboard shortcuts for desktop
document.addEventListener('keydown', (e) => {
  if (!P) return;
  if (e.code === 'Space') { e.preventDefault(); togglePause(); }
  else if (e.code === 'ArrowRight') skip();
  else if (e.code === 'ArrowLeft') back();
  else if (e.code === 'Escape') exitPlayer();
});

// ---------- boot ----------
async function boot() {
  try {
    const r = await fetch('workouts.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch {
    app.innerHTML = `<p class="error">${esc(t('loadError'))}</p>`;
    return;
  }
  try {
    const r = await fetch('audio/voice.json', { cache: 'no-cache' });
    if (r.ok) VOICE = { ...VOICE, ...(await r.json()) };
  } catch { /* voice is optional */ }

  window.addEventListener('hashchange', route);
  route();
}
boot();
