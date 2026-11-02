/*
 * Evera – övrig sidlogik
 * Pausar bakgrundsfilmen när fliken inte syns (sparar batteri och data)
 * och startar den igen när besökaren kommer tillbaka.
 */
(function () {
  'use strict';

  var video = document.querySelector('.hero__video');
  if (!video) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { video.pause(); return; }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) video.pause();
    else {
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* webbläsaren tillät inte uppspelning, posterbilden visas */ });
    }
  });
})();
