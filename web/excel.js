// Reads Excel workbooks (.xlsx, .xls, .ods) by turning each sheet into tab-separated text,
// so the normal parsers read it exactly as they read a CSV export.
// SheetJS (vendor/xlsx.mjs, Apache-2.0) is only loaded when someone actually drops a workbook.
import { detectFileKind } from "./core.js";

let lib = null;
const load = async () => (lib ||= await import("./vendor/xlsx.mjs"));

async function shaBytes(b) {
  const buf = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, "0")).join("");
}

// One cell as text. Numbers keep every digit stored in the file (not the rounded value Excel shows),
// dates keep the way Excel shows them, and errors such as #DIV/0! stay as written.
function cellText(X, c) {
  if (!c || c.v == null) return "";
  let s;
  if (c.t === "n") s = c.z && X.SSF.is_date(c.z) ? (c.w ?? String(c.v)) : String(c.v);
  else if (c.t === "b") s = c.v ? "TRUE" : "FALSE";
  else if (c.t === "e") s = c.w ?? "#ERROR";
  else if (c.t === "d") s = c.v instanceof Date ? c.v.toISOString().slice(0, 19).replace("T", " ") : String(c.v);
  else s = String(c.v);
  s = s.replace(/[\t\r\n]+/g, " ");
  return s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}
function sheetText(X, ws) {
  if (!ws?.["!ref"]) return "";
  const r = X.utils.decode_range(ws["!ref"]), lines = [];
  for (let R = r.s.r; R <= r.e.r; R++) {
    const row = [];
    for (let C = r.s.c; C <= r.e.c; C++) row.push(cellText(X, ws[X.utils.encode_cell({ r: R, c: C })]));
    while (row.length && row[row.length - 1] === "") row.pop();
    if (row.length) lines.push(row.join("\t"));
  }
  return lines.join("\n");
}

// Every sheet that has something in it, as text. Returns null when the bytes are not a workbook
// (for example a QuantStudio .eds or Bio-Rad .pcrd project file, which are also zip files).
export async function excelSheets(bytes) {
  const X = await load();
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let wb;
  try { wb = X.read(b, { type: "array", cellNF: true, cellFormula: false, cellHTML: false, cellStyles: false }); } catch { return null; }
  if (!wb?.SheetNames?.length || !wb.Sheets) return null;
  const sheets = wb.SheetNames.map(sheet => ({ sheet, text: sheetText(X, wb.Sheets[sheet]) })).filter(s => s.text.trim());
  return sheets.length ? sheets : null;
}

// Works out what each sheet holds and picks the best one for each kind. A QuantStudio workbook can have
// Results, Amplification Data and Melt Curve sheets, so one file can give all three.
const EXACT = { results: /^(results?|(quantification )?c[tq] results?)$/i, amp: /^amplification( data)?$/i, melt: /^melt( curve)?( (raw|derivative))?( data)?$/i };
const PREFER = { results: /result|c[tq]\b/i, amp: /amplif/i, melt: /melt|dissoc/i };
export function classifySheets(sheets) {
  const found = sheets.map(s => ({ ...s, ...detectFileKind(s.text) }));
  const best = {};
  for (const kind of ["results", "amp", "melt"]) {
    const c = found.filter(s => s.kind === kind);
    if (!c.length) continue;
    const rows = s => s.parsed?.rows?.length || Object.keys(s.parsed?.series || {}).length || 0;
    // A sheet named exactly like an instrument's results sheet beats one that only contains the word ("Old results").
    const score = s => (EXACT[kind].test(s.sheet.trim()) ? 2 : PREFER[kind].test(s.sheet) ? 1 : 0);
    c.sort((a, b) => (score(b) - score(a)) || (rows(b) - rows(a)));
    best[kind] = { ...c[0], alternatives: c.slice(1).map(s => s.sheet) };
  }
  return { found, best };
}

// Reads a dropped workbook. Each picked sheet comes back as its own item, named after the workbook and sheet,
// carrying a note of where it came from so the report can say so.
export async function readWorkbook(name, bytes) {
  const sheets = await excelSheets(bytes);
  if (!sheets) return null;
  const { found, best } = classifySheets(sheets);
  const sha = await shaBytes(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const item = s => ({ ...s, name: sheetName(name, s.sheet, sheets.length), workbook: { name, sheet: s.sheet, sha256: sha } });
  return {
    best: Object.fromEntries(Object.entries(best).map(([k, s]) => [k, item(s)])),
    all: found.map(item),
  };
}
export const sheetName = (book, sheet, count = 2) => (count > 1 ? `${book} [${sheet}]` : book);
