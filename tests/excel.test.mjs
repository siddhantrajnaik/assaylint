// Excel support: workbooks laid out like real QuantStudio and Bio-Rad CFX Excel exports are read sheet by sheet
// and must give exactly the same wells and Ct values as the same data exported as text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import * as X from "../web/vendor/xlsx.mjs";
import * as C from "../web/core.js";
import { readWorkbook, excelSheets } from "../web/excel.js";

const fx = n => readFileSync(new URL(`../testdata/realistic/${n}`, import.meta.url), "utf8");
// Text rows to sheet rows: numbers become real number cells, as they are in an instrument's Excel export.
const cells = text => C.splitDelimited(text).map(r => r.cells.map(v => (/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v.trim()) ? Number(v) : v)));
const book = (sheets, type = "xlsx") => {
  const wb = X.utils.book_new();
  for (const [name, rows] of sheets) X.utils.book_append_sheet(wb, Array.isArray(rows) ? X.utils.aoa_to_sheet(rows) : rows, name);
  return new Uint8Array(X.write(wb, { type: "array", bookType: type }));
};
const num = v => (v != null && Number.isFinite(Number(v)) && String(v).trim() !== "" ? Number(v) : v ?? null);
const same = (a, b) => {
  assert.equal(a.rows.length, b.rows.length);
  a.rows.forEach((r, i) => {
    const s = b.rows[i];
    assert.equal(r.key, s.key); assert.equal(r.sample, s.sample); assert.equal(r.target, s.target); assert.equal(r.role, s.role);
    assert.deepEqual(num(s.ct), num(r.ct), r.key);
  });
};

// QuantStudio's Excel export: a key/value block above each table, and several sheets in one file.
function quantStudioBook(type) {
  const txt = fx("quantstudio5_384_taqman.txt");
  const pre = txt.split("\n").filter(l => l.startsWith("* ")).map(l => { const [k, ...v] = l.slice(2).split(" = "); return [k.trim(), v.join(" = ").trim()]; });
  const table = cells(txt.slice(txt.indexOf("[Results]") + 10));
  const amp = cells(fx("quantstudio5_384_taqman_amp.csv"));
  const setup = [...pre, [], ["Well", "Well Position", "Sample Name", "Target Name", "Task"], ...table.slice(1, 40).map(r => [r[0], r[1], r[3], r[4], r[5]])];
  return { txt, bytes: book([["Sample Setup", setup], ["Amplification Data", [...pre, [], ...amp]], ["Results", [...pre, [], ...table]]], type) };
}

for (const type of ["xlsx", "xls", "biff8", "ods"]) {
  test(`QuantStudio workbook (${type}): results and amplification sheets are found and read like the text export`, async () => {
    const { txt, bytes } = quantStudioBook(type);
    assert.ok(C.decodeBytes(bytes).binary, "a workbook is not text");
    const wb = await readWorkbook(`run.${type === "biff8" ? "xls" : type}`, bytes);
    assert.equal(wb.best.results.sheet, "Results");
    assert.equal(wb.best.amp.sheet, "Amplification Data");
    assert.equal(wb.all.find(s => s.sheet === "Sample Setup").kind, null, "a setup sheet without Ct is not a results file");
    const fromBook = C.parseResults(wb.best.results.text), fromText = C.parseResults(txt);
    same(fromText, fromBook);
    assert.equal(fromBook.format, "thermo-quantstudio");
    assert.ok(fromBook.rows.some(r => r.omit), "Omit flags survive");
    assert.equal(wb.best.results.workbook.sheet, "Results");
    assert.match(wb.best.results.workbook.sha256, /^[0-9a-f]{64}$/);
    assert.equal(wb.best.results.name, `run.${type === "biff8" ? "xls" : type} [Results]`);
    const amp = C.parseCurves(wb.best.amp.text, "amp"), ampText = C.parseCurves(fx("quantstudio5_384_taqman_amp.csv"), "amp");
    assert.equal(amp.points, ampText.points);
  });
}

test("Bio-Rad CFX: one workbook per export, each with a single sheet, are each recognised", async () => {
  for (const [file, kind] of [["cfx96_sybr.csv", "results"], ["cfx96_sybr_amp.csv", "amp"], ["cfx96_sybr_melt.csv", "melt"]]) {
    const wb = await readWorkbook(file.replace(".csv", ".xlsx"), book([["0", cells(fx(file))]]));
    assert.deepEqual(Object.keys(wb.best), [kind], file);
    assert.equal(wb.best[kind].name, file.replace(".csv", ".xlsx"), "a one-sheet workbook keeps its plain name");
    if (kind === "results") same(C.parseResults(fx(file)), C.parseResults(wb.best.results.text));
    else assert.equal(C.parseCurves(wb.best[kind].text, kind).points, C.parseCurves(fx(file), kind).points);
  }
});

test("Ct values keep every stored digit, not the two decimals Excel shows", async () => {
  const ws = X.utils.aoa_to_sheet([["Well", "Sample", "Target", "Ct"], ["A1", "s1", "GAPDH", 24.123456789], ["A2", "s1", "GAPDH", "Undetermined"]]);
  ws.D2.z = "0.00";
  const wb = await readWorkbook("r.xlsx", book([["Sheet1", ws]]));
  assert.match(wb.best.results.text, /24\.123456789/);
  const p = C.parseResults(wb.best.results.text);
  assert.equal(p.rows[0].ct, "24.123456789");
  assert.equal(p.rows[1].ct, "Undetermined");
});

test("title rows, commas and quotes in cells, formulas, dates and errors are handled", async () => {
  const ws = X.utils.aoa_to_sheet([
    ["qPCR run 14 Feb, plate 2"], [],
    ["Run date", new Date(Date.UTC(2025, 1, 14))],
    ["Well", "Sample", "Target", "Ct", "Note"],
    ["A1", 'mouse "M1", liver', "Il6", 25.5, "ok, fine"],
    ["A2", "NTC", "Il6", { t: "e", v: 7 }, ""],
    ["A3", "s2", "Il6", { t: "n", v: 26.25, f: "D5+0.75" }, ""],
  ], { cellDates: true });
  const wb = await readWorkbook("hand.xlsx", book([["Plate 2", ws]]));
  const p = C.parseResults(wb.best.results.text);
  assert.deepEqual(p.rows.map(r => r.key), ["A1", "A2", "A3"]);
  assert.equal(p.rows[0].sample, 'mouse "M1", liver');
  assert.equal(p.rows[0].ct, "25.5");
  assert.equal(p.rows[2].ct, "26.25", "the saved result of a formula is used");
  assert.match(wb.best.results.text, /#DIV\/0!/, "Excel errors stay visible instead of turning into numbers");
  assert.doesNotMatch(wb.best.results.text.split("\n")[1], /^Run date\t4\d{4}$/, "dates are not shown as serial numbers");
});

test("files that are zipped but not workbooks, and empty workbooks, are refused", async () => {
  const fake = new Uint8Array([0x50, 0x4b, 3, 4, ...Array.from({ length: 200 }, (_, i) => (i * 37) % 256)]);
  assert.equal(C.decodeBytes(fake).binary, "zip");
  assert.equal(await readWorkbook("run.eds", fake), null);
  assert.equal(await excelSheets(book([["Sheet1", [[]]]])), null);
  const noCt = await readWorkbook("notes.xlsx", book([["Notes", [["Primer", "Sequence"], ["Il6 F", "ACGT"]]]]));
  assert.deepEqual(noCt.best, {});
});

test("a saved run keeps where its file came from", async () => {
  const wb = await readWorkbook("run.xlsx", quantStudioBook("xlsx").bytes), r = wb.best.results;
  const e = C.newExperiment({ title: "x" }, "me");
  e.source = C.fileRecord({ name: r.name, text: r.text, sha: await C.sha256(r.text), actor: "me", format: "thermo-quantstudio", workbook: r.workbook });
  const back = C.normalizeExperiment(JSON.parse(JSON.stringify(e)));
  assert.deepEqual(back.source.workbook, r.workbook);
  e.source.workbook = { name: {}, sheet: [] };
  assert.equal(C.normalizeExperiment(JSON.parse(JSON.stringify(e))).source.workbook, undefined, "a damaged note is dropped, the file is kept");
});

test("command line: an Excel workbook with results and curves in one file", () => {
  const dir = mkdtempSync(join(tmpdir(), "pc-xlsx-")), f = join(dir, "run.xlsx"), json = join(dir, "out.json");
  writeFileSync(f, quantStudioBook("xlsx").bytes);
  const out = execFileSync(process.execPath, [new URL("../cli.mjs", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), f, "--json", json], { encoding: "utf8" });
  assert.match(out, /Reading sheet 'Results' of run\.xlsx/);
  const res = JSON.parse(readFileSync(json, "utf8"));
  assert.equal(res.experiment.files.source.workbook.sheet, "Results");
  assert.ok(res.experiment.files.amp, "the amplification sheet was picked up from the same workbook");
});
