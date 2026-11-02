/*
 * Evera – den levande loggan
 * ---------------------------------------------------------------
 * E:et består av fem rundade staplar. Det står som ett E en kort stund,
 * glider sedan ut till en ljudvåg ("Flöde") och landar tillbaka som ett E.
 *
 * Används automatiskt på alla element med attributet data-evera:
 *   <h1 class="evera" aria-label="Evera" data-evera></h1>
 *
 * Inställningar (valfria) kan sättas direkt i HTML:
 *   data-hold-e="900"       hur länge E:et står still, i millisekunder
 *   data-hold-wave="2800"   hur länge ljudvågen spelar, i millisekunder
 *   data-mode="auto"        "auto" (växlar), "e" (alltid E) eller "wave" (alltid våg)
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // Mått i SVG-enheter: 5 staplar, tjocklek T, mellanrum G, maxlängd W
  var T = 14, G = 7.5, W = 84, H = 5 * T + 4 * G;
  var E_SHAPE = [1, T / W, 0.8, T / W, 1];        // arm, prick, mittarm, prick, arm
  var WAVE_SHAPE = [0.72, 0.9, 1, 0.9, 0.72];     // mittstapeln når längst
  var TEMPO = 1.25;                               // vågens hastighet
  var SWING = 1.3;                                // hur långt vågen når ut

  function everaLogo(host, opts) {
    var o = {
      mode: opts.mode || 'auto',
      holdE: (opts.holdE != null ? opts.holdE : 900) / 1000,
      holdWave: (opts.holdWave != null ? opts.holdWave : 2800) / 1000
    };

    // Bygg SVG:n med fem staplar och lägg "vera" efter
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('class', 'e');
    svg.setAttribute('aria-hidden', 'true');
    var bars = [];
    for (var i = 0; i < 5; i++) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('y', i * (T + G));
      r.setAttribute('height', T);
      r.setAttribute('rx', T / 2);
      r.setAttribute('x', 0);
      r.setAttribute('width', E_SHAPE[i] * W);
      svg.appendChild(r);
      bars.push({ el: r, mix: 0, vel: 0, to: 0, delay: 0 });
    }
    var word = document.createElement('span');
    word.textContent = 'vera';
    word.setAttribute('aria-hidden', 'true');
    host.textContent = '';
    host.appendChild(svg);
    host.appendChild(word);

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var t = 0, last = null, state = 'e', untilSwitch = o.holdE, amp = 0, ampVel = 0;

    function go(to) {
      state = to;
      bars.forEach(function (b, i) {
        b.to = to === 'wave' ? 1 : 0;
        // In i vågen leder översta stapeln, tillbaka till E leder den nedersta
        b.delay = reduce ? 0 : (to === 'wave' ? i * 0.09 : (4 - i) * 0.06);
      });
      untilSwitch = (to === 'wave' ? 1.6 : 1.1) + (to === 'wave' ? o.holdWave : o.holdE);
    }

    // Kritiskt dämpad fjäder: mjuk fart, inga ryck, ingen översvängning
    function spring(x, v, target, w, dt) {
      var f = 1 + 2 * dt * w, dtw2 = dt * w * w;
      var nv = (v + dtw2 * (target - x)) / (f + dt * dtw2);
      return [x + dt * nv, nv];
    }

    function draw() {
      for (var i = 0; i < 5; i++) {
        var b = bars[i], m = Math.min(1, Math.max(0, b.mix));
        var eLen = E_SHAPE[i] + (i === 2 ? 0.035 * Math.sin(t * 1.6) : 0);   // mittarmen andas lite
        var tw = t * TEMPO;
        var lvl = 0.8 * (0.5 + 0.5 * Math.sin(tw * 3.6 - i * 0.95)) + 0.2 * (0.5 + 0.5 * Math.sin(tw * 7.2 - i * 1.9));
        var shape = WAVE_SHAPE[i], calm = 0.5 * shape;
        var wLen = calm + ((0.14 + 0.86 * lvl) * shape - calm) * SWING * Math.max(0, amp);
        var len = (eLen + (wLen - eLen) * m) * W;
        var d = len - T;
        len = T + (d + Math.sqrt(d * d + 64 * m * m)) / 2;   // mjukt golv, staplarna studsar inte
        var x = ((W - len) / 2) * m;                          // vänsterställt som E, centrerat som våg
        b.el.setAttribute('x', x.toFixed(2));
        b.el.setAttribute('width', len.toFixed(2));
      }
    }

    function frame(ms) {
      var dt = last === null ? 1 / 60 : Math.min(0.05, (ms - last) / 1000);
      last = ms;
      t += dt;
      if (o.mode === 'auto') {
        untilSwitch -= dt;
        if (untilSwitch <= 0) go(state === 'e' ? 'wave' : 'e');
      }
      var s = spring(amp, ampVel, state === 'wave' ? 1 : 0, state === 'wave' ? 4.5 : 9, dt);
      amp = s[0]; ampVel = s[1];
      bars.forEach(function (b) {
        if (b.delay > 0) b.delay -= dt;
        else { var r = spring(b.mix, b.vel, b.to, b.to ? 4.5 : 6.5, dt); b.mix = r[0]; b.vel = r[1]; }
      });
      draw();
      requestAnimationFrame(frame);
    }

    if (o.mode === 'wave') go('wave');
    if (reduce) {
      // Minskad rörelse: visa ett stillastående E (eller en stillastående våg)
      var still = o.mode === 'wave' ? 1 : 0;
      bars.forEach(function (b) { b.mix = still; });
      amp = still;
      draw();
    } else {
      requestAnimationFrame(frame);
    }
  }

  function init() {
    var els = document.querySelectorAll('[data-evera]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      everaLogo(el, {
        mode: el.getAttribute('data-mode'),
        holdE: el.hasAttribute('data-hold-e') ? +el.getAttribute('data-hold-e') : null,
        holdWave: el.hasAttribute('data-hold-wave') ? +el.getAttribute('data-hold-wave') : null
      });
    }
  }

  window.everaLogo = everaLogo;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
