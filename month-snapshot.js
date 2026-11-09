// Built from supabase/functions/_shared/month-snapshot.ts by scripts/site-snapshot.mjs. Don't edit.
/**
 * Builds a closed month's frozen snapshot on the server, from the trips and the NAV tables, so what
 * the accountant sees can't be made up by a client. Plain TypeScript with no imports: used by the
 * close-month function and by the app's Jest tests, which keep it equal to the app's own report.
 *
 * Trips belong to a month by their Europe/Budapest start time, wherever the phone happens to be.
 */
const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const WEEKDAYS = { Sun: 'Vasárnap', Mon: 'Hétfő', Tue: 'Kedd', Wed: 'Szerda', Thu: 'Csütörtök', Fri: 'Péntek', Sat: 'Szombat' };
const COST_KIND = { parking: 'Parkolás', toll: 'Útdíj', vignette: 'E-matrica', other: 'Egyéb' };
const FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Budapest', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
function local(iso) {
    const parts = Object.fromEntries(FORMAT.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    return { month: `${parts.year}-${parts.month}`, day: `${parts.year}-${parts.month}-${parts.day}`, dayOfMonth: Number(parts.day), monthIndex: Number(parts.month) - 1, time: `${parts.hour}:${parts.minute}`, weekday: parts.weekday };
}
/** Today in Hungary, YYYY-MM-DD. */
export const budapestDay = (now = new Date()) => local(now).day;
/** A month can be closed from its last day on. */
export function monthEnded(month, now = new Date()) {
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return budapestDay(now) >= `${month}-${String(last).padStart(2, '0')}`;
}
export const reportedKm = (distanceM) => Math.floor((Math.round(distanceM) + 500) / 1000);
const dayHeader = (iso) => {
    const d = local(iso);
    return `${WEEKDAYS[d.weekday]}, ${MONTHS[d.monthIndex]} ${d.dayOfMonth}.`;
};
const placeName = (label) => (label.includes(' – ') ? label.split(' – ')[0] : label.split(',')[0]);
const fuelCost = (km, dl, filler) => Math.floor((Math.round(km * dl * 10) * filler + 500000) / 1000000);
/**
 * Szja tv. 3. sz. melléklet II. 4.: 3 l of ESZ 95 per 100 km; a plug-in gets 70% of its engine's norm.
 * 60/1992. Korm. rendelet 4. § (4): LPG gets the petrol norm × 1,2 (`engineNormDl` is that petrol norm).
 */
export function fuelNormDl(fuel, engineNormDl) {
    if (fuel === 'electric')
        return 30;
    if (engineNormDl === null)
        return null;
    if (fuel === 'lpg')
        return Math.round(engineNormDl * 12) / 10;
    return fuel === 'plugin_petrol' || fuel === 'plugin_diesel' ? Math.round(engineNormDl * 7) / 10 : engineNormDl;
}
export const tripsOfMonth = (trips, month) => trips.filter((t) => local(t.started_at).month === month).sort((a, b) => a.started_at.localeCompare(b.started_at));
/** Clocks and GPS starts disagree a little: up to a minute of overlap is no contradiction. */
export const OVERLAP_SLACK_MS = 60000;
/** Faster than this on average, the km or the times are wrong (the motorway limit is 130). */
export const MAX_AVG_KMH = 150;
const span = (t) => ({ from: Date.parse(t.started_at), to: Date.parse(t.ended_at) });
/** A drive takes time; a reconciliation entry (an odometer difference) is a number, not a drive. */
const isDrive = (t) => span(t).to > span(t).from;
/** Earlier start first; on the same start, the longer one first. */
const byStart = (a, b) => span(a).from - span(b).from || span(b).to - span(a).to;
/** Two drives contradict each other when the later one starts before the earlier one ended. */
export function overlaps(a, b) {
    if (!isDrive(a) || !isDrive(b))
        return false;
    const [first, second] = [a, b].sort(byStart);
    return span(second).from < span(first).to - OVERLAP_SLACK_MS;
}
export function tooFast(t) {
    const { from, to } = span(t);
    return to > from && t.distance_m / 1000 / ((to - from) / 3600000) > MAX_AVG_KMH;
}
/** Where the log contradicts itself: a drive that starts inside another one, and a drive too fast to be real. */
export function logConflicts(trips) {
    const drives = trips.filter(isDrive).sort(byStart);
    const overlap = [];
    let latestEnd = -Infinity;
    for (const t of drives) {
        if (span(t).from < latestEnd - OVERLAP_SLACK_MS)
            overlap.push(t.id);
        latestEnd = Math.max(latestEnd, span(t).to);
    }
    return { overlap, speed: drives.filter(tooFast).map((t) => t.id) };
}
/** A trip this far from where the last one ended means a drive is missing. */
export const JUMP_M = 3000;
/** GPS endpoints wander, so a road distance only "beats" the straight line by this much. */
const STRAIGHT_LINE_SLACK = 0.9;
const point = (lat, lng) => (lat != null && lng != null ? { lat, lng } : null);
export function straightLineM(a, b) {
    if (!a || !b)
        return null;
    const rad = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** The km are shorter than the straight line between the two ends: the km are wrong. */
export function tooShort(t) {
    const direct = straightLineM(point(t.start_lat, t.start_lng), point(t.end_lat, t.end_lng));
    return direct !== null && t.distance_m < direct * STRAIGHT_LINE_SLACK;
}
/** Drives that start far from where the one before ended: a trip may be missing in between. */
export function jumps(trips) {
    const drives = trips.filter(isDrive).sort(byStart);
    return drives.slice(1).filter((t, i) => (straightLineM(point(drives[i].end_lat, drives[i].end_lng), point(t.start_lat, t.start_lng)) ?? 0) > JUMP_M).map((t) => t.id);
}
/** Why the month can't be closed yet, or null. */
export function closeBlocker(trips) {
    if (!trips.length)
        return 'no_trips';
    if (trips.some((t) => t.category === 'unreviewed'))
        return 'unreviewed';
    // NAV needs both on a business trip: what for, and whom you visited.
    if (trips.some((t) => t.category === 'business' && (!t.purpose?.trim() || !t.partner_name?.trim())))
        return 'missing_purpose';
    // A log that contradicts itself can't be sealed: an auditor would reject the whole month.
    const conflicts = logConflicts(trips);
    if (conflicts.overlap.length)
        return 'overlap';
    if (conflicts.speed.length)
        return 'too_fast';
    return null;
}
function perDiemDays(business) {
    const byDay = new Map();
    for (const t of business) {
        const day = local(t.started_at).day;
        const cur = byDay.get(day);
        byDay.set(day, { from: Math.min(cur?.from ?? Infinity, Date.parse(t.started_at)), to: Math.max(cur?.to ?? 0, Date.parse(t.ended_at)) });
    }
    return [...byDay.entries()].filter(([, s]) => s.to - s.from >= 6 * 3600000).map(([day]) => day).sort();
}
export function buildSnapshot(input) {
    const { month, vehicle, rates, people, odometer, perDiem } = input;
    const trips = tripsOfMonth(input.trips, month);
    const dl = rates?.normDl ?? 0;
    const filler = rates ? Math.round(rates.pricePerLitre * 100) : 0;
    const perKm = rates?.huf_per_km ?? 0;
    const sumKm = (category) => trips.filter((t) => t.category === category).reduce((s, t) => s + reportedKm(t.distance_m), 0);
    const business = trips.filter((t) => t.category === 'business');
    const businessKm = sumKm('business');
    const personalKm = sumKm('personal');
    const commuteKm = sumKm('commute');
    const all = businessKm + personalKm + commuteKm;
    const lines = business.map((t) => {
        const km = reportedKm(t.distance_m);
        return {
            date: dayHeader(t.started_at),
            time: `${local(t.started_at).time}–${local(t.ended_at).time}`,
            from: t.start_address ?? '',
            to: t.end_address ?? '',
            purpose: t.purpose?.trim() ?? '',
            partner: t.partner_name?.trim() ?? '',
            km,
            fuelHuf: fuelCost(km, dl, filler),
            amortizationHuf: km * perKm,
        };
    });
    const expenses = business.flatMap((t) => (t.details?.costs ?? []).map((c) => ({
        date: dayHeader(t.started_at),
        kind: COST_KIND[c.kind] ?? c.kind,
        trip: `${placeName(t.start_address ?? '')} → ${placeName(t.end_address ?? '')}`,
        note: c.note ?? '',
        amountHuf: c.amountHuf,
    })));
    const days = perDiem?.enabled ? perDiemDays(business) : [];
    const fuel = fuelCost(businessKm, dl, filler);
    const amortization = businessKm * perKm;
    const price = filler / 100;
    return {
        month,
        fuel: vehicle.fuel,
        engine_ccm: vehicle.engine_ccm,
        norm_l_per_100km: Math.round(dl * 10) / 100,
        fuel_price_huf_per_l: price,
        general_norm_huf_per_km: perKm,
        business_km: businessKm,
        personal_km: personalKm,
        commute_km: commuteKm,
        fuel_cost_huf: fuel,
        amortization_huf: amortization,
        total_huf: fuel + amortization,
        business_share_pct: all ? Math.round((businessKm / all) * 1000) / 10 : 0,
        trip_ids: business.map((t) => t.client_id ?? t.id),
        usage: vehicle.usage ?? 'own',
        people,
        odometer,
        lines,
        price_label: `${price.toLocaleString('hu-HU')} Ft/l (NAV${rates?.protectedPrice ? ', védett ár' : ''})`,
        per_diem: perDiem?.enabled ? { days, hufPerDay: perDiem.hufPerDay, totalHuf: days.length * perDiem.hufPerDay } : null,
        expenses,
        expenses_huf: expenses.reduce((s, e) => s + e.amountHuf, 0),
    };
}
