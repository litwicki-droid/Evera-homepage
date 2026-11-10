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
 * Nytt klick på den orange rutan (eller Esc) drar ihop den blå rutan igen.
 * Stilar: assets/css/main.css, avsnitt 8.
 *
 * Båda valen pratar med den riktiga Evera-agenten hos ElevenLabs, i vår egen
 * grafik (ingen ElevenLabs-widget). Klick på loggan eller kugghjulet startar
 * samtalet direkt; då frågar webbläsaren om mikrofonen. "End conversation"
 * avslutar, "Talk with Evera" startar igen. ElevenLabs officiella klientbibliotek
 * (@elevenlabs/client) förladdas när röstrutan öppnas, i en låst version med
 * SRI-kontroll. Agent-ID:t är publikt och ingen hemlig nyckel. Språk, röst, prompt
 * och om textchatt tillåts styrs i agentens inställningar hos ElevenLabs.
 */
(function () {
  'use strict';

  // Mikrofonen fungerar bara på säkra (https) sidor. Den som kommer via http://evera.care
  // skickas därför till https-adressen, annars kan Evera aldrig höra besökaren.
  if (location.protocol === 'http:' && /(^|\.)evera\.care$/i.test(location.hostname)) {
    location.replace('https://' + location.host + location.pathname + location.search + location.hash);
    return;
  }

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
  // Omsamplaren som biblioteket annars hämtar från jsDelivr utan hashkontroll; vi lägger den på egen server.
  var LIBSAMPLERATE_PATH = new URL('assets/js/vendor/libsamplerate.worklet.js', document.baseURI).href;
  var CONNECT_TIMEOUT_MS = 20000;               // ger upp om uppkopplingen hänger

  var MODES = {
    presence: { title: 'Your Presence', shape: 'logo', agentId: EVERA_AGENT_ID },
    family: { title: 'For Family', shape: 'gear', agentId: EVERA_AGENT_ID }
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

  var stage = el('div', 'vembed__stage', { hidden: '' });
  stage.innerHTML =
    '<div class="vstage__view"></div>' +
    '<div class="vstage__top">' +
      '<button class="vbtn vbtn--back" type="button">← Back</button>' +
      '<h2 class="vstage__title">Evera<span></span></h2>' +
      '<span class="vstage__spacer" aria-hidden="true"></span>' +
    '</div>' +
    '<div class="vstage__bottom">' +
      '<p class="vstage__status" role="status" aria-live="polite"></p>' +
      '<div class="vstage__row">' +
        '<button class="vbtn" type="button" data-act="call" aria-pressed="false">🎙 Talk with Evera</button>' +
      '</div>' +
      '<p class="vstage__note">Your voice is sent to ElevenLabs, our speech service, so that Evera can hear and answer you.</p>' +
    '</div>';

  inner.appendChild(chooser); inner.appendChild(stage);
  box.appendChild(skin); box.appendChild(inner);
  pill.parentNode.insertBefore(box, pill.nextSibling);

  Object.keys(MODES).forEach(function (key) {
    var m = MODES[key];
    var b = el('button', 'vopt', { type: 'button', 'data-mode': key, 'aria-label': 'Evera – ' + m.title + '. Starts a voice conversation with Evera; your browser will ask for the microphone.' });
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

  var isOpen = false, busy = false, active = null;

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
      loadSdk().catch(function () { /* nytt försök görs när samtalet startar */ });
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

  // ---- samtalsläget inne i rutan ----
  // quiet = visa texten men läs inte upp den för skärmläsare (t.ex. talar/lyssnar-växlingar)
  function setStatus(t, quiet) {
    status.setAttribute('aria-live', quiet ? 'off' : 'polite');
    status.textContent = t;
  }

  function openStage(key) {
    if (!isOpen || busy || !MODES[key].swarm) return;
    active = MODES[key];
    eachSwarm(function (s, m) { if (m !== active) s.pause(); });
    stageView.appendChild(active.canvas);
    active.swarm.setZoom(STAGE_ZOOM);
    active.swarm.setLoop(false);
    stageTitle.textContent = active.title;
    chooser.hidden = true; stage.hidden = false; box.classList.add('is-stage');
    if (!reduce) stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: 'ease-out' });
    if (window.everaSound && window.everaSound.duck) window.everaSound.duck(true);   // musiken tystnar så att mikrofonen inte hör den
    // Klicket på loggan/kugghjulet startar samtalet direkt (webbläsaren frågar om mikrofonen);
    // knappen visar "End conversation" från start.
    setCallUi('idle');
    startCall();
    moveFocus(backBtn);
  }
  function closeStage(silent) {
    if (!active) return;
    endCall();
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
        else { sdkPromise = null; reject(namedError('SdkLoadError', 'The ElevenLabs library did not load')); }
      };
      s.onerror = function () { sdkPromise = null; s.remove(); reject(namedError('SdkLoadError', 'The ElevenLabs library could not be downloaded')); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }
  function namedError(name, message) { var e = new Error(message); e.name = name; return e; }

  // iPhone: ljudknappen (sound.js) ställer Safaris ljudsession på "playback" så att musiken
  // hörs i ljudlöst läge. I det läget avvisar Safari mikrofonen direkt med InvalidStateError,
  // utan att fråga. Under samtalet används därför "play-and-record".
  function captureAudioSession(on) {
    if (window.everaSound && window.everaSound.setCapture) { window.everaSound.setCapture(on); return; }
    try { if (navigator.audioSession) navigator.audioSession.type = on ? 'play-and-record' : 'auto'; } catch (e) { /* stöds inte */ }
  }

  // callState: idle | connecting | connected
  var call = null, callState = 'idle', callSeq = 0, levelRaf = 0, lastToggle = 0;
  var pendingAttempt = Promise.resolve();       // högst en uppkoppling åt gången, även efter avbrott
  function setCallUi(state, msg) {
    callState = state;
    lastToggle = Date.now();
    var on = state !== 'idle';
    callBtn.classList.toggle('is-on', on);
    callBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    callBtn.textContent = state === 'idle' ? '🎙 Talk with Evera' : 'End conversation';
    callBtn.classList.remove('is-evera');
    if (msg !== undefined) setStatus(msg);
    else if (state === 'idle') setStatus('Press “Talk with Evera” to start. Your browser will ask to use the microphone.');
    else if (state === 'connecting') setStatus('Connecting to Evera… Allow the microphone if your browser asks.');
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

  var MIC_DENIED = { NotAllowedError: 1, SecurityError: 1 };
  var MIC_MISSING = { NotFoundError: 1, NotReadableError: 1, OverconstrainedError: 1 };
  function errorCode(n, m) { return ' (' + [n && n !== 'Error' ? n : '', String(m || '').slice(0, 70)].filter(Boolean).join(': ') + ')'; }
  function callErrorText(err) {
    var n = (err && err.name) || '', m = String((err && err.message) || err || '');
    var code = errorCode(n, m);   // kort felkod för felsökning
    if (n === 'NoMicSupport')
      return 'This browser cannot use the microphone here. Open evera.care in Safari or Chrome (not inside another app) and try again.';
    if (MIC_DENIED[n])
      return 'Evera needs the microphone. Allow microphone access for evera.care (in iPhone: Settings › Safari › Microphone) and try again.' + code;
    if (MIC_MISSING[n])
      return 'No working microphone was found, or another app is using it. Close other calls and try again.' + code;
    if (n === 'ConnectTimeout')
      return 'Evera did not answer in time. Check your internet connection and try again.';
    if (n === 'SessionConnectionError' && /origin|allowlist|unauthori[sz]ed|forbidden|401|403|authenticat/i.test(m))
      return 'Evera is not open for calls from this website yet.' + code;
    return 'Could not connect to Evera right now. Please try again in a moment.' + code;
  }

  // Mikrofontillståndet frågas direkt i besökarens tryck, så att frågan säkert visas på
  // mobilen. Strömmen stängs genast igen; ElevenLabs-biblioteket öppnar sin egen.
  function requestMicInGesture() {
    var md = navigator.mediaDevices;
    if (!window.isSecureContext || !md || !md.getUserMedia) return Promise.reject(namedError('NoMicSupport', 'no mediaDevices'));
    try {
      return md.getUserMedia({ audio: true });   // samma enkla anrop som ElevenLabs dokumentation
    } catch (err) { return Promise.reject(err); }
  }
  function stopStream(stream) {
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
  }

  function failCall(seq, err) {
    if (seq !== callSeq) return;
    callSeq++;                                  // ett sent svar från uppkopplingen avslutas direkt
    call = null; clearLevels();
    captureAudioSession(false);
    setCallUi('idle', callErrorText(err));
  }

  function startCall() {
    if (!active || !active.agentId || callState !== 'idle') return;
    var mode = active, seq = ++callSeq;
    setCallUi('connecting');
    // Måste ske synkront i trycket (före första await): ljudsessionen och mikrofonfrågan.
    // Ljudet på iPhone låses upp av ElevenLabs-biblioteket självt i samma tryck.
    captureAudioSession(true);
    var micReady = requestMicInGesture().then(function (stream) { stopStream(stream); }, function (err) {
      // nekad eller saknad mikrofon: stoppa här. Andra fel: låt ElevenLabs-biblioteket försöka själv.
      if (MIC_DENIED[err && err.name] || MIC_MISSING[err && err.name] || (err && err.name) === 'NoMicSupport') throw err;
      if (window.console) console.warn('[Evera] första mikrofonfrågan misslyckades, försöker igen via ElevenLabs:', err);
    });
    var timer = setTimeout(function () {
      if (seq === callSeq && callState === 'connecting') failCall(seq, namedError('ConnectTimeout', 'timeout'));
    }, CONNECT_TIMEOUT_MS);

    // vänta in ett tidigare avbrutet försök (högst 2 s), så att samtal inte staplas på varandra
    var previous = Promise.race([pendingAttempt, new Promise(function (r) { setTimeout(r, 2000); })]);
    var attempt = Promise.all([micReady, loadSdk(), previous]).then(function (res) {
      var sdk = res[1];
      if (seq !== callSeq) return null;
      return sdk.Conversation.startSession({
        agentId: mode.agentId,
        connectionType: 'websocket',            // samma som ElevenLabs egen widget använder som standard
        libsampleratePath: LIBSAMPLERATE_PATH,
        onConnect: function () {
          if (seq !== callSeq) return;
          clearTimeout(timer);
          setCallUi('connected', 'Connected. Go ahead, Evera is listening.');
        },
        onDisconnect: function (details) {
          if (seq !== callSeq) return;
          callSeq++;
          clearTimeout(timer);
          call = null; clearLevels();
          captureAudioSession(false);
          var reason = details && details.reason;
          setCallUi('idle', reason === 'error'
            ? 'The conversation was interrupted. Press “Talk with Evera” to try again.' + errorCode('', details.message || details.closeReason)
            : reason === 'agent'
              ? 'Evera ended the conversation. Press “Talk with Evera” to talk again.'
              : 'The conversation has ended. Press “Talk with Evera” to talk again.');
        },
        onError: function (message, context) {
          if (window.console) console.warn('[Evera] fel i samtalet:', message, context);
        },
        onModeChange: function (p) {
          if (seq !== callSeq || callState !== 'connected') return;
          var speaking = p && p.mode === 'speaking';
          callBtn.classList.toggle('is-evera', speaking);
          setStatus(speaking ? 'Evera is speaking…' : 'Evera is listening…', true);
        }
      });
    }).then(function (conv) {
      clearTimeout(timer);
      if (!conv) return;
      if (seq !== callSeq) return conv.endSession();   // avbrutet eller för sent: stäng direkt
      call = conv;
      if (!levelRaf) levelRaf = requestAnimationFrame(pumpLevels);
    }).catch(function (err) {
      clearTimeout(timer);
      if (window.console) console.warn('[Evera] samtalet kunde inte starta:', err);
      failCall(seq, err);
    });
    pendingAttempt = attempt.catch(function () {});
  }
  function endCall() {
    callSeq++;
    var c = call; call = null;
    clearLevels();
    if (c) { try { c.endSession(); } catch (e) { /* redan stängd */ } }
    captureAudioSession(false);
    if (callState !== 'idle') setCallUi('idle');
  }
  callBtn.addEventListener('click', function () {
    if (Date.now() - lastToggle < 500) return;   // dubbeltryck ska inte starta och avbryta direkt
    if (callState === 'idle') startCall();
    else { endCall(); setStatus('The conversation has ended. Press “Talk with Evera” to talk again.'); }
  });
  window.addEventListener('pagehide', endCall);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (active) closeStage(false);
    else if (isOpen) close();
  });

  window.everaVoice = { open: open, close: close, modes: MODES };   // för test
})();
