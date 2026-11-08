/*
 * Útjaim: a driver's own trips on the web. Same login as the app (e-mail code); reads and writes
 * the driver's rows directly, protected by row level security. Light editing only: the category of a
 * trip, and the purpose and partner of a business trip. Closing a month stays in the app.
 *   (empty)  login, or the trips
 *   #demo    the same screen with made-up data, no login
 * Everything from the server goes through esc(): purposes and partners are typed by people.
 */
import { XLSX_MIME, isShareLog, monthWorkbook, payableOf, yearWorkbook } from './workbook.js';

const BASE = 'https://rudnmzhfgnynlmjdrwoy.supabase.co';
const ANON = 'sb_publishable_Tyxe0cP-kh_mCvH5oCEcsw_qDRYTL8X';
const sb = window.supabase.createClient(BASE, ANON, { auth: { detectSessionInUrl: false, persistSession: true, storageKey: 'trippo-driver-auth' } });

const app = document.getElementById('app');
const who = document.getElementById('who');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const huf = (n) => (n == null ? '–' : grouped(n) + ' Ft');
const km = (n) => grouped(n ?? 0) + ' km';
const kmOf = (m) => Math.round((m ?? 0) / 1000);
const comma = (n) => String(n ?? '–').replace('.', ',');
const on = (selector, event, fn) => document.querySelector(selector)?.addEventListener(event, fn);

const CATEGORIES = [
  ['business', 'Üzleti'],
  ['personal', 'Magán'],
  ['commute', 'Munkába'],
];
const LABEL = { business: 'Üzleti', personal: 'Magán', commute: 'Munkába járás', unreviewed: 'Döntésre vár' };
/** What a private trip may keep on the server (the privacy policy; the database enforces it too). */
const PRIVATE_DETAIL_KEYS = ['road_route', 'stops', 'gaps', 'start_fill', 'note'];
const TRIP_COLUMNS = 'id, vehicle_id, started_at, ended_at, start_address, end_address, start_lat, end_lat, distance_m, category, purpose, partner_name, locked, details';

/* ---------- Months ---------- */

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const shift = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  return ym(new Date(y, m - 1 + n, 1));
};
const monthName = (month) => new Date(month + '-01T00:00:00').toLocaleDateString('hu-HU', { year: 'numeric', month: 'long' });
const monthStart = (month) => new Date(month + '-01T00:00:00');
const dayName = (iso) => new Date(iso).toLocaleDateString('hu-HU', { weekday: 'long', month: 'long', day: 'numeric' });
const time = (iso) => new Date(iso).toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
/** Closing opens on the month's last day, as in the app. */
const closable = (month) => {
  const last = new Date(monthStart(shift(month, 1)).getTime() - 1);
  last.setHours(0, 0, 0, 0);
  return new Date() >= last;
};

/* ---------- Data: the real account, or the demo ---------- */

const real = {
  async vehicles() {
    const { data, error } = await sb.from('vehicles').select('id, plate, make_model, usage, is_default').is('archived_at', null).order('created_at');
    if (error) throw error;
    return data;
  },
  async trips(vehicle, vehicles, month) {
    let q = sb
      .from('trips')
      .select(TRIP_COLUMNS)
      .gte('started_at', monthStart(month).toISOString())
      .lt('started_at', monthStart(shift(month, 1)).toISOString())
      .order('started_at');
    // Trips from before the garage have no car: they belong to the default one.
    if (vehicles.length > 1) q = vehicle.is_default ? q.or(`vehicle_id.eq.${vehicle.id},vehicle_id.is.null`) : q.eq('vehicle_id', vehicle.id);
    const { data, error } = await q;
    if (error) throw error;
    return data;
  },
  /** The newest trip of this car, for an empty month to point at. */
  async latest(vehicle, vehicles) {
    let q = sb.from('trips').select('started_at').order('started_at', { ascending: false }).limit(1);
    if (vehicles.length > 1) q = vehicle.is_default ? q.or(`vehicle_id.eq.${vehicle.id},vehicle_id.is.null`) : q.eq('vehicle_id', vehicle.id);
    const { data, error } = await q;
    if (error) throw error;
    return data[0]?.started_at ?? null;
  },
  async closes(vehicle) {
    const { data, error } = await sb
      .from('month_closes')
      .select('id, month, closed_at, reopened_at, start_odometer, end_odometer, snapshot, snapshot_hash, vehicles(plate, make_model)')
      .eq('vehicle_id', vehicle.id)
      .order('month');
    if (error) throw error;
    return data;
  },
  async update(trip, patch) {
    const { data, error } = await sb.from('trips').update(patch).eq('id', trip.id).select(TRIP_COLUMNS).single();
    if (error) throw error;
    return data;
  },
};

const demo = (() => {
  const now = new Date();
  const month = ym(now);
  const prev = shift(month, -1);
  const at = (m, day, h, min) => new Date(`${m}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).toISOString();
  const trip = (id, m, day, h, min, dur, from, to, kmv, category, purpose, partner, locked = false) => ({
    id, vehicle_id: 'demo-car', started_at: at(m, day, h, min), ended_at: new Date(new Date(at(m, day, h, min)).getTime() + dur * 60000).toISOString(),
    start_address: category === 'personal' ? null : from, end_address: category === 'personal' ? null : to,
    start_lat: category === 'personal' ? null : 47.5, end_lat: category === 'personal' ? null : 47.5,
    distance_m: kmv * 1000, category, purpose, partner_name: partner, locked, details: null,
  });
  const today = Math.max(3, Math.min(now.getDate(), 28));
  const trips = [
    trip('d1', prev, 6, 7, 40, 35, 'Budaörs, Szabadság út 1.', 'Budapest, Váci út 30.', 18, 'commute', null, null, true),
    trip('d2', prev, 6, 13, 0, 70, 'Budapest, Váci út 30.', 'Kecskemét, Kossuth tér 1.', 86, 'business', 'Ügyféltárgyalás', 'Alföld Kft.', true),
    trip('d3', prev, 6, 16, 30, 75, 'Kecskemét, Kossuth tér 1.', 'Budaörs, Szabadság út 1.', 92, 'business', 'Visszaút ügyféltől', 'Alföld Kft.', true),
    trip('d4', prev, 9, 10, 0, 25, null, null, 3, 'personal', null, null, true),
    trip('d5', month, today - 2, 7, 45, 35, 'Budaörs, Szabadság út 1.', 'Budapest, Váci út 30.', 18, 'commute', null, null),
    trip('d6', month, today - 2, 13, 40, 85, 'Budapest, Váci út 30.', 'Győr, Baross Gábor út 12.', 121, 'business', 'Szállítói egyeztetés', '', false),
    trip('d7', month, today - 2, 17, 0, 80, 'Győr, Baross Gábor út 12.', 'Budaörs, Szabadság út 1.', 113, 'unreviewed', null, null),
    trip('d8', month, today - 1, 10, 0, 20, 'Budaörs, Szabadság út 1.', 'Budaörs, Templom tér 3.', 4, 'unreviewed', null, null),
  ];
  const snapshot = {
    people: { driverName: 'Minta Márton', employerName: 'Minta Kft.' }, odometer: { start: 84000, end: 86130, yearStart: 72350 },
    fuel: 'petrol', engine_ccm: 1498, norm_l_per_100km: 8.6, fuel_price_huf_per_l: 605, general_norm_huf_per_km: 15, price_label: '605 Ft/l (NAV)',
    business_km: 178, personal_km: 3, commute_km: 18, fuel_cost_huf: 9262, amortization_huf: 2670, total_huf: 11932, expenses: [], expenses_huf: 0,
    lines: [
      { date: 'Hétfő, 6.', time: '13:00–14:10', from: 'Budapest, Váci út 30.', to: 'Kecskemét, Kossuth tér 1.', purpose: 'Ügyféltárgyalás', partner: 'Alföld Kft.', km: 86, fuelHuf: 4475, amortizationHuf: 1290 },
      { date: 'Hétfő, 6.', time: '16:30–17:45', from: 'Kecskemét, Kossuth tér 1.', to: 'Budaörs, Szabadság út 1.', purpose: 'Visszaút ügyféltől', partner: 'Alföld Kft.', km: 92, fuelHuf: 4787, amortizationHuf: 1380 },
    ],
  };
  const closes = [{ id: 'dc', month: prev + '-01', closed_at: new Date(monthStart(month).getTime() + 8 * 3600e3).toISOString(), reopened_at: null, start_odometer: 84000, end_odometer: 86130, snapshot, snapshot_hash: 'demo0000000000000000000000000000000000000000000000000000000000ab', vehicles: { plate: 'MNT-001', make_model: 'Minta autó' } }];
  return {
    async vehicles() {
      return [{ id: 'demo-car', plate: 'MNT-001', make_model: 'Minta autó', usage: 'own', is_default: true }];
    },
    async trips(_v, _vs, m) {
      return trips.filter((t) => ym(new Date(t.started_at)) === m).map((t) => ({ ...t }));
    },
    async closes() {
      return closes;
    },
    async latest() {
      return trips[trips.length - 1].started_at;
    },
    async update(t, patch) {
      const row = trips.find((x) => x.id === t.id);
      Object.assign(row, patch);
      return { ...row };
    },
  };
})();

/* ---------- State ---------- */

const state = { api: real, demo: false, vehicles: [], vehicle: null, month: ym(new Date()), trips: [], closes: [], latest: null, filter: 'all', error: null };

const activeClose = (month) => state.closes.find((c) => c.month.slice(0, 7) === month && !c.reopened_at);
const reopened = (month) => !activeClose(month) && state.closes.some((c) => c.month.slice(0, 7) === month && c.reopened_at);
const missing = (t) => t.category === 'business' && !(t.purpose?.trim() && t.partner_name?.trim());

async function load() {
  state.error = null;
  try {
    state.vehicles = await state.api.vehicles();
    if (!state.vehicles.length) return;
    const keep = state.vehicles.find((v) => v.id === state.vehicle?.id);
    state.vehicle = keep ?? state.vehicles.find((v) => v.is_default) ?? state.vehicles[0];
    [state.trips, state.closes] = await Promise.all([state.api.trips(state.vehicle, state.vehicles, state.month), state.api.closes(state.vehicle)]);
    state.latest = state.trips.length ? null : await state.api.latest(state.vehicle, state.vehicles);
  } catch {
    state.error = 'Nem sikerült betölteni az utakat. Ellenőrizd az internetkapcsolatot, és frissítsd az oldalt.';
  }
}

/* ---------- Export ---------- */

function download(name, bytes) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  a.download = name + '.xlsx';
  a.click();
  URL.revokeObjectURL(a.href);
}
const fileBase = () => `trippo-utnyilvantartas-${(state.vehicle?.plate || 'auto').replace(/[^A-Za-z0-9]/g, '')}`;

/* ---------- Screens ---------- */

function show(html) {
  app.innerHTML = html;
}

function whoBar(email) {
  who.innerHTML = state.demo
    ? '<span>Minta, belépés nélkül</span><a class="button" href="#">Belépés</a>'
    : `<span>${esc(email)}</span><button id="logout" class="link">Kilépés</button>`;
  on('#logout', 'click', async () => {
    await sb.auth.signOut();
    route();
  });
}

function statsBlock() {
  const sum = (cat) => state.trips.filter((t) => t.category === cat).reduce((a, t) => a + kmOf(t.distance_m), 0);
  const waiting = state.trips.filter((t) => t.category === 'unreviewed').length;
  return `<div class="stats four">
    <div class="stat"><b>${km(sum('business'))}</b><span>Üzleti</span></div>
    <div class="stat"><b>${km(sum('personal'))}</b><span>Magán</span></div>
    <div class="stat"><b>${km(sum('commute'))}</b><span>Munkába járás</span></div>
    <div class="stat${waiting ? ' alert' : ''}"><b>${waiting}</b><span>Döntésre vár</span></div>
  </div>`;
}

function closedBlock(c) {
  const s = c.snapshot || {};
  const money = [
    [`Üzemanyag (${km(s.business_km)} × ${esc(comma(s.norm_l_per_100km))} l/100 km × ${esc(s.price_label)})`, s.fuel_cost_huf],
    ...(s.usage === 'borrowed' ? [] : [[`Normaköltség (${km(s.business_km)} × ${esc(s.general_norm_huf_per_km)} Ft)`, s.amortization_huf]]),
    ...(s.per_diem ? [[`Napidíj (${esc(s.per_diem.days.length)} nap × ${huf(s.per_diem.hufPerDay)})`, s.per_diem.totalHuf]] : []),
    ...((s.expenses || []).length ? [[`Számla alapján (${esc(s.expenses.length)} tétel)`, s.expenses_huf]] : []),
  ];
  return `<div class="card closed">
    <div class="closed-head"><span class="pill ok">Lezárva</span><span class="muted">${esc(new Date(c.closed_at).toLocaleString('hu-HU'))}</span></div>
    ${
      isShareLog(s)
        ? `<table class="calc"><tbody><tr><td>Üzleti km</td><td class="num">${km(s.business_km)}</td></tr>
            <tr class="sum"><td>Üzleti arány</td><td class="num">${esc(comma(s.business_share_pct))} %</td></tr></tbody></table>`
        : `<table class="calc"><tbody>${money.map(([label, value]) => `<tr><td>${label}</td><td class="num">${huf(value)}</td></tr>`).join('')}
            <tr class="sum"><td>Kifizetendő összesen</td><td class="num">${huf(payableOf(s))}</td></tr></tbody></table>`
    }
    <p class="hash">Ellenőrző kód (SHA-256): ${esc(c.snapshot_hash)}</p>
    <div class="actions"><button class="primary" id="month-xlsx">Excel letöltése</button><button id="print">Nyomtatás / PDF</button></div>
    <p class="muted small">A hivatalos PDF-et (útnyilvántartás és kiküldetési rendelvény) az app készíti el és küldi a könyvelődnek. Javítani az appban tudsz: ott nyithatod újra a hónapot.</p>
  </div>`;
}

function openBlock() {
  const waiting = state.trips.filter((t) => t.category === 'unreviewed').length;
  const gaps = state.trips.filter(missing).length;
  const todo = [
    waiting ? `${waiting} út vár döntésre` : '',
    gaps ? `${gaps} üzleti útnál hiányzik a cél vagy a partner` : '',
  ].filter(Boolean);
  const ready = closable(state.month);
  const head = reopened(state.month) ? 'Javításra újranyitva' : ready ? 'Lezárható az appban' : 'Folyamatban';
  return `<div class="notice ${todo.length ? 'warn' : ''}" id="status">
    <p><b>${esc(head)}.</b> ${todo.length ? esc(todo.join(', ')) + '. Itt is rendezheted őket.' : ready ? 'Minden út a helyén: a lezárást a Riport fülön indíthatod az appban.' : 'A hónap utolsó napjától zárható le az appban.'}</p>
  </div>`;
}

function tripCard(t) {
  const priv = t.category === 'personal';
  const noPlace = !t.start_address && !t.end_address;
  const route = noPlace ? (priv ? 'Magánút' : 'A címeket a telefonod tölti fel') : `${esc(t.start_address || '–')} → ${esc(t.end_address || '–')}`;
  const segment = t.locked
    ? `<span class="pill">${esc(LABEL[t.category])}</span>`
    : `<div class="seg" role="group" aria-label="Kategória">${CATEGORIES.map(
        ([value, label]) => `<button data-cat="${value}" data-id="${esc(t.id)}" aria-pressed="${t.category === value}">${label}</button>`,
      ).join('')}</div>`;
  const fields =
    t.category === 'business'
      ? t.locked
        ? `<p class="purpose">${esc(t.purpose || '–')}${t.partner_name ? ' · ' + esc(t.partner_name) : ''}</p>`
        : `<div class="fields">
            <label>Cél<input data-field="purpose" data-id="${esc(t.id)}" value="${esc(t.purpose || '')}" maxlength="200" placeholder="pl. ügyféltárgyalás"></label>
            <label>Partner<input data-field="partner_name" data-id="${esc(t.id)}" value="${esc(t.partner_name || '')}" maxlength="200" placeholder="pl. Alföld Kft."></label>
          </div>`
      : '';
  return `<article class="trip${t.category === 'unreviewed' ? ' waiting' : ''}${missing(t) && !t.locked ? ' missing' : ''}" id="t-${esc(t.id)}">
    <div class="trip-top">
      <div class="trip-main"><span class="when">${esc(time(t.started_at))}–${esc(time(t.ended_at))}</span><span class="route${noPlace ? ' muted' : ''}">${route}</span></div>
      <b class="trip-km">${km(kmOf(t.distance_m))}</b>
    </div>
    <div class="trip-bottom">${segment}${t.locked ? '<span class="muted small">Lezárt hónap</span>' : '<span class="saved muted small" aria-live="polite"></span>'}</div>
    ${fields}
  </article>`;
}

function tripList() {
  const shown = state.trips.filter((t) =>
    state.filter === 'waiting' ? t.category === 'unreviewed' : state.filter === 'business' ? t.category === 'business' : state.filter === 'missing' ? missing(t) || t.category === 'unreviewed' : true,
  );
  if (!state.trips.length) {
    const last = state.latest && new Date(state.latest);
    const jump = last && ym(last) !== state.month ? `<p><button class="primary" id="to-latest" data-month="${ym(last)}">Ugrás: ${esc(monthName(ym(last)))}</button></p>` : '';
    return `<div class="card empty"><p class="muted">Ebben a hónapban ennél az autónál nincs út.${
      last ? ` A legutóbbi út: ${esc(last.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }))}` : ' Még egy út sincs feltöltve: az app a következő szinkronnál küldi fel őket.'
    }</p>${jump}<p class="muted small">Itt azok az utak látszanak, amelyeket a telefonod már feltöltött. Ha hiányzik egy, nyisd meg az appot internetkapcsolattal.</p></div>`;
  }
  if (!shown.length) return '<div class="card empty"><p class="muted">Nincs ilyen út ebben a hónapban.</p></div>';
  const days = [];
  for (const t of shown) {
    const day = dayName(t.started_at);
    if (days[days.length - 1]?.day !== day) days.push({ day, trips: [] });
    days[days.length - 1].trips.push(t);
  }
  return days.map((d) => `<section class="day"><h3>${esc(d.day)}</h3>${d.trips.map(tripCard).join('')}</section>`).join('');
}

function dashboard() {
  if (state.error) return show(`<div class="card empty"><p>${esc(state.error)}</p></div>`);
  if (!state.vehicles.length)
    return show(`<div class="card empty"><h2>Még nincs autó a fiókodban</h2><p class="muted">Add hozzá az autódat a Trippo appban, és az utaid itt is megjelennek.</p></div>`);
  const close = activeClose(state.month);
  const year = state.month.slice(0, 4);
  const yearCloses = state.closes.filter((c) => !c.reopened_at && c.month.startsWith(year));
  const filters = [['all', 'Mind'], ['waiting', 'Döntésre vár'], ['business', 'Üzleti'], ['missing', 'Hiányos']];
  show(`
    ${state.demo ? '<div class="notice"><p><b>Ez egy minta.</b> Kipróbálhatod a besorolást és a mezőket, de semmi nem mentődik.</p></div>' : ''}
    <div class="head">
      <div><h1>Útjaim</h1>${state.vehicles.length > 1 ? '' : `<span class="muted">${esc(state.vehicle.plate)}${state.vehicle.make_model ? ' · ' + esc(state.vehicle.make_model) : ''}</span>`}</div>
      <div class="pickers">
        ${state.vehicles.length > 1 ? `<select id="car" aria-label="Autó">${state.vehicles.map((v) => `<option value="${esc(v.id)}"${v.id === state.vehicle.id ? ' selected' : ''}>${esc(v.plate)}${v.make_model ? ' · ' + esc(v.make_model) : ''}</option>`).join('')}</select>` : ''}
        <div class="month-nav"><button id="prev" aria-label="Előző hónap">‹</button><b>${esc(monthName(state.month))}</b><button id="next" aria-label="Következő hónap"${state.month >= ym(new Date()) ? ' disabled' : ''}>›</button></div>
      </div>
    </div>
    ${statsBlock()}
    ${close ? closedBlock(close) : openBlock()}
    <div class="tools"><div class="filter">${filters.map(([v, l]) => `<button data-filter="${v}" aria-pressed="${state.filter === v}">${l}</button>`).join('')}</div></div>
    <div id="trips">${tripList()}</div>
    ${yearCloses.length ? `<div class="card year"><div><b>${esc(year)}</b><span class="muted"> · ${yearCloses.length} lezárt hónap</span></div><button id="year-xlsx">Éves összesítő (Excel)</button></div>` : ''}
  `);
  bindDashboard(close, yearCloses, year);
}

function bindDashboard(close, yearCloses, year) {
  const go = async (month) => {
    state.month = month;
    app.classList.add('loading');
    await load();
    app.classList.remove('loading');
    dashboard();
  };
  on('#prev', 'click', () => go(shift(state.month, -1)));
  on('#to-latest', 'click', (e) => go(e.target.dataset.month));
  on('#next', 'click', () => go(shift(state.month, 1)));
  on('#car', 'change', async (e) => {
    state.vehicle = state.vehicles.find((v) => v.id === e.target.value);
    await go(state.month);
  });
  on('#month-xlsx', 'click', () => download(`${fileBase()}-${state.month}`, monthWorkbook(close)));
  on('#print', 'click', () => window.print());
  on('#year-xlsx', 'click', () => download(`${fileBase()}-${year}`, yearWorkbook(yearCloses, year)));
  document.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      document.getElementById('trips').innerHTML = tripList();
      bindTrips();
    }),
  );
  bindTrips();
}

function flash(id, text, bad = false) {
  const el = document.querySelector(`#t-${CSS.escape(id)} .saved`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', bad);
}

async function save(trip, patch) {
  try {
    const row = await state.api.update(trip, patch);
    Object.assign(trip, row);
    return true;
  } catch (e) {
    const locked = String(e?.message || '').includes('closed month');
    flash(trip.id, locked ? 'Ez a hónap le van zárva, az appban nyithatod újra.' : 'Nem sikerült menteni. Próbáld újra.', true);
    return false;
  }
}

/** The month status box follows the trips (how many wait, how many lack a purpose or partner). */
function refreshStatus() {
  if (activeClose(state.month)) return;
  document.getElementById('status')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: openBlock() }).firstElementChild);
}

function bindTrips() {
  document.querySelectorAll('[data-cat]').forEach((b) =>
    b.addEventListener('click', async () => {
      const trip = state.trips.find((t) => t.id === b.dataset.id);
      const category = b.dataset.cat;
      if (!trip || trip.category === category) return;
      // Private: only km and times may stay on the server.
      const patch =
        category === 'personal'
          ? {
              category,
              start_lat: null, start_lng: null, end_lat: null, end_lng: null,
              start_address: null, end_address: null, route_polyline: null, purpose: null, partner_name: null,
              details: trip.details ? Object.fromEntries(Object.entries(trip.details).filter(([k]) => !PRIVATE_DETAIL_KEYS.includes(k))) : null,
            }
          : { category };
      b.closest('.seg').querySelectorAll('button').forEach((x) => (x.disabled = true));
      const ok = await save(trip, patch);
      if (!ok) return b.closest('.seg').querySelectorAll('button').forEach((x) => (x.disabled = false));
      // Redraw this trip and the totals; the filter may hide it now.
      const card = document.getElementById('t-' + trip.id);
      card.outerHTML = tripCard(trip);
      document.querySelector('.stats').outerHTML = statsBlock();
      refreshStatus();
      bindTrips();
      flash(trip.id, category === 'personal' ? 'Mentve. A címe a telefonodon marad.' : 'Mentve');
      if (category === 'business' && missing(trip)) document.querySelector(`#t-${CSS.escape(trip.id)} input[data-field="purpose"]`)?.focus();
    }),
  );
  document.querySelectorAll('input[data-field]').forEach((input) => {
    const commit = async () => {
      const trip = state.trips.find((t) => t.id === input.dataset.id);
      const value = input.value.trim();
      if (!trip || (trip[input.dataset.field] ?? '') === value) return;
      flash(trip.id, 'Mentés…');
      if (await save(trip, { [input.dataset.field]: value || null })) {
        flash(trip.id, 'Mentve');
        input.closest('.trip').classList.toggle('missing', missing(trip));
        refreshStatus();
      }
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  });
}

/* ---------- Login ---------- */

function loginView() {
  document.body.classList.add('landing');
  who.innerHTML = '';
  show(`<section class="hero">
      <div>
        <p class="eyebrow">Trippo a számítógépen</p>
        <h1>Az utaid nagy képernyőn is</h1>
        <p class="lead">Lépj be ugyanazzal az e-mail-címmel, mint az appban. Itt is besorolhatod az utakat, beírhatod a célt és a partnert, és letöltheted a lezárt hónapokat Excelben.</p>
        <a class="button" href="#demo">Minta megtekintése</a>
      </div>
      <div class="card login">
        <h2>Belépés</h2><p class="muted">Nincs jelszó: kódot küldünk e-mailben.</p>
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
        <p class="muted small">A belépéssel hozzájárulsz, hogy a böngésződ a kilépésig megőrizze a belépésedet. <a href="adatvedelem.html#sutik">Részletek</a></p>
      </div>
    </section>
    <section class="block">
      <h2>Mit tudsz itt csinálni?</h2>
      <div class="features">
        <div><h3>Besorolás</h3><p>Üzleti, magán vagy munkába járás: egy kattintás, és a telefonodon is átvált.</p></div>
        <div><h3>Cél és partner</h3><p>Billentyűzettel gyorsabb: írd be, hova mentél és kihez, a lezárás előtt.</p></div>
        <div><h3>Lezárt hónapok</h3><p>Havi és éves Excel, a kifizetendő összeg és az ellenőrző kód.</p></div>
        <div><h3>A lezárás az appban</h3><p>A hónapot az app zárja le, és küldi a könyvelődnek a PDF-et.</p></div>
      </div>
    </section>`);
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
    // No new accounts from the web: the app sets up the car first.
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    button.disabled = false;
    if (error) {
      const unknown = /signup|not allowed|not found/i.test(error.message || '');
      return fail(unknown ? 'Ezzel a címmel még nincs Trippo-fiók. Töltsd le az appot, és először ott lépj be.' : 'Nem sikerült elküldeni a kódot. Próbáld újra pár perc múlva.');
    }
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

/* ---------- Router ---------- */

async function route() {
  state.demo = location.hash === '#demo';
  state.api = state.demo ? demo : real;
  if (!state.demo) {
    const { data } = await sb.auth.getSession();
    if (!data.session) return loginView();
    whoBar(data.session.user.email);
  } else whoBar();
  document.body.classList.remove('landing');
  show('<p class="muted">Betöltés…</p>');
  await load();
  dashboard();
}

window.addEventListener('hashchange', route);
route();
