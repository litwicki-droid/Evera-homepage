/*
 * Evera – röstlägen bakom den orange rutan
 * ---------------------------------------------------------------
 * Klick på "Every Interaction Counts": rutan darrar (zap.js) och expanderar
 * sedan mjukt till en panel med två levande val byggda av kulor
 * (assets/js/evera-swarm.js):
 *
 *   1. Evera – Your Presence  (E-loggan)
 *   2. Evera – For Family     (kugghjulet)
 *
 * Klick på ett val öppnar mikrofonläget i helskärm. Kryss, Esc eller klick
 * utanför panelen drar ihop den till rutan igen.
 * Stilar: assets/css/main.css, avsnitt 8.
 */
(function () {
  'use strict';

  var pill = document.querySelector('.pill');
  if (!pill || !window.EveraSwarm) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE = 'cubic-bezier(.22,.8,.24,1)';
  var OPEN_MS = reduce ? 1 : 720, CLOSE_MS = reduce ? 1 : 520, ZAP_WAIT = reduce ? 0 : 300;
  var CANVAS_SCALE = 2.2;                       // ritytan är 2,2 gånger valkortet, så molnet aldrig klipps
  var TILE_ZOOM = 1.55 / CANVAS_SCALE, STAGE_ZOOM = 1.15;

  var MODES = {
    presence: {
      title: 'Your Presence', shape: 'logo',
      lines: ['Hi, I am Evera. I am here with you, every day.', 'I listen, I remember, and I notice when something changes.']
    },
    family: {
      title: 'For Family', shape: 'gear',
      lines: ['Hi! Here you can follow and adjust how Evera helps the people you care about.', 'You will know when something changes, and you can change the settings at any time.']
    }
  };

  // ---- DOM ----
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }

  var panel = el('div', 'vpanel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Talk with Evera', hidden: '' });
  var skin = el('div', 'vpanel__skin', { 'aria-hidden': 'true' });       // orange yta som tonar bort
  var skinText = el('span', 'vpanel__skin-text'); skinText.textContent = pill.textContent.trim();
  skin.appendChild(skinText);
  var inner = el('div', 'vpanel__inner');
  var closeBtn = el('button', 'vpanel__close', { type: 'button', 'aria-label': 'Close' });
  closeBtn.textContent = '×';
  var hint = el('p', 'vpanel__hint'); hint.textContent = 'Choose how you want to talk with Evera';
  var options = el('div', 'vpanel__options');
  inner.appendChild(closeBtn); inner.appendChild(hint); inner.appendChild(options);
  panel.appendChild(skin); panel.appendChild(inner);

  Object.keys(MODES).forEach(function (key) {
    var m = MODES[key];
    var b = el('button', 'vopt', { type: 'button', 'data-mode': key, 'aria-label': 'Evera – ' + m.title + '. Opens microphone mode.' });
    var view = el('span', 'vopt__view');
    var canvas = el('canvas', null, { 'aria-hidden': 'true' });
    view.appendChild(canvas);
    var name = el('span', 'vopt__name');
    var brand = el('span', 'vopt__brand'); brand.textContent = 'Evera';
    var sub = el('span', 'vopt__sub'); sub.textContent = m.title;
    name.appendChild(brand); name.appendChild(sub);
    b.appendChild(view); b.appendChild(name);
    options.appendChild(b);
    m.button = b; m.view = view; m.canvas = canvas;
    b.addEventListener('click', function () { openStage(key); });
  });

  var backdrop = el('div', 'vbackdrop', { hidden: '' });

  var stage = el('section', 'vstage', { hidden: '', 'aria-live': 'polite', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Evera microphone mode' });
  stage.innerHTML =
    '<div class="vstage__view"></div>' +
    '<div class="vstage__top">' +
      '<button class="vbtn vbtn--back" type="button">← Back</button>' +
      '<h2 class="vstage__title">Evera<span></span></h2>' +
      '<span class="vstage__spacer" aria-hidden="true"></span>' +
    '</div>' +
    '<div class="vstage__bottom">' +
      '<p class="vstage__status"></p>' +
      '<div class="vstage__row">' +
        '<button class="vbtn" type="button" data-act="mic" aria-pressed="false">🎙 Microphone</button>' +
        '<button class="vbtn" type="button" data-act="hold" hidden>Hold to talk</button>' +
        '<button class="vbtn" type="button" data-act="speak">Let Evera speak</button>' +
      '</div>' +
    '</div>';
  var stageView = stage.querySelector('.vstage__view');
  var stageTitle = stage.querySelector('.vstage__title span');
  var status = stage.querySelector('.vstage__status');
  var backBtn = stage.querySelector('.vbtn--back');
  var micBtn = stage.querySelector('[data-act="mic"]');
  var holdBtn = stage.querySelector('[data-act="hold"]');
  var speakBtn = stage.querySelector('[data-act="speak"]');

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(stage);

  // ---- svärmarna skapas först när panelen öppnas första gången ----
  var mounted = false;
  function mountSwarms() {
    if (mounted) return true;
    var small = Math.min(window.innerWidth, window.innerHeight) < 700;
    var ok = true;
    Object.keys(MODES).forEach(function (k) {
      var m = MODES[k];
      m.swarm = EveraSwarm.mount(m.canvas, { shape: m.shape, zoom: TILE_ZOOM, loop: true, loopHold: 10, spread: 0.55, count: small ? 5000 : 10000 });
      if (!m.swarm) ok = false;
    });
    mounted = true;
    if (!ok) hint.textContent = 'Your browser does not support WebGL2, which these animations need.';
    return ok;
  }
  function eachSwarm(fn) { Object.keys(MODES).forEach(function (k) { if (MODES[k].swarm) fn(MODES[k].swarm, MODES[k]); }); }

  // ---- panelens storlek och läge ----
  function targetRect() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var w = Math.min(980, vw - 24), h = Math.min(640, vh - 32);
    if (vw < 600) h = Math.min(vh - 24, Math.max(420, w * 1.15));
    return { left: (vw - w) / 2, top: (vh - h) / 2, width: w, height: h };
  }
  function rectOf(node) { var r = node.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
  function px(r) { return { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' }; }
  function place(r) { var p = px(r); Object.keys(p).forEach(function (k) { panel.style[k] = p[k]; }); }

  var isOpen = false, busy = false, active = null, lineIx = 0;

  function open() {
    if (isOpen || busy) return;
    busy = true;
    if (window.everaZap) window.everaZap(true);
    setTimeout(function () {
      var from = rectOf(pill), to = targetRect();
      var pillRadius = from.height / 2;
      place(to);
      panel.hidden = false; backdrop.hidden = false;
      panel.classList.remove('is-ready');
      pill.classList.add('is-expanded');
      var ok = mountSwarms();
      eachSwarm(function (s) { s.setZoom(TILE_ZOOM); s.setLoop(true); s.restart(); s.pause(); });

      skin.getAnimations().forEach(function (x) { x.cancel(); });
      skinText.getAnimations().forEach(function (x) { x.cancel(); });
      skinText.animate([{ opacity: 1 }, { opacity: 0, offset: 0.3 }, { opacity: 0 }], { duration: OPEN_MS, fill: 'forwards' });
      var anim = panel.animate([
        { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', borderRadius: pillRadius + 'px' },
        { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px', borderRadius: '32px' }
      ], { duration: OPEN_MS, easing: EASE });
      skin.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration: OPEN_MS, easing: 'ease-out', fill: 'forwards' });
      backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'ease-out' });

      anim.onfinish = function () {
        panel.classList.add('is-ready');      // innehållet tonas in
        if (ok) eachSwarm(function (s) { s.restart(); s.resume(); });
        isOpen = true; busy = false;
        MODES.presence.button.focus({ preventScroll: true });
      };
    }, ZAP_WAIT);
  }

  function close() {
    if (!isOpen || busy) return;
    if (active) closeStage(true);
    busy = true;
    panel.classList.remove('is-ready');
    eachSwarm(function (s) { s.pause(); });
    var from = rectOf(panel), to = rectOf(pill);
    var anim = panel.animate([
      { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', borderRadius: '32px' },
      { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px', borderRadius: (to.height / 2) + 'px' }
    ], { duration: CLOSE_MS, easing: EASE, fill: 'forwards' });
    skin.getAnimations().forEach(function (x) { x.cancel(); });
    skinText.getAnimations().forEach(function (x) { x.cancel(); });
    skinText.animate([{ opacity: 0 }, { opacity: 0, offset: 0.7 }, { opacity: 1 }], { duration: CLOSE_MS, fill: 'forwards' });
    skin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = function () {
      panel.hidden = true; backdrop.hidden = true;
      anim.cancel();
      backdrop.getAnimations().forEach(function (a) { a.cancel(); });
      pill.classList.remove('is-expanded');
      isOpen = false; busy = false;
      pill.focus({ preventScroll: true });
    };
  }

  pill.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  window.addEventListener('resize', function () { if (isOpen && !busy) place(targetRect()); });

  // ---- mikrofonläge ----
  function setStatus(t) { status.textContent = t; }

  function startMic() {
    return active.swarm.listenMic().then(function () {
      micBtn.hidden = false; holdBtn.hidden = true;
      micBtn.classList.add('is-on'); micBtn.setAttribute('aria-pressed', 'true'); micBtn.textContent = '🎙 Listening';
      setStatus('Go ahead, I am listening');
    }).catch(function () {
      micBtn.hidden = true; holdBtn.hidden = false;
      setStatus('The microphone is not available. Hold the button to simulate your voice.');
    });
  }
  function stopMic() {
    if (!active) return;
    active.swarm.stopMic();
    micBtn.classList.remove('is-on'); micBtn.setAttribute('aria-pressed', 'false'); micBtn.textContent = '🎙 Microphone';
  }

  function openStage(key) {
    if (!isOpen || busy || !MODES[key].swarm) return;
    active = MODES[key]; lineIx = 0;
    eachSwarm(function (s, m) { if (m !== active) s.pause(); });
    stageView.appendChild(active.canvas);
    active.swarm.setZoom(STAGE_ZOOM);
    active.swarm.setLoop(false);
    stageTitle.textContent = active.title;
    stage.hidden = false;
    if (!reduce) stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    micBtn.hidden = false; holdBtn.hidden = true;
    if (window.everaSound && window.everaSound.duck) window.everaSound.duck(true);   // musiken tystnar så att mikrofonen inte hör den
    setStatus('Starting the microphone…');
    startMic();   // klicket räknas som tillåtelse att fråga om mikrofonen
    backBtn.focus({ preventScroll: true });
  }
  function closeStage(silent) {
    if (!active) return;
    stopMic(); stopHold();
    if (window.everaSound && window.everaSound.duck) window.everaSound.duck(false);
    active.view.appendChild(active.canvas);
    active.swarm.setZoom(TILE_ZOOM);
    active.swarm.setLoop(true);
    var btn = active.button;
    active = null;
    stage.hidden = true;
    if (!silent) eachSwarm(function (s) { s.resume(); });
    if (!silent) btn.focus({ preventScroll: true });
  }
  backBtn.addEventListener('click', function () { closeStage(false); });

  micBtn.addEventListener('click', function () {
    if (micBtn.classList.contains('is-on')) { stopMic(); setStatus('Microphone off'); }
    else { setStatus('Starting the microphone…'); startMic(); }
  });

  // simulerad röst när mikrofon saknas
  var holding = false, t0 = 0;
  function tick(now) {
    if (!holding || !active) return;
    var t = (now - t0) / 1000;
    active.swarm.setLevel('user', 0.35 + 0.5 * Math.abs(Math.sin(t * 13.5)) * (0.6 + 0.4 * Math.sin(t * 2.3)));
    requestAnimationFrame(tick);
  }
  function startHold(e) { e.preventDefault(); if (holding) return; holding = true; t0 = performance.now(); holdBtn.classList.add('is-on'); setStatus('You are talking…'); requestAnimationFrame(tick); }
  function stopHold() { if (!holding) return; holding = false; holdBtn.classList.remove('is-on'); if (active) { active.swarm.setLevel('user', 0); setStatus('Hold the button again to talk'); } }
  holdBtn.addEventListener('pointerdown', startHold);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { holdBtn.addEventListener(n, stopHold); });
  holdBtn.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') startHold(e); });
  holdBtn.addEventListener('keyup', stopHold);

  speakBtn.addEventListener('click', function () {
    if (!active) return;
    var text = active.lines[lineIx++ % active.lines.length];
    setStatus('“' + text + '”');
    speakBtn.classList.add('is-evera');
    active.swarm.speak(text, 'en-US');
    setTimeout(function () { speakBtn.classList.remove('is-evera'); }, Math.max(2, text.split(' ').length * 0.38) * 1000);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (active) closeStage(false);
    else if (isOpen) close();
  });

  window.everaVoice = { open: open, close: close, modes: MODES };   // för test
})();
