'use strict';
/*
 * Online kiküldetési rendelvény: the visitor types the month's business trips with their own car,
 * the page computes the reimbursement (fuel by the norm at NAV's monthly price + 15 Ft/km, the same
 * rounding as the app and kalkulator.js) and prints a rendelvény. Everything stays in this browser:
 * nothing is sent or stored. The tax ID is a blank line to fill in by hand on paper.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('rv-form');
  if (!form) return;

  // Printed fallback (petrol, diesel, LPG per litre; the protected price where one applied), newest
  // first. nav-prices.js replaces it with the live list.
  let PRICES = [
    ['2026-11', 639, 712, 365],
    ['2026-10', 605, 681, 356],
    ['2026-09', 604, 667, 351],
  ];
  const COLUMN = { petrol: 1, diesel: 2, lpg: 3 };
  const FUEL_NAME = { petrol: 'benzin', diesel: 'dízel', lpg: 'LPG' };
  const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  const RATE = 15;

  const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const huf = (n) => `${grouped(n)} Ft`;
  const monthName = (m) => `${m.slice(0, 4)}. ${MONTHS[Number(m.slice(5)) - 1]}`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  /** "12,5", "12.5" or "1 200" → number; empty → 0; anything else → null. */
  const parse = (text) => {
    const s = String(text).replace(/[\s ]/g, '');
    if (!s) return 0;
    if (/^\d+([.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
    return null;
  };
  /** Decilitres per 100 km (60/1992. Korm. rend.; LPG = petrol × 1,2). */
  const normOf = (fuel, ccm) => {
    if (fuel === 'lpg') return Math.round(normOf('petrol', ccm) * 12) / 10;
    if (fuel === 'diesel') return ccm <= 1500 ? 57 : ccm <= 2000 ? 67 : ccm <= 3000 ? 76 : 95;
    return ccm <= 1000 ? 76 : ccm <= 1500 ? 86 : ccm <= 2000 ? 95 : ccm <= 3000 ? 114 : 133;
  };

  const tripsBox = $('rv-trips');
  const addTrip = (t = {}) => {
    const row = document.createElement('fieldset');
    row.className = 'rv-trip';
    const n = tripsBox.children.length + 1;
    row.innerHTML = `<legend>${n}. út</legend>
      <label>Dátum<input type="date" name="date" value="${esc(t.date || '')}"></label>
      <label>Km<input name="km" inputmode="decimal" placeholder="pl. 42" value="${esc(t.km || '')}"></label>
      <label class="wide">Honnan<input name="from" placeholder="pl. Budapest, Váci út 30." value="${esc(t.from || '')}"></label>
      <label class="wide">Hová<input name="to" placeholder="pl. Vác, Fő tér 1." value="${esc(t.to || '')}"></label>
      <label class="wide">Az út célja, partner<input name="purpose" placeholder="pl. tárgyalás, Minta Kft." value="${esc(t.purpose || '')}"></label>
      <button type="button" class="rv-remove" aria-label="${n}. út törlése">Törlés</button>`;
    row.querySelector('.rv-remove').addEventListener('click', () => {
      row.remove();
      [...tripsBox.children].forEach((r, i) => {
        r.querySelector('legend').textContent = `${i + 1}. út`;
        r.querySelector('.rv-remove').setAttribute('aria-label', `${i + 1}. út törlése`);
      });
      paint();
    });
    tripsBox.append(row);
  };

  const fillMonths = () => {
    const keep = $('rv-month').value;
    $('rv-month').innerHTML = PRICES.map(([m]) => `<option value="${m}">${monthName(m)}</option>`).join('');
    if (PRICES.some(([m]) => m === keep)) $('rv-month').value = keep;
  };

  /** Everything the screen and the printout need, or the first problem to fix. */
  function read() {
    const month = $('rv-month').value;
    const row = PRICES.find((p) => p[0] === month) || PRICES[0];
    const fuel = $('rv-fuel').value;
    const ccm = parse($('rv-ccm').value);
    const norm = ccm ? normOf(fuel, ccm) : 0;
    const price = row[COLUMN[fuel]];
    const trips = [...tripsBox.children].map((r) => {
      const v = (name) => r.querySelector(`[name="${name}"]`).value.trim();
      return { date: v('date'), from: v('from'), to: v('to'), purpose: v('purpose'), kmText: v('km') };
    }).filter((t) => t.date || t.from || t.to || t.purpose || t.kmText);
    const bad = trips.find((t) => parse(t.kmText) === null);
    const problem = !ccm || ccm > 9999 ? 'Írd be a hengerűrtartalmat számmal, pl. 1598. A forgalmi engedélyben találod.'
      : bad ? 'Egy út km-je nem szám. Írd be így: 42 vagy 12,5.'
      : !price ? 'Erre a hónapra ehhez az üzemanyaghoz még nincs NAV-ár. Válassz másik hónapot.'
      : null;
    // The log counts whole km, as the app does.
    trips.forEach((t) => (t.km = Math.floor((parse(t.kmText) || 0) + 0.5)));
    const km = trips.reduce((s, t) => s + t.km, 0);
    const fuelCost = Math.floor((Math.round(km * norm * 10) * price * 100 + 500_000) / 1_000_000);
    return { problem, month, fuel, ccm, trips, km, norm, price, fuelCost, amort: km * RATE, total: fuelCost + km * RATE };
  }

  function paint() {
    const r = read();
    $('rv-error').textContent = r.problem || '';
    const ok = !r.problem;
    $('rv-km').textContent = `${grouped(r.km)} km`;
    $('rv-norm').textContent = ok ? `${String(r.norm / 10).replace('.', ',')} l/100 km` : '–';
    $('rv-price').textContent = `${r.price} Ft/l`;
    $('rv-fuelcost').textContent = ok ? huf(r.fuelCost) : '–';
    $('rv-amort').textContent = ok ? huf(r.amort) : '–';
    $('rv-total').textContent = ok ? huf(r.total) : '–';
    $('rv-print').disabled = !ok || !r.trips.length;
  }

  function printout() {
    const r = read();
    if (r.problem || !r.trips.length) return;
    const v = (id) => esc($(id).value.trim()) || '&nbsp;';
    const rows = r.trips.map((t) => `<tr><td>${esc(t.date)}</td><td>${esc(t.from)}</td><td>${esc(t.to)}</td><td>${esc(t.purpose)}</td><td class="n">${grouped(t.km)}</td></tr>`).join('');
    $('rv-doc').innerHTML = `
      <h2>Kiküldetési rendelvény</h2>
      <p class="rv-sub">saját gépjármű hivatali, üzleti célú használatáról · ${esc(monthName(r.month))}</p>
      <table class="rv-fields">
        <tr><th>Kiküldő (munkáltató, megbízó)</th><td>${v('rv-employer')}</td></tr>
        <tr><th>Kiküldött neve</th><td>${v('rv-name')}</td></tr>
        <tr><th>Kiküldött adóazonosító jele</th><td class="rv-blank">&nbsp;</td></tr>
        <tr><th>Gépjármű</th><td>${[$('rv-plate').value.trim(), $('rv-make').value.trim(), `${FUEL_NAME[r.fuel]}, ${grouped(r.ccm)} cm³`].filter(Boolean).map(esc).join(' · ')}</td></tr>
      </table>
      <table class="rv-trips"><thead><tr><th>Dátum</th><th>Honnan</th><th>Hová</th><th>Az út célja, partner</th><th class="n">Km</th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="4">Összesen</td><td class="n">${grouped(r.km)}</td></tr></tfoot></table>
      <table class="rv-fields">
        <tr><th>Fogyasztási norma</th><td>${String(r.norm / 10).replace('.', ',')} l/100 km</td></tr>
        <tr><th>NAV üzemanyagár (${esc(monthName(r.month))})</th><td>${r.price} Ft/l</td></tr>
        <tr><th>Üzemanyagköltség (${grouped(r.km)} km × ${String(r.norm / 10).replace('.', ',')} l ÷ 100 × ${r.price} Ft)</th><td>${huf(r.fuelCost)}</td></tr>
        <tr><th>Általános személygépkocsi-normaköltség (${grouped(r.km)} km × ${RATE} Ft)</th><td>${huf(r.amort)}</td></tr>
        <tr><th>Kifizetendő költségtérítés</th><td><b>${huf(r.total)}</b></td></tr>
      </table>
      <div class="rv-sign"><div>Kelt: ………………………………</div><div>kiküldő aláírása</div><div>kiküldött aláírása</div></div>
      <p class="rv-note">Két példányban: az eredeti a kiküldőnél, a másolat a kiküldöttnél marad. Számolva a NAV havi üzemanyagárával és a 60/1992. (IV. 1.) Korm. rendelet normáival. Készült: trippo.hu/kikuldetesi-rendelveny-online</p>`;
    window.print();
  }

  for (let i = 0; i < 3; i++) addTrip();
  fillMonths();
  // The trip rows sit outside the form, so both are listened to.
  for (const el of [form, tripsBox]) {
    el.addEventListener('input', paint);
    el.addEventListener('change', paint);
  }
  form.addEventListener('submit', (e) => e.preventDefault());
  $('rv-add').addEventListener('click', () => {
    addTrip();
    tripsBox.lastElementChild.querySelector('input').focus();
    paint();
  });
  $('rv-print').addEventListener('click', printout);
  paint();
  window.navPrices?.then((months) => {
    if (!months) return;
    PRICES = months.map((m) => [m.month, window.navApplied(m, 'petrol'), window.navApplied(m, 'diesel'), m.lpg]);
    fillMonths();
    paint();
  });
})();
