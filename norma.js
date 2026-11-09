'use strict';
/*
 * Norm calculator on fogyasztasi-norma.html: fuel + cm³ → litres per 100 km. The rules are the ones
 * the page states (60/1992. Korm. rend. 4. §, NAV): LPG = petrol × 1,2, CNG/LNG = petrol × 0,8 in
 * Nm³, plug-in hybrid = 70% of its engine's norm, electric = 3 l of 95 petrol. Runs in the browser only.
 */
(() => {
  const $ = (id) => document.getElementById(id);
  const form = $('norm-form');
  if (!form) return;
  const fuel = $('norm-fuel');
  const ccm = $('norm-ccm');
  const result = $('norm-result');
  const how = $('norm-how');
  const error = $('norm-error');

  const comma = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
  const petrol = (c) => (c <= 1000 ? 7.6 : c <= 1500 ? 8.6 : c <= 2000 ? 9.5 : c <= 3000 ? 11.4 : 13.3);
  const diesel = (c) => (c <= 1500 ? 5.7 : c <= 2000 ? 6.7 : c <= 3000 ? 7.6 : 9.5);
  const band = (c) => (c <= 1000 ? '1000 cm³-ig' : c <= 1500 ? '1001–1500 cm³' : c <= 2000 ? '1501–2000 cm³' : c <= 3000 ? '2001–3000 cm³' : '3000 cm³ fölött');

  function paint() {
    const kind = fuel.value;
    const electric = kind === 'electric';
    ccm.disabled = electric;
    const raw = ccm.value.replace(/[\s.]/g, '');
    const c = Number(raw);
    const ok = electric || (/^\d+$/.test(raw) && c > 0 && c < 10000);
    error.textContent = ok ? '' : 'Írd be a hengerűrtartalmat számmal, pl. 1598. A forgalmi engedélyben találod.';
    ccm.setAttribute('aria-invalid', String(!ok));
    if (!ok) {
      result.textContent = '–';
      how.textContent = '–';
      return;
    }
    const rows = {
      petrol: () => [petrol(c), 'l', `benzin, ${band(c)}`],
      diesel: () => [diesel(c), 'l', `dízel, ${band(c)}`],
      lpg: () => [petrol(c) * 1.2, 'l', `${comma(petrol(c))} × 1,2 (benzines norma, ${band(c)})`],
      cng: () => [petrol(c) * 0.8, 'Nm³', `${comma(petrol(c))} × 0,8 (benzines norma, ${band(c)})`],
      plugin_petrol: () => [petrol(c) * 0.7, 'l', `${comma(petrol(c))} × 0,7 (benzinmotor, ${band(c)})`],
      plugin_diesel: () => [diesel(c) * 0.7, 'l', `${comma(diesel(c))} × 0,7 (dízelmotor, ${band(c)})`],
      electric: () => [3, 'l', '3 liter 95-ös benzin, a hengerűrtartalomtól függetlenül'],
    };
    const [value, unit, text] = rows[kind]();
    result.textContent = `${comma(value)} ${unit} / 100 km`;
    how.textContent = text;
  }

  form.addEventListener('input', paint);
  form.addEventListener('submit', (e) => e.preventDefault());
  paint();
})();
