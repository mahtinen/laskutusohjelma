"use strict";

/* =====================================================================
 * Pure helpers (no DOM) — kept separate so they can be unit-tested.
 * ===================================================================== */

const VAT_RATES = [25.5, 14, 10, 0];
const UNITS = ["kpl", "h", "pv", "kk", "m", "m2", "kg", "l", "erä"];

function parseDecimal(str) {
  if (typeof str !== "string") return NaN;
  const s = str.trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

const moneyFmt = new Intl.NumberFormat("fi-FI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatMoney(n) { return moneyFmt.format(n); }
function formatMoneyEur(n) { return moneyFmt.format(n) + " €"; }

const qtyFmt = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 3 });

function formatDateFi(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${d}.${m}.${y}`;
}

function addDays(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/* Net (VAT-exclusive) unit price of a row, whichever way the price was entered. */
function netUnitPrice(row) {
  const price = parseDecimal(row.price);
  return row.priceIncVat ? price * 100 / (100 + Number(row.vat)) : price;
}

/* --- Row / totals math (integer cents to avoid float drift) --- */

function calcRow(row) {
  const qty = parseDecimal(row.qty);
  const price = parseDecimal(row.price);
  const vatRate = Number(row.vat);
  if (!Number.isFinite(qty) || !Number.isFinite(price)) {
    return { netCents: 0, vatCents: 0, grossCents: 0, valid: false };
  }
  if (row.priceIncVat) {
    // Price entered VAT-inclusive: keep the gross exact, back-calculate net + VAT.
    const grossCents = Math.round(qty * price * 100);
    const netCents = Math.round(grossCents * 100 / (100 + vatRate));
    return { netCents, vatCents: grossCents - netCents, grossCents, valid: true };
  }
  const netCents = Math.round(qty * price * 100);
  const vatCents = Math.round(netCents * vatRate / 100);
  return { netCents, vatCents, grossCents: netCents + vatCents, valid: true };
}

function calcTotals(rows) {
  let net = 0, vat = 0;
  const byRate = new Map(); // vatRate -> {netCents, vatCents}
  for (const row of rows) {
    const c = calcRow(row);
    if (!c.valid) continue;
    net += c.netCents;
    vat += c.vatCents;
    const rate = Number(row.vat);
    const agg = byRate.get(rate) || { netCents: 0, vatCents: 0 };
    agg.netCents += c.netCents;
    agg.vatCents += c.vatCents;
    byRate.set(rate, agg);
  }
  return { netCents: net, vatCents: vat, grossCents: net + vat, byRate };
}

/* --- Finnish reference number (viitenumero) ---
 * Check digit: weights 7,3,1 repeating from the rightmost base digit. */

function viiteCheckDigit(base) {
  const weights = [7, 3, 1];
  let sum = 0;
  const digits = base.split("").reverse();
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * weights[i % 3];
  }
  return (10 - (sum % 10)) % 10;
}

function makeViite(base) {
  const clean = String(base).replace(/\D/g, "").replace(/^0+/, "");
  if (clean.length < 3 || clean.length > 19) return "";
  return clean + viiteCheckDigit(clean);
}

function isValidViite(ref) {
  const clean = String(ref).replace(/\s/g, "");
  if (!/^\d{4,20}$/.test(clean)) return false;
  return viiteCheckDigit(clean.slice(0, -1)) === Number(clean.slice(-1));
}

/* Display grouping: groups of 5 from the right, per Finnish convention. */
function formatViite(ref) {
  const clean = String(ref).replace(/\s/g, "");
  return clean.replace(/(\d)(?=(\d{5})+$)/g, "$1 ");
}

/* --- IBAN --- */

function normalizeIban(iban) {
  return String(iban).replace(/\s/g, "").toUpperCase();
}

function isValidIban(iban) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  // mod 97 on a big number, chunked to stay within Number precision
  let remainder = 0;
  for (const ch of rearranged) {
    const val = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of val) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function formatIban(iban) {
  return normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

/* BIC suggestion from the Finnish bank code (digits 5.. of the IBAN). */
function bicFromIban(iban) {
  const s = normalizeIban(iban);
  if (!s.startsWith("FI") || s.length !== 18) return "";
  const bank = s.slice(4);
  const rules = [
    ["405", "HELSFIHH"], ["497", "HELSFIHH"],          // Aktia
    ["470", "POPFFI22"], ["471", "POPFFI22"], ["472", "POPFFI22"],
    ["473", "POPFFI22"], ["474", "POPFFI22"], ["475", "POPFFI22"],
    ["476", "POPFFI22"], ["477", "POPFFI22"], ["478", "POPFFI22"], // POP Pankki
    ["479", "POPFFI22"],
    ["713", "CITIFIHX"],
    ["799", "HOLVFIHH"],                                // Holvi
    ["31", "HANDFIHH"],                                 // Handelsbanken
    ["33", "ESSEFIHX"],                                 // SEB
    ["34", "DABAFIHX"],                                 // Danske (34x)
    ["36", "SBANFIHH"], ["39", "SBANFIHH"],             // S-Pankki
    ["37", "DNBAFIHX"],
    ["38", "SWEDFIHH"],
    ["1", "NDEAFIHH"], ["2", "NDEAFIHH"],               // Nordea
    ["4", "ITELFIHH"],                                  // Säästöpankki group (fallback for 4xx)
    ["5", "OKOYFIHH"],                                  // OP
    ["6", "AABAFI22"],                                  // Ålandsbanken
    ["8", "DABAFIHH"],                                  // Danske
  ];
  for (const [prefix, bic] of rules) {
    if (bank.startsWith(prefix)) return bic;
  }
  return "";
}

/* --- Finnish bank barcode (pankkiviivakoodi), version 4 ---
 * 54 digits: "4" + FI-IBAN digits(16) + amount euros(6)+cents(2)
 *            + "000" + reference zero-padded(20) + due date YYMMDD.
 * Amount outside 0.01–999999.99 € is encoded as zeros per the spec. */

function bankBarcodeString({ iban, grossCents, reference, dueDateIso }) {
  const ibanNorm = normalizeIban(iban);
  if (!ibanNorm.startsWith("FI") || ibanNorm.length !== 18 || !isValidIban(ibanNorm)) return null;

  const refClean = String(reference).replace(/\s/g, "");
  if (!/^\d{4,20}$/.test(refClean) || !isValidViite(refClean)) return null;

  let amount = "00000000";
  if (grossCents >= 1 && grossCents <= 99999999) {
    amount = String(grossCents).padStart(8, "0");
  }

  let due = "000000";
  if (dueDateIso && /^\d{4}-\d{2}-\d{2}$/.test(dueDateIso)) {
    const [y, m, d] = dueDateIso.split("-");
    due = y.slice(2) + m + d;
  }

  const code = "4" + ibanNorm.slice(2) + amount + "000" + refClean.padStart(20, "0") + due;
  return code.length === 54 ? code : null;
}

/* --- Code 128, subset C ---
 * Standard element-width table for symbol values 0–106. */

const CODE128_WIDTHS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112"
];
const C128_START_C = 105, C128_STOP = 106;

/* digits: even-length numeric string -> array of {width, isBar} elements */
function code128CElements(digits) {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) return null;
  const values = [C128_START_C];
  for (let i = 0; i < digits.length; i += 2) {
    values.push(Number(digits.slice(i, i + 2)));
  }
  let checksum = values[0];
  for (let i = 1; i < values.length; i++) checksum += values[i] * i;
  values.push(checksum % 103);
  values.push(C128_STOP);

  const elements = [];
  for (const v of values) {
    const pattern = CODE128_WIDTHS[v];
    for (let i = 0; i < pattern.length; i++) {
      elements.push({ width: Number(pattern[i]), isBar: i % 2 === 0 });
    }
  }
  return elements;
}

/* Render as SVG. Quiet zones included via viewBox padding. */
function code128Svg(digits, { heightMm = 12, widthMm = 105 } = {}) {
  const elements = code128CElements(digits);
  if (!elements) return "";
  const QUIET = 10; // modules on each side
  const totalModules = elements.reduce((a, e) => a + e.width, 0) + 2 * QUIET;
  let x = QUIET;
  let bars = "";
  for (const e of elements) {
    if (e.isBar) bars += `<rect x="${x}" y="0" width="${e.width}" height="100" fill="#000"/>`;
    x += e.width;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} 100" ` +
    `width="${widthMm}mm" height="${heightMm}mm" preserveAspectRatio="none" ` +
    `shape-rendering="crispEdges" role="img" aria-label="Pankkiviivakoodi">${bars}</svg>`;
}

/* --- Late-payment interest (viivästyskorko, korkolaki 633/1982) ---
 * Viitekorko (12 §) = the ECB main refinancing rate applied in its last operation
 * before the half-year starts (1.1. / 1.7.), rounded UP to the nearest 0.5 %-point.
 * Viivästyskorko = viitekorko + 8 %-points between businesses (4 a §), + 7 otherwise (4 §). */

const LATE_INTEREST_MARGIN_B2B = 8;
const LATE_INTEREST_MARGIN_CONSUMER = 7;

// Built-in fallback: ECB main refinancing rate changes [effective date, rate %].
// Updated automatically from the ECB API at runtime; this list is only used offline.
const ECB_MRO_BUILTIN = {
  asOf: "2026-11-04",
  changes: [
    ["2016-03-16", 0], ["2022-07-27", 0.5], ["2022-09-14", 1.25], ["2022-11-02", 2],
    ["2022-12-21", 2.5], ["2023-02-08", 3], ["2023-03-22", 3.5], ["2023-05-10", 3.75],
    ["2023-06-21", 4], ["2023-08-02", 4.25], ["2023-09-20", 4.5], ["2024-06-12", 4.25],
    ["2024-09-18", 3.65], ["2024-10-23", 3.4], ["2024-12-18", 3.15], ["2025-02-05", 2.9],
    ["2025-03-12", 2.65], ["2025-04-23", 2.4], ["2025-06-11", 2.15], ["2026-06-17", 2.4],
    ["2026-09-16", 2.65],
  ],
};

const ECB_MRO_URL = "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV" +
  "?format=csvdata&detail=dataonly&startPeriod=2016-01-01";

/* Half-year containing isoDate: { start: "YYYY-01-01"|"YYYY-07-01", end: "YYYY-06-30"|"YYYY-12-31" } */
function halfYearOf(isoDate) {
  const [y, m] = isoDate.split("-").map(Number);
  return m <= 6 ? { start: `${y}-01-01`, end: `${y}-06-30` } : { start: `${y}-07-01`, end: `${y}-12-31` };
}

/* Statutory reference rate for the half-year containing isoDate, or null if unknown. */
function viitekorkoFor(isoDate, changes) {
  const { start } = halfYearOf(isoDate);
  let rate = null;
  for (const [date, r] of changes) if (date < start) rate = r; // changes are sorted ascending
  if (rate === null) return null;
  return Math.ceil(rate * 2 - 1e-9) / 2 + 0; // + 0 turns -0 into 0
}

/* Parse the ECB SDMX CSV (TIME_PERIOD, OBS_VALUE columns) into sorted [date, rate] pairs. */
function parseEcbCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift().split(",");
  const iDate = header.indexOf("TIME_PERIOD"), iVal = header.indexOf("OBS_VALUE");
  if (iDate < 0 || iVal < 0) return [];
  const out = [];
  for (const line of lines) {
    const cols = line.split(",");
    const date = cols[iDate], rate = Number(cols[iVal]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && cols[iVal] !== "" && Number.isFinite(rate)) out.push([date, rate]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function formatPercent(n) { return String(n).replace(".", ","); }

/* =====================================================================
 * Application state + DOM wiring
 * ===================================================================== */

const STORAGE_KEY = "laskutusohjelma.v1";

const state = {
  seller: { name: "", businessId: "", address: "", zip: "", city: "", phone: "", email: "", vatId: "", website: "", iban: "", bic: "", logo: "" },
  buyer: { name: "", contact: "", address: "", zip: "", city: "", businessId: "" },
  invoice: { number: "", date: "", termDays: "14", dueDate: "", reference: "", lateInterest: "", notes: "" },
  rows: [],
  customers: [], // saved buyer records, unique by lowercased name
  // true once the user edits these by hand, so auto-fill stops overriding
  manual: { reference: false, dueDate: false, vatId: false, bic: false, lateInterest: false },
};

function todayIso() { return new Date().toISOString().slice(0, 10); }

function newRow() {
  return { desc: "", qty: "1", unit: "kpl", price: "", vat: "25.5", priceIncVat: false };
}

function $(id) { return document.getElementById(id); }

/* ---- Persistence ---- */

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* storage may be unavailable */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    for (const key of ["seller", "buyer", "invoice", "manual"]) {
      if (saved[key]) Object.assign(state[key], saved[key]);
    }
    if (Array.isArray(saved.rows) && saved.rows.length) state.rows = saved.rows;
    if (Array.isArray(saved.customers)) state.customers = saved.customers;
  } catch (_) { /* corrupt storage — start fresh */ }
}

/* ---- Field bindings: [elementId, stateSection, stateKey] ---- */

const FIELD_BINDINGS = [
  ["sellerName", "seller", "name"], ["sellerBusinessId", "seller", "businessId"],
  ["sellerAddress", "seller", "address"], ["sellerZip", "seller", "zip"],
  ["sellerCity", "seller", "city"], ["sellerPhone", "seller", "phone"],
  ["sellerEmail", "seller", "email"], ["sellerVatId", "seller", "vatId"],
  ["sellerWebsite", "seller", "website"], ["sellerIban", "seller", "iban"],
  ["sellerBic", "seller", "bic"],
  ["buyerName", "buyer", "name"], ["buyerContact", "buyer", "contact"],
  ["buyerAddress", "buyer", "address"], ["buyerZip", "buyer", "zip"],
  ["buyerCity", "buyer", "city"], ["buyerBusinessId", "buyer", "businessId"],
  ["invoiceNumber", "invoice", "number"], ["invoiceDate", "invoice", "date"],
  ["paymentTermDays", "invoice", "termDays"], ["dueDate", "invoice", "dueDate"],
  ["referenceNumber", "invoice", "reference"], ["lateInterest", "invoice", "lateInterest"],
  ["invoiceNotes", "invoice", "notes"],
];

function syncFormFromState() {
  for (const [id, section, key] of FIELD_BINDINGS) {
    $(id).value = state[section][key];
  }
}

/* ---- Auto-fill logic ---- */

function applyAutoFills(changedId) {
  const inv = state.invoice, seller = state.seller, manual = state.manual;

  if (changedId === "referenceNumber") manual.reference = $("referenceNumber").value.trim() !== "";
  if (changedId === "dueDate") manual.dueDate = true;
  if (changedId === "sellerVatId") manual.vatId = $("sellerVatId").value.trim() !== "";
  if (changedId === "sellerBic") manual.bic = $("sellerBic").value.trim() !== "";
  if (changedId === "lateInterest") manual.lateInterest = $("lateInterest").value.trim() !== "";

  if (!manual.reference) {
    const auto = makeViite(inv.number);
    if (auto) { inv.reference = auto; $("referenceNumber").value = auto; }
    else if (changedId === "invoiceNumber") { inv.reference = ""; $("referenceNumber").value = ""; }
  }

  if (!manual.dueDate && inv.date) {
    const days = parseInt(inv.termDays, 10);
    if (Number.isFinite(days) && days >= 0) {
      inv.dueDate = addDays(inv.date, days);
      $("dueDate").value = inv.dueDate;
    }
  }
  // editing the payment term resumes auto-calculation of the due date
  if (changedId === "paymentTermDays") {
    manual.dueDate = false;
    const days = parseInt(inv.termDays, 10);
    if (inv.date && Number.isFinite(days) && days >= 0) {
      inv.dueDate = addDays(inv.date, days);
      $("dueDate").value = inv.dueDate;
    }
  }

  if (!manual.vatId) {
    const digits = seller.businessId.replace(/\D/g, "");
    const auto = digits.length === 8 ? "FI" + digits : "";
    seller.vatId = auto;
    $("sellerVatId").value = auto;
  }

  if (!manual.bic) {
    const auto = bicFromIban(seller.iban);
    if (auto) { seller.bic = auto; $("sellerBic").value = auto; }
  }

  if (!manual.lateInterest) {
    const info = lateInterestInfo();
    const auto = info ? formatPercent(info.b2b) : "";
    inv.lateInterest = auto;
    $("lateInterest").value = auto;
  }
}

/* ---- ECB rates for viivästyskorko: built-in fallback, cached, refreshed daily ---- */

const RATES_CACHE_KEY = "laskutusohjelma.ecbRates";
let ecbRates = { ...ECB_MRO_BUILTIN, source: "builtin" };

function loadCachedRates() {
  try {
    const c = JSON.parse(localStorage.getItem(RATES_CACHE_KEY));
    if (c && Array.isArray(c.changes) && c.changes.length && c.asOf > ecbRates.asOf) {
      ecbRates = { asOf: c.asOf, changes: c.changes, source: "cache" };
    }
  } catch (_) { /* ignore */ }
}

async function refreshEcbRates() {
  if (ecbRates.asOf === todayIso()) return; // already fresh today
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(ECB_MRO_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return;
    const changes = parseEcbCsv(await res.text());
    if (!changes.length) return;
    ecbRates = { asOf: todayIso(), changes, source: "ecb" };
    try { localStorage.setItem(RATES_CACHE_KEY, JSON.stringify({ asOf: ecbRates.asOf, changes })); } catch (_) { /* ignore */ }
    onChange("ecbRates");
  } catch (_) { /* offline or API down — keep fallback */ }
}

/* Viivästyskorko for the current invoice date, or null if it can't be determined. */
function lateInterestInfo() {
  const date = state.invoice.date || todayIso();
  const viite = viitekorkoFor(date, ecbRates.changes);
  if (viite === null) return null;
  const period = halfYearOf(date);
  return {
    viite, period,
    b2b: viite + LATE_INTEREST_MARGIN_B2B,
    consumer: viite + LATE_INTEREST_MARGIN_CONSUMER,
    // data fetched before the half-year began may miss a late rate change
    estimate: ecbRates.asOf < period.start,
  };
}

/* ---- Backup: export / import as a JSON file ---- */

const BACKUP_FORMAT = "laskutusohjelma-backup";

function exportBackup() {
  const payload = {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `laskutusohjelma-varmuuskopio-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/* Accepts both the wrapped export format and a raw state object. */
function parseBackup(text) {
  const parsed = JSON.parse(text);
  const candidate = parsed && parsed.format === BACKUP_FORMAT ? parsed.state : parsed;
  if (!candidate || typeof candidate !== "object") return null;
  const looksLikeState = ["seller", "buyer", "invoice", "rows", "customers"]
    .some(key => key in candidate);
  return looksLikeState ? candidate : null;
}

function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let imported = null;
    try {
      imported = parseBackup(reader.result);
    } catch (_) { /* invalid JSON — handled below */ }
    if (!imported) {
      alert("Tiedosto ei ole kelvollinen varmuuskopio.");
      return;
    }
    if (!confirm("Tuodaanko varmuuskopio? Nykyiset tiedot tässä selaimessa korvataan.")) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
    } catch (err) {
      alert("Tallennus epäonnistui: " + err.message);
      return;
    }
    location.reload();
  };
  reader.onerror = () => alert("Tiedoston lukeminen epäonnistui.");
  reader.readAsText(file);
}

/* ---- Saved customers ---- */

function customerKey(name) { return name.trim().toLowerCase(); }

function renderCustomerSelect() {
  const sel = $("customerSelect");
  const current = sel.value;
  sel.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = state.customers.length
    ? "— Valitse tallennettu asiakas —"
    : "— Ei tallennettuja asiakkaita —";
  sel.appendChild(placeholder);
  const sorted = [...state.customers].sort((a, z) => a.name.localeCompare(z.name, "fi"));
  for (const c of sorted) {
    const opt = document.createElement("option");
    opt.value = customerKey(c.name);
    opt.textContent = c.name;
    sel.appendChild(opt);
  }
  sel.value = [...sel.options].some(o => o.value === current) ? current : "";
}

function setCustomerHint(text, cls) {
  const hint = $("customerHint");
  hint.textContent = text;
  hint.className = "hint" + (cls ? " " + cls : "");
}

function saveCurrentCustomer() {
  const name = state.buyer.name.trim();
  if (!name) {
    setCustomerHint("Täytä ensin asiakkaan nimi.", "error");
    return;
  }
  const record = { ...state.buyer, name };
  const idx = state.customers.findIndex(c => customerKey(c.name) === customerKey(name));
  const existed = idx >= 0;
  if (existed) state.customers[idx] = record;
  else state.customers.push(record);
  renderCustomerSelect();
  $("customerSelect").value = customerKey(name);
  setCustomerHint(existed ? `Asiakkaan ”${name}” tiedot päivitetty.` : `Asiakas ”${name}” tallennettu.`, "ok");
  saveState();
}

function loadCustomer(key) {
  const c = state.customers.find(c => customerKey(c.name) === key);
  if (!c) return;
  Object.assign(state.buyer, { name: "", contact: "", address: "", zip: "", city: "", businessId: "" }, c);
  syncFormFromState();
  setCustomerHint(`Asiakkaan ”${c.name}” tiedot haettu.`, "ok");
  onChange();
}

function deleteSelectedCustomer() {
  const key = $("customerSelect").value || customerKey(state.buyer.name);
  const idx = state.customers.findIndex(c => customerKey(c.name) === key);
  if (idx < 0) {
    setCustomerHint("Valitse ensin poistettava asiakas listasta.", "error");
    return;
  }
  const name = state.customers[idx].name;
  if (!confirm(`Poistetaanko asiakas ”${name}” tallennetuista?`)) return;
  state.customers.splice(idx, 1);
  renderCustomerSelect();
  setCustomerHint(`Asiakas ”${name}” poistettu.`, "");
  saveState();
}

/* ---- Logo handling ----
 * Stored as a data URL in state.seller.logo (persisted to localStorage).
 * Raster images are downscaled so the stored string stays well under quota;
 * SVG is kept as-is to preserve vector quality in print. */

const LOGO_MAX_W = 1000, LOGO_MAX_H = 400; // px, ~2x the printed 60x20 mm box
const LOGO_MAX_DATAURL = 700_000; // chars

function processLogoFile(file) {
  return new Promise((resolve, reject) => {
    if (file.type === "image/svg+xml") {
      if (file.size > 500_000) return reject(new Error("SVG-tiedosto on liian suuri (max 500 kt)."));
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Tiedoston lukeminen epäonnistui."));
      reader.readAsDataURL(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, LOGO_MAX_W / img.naturalWidth, LOGO_MAX_H / img.naturalHeight);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length > LOGO_MAX_DATAURL) {
        // too big as PNG — flatten on white and use JPEG
        const flat = document.createElement("canvas");
        flat.width = w; flat.height = h;
        const fctx = flat.getContext("2d");
        fctx.fillStyle = "#fff";
        fctx.fillRect(0, 0, w, h);
        fctx.drawImage(canvas, 0, 0);
        dataUrl = flat.toDataURL("image/jpeg", 0.85);
      }
      if (dataUrl.length > LOGO_MAX_DATAURL) return reject(new Error("Kuva on liian suuri logoksi."));
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Kuvan avaaminen epäonnistui — tarkista tiedostomuoto."));
    };
    img.src = url;
  });
}

function renderLogoControl() {
  const has = Boolean(state.seller.logo);
  $("logoPreview").hidden = !has;
  $("logoThumb").src = has ? state.seller.logo : "";
}

/* ---- Validation hints ---- */

function updateHints() {
  const liHint = $("lateInterestHint"), li = lateInterestInfo();
  if (state.manual.lateInterest) {
    liHint.textContent = "Syötetty käsin." + (li ? ` Tyhjennä kenttä palauttaaksesi korkolain mukaisen koron (${formatPercent(li.b2b)} %).` : "");
  } else if (li) {
    liHint.textContent =
      `Korkolain mukainen: viitekorko ${formatPercent(li.viite)} % (${formatDateFi(li.period.start)}–${formatDateFi(li.period.end)}) + 8 %-yks. ` +
      `Kuluttaja-asiakkaalle ${formatPercent(li.consumer)} %.` +
      (li.estimate ? " Arvio: EKP:n uusimpia korkotietoja ei saatu haettua." : "");
  } else {
    liHint.textContent = "";
  }

  const ibanEl = $("sellerIban"), ibanHint = $("ibanHint");
  const ibanVal = state.seller.iban.trim();
  if (ibanVal === "") {
    ibanEl.classList.remove("invalid", "valid-ok");
    ibanHint.textContent = "";
    ibanHint.className = "hint";
  } else if (isValidIban(ibanVal)) {
    ibanEl.classList.remove("invalid"); ibanEl.classList.add("valid-ok");
    ibanHint.textContent = "IBAN kelvollinen ✓";
    ibanHint.className = "hint ok";
  } else {
    ibanEl.classList.add("invalid"); ibanEl.classList.remove("valid-ok");
    ibanHint.textContent = "IBAN ei kelpaa — tarkista numero.";
    ibanHint.className = "hint error";
  }

  const bicHint = $("bicHint");
  bicHint.textContent = (!state.manual.bic && state.seller.bic) ? "Tunnistettu automaattisesti tilinumerosta." : "";

  const refEl = $("referenceNumber"), refHint = $("refHint");
  const refVal = state.invoice.reference.replace(/\s/g, "");
  if (refVal === "") {
    refEl.classList.remove("invalid", "valid-ok");
    refHint.textContent = "Muodostetaan automaattisesti laskun numerosta tarkisteineen.";
    refHint.className = "hint";
  } else if (isValidViite(refVal)) {
    refEl.classList.remove("invalid"); refEl.classList.add("valid-ok");
    refHint.textContent = "Viitenumeron tarkiste kelvollinen ✓";
    refHint.className = "hint ok";
  } else {
    refEl.classList.add("invalid"); refEl.classList.remove("valid-ok");
    refHint.textContent = "Viitenumeron tarkiste ei täsmää.";
    refHint.className = "hint error";
  }
}

/* ---- Row editor ---- */

function renderRowEditor() {
  const tbody = $("rowsBody");
  tbody.innerHTML = "";
  state.rows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    const tdDesc = document.createElement("td");
    tdDesc.className = "col-desc";
    const descInput = document.createElement("input");
    descInput.type = "text"; descInput.value = row.desc; descInput.placeholder = "Tuote tai palvelu";
    descInput.addEventListener("input", () => { row.desc = descInput.value; onChange(); });
    tdDesc.appendChild(descInput);

    const tdQty = document.createElement("td");
    tdQty.className = "col-qty";
    const qtyInput = document.createElement("input");
    qtyInput.type = "text"; qtyInput.inputMode = "decimal"; qtyInput.value = row.qty;
    qtyInput.addEventListener("input", () => { row.qty = qtyInput.value; onChange(); });
    tdQty.appendChild(qtyInput);

    const tdUnit = document.createElement("td");
    tdUnit.className = "col-unit";
    const unitSel = document.createElement("select");
    for (const u of UNITS) {
      const opt = document.createElement("option");
      opt.value = u; opt.textContent = u;
      unitSel.appendChild(opt);
    }
    unitSel.value = UNITS.includes(row.unit) ? row.unit : "kpl";
    unitSel.addEventListener("change", () => { row.unit = unitSel.value; onChange(); });
    tdUnit.appendChild(unitSel);

    const tdPrice = document.createElement("td");
    tdPrice.className = "col-price";
    const priceInput = document.createElement("input");
    priceInput.type = "text"; priceInput.inputMode = "decimal"; priceInput.value = row.price; priceInput.placeholder = "0,00";
    priceInput.addEventListener("input", () => { row.price = priceInput.value; onChange(); });
    const incLabel = document.createElement("label");
    incLabel.className = "inc-vat-toggle";
    incLabel.title = "Hinta sisältää arvonlisäveron";
    const incCheck = document.createElement("input");
    incCheck.type = "checkbox"; incCheck.checked = !!row.priceIncVat;
    incCheck.addEventListener("change", () => { row.priceIncVat = incCheck.checked; onChange(); });
    incLabel.append(incCheck, " sis. ALV");
    tdPrice.append(priceInput, incLabel);

    const tdVat = document.createElement("td");
    tdVat.className = "col-vat";
    const vatSel = document.createElement("select");
    for (const r of VAT_RATES) {
      const opt = document.createElement("option");
      opt.value = String(r); opt.textContent = String(r).replace(".", ",") + " %";
      vatSel.appendChild(opt);
    }
    vatSel.value = row.vat;
    vatSel.addEventListener("change", () => { row.vat = vatSel.value; onChange(); });
    tdVat.appendChild(vatSel);

    const tdTotal = document.createElement("td");
    tdTotal.className = "col-total";
    tdTotal.dataset.rowTotal = String(idx);

    const tdDel = document.createElement("td");
    tdDel.className = "col-del";
    const delBtn = document.createElement("button");
    delBtn.type = "button"; delBtn.className = "row-del-btn"; delBtn.textContent = "✕";
    delBtn.title = "Poista rivi";
    delBtn.addEventListener("click", () => {
      state.rows.splice(idx, 1);
      if (state.rows.length === 0) state.rows.push(newRow());
      renderRowEditor();
      onChange();
    });
    tdDel.appendChild(delBtn);

    tr.append(tdDesc, tdQty, tdUnit, tdPrice, tdVat, tdTotal, tdDel);
    tbody.appendChild(tr);
  });
}

function updateRowTotals() {
  state.rows.forEach((row, idx) => {
    const cell = document.querySelector(`[data-row-total="${idx}"]`);
    if (!cell) return;
    const c = calcRow(row);
    cell.textContent = c.valid ? formatMoney(c.grossCents / 100) : "–";
  });
  const totals = calcTotals(state.rows);
  $("totalsMini").innerHTML =
    `Veroton: ${formatMoneyEur(totals.netCents / 100)} &nbsp;·&nbsp; ALV: ${formatMoneyEur(totals.vatCents / 100)}<br>` +
    `<span class="grand">Yhteensä: ${formatMoneyEur(totals.grossCents / 100)}</span>`;
}

/* ---- Invoice preview rendering ---- */

function setText(id, text) { $(id).textContent = text; }

function renderPreview() {
  const s = state.seller, b = state.buyer, inv = state.invoice;

  const logoEl = $("pLogo");
  logoEl.hidden = !s.logo;
  if (s.logo) {
    if (logoEl.getAttribute("src") !== s.logo) logoEl.src = s.logo;
  } else {
    logoEl.removeAttribute("src");
  }

  // With a logo present the name is optional (logo may contain it) — hide the
  // empty name line instead of showing a placeholder dash.
  setText("pSellerName", s.name || (s.logo ? "" : "—"));
  $("pSellerName").hidden = !s.name && Boolean(s.logo);
  setText("pSellerAddress1", s.address);
  setText("pSellerAddress2", [s.zip, s.city].filter(Boolean).join(" "));

  setText("pInvoiceNumber", inv.number || "—");
  setText("pInvoiceDate", formatDateFi(inv.date));
  setText("pDueDate", formatDateFi(inv.dueDate));
  const days = parseInt(inv.termDays, 10);
  setText("pPaymentTerm", Number.isFinite(days) ? `${days} pv netto` : "");
  setText("pReference", inv.reference ? formatViite(inv.reference) : "");
  const interest = inv.lateInterest.trim();
  setText("pLateInterest", interest ? interest.replace(".", ",") + " %" : "");
  setText("pSellerBusinessId", s.businessId);
  setText("pSellerVatId", s.vatId);

  setText("pBuyerName", b.name || "—");
  setText("pBuyerContact", b.contact);
  setText("pBuyerAddress1", b.address);
  setText("pBuyerAddress2", [b.zip, b.city].filter(Boolean).join(" "));
  setText("pBuyerBusinessId", b.businessId ? "Y-tunnus: " + b.businessId : "");

  // Rows
  const tbody = $("pRowsBody");
  tbody.innerHTML = "";
  for (const row of state.rows) {
    const c = calcRow(row);
    if (!c.valid && !row.desc.trim()) continue;
    const tr = document.createElement("tr");
    const cells = [
      { text: row.desc, cls: "t-desc" },
      { text: c.valid ? `${qtyFmt.format(parseDecimal(row.qty))} ${row.unit}` : "", cls: "t-num" },
      { text: c.valid ? formatMoney(netUnitPrice(row)) : "", cls: "t-num" },
      { text: c.valid ? formatMoney(c.netCents / 100) : "", cls: "t-num" },
      { text: String(row.vat).replace(".", ","), cls: "t-num" },
      { text: c.valid ? formatMoney(c.vatCents / 100) : "", cls: "t-num" },
      { text: c.valid ? formatMoney(c.grossCents / 100) : "", cls: "t-num" },
    ];
    for (const { text, cls } of cells) {
      const td = document.createElement("td");
      td.className = cls;
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  // Totals + VAT breakdown
  const totals = calcTotals(state.rows);
  setText("pTotalNet", formatMoneyEur(totals.netCents / 100));
  setText("pTotalVat", formatMoneyEur(totals.vatCents / 100));
  setText("pTotalGross", formatMoneyEur(totals.grossCents / 100));

  const vatTable = $("pVatSummary");
  vatTable.innerHTML = "";
  const rates = [...totals.byRate.keys()].sort((a, z) => z - a);
  if (rates.length) {
    const head = document.createElement("tr");
    head.innerHTML = "<th>ALV-erittely</th><th>Veroton</th><th>Vero</th><th>Verollinen</th>";
    vatTable.appendChild(head);
    for (const rate of rates) {
      const agg = totals.byRate.get(rate);
      const tr = document.createElement("tr");
      const cells = [
        String(rate).replace(".", ",") + " %",
        formatMoney(agg.netCents / 100),
        formatMoney(agg.vatCents / 100),
        formatMoney((agg.netCents + agg.vatCents) / 100),
      ];
      for (const text of cells) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      vatTable.appendChild(tr);
    }
  }

  setText("pNotes", inv.notes);

  // Payment box
  setText("pPaySeller", s.name);
  setText("pPayIban", s.iban ? formatIban(s.iban) : "");
  setText("pPayBic", s.bic);
  setText("pPayReference", inv.reference ? formatViite(inv.reference) : "");
  setText("pPayDueDate", formatDateFi(inv.dueDate));
  setText("pPayAmount", formatMoneyEur(totals.grossCents / 100));

  // Bank barcode
  const barcode = bankBarcodeString({
    iban: s.iban,
    grossCents: totals.grossCents,
    reference: inv.reference,
    dueDateIso: inv.dueDate,
  });
  const wrap = $("pBarcodeWrap"), missing = $("pBarcodeMissing");
  if (barcode) {
    $("pBarcodeSvg").innerHTML = code128Svg(barcode);
    setText("pBarcodeNumber", barcode);
    wrap.style.display = "";
    missing.textContent = "";
  } else {
    $("pBarcodeSvg").innerHTML = "";
    setText("pBarcodeNumber", "");
    wrap.style.display = "none";
    const reasons = [];
    if (!isValidIban(s.iban) || !normalizeIban(s.iban).startsWith("FI")) reasons.push("kelvollinen suomalainen IBAN");
    if (!isValidViite(inv.reference)) reasons.push("kelvollinen viitenumero");
    missing.textContent = "Pankkiviivakoodi lisätään, kun laskulla on " + (reasons.join(" ja ") || "tarvittavat tiedot") + ".";
  }

  // Footer contact line
  const footerParts = [
    s.name,
    [s.address, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    s.phone ? "puh. " + s.phone : "",
    s.email,
    s.website,
    s.businessId ? "Y-tunnus " + s.businessId : "",
  ].filter(Boolean);
  setText("pFooter", footerParts.join("  ·  "));
}

/* ---- Main change handler ---- */

function onChange(changedId) {
  for (const [id, section, key] of FIELD_BINDINGS) {
    state[section][key] = $(id).value;
  }
  applyAutoFills(changedId);
  updateHints();
  updateRowTotals();
  renderPreview();
  saveState();
}

/* ---- Init ---- */

function init() {
  loadState();
  loadCachedRates();
  if (state.rows.length === 0) state.rows.push(newRow());
  if (!state.invoice.date) state.invoice.date = todayIso();

  syncFormFromState();
  renderRowEditor();
  renderLogoControl();
  renderCustomerSelect();

  for (const [id] of FIELD_BINDINGS) {
    $(id).addEventListener("input", () => onChange(id));
  }

  $("addRowBtn").addEventListener("click", () => {
    const last = state.rows[state.rows.length - 1];
    state.rows.push({ ...newRow(), vat: last ? last.vat : "25.5", unit: last ? last.unit : "kpl", priceIncVat: last ? !!last.priceIncVat : false });
    renderRowEditor();
    onChange();
  });

  $("customerSelect").addEventListener("change", () => {
    const key = $("customerSelect").value;
    if (key) loadCustomer(key);
  });
  $("customerSaveBtn").addEventListener("click", saveCurrentCustomer);
  $("customerDeleteBtn").addEventListener("click", deleteSelectedCustomer);

  $("logoInput").addEventListener("change", async () => {
    const file = $("logoInput").files[0];
    if (!file) return;
    try {
      state.seller.logo = await processLogoFile(file);
      renderLogoControl();
      onChange();
    } catch (err) {
      alert(err.message);
      $("logoInput").value = "";
    }
  });

  $("logoRemoveBtn").addEventListener("click", () => {
    state.seller.logo = "";
    $("logoInput").value = "";
    renderLogoControl();
    onChange();
  });

  $("exportBtn").addEventListener("click", exportBackup);
  $("importBtn").addEventListener("click", () => $("importInput").click());
  $("importInput").addEventListener("change", () => {
    const file = $("importInput").files[0];
    if (file) importBackupFile(file);
    $("importInput").value = "";
  });

  $("printBtn").addEventListener("click", () => window.print());

  $("newInvoiceBtn").addEventListener("click", () => {
    const prevNumber = parseInt(state.invoice.number, 10);
    state.buyer = { name: "", contact: "", address: "", zip: "", city: "", businessId: "" };
    state.invoice = {
      number: Number.isFinite(prevNumber) ? String(prevNumber + 1) : "",
      date: todayIso(), termDays: state.invoice.termDays || "14",
      dueDate: "", reference: "", lateInterest: state.invoice.lateInterest, notes: "",
    };
    state.rows = [newRow()];
    state.manual.reference = false;
    state.manual.dueDate = false;
    syncFormFromState();
    renderRowEditor();
    $("customerSelect").value = "";
    setCustomerHint("Tallennetut asiakkaat säilyvät selaimessasi seuraavia laskuja varten.", "");
    onChange();
  });

  $("clearAllBtn").addEventListener("click", () => {
    if (!confirm("Tyhjennetäänkö kaikki tiedot, myös omat laskuttajan tiedot?")) return;
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });

  onChange();
  refreshEcbRates();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

/* Exported for tests (Node) */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseDecimal, calcRow, calcTotals,
    viiteCheckDigit, makeViite, isValidViite, formatViite,
    normalizeIban, isValidIban, formatIban, bicFromIban,
    bankBarcodeString, code128CElements, addDays,
    halfYearOf, viitekorkoFor, parseEcbCsv, ECB_MRO_BUILTIN,
  };
}
