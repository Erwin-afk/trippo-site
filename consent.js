'use strict';
/*
 * Google Ads measurement, only with consent. Nothing from Google loads until the visitor presses
 * "Elfogadom"; "Elutasítom" loads nothing at all. The choice is kept for 6 months in localStorage
 * (trippo-consent: the choice and its date, nothing else), then the bar asks again. The
 * "Sütibeállítások" link added to the bottom of the page opens the bar again; turning measurement
 * off deletes Google's cookies and reloads the page without the tag.
 * Not on the account, accountant and token pages (fiokom, konyvelo, megerosites, hirlevel): they
 * have their own strict Content-Security-Policy and are no place for ads.
 */
(() => {
  // The Google Ads tag ID (Google Ads › Google tag), e.g. 'AW-123456789'. Empty: no bar, nothing loads.
  const ADS_ID = '';
  if (!/^AW-\d+$/.test(ADS_ID)) return;

  const KEY = 'trippo-consent';
  const KEEP_MS = 182 * 24 * 60 * 60 * 1000;
  let choice = null; // true, false, or null when not asked yet (or asked over 6 months ago)
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved.ads === 'boolean' && Date.now() - Date.parse(saved.at) < KEEP_MS) choice = saved.ads;
  } catch { /* storage blocked: ask on every page */ }

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
    // Measurement only: no remarketing lists, no personalised ads, no Google Analytics.
    window.gtag('consent', 'default', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'denied' });
    window.gtag('js', new Date());
    window.gtag('config', ADS_ID, { allow_ad_personalization_signals: false });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_ID}`;
    document.head.append(s);
  };

  // Google's first-party cookies on trippo.hu (_gcl_au and friends), on every domain form they may use.
  const clearCookies = () => {
    const host = location.hostname.replace(/^www\./, '');
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0].trim();
      if (!/^_(gcl|ga)/.test(name)) continue;
      for (const domain of ['', `; domain=${host}`, `; domain=.${host}`]) {
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
      }
    }
  };

  let bar = null;
  const decide = (ads) => {
    const wasOn = loaded;
    choice = ads;
    try { localStorage.setItem(KEY, JSON.stringify({ ads, at: new Date().toISOString() })); } catch { /* kept for this page only */ }
    bar?.remove();
    bar = null;
    if (ads) load();
    else if (wasOn) { clearCookies(); location.reload(); }
  };

  const open = () => {
    if (bar) return bar.querySelector('button').focus();
    bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Sütik');
    bar.innerHTML = '<p>A Google Ads sütijeivel mérjük, mennyire működnek a hirdetéseink. Csak akkor kapcsoljuk be, ha engedélyezed. <a href="/adatvedelem#sutik">Részletek</a></p>'
      + '<div class="consent-actions"><button type="button" data-ads="no">Elutasítom</button><button type="button" data-ads="yes">Elfogadom</button></div>';
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-ads]');
      if (b) decide(b.dataset.ads === 'yes');
    });
    document.body.append(bar);
  };

  // "Sütibeállítások" at the end of the page's bottom links, so the choice can be changed any time.
  const footerLinks = [...document.querySelectorAll('nav.links')].pop();
  if (footerLinks) {
    const a = document.createElement('a');
    a.href = '/adatvedelem#sutik';
    a.textContent = 'Sütibeállítások';
    a.addEventListener('click', (e) => { e.preventDefault(); open(); });
    footerLinks.append(a);
  }

  if (choice === true) load();
  else if (choice === null) open();
})();
