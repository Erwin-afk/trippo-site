/*
 * Trippo Pro on the web (Barion card payment, Billingo invoice). Same login as Útjaim (stored by
 * fiokom.js under 'trippo-driver-auth'). Everything that matters happens on the server
 * (supabase/functions/web-billing): this page shows the state and starts a checkout.
 *   no login         → a link to Útjaim to sign in
 *   back from Barion → ?paymentId=… : waits until the payment is settled
 *   active/canceled  → plan, dates, payments and invoices, cancel
 *   otherwise        → plan choice, invoice details, pay
 */
const BASE = 'https://rudnmzhfgnynlmjdrwoy.supabase.co';
const ANON = 'sb_publishable_Tyxe0cP-kh_mCvH5oCEcsw_qDRYTL8X';
const sb = window.supabase.createClient(BASE, ANON, { auth: { detectSessionInUrl: false, persistSession: true, storageKey: 'trippo-driver-auth' } });
const app = document.getElementById('app');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }) : '–');
const PLAN = { monthly: { label: 'Havi', price: '1 990 Ft / hó' }, yearly: { label: 'Éves', price: '19 900 Ft / év' } };
const STATUS = { active: 'Aktív', past_due: 'Fizetés folyamatban', canceled: 'Lemondva', expired: 'Lejárt', pending: 'Fizetésre vár' };

async function call(body) {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: 'login' };
  const res = await fetch(`${BASE}/functions/v1/web-billing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { error: 'Nincs internet? Próbáld újra.' };
  if (res.status === 401) return { error: 'login' };
  return res.json().catch(() => ({ error: 'Most nem sikerült. Próbáld újra.' }));
}

function loginView() {
  app.innerHTML = `<h1>Trippo Pro előfizetés</h1>
    <p class="lead-doc">Az előfizetéshez lépj be ugyanazzal az e-mail-címmel, amellyel az appot használod.</p>
    <p><a class="btn" href="fiokom">Belépés az Útjaim oldalon</a></p>
    <p class="muted">Belépés után gyere vissza erre az oldalra.</p>`;
}

function statusView({ subscription: s, payments }) {
  const canCancel = s.status === 'active' || s.status === 'past_due';
  const rows = payments
    .filter((p) => p.status === 'succeeded')
    .map((p) => `<tr><td>${esc(date(p.completed_at))}</td><td>${esc(PLAN[p.plan]?.label ?? '')}</td><td class="n">${grouped(p.amount_huf)} Ft</td><td>${esc(p.invoice_number ?? 'készül')}</td></tr>`)
    .join('');
  app.innerHTML = `<h1>Trippo Pro előfizetés</h1>
    <div class="calc-result">
      <div><span>Állapot</span><b>${esc(STATUS[s.status] ?? s.status)}</b></div>
      <div><span>Csomag</span><b>${esc(PLAN[s.plan]?.label ?? '')}, ${esc(PLAN[s.plan]?.price ?? '')}</b></div>
      <div><span>A Pro eddig jár</span><b>${esc(date(s.current_period_end))}</b></div>
      ${s.next_charge_at ? `<div><span>Következő terhelés</span><b>${esc(date(s.next_charge_at))}</b></div>` : ''}
    </div>
    ${s.status === 'past_due' ? '<p class="sub-warn">A legutóbbi terhelés nem sikerült. Pár napon belül újra megpróbáljuk; addig a Pro működik.</p>' : ''}
    ${s.status === 'canceled' ? '<p class="muted">Lemondtad: több terhelés nem lesz, a Pro a fenti dátumig működik.</p>' : ''}
    ${rows ? `<h2>Fizetések és számlák</h2><div class="sub-table"><table><thead><tr><th>Dátum</th><th>Csomag</th><th class="n">Összeg</th><th>Számlaszám</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">A számlát e-mailben küldjük minden fizetés után.</p>` : ''}
    ${canCancel ? '<p><button type="button" class="btn btn-ghost" id="cancel">Előfizetés lemondása</button></p><p class="sub-confirm" id="cancel-note" hidden>Biztosan lemondod? A Pro a fizetett időszak végéig működik. <button type="button" class="btn" id="cancel-yes">Igen, lemondom</button></p>' : ''}
    ${s.status === 'expired' ? '<p><button type="button" class="btn" id="again">Új előfizetés</button></p>' : ''}`;
  document.getElementById('cancel')?.addEventListener('click', () => (document.getElementById('cancel-note').hidden = false));
  document.getElementById('cancel-yes')?.addEventListener('click', async () => {
    const r = await call({ cancel: true });
    if (r.error) return alertIn(r.error);
    load();
  });
  document.getElementById('again')?.addEventListener('click', () => checkoutView(s?.billing));
}

const alertIn = (text) => {
  const el = document.getElementById('sub-error');
  if (el) el.textContent = text;
  else app.insertAdjacentHTML('beforeend', `<p class="calc-error" id="sub-error" role="alert">${esc(text)}</p>`);
};

function checkoutView(billing = {}) {
  const b = billing ?? {};
  app.innerHTML = `<h1>Trippo Pro előfizetés</h1>
    <p class="lead-doc">Havi lezárás, PDF és Excel, több autó, fotóból olvasás. Ugyanaz a Pro, mint az appban: ugyanazzal a fiókkal az iPhone-on is működik.</p>
    <form id="sub-form" class="calc-form sub-form" novalidate>
      <fieldset class="sub-plans">
        <legend>Csomag</legend>
        <label class="sub-plan"><input type="radio" name="plan" value="yearly" checked><span><b>Éves</b> 19 900 Ft / év<small>2 hónap ingyen</small></span></label>
        <label class="sub-plan"><input type="radio" name="plan" value="monthly"><span><b>Havi</b> 1 990 Ft / hó</span></label>
      </fieldset>
      <label class="wide">Név a számlán<input id="b-name" autocomplete="name" value="${esc(b.name)}" placeholder="pl. Kovács Anna vagy Minta Kft."></label>
      <label>Irányítószám<input id="b-postcode" inputmode="numeric" autocomplete="postal-code" value="${esc(b.postcode)}"></label>
      <label>Város<input id="b-city" autocomplete="address-level2" value="${esc(b.city)}"></label>
      <label class="wide">Cím<input id="b-address" autocomplete="street-address" value="${esc(b.address)}" placeholder="pl. Fő utca 1."></label>
      <label class="wide">Adószám (cégeknek, nem kötelező)<input id="b-tax" inputmode="numeric" value="${esc(b.taxcode)}" placeholder="12345678-1-12"></label>
      <label class="wide sub-accept"><input type="checkbox" id="accept"> <span>Elfogadom a <a href="aszf" target="_blank" rel="noopener">Felhasználási feltételeket</a>. Kérem, hogy a szolgáltatás a fizetéssel azonnal induljon, és tudomásul veszem, hogy ezzel elveszítem az elállási jogomat. Az előfizetés automatikusan megújul; itt bármikor lemondhatom.</span></label>
    </form>
    <p class="calc-error" id="sub-error" role="alert"></p>
    <p><button type="button" class="btn" id="pay">Fizetés bankkártyával (Barion)</button></p>
    <p class="muted">A kártyaadatokat a Barion kezeli, mi nem látjuk. Fizetés után számlát küldünk e-mailben.</p>`;
  document.getElementById('pay').addEventListener('click', async (e) => {
    const v = (id) => document.getElementById(id).value;
    const plan = document.querySelector('input[name="plan"]:checked').value;
    e.target.disabled = true;
    const r = await call({ checkout: { plan, accept: document.getElementById('accept').checked, billing: { name: v('b-name'), postcode: v('b-postcode'), city: v('b-city'), address: v('b-address'), taxcode: v('b-tax') } } });
    e.target.disabled = false;
    if (r.error === 'login') return loginView();
    if (r.error) return alertIn(r.error);
    if (r.url && /^https:\/\/secure(\.test)?\.barion\.com\//.test(r.url)) location.href = r.url;
    else alertIn('A fizetés most nem indult el. Próbáld újra.');
  });
}

async function waitForPayment() {
  app.innerHTML = '<h1>Trippo Pro előfizetés</h1><p class="lead-doc">Fizetés feldolgozása…</p>';
  for (let i = 0; i < 15; i++) {
    const r = await call({ status: true });
    if (r.error === 'login') return loginView();
    const s = r.subscription;
    if (s && s.status !== 'pending') {
      history.replaceState(null, '', 'elofizetes');
      return statusView(r);
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  history.replaceState(null, '', 'elofizetes');
  app.innerHTML = `<h1>Trippo Pro előfizetés</h1><p class="lead-doc">A fizetés még nem zárult le, vagy megszakadt. Ha a kártyádat megterhelték, pár percen belül itt látod; ha nem, próbáld újra.</p><p><a class="btn" href="elofizetes">Frissítés</a></p>`;
}

async function load() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return loginView();
  if (new URLSearchParams(location.search).has('paymentId')) return waitForPayment();
  const r = await call({ status: true });
  if (r.error === 'login') return loginView();
  if (r.error) return (app.innerHTML = `<p class="calc-error">${esc(r.error)}</p>`);
  if (!r.enabled && !r.subscription) {
    app.innerHTML = '<h1>Trippo Pro előfizetés</h1><p class="lead-doc">A webes előfizetés hamarosan indul. Addig az appban fizethetsz elő.</p>';
    return;
  }
  const s = r.subscription;
  if (s && ['active', 'past_due', 'canceled', 'expired'].includes(s.status)) statusView(r);
  else checkoutView(s?.billing);
}

load();
