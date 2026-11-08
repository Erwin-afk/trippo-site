'use strict';
/* Calculators: everything stays in the browser. Same rounding as the app (src/lib/nav/allowance.ts). */

// NAV price per litre: petrol, diesel (the protected price where one applied), LPG. Newest first.
// Printed fallback; the live list from nav-prices.js replaces it.
let PRICES = [
  ['2026-11', 639, 712, 365],
  ['2026-10', 605, 681, 356],
  ['2026-09', 604, 667, 351],
  ['2026-08', 580, 592, 366],
  ['2026-07', 595, 615, 376],
  ['2026-06', 595, 615, 376],
  ['2026-05', 595, 615, 356],
  ['2026-04', 565, 590, 324],
  ['2026-03', 564, 578, 324],
  ['2026-02', 560, 572, 324],
  ['2026-01', 572, 586, 328],
];
const COLUMN = { petrol: 1, diesel: 2, lpg: 3 };
const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const RATE = 15;
const VAT = 0.27;

const $ = (id) => document.getElementById(id);
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const huf = (n) => grouped(n) + ' Ft';
/**
 * What people type: "12,5" or "12.5" is a decimal, "1 000", "1.000" or "1.000,5" has a thousands
 * separator. Empty is 0. Null for anything else, a minus sign or a letter included.
 */
function parse(text) {
  const s = text.replace(/[\s  ]/g, '');
  if (!s) return 0;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d+(,\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\d+\.\d+$/.test(s)) return Number(s);
  return null;
}

/** The field's number, or null with the reason shown under it. */
function number(id, { min = 0, max = Infinity, required = false, hint }) {
  const input = $(id);
  const value = parse(input.value);
  const bad = value === null || value < min || value > max || (required && !value) ? hint : '';
  let note = document.getElementById(id + '-error');
  if (bad && !note) {
    note = document.createElement('small');
    note.id = id + '-error';
    note.className = 'calc-error';
    input.after(note);
    input.setAttribute('aria-describedby', note.id);
  }
  if (note) note.textContent = bad;
  input.setAttribute('aria-invalid', String(!!bad));
  return bad ? null : value;
}

const show = (id, text, ok) => ($(id).textContent = ok ? text : '–');

/** Decilitres per 100 km. LPG is the petrol norm × 1,2 (60/1992. Korm. rend. 4. § (4)). */
function normOf(fuel, ccm) {
  if (fuel === 'lpg') return Math.round(normOf('petrol', ccm) * 12) / 10;
  if (fuel === 'diesel') return ccm <= 1500 ? 57 : ccm <= 2000 ? 67 : ccm <= 3000 ? 76 : 95;
  return ccm <= 1000 ? 76 : ccm <= 1500 ? 86 : ccm <= 2000 ? 95 : ccm <= 3000 ? 114 : 133;
}

function paintKm() {
  const row = PRICES.find((p) => p[0] === $('km-month').value) || PRICES[0];
  const kind = $('km-fuel').value;
  const price = row[COLUMN[kind]];
  const ccm = number('km-ccm', { min: 1, max: 9999, required: true, hint: 'Írd be a hengerűrtartalmat, pl. 1498.' });
  // The log counts whole km, as the app does.
  const typed = number('km-km', { max: 100_000, hint: 'Egy nem negatív szám kell, pl. 1200 vagy 12,5.' });
  const km = typed === null ? null : Math.floor(typed + 0.5);
  const norm = ccm === null ? null : normOf(kind, ccm);
  const ok = norm !== null && km !== null;
  const fuel = ok ? Math.floor((Math.round(km * norm * 10) * price * 100 + 500_000) / 1_000_000) : 0;
  const amortization = ok ? km * RATE : 0;
  show('km-norm', norm === null ? '' : String(Math.round(norm * 10) / 100).replace('.', ',') + ' l/100 km', norm !== null);
  $('km-price').textContent = price + ' Ft/l';
  show('km-fuelcost', huf(fuel), ok);
  show('km-amort', huf(amortization), ok);
  show('km-total', huf(fuel + amortization), ok);
}

function paintVat() {
  const fee = number('vat-fee', { max: 100_000_000, hint: 'Egy nem negatív összeg kell, pl. 150 000.' });
  const months = number('vat-months', { max: 1200, hint: 'Egy nem negatív szám kell, pl. 36.' });
  const share = number('vat-share', { max: 100, hint: '0 és 100 közötti szám kell, pl. 85 vagy 72,5.' });
  const ok = fee !== null && months !== null && share !== null;
  const total = ok ? fee * Math.round(months) * VAT : 0;
  const flat = total / 2;
  const actual = (total * share) / 100;
  show('vat-total', huf(total), ok);
  show('vat-flat', huf(flat), ok);
  show('vat-actual', huf(actual), ok);
  $('vat-label').textContent = !ok ? 'Különbség' : actual > flat ? 'Ennyivel több a tényleges aránnyal' : 'Ennyivel több az 50%-os átalánnyal';
  show('vat-diff', huf(Math.abs(actual - flat)), ok);
}

const fillMonths = () => {
  $('km-month').innerHTML = PRICES.map(([m]) => `<option value="${m}">${m.slice(0, 4)}. ${MONTHS[Number(m.slice(5)) - 1]}</option>`).join('');
};
fillMonths();
if (window.navPrices) {
  window.navPrices.then((months) => {
    if (!months) return;
    PRICES = months.map((m) => [m.month, window.navApplied(m, 'petrol'), window.navApplied(m, 'diesel'), m.lpg]);
    fillMonths();
    paintKm();
  });
}
$('km-form').addEventListener('input', paintKm);
$('vat-form').addEventListener('input', paintVat);
document.querySelectorAll('.calc-form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
paintKm();
paintVat();
