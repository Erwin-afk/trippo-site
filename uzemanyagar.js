'use strict';
/* Fills the price table, the opening line and the example from the live prices (nav-prices.js). */
window.navPrices.then((months) => {
  if (!months) return;
  const $ = (id) => document.getElementById(id);
  const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const latest = months[0];
  const cell = (m, fuel) => (m[fuel + 'Protected'] != null ? `${m[fuel]}<br><small>védett: ${m[fuel + 'Protected']}</small>` : String(m[fuel]));
  const label = (m) => {
    const name = window.navMonth(m.month, 'name');
    const cap = name[0].toUpperCase() + name.slice(1);
    return m.month.startsWith('2026') ? cap : `${m.month.slice(0, 4)}. ${name}`;
  };
  $('price-rows').innerHTML = months.map((m) => `<tr><td>${label(m)}</td><td>${cell(m, 'petrol')}</td><td>${cell(m, 'diesel')}</td><td>${m.lpg != null ? m.lpg : '–'}</td></tr>`).join('');

  $('lead-month').textContent = `${latest.month.slice(0, 4)} ${window.navMonth(latest.month, 'inside')}`;
  $('lead-p').textContent = `${latest.petrol} Ft/l`;
  $('lead-d').textContent = `${latest.diesel} Ft/l`;
  $('lead-l').textContent = latest.lpg != null ? `${latest.lpg} Ft/l` : '–';

  // 1000 km, 9,5 l/100 km, with the app's rounding.
  const price = window.navApplied(latest, 'petrol');
  const fuel = Math.floor((1000 * 95 * price * 100 + 50000) / 100000);
  $('ex-month').textContent = window.navMonth(latest.month, 'adjective');
  $('ex-price').textContent = String(price);
  $('ex-fuel').textContent = `${grouped(fuel)} Ft`;
  $('ex-total').textContent = `${grouped(fuel + 15000)} Ft`;
});
