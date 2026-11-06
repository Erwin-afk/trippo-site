/*
 * Trippo's Excel files: the one layout accountants get from the app, the portal and the monthly e-mail.
 * No imports, so the same file runs everywhere: site/workbook.js and supabase/functions/_shared/workbook.js
 * are exact copies of this file, and a test fails if they drift.
 *
 * Input is a month_closes row (month, closed_at, start/end_odometer, snapshot, snapshot_hash, vehicles).
 * Strings are written as inline strings: client-typed text like =HYPERLINK(…) can never run as a formula.
 */

const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
const FUEL = { petrol: 'benzin', diesel: 'dízel', hybrid_petrol: 'benzin-hibrid', hybrid_diesel: 'dízel-hibrid', plugin_petrol: 'tölthető benzin-hibrid', plugin_diesel: 'tölthető dízel-hibrid', lpg: 'LPG', electric: 'elektromos' };

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** What the employer pays out: the per-km allowance plus napidíj and the receipts. */
export const payableOf = (s) => (s?.total_huf ?? 0) + (s?.per_diem?.totalHuf ?? 0) + (s?.expenses_huf ?? 0);

/** Company cars and vans: the month proves a business share, nothing is paid per km. */
export const isShareLog = (s) => s?.usage === 'company' || s?.usage === 'van';

/** A car that isn't the driver's own: fuel by the norm only, no 15 Ft/km and no kiküldetési rendelvény. */
const isBorrowed = (s) => s?.usage === 'borrowed';

const USAGE = { own: 'Saját gépkocsi', borrowed: 'Nem saját gépkocsi', company: 'Céges gépkocsi', van: 'Kisteherautó' };
const pct = (n) => `${comma(n ?? 0)} %`;

/* ---------- Styles ---------- */

const INK = 'FF0F1419';
const MUTED = 'FF5B6470';
const GREEN = 'FF0A8F6A';
const DEEP = 'FF0A6B50';

const font = (size, color, bold, name = 'Calibri') => `<font>${bold ? '<b/>' : ''}<sz val="${size}"/><color rgb="${color}"/><name val="${name}"/></font>`;
const FONTS = [font(11, INK), font(11, INK, true), font(20, INK, true), font(10, MUTED), font(11, 'FFFFFFFF', true), font(12, DEEP, true), font(16, DEEP, true), font(9, MUTED, false, 'Consolas')];
const solid = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const FILLS = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>', solid(GREEN), solid('FFE6F4EF')];
const BORDERS = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE7E4DE"/></bottom><diagonal/></border>', `<border><left/><right/><top style="medium"><color rgb="${GREEN}"/></top><bottom/><diagonal/></border>`];
const FORMATS = { km: [164, '#,##0&quot; km&quot;'], ft: [165, '#,##0&quot; Ft&quot;'], date: [166, 'yyyy\\.\\ mm\\.\\ dd\\.'], int: [3, null] };

const STYLES = {
  plain: {},
  title: { font: 2 },
  sub: { font: 3 },
  section: { font: 5, border: 1 },
  label: { border: 1, v: 'top' },
  value: { font: 1, border: 1, h: 'right', v: 'top', wrap: true },
  valueKm: { font: 1, border: 1, fmt: 'km', h: 'right', v: 'top' },
  valueFt: { font: 1, border: 1, fmt: 'ft', h: 'right', v: 'top' },
  head: { font: 4, fill: 2, h: 'left', v: 'center', wrap: true },
  headNum: { font: 4, fill: 2, h: 'right', v: 'center', wrap: true },
  cell: { border: 1, v: 'top', wrap: true },
  cellDate: { border: 1, fmt: 'date', h: 'left', v: 'top' },
  cellInt: { border: 1, fmt: 'int', h: 'right', v: 'top' },
  totalText: { font: 1, fill: 3, border: 2, v: 'center' },
  totalInt: { font: 1, fill: 3, border: 2, fmt: 'int', h: 'right', v: 'center' },
  payText: { font: 6, fill: 3, v: 'center' },
  payFt: { font: 6, fill: 3, fmt: 'ft', h: 'right', v: 'center' },
  note: { font: 3, v: 'top', wrap: true },
  hash: { font: 7, border: 1, h: 'right', v: 'top', wrap: true },
};
const STYLE_IDS = Object.fromEntries(Object.keys(STYLES).map((k, i) => [k, i]));

function stylesXml() {
  const xf = (s) => {
    const fmt = s.fmt ? FORMATS[s.fmt][0] : 0;
    const align = s.h || s.v || s.wrap ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>` : '';
    return `<xf numFmtId="${fmt}" fontId="${s.font ?? 0}" fillId="${s.fill ?? 0}" borderId="${s.border ?? 0}" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${align}</xf>`;
  };
  const custom = Object.values(FORMATS).filter(([, code]) => code);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${custom.length}">${custom.map(([id, code]) => `<numFmt numFmtId="${id}" formatCode="${code}"/>`).join('')}</numFmts><fonts count="${FONTS.length}">${FONTS.join('')}</fonts><fills count="${FILLS.length}">${FILLS.join('')}</fills><borders count="${BORDERS.length}">${BORDERS.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${Object.keys(STYLES).length}">${Object.values(STYLES).map(xf).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

/* ---------- Sheet XML ---------- */

const esc = (v) =>
  String(v)
    // Characters XML forbids: one of them makes Excel refuse the file.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function colName(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function cellXml(cell, ref) {
  if (!cell) return '';
  const [value, style] = cell;
  const s = ` s="${STYLE_IDS[style ?? 'plain']}"`;
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`;
  if (value.formula) return `<c r="${ref}"${s}><f>${esc(value.formula)}</f></c>`;
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/** Excel draws no fill on merged-away cells unless they exist, so `fill` pads a row with that style. */
function sheetXml({ rows, widths, freeze, filter, merges = [], portrait }) {
  const data = rows
    .map((row, r) => {
      const cells = row.cells ?? [];
      const ht = row.height ? ` ht="${row.height}" customHeight="1"` : '';
      const padded = row.fill ? [...cells, ...Array.from({ length: Math.max(0, widths.length - cells.length) }, () => ['', row.fill])] : cells;
      return `<row r="${r + 1}"${ht}>${padded.map((c, i) => cellXml(c, `${colName(i)}${r + 1}`)).join('')}</row>`;
    })
    .join('');
  const view = freeze
    ? `<sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView>`
    : '<sheetView workbookViewId="0" showGridLines="0"/>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>${view}</sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${data}</sheetData>${filter ? `<autoFilter ref="${filter}"/>` : ''}${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${portrait ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

/* ---------- Zip (stored, which Excel accepts; these files are small) ---------- */

function utf8(text) {
  const out = [];
  for (const ch of text) {
    let c = ch.codePointAt(0);
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const le = (values) => {
    const bytes = [];
    for (const [v, size] of values) for (let i = 0; i < size; i++) bytes.push(Math.floor(v / 2 ** (8 * i)) & 255);
    return bytes;
  };
  const chunks = [];
  const central = [];
  let offset = 0;
  // 1 January 2026, fixed: the same month always gives the same bytes.
  const stamp = [[0, 2], [(46 << 9) | (1 << 5) | 1, 2]];
  for (const [name, data] of entries) {
    const path = utf8(name);
    const crc = crc32(data);
    const common = [[20, 2], [0, 2], [0, 2], ...stamp, [crc, 4], [data.length, 4], [data.length, 4], [path.length, 2], [0, 2]];
    const local = Uint8Array.from([...le([[0x04034b50, 4], ...common]), ...path]);
    chunks.push(local, data);
    central.push(Uint8Array.from([...le([[0x02014b50, 4], [20, 2], ...common, [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]]), ...path]));
    offset += local.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const end = Uint8Array.from(le([[0x06054b50, 4], [0, 2], [0, 2], [entries.length, 2], [entries.length, 2], [centralSize, 4], [offset, 4], [0, 2]]));
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let at = 0;
  for (const c of all) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Excel forbids []:*?/\ in sheet names and allows 31 characters. */
const sheetName = (s) => s.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31);

export function buildXlsx(sheets) {
  const xml = (declaration) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${declaration}`;
  const repeats = sheets
    .map((s, i) => (s.repeat ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">'${esc(sheetName(s.name)).replace(/'/g, "''")}'!$${s.repeat}:$${s.repeat}</definedName>` : ''))
    .join('');
  const files = [
    ['[Content_Types].xml', xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)],
    ['_rels/.rels', xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')],
    ['xl/workbook.xml', xml(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(sheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${repeats ? `<definedNames>${repeats}</definedNames>` : ''}</workbook>`)],
    ['xl/_rels/workbook.xml.rels', xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)],
    ['xl/styles.xml', stylesXml()],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zip(files.map(([name, text]) => [name, utf8(text)]));
}

/* ---------- Reading a close ---------- */

const monthLabel = (m) => `${m.slice(0, 4)}. ${MONTHS[Number(m.slice(5, 7)) - 1]}`;
const comma = (n) => String(n ?? '').replace('.', ',');
const serial = (y, m, d) => Date.UTC(y, m - 1, d) / 86_400_000 + 25569;

/** Lines store text like "Hétfő, október 5."; Excel gets a real date, so it sorts and filters. */
function dateCell(text, month) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text ?? '');
  if (iso) return [serial(Number(iso[1]), Number(iso[2]), Number(iso[3])), 'cellDate'];
  const day = /(\d{1,2})\.\s*$/.exec(text ?? '');
  if (day) return [serial(Number(month.slice(0, 4)), Number(month.slice(5, 7)), Number(day[1])), 'cellDate'];
  return [text ?? '', 'cell'];
}

function vehicleText(c) {
  const s = c.snapshot ?? {};
  const fuel = FUEL[s.fuel] ?? s.fuel ?? '';
  const engine = s.engine_ccm ? `${(s.engine_ccm / 1000).toFixed(1).replace('.', ',')} ${fuel} · ${s.engine_ccm} cm³` : fuel;
  const model = c.vehicles?.make_model ?? '';
  return model && engine ? `${model} (${engine})` : model || engine;
}

function closedText(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('hu-HU', { timeZone: 'Europe/Budapest', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

const odometerOf = (c) => {
  const o = c.snapshot?.odometer ?? {};
  return { start: o.start ?? c.start_odometer ?? null, end: o.end ?? c.end_odometer ?? null, yearStart: o.yearStart ?? null, yearEnd: o.yearEnd ?? null };
};

const whoLine = (c) => [monthLabel(c.month), c.snapshot?.people?.driverName, c.vehicles?.plate].filter(Boolean).join(' · ');

/* ---------- Sheets ---------- */

const LOG_HEAD = ['Dátum', 'Indulás', 'Érkezés', 'Honnan', 'Hová', 'Az utazás célja', 'Felkeresett partner'];
const LOG_MONEY = ['Km', 'Üzemanyag (Ft)', 'Normaköltség (Ft)', 'Összesen (Ft)'];
const LOG_WIDTHS = [13, 8, 8, 30, 30, 36, 28, 8, 12, 13, 12];

function logCells(line, month) {
  const [from, to] = String(line.time ?? '').split(/[–-]/);
  const fuel = line.fuelHuf ?? 0;
  const amortization = line.amortizationHuf ?? 0;
  return [dateCell(line.date, month), [from ?? '', 'cell'], [to ?? '', 'cell'], [line.from ?? '', 'cell'], [line.to ?? '', 'cell'], [line.purpose ?? '', 'cell'], [line.partner ?? '', 'cell'], [line.km ?? 0, 'cellInt'], [fuel, 'cellInt'], [amortization, 'cellInt'], [fuel + amortization, 'cellInt']];
}

const headRow = (labels, numeric) => ({ height: 32, cells: labels.map((l, i) => [l, numeric.includes(i) ? 'headNum' : 'head']) });

function shareSheet(c) {
  const s = c.snapshot ?? {};
  const o = odometerOf(c);
  const section = (title) => ({ cells: [[title, 'section'], ['', 'section']], height: 24 });
  const text = (label, value) => ({ cells: [[label, 'label'], [value ?? '–', 'value']] });
  const km = (label, value) => (value === null || value === undefined ? text(label, '–') : { cells: [[label, 'label'], [value, 'valueKm']] });
  const rows = [
    { cells: [[`Útnyilvántartás · ${monthLabel(c.month)}`, 'title']], height: 32 },
    { cells: [[[USAGE[s.usage], s.people?.driverName, c.vehicles?.plate].filter(Boolean).join(' · '), 'sub']] },
    { cells: [] },
    { cells: [['Üzleti arány', 'payText'], [pct(s.business_share_pct), 'payText']], height: 34 },
    { cells: [] },
    section('Kilométerek'),
    km('Üzleti', s.business_km),
    km('Magán', s.personal_km),
    km('Munkába járás', s.commute_km),
    km('Km-óra a hónap elején', o.start),
    km('Km-óra a hónap végén', o.end),
    km('Km-óra az év első napján', o.yearStart),
    { cells: [] },
    section('Adatok'),
    text('Gépkocsivezető', s.people?.driverName),
    text('Vállalkozás / munkáltató', s.people?.employerName),
    text('Rendszám', c.vehicles?.plate),
    text('Gépkocsi', vehicleText(c)),
    text('Lezárva', closedText(c.closed_at)),
    { cells: [['Ellenőrző kód (SHA-256)', 'label'], [c.snapshot_hash ?? '–', 'hash']], height: 42 },
    { cells: [] },
    { cells: [['Az arány az üzleti km és az összes megtett km hányadosa; a munkába járás nem üzleti út.', 'note']], height: 30 },
  ];
  return { name: 'Összesítő', widths: [46, 42], rows, merges: [`A${rows.length}:B${rows.length}`], portrait: true };
}

function summarySheet(c) {
  if (isShareLog(c.snapshot)) return shareSheet(c);
  const s = c.snapshot ?? {};
  const o = odometerOf(c);
  const pay = payableOf(s);
  const borrowed = isBorrowed(s);
  const section = (title) => ({ cells: [[title, 'section'], ['', 'section']], height: 24 });
  const text = (label, value) => ({ cells: [[label, 'label'], [value ?? '–', 'value']] });
  const km = (label, value) => (value === null || value === undefined ? text(label, '–') : { cells: [[label, 'label'], [value, 'valueKm']] });
  const ft = (label, value) => ({ cells: [[label, 'label'], [value ?? 0, 'valueFt']] });
  const rows = [
    { cells: [[`Elszámolás · ${monthLabel(c.month)}`, 'title']], height: 32 },
    { cells: [[[borrowed && USAGE.borrowed, s.people?.driverName, c.vehicles?.plate].filter(Boolean).join(' · '), 'sub']] },
    { cells: [] },
    { cells: [['Kifizetendő összesen', 'payText'], [pay, 'payFt']], height: 34 },
    { cells: [] },
    section('Számítás'),
    text('Fogyasztási norma', s.norm_l_per_100km != null ? `${comma(s.norm_l_per_100km)} l/100 km` : null),
    text('NAV üzemanyagár', s.price_label),
    ft(`Üzemanyagköltség (${s.business_km ?? 0} km)`, s.fuel_cost_huf),
    ...(borrowed ? [] : [ft(`Normaköltség (${s.business_km ?? 0} km × ${s.general_norm_huf_per_km ?? 15} Ft)`, s.amortization_huf)]),
    ft('Költségtérítés', s.total_huf),
    ...(s.per_diem ? [ft(`Napidíj (${s.per_diem.days?.length ?? 0} nap × ${s.per_diem.hufPerDay ?? 0} Ft)`, s.per_diem.totalHuf)] : []),
    ...(s.expenses?.length ? [ft(`Számla alapján (${s.expenses.length} tétel)`, s.expenses_huf)] : []),
    { cells: [] },
    section('Kilométerek'),
    km('Üzleti', s.business_km),
    km('Magán', s.personal_km),
    km('Munkába járás', s.commute_km),
    km('Km-óra a hónap elején', o.start),
    km('Km-óra a hónap végén', o.end),
    km('Km-óra az év első napján', o.yearStart),
    o.yearEnd !== null ? km('Km-óra az év utolsó napján', o.yearEnd) : text('Km-óra az év utolsó napján', 'év végén kerül rögzítésre'),
    { cells: [] },
    section('Adatok'),
    ...(borrowed
      ? [text('Gépkocsivezető', s.people?.driverName), text('Munkáltató', s.people?.employerName)]
      : [
          text('Kiküldött (gépkocsivezető)', s.people?.driverName),
          // Required on the kiküldetési rendelvény; Trippo never stores it, so it's filled in by hand.
          text('Kiküldött adóazonosító jele', ''),
          text('Kiküldő (munkáltató)', s.people?.employerName),
        ]),
    text('Rendszám', c.vehicles?.plate),
    text('Gépkocsi', vehicleText(c)),
    text('Lezárva', closedText(c.closed_at)),
    { cells: [['Ellenőrző kód (SHA-256)', 'label'], [c.snapshot_hash ?? '–', 'hash']], height: 42 },
    { cells: [] },
    { cells: [[borrowed ? 'Nem saját gépkocsi, útnyilvántartás alapján: a norma szerinti üzemanyagköltség számolható el, az általános normaköltség (15 Ft/km) és a kiküldetési rendelvény nem (NAV 8. füzet 3.2.).' : 'A számítás alapja: SZJA tv. és 60/1992. (IV. 1.) Korm. rendelet, a NAV által közzétett havi üzemanyagár.', 'note']], height: borrowed ? 44 : 30 },
  ];
  return { name: 'Összesítő', widths: [46, 42], rows, merges: [`A${rows.length}:B${rows.length}`], portrait: true };
}

function logSheet(c) {
  const s = c.snapshot ?? {};
  const o = odometerOf(c);
  const lines = s.lines ?? [];
  const share = isShareLog(s);
  const facts = [o.start !== null && `Km-óra: ${o.start.toLocaleString('hu-HU')} → ${o.end === null ? '–' : o.end.toLocaleString('hu-HU')} km`, !share && s.norm_l_per_100km != null && `${comma(s.norm_l_per_100km)} l/100 km`, !share && s.price_label, share && `Üzleti arány: ${pct(s.business_share_pct)}`].filter(Boolean).join(' · ');
  const cols = share ? 8 : 11;
  const rows = [
    { cells: [['Útnyilvántartás', 'title']], height: 32 },
    { cells: [[whoLine(c), 'sub']] },
    { cells: [[facts, 'sub']] },
    headRow([...LOG_HEAD, ...LOG_MONEY].slice(0, cols), [7, 8, 9, 10]),
    ...(lines.length ? lines.map((l) => ({ cells: logCells(l, c.month).slice(0, cols) })) : [{ cells: [['Ebben a hónapban nem volt üzleti út.', 'cell']] }]),
    { fill: 'totalText', height: 24, cells: [['Üzleti km összesen', 'totalText'], ...Array(6).fill(['', 'totalText']), [s.business_km ?? 0, 'totalInt'], ...(share ? [] : [[s.fuel_cost_huf ?? 0, 'totalInt'], [s.amortization_huf ?? 0, 'totalInt'], [s.total_huf ?? 0, 'totalInt']])] },
  ];
  const lineFuel = lines.reduce((sum, l) => sum + (l.fuelHuf ?? 0), 0);
  const merges = [];
  if (!share && lineFuel !== (s.fuel_cost_huf ?? 0)) {
    rows.push({ cells: [] }, { height: 18, cells: [[`A soronkénti Ft kerekített. A havi összeg az összes km-ből számolódik, ezért pár forinttal eltérhet a sorok összegétől (${s.business_km} km × ${comma(s.norm_l_per_100km)} l/100 km × ${comma(s.fuel_price_huf_per_l)} Ft/l).`, 'note']] });
    merges.push(`A${rows.length}:K${rows.length}`);
  }
  return { name: 'Útnyilvántartás', widths: LOG_WIDTHS.slice(0, cols), rows, freeze: 4, repeat: 4, merges, filter: lines.length ? `A4:${share ? 'H' : 'K'}${4 + lines.length}` : undefined };
}

/** Receipts and napidíj of one or more closes, or null when there are none. */
function costsSheet(closes, title) {
  const rows = [
    { cells: [['Költségek', 'title']], height: 32 },
    { cells: [[title, 'sub']] },
    { cells: [] },
    headRow(['Dátum', 'Tétel', 'Út', 'Megjegyzés', 'Összeg (Ft)'], [4]),
  ];
  let total = 0;
  for (const c of closes) {
    const s = c.snapshot ?? {};
    for (const e of s.expenses ?? []) {
      total += e.amountHuf ?? 0;
      rows.push({ cells: [dateCell(e.date, c.month), [e.kind ?? '', 'cell'], [e.trip ?? '', 'cell'], [e.note ?? '', 'cell'], [e.amountHuf ?? 0, 'cellInt']] });
    }
    for (const day of s.per_diem?.days ?? []) {
      total += s.per_diem.hufPerDay ?? 0;
      rows.push({ cells: [dateCell(day, c.month), ['Napidíj', 'cell'], ['legalább 6 órás kiküldetés', 'cell'], ['', 'cell'], [s.per_diem.hufPerDay ?? 0, 'cellInt']] });
    }
  }
  if (rows.length === 4) return null;
  rows.push({ height: 24, cells: [['Összesen', 'totalText'], ['', 'totalText'], ['', 'totalText'], ['', 'totalText'], [total, 'totalInt']] });
  rows.push({ cells: [] }, { cells: [['A számlák a rendelvény mellékletei.', 'note']] });
  return { name: 'Költségek', widths: [13, 14, 34, 34, 14], rows, freeze: 4, repeat: 4 };
}

/** Closed months in the app also carry their change log. */
function changesSheet(changes) {
  return {
    name: 'Változásnapló',
    widths: [20, 48, 70],
    rows: [
      { cells: [['Változásnapló', 'title']], height: 32 },
      { cells: [['Minden módosítás a hónap útjain, ahogy az adatbázis rögzítette.', 'sub']] },
      { cells: [] },
      headRow(['Időpont', 'Út', 'Változás'], []),
      ...changes.map((c) => ({ cells: [[c.at, 'cell'], [c.trip, 'cell'], [c.detail, 'cell']] })),
    ],
    freeze: 4,
    repeat: 4,
  };
}

/** One closed month: what to pay, the trip log, the costs. */
export function monthWorkbook(close, changes) {
  const costs = costsSheet([close], whoLine(close));
  return buildXlsx([summarySheet(close), logSheet(close), ...(costs ? [costs] : []), ...(changes ? [changesSheet(changes)] : [])]);
}

/** A year (or any list of months): one row per month and car, then every trip and cost. */
export function yearWorkbook(closes, year) {
  const list = [...closes].sort((a, b) => a.month.localeCompare(b.month));
  const showOpen = list.some((c) => c.closed === false);
  const driver = list.find((c) => c.snapshot?.people?.driverName)?.snapshot.people.driverName;
  const plates = [...new Set(list.map((c) => c.vehicles?.plate).filter(Boolean))].join(', ');
  const who = [driver, plates].filter(Boolean).join(' · ');
  const anyShare = list.some((c) => isShareLog(c.snapshot));
  const labels = ['Hónap', 'Rendszám', 'Üzleti km', 'Magán km', 'Munkába járás km', 'NAV-ár (Ft/l)', 'Üzemanyag (Ft)', 'Normaköltség (Ft)', 'Költségtérítés (Ft)', 'Napidíj (Ft)', 'Számlák (Ft)', 'Kifizetendő (Ft)', ...(anyShare ? ['Üzleti arány'] : []), ...(showOpen ? ['Lezárva'] : [])];
  const sum = (pick) => list.reduce((s, c) => s + (pick(c.snapshot ?? {}) ?? 0), 0);
  const money = [(s) => s.business_km, (s) => s.personal_km, (s) => s.commute_km, null, (s) => s.fuel_cost_huf, (s) => s.amortization_huf, (s) => s.total_huf, (s) => s.per_diem?.totalHuf, (s) => s.expenses_huf, payableOf];
  const body = list.map((c) => {
    const s = c.snapshot;
    const cells = [[monthLabel(c.month), 'cell'], [c.vehicles?.plate ?? '', 'cell']];
    if (!s) return { cells: [...cells, ['nincs NAV-ár', 'cell'], ...Array(labels.length - 3).fill(['', 'cell'])] };
    cells.push(...money.map((pick) => (pick ? [pick(s) ?? 0, 'cellInt'] : [s.fuel_price_huf_per_l ?? '', 'cellInt'])));
    if (anyShare) cells.push([isShareLog(s) ? pct(s.business_share_pct) : '', 'cell']);
    if (showOpen) cells.push([c.closed === false ? 'nem' : 'igen', 'cell']);
    return { cells };
  });
  const rows = [
    { cells: [[`Éves összesítő · ${year}`, 'title']], height: 32 },
    { cells: [[who, 'sub']] },
    { cells: [] },
    headRow(labels, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    ...body,
    { fill: 'totalText', height: 24, cells: [['Összesen', 'totalText'], ['', 'totalText'], ...money.map((pick) => (pick ? [sum(pick), 'totalInt'] : ['', 'totalText']))] },
  ];
  const summary = { name: `${year} összesítő`, widths: [17, 11, 10, 10, 11, 10, 13, 13, 13, 11, 11, 14, ...(anyShare ? [10] : []), ...(showOpen ? [9] : [])], rows, freeze: 4, repeat: 4 };

  const lines = list.flatMap((c) => (c.snapshot?.lines ?? []).map((l) => ({ cells: logCells(l, c.month) })));
  const trips = {
    name: 'Összes út',
    widths: LOG_WIDTHS,
    rows: [
      { cells: [['Összes üzleti út', 'title']], height: 32 },
      { cells: [[[year, who].filter(Boolean).join(' · '), 'sub']] },
      { cells: [] },
      headRow([...LOG_HEAD, ...LOG_MONEY], [7, 8, 9, 10]),
      ...lines,
    ],
    freeze: 4,
    repeat: 4,
    filter: `A4:K${4 + lines.length}`,
  };
  const costs = costsSheet(list, [year, who].filter(Boolean).join(' · '));
  return buildXlsx([summary, ...(lines.length ? [trips] : []), ...(costs ? [costs] : [])]);
}
