'use strict';
/*
 * Könyvelői portál. Routes live in the URL's #fragment, so nothing secret reaches a server log:
 *   #<64 hex>   a client's link (read-only; a logged-in accountant can add it to their clients)
 *   (empty)     login, or the client list
 *   #c/<id>     one client
 *   #demo…      the same screens with made-up data, no login
 * Everything from the server goes through esc(): this page holds a login, and trip purposes,
 * partners and names are typed by clients.
 */
const BASE = 'https://rudnmzhfgnynlmjdrwoy.supabase.co';
const ANON = 'sb_publishable_Tyxe0cP-kh_mCvH5oCEcsw_qDRYTL8X';
const FN = BASE + '/functions/v1/accountant';

// detectSessionInUrl off: the #fragment here is ours (a client's link), not an auth redirect.
const sb = window.supabase.createClient(BASE, ANON, { auth: { detectSessionInUrl: false, persistSession: true, storageKey: 'trippo-accountant-auth' } });

const app = document.getElementById('app');
const who = document.getElementById('who');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const huf = (n) => (n == null ? '–' : Math.round(n).toLocaleString('hu-HU') + ' Ft');
const km = (n) => Math.round(n ?? 0).toLocaleString('hu-HU') + ' km';
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

// A cell starting with these runs as a formula in Excel, and clients type these texts.
const cell = (v) => {
  const s = String(v ?? '');
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
};

function csvRows(c) {
  const s = c.snapshot || {};
  const rows = [];
  for (const l of s.lines || []) rows.push([l.date, l.time, l.from, l.to, l.purpose, l.partner, l.km, l.fuelHuf, l.amortizationHuf]);
  rows.push([monthName(c.month) + ' összesen', '', '', '', '', '', s.business_km, s.fuel_cost_huf, s.amortization_huf]);
  for (const e of s.expenses || []) rows.push([e.date, e.kind, e.trip, '', e.note, '', '', e.amountHuf, '']);
  if (s.per_diem) rows.push(['Napidíj', s.per_diem.days.length + ' nap', '', '', '', '', '', s.per_diem.totalHuf, '']);
  return rows;
}

function download(name, closes) {
  const head = ['Dátum', 'Idő', 'Honnan', 'Hová', 'Cél', 'Partner', 'Km', 'Üzemanyag (Ft)', 'Normaköltség (Ft)'];
  const rows = [head, ...closes.flatMap(csvRows)];
  const text = '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ---------- Months ---------- */

function monthCard(c, i) {
  const s = c.snapshot || {};
  const people = s.people || {};
  const extra = (s.per_diem ? s.per_diem.totalHuf : 0) + (s.expenses_huf || 0);
  return `<div class="card month" data-month="${i}">
    <button class="month-head" aria-expanded="false">
      <span><b>${esc(monthName(c.month))}</b><span class="sub">${esc(c.vehicles?.plate)} · ${esc(people.driverName)} · ${km(s.business_km)} üzleti</span></span>
      <span class="amount">${huf(s.total_huf)}</span>
    </button>
    <div class="details">
      <p class="muted">Norma: ${esc(s.norm_l_per_100km)} l/100 km · NAV-ár: ${esc(s.price_label)} · ${esc(s.general_norm_huf_per_km)} Ft/km<br>
      Km-óra: ${esc(c.start_odometer)} → ${esc(c.end_odometer)} · Lezárva: ${esc(new Date(c.closed_at).toLocaleString('hu-HU'))}
      ${extra ? '<br>Napidíj és számla alapján: ' + huf(extra) : ''}</p>
      <div class="scroll"><table><thead><tr><th>Dátum</th><th>Honnan → Hová</th><th>Cél / partner</th><th class="num">Km</th></tr></thead><tbody>
      ${(s.lines || [])
        .map((l) => `<tr><td>${esc(l.date)}<span class="sub">${esc(l.time)}</span></td><td>${esc(l.from)} → ${esc(l.to)}</td><td>${esc(l.purpose)}${l.partner ? ' · ' + esc(l.partner) : ''}</td><td class="num">${esc(l.km)}</td></tr>`)
        .join('')}
      </tbody></table></div>
      <p class="hash">Ellenőrző kód (SHA-256): ${esc(c.snapshot_hash)}</p>
      <div class="actions"><button data-csv="${i}">Letöltés Excelbe (CSV)</button></div>
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
  document.querySelectorAll('[data-csv]').forEach((b) =>
    b.addEventListener('click', () => {
      const c = closes[Number(b.dataset.csv)];
      download(`${fileBase}-${c.month.slice(0, 7)}`, [c]);
    }),
  );
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
  show(`<section class="hero">
    <div>
      <h1>Minden ügyfeled útnyilvántartása egy helyen</h1>
      <p class="lead">Ügyfeleid a Trippo appal vezetik a kilométereiket. Te itt látod a lezárt hónapjaikat, készen a könyveléshez.</p>
      <ul class="points">
        <li><b>Egy belépés, minden ügyfél</b><span>Egy pillantásra látod, ki zárta le a múlt hónapot, és kire kell még várni.</span></li>
        <li><b>Utólag nem módosítható</b><span>A lezárt hónap befagy; az ellenőrző kód igazolja, hogy az adat azóta nem változott.</span></li>
        <li><b>Kész az Excelbe</b><span>Havi vagy éves CSV, NAV-árral, normával és km-óra-állással.</span></li>
        <li><b>Ingyenes a könyvelőknek</b><span>Csak azt látod, amit az ügyfeled megoszt veled, és ezt bármikor visszavonhatja.</span></li>
      </ul>
      <a class="button" href="#demo">Minta megtekintése</a>
    </div>
    ${loginForm('Belépés', 'Nincs jelszó: kódot küldünk e-mailben. Első belépéskor létrejön a fiókod.')}
  </section>`);
  bindLogin();
}

/* ---------- Client list ---------- */

function statusOf(client, wanted) {
  return client.months.some((m) => m.month.slice(0, 7) === wanted.slice(0, 7));
}

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
            <thead><tr><th>Ügyfél</th><th>${esc(monthShort(wanted))}</th><th class="num hide-sm">${year} üzleti km</th><th class="num">${year} összesen</th></tr></thead>
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
    const total = months.reduce((s, m) => s + (m.total || 0), 0);
    const kms = months.reduce((s, m) => s + (m.km || 0), 0);
    return `<tr data-id="${esc(c.id)}">
      <td><a class="row-link" href="${base}${esc(c.id)}">${esc(c.name || 'Névtelen ügyfél')}</a><span class="sub">${esc(c.plates.join(', ') || 'Nincs lezárt hónap')}</span></td>
      <td><span class="pill ${ok ? 'ok' : 'wait'}">${ok ? 'Lezárva' : 'Hiányzik'}</span></td>
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

function clientView(id, name, closes, demo) {
  const people = closes[0]?.snapshot?.people || {};
  const title = name || people.driverName || 'Névtelen ügyfél';
  const years = [...new Set(closes.map((c) => c.month.slice(0, 4)))];
  let year = years[0];
  const file = title.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase();

  const paint = () => {
    const shown = closes.filter((c) => c.month.startsWith(year));
    const sum = (f) => shown.reduce((s, c) => s + (f(c.snapshot || {}) || 0), 0);
    show(`<a class="back" href="${demo ? '#demo' : '#'}">‹ Ügyfelek</a>
      <div class="head">
        <h1>${esc(title)}</h1>
        <div class="actions">
          ${closes.length ? '<button id="year-csv">Éves CSV</button><button id="print">Nyomtatás / PDF</button>' : ''}
          ${demo ? '' : '<button id="rename">Átnevezés</button><button id="remove" class="danger">Eltávolítás</button>'}
        </div>
      </div>
      ${
        closes.length
          ? `${years.length > 1 ? `<div class="year-tabs">${years.map((y) => `<button data-year="${esc(y)}" aria-pressed="${y === year}">${esc(y)}</button>`).join('')}</div>` : ''}
            <div class="stats">
              <div class="stat"><b>${huf(sum((s) => s.total_huf))}</b><span>${esc(year)} összesen</span></div>
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
    on('#year-csv', 'click', () => download(`${file}-${year}`, shown));
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
  let problem = null;
  try {
    closes = (await call({ token }, false)).closes || [];
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

  const name = closes[0]?.snapshot?.people?.driverName;
  show(`<div class="notice">
      <p><b>${esc(name || 'Ügyfél')}</b> megosztotta veled a lezárt hónapjait.</p>
      ${s ? '<button class="primary" id="claim">Hozzáadás az ügyfeleimhez</button>' : '<button class="primary" id="want-login">Belépés és hozzáadás</button>'}
    </div>
    <div id="login-slot"></div>
    <p class="error hidden" id="claim-error"></p>
    <div class="head"><h1>${esc(name || 'Lezárt hónapok')}</h1><div class="actions"><button id="print">Nyomtatás / PDF</button></div></div>
    ${closes.length ? closes.map(monthCard).join('') : '<div class="card empty"><h2>Még nincs lezárt hónap</h2><p class="muted">Amint az ügyfeled lezár egy hónapot, itt megjelenik.</p></div>'}`);
  bindMonths(closes, 'utnyilvantartas');
  on('#print', 'click', () => window.print());
  on('#want-login', 'click', () => {
    document.getElementById('login-slot').innerHTML = loginForm('Belépés', 'Nincs jelszó: kódot küldünk e-mailben. Első belépéskor létrejön a fiókod.');
    bindLogin();
    document.getElementById('email').focus();
  });
  on('#claim', 'click', async () => {
    try {
      const { id } = await call({ action: 'claim', token });
      location.hash = 'c/' + id;
    } catch (e) {
      const box = document.getElementById('claim-error');
      box.textContent = LINK_ERRORS[e.message] || 'Nem sikerült hozzáadni. Próbáld újra.';
      box.classList.remove('hidden');
    }
  });
}

/* ---------- Demo (made-up data) ---------- */

function demoData() {
  const line = (date, from, to, purpose, partner, kmv) => ({ date, time: '08:10–08:45', from, to, purpose, partner, km: kmv, fuelHuf: Math.round(kmv * 57), amortizationHuf: kmv * 15 });
  const months = (back) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  };
  const close = (month, driverName, plate, kms) => ({
    month,
    closed_at: month.slice(0, 8) + '28T17:00:00Z',
    start_odometer: 84210,
    end_odometer: 84210 + kms + 240,
    snapshot_hash: 'minta0000000000000000000000000000000000000000000000000000000000',
    vehicles: { plate },
    snapshot: {
      people: { driverName },
      business_km: kms,
      total_huf: kms * 72,
      fuel_cost_huf: kms * 57,
      amortization_huf: kms * 15,
      norm_l_per_100km: 9.5,
      price_label: 'NAV',
      general_norm_huf_per_km: 15,
      lines: [line(month.slice(0, 8) + '04', 'Budapest, Fő utca 1.', 'Győr, Baross út 2.', 'Ügyféltalálkozó', 'Minta Bt.', Math.round(kms / 2)), line(month.slice(0, 8) + '19', 'Budapest, Fő utca 1.', 'Szeged, Kárász u. 5.', 'Helyszíni felmérés', 'Példa Kft.', Math.round(kms / 2))],
    },
  });
  const people = [
    ['1', 'Kiss Példa Anna', 'AAA-111', 640, 0],
    ['2', 'Minta Építő Kft.', 'BBB-222', 1180, 0],
    ['3', 'Nagy Teszt Péter', 'CCC-333', 420, 1],
  ];
  const clients = people.map(([id, name, plate, kms, skip]) => {
    const closes = [1, 2, 3].slice(skip).map((b) => close(months(b), name, plate, kms));
    return { id, name, plates: [plate], closes, months: closes.map((c) => ({ month: c.month, total: c.snapshot.total_huf, km: c.snapshot.business_km })) };
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
      const { name, closes } = await call({ action: 'client', id: one[1] });
      return clientView(one[1], name, closes, false);
    }
    const { clients } = await call({ action: 'clients' });
    dashboardView(clients, false);
  } catch {
    show('<div class="card empty"><h2>Nem sikerült betölteni</h2><p class="muted">Ellenőrizd az internetkapcsolatot, és próbáld újra.</p><a class="button" href="#">Vissza az ügyfelekhez</a></div>');
  }
}

window.addEventListener('hashchange', route);
route();
