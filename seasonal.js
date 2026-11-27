'use strict';
/*
 * Small seasonal touches, each only in its own dates (the visitor's local date), each gone by itself:
 * - 20 Dec – 5 Jan: a strip above the header about the 31 December odometer reading (closable);
 * - 1 – 26 Dec: a very light snowfall over the homepage hero (never with reduced motion);
 * - 18 Dec – 2 Jan: holiday support hours on Támogatás and above every footer;
 * - January: a "Kezdd jól az évet" card on the homepage.
 * Preview any day with ?szezon=2026-12-28. Nothing is sent anywhere; the strip remembers its "close"
 * on this device only. Styles are classes in style.css (the CSP allows no inline style attributes).
 */
(() => {
  const preview = new URLSearchParams(location.search).get('szezon');
  const now = preview && /^\d{4}-\d{2}-\d{2}$/.test(preview) ? new Date(`${preview}T12:00:00`) : new Date();
  const md = (now.getMonth() + 1) * 100 + now.getDate();
  // A window may wrap the new year (1220–105).
  const within = (from, to) => (from <= to ? md >= from && md <= to : md >= from || md <= to);
  const page = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const home = page === '/' || page === '/index';
  // The year being closed: December's own year, or last year in early January.
  const closing = now.getMonth() === 11 ? now.getFullYear() : now.getFullYear() - 1;

  const make = (tag, className, text) => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text) n.textContent = text;
    return n;
  };
  const link = (href, text) => {
    const a = make('a', '', text);
    a.href = href;
    return a;
  };
  const stored = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  function odometerStrip() {
    if (!within(1220, 105) || page === '/km-ora-allas-ev-eleje-vege') return;
    const key = `trippo.season.odometer.${closing}`;
    if (stored(key)) return;
    const strip = make('div', 'season-strip');
    strip.setAttribute('role', 'note');
    const inner = make('div', 'season-strip-in');
    const text = make(
      'p',
      '',
      now.getMonth() === 11
        ? 'December 31-én fotózd le a km-órát: ez zárja az évet az útnyilvántartásban, és ezzel nyitod a következőt. '
        : 'Megvan a december 31-i km-óra állás? Ez zárja az elmúlt évet, és ezzel nyitod az újat az útnyilvántartásban. ',
    );
    text.append(link('km-ora-allas-ev-eleje-vege', 'Így csináld'));
    const close = make('button', 'season-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Bezárás');
    close.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    close.addEventListener('click', () => {
      try {
        localStorage.setItem(key, '1');
      } catch {
        // Private mode: it just comes back next time.
      }
      strip.remove();
    });
    inner.append(text, close);
    strip.append(inner);
    document.body.prepend(strip);
  }

  function snowfall() {
    if (!home || !within(1201, 1226)) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const hero = document.querySelector('.hero-home');
    if (!hero) return;
    hero.classList.add('has-snow');
    const snow = make('div', 'snow');
    snow.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 22; i++) {
      const flake = make('span', 'flake');
      const size = 3 + Math.random() * 4;
      flake.style.setProperty('--x', `${Math.random() * 100}%`);
      flake.style.setProperty('--size', `${size.toFixed(1)}px`);
      flake.style.setProperty('--drift', `${(Math.random() * 60 - 30).toFixed(0)}px`);
      flake.style.setProperty('--time', `${(9 + Math.random() * 9).toFixed(1)}s`);
      flake.style.setProperty('--delay', `${(-Math.random() * 18).toFixed(1)}s`);
      snow.append(flake);
    }
    hero.prepend(snow);
  }

  const HOLIDAY_TEXT = 'Ünnepi ügyfélszolgálat: december 24. mostantól munkaszüneti nap. December 24. és január 2. között 1–2 munkanapon belül válaszolunk.';

  function holidayNote() {
    if (!within(1218, 102)) return;
    if (page === '/tamogatas') {
      const h1 = document.querySelector('main h1');
      if (h1) h1.after(make('p', 'season-note', HOLIDAY_TEXT));
      return;
    }
    const links = document.querySelector('nav.links');
    if (links) links.before(make('p', 'season-note season-note-foot', HOLIDAY_TEXT));
  }

  function newYearCard() {
    if (!home || now.getMonth() !== 0) return;
    const after = document.querySelector('.facts-band');
    if (!after) return;
    const section = make('section', 'section season-year');
    section.setAttribute('aria-labelledby', 'season-year-title');
    const wrap = make('div', 'wrap');
    const card = make('div', 'season-year-card');
    const title = make('h2', 'title', 'Kezdd jól az évet');
    title.id = 'season-year-title';
    const lead = make('p', 'lead', 'Három dolog, amit januárban érdemes rendbe tenni az útnyilvántartáshoz.');
    const list = make('ul', 'season-year-list');
    [
      ['nav-uzemanyagar', 'A januári NAV-üzemanyagár', 'Az új év első havi ára: a januári utakat már ezzel számold.'],
      ['km-ora-allas-ev-eleje-vege', 'Az év eleji km-óra állás', 'A december 31-i állás nyitja az új évet. Írd be, amíg megvan a fotó.'],
      ['fogyasztasi-norma', 'Az autód fogyasztási normája', 'Új autó vagy csere? A norma a hengerűrtartalomtól függ, nézd meg újra.'],
    ].forEach(([href, head, text]) => {
      const li = make('li');
      const a = link(href, '');
      a.append(make('b', '', head), make('span', '', text));
      li.append(a);
      list.append(li);
    });
    card.append(title, lead, list);
    wrap.append(card);
    section.append(wrap);
    after.after(section);
  }

  const run = () => {
    odometerStrip();
    snowfall();
    holidayNote();
    newYearCard();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
