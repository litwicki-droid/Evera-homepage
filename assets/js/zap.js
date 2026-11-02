/*
 * Evera – "elektrisk stöt" på den orange rutan
 * När muspekaren når rutan (eller man trycker på den på mobil) darrar den diskret
 * i ~0,25 sekunder med störningar i texten. Är ljudet på hörs ett kort knaster.
 * Utseendet styrs i assets/css/main.css (.pill.is-zap), ljudet i sound.js (zap).
 */
(function () {
  'use strict';
  var pill = document.querySelector('.pill');
  if (!pill) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var busy = false, last = 0;

  function fire() {
    var now = Date.now();
    if (busy || now - last < 450) return;      // inte oftare än ungefär två gånger per sekund
    last = now;
    if (window.everaSound) window.everaSound.zap();
    if (reduce) return;
    busy = true;
    pill.classList.remove('is-zap');
    void pill.offsetWidth;                      // starta om animationen
    pill.classList.add('is-zap');
    setTimeout(function () { pill.classList.remove('is-zap'); busy = false; }, 280);
  }

  pill.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') fire(); });
  pill.addEventListener('pointerdown', fire);   // mobil: tryck på rutan
})();
