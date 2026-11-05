/*
 * Evera – röststyrd partikelsvärm
 * ---------------------------------------------------------------
 * Tusentals små kulor bildar en levande form som andas lugnt i vila.
 * När någon pratar sveper en osynlig röstpekare över formen: där den passerar
 * lossnar kulorna, lyser upp och strömmar ut i slingor som rök i vatten,
 * för att sedan söka sig tillbaka. Rösten styr storlek, styrka och tempo.
 *
 *  - Din röst (mikrofon): svalt ljus, kulorna sprids utåt.
 *  - Everas röst (uppspelat ljud / talsyntes): varm ton, vågor över ytan.
 *
 * Följer INTE muspekaren – bara röst in och röst ut.
 * Ren WebGL2, inga bibliotek. Egen kod, inget innehåll från andra sajter.
 *
 * Användning:
 *   var swarm = EveraSwarm.mount(document.querySelector('canvas'));
 *   swarm.listenMic();            // börja lyssna på mikrofonen
 *   swarm.stopMic();
 *   swarm.attachAudio(audioEl);   // Everas röst som <audio>-element (t.ex. TTS-fil)
 *   swarm.speak('Hej!', 'sv-SE'); // Everas röst via webbläsarens talsyntes
 *   swarm.setLevel('user'|'evera', 0..1); // egen nivå, t.ex. från en röst-API
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

    var colBase = hex(opts.color || '#d8dce5');
    var colUser = hex(opts.userColor || '#9fd8ff');
    var colEvera = hex(opts.everaColor || '#e08a55');
    var colFog = hex(opts.fog || '#141a2b');

    // ---- partiklar ----
    var base = new Float32Array(N * 3), pos = new Float32Array(N * 3), vel = new Float32Array(N * 3);
    var speed = new Float32Array(N), size = new Float32Array(N), seed = new Float32Array(N);
    var GOLD = Math.PI * (3 - Math.sqrt(5));
    for (var i = 0; i < N; i++) {
      var y = 1 - (i + 0.5) / N * 2, rr = Math.sqrt(1 - y * y), th = GOLD * i;
      // de flesta på ytan, några en bit inåt så formen känns fyllig
      var depth = 1 - 0.22 * Math.pow(Math.random(), 2.5);
      // lätt ägg-/droppform i stället för perfekt klot
      var sx = Math.cos(th) * rr, sz = Math.sin(th) * rr, sy = y * 1.12 - 0.08 * (1 - y * y);
      base[i * 3] = sx * depth; base[i * 3 + 1] = sy * depth; base[i * 3 + 2] = sz * depth;
      pos[i * 3] = base[i * 3] * 3 * Math.random(); pos[i * 3 + 1] = base[i * 3 + 1] * 3 * Math.random(); pos[i * 3 + 2] = base[i * 3 + 2] * 3 * Math.random();
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
    var CAM = 7.2, F = 1 / Math.tan(17.5 * Math.PI / 180);
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
      var a = audioCtx().createAnalyser(); a.fftSize = 1024; node.connect(a);
      return a;
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
      micStream = micNode = null; src.user.analyser = null;
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
    // Varje röst styr en osynlig "pekare" som vandrar över formen. Där den
    // passerar värms kulorna upp: de lossnar, lyser vitt och strömmar ut i
    // slingor längs ett virvelfält (som rök i vatten). När värmen klingar av
    // drar fjädern dem tillbaka till formen.
    var t = 0, last = performance.now(), running = true, tint = [0, 0, 0], tintAmt = 0;
    var wave = [0, 1, 0], ripplePhase = 0;
    var heat = new Float32Array(N);
    var agents = {
      user: { phase: 0.0, off: 0.0, p: [0, 0, 1], v: [0, 0, 0], R: 0, S: 0, burst: 0 },
      evera: { phase: 2.0, off: 2.4, p: [0, 0, 1], v: [0, 0, 0], R: 0, S: 0, burst: 0 }
    };
    var agentList = [agents.user, agents.evera];

    function follow(s, target, dt) {
      var k = target > s.level ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 5);
      s.level += (target - s.level) * k;
      s.slow += (s.level - s.slow) * (1 - Math.exp(-dt * 2));
    }

    // Vandrar över framsidan av formen; fortare ju mer det pratas, som en hand som sveper.
    function moveAgent(a, lvl, onset, dt) {
      a.phase += dt * (0.2 + 2.4 * lvl);
      var ph = a.phase, o = a.off;
      var x = Math.sin(ph * 1.0 + o) * 0.85, y = Math.sin(ph * 0.77 + o * 1.7) * 0.8, z = 0.55 + 0.35 * Math.cos(ph * 0.53 + o);
      var l = Math.hypot(x, y, z), r = 1.02;
      x = x / l * r; y = y / l * r; z = z / l * r;
      if (dt > 0) { a.v[0] = (x - a.p[0]) / dt; a.v[1] = (y - a.p[1]) / dt; a.v[2] = (z - a.p[2]) / dt; }
      a.p[0] = x; a.p[1] = y; a.p[2] = z;
      a.burst = Math.max(a.burst * Math.exp(-dt * 5), Math.min(1, onset * 2.5));
      a.R = 0.28 + 0.5 * lvl + 0.3 * a.burst;
      a.S = lvl * (0.7 + 0.6 * a.burst);
    }

    function step(now) {
      if (!running) return;
      var dt = Math.min(0.033, (now - last) / 1000); last = now; t += dt;
      resize();

      // nivåer
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
      moveAgent(agents.user, lu, Math.max(0, lu - src.user.slow), dt);
      moveAgent(agents.evera, le, Math.max(0, le - src.evera.slow), dt);

      // färgton efter vem som pratar
      var wu = lu / (lu + le + 1e-4), wt = Math.min(0.7, level * 1.4);
      for (var c = 0; c < 3; c++) tint[c] = colUser[c] * wu + colEvera[c] * (1 - wu);
      tintAmt += (wt - tintAmt) * (1 - Math.exp(-dt * 4));

      // Everas röst: mjuka vågor över hela ytan
      wave[0] = Math.sin(t * 0.31); wave[1] = Math.cos(t * 0.23); wave[2] = Math.sin(t * 0.17 + 2);
      var wl = Math.hypot(wave[0], wave[1], wave[2]); wave[0] /= wl; wave[1] /= wl; wave[2] /= wl;
      ripplePhase += dt * (3 + 9 * le);

      var ang = t * 0.12, ca = Math.cos(ang), sa = Math.sin(ang);
      var breath = 0.025 * Math.sin(t * 0.9) + 0.035 * le;
      var K = 8, damp = Math.exp(-dt * 1.8), cool = Math.exp(-dt * 0.9);
      var FQ = 1.5, FLOW = 5.0, ft = t * 0.5;

      for (var i = 0, j = 0; i < N; i++, j += 3) {
        var bx = base[j], by = base[j + 1], bz = base[j + 2], sd = seed[i];
        var x = bx * ca - bz * sa, z = bx * sa + bz * ca, y = by;
        var n = Math.sin(x * 2.3 + t * 0.7) * Math.sin(y * 2.1 - t * 0.55) * Math.sin(z * 2.5 + t * 0.6);
        var rip = Math.sin((bx * wave[0] + by * wave[1] + bz * wave[2]) * 7 - ripplePhase) * 0.06 * le;
        var r = 1 + breath + 0.05 * n + rip;
        var tx = x * r, ty = y * r, tz = z * r;

        var px = pos[j], py = pos[j + 1], pz = pos[j + 2];
        var vx = vel[j], vy = vel[j + 1], vz = vel[j + 2];
        var h = heat[i] * cool;

        // röstpekarna värmer upp och knuffar kulorna de passerar
        for (var q = 0; q < 2; q++) {
          var A = agentList[q];
          if (A.S < 0.01) continue;
          var dx = px - A.p[0], dy = py - A.p[1], dz = pz - A.p[2];
          var d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= A.R * A.R) continue;
          var d = Math.sqrt(d2) + 1e-5, w = 1 - d / A.R; w *= w * (0.5 + sd);
          h += w * A.S * dt * 7;
          var push = w * A.S * dt * 7;
          vx += (dx / d * 0.45 + A.v[0] * 0.35) * push;
          vy += (dy / d * 0.45 + A.v[1] * 0.35) * push;
          vz += (dz / d * 0.45 + A.v[2] * 0.35) * push;
        }
        if (h > 1) h = 1;
        heat[i] = h;

        // fjäder mot formen: nästan släppt där det är varmt
        var k = K * (1 - 0.92 * h);
        var ax = (tx - px) * k, ay = (ty - py) * k, az = (tz - pz) * k;

        if (h > 0.02) {
          // virvelfält utan källor (curl av ett sinusfält) ger rökliknande slingor
          var cx = -FQ * 1.3 * Math.sin(FQ * 1.3 * py + ft * 0.75) - FQ * Math.cos(FQ * pz + ft * 0.83);
          var cy = -FQ * 1.3 * Math.sin(FQ * 1.3 * pz - ft * 0.67) - FQ * Math.cos(FQ * px - ft * 1.17);
          var cz = -FQ * 1.3 * Math.sin(FQ * 1.3 * px + ft * 0.5) - FQ * Math.cos(FQ * py + ft);
          var fl = FLOW * h;
          ax += cx * fl * 0.25 + px * h * 0.45;
          ay += cy * fl * 0.25 + py * h * 0.45 + h * 0.7;  // slingorna stiger lätt, som rök
          az += cz * fl * 0.25 + pz * h * 0.45;
        }
        // stilla vickning i vila så att formen lever
        var ph = sd * 6.283;
        ax += Math.sin(t * 1.9 + ph) * 0.08; ay += Math.cos(t * 1.5 + ph * 1.3) * 0.08; az += Math.sin(t * 1.7 + ph * 0.7) * 0.08;

        vx = (vx + ax * dt) * damp; vy = (vy + ay * dt) * damp; vz = (vz + az * dt) * damp;
        vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz;
        pos[j] = px + vx * dt; pos[j + 1] = py + vy * dt; pos[j + 2] = pz + vz * dt;
        var sp = Math.sqrt(vx * vx + vy * vy + vz * vz) * 0.35;
        speed[i] = h > sp ? h : sp;
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
      else if (!running) { running = true; last = performance.now(); requestAnimationFrame(step); }
    });

    return {
      listenMic: listenMic, stopMic: stopMic, attachAudio: attachAudio, speak: speak, setLevel: setLevel,
      get levels() { return { user: src.user.level, evera: src.evera.level }; }
    };
  }

  window.EveraSwarm = { mount: mount };
})();
