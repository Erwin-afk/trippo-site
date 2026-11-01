'use strict';
/* Calculators: everything stays in the browser. Same rounding as the app (src/lib/nav/allowance.ts). */

// NAV price per litre (the protected price where one applied). New months go on top.
const PRICES = [
  ['2026-11', 639, 712],
  ['2026-10', 605, 681],
  ['2026-09', 604, 667],
  ['2026-08', 580, 592],
  ['2026-07', 595, 615],
  ['2026-06', 595, 615],
  ['2026-05', 595, 615],
  ['2026-04', 565, 590],
  ['2026-03', 564, 578],
  ['2026-02', 560, 572],
  ['2026-01', 572, 586],
];
const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const RATE = 15;
const VAT = 0.27;

const $ = (id) => document.getElementById(id);
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const huf = (n) => grouped(n) + ' Ft';
const number = (id) => Number($(id).value.replace(/\D/g, '')) || 0;

/** Decilitres per 100 km, so the money stays in whole numbers. */
function normOf(fuel, ccm) {
  if (fuel === 'diesel') return ccm <= 1500 ? 57 : ccm <= 2000 ? 67 : ccm <= 3000 ? 76 : 95;
  return ccm <= 1000 ? 76 : ccm <= 1500 ? 86 : ccm <= 2000 ? 95 : ccm <= 3000 ? 114 : 136;
}

function paintKm() {
  const row = PRICES.find((p) => p[0] === $('km-month').value);
  const diesel = $('km-fuel').value === 'diesel';
  const price = diesel ? row[2] : row[1];
  const norm = normOf(diesel ? 'diesel' : 'petrol', number('km-ccm'));
  const km = number('km-km');
  const fuel = Math.floor((km * norm * price * 100 + 50_000) / 100_000);
  const amortization = km * RATE;
  $('km-norm').textContent = String(norm / 10).replace('.', ',') + ' l/100 km';
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

$('km-month').innerHTML = PRICES.map(([m]) => `<option value="${m}">${m.slice(0, 4)}. ${MONTHS[Number(m.slice(5)) - 1]}</option>`).join('');
$('km-form').addEventListener('input', paintKm);
$('vat-form').addEventListener('input', paintVat);
document.querySelectorAll('.calc-form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
paintKm();
paintVat();
