/*
 * Evera – bakgrundsmusik med av/på-knapp
 * ---------------------------------------------------------------
 * Ljudet är avstängt från början (webbläsare tillåter inte ljud innan
 * besökaren klickat). Knappen nere till vänster, eller tangenten M,
 * slår på och av.
 *
 * Två lägen:
 *  1. Ingen musikfil angiven (standard): lugn ambientmusik skapas direkt
 *     i webbläsaren med Web Audio – mjuka ackord och klockliknande toner.
 *     Ingen fil behöver laddas ner.
 *  2. Egen musikfil: lägg filen i assets/audio/ och skriv in sökvägen nedan,
 *     t.ex.  var MUSIC_FILE = 'assets/audio/evera-music.mp3';
 *     Filen spelas i loop och tonas in och ut mjukt.
 *     Använd bara musik du har rätt att använda på webben.
 */
(function () {
  'use strict';

  var MUSIC_FILE = null;   // <- byt till 'assets/audio/din-fil.mp3' för egen musik
  var VOLUME = 0.8;        // 0–1
  var AUTO_START = true;   // true = musiken startar vid första klick/tryck var som helst på sidan
                           // (webbläsare tillåter inte ljud innan besökaren har gjort något)
  var ZAP_STYLE = 'gnista'; // ljudet på den orange rutan: 'gnista' (statisk urladdning) eller 'knaster'

  var btn = document.getElementById('sound-toggle');
  var label = document.getElementById('sound-label');
  if (!btn) return;

  var ctx = null, master = null, on = false, timer = 0;
  var fileEl = null, fileSrc = null;
  var next = 0, chord = 0, pluckAt = 0;

  // Am9 – Fmaj9 – Cmaj9 – G6/9, ett ackord var åttonde sekund
  var CHORDS = [
    [110.00, 164.81, 196.00, 246.94, 261.63],
    [87.31, 130.81, 164.81, 196.00, 220.00],
    [130.81, 196.00, 246.94, 293.66, 329.63],
    [98.00, 146.83, 185.00, 220.00, 246.94]
  ];
  var BELLS = [440, 523.25, 587.33, 659.25, 783.99, 880];
  var pad = null, fx = null;

  function init() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0;
    var comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);

    if (MUSIC_FILE) {
      fileEl = new Audio(MUSIC_FILE);
      fileEl.loop = true;
      fileEl.crossOrigin = 'anonymous';
      fileSrc = ctx.createMediaElementSource(fileEl);
      fileSrc.connect(master);
      return true;
    }

    // Eko: fördröjning med återkoppling, för rymd
    var delay = ctx.createDelay(2); delay.delayTime.value = 0.42;
    var fb = ctx.createGain(); fb.gain.value = 0.4;
    var wet = ctx.createGain(); wet.gain.value = 0.38;
    var dl = ctx.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    delay.connect(dl); dl.connect(fb); fb.connect(delay); dl.connect(wet); wet.connect(master);
    fx = delay;

    // Ackordmatta genom ett långsamt svepande filter
    var pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 820; pf.Q.value = 0.6;
    var lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.06; lg.gain.value = 420;
    lfo.connect(lg); lg.connect(pf.frequency); lfo.start();
    pad = ctx.createGain(); pad.gain.value = 0.2;
    pad.connect(pf); pf.connect(master); pf.connect(delay);
    next = ctx.currentTime + 0.05;
    pluckAt = ctx.currentTime + 1.2;
    return true;
  }

  function playChord(notes, at, dur) {
    notes.forEach(function (f) {
      [-7, 7].forEach(function (det) {
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.05, at + 2.4);
        g.gain.setValueAtTime(0.05, at + dur - 0.4);
        g.gain.linearRampToValueAtTime(0, at + dur + 2.2);
        o.connect(g); g.connect(pad);
        o.start(at); o.stop(at + dur + 2.4);
      });
    });
  }

  function pluck(f, at, gain) {
    var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), g2 = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    o2.type = 'triangle'; o2.frequency.value = f * 2; g2.gain.value = 0.18;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(master); g.connect(fx);
    o.start(at); o2.start(at); o.stop(at + 2.3); o2.stop(at + 2.3);
  }

  function schedule() {
    if (!on || !ctx || MUSIC_FILE) return;
    while (next < ctx.currentTime + 1.5) {
      playChord(CHORDS[chord % CHORDS.length], next, 8);
      chord++; next += 8;
    }
    while (pluckAt < ctx.currentTime + 1.0) {
      var f = BELLS[Math.floor(Math.random() * BELLS.length)] * (Math.random() < 0.25 ? 0.5 : 1);
      pluck(f, pluckAt, 0.07 + Math.random() * 0.05);
      pluckAt += 0.6 * (1 + Math.floor(Math.random() * 4));
    }
  }

  // iPhone (Safari 16.4+): "playback" låter musiken höras även i ljudlöst läge, men i det
  // läget avvisar Safari mikrofonen. Under ett röstsamtal (evera-voice.js) används därför
  // "play-and-record", och "playback" sätts först när samtalet är slut.
  var capturing = false;
  function audioSessionType(type) {
    if (!navigator.audioSession) return;
    try { navigator.audioSession.type = type; } catch (e) {}
  }
  function setCapture(state) {
    capturing = !!state;
    audioSessionType(capturing ? 'play-and-record' : (on ? 'playback' : 'auto'));
  }

  function set(state) {
    if (state && !capturing) audioSessionType('playback');
    if (state && !ctx && !init()) return;
    on = state;
    btn.setAttribute('aria-pressed', String(on));
    label.textContent = on ? 'Sound: On' : 'Sound: Off';
    if (!ctx) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    if (on) {
      ctx.resume();
      if (fileEl) { var pl = fileEl.play(); if (pl && pl.catch) pl.catch(function () {}); }
      else {
        next = Math.max(next, now + 0.05);
        pluckAt = Math.max(pluckAt, now + 0.8);
        clearInterval(timer); timer = setInterval(schedule, 250); schedule();
      }
      master.gain.setTargetAtTime(ducked ? 0 : VOLUME, now, 0.7);      // tona in (tyst medan mikrofonläget är öppet)
    } else {
      master.gain.setTargetAtTime(0, now, 0.25);          // tona ut
      clearInterval(timer);
      if (fileEl) setTimeout(function () { if (!on) fileEl.pause(); }, 1200);
    }
  }

  // ---- Ikonen: ett vridet "vortex"-band av tunna linjer ----------------
  var cv = document.getElementById('sound-vortex');
  if (cv && cv.getContext) {
    var cx = cv.getContext('2d'), CW = 34, CH = 16, STRANDS = 9;
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = CW * dpr; cv.height = CH * dpr; cx.scale(dpr, dpr);
    var energy = 0.18, phase = 0, lastT = null;
    var drawVortex = function (ms) {
      var dt = lastT === null ? 1 / 60 : Math.min(0.05, (ms - lastT) / 1000); lastT = ms;
      energy += ((on ? 1 : 0.18) - energy) * (1 - Math.exp(-dt * 3));   // mjuk övergång av/på
      phase += dt * (0.8 + energy * 2.6);                               // snabbare när ljudet är på
      cx.clearRect(0, 0, CW, CH);
      cx.lineWidth = 0.8;
      for (var s = 0; s < STRANDS; s++) {
        var off = (s / (STRANDS - 1) - 0.5) * 2;                        // -1 … 1 över bandet
        cx.beginPath();
        for (var x = 0; x <= CW; x += 1) {
          var u = x / CW;
          var env = Math.sin(u * Math.PI);                              // tunt i ändarna, brett i mitten
          var twist = Math.cos(u * Math.PI * 2.2 - phase * 0.9);        // vridningen som får bandet att korsa sig
          var wave = Math.sin(u * Math.PI * 2 + phase) * 0.55;          // bandets båge
          var y = CH / 2 + (wave + off * twist * 0.45) * env * (CH / 2 - 1.5) * (0.35 + energy * 0.65);
          if (x === 0) cx.moveTo(x, y); else cx.lineTo(x, y);
        }
        var g = cx.createLinearGradient(0, 0, CW, 0);
        var a = 0.35 + 0.6 * (1 - Math.abs(off) * 0.6);
        g.addColorStop(0, 'rgba(246,243,239,0)');
        g.addColorStop(0.5, 'rgba(246,243,239,' + a.toFixed(2) + ')');
        g.addColorStop(1, 'rgba(246,243,239,0)');
        cx.strokeStyle = g;
        cx.stroke();
      }
      if (!reduceMotion) requestAnimationFrame(drawVortex);
    };
    requestAnimationFrame(drawVortex);
    if (reduceMotion) btn.addEventListener('click', function () { setTimeout(function () { energy = on ? 1 : 0.18; lastT = null; drawVortex(performance.now()); }, 0); });
  }

  // ---- "Elektrisk stöt": kort knaster + surr, spelas bara när ljudet är på ----
  function zapKnaster() {
    if (!on || !ctx) return;
    var t0 = ctx.currentTime, dur = 0.16;
    var out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.22, t0 + 0.004);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    // högpassfilter: tar bort basen så att det blir ett ljust, torrt knaster
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400; hp.Q.value = 0.7;
    out.connect(hp); hp.connect(master);
    // knaster: brus genom ett smalt, hoppande bandpassfilter i diskanten
    var len = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.18 ? 1 : 0.2);
    var noise = ctx.createBufferSource(); noise.buffer = buf;
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 5;
    bp.frequency.setValueAtTime(4200, t0);
    for (var k = 1; k < 6; k++) bp.frequency.setValueAtTime(2600 + Math.random() * 4400, t0 + k * 0.025);
    noise.connect(bp); bp.connect(out);
    // lätt elektriskt surr, högt upp i registret
    var buzz = ctx.createOscillator(), bg = ctx.createGain();
    buzz.type = 'square';
    buzz.frequency.setValueAtTime(1600, t0);
    for (var j = 1; j < 6; j++) buzz.frequency.setValueAtTime(1100 + Math.random() * 1400, t0 + j * 0.022);
    bg.gain.value = 0.05;
    buzz.connect(bg); bg.connect(out);
    noise.start(t0); noise.stop(t0 + dur);
    buzz.start(t0); buzz.stop(t0 + dur);
  }
  // Gnista: oregelbundna skarpa klick + ett kort elektriskt "zzt" som sjunker i ton
  function zapGnista() {
    var t0 = ctx.currentTime + 0.005;
    var out = ctx.createGain(); out.gain.value = 0.22;
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1100; hp.Q.value = 0.6;
    var shaper = ctx.createWaveShaper(), curve = new Float32Array(256);
    for (var c = 0; c < 256; c++) { var xx = c / 128 - 1; curve[c] = Math.tanh(xx * 2.2); }
    shaper.curve = curve;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 8500;   // inte för vass
    out.connect(shaper); shaper.connect(hp); hp.connect(lp); lp.connect(master);

    // 1) gnistor: 5–8 mikroklick, 2–4 ms vardera, utspridda över ~90 ms
    var clicks = 5 + Math.floor(Math.random() * 4);
    for (var n = 0; n < clicks; n++) {
      var at = t0 + Math.pow(Math.random(), 1.6) * 0.09;
      var cl = 0.002 + Math.random() * 0.003, len = Math.ceil(ctx.sampleRate * cl);
      var b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
      var src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = b; g.gain.value = 0.25 + Math.random() * 0.45;
      src.connect(g); g.connect(out); src.start(at);
    }

    // 2) "zzt": ljus ton som brummar (frekvensmodulerad) och glider nedåt
    var tone = ctx.createOscillator(), mod = ctx.createOscillator(), modGain = ctx.createGain(), tg = ctx.createGain();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(2800, t0 + 0.012);
    tone.frequency.exponentialRampToValueAtTime(1150, t0 + 0.085);
    mod.type = 'square'; mod.frequency.value = 95;          // elektriskt brum
    modGain.gain.value = 420;
    mod.connect(modGain); modGain.connect(tone.frequency);
    tg.gain.setValueAtTime(0.0001, t0 + 0.01);
    tg.gain.exponentialRampToValueAtTime(0.09, t0 + 0.016);
    tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    tone.connect(tg); tg.connect(out);
    tone.start(t0 + 0.01); mod.start(t0 + 0.01);
    tone.stop(t0 + 0.1); mod.stop(t0 + 0.1);
  }

  function zap() {
    if (!on || !ctx) return;
    if (ZAP_STYLE === 'knaster') zapKnaster(); else zapGnista();
  }

  // Tyst musik medan mikrofonläget är öppet (evera-voice.js), så att mikrofonen inte hör den.
  // Påverkar inte ljudknappen: musiken tonar tillbaka när läget stängs.
  var ducked = false;
  function duck(d) {
    ducked = !!d;
    if (!ctx || !on) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.setTargetAtTime(ducked ? 0 : VOLUME, now, ducked ? 0.15 : 0.7);
  }

  window.everaSound = { zap: zap, duck: duck, setCapture: setCapture, isOn: function () { return on; } };

  var userChose = false;   // besökaren har själv tryckt på knappen: respektera det
  btn.addEventListener('click', function () { userChose = true; set(!on); });

  // Automatisk start vid första interaktionen var som helst på sidan
  if (AUTO_START) {
    var first = function (e) {
      if (userChose || on) return cleanup();
      if (e.target && e.target.closest && e.target.closest('#sound-toggle')) return cleanup();   // knappen sköter sig själv
      if (e.type === 'keydown' && (e.key === 'm' || e.key === 'M')) return cleanup();          // M sköter sig själv
      set(true);
      cleanup();
    };
    var cleanup = function () {
      ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.removeEventListener(ev, first, true); });
    };
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, first, true); });
  }
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) { userChose = true; set(!on); }
  });
  // Tyst när fliken inte syns, tillbaka när besökaren kommer tillbaka
  document.addEventListener('visibilitychange', function () {
    if (!ctx || !on) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });
})();
