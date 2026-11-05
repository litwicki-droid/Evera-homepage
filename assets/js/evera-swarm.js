/*
 * Evera – röststyrd logga av partiklar
 * ---------------------------------------------------------------
 * Tusentals små kulor bygger Everas logga: fem rundade staplar som bildar E:et.
 * Rörelsen är samma som den levande loggan på startsidan (evera-logo.js),
 * men styrs av röst i stället för en klocka:
 *
 *  - Hela tiden: loggan snurrar runt sin lodräta axel.
 *  - Tyst: staplarna gör som loggan på startsidan, fast lugnare: E:et står en
 *    stund, glider ut till en mjuk ljudvåg och landar tillbaka som ett E.
 *  - Någon pratar: staplarna glider ut till en ljudvåg och följer rösten
 *    som en equalizer (fem frekvensband, mittstapeln = grundtonen).
 *    Samtidigt sveper en osynlig röstpekare över loggan: där den passerar
 *    lossnar kulorna, lyser upp och strömmar ut i slingor som rök i vatten.
 *  - Tystnad igen: vågen landar tillbaka som ett E, nedersta stapeln först.
 *
 *  Din röst (mikrofon) ger en sval ton, Everas röst (ljud/talsyntes) en varm.
 *  Följer INTE muspekaren. Ren WebGL2, inga bibliotek.
 *
 * Användning:
 *   var swarm = EveraSwarm.mount(document.querySelector('canvas'));
 *   swarm.listenMic();            // börja lyssna på mikrofonen
 *   swarm.stopMic();
 *   swarm.attachAudio(audioEl);   // Everas röst som <audio>-element (t.ex. TTS-fil)
 *   swarm.speak('Hej!', 'sv-SE'); // Everas röst via webbläsarens talsyntes
 *   swarm.setLevel('user'|'evera', 0..1); // egen nivå, t.ex. från en röst-API
 *   swarm.pause(); swarm.resume();        // stoppa/starta animationen (sparar batteri)
 *   swarm.setZoom(1.4);                   // ändra storlek medan den kör
 *   swarm.setLoop(true|false);            // slå på/av slingan
 *
 * Inställningar: EveraSwarm.mount(canvas, {
 *   shape: 'logo',    // 'logo' = Everas E, 'gear' = kugghjul (kuggarna rör sig som E:ets staplar)
 *   zoom: 1,          // >1 = större i bilden
 *   loop: false,      // true = sprids ut och samlas om och om igen
 *   loopHold: 5,      // sekunder som formen visas mellan varje utspridning
 *   gather: 0.9,      // sekunder för ihopsamlingen
 *   scatter: 0.75,    // sekunder för utspridningen
 *   rotate: 'spin',   // 'spin' = snurrar runt sin axel, 'swing' = pendlar fram och tillbaka
 *   spin: 0.8,        // radianer/sekund vid 'spin' (0 = stilla)
 *   swing: 62,        // grader åt varje håll vid 'swing'
 *   idleAmp: 0.5      // hur mycket vågen rör sig i vila (0–1)
 * })
 */
(function () {
  'use strict';

  var VERT = [
    '#version 300 es',
    'in vec3 aPos; in float aSpeed; in float aSize;',
    'uniform float uScale; uniform float uCam; uniform float uAspect; uniform float uF; uniform float uSize;',
    'out float vSpeed; out float vDepth;',
    'void main(){',
    '  vec3 p = aPos; float z = p.z - uCam;',
    '  gl_Position = vec4(p.x * uF / uAspect, p.y * uF, 0.0, -z);',
    '  gl_Position.z = (-z - 1.0) / 14.0 * gl_Position.w;',
    '  gl_PointSize = uSize * aSize * uF * uScale / -z;',
    '  vSpeed = aSpeed; vDepth = -z;',
    '}'
  ].join('\n');

  var FRAG = [
    '#version 300 es',
    'precision mediump float;',
    'in float vSpeed; in float vDepth;',
    'uniform vec3 uBase; uniform vec3 uTint; uniform float uTintAmt; uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;',
    'out vec4 o;',
    'void main(){',
    '  vec2 p = gl_PointCoord * 2.0 - 1.0; p.y = -p.y;',
    '  float r2 = dot(p, p); if (r2 > 1.0) discard;',
    '  vec3 n = vec3(p, sqrt(1.0 - r2));',
    '  vec3 L = normalize(vec3(-0.45, 0.65, 0.6));',
    '  float diff = max(dot(n, L), 0.0);',
    '  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 20.0);',
    '  float hot = clamp(vSpeed, 0.0, 1.0);',
    '  vec3 base = mix(uBase, uTint, uTintAmt * (0.25 + 0.75 * hot));',
    '  vec3 c = base * (0.32 + 0.78 * diff) + spec * (0.18 + 0.5 * hot) + hot * 0.22;',
    '  c = mix(c, vec3(1.0), hot * 0.7);', // uppvärmda kulor lyser vitt
    '  float fog = smoothstep(uFogNear, uFogFar, vDepth);',
    '  o = vec4(mix(c, uFog, fog * 0.75), 1.0);',
    '}'
  ].join('\n');

  function hex(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
  }

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }

  function mount(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: false });
    if (!gl) { canvas.setAttribute('data-swarm', 'unsupported'); return null; }

    var mobile = Math.min(screen.width, screen.height) < 700;
    var N = opts.count || (mobile ? 7000 : 14000);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var MOTION = reduce ? 0.35 : 1;

    var SHAPE = opts.shape === 'gear' ? 'gear' : 'logo';  // 'logo' = Everas E, 'gear' = kugghjul
    var ZOOM = opts.zoom || 1;                              // >1 = större i bilden
    var colBase = hex(opts.color || '#efe9e2');
    var colUser = hex(opts.userColor || '#9fd8ff');
    var colEvera = hex(opts.everaColor || '#e08a55');
    var colFog = hex(opts.fog || '#141a2b');

    // ---- loggans mått (samma som evera-logo.js) ----
    var T = 14, G = 7.5, W = 84, H = 5 * T + 4 * G, S = 2 / H;  // S: SVG-enheter -> världsenheter
    var E_SHAPE = [1, T / W, 0.8, T / W, 1];        // arm, prick, mittarm, prick, arm
    var WAVE_SHAPE = [0.72, 0.9, 1, 0.9, 0.72];     // mittstapeln når längst
    var SWING = 1.3;
    var BAND_OF_BAR = [3, 1, 0, 2, 4];              // mittstapeln får grundtonen

    // ---- kugghjulets mått (världsenheter) ----
    var GT = 8, RI = 0.36, RO = 0.70, GD = 0.13, TR = 0.13;  // kuggar, inner-/ytterradie, halvt djup, kuggens radie
    var TL_REST = 0.24, TL_CALM = 0.16;                     // kuggens längd i vila / i lugn våg
    var GEAR_BAND = [0, 1, 2, 3, 4, 3, 2, 1];               // frekvensband per kugge, symmetriskt runt ringen
    var NB = SHAPE === 'gear' ? GT : 5;                     // antal rörliga staplar/kuggar
    var ringA = null, ringR = null, ringZ = null, isRing = null;

    // ---- partiklar: var och en hör till en stapel och en plats i den ----
    var pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), off = new Float32Array(N * 3);
    var speed = new Float32Array(N), size = new Float32Array(N), seed = new Float32Array(N);
    var barOf = new Uint8Array(N), along = new Float32Array(N), scat = new Float32Array(N * 3);
    if (SHAPE === 'gear') { ringA = new Float32Array(N); ringR = new Float32Array(N); ringZ = new Float32Array(N); isRing = new Uint8Array(N); }
    for (var i = 0; i < N; i++) {
      barOf[i] = i % NB;
      if (SHAPE === 'gear' && Math.random() < 0.52) {
        // ringen: fram- och baksida, ytter- och innervägg
        isRing[i] = 1;
        var face = Math.random(), jit = (Math.random() - 0.5) * 0.03;
        ringA[i] = Math.random() * 6.2832;
        if (face < 0.565) { ringR[i] = Math.sqrt(RI * RI + Math.random() * (RO * RO - RI * RI)); ringZ[i] = (face < 0.2825 ? GD : -GD) + jit; }
        else if (face < 0.85) { ringR[i] = RO + jit; ringZ[i] = (Math.random() * 2 - 1) * GD; }
        else { ringR[i] = RI + jit; ringZ[i] = (Math.random() * 2 - 1) * GD; }
      }
      along[i] = Math.random();
      // punkt i ett klot (mest nära ytan) – stapeln blir en rundad kapsel
      var u = Math.random() * 2 - 1, th = Math.random() * 6.2832, rr = Math.sqrt(1 - u * u);
      var rad = 0.78 + 0.22 * Math.sqrt(Math.random());
      off[i * 3] = Math.cos(th) * rr * rad; off[i * 3 + 1] = Math.sin(th) * rr * rad; off[i * 3 + 2] = u * rad;
      // utspridd plats i hela rutan (-1..1, skalas mot synfältet varje bild)
      scat[i * 3] = Math.random() * 2 - 1; scat[i * 3 + 1] = Math.random() * 2 - 1; scat[i * 3 + 2] = Math.random() * 2 - 1;
      seed[i] = Math.random();
      size[i] = 0.75 + Math.random() * 0.5;
    }

    // ---- WebGL ----
    var prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);

    var vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    function buf(data, name, n, usage) {
      var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, usage);
      var loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0);
      return b;
    }
    var bPos = buf(pos, 'aPos', 3, gl.DYNAMIC_DRAW);
    var bSpeed = buf(speed, 'aSpeed', 1, gl.DYNAMIC_DRAW);
    buf(size, 'aSize', 1, gl.STATIC_DRAW);

    var U = {};
    ['uScale', 'uCam', 'uAspect', 'uF', 'uSize', 'uBase', 'uTint', 'uTintAmt', 'uFog', 'uFogNear', 'uFogFar'].forEach(function (n) { U[n] = gl.getUniformLocation(prog, n); });
    var CAM = 7.2 / ZOOM, F = 1 / Math.tan(17.5 * Math.PI / 180);
    gl.uniform1f(U.uCam, CAM); gl.uniform1f(U.uF, F);
    gl.uniform1f(U.uSize, opts.dotSize || 0.027);
    gl.uniform3fv(U.uBase, colBase); gl.uniform3fv(U.uFog, colFog);
    gl.uniform1f(U.uFogNear, CAM - 1.2); gl.uniform1f(U.uFogFar, CAM + 2.5);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(U.uAspect, canvas.width / canvas.height);
      // storlek på kulor i pixlar följer canvasens höjd
      gl.uniform1f(U.uScale, canvas.height / 2);
    }

    // ---- röstnivåer ----
    var src = {
      user: { manual: 0, analyser: null, data: null, level: 0, slow: 0 },
      evera: { manual: 0, analyser: null, data: null, level: 0, slow: 0, synth: 0 }
    };
    var actx = null;
    function audioCtx() {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      return actx;
    }
    function rms(s) {
      if (!s.analyser) return 0;
      s.analyser.getFloatTimeDomainData(s.data);
      var sum = 0; for (var k = 0; k < s.data.length; k++) sum += s.data[k] * s.data[k];
      var v = Math.sqrt(sum / s.data.length);
      return Math.min(1, Math.max(0, (v - 0.012) * 7));
    }
    function analyser(node) {
      var a = audioCtx().createAnalyser(); a.fftSize = 1024; a.smoothingTimeConstant = 0.6; node.connect(a);
      return a;
    }
    // fem frekvensband (Hz) för equalizer-staplarna
    var EDGES = [120, 320, 700, 1400, 2800, 6000];
    function bands(s, outArr) {
      if (!s.analyser) return false;
      var a = s.analyser;
      if (!s.freq) s.freq = new Uint8Array(a.frequencyBinCount);
      a.getByteFrequencyData(s.freq);
      var hz = a.context.sampleRate / a.fftSize;
      for (var b = 0; b < 5; b++) {
        var lo = Math.max(1, Math.floor(EDGES[b] / hz)), hi = Math.max(lo + 1, Math.floor(EDGES[b + 1] / hz)), sum = 0;
        for (var k = lo; k < hi; k++) sum += s.freq[k];
        var v = sum / (hi - lo) / 255;
        outArr[b] = Math.max(outArr[b], Math.min(1, Math.max(0, (v - 0.22) * 2.4)));
      }
      return true;
    }

    var micStream = null, micNode = null;
    function listenMic() {
      if (micStream) return Promise.resolve();
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error('Mikrofon stöds inte'));
      audioCtx();
      return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (s) {
        micStream = s;
        micNode = audioCtx().createMediaStreamSource(s);
        src.user.analyser = analyser(micNode);
        src.user.data = new Float32Array(src.user.analyser.fftSize);
      });
    }
    function stopMic() {
      if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
      if (micNode) micNode.disconnect();
      micStream = micNode = null; src.user.analyser = null; src.user.freq = null;
    }

    var attached = new WeakMap();
    function attachAudio(el) {
      if (attached.has(el)) return;
      var node = audioCtx().createMediaElementSource(el);
      node.connect(actx.destination);
      src.evera.analyser = analyser(node);
      src.evera.data = new Float32Array(src.evera.analyser.fftSize);
      attached.set(el, node);
    }

    // Talsyntes ger inget ljud att mäta, så rösten "spelas" med ett syntetiskt
    // stavelse-mönster medan Evera talar.
    var speaking = false, speakUntil = 0, burst = 0;
    function speak(text, lang) {
      var dur = Math.max(2, text.split(/\s+/).length * 0.38);
      speaking = true; speakUntil = performance.now() + dur * 1000;
      if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang || 'sv-SE'; u.rate = 1;
        var voices = speechSynthesis.getVoices().filter(function (v) { return v.lang && v.lang.indexOf((lang || 'sv').slice(0, 2)) === 0; });
        if (voices.length) u.voice = voices[0];
        u.onboundary = function () { burst = 1; };
        u.onstart = function () { speakUntil = Infinity; };
        u.onend = function () { speaking = false; };
        // vid fel (t.ex. inga röster) fortsätter rörelsen ändå under beräknad tid
        speechSynthesis.cancel(); speechSynthesis.speak(u);
      }
    }
    function setLevel(who, v) { if (src[who]) src[who].manual = Math.max(0, Math.min(1, v)); }

    // ---- simulering ----
    var userPaused = false;
    // ---- start/slinga: utspridd -> samlas -> visas -> sprids ut -> ... ----
    var LOOP = !!opts.loop, HOLD = opts.loopHold != null ? opts.loopHold : 5;
    var GATHER = opts.gather || 0.9, SCATTER = opts.scatter || 0.75, OUT = 0.5;  // sekunder
    var loopPhase = 'gather', loopT = 0, spread = 1, firstFrame = true;
    function ease(x) { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }
    var t = 0, last = performance.now(), running = true, tint = [0, 0, 0], tintAmt = 0;
    var heat = new Float32Array(N);
    var agents = {
      user: { phase: 0.0, off: 0.0, p: [0, 0, 0], v: [0, 0, 0], R: 0, S: 0, burst: 0 },
      evera: { phase: 2.0, off: 2.4, p: [0, 0, 0], v: [0, 0, 0], R: 0, S: 0, burst: 0 }
    };
    var agentList = [agents.user, agents.evera];

    // staplarnas tillstånd, som i evera-logo.js
    var bars = [];
    for (var bi = 0; bi < NB; bi++) bars.push({ mix: 0, vel: 0, to: 0, delay: 0, lvl: 0, x0: 0, len: 0, yc: 0 });
    var state = 'e', quiet = 0, amp = 0, ampVel = 0, tw = 0, gearSpin = 0;
    // vila: samma växling som loggan på startsidan (E 0,9 s, våg 2,8 s), fast lugnare
    var IDLE_HOLD_E = 0.9, IDLE_HOLD_WAVE = 2.8, IDLE_AMP = opts.idleAmp != null ? opts.idleAmp : 0.5;
    var idle = true, untilSwitch = 1.5;
    var band = [0, 0, 0, 0, 0];
    // 'spin' (standard): snurrar runt sin axel. 'swing': pendlar fram och tillbaka.
    var ROT = opts.rotate || 'spin';
    var SPIN = (opts.spin != null ? opts.spin : 0.8) * (reduce ? 0.3 : 1);  // vid 'spin': radianer/sekund (0.8 ≈ ett varv på 8 s)
    var SWING_DEG = (opts.swing != null ? opts.swing : 62) * (reduce ? 0.3 : 1); // vid 'swing': grader åt varje håll
    var yaw = 0, swingPh = 0;

    function go(to) {
      state = to;
      bars.forEach(function (b, i) {
        b.to = to === 'wave' ? 1 : 0;
        // in i vågen leder översta stapeln, tillbaka till E leder den nedersta
        if (SHAPE === 'gear') b.delay = reduce ? 0 : i * 0.05;  // vågen går runt ringen
        else b.delay = reduce ? 0 : (to === 'wave' ? i * 0.06 : (4 - i) * 0.06);
      });
    }
    // kritiskt dämpad fjäder: mjuk fart, ingen översvängning
    function spring(x, v, target, w, dt) {
      var f = 1 + 2 * dt * w, dtw2 = dt * w * w;
      var nv = (v + dtw2 * (target - x)) / (f + dt * dtw2);
      return [x + dt * nv, nv];
    }

    function follow(s, target, dt) {
      var k = target > s.level ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 5);
      s.level += (target - s.level) * k;
      s.slow += (s.level - s.slow) * (1 - Math.exp(-dt * 2));
    }

    // röstpekaren vandrar över loggan, fortare ju mer det pratas
    function moveAgent(a, lvl, onset, dt) {
      a.phase += dt * (0.8 + 5.5 * lvl);
      var ph = a.phase, o = a.off;
      // svep fram och tillbaka i sidled, långsammare upp och ned
      var x = Math.sin(ph * 1.0 + o) * 0.95, y = Math.sin(ph * 0.37 + o * 1.7) * 0.9, z = 0.1;
      if (dt > 0) { a.v[0] = (x - a.p[0]) / dt; a.v[1] = (y - a.p[1]) / dt; a.v[2] = 0; }
      a.p[0] = x; a.p[1] = y; a.p[2] = z;
      a.burst = Math.max(a.burst * Math.exp(-dt * 5), Math.min(1, onset * 2.5));
      a.R = 0.28 + 0.45 * lvl + 0.25 * a.burst;
      a.S = lvl * (0.8 + 0.7 * a.burst);
    }

    function step(now) {
      if (!running) return;
      var dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
      resize();

      // ---- röstnivåer ----
      var eSynth = 0;
      if (speaking) {
        if (now > speakUntil) speaking = false;
        burst *= Math.exp(-dt * 6);
        var syl = Math.abs(Math.sin(t * Math.PI * 4.3)) * (0.55 + 0.45 * Math.sin(t * 2.7) * Math.sin(t * 1.3 + 1));
        eSynth = Math.min(1, 0.25 + 0.55 * syl + 0.4 * burst);
      }
      follow(src.user, Math.max(src.user.manual, rms(src.user)), dt);
      follow(src.evera, Math.max(src.evera.manual, rms(src.evera), eSynth), dt);
      var lu = src.user.level * MOTION, le = src.evera.level * MOTION;
      var level = Math.max(lu, le);
      // kaos/ordning: varje ny stavelse sprider kulorna lite, mellan stavelserna drar de ihop sig
      // slingan: röst avbryter alltid och samlar formen
      loopT += dt;
      if (level > 0.08) { spread = Math.max(0, spread - dt * 2.2); loopPhase = 'hold'; loopT = 0; }
      else if (loopPhase === 'gather') { spread = 1 - ease(loopT / GATHER); if (loopT >= GATHER) { loopPhase = 'hold'; loopT = 0; } }
      else if (loopPhase === 'hold') { spread = Math.max(0, spread - dt * 2.2); if (LOOP && loopT >= HOLD) { loopPhase = 'scatter'; loopT = 0; } }
      else if (loopPhase === 'scatter') { spread = ease(loopT / SCATTER); if (loopT >= SCATTER) { loopPhase = 'out'; loopT = 0; } }
      else if (loopPhase === 'out') { spread = 1; if (loopT >= OUT) { loopPhase = 'gather'; loopT = 0; } }
      // synfältets halva höjd/bredd vid z = 0, för utspridda platser
      // styvare fjädrar medan kulorna sprids eller samlas, så att de hinner med
      var kMove = (loopPhase === 'gather' || loopPhase === 'scatter') ? 2.6 : 1;
      var hh = CAM / F * 0.92, hw = hh * canvas.width / Math.max(1, canvas.height), sDepth = 1.6;
      if (firstFrame) {
        firstFrame = false;
        for (var q0 = 0; q0 < N; q0++) { pos[q0 * 3] = scat[q0 * 3] * hw; pos[q0 * 3 + 1] = scat[q0 * 3 + 1] * hh; pos[q0 * 3 + 2] = scat[q0 * 3 + 2] * sDepth; }
      }

      var pulse = (Math.max(0, lu - src.user.slow) + Math.max(0, le - src.evera.slow)) * MOTION;
      moveAgent(agents.user, lu, Math.max(0, lu - src.user.slow), dt);
      moveAgent(agents.evera, le, Math.max(0, le - src.evera.slow), dt);

      var wu = lu / (lu + le + 1e-4), wt = Math.min(0.7, level * 1.4);
      for (var c = 0; c < 3; c++) tint[c] = colUser[c] * wu + colEvera[c] * (1 - wu);
      tintAmt += (wt - tintAmt) * (1 - Math.exp(-dt * 4));

      // ---- E <-> ljudvåg ----
      // Röst: full våg som följer rösten. Tyst: loggans egen lugna växling, som på startsidan.
      if (level > 0.08) { quiet = 0; idle = false; if (state !== 'wave') go('wave'); }
      else {
        quiet += dt;
        if (!idle && quiet > 0.7) { idle = true; go('e'); untilSwitch = 1.1 + IDLE_HOLD_E; }
        if (idle && !reduce) {
          untilSwitch -= dt;
          if (untilSwitch <= 0) {
            go(state === 'e' ? 'wave' : 'e');
            untilSwitch = state === 'wave' ? 1.6 + IDLE_HOLD_WAVE : 1.1 + IDLE_HOLD_E;
          }
        }
      }
      var ampTo = state === 'wave' ? (idle ? IDLE_AMP : 1) : 0;
      var sa = spring(amp, ampVel, ampTo, state === 'wave' ? (idle ? 4.5 : 6) : 9, dt);
      amp = sa[0]; ampVel = sa[1];

      band[0] = band[1] = band[2] = band[3] = band[4] = 0;
      var real = bands(src.user, band);
      real = bands(src.evera, band) || real;
      tw += dt * (idle ? 1.25 : 0.6 + 1.6 * level);  // vila: loggans tempo, röst: tempot följer rösten

      var gearRot = 0;
      if (SHAPE === 'gear') { gearSpin += dt * (0.25 + 0.7 * level); gearRot = gearSpin; }
      for (var b = 0; b < NB; b++) {
        var B = bars[b];
        if (B.delay > 0) B.delay -= dt;
        else { var r2 = spring(B.mix, B.vel, B.to, B.to ? 5.5 : 6.5, dt); B.mix = r2[0]; B.vel = r2[1]; }
        // stapelns ljudnivå: riktiga frekvensband om de finns, annars loggans vågmönster gånger rösten
        var phA = SHAPE === 'gear' ? b * 6.2832 / GT : b * 0.95, phB = SHAPE === 'gear' ? b * 12.566 / GT : b * 1.9;
        var pat = 0.8 * (0.5 + 0.5 * Math.sin(tw * 3.6 - phA)) + 0.2 * (0.5 + 0.5 * Math.sin(tw * 7.2 - phB));
        var target;
        if (idle) target = pat;  // vila: loggans lugna ljudstapelmönster
        else {
          var bandIx = SHAPE === 'gear' ? GEAR_BAND[b] : BAND_OF_BAR[b];
          target = real ? Math.max(band[bandIx] * MOTION, pat * level * 0.5) : pat * Math.min(1, level * 1.4);
          target = Math.sqrt(Math.min(1, target));  // når längre ut även vid lugnt tal
          if (state === 'wave') target = Math.max(target, 0.4);  // vågen vilar i mellanläge i korta pauser
        }
        B.lvl += (target - B.lvl) * (1 - Math.exp(-dt * (target > B.lvl ? 22 : 7)));

        var m = Math.min(1, Math.max(0, B.mix));
        if (SHAPE === 'gear') {
          // kuggen: vanlig längd i vila, i vågen följer den mönstret/rösten
          var gw = TL_CALM + ((0.04 + 0.62 * B.lvl) - TL_CALM) * Math.max(0, amp);
          B.len = Math.max(0, TL_REST + (gw - TL_REST) * m);
          B.x0 = b * 6.2832 / GT + gearRot;  // kuggens vinkel
          continue;
        }
        var eLen = E_SHAPE[b] + (b === 2 ? 0.035 * Math.sin(t * 1.6) : 0);  // mittarmen andas
        var shape = WAVE_SHAPE[b], calm = 0.5 * shape;
        var wLen = calm + ((0.14 + 0.86 * B.lvl) * shape - calm) * SWING * Math.max(0, amp);
        var len = (eLen + (wLen - eLen) * m) * W;
        var d = len - T;
        len = T + (d + Math.sqrt(d * d + 64 * m * m)) / 2;               // mjukt golv
        var x = ((W - len) / 2) * m;                                       // vänster som E, centrerad som våg
        B.x0 = x; B.len = len; B.yc = b * (T + G) + T / 2;
      }

      // loggan snurrar runt sin axel (eller pendlar), lite fortare när någon pratar
      if (ROT === 'spin') yaw += dt * SPIN * (1 + 0.6 * level);
      else { swingPh += dt * (1.8 + 0.8 * level); yaw = Math.sin(swingPh) * SWING_DEG * Math.PI / 180; }
      var pitch = Math.sin(t * 0.45) * 0.08;
      var cy0 = Math.cos(yaw), sy0 = Math.sin(yaw), cp = Math.cos(pitch), sp0 = Math.sin(pitch);
      var K = 14, damp = Math.exp(-dt * 3.2), cool = Math.exp(-dt * 1.9);
      var FQ = 1.8, FLOW = 8, ft = t * 1.2, HR = T / 2;
      var gScale = 1 + 0.015 * Math.sin(t * 1.6) + 0.04 * le;  // ringen andas lätt, lite mer när Evera talar

      for (var i = 0, j = 0; i < N; i++, j += 3) {
        var sd = seed[i], Bp = bars[barOf[i]], lx, ly, lz;
        if (SHAPE === 'gear') {
          if (isRing[i]) {
            var ra = ringA[i] + gearRot, rr0 = ringR[i] * gScale;
            lx = Math.cos(ra) * rr0; ly = Math.sin(ra) * rr0; lz = ringZ[i];
          } else {
            // kuggen: kapsel från ringens kant och utåt
            var ta = Bp.x0, tr = (RO - 0.06) * gScale + along[i] * Bp.len;
            lx = Math.cos(ta) * tr + off[j] * TR; ly = Math.sin(ta) * tr + off[j + 1] * TR; lz = off[j + 2] * TR;
          }
        } else {
          // målpunkt i stapelns kapsel (SVG-enheter -> värld)
          var sx = Bp.x0 + HR + along[i] * (Bp.len - T) + off[j] * HR;
          var sy = Bp.yc + off[j + 1] * HR;
          lx = (sx - W / 2) * S; ly = (H / 2 - sy) * S; lz = off[j + 2] * HR * S;
        }
        // vridning
        var rx = lx * cy0 + lz * sy0, rz = -lx * sy0 + lz * cy0;
        var ty = ly * cp - rz * sp0, tz = ly * sp0 + rz * cp, tx = rx;
        if (spread > 0.001) {
          // kulorna lämnar/når formen lite olika fort, så det blir ett flöde
          var mi = ease(spread * 1.45 - sd * 0.45);
          tx += (scat[j] * hw - tx) * mi; ty += (scat[j + 1] * hh - ty) * mi; tz += (scat[j + 2] * sDepth - tz) * mi;
        }

        var px = pos[j], py = pos[j + 1], pz = pos[j + 2];
        var vx = vel[j], vy = vel[j + 1], vz = vel[j + 2];
        var h = heat[i] * cool;

        for (var q = 0; q < 2; q++) {
          var A = agentList[q];
          if (A.S < 0.01) continue;
          var dx = px - A.p[0], dy = py - A.p[1], dz = pz - A.p[2];
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= A.R * A.R) continue;
          var dd = Math.sqrt(d2) + 1e-5, w = 1 - dd / A.R; w *= w * (0.5 + sd);
          h += w * A.S * dt * 10;
          var push = w * A.S * dt * 10;
          vx += (dx / dd * 0.4 + A.v[0] * 0.35) * push;
          vy += (dy / dd * 0.4 + A.v[1] * 0.35) * push;
          vz += (dz / dd * 0.4 + 0.5) * push;
        }
        if (pulse > 0.02) {
          var pk = pulse * 7 * dt * (0.3 + sd);
          vx += off[j] * pk; vy += off[j + 1] * pk; vz += off[j + 2] * pk;
          h += pulse * dt * 1.5;
        }
        if (h > 1) h = 1;
        heat[i] = h;

        // olika styvhet per kula: några släpar efter i svängarna, det ger flöde
        var k = K * (0.35 + 0.9 * sd) * (1 - 0.93 * h) * kMove;
        var ax = (tx - px) * k, ay = (ty - py) * k, az = (tz - pz) * k;
        if (h > 0.02) {
          // virvelfält utan källor (curl av ett sinusfält) ger rökliknande slingor
          var cx = -FQ * 1.3 * Math.sin(FQ * 1.3 * py + ft * 0.75) - FQ * Math.cos(FQ * pz + ft * 0.83);
          var cyy = -FQ * 1.3 * Math.sin(FQ * 1.3 * pz - ft * 0.67) - FQ * Math.cos(FQ * px - ft * 1.17);
          var cz = -FQ * 1.3 * Math.sin(FQ * 1.3 * px + ft * 0.5) - FQ * Math.cos(FQ * py + ft);
          var fl = FLOW * h * 0.25;
          ax += cx * fl; ay += cyy * fl + h * 1.0; az += cz * fl + h * 0.4;
        }
        var ph = sd * 6.283;
        ax += Math.sin(t * 1.9 + ph) * 0.06; ay += Math.cos(t * 1.5 + ph * 1.3) * 0.06; az += Math.sin(t * 1.7 + ph * 0.7) * 0.06;

        vx = (vx + ax * dt) * damp; vy = (vy + ay * dt) * damp; vz = (vz + az * dt) * damp;
        vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz;
        pos[j] = px + vx * dt; pos[j + 1] = py + vy * dt; pos[j + 2] = pz + vz * dt;
        var spd = Math.sqrt(vx * vx + vy * vy + vz * vz) * 0.3;
        speed[i] = h > spd ? h : spd;
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
      gl.bindBuffer(gl.ARRAY_BUFFER, bSpeed); gl.bufferSubData(gl.ARRAY_BUFFER, 0, speed);
      gl.uniform3fv(U.uTint, tint); gl.uniform1f(U.uTintAmt, tintAmt);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, N);
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) running = false;
      else if (!running && !userPaused) { running = true; last = performance.now(); requestAnimationFrame(step); }
    });

    return {
      listenMic: listenMic, stopMic: stopMic, attachAudio: attachAudio, speak: speak, setLevel: setLevel,
      setZoom: function (z) {
        CAM = 7.2 / (z || 1);
        gl.useProgram(prog); gl.uniform1f(U.uCam, CAM);
        gl.uniform1f(U.uFogNear, CAM - 1.2); gl.uniform1f(U.uFogFar, CAM + 2.5);
      },
      setLoop: function (on) { LOOP = !!on; if (!LOOP && loopPhase !== 'gather') { loopPhase = 'hold'; loopT = 0; } },
      pause: function () { userPaused = true; running = false; },
      resume: function () { userPaused = false; if (!running && !document.hidden) { running = true; last = performance.now(); requestAnimationFrame(step); } },
      get levels() { return { user: src.user.level, evera: src.evera.level }; }
    };
  }

  window.EveraSwarm = { mount: mount };
})();
