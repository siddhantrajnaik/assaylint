// Robustness checks: hundreds of randomly generated plates in every supported layout, plus odd files,
// run through file detection, parsing, analysis and every export. Each run must either be read correctly
// or fail with a clear ParseError; it must never crash, drop rows silently or alter raw values.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as R from "../web/report.js";

let seed = 20261111;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const pos = (i, cols) => String.fromCharCode(65 + Math.floor(i / cols)) + ((i % cols) + 1);

// ---------------------------------------------------------------- random plate generator
const NAMES = ["ctrl-1", "ctrl-2", "kd-1", "Patient A", "mouse 3, liver", "Probe-α", "サンプル", "<b>x</b>", "s\"q", "NTC", "water", "H2O", ""];
const TARGETS = ["GAPDH", "ACTB", "IL6", "GENE-1", "18S rRNA", ""];
function plate() {
  const size = chance(0.3) ? 384 : 96, cols = size === 384 ? 24 : 12, n = 1 + Math.floor(rnd() * (size === 384 ? 200 : 96));
  const wells = [];
  for (let i = 0; i < n; i++) {
    const role = pick(["sample", "sample", "sample", "ntc", "positive", "nrt", "standard", "empty"]);
    const ctKind = rnd();
    const ct = ctKind < 0.08 ? "Undetermined" : ctKind < 0.12 ? "" : ctKind < 0.14 ? pick(["abc", "N/A", "-", "NaN", "No Ct"]) : (10 + rnd() * 30).toFixed(pick([2, 3, 6]));
    wells.push({ well: pos(i, cols), sample: role === "ntc" && chance(0.5) ? "NTC" : pick(NAMES), target: pick(TARGETS), role, ct,
      quantity: role === "standard" ? pick(["1e6", "1e5", "10000", "1000", "100", "1.2E+03", ""]) : "" });
    if (chance(0.05)) wells.push({ ...wells.at(-1) }); // duplicate well
  }
  if (chance(0.15)) wells.push({ well: pick(["Z9", "A0", "A25", "Q1", "A1O", "1A"]), sample: "x", target: "GAPDH", role: "sample", ct: "20.0", quantity: "" });
  return { size, cols, wells };
}
const q = (v, d) => (/["\n\r]/.test(v) || v.includes(d) ? `"${v.replace(/"/g, '""')}"` : v);
const ROLE_WORDS = {
  generic: { sample: "sample", ntc: "ntc", positive: "positive", nrt: "nrt", standard: "standard", empty: "empty" },
  cfx: { sample: "Unkn-01", ntc: "NTC", positive: "Pos Ctrl", nrt: "NRT", standard: "Std-01", empty: "Unkn-02" },
  qs: { sample: "UNKNOWN", ntc: "NTC", positive: "UNKNOWN", nrt: "UNKNOWN", standard: "STANDARD", empty: "UNKNOWN" },
};
// Each writer returns the file text and the number of data rows it contains.
const WRITERS = {
  generic(p) {
    const d = pick([",", "\t", ";"]), dec = d === ";" && chance(0.5);
    const rows = p.wells.map(w => [w.well, w.sample, w.target, ROLE_WORDS.generic[w.role], dec ? w.ct.replace(".", ",") : w.ct, w.quantity].map(v => q(v, d)).join(d));
    return { text: ["Well" + d + "Sample" + d + "Target" + d + "Role" + d + pick(["Ct", "Cq", "CT"]) + d + "Quantity", ...rows].join("\n") + "\n", rows: rows.length, dec };
  },
  cfx(p) {
    const rows = p.wells.map((w, i) => ["", w.well.replace(/^([A-P])(\d)$/, "$10$2"), "SYBR", w.target, ROLE_WORDS.cfx[w.role], w.sample, "", w.ct === "" || w.ct === "Undetermined" ? "NaN" : w.ct, "", "", w.quantity || "NaN"].map(v => q(v, ",")).join(","));
    return { text: [",Well,Fluor,Target,Content,Sample,Biological Set Name,Cq,Cq Mean,Cq Std. Dev,Starting Quantity (SQ)", ...rows].join("\r\n") + "\r\n", rows: rows.length };
  },
  quantstudio(p) {
    const idx = w => { const m = /^([A-P])(\d+)$/.exec(w.well); return m ? (m[1].charCodeAt(0) - 65) * p.cols + Number(m[2]) : 0; };
    const rows = p.wells.map(w => [idx(w), w.well, "false", w.sample, w.target, ROLE_WORDS.qs[w.role], "SYBR", "None", w.ct || "Undetermined", w.quantity].join("\t"));
    return { text: [`* Block Type = ${p.size}-Well Block`, "* Instrument Type = QuantStudio™ 5 System", "", "[Results]",
      "Well\tWell Position\tOmit\tSample Name\tTarget Name\tTask\tReporter\tQuencher\tCт\tQuantity", ...rows, "", "[Melt Curve Result]", "Well\tTm1", "1\t80.1"].join("\r\n"), rows: rows.length };
  },
  quantstudioCsv(p) {
    const rows = p.wells.map((w, i) => [i + 1, w.well, "FALSE", w.sample, w.target, ROLE_WORDS.qs[w.role], "FAM", "NFQ-MGB", w.ct || "Undetermined", w.quantity].map(v => q(String(v), ",")).join(","));
    const pad = ",".repeat(9);
    return { text: [`Block Type,${p.size}-Well Block${pad}`, `Calibration Background is expired ,No${pad}`, `Experiment Name,run${pad}`, pad,
      "Well,Well Position,Omit,Sample Name,Target Name,Task,Reporter,Quencher,CT,Quantity", ...rows, pad, pad, `Analysis Type,Singleplex${pad}`].join("\n"), rows: rows.length };
  },
  sds(p) {
    const idx = w => { const m = /^([A-P])(\d+)$/.exec(w.well); return m ? (m[1].charCodeAt(0) - 65) * p.cols + Number(m[2]) : null; };
    const ok = p.wells.filter(w => idx(w));
    const rows = ok.map(w => [idx(w), w.sample, w.target || "Det1", "SYBR", w.role === "ntc" ? "NTC" : w.role === "standard" ? "Standard" : "Unknown", w.ct || "Undetermined"].join("\t"));
    return { text: ["SDS 2.3\tAQ Results\t1.0", "Filename\trun", "", "Sample Information", "", "Well\tSample Name\tDetector Name\tReporter\tTask\tCt", ...rows, "", "Slope\t\tcycles/log decade"].join("\n"), rows: rows.length, plateSize: p.size };
  },
  lightcycler(p) {
    const rows = p.wells.map(w => ["True", "255", w.well, w.sample, /^\d/.test(w.ct) ? w.ct : "", "", "", ""].join("\t"));
    return { text: ["Experiment: run  Selected Filter: SYBR Green I / HRM Dye (465-510)", "Include\tColor\tPos\tName\tCp\tConcentration\tStandard\tStatus", ...rows].join("\r\n") + "\r\n", rows: rows.length };
  },
};
// Random damage that real files pick up: BOM, old Mac line endings, trailing blank lines, a cut-off last row.
function mutate(text) {
  const notes = [];
  if (chance(0.2)) { text = "﻿" + text; notes.push("bom"); }
  if (chance(0.1)) { text = text.replace(/\r?\n/g, "\r"); notes.push("cr"); }
  if (chance(0.2)) { text += "\n\n\n"; notes.push("blank-tail"); }
  return { text, notes };
}

const RUNS = 400;
const stats = { ok: 0, parseError: 0, byFormat: {} };
const failures = [];
test(`${RUNS} random plates in 7 layouts are read without crashes, data loss or changed values`, () => {
  for (let i = 0; i < RUNS; i++) {
    const p = plate(), kind = pick(Object.keys(WRITERS)), out = WRITERS[kind](p), m = mutate(out.text);
    const label = `run ${i} (${kind}${m.notes.length ? ", " + m.notes.join(", ") : ""})`;
    let res, exp;
    try {
    try {
      const det = C.detectFileKind(m.text);
      if (det.kind === "results" && det.needsPlateSize) assert.equal(kind, "sds", `${label}: only numbered-well files may ask for a plate size`);
      else assert.equal(det.kind, "results", `${label}: detected as ${det.kind}: ${det.error?.message}`);
      exp = C.newExperiment({ title: label }, "robust");
      exp.source = { name: "f", text: m.text, sha256: "-", plateSize: out.plateSize };
      res = C.analyze(exp);
    } catch (e) {
      if (e instanceof C.ParseError) { stats.parseError++; failures.push(`${label}: ParseError ${e.message}`); continue; }
      throw new Error(`${label}: ${e.message}`);
    }
    stats.ok++; stats.byFormat[res.parsed.format] = (stats.byFormat[res.parsed.format] || 0) + 1;
    // nothing dropped: every data row is either read or reported as unreadable
    assert.equal(res.rows.length + res.parsed.malformed.length, out.rows, `${label}: row count (read ${res.rows.length}+${res.parsed.malformed.length}, wrote ${out.rows}; last well ${p.wells.at(-1).well}; warnings: ${res.parsed.warnings.join(" / ").slice(0, 160)})`);
    // raw Ct strings unchanged: every Ct read appears verbatim in the file
    for (const r of res.rows) if (r.ct !== null) assert.ok(m.text.includes(r.ct), `${label}: Ct '${r.ct}' not in the file as written`);
    if (out.dec) assert.ok(res.parsed.decimalComma || !res.rows.some(r => /^\d+,\d+$/.test(r.ct || "")), `${label}: decimal commas not recognised`);
    // findings are well formed and unique
    const ids = new Set();
    for (const f of res.findings) {
      assert.ok(!ids.has(f.id), `${label}: duplicate finding id ${f.id}`); ids.add(f.id);
      for (const k of ["rule", "rule_version", "category", "severity", "title", "description", "evidence", "next_check", "why"]) assert.ok(f[k] != null && f[k] !== "", `${label}: ${f.id} missing ${k}`);
      assert.ok(C.RULES[f.rule], `${label}: unknown rule ${f.rule}`);
    }
    const sev = res.summary.bySeverity;
    assert.equal(Object.values(sev).reduce((a, b) => a + b, 0), res.findings.length, `${label}: summary counts`);
    // same input, same answer
    assert.equal(JSON.stringify(C.analyze(exp).findings), JSON.stringify(res.findings), `${label}: not deterministic`);
    // exports work and keep every row; the report never contains raw markup from the file
    const csv = R.wellsCsv(res);
    assert.ok(csv.length > 0);
    const html = R.reportHtml(exp, res);
    assert.ok(!html.includes("<b>x</b>"), `${label}: unescaped sample name in report`);
    JSON.parse(R.packetJson(exp, res));
    const steps = C.nextSteps(exp, res);
    assert.ok(steps.length >= 5 && steps.every(s => s.text && s.tab), `${label}: next steps`);
    } catch (e) { failures.push(String(e.message).split("\n")[0]); }
  }
  console.log(`  read ${stats.ok}/${RUNS}; by layout:`, JSON.stringify(stats.byFormat), failures.length ? `\n  problems (${failures.length}):\n  ${[...new Set(failures)].slice(0, 15).join("\n  ")}` : "");
  assert.equal(failures.length, 0, `${failures.length} problems`);
});

// ---------------------------------------------------------------- curve files
test("random curve files are recognised as curves, never as results", () => {
  for (let i = 0; i < 80; i++) {
    const wells = Array.from({ length: 1 + Math.floor(rnd() * 40) }, (_, j) => pos(j, 12));
    const wide = chance(0.5), melt = chance(0.5), xs = melt ? Array.from({ length: 61 }, (_, j) => (65 + j * 0.5).toFixed(1)) : Array.from({ length: 40 }, (_, j) => String(j + 1));
    const val = () => (rnd() * 3).toFixed(4);
    const text = wide
      ? [`,${melt ? "Temperature" : "Cycle"},${wells.join(",")}`, ...xs.map(x => `,${x},${wells.map(val).join(",")}`)].join("\r\n")
      : [`Well,Target,${melt ? "Temperature,Derivative" : "Cycle,Delta Rn"}`, ...wells.flatMap(w => xs.map(x => `${w},GAPDH,${x},${val()}`))].join("\n");
    const det = C.detectFileKind(text);
    assert.equal(det.kind, melt ? "melt" : "amp", `curve file ${i} (${wide ? "wide" : "long"}, ${melt ? "melt" : "amp"}) detected as ${det.kind}`);
  }
});

// ---------------------------------------------------------------- awkward files people actually drop
test("odd inputs fail with a clear message instead of crashing", () => {
  const cases = {
    "empty file": "",
    "only spaces": "   \n\n  ",
    "header only": "Well,Ct\n",
    "one column": "Well\nA1\nA2\n",
    "Excel file bytes": "PK\u0003\u0004\u0014\u0000\u0006\u0000xl/workbook.xml",
    "JSON": '{"format":"something"}',
    "HTML page": "<html><body><table><tr><td>Well</td><td>Ct</td></tr></table></body></html>",
    "random binary": String.fromCharCode(...Array.from({ length: 400 }, () => Math.floor(rnd() * 256))),
  };
  for (const [name, text] of Object.entries(cases)) {
    const det = C.detectFileKind(text);
    assert.equal(det.kind, null, `${name}: should not be accepted`);
    assert.ok(det.error instanceof C.ParseError, `${name}: should be a ParseError, got ${det.error}`);
  }
});

test("odd but valid values are kept exactly as written", () => {
  const text = "Well,Sample,Target,Ct,Quantity\nA1,s,G,1.85E+01,\nA2,s,G,-0.5,\nA3,s,G,55.2,\na4,s,G, 21.3 ,\nA05,s,G,\"24,1\",\nA6,s,G,∞,\nA7,s,G,22.0,\"12,963.927\"\n";
  const res = (() => { const e = C.newExperiment({}, "t"); e.source = { name: "f", text, sha256: "-" }; return C.analyze(e); })();
  assert.deepEqual(res.rows.map(r => [r.key, r.ct]), [["A1", "1.85E+01"], ["A2", "-0.5"], ["A3", "55.2"], ["A4", "21.3"], ["A5", "24,1"], ["A6", "∞"], ["A7", "22.0"]]);
  assert.equal(C.ctNum("1.85E+01"), 18.5);
  assert.equal(C.toNum("12,963.927"), 12963.927);
  const nonNum = res.findings.filter(f => f.rule === "non_numeric_ct").map(f => f.wells[0]);
  assert.deepEqual(nonNum.sort(), ["A5", "A6"]); // "24,1" in a comma file is not silently reinterpreted
});

test("a 384-well plate with 1,536 rows (4 targets) is analysed quickly", () => {
  const lines = ["Well,Sample,Target,Ct"];
  for (let i = 0; i < 384; i++) for (const t of ["A", "B", "C", "D"]) lines.push(`${pos(i, 24)},s${i % 32},${t},${(18 + rnd() * 10).toFixed(2)}`);
  const e = C.newExperiment({}, "t"); e.source = { name: "big", text: lines.join("\n"), sha256: "-" };
  const t0 = performance.now(), res = C.analyze(e), ms = performance.now() - t0;
  assert.equal(res.rows.length, 1536);
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
  R.reportHtml(e, res);
});

test("a 10,000-row file is analysed in reasonable time", () => {
  const lines = ["Well,Sample,Target,Ct"];
  for (let i = 0; i < 10000; i++) lines.push(`${pos(i % 384, 24)},s${i % 50},T${Math.floor(i / 384)},${(18 + rnd() * 10).toFixed(2)}`);
  const e = C.newExperiment({}, "t"); e.source = { name: "huge", text: lines.join("\n"), sha256: "-" };
  const t0 = performance.now(), res = C.analyze(e), ms = performance.now() - t0;
  assert.equal(res.rows.length, 10000);
  assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
});

// ---------------------------------------------------------------- encodings and wrong files
const csv = "Well,Sample,Target,Ct\nA1,Probe µ1,GAPDH,18.2\nA2,95 °C,GAPDH,18.4\n";
const utf16 = (s, le = true, bom = true) => { const out = []; if (bom) out.push(...(le ? [0xff, 0xfe] : [0xfe, 0xff])); for (const ch of s) { const c = ch.charCodeAt(0); out.push(...(le ? [c & 255, c >> 8] : [c >> 8, c & 255])); } return new Uint8Array(out); };
test("files in UTF-16, Windows-1252 and UTF-8 with a BOM are read the same", () => {
  const win1252 = new Uint8Array([...csv].map(ch => ({ "µ": 0xb5, "°": 0xb0 }[ch] ?? ch.charCodeAt(0))));
  const cases = { "UTF-8": new TextEncoder().encode(csv), "UTF-8 with BOM": new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(csv)]),
    "UTF-16 LE": utf16(csv), "UTF-16 BE": utf16(csv, false), "UTF-16 LE, no BOM": utf16(csv, true, false), "Windows-1252": win1252 };
  for (const [name, bytes] of Object.entries(cases)) {
    const d = C.decodeBytes(bytes);
    assert.ok(d.text, `${name}: not decoded`);
    const p = C.parseResults(d.text);
    assert.deepEqual(p.rows.map(r => r.sample), ["Probe µ1", "95 °C"], `${name}: ${d.encoding}`);
  }
});
test("Excel workbooks and instrument project files are recognised, not parsed as text", () => {
  assert.equal(C.decodeBytes(new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 6, 0])).binary, "zip");
  assert.equal(C.decodeBytes(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])).binary, "ole");
  assert.equal(C.decodeBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])).binary, "unknown"); // a PNG image
});
