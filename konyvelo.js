/*
 * Könyvelői portál. Routes live in the URL's #fragment, so nothing secret reaches a server log:
 *   #<64 hex>   a client's link (read-only; a logged-in accountant can add it to their clients)
 *   (empty)     login, or the client list
 *   #c/<id>     one client
 *   #demo…      the same screens with made-up data, no login
 * Everything from the server goes through esc(): this page holds a login, and trip purposes,
 * partners and names are typed by clients.
 */
import { XLSX_MIME, monthWorkbook, payableOf, yearWorkbook } from './workbook.js';

const BASE = 'https://rudnmzhfgnynlmjdrwoy.supabase.co';
const ANON = 'sb_publishable_Tyxe0cP-kh_mCvH5oCEcsw_qDRYTL8X';
const FN = BASE + '/functions/v1/accountant';

// detectSessionInUrl off: the #fragment here is ours (a client's link), not an auth redirect.
const sb = window.supabase.createClient(BASE, ANON, { auth: { detectSessionInUrl: false, persistSession: true, storageKey: 'trippo-accountant-auth' } });

const app = document.getElementById('app');
const who = document.getElementById('who');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Grouped by hand: hu-HU leaves four-digit numbers ungrouped, so 1500 would sit next to 73 518.
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
const huf = (n) => (n == null ? '–' : grouped(n) + ' Ft');
const km = (n) => grouped(n ?? 0) + ' km';
const monthName = (m) => new Date(m.slice(0, 7) + '-01T00:00:00').toLocaleDateString('hu-HU', { year: 'numeric', month: 'long' });
const monthShort = (m) => new Date(m.slice(0, 7) + '-01T00:00:00').toLocaleDateString('hu-HU', { month: 'long' });
const show = (html) => {
  app.innerHTML = html;
  window.scrollTo(0, 0);
};
const on = (selector, event, fn) => document.querySelector(selector)?.addEventListener(event, fn);

/** The month accountants wait for: the last full calendar month. */
function lastFullMonth() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

async function session() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

/** Throws the server's error word ('claimed', 'revoked', …) so screens can explain it. */
async function call(body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  const s = auth ? await session() : null;
  if (s) headers.Authorization = 'Bearer ' + s.access_token;
  const res = await fetch(FN, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'network');
  return json;
}

/* ---------- Export ---------- */

function download(name, bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  a.download = name + '.xlsx';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Months ---------- */

const comma = (n) => String(n ?? '–').replace('.', ',');
const odo = (n) => (n == null ? '–' : km(n));

function monthCard(c, i) {
  const s = c.snapshot || {};
  const people = s.people || {};
  const o = s.odometer || {};
  const money = [
    [`Üzemanyag (${esc(km(s.business_km))} × ${esc(comma(s.norm_l_per_100km))} l/100 km × ${esc(s.price_label)})`, s.fuel_cost_huf],
    [`Normaköltség (${esc(km(s.business_km))} × ${esc(s.general_norm_huf_per_km)} Ft)`, s.amortization_huf],
    ...(s.per_diem ? [[`Napidíj (${esc(s.per_diem.days.length)} nap × ${esc(huf(s.per_diem.hufPerDay))})`, s.per_diem.totalHuf]] : []),
    ...((s.expenses || []).length ? [[`Számla alapján (${esc(s.expenses.length)} tétel)`, s.expenses_huf]] : []),
  ];
  return `<div class="card month" data-month="${i}">
    <button class="month-head" aria-expanded="false">
      <span><b>${esc(monthName(c.month))}</b><span class="sub">${esc(c.vehicles?.plate)} · ${esc(people.driverName)} · ${km(s.business_km)} üzleti</span></span>
      <span class="amount">${huf(payableOf(s))}</span>
    </button>
    <div class="details">
      <div class="facts">
        <div><span>Kiküldött</span><b>${esc(people.driverName || '–')}</b></div>
        <div><span>Kiküldő</span><b>${esc(people.employerName || '–')}</b></div>
        <div><span>Gépkocsi</span><b>${esc(c.vehicles?.plate)}${c.vehicles?.make_model ? ' · ' + esc(c.vehicles.make_model) : ''}</b></div>
        <div><span>Km-óra a hónapban</span><b>${odo(c.start_odometer)} → ${odo(c.end_odometer)}</b></div>
        <div><span>Km-óra január 1-jén</span><b>${odo(o.yearStart)}</b></div>
        <div><span>Magán / munkába járás</span><b>${km(s.personal_km)} / ${km(s.commute_km)}</b></div>
      </div>
      <table class="calc"><tbody>
        ${money.map(([label, value]) => `<tr><td>${label}</td><td class="num">${huf(value)}</td></tr>`).join('')}
        <tr class="sum"><td>Kifizetendő összesen</td><td class="num">${huf(payableOf(s))}</td></tr>
      </tbody></table>
      <h3>Üzleti utak</h3>
      <div class="scroll"><table><thead><tr><th>Dátum</th><th>Honnan → Hová</th><th>Cél / partner</th><th class="num">Km</th></tr></thead><tbody>
      ${(s.lines || [])
        .map((l) => `<tr><td class="nowrap">${esc(l.date)}<span class="sub">${esc(l.time)}</span></td><td>${esc(l.from)} → ${esc(l.to)}</td><td>${esc(l.purpose)}${l.partner ? ' · ' + esc(l.partner) : ''}</td><td class="num">${esc(l.km)}</td></tr>`)
        .join('') || '<tr><td colspan="4" class="muted">Ebben a hónapban nem volt üzleti út.</td></tr>'}
      </tbody></table></div>
      ${
        (s.expenses || []).length
          ? `<h3>Számla alapján</h3>
            <div class="scroll"><table><thead><tr><th>Dátum</th><th>Tétel</th><th>Út / megjegyzés</th><th class="num">Összeg</th></tr></thead><tbody>
            ${s.expenses.map((e) => `<tr><td class="nowrap">${esc(e.date)}</td><td>${esc(e.kind)}</td><td>${esc(e.trip)}${e.note ? ' · ' + esc(e.note) : ''}</td><td class="num">${huf(e.amountHuf)}</td></tr>`).join('')}
            </tbody></table></div>`
          : ''
      }
      <p class="hash">Lezárva: ${esc(new Date(c.closed_at).toLocaleString('hu-HU'))}<br>Ellenőrző kód (SHA-256): ${esc(c.snapshot_hash)}</p>
      <div class="actions"><button class="primary" data-xlsx="${i}">Excel letöltése</button></div>
    </div>
  </div>`;
}

function bindMonths(closes, fileBase) {
  document.querySelectorAll('.month-head').forEach((b) =>
    b.addEventListener('click', () => {
      const open = b.parentElement.classList.toggle('open');
      b.setAttribute('aria-expanded', String(open));
    }),
  );
  document.querySelectorAll('[data-xlsx]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = closes[Number(b.dataset.xlsx)];
      download(`${fileBase}-${c.month.slice(0, 7)}`, monthWorkbook(c));
    }),
  );
}

/** Months the client took back to fix: what the accountant has of them may no longer stand. */
function reopenedNote(months) {
  return months?.length ? `<div class="notice warn"><p><b>${esc(months.map(monthName).join(', '))}:</b> az ügyfél javításra újranyitotta. Amint újra lezárja, itt megjelenik.</p></div>` : '';
}

/* ---------- Login ---------- */

function loginForm(title, text) {
  return `<div class="card login">
    <h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
    <form id="email-form" class="stack">
      <div><label for="email">E-mail-cím</label><input id="email" type="email" autocomplete="email" required></div>
      <button class="primary" type="submit">Belépési kód kérése</button>
    </form>
    <form id="code-form" class="stack hidden">
      <p class="muted">Elküldtük a kódot ide: <b id="sent-to"></b></p>
      <div><label for="code">Belépési kód</label><input id="code" inputmode="numeric" autocomplete="one-time-code" required></div>
      <button class="primary" type="submit">Belépés</button>
    </form>
    <p class="error hidden" id="login-error"></p>
  </div>`;
}

function bindLogin() {
  const fail = (text) => {
    const e = document.getElementById('login-error');
    e.textContent = text;
    e.classList.remove('hidden');
  };
  let email = '';
  on('#email-form', 'submit', async (ev) => {
    ev.preventDefault();
    const button = ev.target.querySelector('button');
    button.disabled = true;
    email = document.getElementById('email').value.trim().toLowerCase();
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    button.disabled = false;
    if (error) return fail('Nem sikerült elküldeni a kódot. Próbáld újra pár perc múlva.');
    document.getElementById('login-error').classList.add('hidden');
    document.getElementById('sent-to').textContent = email;
    document.getElementById('email-form').classList.add('hidden');
    document.getElementById('code-form').classList.remove('hidden');
    document.getElementById('code').focus();
  });
  on('#code-form', 'submit', async (ev) => {
    ev.preventDefault();
    const button = ev.target.querySelector('button');
    button.disabled = true;
    const token = document.getElementById('code').value.replace(/\D/g, '');
    const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
    button.disabled = false;
    if (error) return fail('Hibás vagy lejárt kód.');
    route();
  });
}

function loginView() {
  document.body.classList.add('landing');
  show(`<section class="hero">
      <div>
        <p class="eyebrow">Ingyenes a könyvelőknek</p>
        <h1>Minden ügyfeled útnyilvántartása egy helyen</h1>
        <p class="lead">Ügyfeleid a Trippo appal vezetik a kilométereiket. Te itt látod a lezárt hónapjaikat, készen a könyveléshez.</p>
        <a class="button" href="#demo">Minta megtekintése</a>
      </div>
      ${loginForm('Belépés', 'Nincs jelszó: kódot küldünk e-mailben. Első belépéskor létrejön a fiókod.')}
    </section>
    <figure class="preview">
      <div class="preview-bar"><i></i><i></i><i></i></div>
      <picture>
        <source srcset="images/portal-dark.jpg" media="(prefers-color-scheme: dark)">
        <img src="images/portal-light.jpg" width="2160" height="1096" alt="A könyvelői portál ügyféllistája: ki zárta le a múlt hónapot, és kire kell még várni">
      </picture>
    </figure>
    <section class="block">
      <h2>Amit nem kell többé megkérdezned</h2>
      <div class="features">
        <div><h3>Ki zárta le a hónapot?</h3><p>Egy pillantásra látod, kitől van meg a múlt hónap, és kire kell még várni.</p></div>
        <div><h3>Utólag nem módosítható</h3><p>A lezárt hónap befagy; az ellenőrző kód igazolja, hogy az adat azóta nem változott.</p></div>
        <div><h3>Kész az Excelben</h3><p>Havi vagy éves Excel-fájl: kifizetendő összeg, útlista, költségek, NAV-ár és km-óra.</p></div>
        <div><h3>Csak amit megosztanak</h3><p>Kizárólag a lezárt hónapokat látod, és az ügyfeled bármikor visszavonhatja.</p></div>
      </div>
    </section>
    <section class="block">
      <h2>Így kerül hozzád egy ügyfél</h2>
      <ol class="path">
        <li><b>Linket küld</b><span>Az ügyfeled a Trippo appban létrehoz egy könyvelői linket.</span></li>
        <li><b>Megnyitod</b><span>Regisztráció nélkül is látod a lezárt hónapjait.</span></li>
        <li><b>Felveszed</b><span>Egy kattintással az ügyfeleid közé kerül, és a link ezután csak neked működik.</span></li>
      </ol>
    </section>`);
  bindLogin();
}

/* ---------- Client list ---------- */

function statusOf(client, wanted) {
  return client.months.some((m) => m.month.slice(0, 7) === wanted.slice(0, 7));
}

const isReopened = (client, wanted) => (client.reopened || []).some((m) => m.slice(0, 7) === wanted.slice(0, 7));

function dashboardView(clients, demo) {
  const wanted = lastFullMonth();
  const year = new Date().getFullYear() - (new Date().getMonth() === 0 ? 1 : 0);
  const done = clients.filter((c) => statusOf(c, wanted)).length;
  const base = demo ? '#demo/c/' : '#c/';
  let filter = 'all';

  show(`${demo ? '<div class="notice"><p>Ez egy minta, kitalált adatokkal.</p><a class="button" href="#">Belépés</a></div>' : ''}
    <div class="head"><h1>Ügyfelek</h1></div>
    ${
      clients.length
        ? `<div class="stats">
            <div class="stat"><b>${clients.length}</b><span>ügyfél</span></div>
            <div class="stat"><b>${done}</b><span>${esc(monthShort(wanted))} lezárva</span></div>
            <div class="stat"><b>${clients.length - done}</b><span>még hiányzik</span></div>
          </div>
          <div class="tools">
            <input id="search" type="search" placeholder="Keresés névre vagy rendszámra" aria-label="Keresés">
            <div class="filter">
              <button data-filter="all" aria-pressed="true">Mind</button>
              <button data-filter="missing" aria-pressed="false">Hiányzik</button>
            </div>
          </div>
          <div class="list"><table>
            <thead><tr><th>Ügyfél</th><th>${esc(monthShort(wanted))}</th><th class="num hide-sm">${year} üzleti km</th><th class="num">${year} kifizetendő</th></tr></thead>
            <tbody id="rows"></tbody>
          </table></div>`
        : `<div class="card empty">
            <h2>Még nincs ügyfeled</h2>
            <p class="muted">Így adhatsz hozzá ügyfelet:</p>
            <ol class="steps">
              <li>Az ügyfeled a Trippo appban: Beállítások › Könyvelői hozzáférés › Link létrehozása.</li>
              <li>Elküldi neked a linket.</li>
              <li>Megnyitod, és rákattintasz: Hozzáadás az ügyfeleimhez.</li>
            </ol>
          </div>`
    }`);
  if (!clients.length) return;

  const row = (c) => {
    const ok = statusOf(c, wanted);
    const months = c.months.filter((m) => m.month.startsWith(String(year)));
    const total = months.reduce((s, m) => s + (m.payable ?? m.total ?? 0), 0);
    const kms = months.reduce((s, m) => s + (m.km || 0), 0);
    return `<tr data-id="${esc(c.id)}">
      <td><a class="row-link" href="${base}${esc(c.id)}">${esc(c.name || 'Névtelen ügyfél')}</a><span class="sub">${esc(c.plates.join(', ') || 'Még nincs lezárt hónap')}</span></td>
      <td><span class="pill ${ok ? 'ok' : 'wait'}">${ok ? 'Lezárva' : isReopened(c, wanted) ? 'Javítás alatt' : 'Hiányzik'}</span></td>
      <td class="num hide-sm">${km(kms)}</td>
      <td class="num">${huf(total)}</td>
    </tr>`;
  };
  const paint = () => {
    const q = document.getElementById('search').value.trim().toLowerCase();
    const shown = clients
      .filter((c) => filter === 'all' || !statusOf(c, wanted))
      .filter((c) => !q || (c.name || '').toLowerCase().includes(q) || c.plates.some((p) => p.toLowerCase().includes(q)))
      .sort((a, b) => statusOf(a, wanted) - statusOf(b, wanted) || (a.name || '').localeCompare(b.name || '', 'hu'));
    const body = document.getElementById('rows');
    body.innerHTML = shown.map(row).join('') || '<tr><td colspan="4" class="muted">Nincs találat.</td></tr>';
    body.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => (location.hash = base.slice(1) + tr.dataset.id)));
  };
  on('#search', 'input', paint);
  document.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      filter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      paint();
    }),
  );
  paint();
}

/* ---------- One client ---------- */

function clientView(id, name, closes, demo, reopened = []) {
  const people = closes[0]?.snapshot?.people || {};
  const title = name || people.driverName || 'Névtelen ügyfél';
  const years = [...new Set(closes.map((c) => c.month.slice(0, 4)))];
  let year = years[0];
  const file = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'ugyfel';

  const paint = () => {
    const shown = closes.filter((c) => c.month.startsWith(year));
    const sum = (f) => shown.reduce((s, c) => s + (f(c.snapshot || {}) || 0), 0);
    show(`<a class="back" href="${demo ? '#demo' : '#'}">‹ Ügyfelek</a>
      <div class="head">
        <h1>${esc(title)}</h1>
        <div class="actions">
          ${closes.length ? '<button class="primary" id="year-xlsx">Éves Excel</button><button id="print">Nyomtatás / PDF</button>' : ''}
          ${demo ? '' : '<button id="rename">Átnevezés</button><button id="remove" class="danger">Eltávolítás</button>'}
        </div>
      </div>
      ${reopenedNote(reopened)}
      ${
        closes.length
          ? `${years.length > 1 ? `<div class="year-tabs">${years.map((y) => `<button data-year="${esc(y)}" aria-pressed="${y === year}">${esc(y)}</button>`).join('')}</div>` : ''}
            <div class="stats">
              <div class="stat"><b>${huf(sum(payableOf))}</b><span>${esc(year)} kifizetendő</span></div>
              <div class="stat"><b>${km(sum((s) => s.business_km))}</b><span>üzleti km</span></div>
              <div class="stat"><b>${shown.length}</b><span>lezárt hónap</span></div>
            </div>
            ${shown.map(monthCard).join('')}`
          : '<div class="card empty"><h2>Még nincs lezárt hónap</h2><p class="muted">Amint az ügyfeled lezár egy hónapot, itt megjelenik.</p></div>'
      }`);
    bindMonths(shown, file);
    document.querySelectorAll('[data-year]').forEach((b) =>
      b.addEventListener('click', () => {
        year = b.dataset.year;
        paint();
      }),
    );
    on('#year-xlsx', 'click', () => download(`${file}-${year}`, yearWorkbook(shown, year)));
    on('#print', 'click', () => window.print());
    on('#rename', 'click', async () => {
      const next = window.prompt('Az ügyfél neve (csak te látod):', title);
      if (next == null) return;
      await call({ action: 'rename', id, name: next }).catch(() => {});
      route();
    });
    on('#remove', 'click', async () => {
      if (!window.confirm(`Eltávolítod: ${title}? A hozzáférésed megszűnik, új linket az ügyfeledtől kérhetsz.`)) return;
      await call({ action: 'remove', id }).catch(() => {});
      location.hash = '';
    });
  };
  paint();
}

/* ---------- A client's link ---------- */

const LINK_ERRORS = {
  claimed: 'Ezt a linket már egy könyvelő felvette az ügyfelei közé. Ha te voltál, lépj be azzal a fiókkal.',
  revoked: 'Ezt a linket az ügyfeled visszavonta. Kérj tőle újat a Trippo appból.',
  'own link': 'Ez a saját linked: az ügyfelek közé csak más fiókjának linkjét lehet felvenni.',
};

async function linkView(token) {
  const s = await session();
  let closes = null;
  let reopened = [];
  let owner = null;
  let problem = null;
  try {
    const shared = await call({ token }, false);
    closes = shared.closes || [];
    reopened = shared.reopened || [];
    owner = shared.owner;
  } catch (e) {
    problem = e.message;
  }
  // Already ours: straight to the client, and the secret leaves the address bar.
  if (problem === 'claimed' && s) {
    try {
      const { id } = await call({ action: 'claim', token });
      location.hash = 'c/' + id;
      return;
    } catch {}
  }
  if (problem) {
    show(`<div class="card empty"><h2>Ez a link nem nyitható meg</h2><p class="muted">${esc(LINK_ERRORS[problem] || 'Nem sikerült betölteni. Ellenőrizd az internetkapcsolatot.')}</p>
      ${s ? '' : loginForm('Belépés', 'Kódot küldünk e-mailben.')}</div>`);
    if (!s) bindLogin();
    return;
  }

  const name = closes[0]?.snapshot?.people?.driverName || owner;
  show(`<div class="notice">
      <p><b>${esc(name || 'Ügyfél')}</b> megosztotta veled a lezárt hónapjait.</p>
      ${s ? '<button class="primary" id="claim">Hozzáadás az ügyfeleimhez</button>' : '<button class="primary" id="want-login">Belépés és hozzáadás</button>'}
    </div>
    <div id="login-slot"></div>
    <p class="error hidden" id="claim-error"></p>
    <div class="head"><h1>${esc(name || 'Lezárt hónapok')}</h1><div class="actions"><button id="print">Nyomtatás / PDF</button></div></div>
    ${reopenedNote(reopened)}
    ${closes.length ? closes.map(monthCard).join('') : '<div class="card empty"><h2>Még nincs lezárt hónap</h2><p class="muted">Amint az ügyfeled lezár egy hónapot, itt megjelenik.</p></div>'}`);
  bindMonths(closes, 'utnyilvantartas');
  on('#print', 'click', () => window.print());
  on('#want-login', 'click', () => {
    document.getElementById('login-slot').innerHTML = loginForm('Belépés', 'Nincs jelszó: kódot küldünk e-mailben. Első belépéskor létrejön a fiókod.');
    bindLogin();
    document.getElementById('email').focus();
  });
  on('#claim', 'click', async (ev) => {
    ev.target.disabled = true;
    ev.target.textContent = 'Hozzáadás…';
    try {
      const { id } = await call({ action: 'claim', token });
      location.hash = 'c/' + id;
    } catch (e) {
      ev.target.disabled = false;
      ev.target.textContent = 'Hozzáadás az ügyfeleimhez';
      const box = document.getElementById('claim-error');
      box.textContent = LINK_ERRORS[e.message] || 'Nem sikerült hozzáadni. Próbáld újra.';
      box.classList.remove('hidden');
    }
  });
}

/* ---------- Demo (made-up data) ---------- */

const NORM = 8.6;
const PRICE = 605;
const fuelOf = (kms) => Math.round((kms * NORM * PRICE) / 100);
const DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];

function demoData() {
  const HOME = 'Budapest, Fő utca 1.';
  const months = (back) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  };
  const dayText = (month, day) => {
    const d = new Date(`${month.slice(0, 8)}${String(day).padStart(2, '0')}T12:00:00`);
    const name = DAYS[d.getDay()];
    return `${name[0].toUpperCase()}${name.slice(1)}, ${d.toLocaleDateString('hu-HU', { month: 'long' })} ${day}.`;
  };
  const close = (month, driverName, employerName, plate, scale) => {
    const line = (day, time, from, to, purpose, partner, kms) => ({ date: dayText(month, day), time, from, to, purpose, partner, km: kms, fuelHuf: fuelOf(kms), amortizationHuf: kms * 15 });
    const trip = (day, to, purpose, partner, kms) => [line(day, '08:10–09:45', HOME, to, purpose, partner, kms), line(day, '14:30–16:05', to, HOME, 'Visszaút', partner, kms)];
    const lines = [
      ...trip(4, 'Győr, Baross Gábor út 2.', 'Ügyféltalálkozó', 'Minta Bt.', Math.round(124 * scale)),
      ...trip(12, 'Kecskemét, Rákóczi út 5.', 'Helyszíni felmérés', 'Példa Kft.', Math.round(86 * scale)),
      ...trip(19, 'Szeged, Kárász utca 5.', 'Szerződés aláírása', 'Teszt Zrt.', Math.round(172 * scale)),
      ...trip(26, 'Érd, Budai út 14.', 'Árubemutató', 'Minta Bt.', Math.round(24 * scale)),
    ];
    const businessKm = lines.reduce((s, l) => s + l.km, 0);
    const fuel = fuelOf(businessKm);
    const amortization = businessKm * 15;
    const expenses = [{ date: dayText(month, 19), kind: 'Parkolás', trip: 'Budapest → Szeged', note: 'Kárász utca', amountHuf: 2400 }, { date: dayText(month, 19), kind: 'E-matrica', trip: 'Budapest → Szeged', note: 'M5 megyei', amountHuf: 6460 }];
    return {
      month,
      closed_at: month.slice(0, 8) + '28T17:00:00Z',
      start_odometer: 84210,
      end_odometer: 84210 + businessKm + 240,
      snapshot_hash: 'minta0000000000000000000000000000000000000000000000000000000000',
      vehicles: { plate, make_model: 'Škoda Octavia' },
      snapshot: {
        people: { driverName, employerName },
        odometer: { start: 84210, end: 84210 + businessKm + 240, yearStart: 72350, yearEnd: null },
        fuel: 'petrol',
        engine_ccm: 1498,
        business_km: businessKm,
        personal_km: 180,
        commute_km: 60,
        total_huf: fuel + amortization,
        fuel_cost_huf: fuel,
        amortization_huf: amortization,
        norm_l_per_100km: NORM,
        fuel_price_huf_per_l: PRICE,
        price_label: `${PRICE} Ft/l (NAV)`,
        general_norm_huf_per_km: 15,
        per_diem: { days: [`${month.slice(0, 8)}04`, `${month.slice(0, 8)}19`], hufPerDay: 500, totalHuf: 1000 },
        expenses,
        expenses_huf: 8860,
        lines,
      },
    };
  };
  const people = [
    ['1', 'Kiss Példa Anna', 'Példa Trade Kft.', 'AAA-111', 0.6, 0],
    ['2', 'Minta Építő Kft.', 'Minta Építő Kft.', 'BBB-222', 1, 0],
    ['3', 'Nagy Teszt Péter', 'Teszt Szerviz Bt.', 'CCC-333', 0.4, 1],
  ];
  const clients = people.map(([id, name, employer, plate, scale, skip]) => {
    const closes = [1, 2, 3].slice(skip).map((b) => close(months(b), name, employer, plate, scale));
    return { id, name, plates: [plate], closes, months: closes.map((c) => ({ month: c.month, total: c.snapshot.total_huf, payable: payableOf(c.snapshot), km: c.snapshot.business_km })) };
  });
  return clients;
}

/* ---------- Router ---------- */

async function header(s, demo) {
  who.innerHTML = s && !demo ? `<span>${esc(s.user.email)}</span><button id="logout">Kilépés</button>` : '';
  on('#logout', 'click', async () => {
    await sb.auth.signOut();
    location.hash = '';
    route();
  });
}

async function route() {
  document.body.classList.remove('landing');
  const hash = location.hash.slice(1);
  const s = await session();
  try {
    if (hash.startsWith('demo')) {
      await header(null, true);
      const clients = demoData();
      const one = hash.match(/^demo\/c\/(.+)$/);
      const client = one && clients.find((c) => c.id === one[1]);
      return client ? clientView(client.id, client.name, client.closes, true) : dashboardView(clients, true);
    }
    await header(s, false);
    if (/^[0-9a-f]{64}$/.test(hash)) return await linkView(hash);
    if (!s) return loginView();
    const one = hash.match(/^c\/(.+)$/);
    if (one) {
      const { name, closes, reopened, owner } = await call({ action: 'client', id: one[1] });
      return clientView(one[1], name || owner, closes, false, reopened);
    }
    const { clients } = await call({ action: 'clients' });
    dashboardView(clients, false);
  } catch {
    show('<div class="card empty"><h2>Nem sikerült betölteni</h2><p class="muted">Ellenőrizd az internetkapcsolatot, és próbáld újra.</p><a class="button" href="#">Vissza az ügyfelekhez</a></div>');
  }
}

window.addEventListener('hashchange', route);
route();
