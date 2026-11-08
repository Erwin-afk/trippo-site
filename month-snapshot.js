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
/** Why the month can't be closed yet, or null. */
export function closeBlocker(trips) {
    if (!trips.length)
        return 'no_trips';
    if (trips.some((t) => t.category === 'unreviewed'))
        return 'unreviewed';
    // NAV needs both on a business trip: what for, and whom you visited.
    if (trips.some((t) => t.category === 'business' && (!t.purpose?.trim() || !t.partner_name?.trim())))
        return 'missing_purpose';
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
