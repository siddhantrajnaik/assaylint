// Fixes from the QA review of blocks 0-2 (November 2026). Each test pins one behaviour that was wrong or unclear.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as X from "../web/vendor/xlsx.mjs";
import { readWorkbook } from "../web/excel.js";

const run = text => { const e = C.newExperiment({ title: "qa" }, "qa"); e.source = C.fileRecord({ name: "qa.csv", text, sha: "x", actor: "qa", format: "generic-ct-csv" }); return C.analyze(e); };

test("a sheet named exactly Results wins over 'Old results', and the other candidate is reported", async () => {
  const sheet = ct => X.utils.aoa_to_sheet([["Well", "Sample", "Target", "Ct"], ["A1", "s1", "GAPDH", ct], ["A2", "s1", "GAPDH", ct + 0.1]]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["notes"]]), "Notes");
  X.utils.book_append_sheet(wb, sheet(30), "Old results");
  X.utils.book_append_sheet(wb, sheet(20), "Results");
  const book = await readWorkbook("qa.xlsx", new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" })));
  assert.equal(book.best.results.sheet, "Results");
  assert.deepEqual(book.best.results.alternatives, ["Old results"]);
});

test("two columns that could be Ct: the first is used and a warning names both", () => {
  const p = C.parseResults("Well,Sample,Target,Ct,Ct\nA1,s1,GAPDH,20.1,30.1\n");
  assert.equal(p.rows[0].ct, "20.1");
  assert.ok(p.warnings.some(w => /More than one column could be the Ct\/Cq column/.test(w) && /column 4/.test(w) && /column 5/.test(w) && /I used column 4/.test(w)));
  // QuantStudio's Well (number) + Well Position (A1) are two names for one field, not a duplicate.
  const qs = ["Well\tWell Position\tSample Name\tTarget Name\tCT", "1\tA1\ts\tG\t20"].join("\n") + "\n";
  assert.ok(!C.parseResults(qs).warnings.some(w => /More than one column/.test(w)));
});

test("no-RT controls are recognised from their names, NTC names still win, lookalikes are left alone", () => {
  const res = run("Well,Sample,Target,Ct\nA1,c1,GAPDH,20\nA2,c1,GAPDH,20.1\nA3,c1 noRT,GAPDH,\nA4,c1 -RT,GAPDH,\nA5,water,GAPDH,\nA6,RT-qPCR std,GAPDH,22\nA7,heart RT,GAPDH,21\n");
  const role = k => res.rows.find(r => r.key === k);
  assert.equal(role("A3").role, "nrt"); assert.match(role("A3").roleSource, /inferred/);
  assert.equal(role("A4").role, "nrt");
  assert.equal(role("A5").role, "ntc");
  assert.equal(role("A6").role, "sample"); assert.equal(role("A7").role, "sample");
  // A no-RT that did its job (no Ct) is not reported as a missing value.
  assert.ok(!res.findings.some(f => f.rule === "missing_ct" && f.wells.some(w => w === "A3" || w === "A4")));
});

test("a role from the file is never overridden by the name guess", () => {
  const res = run("Well,Sample,Target,Ct,Task\nA1,c1 noRT,GAPDH,30,STANDARD\n");
  assert.equal(res.rows[0].role, "standard");
});

test("an omitted well in a duplex says which target it is", () => {
  const res = run("Well,Sample,Target,Ct,Omit\nA5,s1,GENEX,25,true\nA5,s1,ACTB,19,true\n");
  const d = res.findings.filter(f => f.rule === "instrument_omit").map(f => f.description);
  assert.deepEqual(d.sort(), ["Well A5 (s1 / ACTB) is marked Omit in the instrument export.", "Well A5 (s1 / GENEX) is marked Omit in the instrument export."]);
});

test("version and build are exported, and the rule set has its own version", () => {
  assert.match(C.APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof C.BUILD, "string");
  assert.equal(C.DISPOSITION_LABEL.accepted, "Looks fine");
});

// ---- Blocks 3-5
import * as A from "../web/analysis.js";
import * as R from "../web/report.js";
const DUP = "Well;Sample;Target;Ct;Group\nA1;c;GENE1;24,10;ctrl\nA2;c;GENE1;24,30;ctrl\nA3;c;REF;18,00;ctrl\nA4;c;REF;18,20;ctrl\nB1;t;GENE1;26,10;trt\nB2;t;GENE1;26,10;trt\nB3;t;REF;18,10;trt\nB4;t;REF;18,10;trt\nB1;t;GENE1;30,00;trt\n";
const exp = text => { const e = C.newExperiment({ title: "qa" }, "qa"); e.source = C.fileRecord({ name: "qa.csv", text, sha: "x", actor: "qa", format: "generic-ct-csv" }); return e; };

test("a duplicated well is left out of the analysis with a note, and comes back once one result is set to Not used", () => {
  const e = exp(DUP); e.analysis = { ...A.DEFAULT_SETTINGS, enabled: true, refs: ["REF"], control: "ctrl" };
  const a = A.analyzeRun(e, C.analyze(e));
  const t = a.rows.find(r => r.target === "GENE1" && r.group === "trt");
  assert.deepEqual(t.tech.map(x => x.ct), [26.1]);
  assert.ok(a.warnings.some(w => /more than one result for the same target: B1 \(GENE1\)/.test(w)));
  const res0 = C.analyze(e); const extra = res0.rows.find(r => r.key === "B1" && r.ct === "30,00");
  e.map[extra.id] = { role: "empty" };
  const res1 = C.analyze(e), a1 = A.analyzeRun(e, res1);
  assert.ok(!res1.findings.some(f => f.rule === "duplicate_well_assignment"), "marking one Not used resolves the duplicate");
  assert.deepEqual(a1.rows.find(r => r.target === "GENE1" && r.group === "trt").tech.map(x => x.ct), [26.1, 26.1]);
});

test("replicate SD exactly at the threshold is not flagged; just above is", () => {
  const f = d => { const e = exp(`Well,Sample,Target,Ct\nA1,s,G,20\nA2,s,G,${(20 + d).toFixed(2)}\nA3,s,G,${(20 + 2 * d).toFixed(2)}\n`); return C.analyze(e).findings.some(x => x.rule === "replicate_dispersion"); };
  assert.equal(f(0.30), false); assert.equal(f(0.31), true); assert.equal(f(0.29), false);
});

test("lines that couldn't be read are listed in the well-data CSV with their raw text", () => {
  const e = exp("Well,Sample,Target,Ct\nA1,s,G,20\nA2,s,G,20.1,EXTRA\nA3,s,G,20.2\n");
  const csv = R.wellsCsv(C.analyze(e)).split(/\r?\n/);
  assert.match(csv[2], /^3,.*not read.*20\.1/);
  assert.equal(csv.length >= 4, true);
});

// ---- Blocks 6-8
const stdRun = (slope, extra = {}) => { const text = "Well,Sample,Target,Ct,Task,Quantity\n" + [6, 5, 4, 3, 2].map((l, i) => `A${i + 1},s${i},G,${(40 + slope * l).toFixed(6)},Standard,1e${l}`).join("\n") + "\n"; const e = exp(text); Object.assign(e.ruleset.values, extra); return C.analyze(e); };
test("efficiency exactly at 90% or 110% is inside the range", () => {
  for (const eff of [90, 110]) assert.ok(!stdRun(-1 / Math.log10(1 + eff / 100)).findings.some(f => f.rule === "std_curve_efficiency"), `${eff}%`);
  assert.ok(stdRun(-1 / Math.log10(1.89)).findings.some(f => f.rule === "std_curve_efficiency"));
});
test("a run whose only medium findings are missing method details is not 'Review needed'", () => {
  const r = C.analyze(exp("Well,Sample,Target,Ct,Task\nA1,s,G,20,Unknown\nA2,s,G,20.1,Unknown\nH1,NTC,G,Undetermined,NTC\n"));
  assert.ok(r.findings.some(f => f.rule === "missing_metadata" && f.severity === "medium"));
  assert.notEqual(r.summary.status, "review_needed");
});
test("second melt peaks closer than the separation setting are counted when the setting is lowered", () => {
  const temps = []; for (let t = 70; t <= 90; t += 0.05) temps.push(+t.toFixed(2));
  const g = (t, m, h) => h * Math.exp(-((t - m) ** 2) / 0.32); // narrow peaks, so 1.5 °C apart gives two maxima
  const melt = "Temperature,A1,A2,A3\n" + temps.map(t => `${t},${g(t, 82, 1).toFixed(5)},${g(t, 82, 1).toFixed(5)},${(g(t, 82, 1) + g(t, 80.5, 0.6)).toFixed(5)}`).join("\n") + "\n";
  const run2 = sep => { const e = exp("Well,Sample,Target,Ct\nA1,a,G,22\nA2,b,G,22\nA3,c,G,22\n"); e.melt = C.fileRecord({ name: "m", text: melt, sha: "x", actor: "qa", valueType: "derivative" }); Object.assign(e.ruleset.values, { meltChecks: true, meltPeakSeparation: sep }); return C.analyze(e).findings.some(f => f.rule === "melt_multiple_peaks"); };
  assert.equal(run2(2), false); assert.equal(run2(1), true);
});

// ---- Blocks 9-11
test("an implausible standard-curve efficiency is not used for the Pfaffl correction", () => {
  const rows = ["Well,Sample,Target,Ct,Group,Task,Quantity"]; let w = 0; const wk = () => `${"ABCDEFGH"[Math.floor(w / 12)]}${(w++ % 12) + 1}`;
  for (const [u, g, r] of [["c1", 24, 18], ["c2", 24.2, 18.1], ["t1", 26, 18], ["t2", 26.3, 18.1]]) { rows.push(`${wk()},${u},GENE1,${g},${u[0] === "c" ? "ctrl" : "trt"},Unknown,`); rows.push(`${wk()},${u},REF1,${r},${u[0] === "c" ? "ctrl" : "trt"},Unknown,`); }
  const sl = -1 / Math.log10(2.5); for (const l of [6, 5, 4, 3]) rows.push(`${wk()},std-${l},REF1,${(38 + sl * l).toFixed(4)},,Standard,1e${l}`);
  const e = exp(rows.join("\n") + "\n"); e.analysis = C.cleanAnalysisSettings({ on: true, control: "ctrl", refs: ["REF1"], efficiency: true });
  const a = A.analyzeRun(e, C.analyze(e));
  assert.equal(a.efficiency.REF1.E, 2);
  assert.match(a.efficiency.REF1.source, /not used/);
  assert.ok(a.warnings.some(x => /150\.0% efficiency, outside 80–120%/.test(x)));
});

// ---- Blocks 12-14
test("plate centring refuses a design where each plate holds one group; the calibrator isn't reported as a repeated unit", () => {
  const plate = (title, units, shift) => { const L = ["Well,Sample,Target,Ct,Group"]; let w = 0;
    for (const [u, g] of units) for (const d of [-0.03, 0.03]) { L.push(`A${++w},${u},REF,${(18 + shift.REF + d).toFixed(3)},${g}`); L.push(`A${++w},${u},GENE,${(18 + (g === "trt" ? 8 : 6) + shift.GENE + d).toFixed(3)},${g}`); }
    for (const d of [-0.03, 0.03]) { L.push(`B${++w},CAL,REF,${(17 + shift.REF + d).toFixed(3)},`); L.push(`B${++w},CAL,GENE,${(23 + shift.GENE + d).toFixed(3)},`); }
    const e = exp(L.join("\n") + "\n"); e.title = title; return { exp: e, res: C.analyze(e) }; };
  const runs = [plate("P1", [["c1", "ctrl"], ["c2", "ctrl"], ["c3", "ctrl"]], { GENE: 0, REF: 0 }), plate("P2", [["t1", "trt"], ["t2", "trt"], ["t3", "trt"]], { GENE: 1, REF: 0.2 })];
  const settings = { on: true, refs: ["REF"], control: "ctrl" };
  const centre = A.analyzeStudy(runs, { settings, mode: "centre" });
  assert.equal(centre.calibration.mode, "none");
  assert.ok(centre.warnings.some(w => /Plate centring was not applied/.test(w)));
  const cal = A.analyzeStudy(runs, { settings, mode: "calibrator", calibrators: ["CAL"] });
  assert.ok(Math.abs(cal.summary.find(r => r.target === "GENE" && r.group === "trt").meanDdct - 2) < 1e-9);
  assert.ok(!cal.warnings.some(w => /appear on more than one plate \(CAL\)/.test(w)));
});
