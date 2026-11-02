/*
 * Evera – 3D-lutning av bakgrunden
 * När muspekaren rör sig från mitten mot en kant lutar bakgrunden lätt åt det hållet,
 * och loggan glider lite åt motsatt håll så att den känns som den svävar framför rummet.
 * Dator: följer muspekaren. Mobil/surfplatta: följer fingret medan man drar
 * över skärmen och glider tillbaka till mitten när man släpper.
 * Avstängt för den som valt minskad rörelse.
 */
(function () {
  'use strict';

  var MAX_Y = 4;     // grader åt höger/vänster
  var MAX_X = 2.5;   // grader uppåt/nedåt
  var FLOAT = 10;    // pixlar som loggan glider
  var EASE = 0.06;   // mjukhet (lägre = lugnare)

  var hero = document.querySelector('.hero');
  if (!hero) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;

  var tx = 0, ty = 0, x = 0, y = 0, running = false;

  function loop() {
    x += (tx - x) * EASE;
    y += (ty - y) * EASE;
    hero.style.setProperty('--tilt-y', (x * MAX_Y).toFixed(3) + 'deg');
    hero.style.setProperty('--tilt-x', (-y * MAX_X).toFixed(3) + 'deg');
    hero.style.setProperty('--float-x', (-x * FLOAT).toFixed(2) + 'px');
    hero.style.setProperty('--float-y', (-y * FLOAT * 0.6).toFixed(2) + 'px');
    if (Math.abs(tx - x) > 0.0005 || Math.abs(ty - y) > 0.0005) requestAnimationFrame(loop);
    else running = false;
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(loop); } }

  function aim(e) {
    tx = Math.max(-1, Math.min(1, (e.clientX / window.innerWidth) * 2 - 1));
    ty = Math.max(-1, Math.min(1, (e.clientY / window.innerHeight) * 2 - 1));
    kick();
  }
  function center() { tx = 0; ty = 0; kick(); }

  // Mus: följer pekaren hela tiden
  window.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') aim(e); }, { passive: true });
  document.documentElement.addEventListener('mouseleave', center);

  // Touch: följer fingret medan det ligger på skärmen
  var touching = false;
  hero.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') { touching = true; aim(e); } }, { passive: true });
  hero.addEventListener('pointermove', function (e) { if (touching && e.pointerType !== 'mouse') aim(e); }, { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
    hero.addEventListener(ev, function (e) { if (e.pointerType !== 'mouse') { touching = false; center(); } }, { passive: true });
  });
})();
