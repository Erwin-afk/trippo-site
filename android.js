'use strict';
/*
 * Trippo is iPhone-only for now, and most Hungarian phones are Android. On an Android phone:
 * - App Store links (after launch) become "Androidra is szólunk" links to the newsletter box,
 *   instead of sending people to a store page they can't use;
 * - the homepage hero gets one line saying so;
 * - a newsletter sign-up from this phone is tagged `android` (signup.js), so we can see how many
 *   people wait for the Android version.
 * Reads only the browser's own user agent; nothing is stored.
 */
(() => {
  if (!/Android/i.test(navigator.userAgent)) return;
  document.documentElement.dataset.android = '1';
  const run = () => {
    document.querySelectorAll('a[href*="apps.apple.com"]').forEach((a) => {
      a.href = '/#hirlevel';
      if (a.classList.contains('btn') || a.classList.contains('bar-cta') || a.classList.contains('sheet-cta')) a.textContent = 'Androidra is szólunk';
    });
    const cta = document.querySelector('.hero-home .cta');
    if (cta && !document.querySelector('.android-note')) {
      const note = document.createElement('p');
      note.className = 'android-note';
      note.textContent = 'Androidos telefonod van? A Trippo most iPhone-ra érhető el. Iratkozz fel, és szólunk, amikor Androidra is kész.';
      cta.after(note);
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
