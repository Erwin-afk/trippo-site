'use strict';
/* Homepage motion: sections ease in as they scroll into view. Without JS, or with reduced motion, everything is simply there. */
(() => {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  document.documentElement.classList.add('js');

  document.addEventListener('DOMContentLoaded', () => {
    const groups = ['.steps-home li', '.split > *', '.price', '.ticks li'];
    const single = ['.section .title', '.section .lead', '.band', '.film-wrap', '.saver', '.compare-wrap'];
    const seen = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add('in');
          seen.unobserve(e.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    const watch = (el, i = 0) => {
      el.classList.add('reveal');
      el.style.setProperty('--delay', `${Math.min(i, 4) * 70}ms`);
      seen.observe(el);
    };
    single.forEach((s) => document.querySelectorAll(s).forEach((el) => watch(el)));
    groups.forEach((s) => document.querySelectorAll(s).forEach(watch));

    const bar = document.querySelector('.bar');
    const onScroll = () => bar.classList.toggle('scrolled', window.scrollY > 8);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  });
})();

/* Phone menu: a same-page link (#arak) leaves the page where it is, so close the sheet; Esc closes it too. */
document.addEventListener('DOMContentLoaded', () => {
  const menu = document.querySelector('.menu');
  if (!menu) return;
  menu.querySelectorAll('.sheet a').forEach((a) => a.addEventListener('click', () => (menu.open = false)));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.open = false;
  });
});

/* Film: plays silently while in view. With reduced motion it waits for a press on the controls. */
document.addEventListener('DOMContentLoaded', () => {
  const film = document.getElementById('film');
  const toggle = document.getElementById('film-toggle');
  if (!film || !toggle) return;
  if (matchMedia('(max-width: 760px)').matches) film.poster = film.dataset.posterTall;
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  film.controls = false;
  toggle.hidden = false;
  let paused = false;
  const label = () => (toggle.textContent = paused ? 'Lejátszás' : 'Szünet');
  toggle.addEventListener('click', () => {
    paused = !paused;
    label();
    if (paused) film.pause();
    else film.play().catch(() => {});
  });
  new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) film.pause();
      else if (!paused) {
        film.preload = 'auto';
        film.play().catch(() => {});
      }
    },
    { threshold: 0.35 },
  ).observe(film);
});

/* Savings slider: same sum as the app, with the latest NAV price (live from nav-prices.js). */
document.addEventListener('DOMContentLoaded', () => {
  const km = document.getElementById('saver-km');
  const car = document.getElementById('saver-car');
  if (!km || !car) return;
  // Printed fallback until the live prices arrive.
  const PRICE = { p: 639, d: 712 };
  const RATE = 15;
  const money = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const result = document.querySelector('.saver-result');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Counts each sum from what it shows now to the new one; screen readers hear only the end (aria-busy).
  const shown = new Map();
  const frames = new Map();
  const countTo = (id, target) => {
    const el = document.getElementById(id);
    const from = shown.has(id) ? shown.get(id) : target;
    cancelAnimationFrame(frames.get(id));
    if (still || from === target) {
      shown.set(id, target);
      el.textContent = money(target) + ' Ft';
      return;
    }
    result.setAttribute('aria-busy', 'true');
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 450);
      const value = from + (target - from) * (1 - Math.pow(1 - t, 3));
      shown.set(id, value);
      el.textContent = money(value) + ' Ft';
      if (t < 1) frames.set(id, requestAnimationFrame(step));
      else result.removeAttribute('aria-busy');
    };
    frames.set(id, requestAnimationFrame(step));
  };
  const paint = () => {
    const [norm, fuel] = car.value.split(':');
    const kms = Number(km.value);
    const month = Math.floor((kms * Number(norm) * PRICE[fuel] * 100 + 50000) / 100000) + kms * RATE;
    km.style.setProperty('--fill', ((kms - km.min) / (km.max - km.min)) * 100 + '%');
    document.getElementById('saver-km-text').textContent = money(kms) + ' km';
    countTo('saver-month', month);
    countTo('saver-year', month * 12);
  };
  km.addEventListener('input', paint);
  car.addEventListener('change', paint);
  paint();
  if (!window.navPrices) return;
  window.navPrices.then((months) => {
    if (!months) return;
    const latest = months[0];
    PRICE.p = window.navApplied(latest, 'petrol');
    PRICE.d = window.navApplied(latest, 'diesel');
    const label = document.getElementById('saver-price-month');
    if (label) label.textContent = `${latest.month.slice(0, 4)}. ${window.navMonth(latest.month, 'adjective')}`;
    paint();
  });
});
