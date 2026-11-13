// Analysis module (web/analysis.js): worked examples checked by hand, plus the rules it must keep.
import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import * as S from "../web/stats.js";
import * as R from "../web/report.js";
import { pngWithDpi } from "../web/ui-analysis.js";

const near = (got, want, tol = 1e-9, what = "") => assert.ok(Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `${what}: got ${got}, want ${want}`);
// rows: [well, sample, target, ct, group, extra columns...]
function run(rows, { title = "plate", head = ["Well", "Sample", "Target", "Ct", "Group"] } = {}) {
  const text = [head.join(","), ...rows.map(r => r.join(","))].join("\n") + "\n";
  const e = C.newExperiment({ title }, "tester");
  e.source = C.fileRecord({ name: `${title}.csv`, text, sha: "x", format: "generic-ct-csv" });
  return { exp: e, res: C.analyze(e) };
}
const wells = (() => { const out = []; for (const r of "ABCDEFGHIJKLMNOP") for (let c = 1; c <= 24; c++) out.push(r + c); return out; })();
// Builds rows from { unit: [group, { target: [ct, ct, ...] }] }.
function plate(units, { shift = {} } = {}) {
  let i = 0; const rows = [];
  for (const [u, [g, ts]] of Object.entries(units)) for (const [t, cts] of Object.entries(ts)) for (const ct of cts)
    rows.push([wells[i++], u, t, typeof ct === "number" ? +(ct + (shift[t] || 0)).toFixed(6) : ct, g]);
  return rows;
}

// Hand-worked ΔΔCt example (Livak & Schmittgen 2001). Technical replicate means:
//            GAPDH  IL6   ΔCt
//   c1       18.1   25.1  7.0      control mean ΔCt = 7.0667
//   c2       18.2   25.4  7.2
//   c3       18.0   25.0  7.0
//   t1       18.1   23.1  5.0      ΔΔCt = −2.0667, fold 4.1888
//   t2       18.1   23.2  5.1
//   t3       18.2   23.0  4.8      treated mean ΔΔCt = −2.1, fold 2^2.1 = 4.2871
const HAND = {
  c1: ["control", { GAPDH: [18.0, 18.2], IL6: [25.0, 25.2, "Undetermined"] }],
  c2: ["control", { GAPDH: [18.3, 18.1], IL6: [25.5, 25.3] }],
  c3: ["control", { GAPDH: [17.9, 18.1], IL6: [24.9, 25.1] }],
  t1: ["treated", { GAPDH: [18.1, 18.1], IL6: [23.0, 23.2] }],
  t2: ["treated", { GAPDH: [18.0, 18.2], IL6: [23.3, 23.1] }],
  t3: ["treated", { GAPDH: [18.2, 18.2], IL6: [22.9, 23.1, 30.0] }],
};
function handRun() {
  const rows = plate(HAND).map(r => [...r, r[1] === "t3" && r[3] === 30 ? "true" : "false"]);
  return run(rows, { head: ["Well", "Sample", "Target", "Ct", "Group", "Omit"] });
}

test("hand-worked ΔΔCt example", () => {
  const { exp, res } = handRun();
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control" });
  assert.equal(a.ok, true);
  assert.deepEqual(a.targets, ["IL6"]);
  const t = a.summary.find(r => r.group === "treated"), c = a.summary.find(r => r.group === "control");
  near(c.meanDct, 7.2 / 3 + 14 / 3, 1e-12, "control mean ΔCt"); // (7.0 + 7.2 + 7.0) / 3
  near(c.fold, 1, 1e-12, "control fold");
  near(t.meanDdct, -2.1, 1e-12, "treated ΔΔCt");
  near(t.fold, 2 ** 2.1, 1e-12, "treated fold");
  near(a.rows.find(r => r.unit === "t1").fold, 2 ** (7.2 / 3 + 14 / 3 - 5.0), 1e-12, "t1 fold");
  assert.equal(t.n, 3); assert.equal(c.n, 3);
  near(t.p, 7.639527920843574e-05, 1e-10, "Welch p (SciPy ttest_ind equal_var=False)");
  near(t.pBH, t.p, 1e-15, "one comparison: BH = raw"); near(t.pBonferroni, t.p, 1e-15, "one comparison: Bonferroni = raw");
  // SD error bars: 2^−(mean ΔΔCt ± SD of ΔCt)
  near(t.foldLow, 2 ** -(-2.1 + t.sdDct), 1e-12, "fold low"); near(t.foldHigh, 2 ** -(-2.1 - t.sdDct), 1e-12, "fold high");
  // the Omit well (Ct 30) and the Undetermined well are left out, and both are reported
  assert.equal(a.rows.find(r => r.unit === "t3").tech.length, 2);
  assert.ok(a.warnings.some(w => /marked Omit/.test(w)));
  assert.ok(a.warnings.some(w => /no Ct\/Cq/.test(w) && /isn't expressed/.test(w)));
  // with Omit wells kept, t3 includes Ct 30 and its fold drops
  const kept = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control", skipOmitted: false });
  assert.equal(kept.rows.find(r => r.unit === "t3").tech.length, 3);
  // wells left out by hand
  const manual = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control", excluded: ["a3"] }); // c1's first IL6 well
  assert.ok(manual.warnings.some(w => /chose to exclude: A3/.test(w)));
  assert.equal(manual.rows.find(r => r.unit === "c1").tech.length, 1);
  assert.match(a.method, /Livak & Schmittgen 2001/);
  const csv = A.resultsCsv(a);
  assert.match(csv, /^target,group,is_control/);
  assert.match(csv, /IL6,treated,no,3,/);
});

test("efficiency-corrected fold change equals the Pfaffl (2001) ratio", () => {
  // Standard curves with slope −3.6 for IL6 (E = 10^(1/3.6) = 1.8957) and −3.32 for GAPDH (E = 2.0003).
  const std = [];
  let i = 40;
  for (const [t, slope, b] of [["IL6", -3.6, 38], ["GAPDH", -3.32, 33]]) for (const q of [1e5, 1e4, 1e3, 1e2, 1e1])
    std.push([wells[i++], "", t, +(b + slope * Math.log10(q)).toFixed(6), "", "Standard", String(q)]);
  const rows = [...plate(HAND).filter(r => r[3] !== 30).map(r => [...r, "Unknown", ""]), ...std];
  const { exp, res } = run(rows, { head: ["Well", "Sample", "Target", "Ct", "Group", "Task", "Quantity"] });
  assert.equal(res.stdCurves.length, 2);
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control", efficiency: true });
  const Et = 10 ** (1 / 3.6), Er = 10 ** (1 / 3.32);
  near(a.efficiency.IL6.E, Et, 1e-9, "IL6 efficiency"); near(a.efficiency.GAPDH.E, Er, 1e-9, "GAPDH efficiency");
  // Pfaffl: ratio = E_target^(ΔCt target, control − sample) / E_ref^(ΔCt ref, control − sample), using group mean Cts.
  const m = (u, t) => HAND[u][1][t].filter(x => typeof x === "number" && x !== 30).reduce((s, x, _, arr) => s + x / arr.length, 0);
  const grp = (us, t) => us.reduce((s, u) => s + m(u, t), 0) / us.length;
  const ctrl = ["c1", "c2", "c3"], trt = ["t1", "t2", "t3"];
  const pfaffl = Et ** (grp(ctrl, "IL6") - grp(trt, "IL6")) / Er ** (grp(ctrl, "GAPDH") - grp(trt, "GAPDH"));
  near(a.summary.find(r => r.group === "treated").fold, pfaffl, 1e-9, "Pfaffl ratio");
  // differs from the uncorrected ΔΔCt result, which assumes E = 2 for both
  assert.ok(Math.abs(pfaffl - 2 ** 2.1) > 0.1);
  assert.match(a.method, /Pfaffl 2001/);
});

test("efficiency correction without a standard curve assumes 100% and says so", () => {
  const { exp, res } = handRun();
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control", efficiency: true });
  assert.ok(a.warnings.some(w => /no standard curve/.test(w) && /100%/.test(w)));
  near(a.summary.find(r => r.group === "treated").fold, 2 ** 2.1, 1e-12, "same as plain ΔΔCt");
});

test("never picks reference genes or the control group by itself", () => {
  const { exp, res } = handRun();
  for (const s of [undefined, null, {}, { on: true }, { on: true, control: "control" }, { on: true, refs: [] }]) {
    const a = A.analyzeRun(exp, res, s);
    assert.equal(a.ok, false);
    assert.deepEqual(a.refs, []);
    assert.equal(a.summary.length, 0);
    assert.equal(a.rows.length, 0);
    assert.ok(a.needs.includes("refs"));
  }
  assert.ok(A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"] }).needs.includes("control"));
  // suggestions are names only
  assert.deepEqual(A.suggestReferences(["IL6", "GAPDH", "ACTB", "b-actin", "RN18S1", "18S", "U6", "RNU48", "hsa-miR-21", "TP53", "HPRT1", "TBP", "B2M"]),
    ["GAPDH", "ACTB", "b-actin", "RN18S1", "18S", "U6", "RNU48", "HPRT1", "TBP", "B2M"]);
  assert.equal(exp.analysis, null, "analyzing doesn't write settings onto the run");
});

test("warns when a group has fewer than 3 biological replicates", () => {
  const units = { c1: HAND.c1, c2: HAND.c2, t1: HAND.t1, t2: HAND.t2, t3: HAND.t3, x1: ["solo", { GAPDH: [18.0], IL6: [24.0] }] };
  const { exp, res } = run(plate(units));
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control" });
  const w = a.warnings.find(x => /Fewer than 3 biological replicates/.test(x));
  assert.ok(w, a.warnings.join("\n"));
  assert.match(w, /control \/ IL6 \(n = 2\)/);
  assert.match(w, /solo \/ IL6 \(n = 1\)/);
  assert.doesNotMatch(w, /treated/);
  const solo = a.summary.find(r => r.group === "solo");
  assert.equal(solo.p, null, "n = 1 gets no p value");
  assert.ok(a.summary.find(r => r.group === "treated").p > 0);
  // three groups: ANOVA is run, and corrections cover both comparisons
  assert.equal(a.anova.length, 1);
  assert.equal(a.anova[0].groups, 3);
});

test("BH and Bonferroni are applied across every target and group", () => {
  const ts = ["G1", "G2", "G3"], units = {};
  const d = { c: [0, 0.2, -0.1], a: [1.5, 1.2, 1.9], b: [0.3, -0.2, 0.6] };
  for (const [g, key] of [["control", "c"], ["drugA", "a"], ["drugB", "b"]]) d[key].forEach((x, i) => {
    units[`${key}${i}`] = [g, { GAPDH: [18 + i * 0.1], ...Object.fromEntries(ts.map((t, k) => [t, [24 + k + x * (k + 1) + i * 0.1]])) }];
  });
  const { exp, res } = run(plate(units));
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control", correction: "bonferroni" });
  const comps = a.summary.filter(r => !r.isControl);
  assert.equal(comps.length, 6);
  assert.equal(a.comparisons, 6);
  for (const r of comps) { near(r.pBonferroni, Math.min(1, r.p * 6), 1e-12, "Bonferroni"); assert.equal(r.pAdj, r.pBonferroni); }
  const sorted = [...comps].sort((x, y) => x.p - y.p);
  near(sorted[0].pBH, Math.min(...sorted.map((r, i) => Math.min(1, (r.p * 6) / (i + 1)))), 1e-12, "BH smallest");
  assert.equal(a.anova.length, 3);
});

test("reference stability check flags a reference that shifts between groups", () => {
  const units = JSON.parse(JSON.stringify(HAND));
  for (const u of ["t1", "t2", "t3"]) units[u][1].GAPDH = units[u][1].GAPDH.map(x => x + 1.2);
  const { exp, res } = run(plate(units).filter(r => r[3] !== 30));
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control" });
  const r = a.refStability[0];
  assert.equal(r.flagged, true);
  near(r.range, 1.2 + 0.1 / 3, 1e-9, "range"); // group means 18.1 and 18.1333 + 1.2
  assert.ok(a.warnings.some(w => /Reference GAPDH may not be stable/.test(w)));
  const ok = A.analyzeRun(handRun().exp, handRun().res, { on: true, refs: ["GAPDH"], control: "control" });
  assert.equal(ok.refStability[0].flagged, false);
  // a higher threshold doesn't hide a significant shift
  const loose = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control", refMaxShift: 5 });
  assert.equal(loose.refStability[0].flagged, loose.refStability[0].p < 0.05);
});

test("two reference genes: ΔCt uses the mean of their Ct values", () => {
  const units = JSON.parse(JSON.stringify(HAND));
  for (const [u, v] of Object.entries(units)) v[1].ACTB = v[1].GAPDH.map(x => x + 2 + (u === "t1" ? 0.4 : 0));
  const { exp, res } = run(plate(units).filter(r => r[3] !== 30));
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH", "ACTB"], control: "control" });
  const t1 = a.rows.find(r => r.unit === "t1");
  near(t1.refCt, (18.1 + 20.5) / 2, 1e-12, "mean of reference Cts");
  near(t1.dct, 23.1 - 19.3, 1e-12, "ΔCt");
  assert.match(a.method, /geometric mean of their quantities/);
});

// Two plates. On plate B every IL6 Ct reads 1.0 cycle later and GAPDH 0.3 later (for example a different threshold).
// The calibrator IRC (no group) is on both plates. After calibration the result must equal the one plate holding everything.
test("multi-plate study: inter-run calibration removes a per-gene plate shift", () => {
  const irc = { IRC: [null, { GAPDH: [17.5, 17.6], IL6: [26.0, 26.2] }] };
  const A1 = { c1: HAND.c1, c2: HAND.c2, t1: HAND.t1, ...irc }, B1 = { c3: HAND.c3, t2: HAND.t2, t3: HAND.t3, ...irc };
  const strip = rows => rows.filter(r => !(r[3] >= 30)).map(r => (r[4] == null ? [...r.slice(0, 4), ""] : r));
  const pa = run(strip(plate(A1)), { title: "Plate A" }), pb = run(strip(plate(B1, { shift: { IL6: 1.0, GAPDH: 0.3 } })), { title: "Plate B" });
  const truth = A.analyzeRun(handRun().exp, handRun().res, { on: true, refs: ["GAPDH"], control: "control" });
  const settings = { on: true, refs: ["GAPDH"], control: "control" };
  const study = A.analyzeStudy([pa, pb], { settings, mode: "calibrator", calibrators: ["IRC"] });
  assert.equal(study.ok, true, study.needs.join());
  assert.equal(study.calibration.mode, "calibrator");
  assert.deepEqual(study.calibration.unconnected, []);
  const off = study.calibration.offsets.find(o => o.plate === "Plate B" && o.target === "IL6");
  near(off.shift, 0.5, 1e-9, "plate B IL6 shift (half of 1.0, centred)");
  for (const g of ["control", "treated"]) {
    const s = study.summary.find(r => r.group === g), t = truth.summary.find(r => r.group === g);
    near(s.meanDdct, t.meanDdct, 1e-9, `${g} ΔΔCt`); near(s.sdDct, t.sdDct, 1e-9, `${g} SD`); near(s.fold, t.fold, 1e-9, `${g} fold`);
  }
  near(study.summary.find(r => r.group === "treated").p, truth.summary.find(r => r.group === "treated").p, 1e-9, "p");
  assert.equal(study.summary.some(r => r.group === null), false, "the calibrator isn't a group");
  assert.match(study.method, /inter-run calibration on IRC/);
  // Without correction the shift leaks into the result
  const raw = A.analyzeStudy([pa, pb], { settings, mode: "none" });
  assert.ok(Math.abs(raw.summary.find(r => r.group === "treated").meanDdct - (-2.1)) > 0.05);
  assert.ok(raw.warnings.some(w => /without any correction/.test(w)));
  // Plate-wise centring is offered with a warning
  const cen = A.analyzeStudy([pa, pb], { settings, mode: "centre" });
  assert.ok(cen.warnings.some(w => /Plate-wise centring/.test(w) && /similar mix of groups/.test(w)));
  // Shared units are offered as calibrators
  assert.deepEqual(A.sharedUnits([pa, pb]).map(u => u.unit), ["IRC"]);
});

test("multi-plate study: a plate without the calibrator is flagged as not connected", () => {
  const irc = { IRC: [null, { GAPDH: [17.5], IL6: [26.0] }] };
  const fix = rows => rows.map(r => (r[4] == null ? [...r.slice(0, 4), ""] : r));
  const pa = run(fix(plate({ c1: HAND.c2, t1: HAND.t1, ...irc })), { title: "A" });
  const pb = run(fix(plate({ c2: HAND.c3, t2: HAND.t2, ...irc })), { title: "B" });
  const pc = run(fix(plate({ c3: HAND.c2, t3: HAND.t1 })), { title: "C" });
  const s = A.analyzeStudy([pa, pb, pc], { settings: { on: true, refs: ["GAPDH"], control: "control" }, mode: "calibrator", calibrators: ["IRC"] });
  assert.deepEqual(s.calibration.unconnected, ["C"]);
  assert.ok(s.warnings.some(w => /Not connected by a calibrator: C/.test(w)));
  assert.ok(s.warnings.some(w => /IL6: no calibrator was measured on every plate/.test(w)));
  const none = A.analyzeStudy([pa, pb], { settings: { on: true, refs: ["GAPDH"], control: "control" }, mode: "calibrator", calibrators: [] });
  assert.equal(none.calibration.mode, "none");
});

test("saved analysis settings survive normalizeExperiment and a packet round trip", async () => {
  const { exp, res } = handRun();
  exp.source.sha256 = await C.sha256(exp.source.text);
  exp.analysis = { on: true, refs: ["GAPDH", "GAPDH", 5, ""], control: "control", efficiency: true, error: "sem", correction: "bonferroni", skipOmitted: false,
    excluded: ["A1", null], scale: "linear", refMaxShift: 0.8, test: "dunnett", junk: "<script>" };
  C.normalizeExperiment(exp);
  assert.deepEqual(exp.analysis, { on: true, refs: ["GAPDH"], control: "control", efficiency: true, error: "sem", correction: "bonferroni", skipOmitted: false,
    excluded: ["A1"], scale: "linear", refMaxShift: 0.8, test: "dunnett" });
  const again = await C.verifyPacket(JSON.parse(R.packetJson(exp, res)));
  assert.deepEqual(again.analysis, exp.analysis);
  for (const junk of [null, 5, "x", [], { on: "yes", refs: "GAPDH", error: "var", correction: "holm", refMaxShift: -1, test: "anova; drop table" }]) {
    const e = C.normalizeExperiment({ ...structuredClone(exp), analysis: junk });
    if (junk && typeof junk === "object" && !Array.isArray(junk)) assert.deepEqual(e.analysis, { ...A.DEFAULT_SETTINGS }, JSON.stringify(junk));
    else assert.equal(e.analysis, null);
    A.analyzeRun(e, C.analyze(e)); // never throws
  }
});

test("the report gets an Analysis section only when the analysis is on", () => {
  const { exp, res } = handRun();
  assert.doesNotMatch(R.reportHtml(exp, res), /<h2>Analysis<\/h2>/);
  exp.analysis = C.cleanAnalysisSettings({ on: true });
  assert.match(R.reportHtml(exp, res), /no reference gene and no control group has been chosen/);
  exp.analysis = C.cleanAnalysisSettings({ on: true, refs: ["GAPDH"], control: "control" });
  const html = R.reportHtml(exp, res);
  assert.match(html, /<h2>Analysis<\/h2>/);
  assert.match(html, /Reference gene: GAPDH/);
  assert.match(html, /Welch/);
  assert.match(html, /Benjamini–Hochberg and Bonferroni/);
  assert.match(html, /<td>IL6<\/td><td>treated<\/td><td>3<\/td><td>4\.29<\/td>/);
});

test("studies are stored like runs and repaired when damaged", async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
    key: i => [...mem.keys()][i], get length() { return mem.size; } };
  const S = await import("../web/store.js");
  const s = S.saveStudy({ title: "Liver panel", runs: ["AL-1", "AL-2", "AL-2", 7], mode: "centre", calibrators: ["IRC"], settings: { on: true, refs: ["GAPDH"] } });
  assert.ok(mem.has("assaylint.v1.study." + s.id));
  assert.deepEqual(S.studies().map(x => [x.title, x.runs]), [["Liver panel", 2]]);
  const back = S.loadStudy(s.id);
  assert.deepEqual(back.runs, ["AL-1", "AL-2"]);
  assert.equal(back.mode, "centre");
  assert.deepEqual(back.settings.refs, ["GAPDH"]);
  mem.set("assaylint.v1.study." + s.id, "{broken");
  assert.equal(S.loadStudy(s.id), null);
  mem.set("assaylint.v1.studies", "[null, 5, {\"id\": 3}, {\"id\": \"x\", \"runs\": \"many\"}]");
  assert.deepEqual(S.studies(), [{ id: "x", title: "Untitled study", updated: "", runs: 0 }]);
  assert.equal(S.normalizeStudy({ mode: "magic", settings: 5 }).mode, "calibrator");
  S.removeStudy("x");
  assert.deepEqual(S.studies(), []);
  delete globalThis.localStorage;
});

test("PNG export carries 300 dpi", () => {
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length); b.set([...type].map(c => c.charCodeAt(0)), 4); b.set(data, 8);
    dv.setUint32(8 + data.length, crc32(b.subarray(4, 8 + data.length))); return b;
  };
  const ihdr = new Uint8Array(13); new DataView(ihdr.buffer).setUint32(0, 1); new DataView(ihdr.buffer).setUint32(4, 1); ihdr[8] = 8; ihdr[9] = 2;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("pHYs", new Uint8Array(9)), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { png.set(p, o); o += p.length; }
  const out = pngWithDpi(png, 300), dv = new DataView(out.buffer);
  const at = 33; // straight after IHDR
  assert.equal(String.fromCharCode(...out.subarray(at + 4, at + 8)), "pHYs");
  assert.equal(dv.getUint32(at + 8), 11811); // 300 / 0.0254 pixels per metre
  assert.equal(out[at + 16], 1);
  assert.equal(dv.getUint32(at + 17), crc32(out.subarray(at + 4, at + 17)));
  assert.equal(out.length, png.length, "the old pHYs chunk was replaced, not duplicated");
  assert.equal(pngWithDpi(new Uint8Array([1, 2, 3]), 300).length, 3, "not a PNG: left alone");
});

// ---------------------------------------------------------------- the test choice
// Three groups, one target, each value worked out by hand so the analysis can be compared with web/stats.js directly.
const THREE = {
  c1: ["control", { GAPDH: [18.0], IL6: [25.0] }], c2: ["control", { GAPDH: [18.2], IL6: [25.4] }], c3: ["control", { GAPDH: [18.1], IL6: [25.0] }],
  a1: ["drugA", { GAPDH: [18.1], IL6: [23.1] }], a2: ["drugA", { GAPDH: [18.0], IL6: [23.3] }], a3: ["drugA", { GAPDH: [18.2], IL6: [22.9] }],
  b1: ["drugB", { GAPDH: [18.0], IL6: [24.6] }], b2: ["drugB", { GAPDH: [18.1], IL6: [25.2] }], b3: ["drugB", { GAPDH: [18.2], IL6: [24.9] }],
};
const dctOf = (u, k) => THREE[u][1].IL6[0] - THREE[u][1].GAPDH[0];
const groupDct = p => ["1", "2", "3"].map(i => dctOf(p + i));
const threeRun = (extraHead = [], extra = () => []) => {
  const rows = plate(THREE).map(r => [...r, ...extra(r)]);
  return run(rows, { head: ["Well", "Sample", "Target", "Ct", "Group", ...extraHead] });
};
const setFor = test => ({ on: true, refs: ["GAPDH"], control: "control", test });

test("the default test is still Welch, and the settings say so", () => {
  const { exp, res } = threeRun();
  const a = A.analyzeRun(exp, res, { on: true, refs: ["GAPDH"], control: "control" });
  assert.equal(a.settings.test, "welch");
  const r = a.summary.find(x => x.group === "drugA");
  near(r.p, S.welch(groupDct("a"), groupDct("c")).p, 1e-12, "Welch p");
  assert.equal(r.test, "Welch t-test"); assert.equal(r.statName, "t");
  assert.match(a.method, /Welch's t-test/);
});

test("Student, Tukey, Dunnett, Mann–Whitney and Kruskal–Wallis + Dunn give the stats.js values", () => {
  const { exp, res } = threeRun();
  const c = groupDct("c"), da = groupDct("a"), db = groupDct("b");
  const st = A.analyzeRun(exp, res, setFor("student"));
  near(st.summary.find(x => x.group === "drugA").p, S.student(da, c).p, 1e-12, "Student");
  assert.match(st.method, /Student's t-test/);

  const tk = A.analyzeRun(exp, res, setFor("tukey")), ref = S.tukeyHsd([c, da, db]);
  near(tk.summary.find(x => x.group === "drugA").p, ref.pairs.find(p => p.i === 0 && p.j === 1).p, 1e-12, "Tukey vs control");
  assert.equal(tk.pairwise.length, 3, "all three pairs are listed");
  assert.ok(tk.pairwise.some(p => p.a === "drugA" && p.b === "drugB"));
  const vsC = tk.pairwise.find(p => p.a === "drugA" && p.b === "control");
  near(vsC.fold, tk.summary.find(x => x.group === "drugA").fold, 1e-12, "a pair with the control is listed as group vs control");
  assert.equal(tk.anova.length, 1, "ANOVA is shown with Tukey");
  // one target: no second correction on top of Tukey's own
  for (const r of tk.summary.filter(x => !x.isControl)) { assert.equal(r.pBH, r.p); assert.equal(r.pBonferroni, r.p); assert.equal(r.pAdj, r.p); }
  assert.match(tk.method, /Tukey 1949/); assert.match(tk.method, /nothing more to adjust/);
  assert.match(A.resultsCsv(tk), /tukey_q/);

  const dn = A.analyzeRun(exp, res, setFor("dunnett")), dref = S.dunnett([c, da, db], 0);
  near(dn.summary.find(x => x.group === "drugB").p, dref.comparisons[1].p, 1e-12, "Dunnett");
  assert.match(dn.method, /Dunnett 1955/);

  const mw = A.analyzeRun(exp, res, setFor("mannwhitney"));
  const rA = mw.summary.find(x => x.group === "drugA");
  near(rA.p, S.mannWhitney(da, c).p, 1e-12, "Mann–Whitney");
  near(rA.p, 0.1, 1e-12, "3 vs 3, complete separation: the smallest p possible");
  assert.ok(mw.warnings.some(w => /can't give a p value below 0\.100/.test(w)), mw.warnings.join("\n"));
  assert.equal(mw.anova.length, 0); assert.equal(mw.kruskal.length, 1, "rank tests get Kruskal–Wallis, not ANOVA");

  const kw = A.analyzeRun(exp, res, { ...setFor("kruskal"), correction: "bonferroni" }), dref2 = S.dunn([c, da, db], [[1, 0], [2, 0]]);
  near(kw.summary.find(x => x.group === "drugA").p, dref2.comparisons[0].pBonferroni, 1e-12, "Dunn, Bonferroni within the target");
  near(kw.summary.find(x => x.group === "drugA").pRaw, dref2.comparisons[0].p, 1e-12, "Dunn raw");
  near(kw.kruskal[0].p, S.kruskal([c, da, db]).p, 1e-12, "Kruskal–Wallis");
  assert.match(kw.method, /Dunn 1964/);
});

test("Tukey and Dunnett are corrected only across targets, separately for each comparison", () => {
  const ts = ["G1", "G2", "G3"], units = {};
  const d = { c: [0, 0.2, -0.1], a: [1.5, 1.2, 1.9], b: [0.3, -0.2, 0.6] };
  for (const [g, key] of [["control", "c"], ["drugA", "a"], ["drugB", "b"]]) d[key].forEach((x, i) => {
    units[`${key}${i}`] = [g, { GAPDH: [18 + i * 0.1], ...Object.fromEntries(ts.map((t, k) => [t, [24 + k + x * (k + 1) + i * 0.1]])) }];
  });
  const { exp, res } = run(plate(units));
  const a = A.analyzeRun(exp, res, { ...setFor("dunnett"), correction: "bonferroni" });
  for (const g of ["drugA", "drugB"]) {
    const rows = a.summary.filter(r => r.group === g);
    assert.equal(rows.length, 3);
    for (const r of rows) near(r.pBonferroni, Math.min(1, r.p * 3), 1e-12, `${g} Bonferroni over 3 targets, not 6 comparisons`);
  }
  assert.match(a.method, /only across the 3 targets/);
});

test("paired t-test matches units by their pair label and refuses without one", () => {
  const pairOf = r => [{ c1: "m1", a1: "m1", c2: "m2", a2: "m2", c3: "m3", a3: "m3", b1: "m1", b2: "m2" }[r[1]] || ""];
  const { exp, res } = threeRun(["Pair"], pairOf);
  assert.equal(res.rows.find(r => r.sample === "a2").pair, "m2", "the Pair column is read from the file");
  const a = A.analyzeRun(exp, res, setFor("paired"));
  const rA = a.summary.find(x => x.group === "drugA");
  near(rA.p, S.paired(groupDct("a"), groupDct("c")).p, 1e-12, "paired p");
  assert.equal(rA.pairs, 3); assert.equal(rA.df, 2);
  const rB = a.summary.find(x => x.group === "drugB");
  assert.equal(rB.pairs, 2, "b3 has no pair label");
  near(rB.p, S.paired([dctOf("b1"), dctOf("b2")], [dctOf("c1"), dctOf("c2")]).p, 1e-12, "drugB paired over two pairs");
  assert.ok(a.warnings.some(w => /Left out of the paired test/.test(w) && /b3/.test(w)), a.warnings.join("\n"));
  assert.match(a.method, /paired t-test/);
  // no pair labels at all: no p values and a clear message
  const plain = threeRun();
  const none = A.analyzeRun(plain.exp, plain.res, setFor("paired"));
  assert.ok(none.summary.filter(r => !r.isControl).every(r => r.p === null && r.testNote === "no pair labels"));
  assert.ok(none.warnings.some(w => /needs a pair label/.test(w) && /Plate step/.test(w)));
  // a label used twice in one group can't be paired
  const dup = threeRun(["Pair"], r => [{ c1: "m1", c2: "m1", c3: "m3", a1: "m1", a3: "m3" }[r[1]] || ""]);
  const ad = A.analyzeRun(dup.exp, dup.res, setFor("paired"));
  assert.ok(ad.warnings.some(w => /used by more than one unit in the same group/.test(w) && /m1 \(control\)/.test(w)), ad.warnings.join("\n"));
  assert.equal(ad.summary.find(x => x.group === "drugA").pairs, 1);
  assert.equal(ad.summary.find(x => x.group === "drugA").p, null, "one pair: no p");
  // the pair label set on the Plate step is kept with the run
  plain.exp.map[plain.res.rows[0].id] = { pair: "m9" };
  C.normalizeExperiment(plain.exp);
  assert.equal(plain.exp.map[plain.res.rows[0].id].pair, "m9");
  assert.equal(C.analyze(plain.exp).rows[0].pair, "m9");
  assert.match(C.mapTemplateCsv(C.analyze(plain.exp).rows), /^well,sample,target,group,role,bio_unit,quantity,pair/);
  assert.doesNotMatch(C.mapTemplateCsv(plain.res.rows), /pair/, "no pair column when no pair label is used");
});

test("the report names the test", () => {
  const { exp, res } = threeRun();
  exp.analysis = C.cleanAnalysisSettings(setFor("dunnett"));
  const html = R.reportHtml(exp, res);
  assert.match(html, /<th>Dunnett p<\/th>/);
  assert.match(html, /Test: Dunnett/);
  exp.analysis = C.cleanAnalysisSettings(setFor("tukey"));
  assert.match(R.reportHtml(exp, res), /Tukey HSD, every pair of groups/);
});

// ---------------------------------------------------------------- Wilcoxon, Games–Howell, two-way ANOVA, CIs, paired fold change
const PAIRS = { c1: "m1", a1: "m1", c2: "m2", a2: "m2", c3: "m3", a3: "m3", b1: "m1", b2: "m2", b3: "m3" };
test("Wilcoxon signed-rank uses the pair labels like the paired t-test", () => {
  const { exp, res } = threeRun(["Pair"], r => [PAIRS[r[1]] || ""]);
  const a = A.analyzeRun(exp, res, setFor("wilcoxon"));
  const rA = a.summary.find(x => x.group === "drugA");
  near(rA.p, S.wilcoxon(groupDct("a"), groupDct("c")).p, 1e-12, "Wilcoxon p");
  assert.equal(rA.statName, "W"); assert.equal(rA.pairs, 3);
  near(rA.p, 0.25, 1e-12, "3 pairs, all the same sign: the smallest p possible");
  assert.ok(a.warnings.some(w => /Wilcoxon signed-rank test can't give a p value below 0\.250/.test(w)), a.warnings.join("\n"));
  assert.match(a.method, /Wilcoxon 1945/);
  assert.equal(a.kruskal.length, 1, "a rank test gets Kruskal–Wallis alongside");
  const plain = threeRun();
  const none = A.analyzeRun(plain.exp, plain.res, setFor("wilcoxon"));
  assert.ok(none.warnings.some(w => /Wilcoxon signed-rank test needs a pair label/.test(w)));
  assert.equal(C.cleanAnalysisSettings(setFor("wilcoxon")).test, "wilcoxon");
});

test("Welch ANOVA + Games–Howell gives the stats.js values and lists every pair", () => {
  const { exp, res } = threeRun();
  const c = groupDct("c"), da = groupDct("a"), db = groupDct("b");
  const a = A.analyzeRun(exp, res, setFor("gameshowell")), ref = S.gamesHowell([c, da, db]);
  near(a.summary.find(x => x.group === "drugA").p, ref.pairs.find(p => p.i === 0 && p.j === 1).p, 1e-12, "Games–Howell vs control");
  assert.equal(a.pairwise.length, 3);
  assert.equal(a.anova[0].welch, true);
  near(a.anova[0].p, S.welchAnova([c, da, db]).p, 1e-12, "Welch ANOVA");
  assert.match(a.method, /Games & Howell 1976/); assert.match(a.method, /Welch 1951/);
  assert.match(A.resultsCsv(a), /games_howell_q/);
  exp.analysis = C.cleanAnalysisSettings(setFor("gameshowell"));
  assert.match(R.reportHtml(exp, res), /Games–Howell, every pair of groups/);
});

test("95% confidence intervals: group mean (t, n − 1 df) and difference from the control (Welch), back-transformed", () => {
  const { exp, res } = threeRun();
  const c = groupDct("c"), da = groupDct("a"), cm = S.mean(c);
  const a = A.analyzeRun(exp, res, setFor("welch")), r = a.summary.find(x => x.group === "drugA");
  const t = S.tQuantile(0.975, 2), h = t * S.sd(da) / Math.sqrt(3);
  near(t, 4.302652729749462, 1e-12, "t(0.975, 2) from scipy.stats.t.ppf");
  near(r.foldCiLow, 2 ** -(S.mean(da) + h - cm), 1e-12, "group CI low"); near(r.foldCiHigh, 2 ** -(S.mean(da) - h - cm), 1e-12, "group CI high");
  const w = S.welch(da, c), hw = S.tQuantile(0.975, w.df) * Math.sqrt(S.variance(da) / 3 + S.variance(c) / 3);
  near(r.foldDiffCiLow, 2 ** -(w.diff + hw), 1e-12, "difference CI low"); near(r.foldDiffCiHigh, 2 ** -(w.diff - hw), 1e-12, "difference CI high");
  assert.ok(r.foldDiffCiLow < r.fold && r.fold < r.foldDiffCiHigh);
  near(r.foldLow, 2 ** -(r.meanDdct + S.sd(da)), 1e-12, "default error bars are still SD");
  const ci = A.analyzeRun(exp, res, { ...setFor("welch"), error: "ci" }), rc = ci.summary.find(x => x.group === "drugA");
  near(rc.foldLow, r.foldCiLow, 1e-15, "CI error bars"); near(rc.p, r.p, 1e-15, "the test doesn't change");
  assert.match(A.resultsCsv(a), /fold_ci95_low,fold_ci95_high,fold_vs_control_ci95_low/);
  assert.equal(C.cleanAnalysisSettings({ error: "ci" }).error, "ci");
  assert.equal(C.cleanAnalysisSettings({ error: "iqr" }).error, "sd");
  exp.analysis = C.cleanAnalysisSettings({ ...setFor("welch"), error: "ci" });
  assert.match(R.reportHtml(exp, res), /95% CI vs control \(Welch\)/);
});
