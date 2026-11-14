// Lab-like simulated runs (testdata/lab-like, made by simulate.py: Poisson sampling, pipetting CV, per-assay efficiency,
// biological variation, real QuantStudio and CFX layouts). expected.json holds numbers that matched an independent
// pandas/scipy analysis (independent.py) to every printed digit when this test was written.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import * as AS from "../web/assays.js";
const dir = new URL("../testdata/lab-like/", import.meta.url);
const read = n => C.decodeBytes(readFileSync(new URL(n, dir))).text;
const expd = JSON.parse(readFileSync(new URL("expected.json", dir), "utf8"));
const mk = (text, extra = {}) => { const e = C.newExperiment({ title: "lab-like" }, "qa"); e.source = C.fileRecord({ name: "x", text, sha: "x", actor: "qa", format: C.parseResults(text).format });
  if (extra.amp) e.amp = C.fileRecord({ name: "a", text: extra.amp, sha: "x", actor: "qa" });
  if (extra.melt) { e.melt = C.fileRecord({ name: "m", text: extra.melt, sha: "x", actor: "qa", valueType: "derivative" }); e.ruleset.values.meltChecks = true; }
  return e; };
const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test("E1 QuantStudio LPS: curve files with a comma in a note line are read, and every planted problem is flagged", () => {
  const e = mk(read("E1 QuantStudio5 LPS SYBR - results.txt"), { amp: read("E1 QuantStudio5 LPS SYBR - amplification.txt"), melt: read("E1 QuantStudio5 LPS SYBR - melt derivative.txt") });
  const res = C.analyze(e), at = rule => res.findings.filter(f => f.rule === rule).flatMap(f => f.wells);
  assert.deepEqual(at("melt_multiple_peaks").sort(), ["C7", "C8"]);
  assert.deepEqual(at("replicate_dispersion"), ["F9", "F10"]);
  assert.deepEqual(at("ntc_amplification"), ["H11"]); assert.deepEqual(at("ntc_melt_peak"), ["H11"]);
  assert.deepEqual(at("nrt_amplification"), ["H12"]);
  e.analysis = C.cleanAnalysisSettings({ on: true, refs: ["GAPDH", "ACTB", "HPRT1"], control: "control" });
  const a = A.analyzeRun(e, res);
  for (const x of expd.E1) { const s = a.summary.find(r => r.target === x.target && r.group === "LPS"); assert.equal(s.n, x.n); close(s.fold, x.fold); close(s.p, x.p); }
});
test("E1b standard curves", () => {
  const res = C.analyze(mk(read("E1b QuantStudio5 standard curves - results.txt")));
  for (const x of expd.E1b) close(res.stdCurves.find(c => c.target === x.target).efficiency, x.eff);
});
test("E2 two CFX plates with an inter-run calibrator", () => {
  const runs = ["E2 CFX96 siMYC P1 - Quantification Cq Results.csv", "E2 CFX96 siMYC P2 - Quantification Cq Results.csv"].map(n => { const e = mk(read(n)); return { exp: e, res: C.analyze(e) }; });
  const a = A.analyzeStudy(runs, { settings: { on: true, refs: ["RPLP0", "B2M"], control: "siCtrl" }, mode: "calibrator", calibrators: ["IRC"] });
  for (const x of expd.E2) { const s = a.summary.find(r => r.target === x.target && r.group === "siMYC"); close(s.fold, x.fold); close(s.p, x.p); }
});
test("E3 ChIP plate named IP/Input/IgG: no false replicate or unit flags; WT vs KO promoter significant", () => {
  const e = mk(read("E3 CFX96 ChIP H3K27ac WT vs KO - Quantification Cq Results.csv")); const res = C.analyze(e);
  assert.ok(!res.findings.some(f => f.rule === "bio_unit_in_multiple_groups" || f.rule === "replicate_dispersion"));
  e.assaySetup = { type: "chip", params: { inputPercent: 1, negTarget: "Desert" }, wells: AS.guessLabels(res.rows, "enrichment"),
    cond: { "WT-1": "WT", "WT-2": "WT", "WT-3": "WT", "KO-1": "KO", "KO-2": "KO", "KO-3": "KO" }, stats: { control: "WT" } };
  const c = AS.runAssay(e, res.rows, { stdCurves: res.stdCurves }).replicates.comparisons;
  assert.ok(c.find(x => x.region === "MYC-promoter").pAdj < 0.05);
  assert.ok(c.find(x => x.region === "Desert").pAdj > 0.05);
});
