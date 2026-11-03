'use strict';
/*
 * NAV's monthly fuel prices, read live from the table the app uses (filled daily from nav.gov.hu),
 * so a new month shows up here without a site update. Pages keep their printed numbers as a fallback.
 * window.navPrices resolves to months newest first, { month: '2026-11', petrol, diesel, lpg,
 * petrolProtected?, dieselProtected? }, or to null when the read fails.
 */
window.navPrices = fetch(
  'https://rudnmzhfgnynlmjdrwoy.supabase.co/rest/v1/nav_fuel_prices?select=month,fuel,price_huf_per_l,protected_price_huf_per_l&order=month.desc',
  { headers: { apikey: 'sb_publishable_Tyxe0cP-kh_mCvH5oCEcsw_qDRYTL8X' } },
)
  .then((r) => (r.ok ? r.json() : null))
  .then((rows) => {
    if (!Array.isArray(rows)) return null;
    const byMonth = new Map();
    for (const r of rows) {
      const month = r.month.slice(0, 7);
      const row = byMonth.get(month) || { month };
      row[r.fuel] = Number(r.price_huf_per_l);
      if (r.protected_price_huf_per_l != null) row[r.fuel + 'Protected'] = Number(r.protected_price_huf_per_l);
      byMonth.set(month, row);
    }
    const months = [...byMonth.values()].filter((m) => m.petrol && m.diesel);
    return months.length ? months : null;
  })
  .catch(() => null);

/** The price an allowance uses: the protected one where NAV published it. */
window.navApplied = (m, fuel) => (m[fuel + 'Protected'] != null ? m[fuel + 'Protected'] : m[fuel]);

const NAV_MONTH = {
  name: ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'],
  // "novemberi árral"
  adjective: ['januári', 'februári', 'márciusi', 'áprilisi', 'májusi', 'júniusi', 'júliusi', 'augusztusi', 'szeptemberi', 'októberi', 'novemberi', 'decemberi'],
  // "2026 novemberében"
  inside: ['januárjában', 'februárjában', 'márciusában', 'áprilisában', 'májusában', 'júniusában', 'júliusában', 'augusztusában', 'szeptemberében', 'októberében', 'novemberében', 'decemberében'],
};
window.navMonth = (month, form) => NAV_MONTH[form][Number(month.slice(5)) - 1];
