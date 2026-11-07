/*
 * Evera – röstlägen inbäddade i startsidan
 * ---------------------------------------------------------------
 * Klick på "Every Interaction Counts": rutan darrar (zap.js) och växer sedan
 * på sin egen plats under loggan till en blå ruta, inbäddad i sidan (inget
 * lager ovanpå). I rutan finns två levande val byggda av kulor
 * (assets/js/evera-swarm.js):
 *
 *   1. Evera – Your Presence  (E-loggan)
 *   2. Evera – For Family     (kugghjulet)
 *
 * Den orange rutan ligger kvar ovanför; den blå rutan växer fram under den.
 * Klick på ett val öppnar mikrofonläget inne i samma ruta. Nytt klick på den
 * orange rutan (eller Esc) drar ihop den blå rutan igen.
 * Stilar: assets/css/main.css, avsnitt 8.
 *
 * "Your Presence" pratar med den riktiga Evera-agenten hos ElevenLabs, i vår egen
 * grafik (ingen ElevenLabs-widget). Samtalet startar först när besökaren trycker
 * på "Talk with Evera"; då frågar webbläsaren om mikrofonen. ElevenLabs officiella
 * klientbibliotek (@elevenlabs/client) laddas först vid det klicket, i en låst
 * version med SRI-kontroll. Agent-ID:t är publikt och ingen hemlig nyckel.
 * Språk, röst, prompt och om textchatt tillåts styrs i agentens inställningar hos ElevenLabs.
 */
(function () {
  'use strict';

  var pill = document.querySelector('.pill');
  var hero = document.querySelector('.hero');
  if (!pill || !hero || !window.EveraSwarm) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var EASE = 'cubic-bezier(.22,.8,.24,1)';
  var OPEN_MS = reduce ? 1 : 760, CLOSE_MS = reduce ? 1 : 560, ZAP_WAIT = reduce ? 0 : 300;
  var CANVAS_SCALE = 2.2;                       // ritytan är 2,2 gånger valkortet, så molnet aldrig klipps
  var TILE_ZOOM = 1.55 / CANVAS_SCALE, STAGE_ZOOM = 1.05;

  // ---- ElevenLabs ----
  var EVERA_AGENT_ID = 'agent_0601m6thxhtjfg3aat6ky67404m0';
  var ELEVENLABS_SDK = {
    src: 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.30.0/dist/lib.iife.js',
    // SHA-384 av dist/lib.iife.js i npm-paketet @elevenlabs/client@1.30.0. Byts versionen måste hashen räknas om.
    integrity: 'sha384-hPgJNi1c2YcrBRYV0/hWcnVoupGSAtCvWGc9YTFFJhgLCno7/4I/XJmYswB4Jc4N'
  };

  var MODES = {
    presence: {
      title: 'Your Presence', shape: 'logo', agentId: EVERA_AGENT_ID,
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

  var box = el('section', 'vembed', { 'aria-label': 'Talk with Evera', hidden: '' });
  var skin = el('div', 'vembed__skin', { 'aria-hidden': 'true' });     // orange yta som tonar bort
  var inner = el('div', 'vembed__inner');

  pill.setAttribute('aria-expanded', 'false');

  var chooser = el('div', 'vembed__chooser');
  var hint = el('p', 'vembed__hint'); hint.textContent = 'Choose how you want to talk with Evera';
  var options = el('div', 'vembed__options');
  chooser.appendChild(options);   // ingen rubrik; hint visas bara om WebGL2 saknas

  var stage = el('div', 'vembed__stage', { hidden: '', 'aria-live': 'polite' });
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
        '<button class="vbtn" type="button" data-act="call" aria-pressed="false" hidden>🎙 Talk with Evera</button>' +
        '<button class="vbtn" type="button" data-act="mic" aria-pressed="false">🎙 Microphone</button>' +
        '<button class="vbtn" type="button" data-act="hold" hidden>Hold to talk</button>' +
        '<button class="vbtn" type="button" data-act="speak">Let Evera speak</button>' +
      '</div>' +
    '</div>';

  inner.appendChild(chooser); inner.appendChild(stage);
  box.appendChild(skin); box.appendChild(inner);
  pill.parentNode.insertBefore(box, pill.nextSibling);

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

  var stageView = stage.querySelector('.vstage__view');
  var stageTitle = stage.querySelector('.vstage__title span');
  var status = stage.querySelector('.vstage__status');
  var backBtn = stage.querySelector('.vbtn--back');
  var micBtn = stage.querySelector('[data-act="mic"]');
  var holdBtn = stage.querySelector('[data-act="hold"]');
  var speakBtn = stage.querySelector('[data-act="speak"]');
  var callBtn = stage.querySelector('[data-act="call"]');

  // ---- svärmarna skapas först när rutan öppnas första gången ----
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
    if (!ok) { hint.textContent = 'Your browser does not support WebGL2, which these animations need.'; chooser.insertBefore(hint, options); }
    return ok;
  }
  function eachSwarm(fn) { Object.keys(MODES).forEach(function (k) { if (MODES[k].swarm) fn(MODES[k].swarm, MODES[k]); }); }
  function cancelAll(node) { node.getAnimations().forEach(function (a) { a.cancel(); }); }

  var isOpen = false, busy = false, active = null, lineIx = 0;

  // Flytta fokus bara för den som använder tangentbordet. Med mus/touch tas fokus
  // bort i stället, annars ritar webbläsaren ibland en fokusram runt knapparna.
  var usingKeyboard = false;
  document.addEventListener('keydown', function (e) { if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') usingKeyboard = true; }, true);
  document.addEventListener('pointerdown', function () { usingKeyboard = false; }, true);
  function moveFocus(node) {
    if (usingKeyboard) node.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  var pillSize = { w: 0, h: 0 };

  // ---- växa / krympa på plats ----
  function open() {
    if (isOpen || busy) return;
    busy = true;
    if (window.everaZap) window.everaZap(true);
    setTimeout(function () {
      var r = pill.getBoundingClientRect();
      pillSize = { w: r.width, h: r.height };
      var ok = mountSwarms();
      eachSwarm(function (s) { s.setZoom(TILE_ZOOM); s.setLoop(true); s.restart(); s.pause(); });

      // den orange rutan ligger kvar; den blå rutan växer fram under den
      box.hidden = false;
      pill.setAttribute('aria-expanded', 'true');
      box.classList.remove('is-ready');
      hero.classList.add('is-voice');           // loggan krymper lite så att allt ryms
      var to = box.getBoundingClientRect();
      cancelAll(box); cancelAll(skin);
      var anim = box.animate([
        { width: pillSize.w + 'px', height: '0px', opacity: 0, borderRadius: (pillSize.h / 2) + 'px' },
        { opacity: 1, offset: 0.2 },
        { width: to.width + 'px', height: to.height + 'px', opacity: 1, borderRadius: '28px' }
      ], { duration: OPEN_MS, easing: EASE });
      skin.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: OPEN_MS, easing: 'ease-out', fill: 'forwards' });

      anim.onfinish = function () {
        box.classList.add('is-ready');          // innehållet tonas in
        if (ok) eachSwarm(function (s) { s.restart(); s.resume(); });
        isOpen = true; busy = false;
        moveFocus(MODES.presence.button);
      };
    }, ZAP_WAIT);
  }

  function close() {
    if (!isOpen || busy) return;
    if (active) closeStage(true);
    busy = true;
    box.classList.remove('is-ready');
    eachSwarm(function (s) { s.pause(); });
    var from = box.getBoundingClientRect();
    hero.classList.remove('is-voice');
    cancelAll(skin);
    pill.setAttribute('aria-expanded', 'false');
    var anim = box.animate([
      { width: from.width + 'px', height: from.height + 'px', opacity: 1, borderRadius: '28px' },
      { opacity: 1, offset: 0.8 },
      { width: pillSize.w + 'px', height: '0px', opacity: 0, borderRadius: (pillSize.h / 2) + 'px' }
    ], { duration: CLOSE_MS, easing: EASE, fill: 'forwards' });
    skin.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLOSE_MS, easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = function () {
      box.hidden = true;
      anim.cancel();
      isOpen = false; busy = false;
      moveFocus(pill);
    };
  }

  // den orange rutan öppnar och stänger
  pill.addEventListener('click', function () { if (isOpen) close(); else open(); });

  // ---- mikrofonläge inne i rutan ----
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
    chooser.hidden = true; stage.hidden = false; box.classList.add('is-stage');
    if (!reduce) stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    holdBtn.hidden = true;
    if (window.everaSound && window.everaSound.duck) window.everaSound.duck(true);   // musiken tystnar så att mikrofonen inte hör den
    if (active.agentId) {
      // riktigt samtal: inget startar förrän besökaren trycker på knappen
      micBtn.hidden = true; speakBtn.hidden = true; callBtn.hidden = false;
      setCallUi('idle');
    } else {
      micBtn.hidden = false; speakBtn.hidden = false; callBtn.hidden = true;
      setStatus('Starting the microphone…');
      startMic();   // klicket räknas som tillåtelse att fråga om mikrofonen
    }
    moveFocus(backBtn);
  }
  function closeStage(silent) {
    if (!active) return;
    endCall();
    stopMic(); stopHold();
    if (window.everaSound && window.everaSound.duck) window.everaSound.duck(false);
    active.view.appendChild(active.canvas);
    active.swarm.setZoom(TILE_ZOOM);
    active.swarm.setLoop(true);
    var btn = active.button;
    active = null;
    stage.hidden = true; chooser.hidden = false; box.classList.remove('is-stage');
    if (!silent) { eachSwarm(function (s) { s.resume(); }); moveFocus(btn); }
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

  // ---- samtal med Evera via ElevenLabs ----
  var sdkPromise = null;
  function loadSdk() {
    if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) return Promise.resolve(window.ElevenLabsClient);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ELEVENLABS_SDK.src;
      s.integrity = ELEVENLABS_SDK.integrity;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = function () {
        if (window.ElevenLabsClient && window.ElevenLabsClient.Conversation) resolve(window.ElevenLabsClient);
        else { sdkPromise = null; reject(new Error('sdk')); }
      };
      s.onerror = function () { sdkPromise = null; s.remove(); reject(new Error('sdk')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  // callState: idle | connecting | connected
  var call = null, callState = 'idle', callSeq = 0, levelRaf = 0;
  function setCallUi(state, msg) {
    callState = state;
    var on = state !== 'idle';
    callBtn.classList.toggle('is-on', on);
    callBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    callBtn.textContent = state === 'idle' ? '🎙 Talk with Evera' : state === 'connecting' ? 'Cancel' : 'End conversation';
    callBtn.classList.remove('is-evera');
    if (msg !== undefined) setStatus(msg);
    else if (state === 'idle') setStatus('Press “Talk with Evera” to start. Your browser will ask to use the microphone.');
    else if (state === 'connecting') setStatus('Connecting to Evera…');
  }
  // röstnivåer från samtalet styr kulorna
  function voiceLevel(v) { return Math.min(1, Math.max(0, (v - 0.02) * 3.2)); }
  function pumpLevels() {
    if (!call || !active) { levelRaf = 0; return; }
    try {
      active.swarm.setLevel('user', voiceLevel(call.getInputVolume()));
      active.swarm.setLevel('evera', voiceLevel(call.getOutputVolume()));
    } catch (e) { /* samtalet kan just ha stängts */ }
    levelRaf = requestAnimationFrame(pumpLevels);
  }
  function clearLevels() {
    if (levelRaf) cancelAnimationFrame(levelRaf);
    levelRaf = 0;
    eachSwarm(function (s) { s.setLevel('user', 0); s.setLevel('evera', 0); });
  }
  function callErrorText(err) {
    var n = err && (err.name || ''), m = String(err && err.message || err || '');
    if (n === 'NotAllowedError' || n === 'SecurityError' || /permission|not allowed|denied/i.test(m))
      return 'Evera needs the microphone. Allow microphone access in your browser and try again.';
    if (n === 'NotFoundError' || n === 'NotReadableError' || /device not found|could not start audio/i.test(m))
      return 'No working microphone was found. Connect a microphone and try again.';
    return 'Could not connect to Evera right now. Please try again in a moment.';
  }

  function startCall() {
    if (!active || !active.agentId || callState !== 'idle') return;
    var mode = active, seq = ++callSeq;
    setCallUi('connecting');
    loadSdk().then(function (sdk) {
      if (seq !== callSeq) return null;
      return sdk.Conversation.startSession({
        agentId: mode.agentId,
        connectionType: 'webrtc',
        onConnect: function () {
          if (seq !== callSeq) return;
          setCallUi('connected', 'Connected. Go ahead, Evera is listening.');
        },
        onDisconnect: function () {
          if (seq !== callSeq) return;
          call = null; clearLevels();
          setCallUi('idle', 'The conversation has ended. Press “Talk with Evera” to talk again.');
        },
        onError: function () {
          if (seq !== callSeq) return;
          setStatus('Something went wrong in the conversation. Please try again.');
        },
        onModeChange: function (p) {
          if (seq !== callSeq || callState !== 'connected') return;
          var speaking = p && p.mode === 'speaking';
          callBtn.classList.toggle('is-evera', speaking);
          setStatus(speaking ? 'Evera is speaking…' : 'Evera is listening…');
        }
      });
    }).then(function (conv) {
      if (!conv) return;
      if (seq !== callSeq) { conv.endSession(); return; }   // besökaren avbröt under uppkopplingen
      call = conv;
      if (!levelRaf) levelRaf = requestAnimationFrame(pumpLevels);
    }).catch(function (err) {
      if (seq !== callSeq) return;
      call = null; clearLevels();
      setCallUi('idle', callErrorText(err));
    });
  }
  function endCall() {
    callSeq++;
    var c = call; call = null;
    clearLevels();
    if (c) { try { c.endSession(); } catch (e) { /* redan stängd */ } }
    if (callState !== 'idle') setCallUi('idle');
  }
  callBtn.addEventListener('click', function () {
    if (callState === 'idle') startCall();
    else { endCall(); setStatus('The conversation has ended. Press “Talk with Evera” to talk again.'); }
  });
  window.addEventListener('pagehide', endCall);

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
