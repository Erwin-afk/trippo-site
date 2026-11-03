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
const number = (id) => Number($(id).value.replace(/\D/g, '')) || 0;

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
  const norm = normOf(kind, number('km-ccm'));
  const km = number('km-km');
  const fuel = Math.floor((Math.round(km * norm * 10) * price * 100 + 500_000) / 1_000_000);
  const amortization = km * RATE;
  $('km-norm').textContent = String(Math.round(norm * 10) / 100).replace('.', ',') + ' l/100 km';
  $('km-price').textContent = price + ' Ft/l';
  $('km-fuelcost').textContent = huf(fuel);
  $('km-amort').textContent = huf(amortization);
  $('km-total').textContent = huf(fuel + amortization);
}

function paintVat() {
  const total = number('vat-fee') * number('vat-months') * VAT;
  const share = Math.min(100, number('vat-share'));
  const flat = total / 2;
  const actual = (total * share) / 100;
  $('vat-total').textContent = huf(total);
  $('vat-flat').textContent = huf(flat);
  $('vat-actual').textContent = huf(actual);
  $('vat-label').textContent = actual > flat ? 'Ennyivel több a tényleges aránnyal' : 'Ennyivel több az 50%-os átalánnyal';
  $('vat-diff').textContent = huf(Math.abs(actual - flat));
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
