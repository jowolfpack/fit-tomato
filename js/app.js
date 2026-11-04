import { UI, LANGS } from './i18n.js';
import { unlockAudio, sounds, loadClips, playClip } from './audio.js';

// ---------- constants ----------
const READY_SECONDS = 5;          // lead-in before the first exercise (not scaled)
const TRACK_MAX_DRIFT = 0.4;      // s; the voice track is re-synced to the timer when it drifts further than this
const BACK_RESTART_AFTER = 3;    // "back" restarts the current exercise if more than this many seconds in
const MIN_STEP_SECONDS = 5;       // scaled intervals never drop below this
const SCALE_MIN = 50, SCALE_MAX = 150, SCALE_STEP = 5;
const FRAME_STROKE = 5;           // px, width of the countdown line around the picture
const FRAME_RADIUS = 22;          // px, corner radius of that line
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
    tracks: {},      // workout id -> chosen track src, or '' for Silentio (missing = first track)
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
/** The voice track chosen for this workout, or null for Silentio. */
function chosenTrack(w) {
  const list = w.tracks || [];
  const v = settings.tracks?.[w.id];
  if (v === '') return null;
  return list.find((tr) => tr.src === v) || list[0] || null;
}
function chooseTrack(w, track) {
  settings.tracks = { ...settings.tracks, [w.id]: track ? track.src : '' };
  saveSettings();
}

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

/** `media` in workouts.json is one path or a list of paths (shown stacked, e.g. two phases of a movement). */
const mediaList = (m) => (m == null ? [] : [].concat(m));
const isVideo = (src) => /\.(webm|mp4)$/i.test(src);

/** Show the picture(s), or a placeholder with `text` until a picture exists. */
function setMedia(container, media, text) {
  const list = mediaList(media);
  const stage = container.closest('.stage');
  const placeholder = () => {
    stage?.classList.remove('pair');
    container.innerHTML = `<div class="placeholder"><span>${esc(text)}</span></div>`;
  };
  stage?.classList.toggle('pair', list.length > 1);
  if (!list.length) return placeholder();
  const els = list.map((src) => {
    const el = document.createElement(isVideo(src) ? 'video' : 'img');
    if (isVideo(src)) Object.assign(el, { autoplay: true, loop: true, muted: true, playsInline: true });
    else el.alt = '';
    // Only fall back if this element is still the one on screen (the user may have skipped on).
    el.addEventListener('error', () => { if (el.isConnected) placeholder(); });
    el.src = src;
    return el;
  });
  container.replaceChildren(...els);
}

/** Rounded-rectangle path that starts at top-center and runs clockwise (so the countdown starts at 12 o'clock). */
function framePath(w, h) {
  const i = FRAME_STROKE / 2;
  const x0 = i, y0 = i, x1 = w - i, y1 = h - i;
  const r = Math.max(0, Math.min(FRAME_RADIUS, (x1 - x0) / 2, (y1 - y0) / 2));
  const a = (x, y) => `A${r},${r} 0 0 1 ${x},${y}`;
  return `M${w / 2},${y0} H${x1 - r} ${a(x1, y0 + r)} V${y1 - r} ${a(x1 - r, y1)} H${x0 + r} ${a(x0, y1 - r)} V${y0 + r} ${a(x0 + r, y0)} Z`;
}
function fitFrame(stage) {
  const { width: w, height: h } = stage.getBoundingClientRect();
  if (!w || !h) return;
  stage.querySelector('.frame').setAttribute('viewBox', `0 0 ${w} ${h}`);
  stage.querySelectorAll('.frame path').forEach((p) => p.setAttribute('d', framePath(w, h)));
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
        ${w.credit ? `<br>${esc(t('credit'))} ${w.source ? `<a href="${esc(w.source)}" target="_blank" rel="noopener">${esc(w.credit)} ↗</a>` : esc(w.credit)}` : ''}
        ${w.author ? ` · ${esc(t('by'))} ${esc(w.author)}` : ''}
      </p>

      <div class="settings">
        <label class="row">
          <span>${esc(t('length'))}</span>
          <output id="total">${fmt(planTotal(plan))} <small>(${settings.scale}%)</small></output>
        </label>
        <input id="scale" type="range" min="${SCALE_MIN}" max="${SCALE_MAX}" step="${SCALE_STEP}" value="${settings.scale}" aria-label="${esc(t('length'))}">
        ${w.tracks?.length ? `
        <div class="sound-choice" role="radiogroup">
          <label class="row toggle">
            <span>${esc(t('silent'))}</span>
            <input type="radio" name="sound" value="">
          </label>
          ${w.tracks.map((tr) => `
          <label class="row toggle">
            <span>${esc(tx(tr.title))}${tr.by ? ` <small>· ${esc(tr.by)}</small>` : ''}</span>
            <input type="radio" name="sound" value="${esc(tr.src)}">
          </label>`).join('')}
          <p class="track-note" id="trackNote" hidden>${esc(t('trackScale'))}</p>
        </div>` : hasVoice ? `
        <label class="row toggle">
          <span>${esc(t('voice'))}</span>
          <input id="voice" type="checkbox" ${settings.voice ? 'checked' : ''}>
        </label>` : ''}
      </div>

      <ol class="steps">
        ${plan.map((s) => `<li><span>${esc(tx(s.ex.name))}</span><span class="dur">${fmtStep(s.duration)}</span></li>`).join('')}
      </ol>

      <div class="start-bar"><button id="start" class="btn-start">${esc(t('start'))}</button></div>
    `;
    bindLangSwitch(render);

    // Voice tracks are recorded against the original timing, so they only fit at 100%.
    const updateTrack = () => {
      const radios = [...app.querySelectorAll('input[name="sound"]')];
      if (!radios.length) return;
      const fits = settings.scale === 100;
      const want = fits ? (chosenTrack(w)?.src ?? '') : '';
      for (const r of radios) {
        r.checked = r.value === want;
        if (r.value) { r.disabled = !fits; r.closest('label').classList.toggle('disabled', !fits); }
      }
      app.querySelector('#trackNote').hidden = fits;
    };
    updateTrack();

    const scaleEl = app.querySelector('#scale');
    scaleEl.addEventListener('input', () => {
      settings.scale = Number(scaleEl.value); saveSettings();
      const p = buildPlan(w, settings.scale);
      app.querySelector('#total').innerHTML = `${fmt(planTotal(p))} <small>(${settings.scale}%)</small>`;
      app.querySelectorAll('.steps .dur').forEach((el, i) => { el.textContent = fmtStep(p[i].duration); });
      updateTrack();
    });
    app.querySelector('#voice')?.addEventListener('change', (e) => { settings.voice = e.target.checked; saveSettings(); });
    app.querySelectorAll('input[name="sound"]').forEach((r) => r.addEventListener('change', () => {
      chooseTrack(w, w.tracks.find((tr) => tr.src === r.value));
    }));
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
    // A workout with its own track offers "Silentio or track", so the random clips never play there.
    voiceOn: settings.voice && voiceClipCount() > 0 && !workout.tracks?.length,
    // Voice tracks only fit the original timing, so they are offered at 100% length only.
    tracks: settings.scale === 100 ? (workout.tracks || []) : [],
    track: null,               // the chosen entry of `tracks`, null = Silentio
    audio: null,               // one <audio> element for all tracks, see useTrack() / syncTrack()
    raf: 0, interval: 0,
  };
  if (P.voiceOn) loadClips(Object.values(VOICE).flat());
  if (P.tracks.length) {
    // One element for the whole workout: once iOS has let it play (inside a tap), it keeps working after src changes.
    P.audio = new Audio();
    P.audio.preload = 'auto';
    // A seek made before the file was loaded can get lost, so line up again as soon as it is.
    P.audio.addEventListener('loadedmetadata', () => syncTrack(true));
  }

  renderPlayerShell();
  window.scrollTo(0, 0);   // the player is taller than the screen now; always start at the top
  enterStep();
  requestWake();

  const loop = () => { tick(); P && (P.raf = requestAnimationFrame(loop)); };
  P.raf = requestAnimationFrame(loop);
  P.interval = setInterval(tick, 250);   // keeps time moving when rAF is throttled
  if (P.audio) useTrack(P.tracks.includes(chosenTrack(workout)) ? chosenTrack(workout) : null);  // inside the START tap (iOS)
}

/** Switch the voice track (null = Silentio). Call from a tap, so iOS allows play(). */
function useTrack(track) {
  P.track = track;
  const a = P.audio;
  if (track) {
    const url = new URL(track.src, location.href).href;
    if (a.src !== url) { a.src = url; a.load(); }
    try {   // name on the phone's lock screen / media controls
      if ('mediaSession' in navigator && window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: tx(track.title), artist: track.by || 'fit tomato', album: tx(P.workout.name),
        });
      }
    } catch {}
  }
  syncTrack(true);
  renderTrackMenu();
}

function stopPlayer() {
  if (!P) return;
  cancelAnimationFrame(P.raf);
  clearInterval(P.interval);
  P.resize?.disconnect();
  if (P.audio) { P.audio.pause(); P.audio.removeAttribute('src'); P.audio.load(); }
  P = null;
  releaseWake();
  document.body.classList.remove('playing');
  window.scrollTo(0, 0);
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
  syncTrack(true);
}

/**
 * The timer is the master clock; the voice track follows it.
 * Track second 0 is the moment START is tapped (start of the get-ready countdown).
 * force: seek even if the track is close enough (after skip/back/pause).
 */
function syncTrack(force = false) {
  const a = P?.audio;
  if (!a) return;
  const pos = P.phase === 'ready' ? segElapsed() : READY_SECONDS + workoutElapsed();
  const stopped = !P.track || P.pausedAt != null || P.phase === 'done';
  if (stopped && !a.paused) a.pause();
  if (!P.track || (stopped && !force)) return;   // a stopped track stands still; it is lined up again on resume
  // Until the file's length is known, seeking does nothing; the 'loadedmetadata' handler lines it up then.
  if (a.readyState < 1) { if (!stopped) playTrack(a); return; }
  if (pos >= a.duration - 0.05) { if (!a.paused) a.pause(); return; }   // past the end: play() would restart from 0
  // While a seek or download is in progress, currentTime is not reliable; only forced jumps go through then.
  const settled = a.readyState >= 3 && !a.seeking;
  if (force || (settled && Math.abs(a.currentTime - pos) > TRACK_MAX_DRIFT)) a.currentTime = pos;
  if (!stopped) playTrack(a);
}
/** play() returns a promise; calling it again while one is still pending just piles up requests. */
function playTrack(a) {
  if (!a.paused || a._starting) return;
  a._starting = true;
  a.play().catch(() => {}).finally(() => { a._starting = false; });
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
  syncTrack();
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
  syncTrack(true);
  renderPlayerFrame();
}
/** Speaker button opens a list: Silentio + every track. The choice is remembered for next time. */
function toggleTrackMenu(open) {
  const menu = app.querySelector('#trackMenu');
  if (menu) menu.hidden = !(open ?? menu.hidden);
}
function renderTrackMenu() {
  const btn = app.querySelector('#sound');
  if (!btn) return;
  btn.textContent = P.track ? '🔊' : '🔇';
  btn.setAttribute('aria-label', P.track ? tx(P.track.title) : t('silent'));
  btn.title = btn.getAttribute('aria-label');
  app.querySelectorAll('#trackMenu [data-src]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.src === (P.track?.src ?? '')));
  });
}
function pickTrack(src) {
  const track = P.tracks.find((tr) => tr.src === src) || null;
  chooseTrack(P.workout, track);
  useTrack(track);
  toggleTrackMenu(false);
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
    <section class="pscreen">
    <header class="ptop">
      <span class="ptop-left">
        <button class="icon" id="exit" aria-label="${esc(t('ctlExit'))}">✕</button>
        ${P.audio ? `<button class="icon" id="sound" aria-haspopup="true"></button>` : ''}
      </span>
      <span class="counter" id="counter"></span>
      <span class="total" id="total"></span>
      ${P.audio ? `
      <div class="track-menu" id="trackMenu" role="menu" hidden>
        <button role="menuitemradio" data-src="">${esc(t('silent'))}</button>
        ${P.tracks.map((tr) => `<button role="menuitemradio" data-src="${esc(tr.src)}">${esc(tx(tr.title))}${tr.by ? ` <small>· ${esc(tr.by)}</small>` : ''}</button>`).join('')}
      </div>` : ''}
    </header>
    <div class="pmain">
      <p class="ready-label" id="readyLabel"></p>
      <h1 class="ex-name" id="exName"></h1>
      <div class="stage" id="stage">
        <svg class="frame" aria-hidden="true">
          <path class="frame-track"/>
          <path class="frame-bar" id="frameBar" pathLength="100" stroke-dasharray="100" stroke-dashoffset="0"/>
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
    <button class="more" id="more">${esc(t('howTo'))} ▾</button>
    </section>
    <section class="ex-info" id="exInfo">
      <h2>${esc(t('howTo'))}</h2>
      <h3 id="infoName"></h3>
      <p id="infoDesc"></p>
    </section>
  `;
  app.querySelector('#more').addEventListener('click', () => app.querySelector('#exInfo').scrollIntoView({ behavior: 'smooth' }));
  app.querySelector('#exit').addEventListener('click', exitPlayer);
  app.querySelector('#pause').addEventListener('click', togglePause);
  app.querySelector('#skip').addEventListener('click', skip);
  app.querySelector('#back').addEventListener('click', back);
  app.querySelector('#sound')?.addEventListener('click', (e) => { e.stopPropagation(); toggleTrackMenu(); });
  app.querySelectorAll('#trackMenu [data-src]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); pickTrack(b.dataset.src);
  }));

  // The frame's size depends on the screen and on one vs. two pictures, so redraw the line whenever it changes.
  const stage = app.querySelector('#stage');
  P.resize = new ResizeObserver(() => fitFrame(stage));
  P.resize.observe(stage);
}

/** Called whenever a new segment begins: swap name + picture, beep, flash. */
function enterStep() {
  const step = P.plan[P.index];
  const ready = P.phase === 'ready';
  app.querySelector('#readyLabel').textContent = ready ? `${t('getReady')} · ${t('first')}:` : '';
  app.querySelector('#exName').textContent = tx(step.ex.name);
  // description below the fold (scroll down or tap "How it's done")
  const desc = tx(step.ex.description);
  app.querySelector('#infoName').textContent = tx(step.ex.name);
  app.querySelector('#infoDesc').textContent = desc;
  app.querySelector('#exInfo').hidden = !desc;
  app.querySelector('#more').hidden = !desc;
  // "get ready" shows the workout's own picture if it has one, otherwise the first exercise
  const readyMedia = ready && P.workout.readyMedia;
  setMedia(app.querySelector('#media'), readyMedia || step.ex.media,
    readyMedia ? '' : (tx(step.ex.description) || tx(step.ex.name)));
  app.style.setProperty('--ex-accent', ready ? 'var(--muted)' : ACCENTS[P.index % ACCENTS.length]);
  app.classList.toggle('is-ready', ready);

  // preload the next picture(s)
  const next = P.plan[ready ? 0 : P.index + 1];
  for (const src of mediaList(next?.ex.media)) if (!isVideo(src)) new Image().src = src;

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
  app.querySelector('#frameBar').setAttribute('stroke-dashoffset', String(100 * (1 - left / dur)));
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

// a tap anywhere outside the track list closes it
document.addEventListener('click', (e) => {
  if (P && !e.target.closest('#trackMenu, #sound')) toggleTrackMenu(false);
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
