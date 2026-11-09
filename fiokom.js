/*
 * Útjaim: a driver's own trips on the web. Same login as the app (e-mail code); reads and writes
 * the driver's rows directly, protected by row level security.
 *   - sort trips one by one or many at once, fill in purpose and partner (with suggestions)
 *   - fix a trip: the address text, the km, purpose and partner
 *   - add a trip the phone missed (a manual trip, as in the app)
 *   - an open month's money with the server's own calculation (site/month-snapshot.js), and a draft Excel
 * Closing a month, deleting trips and anything on the map stay in the app.
 *   (empty)  login, or the trips
 *   #demo    the same screen with made-up data, no login
 * Everything from the server goes through esc(): purposes, partners and addresses are typed by people.
 */
import { setupLogin } from './otp.js';
import { MAX_AVG_KMH, buildSnapshot, fuelNormDl, jumps, logConflicts, overlaps, reportedKm, straightLineM, tooFast, tooShort } from './month-snapshot.js';
import { XLSX_MIME, isShareLog, monthWorkbook, payableOf, yearWorkbook } from './workbook.js';

const BASE = 'https://rudnmzhfgnynlmjdrwoy.supabase.co';
const ANON = 'sb_publishable_Tyxe0cP-kh_mCvH5oCEcsw_qDRYTL8X';
const sb = window.supabase.createClient(BASE, ANON, { auth: { detectSessionInUrl: false, persistSession: true, storageKey: 'trippo-driver-auth' } });

const app = document.getElementById('app');
const who = document.getElementById('who');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const grouped = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const huf = (n) => (n == null ? '–' : grouped(n) + ' Ft');
const km = (n) => grouped(n ?? 0) + ' km';
const kmOf = (m) => reportedKm(m ?? 0);
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
const TRIP_COLUMNS = 'id, client_id, vehicle_id, started_at, ended_at, start_address, end_address, start_lat, start_lng, end_lat, end_lng, distance_m, distance_source, gps_distance_m, category, purpose, partner_name, locked, details, updated_at';
/** What turning a trip private wipes on the server (see categoryPatch): kept in the browser for the undo. */
const UNDO_COLUMNS = ['category', 'start_lat', 'start_lng', 'end_lat', 'end_lng', 'start_address', 'end_address', 'route_polyline', 'purpose', 'partner_name', 'details'];
/** Fuel → the NAV price list it uses (as in the close-month function). */
const FAMILY = { petrol: 'petrol', hybrid_petrol: 'petrol', plugin_petrol: 'petrol', electric: 'petrol', diesel: 'diesel', hybrid_diesel: 'diesel', plugin_diesel: 'diesel', lpg: 'lpg' };
const MAX_KM = 3000;
/** Less than this shows as 0 km in the log. */
const MIN_KM = 0.5;
const KM_RANGE = 'Írj be 0,5 és 3 000 km közötti értéket, pl. 12,5.';
/** An arrival "before" the departure is the next morning, for a drive of up to this long (the app warns above it too). */
const MAX_TRIP_MS = 14 * 3_600_000;

/* ---------- Months ---------- */

const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const ymd = (d) => `${ym(d)}-${String(d.getDate()).padStart(2, '0')}`;
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
/** "12,5" or "12.5" → 12.5; anything else → NaN. */
const parseKm = (s) => (/^\s*\d+([.,]\d+)?\s*$/.test(s) ? Number(s.replace(',', '.')) : NaN);
const duration = (ms) => {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} perc` : `${Math.floor(min / 60)} óra${min % 60 ? ` ${min % 60} perc` : ''}`;
};
/** Why these km in this time can't be right; null when they can. Same limit as the app and the close. */
function speedProblem(row) {
  if (!tooFast(row)) return null;
  const ms = Date.parse(row.ended_at) - Date.parse(row.started_at);
  const kmh = Math.round(row.distance_m / 1000 / (ms / 3_600_000));
  return `${comma(Math.round(row.distance_m / 100) / 10)} km ${duration(ms)} alatt ${grouped(kmh)} km/h átlag lenne, a határ ${MAX_AVG_KMH} km/h. Ellenőrizd a km-t és az időpontokat.`;
}

/* ---------- Data: the real account, or the demo ---------- */

const carFilter = (q, vehicle, vehicles) =>
  // Trips from before the garage have no car: they belong to the default one.
  vehicles.length > 1 ? (vehicle.is_default ? q.or(`vehicle_id.eq.${vehicle.id},vehicle_id.is.null`) : q.eq('vehicle_id', vehicle.id)) : q;

const real = {
  async userId() {
    const { data } = await sb.auth.getSession();
    return data.session?.user.id;
  },
  async vehicles() {
    const { data, error } = await sb.from('vehicles').select('id, plate, make_model, usage, fuel, engine_ccm, is_default').is('archived_at', null).order('created_at');
    if (error) throw error;
    return data;
  },
  async trips(vehicle, vehicles, month) {
    const q = sb
      .from('trips')
      .select(TRIP_COLUMNS)
      .gte('started_at', monthStart(month).toISOString())
      .lt('started_at', monthStart(shift(month, 1)).toISOString())
      .order('started_at');
    const { data, error } = await carFilter(q, vehicle, vehicles);
    if (error) throw error;
    return data;
  },
  /** The newest trip of this car, for an empty month to point at. */
  async latest(vehicle, vehicles) {
    const q = sb.from('trips').select('started_at').order('started_at', { ascending: false }).limit(1);
    const { data, error } = await carFilter(q, vehicle, vehicles);
    if (error) throw error;
    return data[0]?.started_at ?? null;
  },
  /** Earlier business trips, for "same as last time" and the purpose and partner suggestions. */
  async history() {
    const { data, error } = await sb
      .from('trips')
      .select('id, start_address, end_address, purpose, partner_name')
      .eq('category', 'business')
      .not('purpose', 'is', null)
      .order('started_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    return data;
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
  /** NAV price, norm and km rate for the month, the way the close-month function finds them; null if missing. */
  async rates(month, vehicle) {
    const family = FAMILY[vehicle.fuel];
    if (!family) return null;
    const first = `${month}-01`;
    const [{ data: price }, { data: norms }, { data: rate }] = await Promise.all([
      sb.from('nav_fuel_prices').select('price_huf_per_l, protected_price_huf_per_l').eq('month', first).eq('fuel', family).maybeSingle(),
      sb.from('consumption_norms').select('ccm_min, ccm_max, l_per_100km, valid_from, valid_to').eq('fuel_family', family === 'lpg' ? 'petrol' : family),
      sb.from('nav_rates').select('value').eq('key', 'general_car_norm_huf_per_km').lte('valid_from', first).order('valid_from', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const ccm = vehicle.engine_ccm;
    const norm = ccm ? (norms ?? []).find((n) => ccm >= n.ccm_min && (n.ccm_max === null || ccm <= n.ccm_max) && n.valid_from <= first && (n.valid_to === null || n.valid_to > first)) : undefined;
    const normDl = fuelNormDl(vehicle.fuel, norm ? Math.round(Number(norm.l_per_100km) * 10) : null);
    if (!price || normDl === null || !rate) return null;
    const protectedPrice = price.protected_price_huf_per_l;
    return { pricePerLitre: Number(protectedPrice ?? price.price_huf_per_l), protectedPrice: protectedPrice !== null, normDl, huf_per_km: Number(rate.value) };
  },
  async update(trip, patch) {
    let q = sb.from('trips').update(patch).eq('id', trip.id);
    // Changed since this page read it (the phone synced in between): don't overwrite that unseen.
    if (trip.updated_at) q = q.eq('updated_at', trip.updated_at);
    const { data, error } = await q.select(TRIP_COLUMNS);
    if (error) throw error;
    if (!data.length) {
      const { data: now } = await sb.from('trips').select(TRIP_COLUMNS).eq('id', trip.id).maybeSingle();
      throw Object.assign(new Error('changed'), { serverCopy: now ?? null });
    }
    webEdits.saved(data[0], patch);
    return data[0];
  },
  async insert(row) {
    const { data, error } = await sb.from('trips').insert(row).select(TRIP_COLUMNS).single();
    if (error) throw error;
    return data;
  },
  /** This car's trips that touch [from, to]: a new trip must not overlap them. */
  async around(vehicle, vehicles, from, to) {
    const q = sb.from('trips').select('id, started_at, ended_at, start_address, end_address, distance_m, category').lt('started_at', to.toISOString()).gt('ended_at', from.toISOString()).limit(20);
    const { data, error } = await carFilter(q, vehicle, vehicles);
    if (error) throw error;
    return data;
  },
  /** Everything turning private takes off the server, so an undo can put it back. */
  async beforePrivate(trips) {
    const { data, error } = await sb.from('trips').select(`id, ${UNDO_COLUMNS.join(', ')}`).in('id', trips.map((t) => t.id));
    if (error) throw error;
    return data;
  },
};

/**
 * A phone with its own unsynced change to a trip wins over this page (last write wins). So every
 * save here is noted in this browser, and when the trip later comes back different, its card says
 * why. Only a convenience: without storage nothing breaks.
 */
const webEdits = (() => {
  const KEY = 'trippo-web-edits';
  const KEEP_MS = 14 * 86_400_000;
  const FIELDS = ['category', 'start_address', 'end_address', 'distance_m', 'purpose', 'partner_name'];
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || '{}');
    } catch {
      return {};
    }
  };
  const write = (all) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {}
  };
  return {
    saved(row, patch) {
      if (!row?.updated_at) return;
      const all = read();
      const fields = Object.fromEntries(FIELDS.filter((k) => k in patch).map((k) => [k, row[k] ?? null]));
      all[row.id] = { at: row.updated_at, on: Date.now(), fields: { ...(all[row.id]?.fields ?? {}), ...fields } };
      write(all);
    },
    /** Trips saved here that have changed since, and differ from what was saved. */
    overwritten(trips) {
      const all = read();
      const found = new Set();
      for (const t of trips) {
        const mine = all[t.id];
        if (!mine || !t.updated_at || t.updated_at <= mine.at) continue;
        if (Object.entries(mine.fields).some(([k, v]) => (t[k] ?? null) !== v)) found.add(t.id);
        delete all[t.id];
      }
      for (const [id, e] of Object.entries(all)) if (Date.now() - e.on > KEEP_MS) delete all[id];
      write(all);
      return found;
    },
  };
})();

const demo = (() => {
  const now = new Date();
  // Three days of an open month, all of them past: early in a month, those are last month's.
  const early = now.getDate() <= 3;
  const month = early ? shift(ym(now), -1) : ym(now);
  const prev = shift(month, -1);
  const [day1, day2, day3] = early ? [26, 27, 28] : [now.getDate() - 3, now.getDate() - 2, now.getDate() - 1];
  const at = (m, day, h, min) => new Date(`${m}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`).toISOString();
  const trip = (id, m, day, h, min, dur, from, to, kmv, category, purpose, partner, locked = false) => ({
    id, client_id: id, vehicle_id: 'demo-car', started_at: at(m, day, h, min), ended_at: new Date(new Date(at(m, day, h, min)).getTime() + dur * 60000).toISOString(),
    start_address: category === 'personal' ? null : from, end_address: category === 'personal' ? null : to,
    start_lat: category === 'personal' ? null : 47.5, end_lat: category === 'personal' ? null : 47.5,
    distance_m: kmv * 1000, distance_source: null, gps_distance_m: null, category, purpose, partner_name: partner, locked, details: null,
  });
  const trips = [
    trip('d1', prev, 6, 7, 40, 35, 'Budaörs, Szabadság út 1.', 'Budapest, Váci út 30.', 18, 'commute', null, null, true),
    trip('d2', prev, 6, 13, 0, 70, 'Budapest, Váci út 30.', 'Kecskemét, Kossuth tér 1.', 86, 'business', 'Ügyféltárgyalás', 'Alföld Kft.', true),
    trip('d3', prev, 6, 16, 30, 75, 'Kecskemét, Kossuth tér 1.', 'Budaörs, Szabadság út 1.', 92, 'business', 'Visszaút ügyféltől', 'Alföld Kft.', true),
    trip('d4', prev, 9, 10, 0, 25, null, null, 3, 'personal', null, null, true),
    trip('d5', month, day1, 7, 45, 35, 'Budaörs, Szabadság út 1.', 'Budapest, Váci út 30.', 18, 'commute', null, null),
    trip('d6', month, day1, 13, 40, 85, 'Budapest, Váci út 30.', 'Győr, Baross Gábor út 12.', 121, 'business', 'Szállítói egyeztetés', '', false),
    trip('d7', month, day1, 17, 0, 80, 'Győr, Baross Gábor út 12.', 'Budaörs, Szabadság út 1.', 113, 'unreviewed', null, null),
    trip('d8', month, day2, 10, 0, 20, 'Budaörs, Szabadság út 1.', 'Budaörs, Templom tér 3.', 4, 'unreviewed', null, null),
    trip('d9', month, day2, 18, 30, 15, null, null, 6, 'personal', null, null),
    trip('d10', month, day3, 9, 10, 70, 'Budaörs, Szabadság út 1.', 'Kecskemét, Kossuth tér 1.', 88, 'business', null, null),
  ];
  const byTime = (list) => list.map((t) => ({ ...t })).sort((a, b) => a.started_at.localeCompare(b.started_at));
  const car = { id: 'demo-car', plate: 'MNT-001', make_model: 'Minta autó', usage: 'own', fuel: 'petrol', engine_ccm: 1498, is_default: true };
  /** The real NAV price of the month (public data), else the newest one; offline, a fixed one. */
  async function rates(m) {
    let price = { price_huf_per_l: 605, protected_price_huf_per_l: null };
    try {
      const { data } = await sb.from('nav_fuel_prices').select('price_huf_per_l, protected_price_huf_per_l').eq('fuel', 'petrol').lte('month', `${m}-01`).order('month', { ascending: false }).limit(1).maybeSingle();
      if (data) price = data;
    } catch {}
    return { pricePerLitre: Number(price.protected_price_huf_per_l ?? price.price_huf_per_l), protectedPrice: price.protected_price_huf_per_l !== null, normDl: 86, huf_per_km: 15 };
  }
  // The closed month is built like the server builds one, so its numbers match its trips.
  let closes;
  const buildCloses = async () => {
    const logged = trips.filter((t) => ym(new Date(t.started_at)) === prev);
    const odometer = { start: 84000, end: 84000 + logged.reduce((s, t) => s + reportedKm(t.distance_m), 0), yearStart: 72350, yearEnd: null };
    const snapshot = buildSnapshot({ month: prev, vehicle: { fuel: car.fuel, engine_ccm: car.engine_ccm, usage: car.usage }, trips: logged, rates: await rates(prev), people: { driverName: 'Minta Márton', employerName: 'Minta Kft.' }, odometer, perDiem: null });
    return [{ id: 'dc', month: prev + '-01', closed_at: new Date(monthStart(month).getTime() + 8 * 3600e3).toISOString(), reopened_at: null, start_odometer: odometer.start, end_odometer: odometer.end, snapshot, snapshot_hash: 'demo0000000000000000000000000000000000000000000000000000000000ab', vehicles: { plate: car.plate, make_model: car.make_model } }];
  };
  return {
    month,
    async userId() {
      return 'demo-user';
    },
    async vehicles() {
      return [car];
    },
    async trips(_v, _vs, m) {
      return byTime(trips.filter((t) => ym(new Date(t.started_at)) === m));
    },
    async history() {
      return byTime(trips.filter((t) => t.category === 'business' && t.purpose)).reverse();
    },
    async closes() {
      closes ??= buildCloses();
      return closes;
    },
    async latest() {
      return byTime(trips).at(-1).started_at;
    },
    rates,
    async update(t, patch) {
      const row = trips.find((x) => x.id === t.id);
      Object.assign(row, patch);
      return { ...row };
    },
    async insert(row) {
      const made = { ...row, id: row.client_id, locked: false, details: null, start_lat: null, end_lat: null, gps_distance_m: null };
      trips.push(made);
      return { ...made };
    },
    async around(_v, _vs, from, to) {
      return trips.filter((t) => Date.parse(t.started_at) < to.getTime() && Date.parse(t.ended_at) > from.getTime()).map((t) => ({ ...t }));
    },
    async beforePrivate(list) {
      return trips.filter((t) => list.some((x) => x.id === t.id)).map((t) => ({ id: t.id, ...Object.fromEntries(UNDO_COLUMNS.filter((k) => k in t).map((k) => [k, t[k]])) }));
    },
  };
})();

/* ---------- State ---------- */

const state = {
  api: real, demo: false, vehicles: [], vehicle: null, month: ym(new Date()), trips: [], closes: [], latest: null,
  history: [], rates: null, filter: 'all', selected: new Set(), error: null,
  /** Trips this browser edited that the phone has since overwritten with its own change. */
  overwritten: new Set(),
};

const activeClose = (month) => state.closes.find((c) => c.month.slice(0, 7) === month && !c.reopened_at);
const reopened = (month) => !activeClose(month) && state.closes.some((c) => c.month.slice(0, 7) === month && c.reopened_at);
const noPlace = (t) => !t.start_address && !t.end_address;
/** A private trip's addresses never reach the server, so only the phone can turn it into anything else. */
const phoneOnly = (t) => t.category === 'personal' && noPlace(t);
const noAddress = (t) => t.category === 'business' && noPlace(t);
const lacksPurpose = (t) => t.category === 'business' && !(t.purpose?.trim() && t.partner_name?.trim());
/**
 * The app's NAV checks on this month. Overlap, speed and km below the straight line keep the app
 * from closing it; a jump (starts far from where the last trip ended) is only a warning.
 */
const conflicts = () => {
  const { overlap, speed } = logConflicts(state.trips);
  return { overlap: new Set(overlap), speed: new Set(speed), short: new Set(state.trips.filter(tooShort).map((t) => t.id)), jump: new Set(jumps(state.trips)) };
};
function conflictNote(t, found = conflicts()) {
  if (found.overlap.has(t.id)) return { error: true, text: 'Időben átfed egy másik úttal. Az appban javíthatod az időpontot, vagy törölheted, ha dupla.' };
  if (found.speed.has(t.id)) return { error: true, text: `Az átlagsebesség ${MAX_AVG_KMH} km/h fölött van: ellenőrizd a km-t.` };
  if (found.short.has(t.id)) return { error: true, text: 'Kevesebb km, mint a légvonal a két vége között: ellenőrizd a km-t.' };
  if (found.jump.has(t.id)) return { error: false, text: 'Nem ott indul, ahol az előző út véget ért: nem hiányzik előtte egy út?' };
  return null;
}
const missing = (t, found) => lacksPurpose(t) || noAddress(t) || !!conflictNote(t, found)?.error;
const tripById = (id) => state.trips.find((t) => t.id === id);

async function load() {
  state.error = null;
  try {
    state.vehicles = await state.api.vehicles();
    if (!state.vehicles.length) return;
    const keep = state.vehicles.find((v) => v.id === state.vehicle?.id);
    state.vehicle = keep ?? state.vehicles.find((v) => v.is_default) ?? state.vehicles[0];
    [state.trips, state.closes] = await Promise.all([state.api.trips(state.vehicle, state.vehicles, state.month), state.api.closes(state.vehicle)]);
    state.latest = state.trips.length ? null : await state.api.latest(state.vehicle, state.vehicles);
    if (!state.demo) state.overwritten = webEdits.overwritten(state.trips);
    // Nice to have: without them the page still works.
    [state.history, state.rates] = await Promise.all([
      state.history.length ? state.history : state.api.history().catch(() => []),
      activeClose(state.month) ? null : state.api.rates(state.month, state.vehicle).catch(() => null),
    ]);
  } catch {
    state.error = 'Nem sikerült betölteni az utakat. Ellenőrizd az internetkapcsolatot, és frissítsd az oldalt.';
  }
}

/* ---------- Suggestions ---------- */

/** Most used first. */
function frequent(field) {
  const counts = new Map();
  for (const t of state.history) {
    const v = t[field]?.trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([v]) => v);
}

/** The latest earlier business trip to the same place: its purpose and partner. */
function lastTime(t) {
  const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const done = (h) => h.id !== t.id && h.purpose?.trim() && h.partner_name?.trim();
  return (
    state.history.find((h) => done(h) && same(h.start_address, t.start_address) && same(h.end_address, t.end_address)) ??
    state.history.find((h) => done(h) && same(h.end_address, t.end_address)) ??
    null
  );
}

function remember(t) {
  if (t.category !== 'business' || !t.purpose?.trim()) return;
  state.history = [{ id: t.id, start_address: t.start_address, end_address: t.end_address, purpose: t.purpose, partner_name: t.partner_name }, ...state.history.filter((h) => h.id !== t.id)];
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

/* ---------- The open month's money ---------- */

/** The close-month function's own numbers for the trips as they are now; null rates → can't say yet. */
function estimate() {
  const v = state.vehicle;
  const usage = v.usage ?? 'own';
  // Own and borrowed cars get the fuel by the norm; only an own car gets the 15 Ft/km.
  const paid = usage === 'own' || usage === 'borrowed';
  if (paid && !state.rates) return null;
  const rates = paid ? (usage === 'borrowed' ? { ...state.rates, huf_per_km: 0 } : state.rates) : null;
  return buildSnapshot({
    month: state.month,
    vehicle: { fuel: v.fuel, engine_ccm: v.engine_ccm, usage },
    trips: state.trips,
    rates,
    people: { driverName: '', employerName: '' },
    odometer: { start: null, end: null, yearStart: null, yearEnd: null },
    perDiem: null,
  });
}

function estimateBlock() {
  if (!state.trips.length) return '';
  const s = estimate();
  if (!s)
    return `<div class="card estimate" id="estimate"><div class="estimate-head"><b>Becsült elszámolás</b></div>
      <p class="muted small">Ehhez a hónaphoz még nincs NAV-üzemanyagár, vagy az autónál hiányzik az üzemanyag vagy a hengerűrtartalom. Ha megvan, itt látod az összeget.</p></div>`;
  const waiting = state.trips.filter((t) => t.category === 'unreviewed').length;
  const rows = isShareLog(s)
    ? [['Üzleti km', km(s.business_km)], ['Összes km', km(s.business_km + s.personal_km + s.commute_km)]]
    : [
        [`Üzemanyag (${km(s.business_km)} × ${esc(comma(s.norm_l_per_100km))} l/100 km × ${esc(s.price_label)})`, huf(s.fuel_cost_huf)],
        ...(s.usage === 'borrowed' ? [] : [[`Normaköltség (${km(s.business_km)} × ${esc(s.general_norm_huf_per_km)} Ft)`, huf(s.amortization_huf)]]),
        ...(s.expenses.length ? [[`Számla alapján (${esc(s.expenses.length)} tétel)`, huf(s.expenses_huf)]] : []),
      ];
  const big = isShareLog(s) ? `${esc(comma(s.business_share_pct))} %` : `≈ ${huf(payableOf(s))}`;
  return `<div class="card estimate" id="estimate">
    <div class="estimate-head"><b>${isShareLog(s) ? 'Üzleti arány eddig' : 'Becsült elszámolás'}</b><span class="pill">Nincs lezárva</span></div>
    <p class="estimate-big">${big}</p>
    <table class="calc"><tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td class="num">${value}</td></tr>`).join('')}</tbody></table>
    <p class="muted small">Becslés a mostani utakból${waiting ? `, a döntésre váró ${waiting} út nélkül` : ''}. A napidíj és a végleges összeg a lezáráskor dől el az appban.</p>
    <div class="actions"><button id="draft-xlsx">Piszkozat Excelben</button></div>
  </div>`;
}

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
  const gaps = state.trips.filter(lacksPurpose).length;
  const blank = state.trips.filter(noAddress).length;
  const found = conflicts();
  const todo = [
    waiting ? `${waiting} út vár döntésre` : '',
    gaps ? `${gaps} üzleti útnál hiányzik a cél vagy a partner` : '',
    blank ? `${blank} üzleti útnál hiányzik a cím` : '',
    found.speed.size ? `${found.speed.size} útnál ${MAX_AVG_KMH} km/h fölötti az átlagsebesség` : '',
    found.short.size ? `${found.short.size} útnál kevesebb a km, mint a légvonal` : '',
  ].filter(Boolean);
  // The times can only be changed in the app.
  const inApp = [
    found.overlap.size ? `${found.overlap.size} út időben átfed egy másikkal: az időpontot az appban javíthatod. Amíg így van, a hónap nem zárható le.` : '',
    found.jump.size ? `${found.jump.size} út nem ott indul, ahol az előző véget ért: nézd meg, nem hiányzik-e egy út.` : '',
  ].filter(Boolean).join(' ');
  const ready = closable(state.month);
  const head = reopened(state.month) ? 'Javításra újranyitva' : ready && !inApp ? 'Lezárható az appban' : 'Folyamatban';
  const text = todo.length || inApp
    ? [todo.length ? todo.join(', ') + '. Itt is rendezheted őket.' : '', inApp].filter(Boolean).join(' ')
    : ready ? 'Minden út a helyén: a lezárást a Riport fülön indíthatod az appban.' : 'A hónap utolsó napjától zárható le az appban.';
  return `<div class="notice ${todo.length || inApp ? 'warn' : ''}" id="status">
    <p><b>${esc(head)}.</b> ${esc(text)}</p>
  </div>`;
}

/** What a screen reader says for a row's checkbox: which trip it picks. */
const pickLabel = (t) => {
  const when = new Date(t.started_at).toLocaleDateString('hu-HU', { month: 'short', day: 'numeric' });
  const where = noPlace(t) ? LABEL[t.category] : `${t.start_address || '–'} → ${t.end_address || '–'}`;
  return `Kijelölés: ${when} ${time(t.started_at)}, ${where}`;
};

function tripCard(t, found = conflicts()) {
  const priv = t.category === 'personal';
  const problem = t.locked ? null : conflictNote(t, found);
  const blank = noPlace(t);
  const route = blank ? (priv ? 'Magánút' : 'Nincs cím: a ✎ gombbal adhatod meg') : `${esc(t.start_address || '–')} → ${esc(t.end_address || '–')}`;
  const open = !t.locked;
  // The label is the 44 px target around the small box.
  const pick = open ? `<label class="pick-hit"><input type="checkbox" class="pick" data-pick="${esc(t.id)}" aria-label="${esc(pickLabel(t))}"${state.selected.has(t.id) ? ' checked' : ''}></label>` : '<span class="pick-space"></span>';
  const segment = t.locked
    ? `<span class="pill">${esc(LABEL[t.category])}</span>`
    : `<div class="seg" role="group" aria-label="Kategória">${CATEGORIES.map(
        ([value, label]) => `<button data-cat="${value}" data-id="${esc(t.id)}" aria-pressed="${t.category === value}"${phoneOnly(t) && value !== 'personal' ? ' disabled' : ''}>${label}</button>`,
      ).join('')}</div>`;
  let fields = '';
  if (t.category === 'business') {
    if (t.locked) fields = `<p class="purpose">${esc(t.purpose || '–')}${t.partner_name ? ' · ' + esc(t.partner_name) : ''}</p>`;
    else {
      const last = lacksPurpose(t) ? lastTime(t) : null;
      fields = `<div class="fields">
          <label><span>Cél</span><input data-field="purpose" data-id="${esc(t.id)}" value="${esc(t.purpose || '')}" maxlength="200" placeholder="pl. ügyféltárgyalás" list="dl-purpose"></label>
          <label><span>Partner</span><input data-field="partner_name" data-id="${esc(t.id)}" value="${esc(t.partner_name || '')}" maxlength="200" placeholder="pl. Alföld Kft." list="dl-partner"></label>
        </div>${last ? `<button class="suggest" data-suggest="${esc(t.id)}" data-from="${esc(last.id)}">↺ Mint legutóbb: ${esc(last.purpose)} · ${esc(last.partner_name)}</button>` : ''}`;
    }
  }
  const manual = t.distance_source === 'manual' ? ' <span class="muted small" title="Kézzel javított km">kézi</span>' : '';
  return `<article class="trip${t.category === 'unreviewed' ? ' waiting' : ''}${missing(t, found) && open ? ' missing' : ''}${state.selected.has(t.id) ? ' picked' : ''}" id="t-${esc(t.id)}">
    <div class="c-pick">${pick}</div>
    <div class="c-main">
      <span class="when">${esc(time(t.started_at))}–${esc(time(t.ended_at))}</span><span class="route${blank ? ' muted' : ''}">${route}</span>
      ${problem ? `<p class="small conflict">${esc(problem.text)}</p>` : ''}
      ${state.overwritten.has(t.id) ? '<p class="small conflict">Közben a telefonon is módosítottad ezt az utat, és az a változat maradt meg.</p>' : ''}
      ${phoneOnly(t) && open ? '<p class="muted small phone-only">A magánút címe csak a telefonodon van, ezért üzletivé az appban teheted.</p>' : ''}
      ${open ? '<span class="saved muted small" aria-live="polite"></span>' : ''}
    </div>
    <div class="c-km"><b class="trip-km">${km(kmOf(t.distance_m))}</b>${manual}</div>
    <div class="c-cat">${segment}</div>
    <div class="c-fields">${fields}</div>
    <div class="c-edit">${open ? `<button class="icon" data-edit="${esc(t.id)}" aria-label="Szerkesztés" title="Szerkesztés">✎</button>` : '<span class="muted small">Lezárt</span>'}</div>
  </article>`;
}

function visibleTrips(found = conflicts()) {
  return state.trips.filter((t) =>
    state.filter === 'waiting' ? t.category === 'unreviewed' : state.filter === 'business' ? t.category === 'business' : state.filter === 'missing' ? missing(t, found) || t.category === 'unreviewed' : true,
  );
}

function tripList() {
  const found = conflicts();
  const shown = visibleTrips(found);
  if (!state.trips.length) {
    const last = state.latest && new Date(state.latest);
    const jump = last && ym(last) !== state.month ? `<p><button class="primary" id="to-latest" data-month="${ym(last)}">Ugrás: ${esc(monthName(ym(last)))}</button></p>` : '';
    return `<div class="card empty"><p class="muted">Ebben a hónapban ennél az autónál nincs út.${
      last ? ` A legutóbbi út: ${esc(last.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' }))}` : ' Még egy út sincs feltöltve: az app a következő szinkronnál küldi fel őket.'
    }</p>${jump}<p class="muted small">Itt azok az utak látszanak, amelyeket a telefonod már feltöltött. Ha hiányzik egy, nyisd meg az appot internetkapcsolattal, vagy add hozzá itt.</p></div>`;
  }
  if (!shown.length) return '<div class="card empty"><p class="muted">Nincs ilyen út ebben a hónapban.</p></div>';
  const days = [];
  for (const t of shown) {
    const day = dayName(t.started_at);
    if (days[days.length - 1]?.day !== day) days.push({ day, trips: [] });
    days[days.length - 1].trips.push(t);
  }
  const pickable = shown.filter((t) => !t.locked);
  const all = pickable.length && pickable.every((t) => state.selected.has(t.id));
  const head = `<div class="trip-head">
      <div class="c-pick">${pickable.length ? `<label class="pick-hit"><input type="checkbox" class="pick" id="pick-all" aria-label="Mind kijelölése"${all ? ' checked' : ''}></label>` : ''}</div>
      <div class="c-main">${pickable.length ? '<label class="only-phone" for="pick-all">Mind kijelölése</label>' : ''}<span class="only-wide">Út</span></div>
      <div class="c-km only-wide">Km</div><div class="c-cat only-wide">Kategória</div><div class="c-fields only-wide">Cél · Partner</div><div class="c-edit"></div>
    </div>`;
  return `<div class="trips">${head}${days.map((d) => `<section class="day"><h3>${esc(d.day)}</h3>${d.trips.map((t) => tripCard(t, found)).join('')}</section>`).join('')}</div>`;
}

function bulkBar() {
  // One row on a phone: ✕, the count, then the actions (the long labels shorten there).
  return `<div class="bulk" id="bulk" hidden>
    <div class="bulk-in">
      <button class="icon bulk-close" data-bulk="clear" aria-label="Kijelölés megszüntetése" title="Mégse">✕</button>
      <span class="bulk-count"><b id="bulk-n">0</b><span class="bulk-word"> kijelölve</span></span>
      <div class="bulk-actions">
        ${CATEGORIES.map(([value, label]) => `<button data-bulk="${value}">${label}</button>`).join('')}
        <button data-bulk="purpose" aria-label="Cél és partner"><span class="long">Cél és partner…</span><span class="short" aria-hidden="true">Cél…</span></button>
      </div>
    </div>
  </div>`;
}

function dashboard() {
  if (state.error) return show(`<div class="card empty"><p>${esc(state.error)}</p></div>`);
  if (!state.vehicles.length)
    return show(`<div class="card empty"><h2>Még nincs autó a fiókodban</h2><p class="muted">Add hozzá az autódat a Trippo appban, és az utaid itt is megjelennek.</p></div>`);
  const close = activeClose(state.month);
  const year = state.month.slice(0, 4);
  const yearCloses = state.closes.filter((c) => !c.reopened_at && c.month.startsWith(year));
  const filters = [['all', 'Mind'], ['waiting', 'Döntésre vár'], ['business', 'Üzleti'], ['missing', 'Hiányos']];
  const options = (list) => list.map((v) => `<option value="${esc(v)}"></option>`).join('');
  show(`
    ${state.demo ? '<div class="notice"><p><b>Ez egy minta.</b> Kipróbálhatsz mindent, de semmi nem mentődik.</p></div>' : ''}
    <div class="head">
      <div><h1>Útjaim</h1>${state.vehicles.length > 1 ? '' : `<span class="muted">${esc(state.vehicle.plate)}${state.vehicle.make_model ? ' · ' + esc(state.vehicle.make_model) : ''}</span>`}</div>
      <div class="pickers">
        ${state.vehicles.length > 1 ? `<select id="car" aria-label="Autó">${state.vehicles.map((v) => `<option value="${esc(v.id)}"${v.id === state.vehicle.id ? ' selected' : ''}>${esc(v.plate)}${v.make_model ? ' · ' + esc(v.make_model) : ''}</option>`).join('')}</select>` : ''}
        <div class="month-nav"><button id="prev" aria-label="Előző hónap">‹</button><b>${esc(monthName(state.month))}</b><button id="next" aria-label="Következő hónap"${state.month >= ym(new Date()) ? ' disabled' : ''}>›</button></div>
      </div>
    </div>
    ${statsBlock()}
    ${close ? closedBlock(close) : `<div class="side">${openBlock()}${estimateBlock()}</div>`}
    <div class="tools">
      <div class="filter">${filters.map(([v, l]) => `<button data-filter="${v}" aria-pressed="${state.filter === v}">${l}</button>`).join('')}</div>
      ${close ? '' : '<button class="primary" id="add-trip">+ Út hozzáadása</button>'}
    </div>
    <div id="trips">${tripList()}</div>
    ${yearCloses.length ? `<div class="card year"><div><b>${esc(year)}</b><span class="muted"> · ${yearCloses.length} lezárt hónap</span></div><button id="year-xlsx">Éves összesítő (Excel)</button></div>` : ''}
    <datalist id="dl-purpose">${options(frequent('purpose'))}</datalist>
    <datalist id="dl-partner">${options(frequent('partner_name'))}</datalist>
    ${bulkBar()}
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  `);
  bindDashboard(close, yearCloses, year);
}

/** Totals, the status line and the estimate follow every change. */
function refreshSide() {
  document.querySelector('.stats').outerHTML = statsBlock();
  if (activeClose(state.month)) return;
  const side = document.querySelector('.side');
  if (side) side.innerHTML = openBlock() + estimateBlock();
  on('#draft-xlsx', 'click', draftExcel);
}

function renderTrips() {
  document.getElementById('trips').innerHTML = tripList();
  updateBulk();
}

function draftExcel() {
  const s = estimate();
  if (!s) return;
  download(`${fileBase()}-${state.month}-piszkozat`, monthWorkbook({ draft: true, month: `${state.month}-01`, closed_at: null, start_odometer: null, end_odometer: null, snapshot: s, snapshot_hash: null, vehicles: { plate: state.vehicle.plate, make_model: state.vehicle.make_model } }));
}

let toastTimer;
/** A short note at the bottom; with `undo`, a button that takes the change back while it shows. */
function toast(text, bad = false, undo = null) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', bad);
  if (undo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Visszavonás';
    button.addEventListener('click', () => {
      el.hidden = true;
      undo();
    });
    el.append(button);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), undo ? 12000 : 6000);
}

function bindDashboard(close, yearCloses, year) {
  const go = async (month) => {
    state.month = month;
    state.selected.clear();
    app.classList.add('loading');
    await load();
    app.classList.remove('loading');
    dashboard();
  };
  on('#prev', 'click', () => go(shift(state.month, -1)));
  on('#next', 'click', () => go(shift(state.month, 1)));
  on('#car', 'change', async (e) => {
    state.vehicle = state.vehicles.find((v) => v.id === e.target.value);
    await go(state.month);
  });
  on('#month-xlsx', 'click', () => download(`${fileBase()}-${state.month}`, monthWorkbook(close)));
  on('#draft-xlsx', 'click', draftExcel);
  on('#print', 'click', () => window.print());
  on('#year-xlsx', 'click', () => download(`${fileBase()}-${year}`, yearWorkbook(yearCloses, year)));
  on('#add-trip', 'click', () => addDialog(go));
  document.querySelectorAll('[data-filter]').forEach((b) =>
    b.addEventListener('click', () => {
      state.filter = b.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderTrips();
    }),
  );

  const list = document.getElementById('trips');
  list.addEventListener('click', (e) => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.id === 'to-latest') go(el.dataset.month);
    else if (el.dataset.cat) setCategory(tripById(el.dataset.id), el.dataset.cat, el);
    else if (el.dataset.edit) editDialog(tripById(el.dataset.edit));
    else if (el.dataset.suggest) useLastTime(tripById(el.dataset.suggest), state.history.find((h) => h.id === el.dataset.from));
  });
  list.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'pick-all') {
      for (const t of visibleTrips()) if (!t.locked) el.checked ? state.selected.add(t.id) : state.selected.delete(t.id);
      renderTrips();
    } else if (el.dataset.pick) {
      el.checked ? state.selected.add(el.dataset.pick) : state.selected.delete(el.dataset.pick);
      el.closest('.trip').classList.toggle('picked', el.checked);
      updateBulk();
    } else if (el.dataset.field) saveField(el);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.dataset?.field) e.target.blur();
  });
  document.getElementById('bulk').addEventListener('click', (e) => {
    const action = e.target.closest('button')?.dataset.bulk;
    if (!action) return;
    if (action === 'clear') {
      state.selected.clear();
      renderTrips();
    } else if (action === 'purpose') bulkPurposeDialog();
    else bulkCategory(action);
  });
  updateBulk();
}

function updateBulk() {
  const bar = document.getElementById('bulk');
  if (!bar) return;
  // Only what is still on screen counts: a filter may have hidden some.
  for (const id of state.selected) if (!tripById(id) || tripById(id).locked) state.selected.delete(id);
  bar.hidden = state.selected.size === 0;
  document.getElementById('bulk-n').textContent = String(state.selected.size);
  document.body.classList.toggle('has-bulk', state.selected.size > 0);
}

/* ---------- Saving ---------- */

function flash(id, text, bad = false) {
  const el = document.querySelector(`#t-${CSS.escape(id)} .saved`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('error', bad);
}

const saveError = (e) => (String(e?.message || '').includes('closed month') ? 'Ez a hónap le van zárva, az appban nyithatod újra.' : 'Nem sikerült menteni. Próbáld újra.');

const CHANGED = 'Közben a telefonodról módosult ez az út. Frissítettük: nézd át, és ha kell, mentsd újra.';
const GONE = 'Ezt az utat közben törölted a telefonon.';

/** The phone saved this trip after the page read it: show the server's copy instead of overwriting it. */
function serverWon(trip, row, quiet = false) {
  if (row) {
    Object.assign(trip, row);
    if (quiet) return;
    redrawTrip(trip);
    flash(trip.id, CHANGED, true);
  } else {
    state.trips = state.trips.filter((t) => t.id !== trip.id);
    if (quiet) return;
    renderTrips();
    toast(GONE, true);
  }
  refreshSide();
}

async function save(trip, patch, quiet = false) {
  try {
    const row = await state.api.update(trip, patch);
    Object.assign(trip, row);
    remember(trip);
    return true;
  } catch (e) {
    if (e?.message === 'changed') serverWon(trip, e.serverCopy, quiet);
    else if (!quiet) flash(trip.id, saveError(e), true);
    return false;
  }
}

/** The patch that turns a trip into `category`. Private: only km and times may stay on the server. */
function categoryPatch(trip, category) {
  if (category !== 'personal') return { category };
  return {
    category,
    start_lat: null, start_lng: null, end_lat: null, end_lng: null,
    start_address: null, end_address: null, route_polyline: null, purpose: null, partner_name: null,
    details: trip.details ? Object.fromEntries(Object.entries(trip.details).filter(([k]) => !PRIVATE_DETAIL_KEYS.includes(k))) : null,
  };
}

function redrawTrip(trip) {
  const card = document.getElementById('t-' + trip.id);
  if (card) card.outerHTML = tripCard(trip);
}

/**
 * What a category change can be undone to. Private wipes the address, purpose and partner from the
 * server at once (the privacy policy), and afterwards only the phone can file the trip as anything
 * else, so all of that is kept in this tab for a while. Null when it couldn't be read: then nothing
 * changes.
 */
async function keepForUndo(trips, category) {
  if (category !== 'personal') return trips.map((t) => ({ id: t.id, category: t.category }));
  try {
    return await state.api.beforePrivate(trips);
  } catch {
    return null;
  }
}

async function undoCategory(before) {
  app.classList.add('loading');
  const done = await each(before, ({ id, ...row }) => save(tripById(id) ?? { id }, row, true));
  app.classList.remove('loading');
  renderTrips();
  refreshSide();
  toast(done === before.length ? 'Visszavonva.' : `${done} út visszaállítva, ${before.length - done} nem sikerült. Az appban ezeket is visszaállíthatod.`, done < before.length);
}

async function setCategory(trip, category, button) {
  if (!trip || trip.category === category) return;
  // Here it would become a business trip without addresses, and older apps would wipe their copy too.
  if (phoneOnly(trip)) return;
  const buttons = button.closest('.seg').querySelectorAll('button');
  buttons.forEach((x) => (x.disabled = true));
  const was = trip.category;
  const before = await keepForUndo([trip], category);
  const ok = !!before?.length && (await save(trip, categoryPatch(trip, category)));
  if (!ok) {
    if (!before?.length) flash(trip.id, saveError(), true);
    return buttons.forEach((x) => (x.disabled = false));
  }
  redrawTrip(trip);
  refreshSide();
  flash(trip.id, 'Mentve');
  // A waiting trip has no button to go back to, and Magán can't be undone here later.
  if (category === 'personal') toast('Magánút lett: a címe, célja és partnere lekerült a felhőből, a telefonodon megmarad.', false, () => undoCategory(before));
  else if (was === 'unreviewed') toast(`${LABEL[category]} lett.`, false, () => undoCategory(before));
  if (category === 'business' && missing(trip)) document.querySelector(`#t-${CSS.escape(trip.id)} input[data-field="purpose"]`)?.focus();
}

async function saveField(input) {
  const trip = tripById(input.dataset.id);
  const value = input.value.trim();
  if (!trip || (trip[input.dataset.field] ?? '') === value) return;
  flash(trip.id, 'Mentés…');
  if (await save(trip, { [input.dataset.field]: value || null })) {
    flash(trip.id, 'Mentve');
    const card = input.closest('.trip');
    card.classList.toggle('missing', missing(trip));
    if (!lacksPurpose(trip)) card.querySelector('.suggest')?.remove();
    refreshSide();
  }
}

async function useLastTime(trip, last) {
  if (!trip || !last) return;
  if (await save(trip, { purpose: last.purpose, partner_name: last.partner_name })) {
    redrawTrip(trip);
    refreshSide();
    flash(trip.id, 'Mentve');
  }
}

/** A few at a time: quick, without flooding the server. */
async function each(trips, work) {
  let done = 0;
  for (let i = 0; i < trips.length; i += 6) done += (await Promise.all(trips.slice(i, i + 6).map(work))).filter(Boolean).length;
  return done;
}

async function bulkCategory(category) {
  const picked = state.trips.filter((t) => state.selected.has(t.id) && !t.locked);
  const stuck = category === 'personal' ? [] : picked.filter(phoneOnly);
  const todo = picked.filter((t) => t.category !== category && !stuck.includes(t));
  app.classList.add('loading');
  const before = todo.length ? await keepForUndo(todo, category) : null;
  if (todo.length && !before) {
    app.classList.remove('loading');
    return toast('Nem sikerült menteni. Próbáld újra.', true);
  }
  const saved = [];
  const done = await each(todo, async (t) => (await save(t, categoryPatch(t, category), true)) && saved.push(t.id));
  app.classList.remove('loading');
  state.selected.clear();
  renderTrips();
  refreshSide();
  const notes = [`${done} út: ${LABEL[category]}.`];
  if (done < todo.length) notes.push(`${todo.length - done} utat nem sikerült menteni, próbáld újra.`);
  if (stuck.length) notes.push(`${stuck.length} magánutat kihagytunk: azokat az appban teheted üzletivé, mert a címük csak ott van.`);
  const undo = before?.filter((row) => saved.includes(row.id));
  toast(notes.join(' '), done < todo.length, undo?.length ? () => undoCategory(undo) : null);
}

/* ---------- Dialogs ---------- */

/** A modal with a form; `onSubmit(form)` returns an error text or null to close. */
function dialog(title, body, submitLabel, onSubmit) {
  const d = document.createElement('dialog');
  d.className = 'sheet-dialog';
  d.innerHTML = `<form method="dialog" class="dialog-form" novalidate>
      <div class="dialog-head"><h2>${esc(title)}</h2><button type="button" class="icon" data-close aria-label="Bezárás">✕</button></div>
      <div class="dialog-body">${body}</div>
      <p class="error hidden" data-error></p>
      <div class="dialog-actions"><button type="button" data-close>Mégse</button><button class="primary" type="submit">${esc(submitLabel)}</button></div>
    </form>`;
  document.body.append(d);
  const form = d.querySelector('form');
  const error = d.querySelector('[data-error]');
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
  d.addEventListener('close', () => d.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    // The last attempt's error goes while this one runs.
    error.textContent = '';
    error.classList.add('hidden');
    const problem = await onSubmit(form);
    submit.disabled = false;
    if (problem) {
      error.textContent = problem;
      error.classList.remove('hidden');
    } else d.close();
  });
  d.showModal();
  d.querySelector('input:not([disabled]), select')?.focus();
  return d;
}

const field = (name, label, value = '', attrs = '') =>
  `<label class="dl-field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;

function editDialog(trip) {
  if (!trip || trip.locked) return;
  const priv = trip.category === 'personal';
  const business = trip.category === 'business';
  const body = `
    <p class="muted small">${esc(dayName(trip.started_at))}, ${esc(time(trip.started_at))}–${esc(time(trip.ended_at))} · ${esc(LABEL[trip.category])}</p>
    ${
      priv
        ? '<p class="muted small">A magánút címe csak a telefonodon van, itt csak a km-t javíthatod.</p>'
        : `${field('from', 'Honnan', trip.start_address ?? '', 'maxlength="200" autocomplete="off" placeholder="pl. Szada, Dózsa György út 5."')}
           ${field('to', 'Hova', trip.end_address ?? '', 'maxlength="200" autocomplete="off" placeholder="pl. Budapest, Váci út 30."')}`
    }
    ${field('km', 'Km', comma(Math.round(trip.distance_m / 100) / 10), 'inputmode="decimal" autocomplete="off" required')}
    ${business ? `<div class="dl-row">${field('purpose', 'Cél', trip.purpose ?? '', 'maxlength="200" list="dl-purpose"')}${field('partner', 'Partner', trip.partner_name ?? '', 'maxlength="200" list="dl-partner"')}</div>` : ''}
    <p class="muted small">A GPS-útvonal és a térkép az appban marad: itt a címek szövegét és a km-t javítod. A változás a telefonodon is megjelenik.</p>`;
  dialog('Út javítása', body, 'Mentés', async (form) => {
    const v = (name) => form.elements[name]?.value.trim() ?? '';
    const kmValue = parseKm(v('km'));
    const meters = Math.round(kmValue * 1000);
    const kmChanged = Math.abs(meters - trip.distance_m) >= 50;
    // A short GPS trip keeps its km; only a new value must show in the log.
    if (!(kmValue >= 0 && kmValue <= MAX_KM) || (kmChanged && kmValue < MIN_KM)) return KM_RANGE;
    const patch = {};
    if (!priv) {
      if (v('from') !== (trip.start_address ?? '')) patch.start_address = v('from') || null;
      if (v('to') !== (trip.end_address ?? '')) patch.end_address = v('to') || null;
      if (trip.category !== 'unreviewed' && !(v('from') && v('to'))) return 'Add meg, honnan és hova mentél: a NAV mindkettőt kéri.';
    }
    if (kmChanged) {
      // The times stay; only a new km can make the trip impossible.
      const tooQuick = speedProblem({ ...trip, distance_m: meters });
      if (tooQuick) return tooQuick;
      if (tooShort({ ...trip, distance_m: meters })) {
        const direct = straightLineM({ lat: trip.start_lat, lng: trip.start_lng }, { lat: trip.end_lat, lng: trip.end_lng });
        return `Az út két vége között légvonalban ${comma(Math.round(direct / 100) / 10)} km van, ennél kevesebb nem lehet. Ellenőrizd a km-t.`;
      }
      Object.assign(patch, { distance_m: meters, distance_source: 'manual', gps_distance_m: trip.gps_distance_m ?? trip.distance_m });
    }
    if (business) {
      if (v('purpose') !== (trip.purpose ?? '')) patch.purpose = v('purpose') || null;
      if (v('partner') !== (trip.partner_name ?? '')) patch.partner_name = v('partner') || null;
    }
    if (!Object.keys(patch).length) return null;
    try {
      Object.assign(trip, await state.api.update(trip, patch));
      remember(trip);
    } catch (e) {
      if (e?.message !== 'changed') return saveError(e);
      serverWon(trip, e.serverCopy, true);
      redrawTrip(trip);
      refreshSide();
      return e.serverCopy ? CHANGED : GONE;
    }
    redrawTrip(trip);
    refreshSide();
    flash(trip.id, 'Mentve');
    return null;
  });
}

function bulkPurposeDialog() {
  const picked = state.trips.filter((t) => state.selected.has(t.id) && !t.locked);
  const business = picked.filter((t) => t.category === 'business');
  if (!business.length) return toast('Cél és partner csak üzleti útnál van. Előbb állítsd őket Üzletire.', true);
  const body = `<p class="muted small">${business.length} üzleti út${picked.length > business.length ? ` (a többi ${picked.length - business.length} kijelölt nem üzleti, azokat kihagyjuk)` : ''}. Az üresen hagyott mező nem változik.</p>
    <div class="dl-row">${field('purpose', 'Cél', '', 'maxlength="200" list="dl-purpose"')}${field('partner', 'Partner', '', 'maxlength="200" list="dl-partner"')}</div>`;
  dialog('Cél és partner', body, 'Beírás mindegyikbe', async (form) => {
    const purpose = form.elements.purpose.value.trim();
    const partner = form.elements.partner.value.trim();
    if (!purpose && !partner) return 'Írj be legalább egyet.';
    const patch = { ...(purpose ? { purpose } : {}), ...(partner ? { partner_name: partner } : {}) };
    const done = await each(business, (t) => save(t, patch, true));
    state.selected.clear();
    renderTrips();
    refreshSide();
    toast(done === business.length ? `${done} út kitöltve.` : `${done} út kitöltve, ${business.length - done} nem sikerült.`, done < business.length);
    return null;
  });
}

function addDialog(go) {
  const now = new Date();
  const day = state.month === ym(now) ? ymd(now) : `${state.month}-01`;
  // Last year stays open for a late December or a retroactive log; anything older is a typo.
  const firstDay = `${now.getFullYear() - 1}-01-01`;
  const radios =CATEGORIES.map(([value, label]) => `<label class="seg-radio"><input type="radio" name="category" value="${value}"${value === 'business' ? ' checked' : ''}><span>${label}</span></label>`).join('');
  const body = `
    <div class="dl-row three">
      ${field('day', 'Nap', day, `type="date" min="${firstDay}" max="${ymd(now)}" required`)}
      ${field('start', 'Indulás', '', 'type="time" required')}
      ${field('end', 'Érkezés', '', 'type="time" required')}
    </div>
    <p class="muted small" data-next-day aria-live="polite" hidden></p>
    <div class="seg seg-wide" role="radiogroup" aria-label="Kategória">${radios}</div>
    <div data-place>
      ${field('from', 'Honnan', '', 'maxlength="200" autocomplete="off" placeholder="pl. Szada, Dózsa György út 5."')}
      ${field('to', 'Hova', '', 'maxlength="200" autocomplete="off" placeholder="pl. Budapest, Váci út 30."')}
    </div>
    ${field('km', 'Km', '', 'inputmode="decimal" autocomplete="off" required placeholder="pl. 32"')}
    <div class="dl-row" data-business>${field('purpose', 'Cél', '', 'maxlength="200" list="dl-purpose"')}${field('partner', 'Partner', '', 'maxlength="200" list="dl-partner"')}</div>
    <p class="muted small">Olyan útra, amit a telefon nem rögzített. Kézi útként kerül be, a telefonodon is megjelenik, és ott törölheted, ha kell.</p>`;
  const d = dialog('Út hozzáadása', body, 'Hozzáadás', async (form) => {
    const v = (name) => form.elements[name].value.trim();
    const category = form.elements.category.value;
    const { startedAt, endedAt, wrapped } = timesOf(form);
    const kmValue = parseKm(v('km'));
    if (!v('day') || !v('start') || !v('end') || isNaN(startedAt) || isNaN(endedAt)) return 'Add meg a napot, az indulást és az érkezést.';
    if (v('day') < firstDay) return `Utat ${now.getFullYear() - 1}. január 1-jétől vehetsz fel.`;
    if (endedAt <= startedAt) return 'Az érkezés legyen később, mint az indulás.';
    if (wrapped && endedAt - startedAt > MAX_TRIP_MS) return 'Az érkezés korábbi, mint az indulás. Ha éjfél után érkeztél, az út legfeljebb 14 óra lehet.';
    if (endedAt > new Date()) return 'Jövőbeli utat nem lehet felvenni.';
    const month = ym(startedAt);
    if (activeClose(month)) return `${monthName(month)} le van zárva. Az appban nyithatod újra, ha javítani kell.`;
    if (!(kmValue >= MIN_KM && kmValue <= MAX_KM)) return KM_RANGE;
    const priv = category === 'personal';
    if (!priv && !(v('from') && v('to'))) return 'Add meg, honnan és hova mentél: a NAV mindkettőt kéri.';
    const times = { id: 'new', started_at: startedAt.toISOString(), ended_at: endedAt.toISOString(), distance_m: Math.round(kmValue * 1000) };
    const tooQuick = speedProblem(times);
    if (tooQuick) return tooQuick;
    // Nobody drives two trips at once: the app wouldn't close the month.
    let clash;
    try {
      clash = (await state.api.around(state.vehicle, state.vehicles, startedAt, endedAt)).find((t) => overlaps(times, t));
    } catch {
      return 'Nem sikerült menteni. Próbáld újra.';
    }
    if (clash) {
      const where = noPlace(clash) ? (clash.category === 'personal' ? 'magánút' : 'cím nélkül') : `${clash.start_address || '–'} → ${clash.end_address || '–'}`;
      return `Ebben az időben már van egy út (${dayName(clash.started_at)}, ${time(clash.started_at)}–${time(clash.ended_at)}, ${where}). Két út nem lehet egyszerre: ellenőrizd az időpontokat.`;
    }
    const business = category === 'business';
    const row = {
      owner_id: await state.api.userId(),
      // Same kind of id as the app's own manual trips, so the phone treats it as one of them.
      client_id: `manual-web-${crypto.randomUUID()}`,
      vehicle_id: state.vehicle.id,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      start_address: priv ? null : v('from'),
      end_address: priv ? null : v('to'),
      distance_m: Math.round(kmValue * 1000),
      distance_source: 'manual',
      category,
      purpose: business ? v('purpose') || null : null,
      partner_name: business ? v('partner') || null : null,
      source: 'manual',
    };
    try {
      const made = await state.api.insert(row);
      remember(made);
    } catch {
      return 'Nem sikerült menteni. Próbáld újra.';
    }
    await go(month);
    toast('Hozzáadva. A telefonodon a következő szinkronnál jelenik meg.');
    return null;
  });
  // Private trips keep no address on the server, and only business trips have a purpose.
  const sync = () => {
    const category = d.querySelector('input[name="category"]:checked').value;
    d.querySelector('[data-place]').hidden = category === 'personal';
    d.querySelector('[data-business]').hidden = category !== 'business';
  };
  d.querySelectorAll('input[name="category"]').forEach((r) => r.addEventListener('change', sync));
  sync();
  // Past midnight: say which day the arrival falls on.
  const note = d.querySelector('[data-next-day]');
  const nextDay = () => {
    const { startedAt, endedAt, wrapped } = timesOf(d.querySelector('form'));
    note.hidden = !wrapped || isNaN(endedAt) || endedAt - startedAt > MAX_TRIP_MS;
    // The Hungarian date ends in its own full stop ("november 8.").
    note.textContent = note.hidden ? '' : `Érkezés másnap: ${endedAt.toLocaleDateString('hu-HU', { month: 'long', day: 'numeric' })}`;
  };
  ['day', 'start', 'end'].forEach((name) => d.querySelector(`[name="${name}"]`).addEventListener('input', nextDay));
}

/** The add form's times; an arrival before the departure is the next day's. */
function timesOf(form) {
  const v = (name) => form.elements[name].value.trim();
  const startedAt = new Date(`${v('day')}T${v('start')}:00`);
  const endedAt = new Date(`${v('day')}T${v('end')}:00`);
  const wrapped = endedAt < startedAt;
  if (wrapped) endedAt.setDate(endedAt.getDate() + 1);
  return { startedAt, endedAt, wrapped };
}

/* ---------- Login ---------- */

function loginView() {
  document.body.classList.add('landing');
  who.innerHTML = '';
  show(`<section class="hero">
      <div>
        <p class="eyebrow">Trippo a számítógépen</p>
        <h1>Az utaid nagy képernyőn is</h1>
        <p class="lead">Lépj be ugyanazzal az e-mail-címmel, mint az appban. Táblázatban látod az utaidat, egyszerre többet is besorolhatsz, javíthatod a címet és a km-t, és már a lezárás előtt látod, mennyit kapsz vissza.</p>
        <a class="button" href="#demo">Minta megtekintése</a>
      </div>
      <div class="card login">
        <h2>Belépés</h2><p class="muted">Nincs jelszó: kódot küldünk e-mailben.</p>
        <form id="email-form" class="stack">
          <div><label for="email">E-mail-cím</label><input id="email" type="email" autocomplete="email" required></div>
          <button class="primary" type="submit">Belépési kód kérése</button>
        </form>
        <div id="code-step" class="stack code-step hidden"></div>
        <p class="error hidden" id="login-error"></p>
        <p class="muted small">A belépéssel hozzájárulsz, hogy a böngésződ a kilépésig megőrizze a belépésedet. <a href="adatvedelem.html#sutik">Részletek</a></p>
      </div>
    </section>
    <section class="block">
      <h2>Mit tudsz itt csinálni?</h2>
      <div class="features">
        <div><h3>Egyszerre több út</h3><p>Jelöld ki őket, és egy kattintással üzleti, magán vagy munkába járás lesz mind. Cél és partner is mehet egyszerre.</p></div>
        <div><h3>Javítás és pótlás</h3><p>Cím, km, cél, partner. Ami kimaradt, azt kézzel hozzáadhatod. A „Mint legutóbb” gomb kitölti a visszatérő utakat.</p></div>
        <div><h3>Mennyit kapsz vissza</h3><p>A hónap becsült elszámolása már menet közben, NAV-árral és normával, piszkozat Excellel.</p></div>
        <div><h3>A lezárás az appban</h3><p>A hónapot az app zárja le, és küldi a könyvelődnek a PDF-et. A lezárt hónapok Excelje itt is letölthető.</p></div>
      </div>
    </section>`);
  setupLogin({
    // No new accounts from the web: the app sets up the car first.
    send: async (email) => {
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (!error) return null;
      return /signup|not allowed|not found/i.test(error.message || '')
        ? 'Ezzel a címmel még nincs Trippo-fiók. Töltsd le az appot, és először ott lépj be.'
        : 'Nem sikerült elküldeni a kódot. Próbáld újra pár perc múlva.';
    },
    verify: async (email, token) => {
      const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      return error ? 'Hibás vagy lejárt kód. Ellenőrizd, vagy kérj újat.' : null;
    },
    done: route,
  });
}

/* ---------- Router ---------- */

async function route() {
  state.demo = location.hash === '#demo';
  state.api = state.demo ? demo : real;
  state.month = state.demo ? demo.month : ym(new Date());
  state.history = [];
  state.selected.clear();
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
