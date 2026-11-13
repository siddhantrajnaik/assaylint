// The checks added with the threshold work: late-Ct note, no-RT margin, Ct-dependent SD limit,
// standard-curve range, and the three RNA-type notes. Each must fire when it should and stay quiet
// otherwise, and the defaults must leave earlier results alone apart from these notes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as C from "../web/core.js";
import { demoFiles } from "../web/demo.js";

const pos = i => String.fromCharCode(65 + Math.floor(i / 12)) + ((i % 12) + 1);
// wells: [sample, target, role, ct, quantity?]
function run(wells, { values = {}, analysis, targets, controlNA } = {}) {
  const text = "well,sample,target,role,quantity,ct\n" +
    wells.map(([s, t, role, ct, q], i) => [pos(i), s, t, role, q ?? "", ct == null ? "Undetermined" : ct].join(",")).join("\n") + "\n";
  const e = C.newExperiment({}, "t");
  e.source = { name: "r.csv", text, sha256: "-" };
  Object.assign(e.ruleset.values, values);
  if (analysis) e.analysis = C.cleanAnalysisSettings(analysis);
  if (targets) e.targets = targets;
  if (controlNA) e.controlNA = controlNA;
  return C.analyze(e);
}
const reps = (s, t, cts, role = "sample") => cts.map(ct => [s, t, role, ct]);
const by = (res, rule) => res.findings.filter(f => f.rule === rule);
const ntc = t => ["NTC", t, "ntc", null];

// ------------------------------------------------------------------ late Ct
test("late Ct: one note per target for sample groups past the setting, none at or below it", () => {
  const w = [...reps("a", "IL6", [35.6, 35.9]), ...reps("b", "IL6", [36.2, 36.4]), ...reps("c", "IL6", [34.9, 35.1]),
    ...reps("a", "GAPDH", [20, 20.1]), ntc("IL6"), ntc("GAPDH")];
  const f = by(run(w), "late_ct");
  assert.equal(f.length, 1);
  assert.equal(f[0].target, "IL6");
  assert.equal(f[0].severity, "low");
  assert.match(f[0].description, /2 of 3 sample group/);
  assert.deepEqual(f[0].wells, ["A1", "A2", "A3", "A4"]);
  assert.equal(by(run(w, { values: { lateCtThreshold: 37 } }), "late_ct").length, 0);
  const off = run(w, { values: { lateCtThreshold: 0 } });
  assert.equal(by(off, "late_ct").length, 0);
  assert.ok(off.notAssessed.some(x => /late-Ct note is switched off/.test(x)));
});

test("late Ct: controls and standards are not noted", () => {
  const w = [...reps("a", "IL6", [30, 30.1]), ["POS", "IL6", "positive", 36], ["POS", "IL6", "positive", 36.1],
    ["", "IL6", "standard", 36.5, 10], ["", "IL6", "standard", 36.6, 10], ntc("IL6")];
  assert.equal(by(run(w), "late_ct").length, 0);
});

// ------------------------------------------------------------------ no-RT margin
test("no-RT margin: flagged when the no-RT trails its own sample by fewer cycles than the setting", () => {
  const w = [...reps("c1", "ACTB", [25, 25.1]), ...reps("c2", "ACTB", [20, 20.1]), ["c1 -RT", "ACTB", "nrt", 28], ntc("ACTB")];
  const res = run(w);
  assert.equal(by(res, "nrt_amplification").length, 1, "the existing no-RT flag is unchanged");
  const f = by(res, "nrt_margin");
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "medium");
  assert.deepEqual(f[0].wells, ["A5", "A1", "A2"]); // the no-RT well, then the sample it was matched to by name
  assert.match(f[0].description, /2\.9 cycles after its sample c1/);
  assert.match(f[0].evidence, /matched by name/);
});

test("no-RT margin: quiet with enough distance, when switched off, or when the no-RT did not amplify", () => {
  const base = [...reps("c1", "ACTB", [25, 25.1]), ntc("ACTB")];
  for (const [nrt, values] of [[31, {}], [28, { nrtMargin: 0 }], [28, { nrtMargin: 2.5 }], [null, {}]]) {
    const res = run([...base, ["c1 -RT", "ACTB", "nrt", nrt]], { values });
    assert.equal(by(res, "nrt_margin").length, 0, `${nrt} ${JSON.stringify(values)}`);
    assert.equal(by(res, "nrt_amplification").length, nrt == null ? 0 : 1);
  }
});

test("no-RT margin: names are matched in common spellings, otherwise all samples of the target are used", () => {
  for (const name of ["c1 -RT", "c1 RT-", "c1_noRT", "NRT c1", "c1 no-RT control", "c1 minus RT"]) assert.equal(C.nrtBaseName(name), "c1", name);
  const w = [...reps("c1", "ACTB", [30, 30.1]), ...reps("c2", "ACTB", [20, 20.1]), ["pool -RT", "ACTB", "nrt", 28], ntc("ACTB")];
  const f = by(run(w), "nrt_margin");
  assert.equal(f.length, 1); // mean of all four sample wells is 25.05, so the margin is 2.95
  assert.match(f[0].evidence, /no sample name matches 'pool -RT', so compared with all 4 sample well/);
  assert.match(f[0].description, /after the samples/);
});

// ------------------------------------------------------------------ Ct-dependent SD
test("Ct-dependent SD limit follows 1.5 × the Poisson SD and never drops below the fixed threshold", () => {
  const v = { ...C.DEFAULT_PROFILE.values, sdCtDependent: true };
  assert.equal(C.sdLimit(C.DEFAULT_PROFILE.values, 36), 0.3, "off by default");
  assert.equal(C.sdLimit(v, 30), 0.3);
  assert.ok(Math.abs(C.sdLimit(v, 35) - 1.5 * C.poissonSd(35)) < 1e-12);
  assert.ok(Math.abs(C.sdLimit(v, 35) - 0.684) < 0.01);
  assert.ok(Math.abs(C.sdLimit(v, 40) - 1.5 / (Math.sqrt(3) * Math.LN2)) < 1e-12, "held at the 3-copy value");
  assert.equal(C.sdLimit({ ...v, sdPoissonK: 3 }, 35) > C.sdLimit(v, 35), true);
});

test("Ct-dependent SD: a late group within the Poisson limit is flagged only when the option is off", () => {
  const w = [...reps("late", "IL6", [34.5, 35.0, 35.5]), ...reps("early", "IL6", [24.5, 25.0, 25.5]), ntc("IL6")]; // both SD 0.5
  const off = run(w), on = run(w, { values: { sdCtDependent: true } });
  assert.deepEqual(by(off, "replicate_dispersion").map(f => f.sample).sort(), ["early", "late"]);
  assert.deepEqual(by(on, "replicate_dispersion").map(f => f.sample), ["early"]);
  const g = on.replicateGroups.find(x => x.unit === "late");
  assert.ok(g.threshold > 0.6 && !g.over);
  assert.equal(off.replicateGroups.find(x => x.unit === "late").threshold, 0.3);
  assert.match(on.checksRun.join("\n"), /Poisson sampling SD/);
});

// ------------------------------------------------------------------ standard-curve range
const stds = (t, qs) => qs.flatMap(q => [0, 1].map(k => ["", t, "standard", +(38 - 3.32 * Math.log10(q) + k * 0.05).toFixed(2), q]));
test("standard-curve range: noted under the setting, quiet over it or when switched off", () => {
  const narrow = [...stds("IL6", [1e3, 1e4, 1e5]), ntc("IL6")], wide = [...stds("IL6", [1e2, 1e3, 1e4, 1e5, 1e6]), ntc("IL6")];
  const f = by(run(narrow), "std_curve_range");
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "low");
  assert.match(f[0].description, /spans 2\.0 log10 units/);
  assert.equal(run(narrow).stdCurves[0].range, 2);
  assert.ok(by(run(narrow), "std_curve_summary").length, "the curve is still fitted");
  assert.equal(by(run(wide), "std_curve_range").length, 0);
  assert.equal(by(run(narrow, { values: { minStdRange: 0 } }), "std_curve_range").length, 0);
  assert.equal(by(run(narrow, { values: { minStdRange: 2 } }), "std_curve_range").length, 0, "exactly at the setting is fine");
});

// ------------------------------------------------------------------ RNA type
const rnaPlate = (extra = []) => [...["a1", "a2"].flatMap(s => ["hsa-miR-21-5p", "MALAT1", "GAPDH"].flatMap(t => reps(s, t, [25, 25.1]))),
  ntc("hsa-miR-21-5p"), ntc("MALAT1"), ntc("GAPDH"), ...extra];

test("RNA type: miRNA without a small-RNA reference and lncRNA without a no-RT are noted", () => {
  const res = run(rnaPlate());
  const m = by(res, "mirna_no_small_rna_reference"), l = by(res, "lncrna_no_nrt");
  assert.equal(m.length, 1); assert.equal(m[0].target, "hsa-miR-21-5p"); assert.equal(m[0].severity, "low");
  assert.match(m[0].evidence, /guessed from the name/);
  assert.equal(l.length, 1); assert.equal(l[0].target, "MALAT1"); assert.equal(l[0].severity, "low");
  assert.equal(by(res, "rna_type_reference_mismatch").length, 0, "no reference chosen, so nothing to compare");
});

test("RNA type: a small RNA on the plate, a no-RT well or a not-applicable mark silences the notes", () => {
  const res = run(rnaPlate([...reps("a1", "RNU48", [22, 22.1]), ["a1 -RT", "MALAT1", "nrt", null]]));
  assert.equal(by(res, "mirna_no_small_rna_reference").length, 0);
  assert.equal(by(res, "lncrna_no_nrt").length, 0);
  const na = run(rnaPlate(), { controlNA: { "nrt|MALAT1": { reason: "DNase-treated, junction-spanning primers", by: "t", at: "2026-01-01" } } });
  assert.equal(by(na, "lncrna_no_nrt").length, 0);
});

test("RNA type: with no-RT controls expected, the missing-control check reports it instead", () => {
  const res = run(rnaPlate(), { values: { expectNrt: true } });
  assert.equal(by(res, "lncrna_no_nrt").length, 0);
  assert.ok(by(res, "missing_control").some(f => f.target === "MALAT1"));
});

test("RNA type: a miRNA normalised to an mRNA reference is noted once, not twice", () => {
  const res = run(rnaPlate(), { analysis: { on: true, refs: ["GAPDH"], control: "" } });
  const f = by(res, "rna_type_reference_mismatch");
  assert.equal(f.length, 1);
  assert.equal(f[0].target, "hsa-miR-21-5p");
  assert.match(f[0].evidence, /reference\(s\): GAPDH \(mRNA/);
  assert.equal(by(res, "mirna_no_small_rna_reference").length, 0, "already covered by the mismatch note");
  // switched off analysis: the mismatch is not assessed
  assert.equal(by(run(rnaPlate(), { analysis: { on: false, refs: ["GAPDH"] } }), "rna_type_reference_mismatch").length, 0);
});

test("RNA type: an mRNA normalised to a small RNA is noted; a miRNA reference for a miRNA is fine", () => {
  const w = [...["a1", "a2"].flatMap(s => ["hsa-miR-21-5p", "hsa-miR-16-5p", "IL6"].flatMap(t => reps(s, t, [25, 25.1])))];
  const res = run(w, { analysis: { on: true, refs: ["hsa-miR-16-5p"] } });
  const f = by(res, "rna_type_reference_mismatch");
  assert.equal(f.length, 1); assert.equal(f[0].target, "IL6");
  assert.equal(by(res, "mirna_no_small_rna_reference").length, 0, "a miRNA chosen as reference counts as a small-RNA reference");
});

test("RNA type: the type set in the Genes step wins over the guess from the name", () => {
  const res = run(rnaPlate(), { targets: { MALAT1: { type: "mRNA" }, "hsa-miR-21-5p": { type: "other" } } });
  assert.equal(by(res, "lncrna_no_nrt").length, 0);
  assert.equal(by(res, "mirna_no_small_rna_reference").length, 0);
  const set = run(rnaPlate(), { targets: { GAPDH: { type: "lncRNA" } } });
  assert.ok(by(set, "lncrna_no_nrt").some(f => /set in Genes/.test(f.evidence)));
});

// ------------------------------------------------------------------ defaults leave earlier results alone
const NEW = ["late_ct", "nrt_margin", "std_curve_range", "rna_type_reference_mismatch", "mirna_no_small_rna_reference", "lncrna_no_nrt"];
const files = () => {
  const out = [["demo", demoFiles().results]];
  const dir = new URL("../sample-data/", import.meta.url);
  for (const n of readdirSync(dir)) if (/results\.(csv|txt)$/.test(n)) out.push([n, readFileSync(new URL(n, dir), "utf8")]);
  return out;
};
test("defaults: the demo and the sample files get no new findings, and the old ones are unchanged", () => {
  for (const [n, text] of files()) for (const extra of [{}, { expectNrt: true, expectPositive: true }]) {
    const go = values => { const e = C.newExperiment({}, "t"); e.source = { name: n, text, sha256: "-" }; Object.assign(e.ruleset.values, extra, values); return C.analyze(e); };
    const now = go({}), old = go({ lateCtThreshold: 0, nrtMargin: 0, minStdRange: 0, sdCtDependent: false });
    // Deliberate expectation: none of these files has a late-Ct sample group, an amplifying no-RT close to its
    // samples, a short standard curve, or a miRNA or lncRNA target, so no new rule fires on them.
    assert.deepEqual(now.findings.filter(f => NEW.includes(f.rule)).map(f => f.id), [], n);
    assert.deepEqual(now.findings.map(f => f.id), old.findings.map(f => f.id), n);
    assert.deepEqual(now.replicateGroups.map(g => g.over), old.replicateGroups.map(g => g.over), n);
  }
});

test("every new rule has a group, severity, explanation and references that resolve", () => {
  for (const k of NEW) {
    const r = C.RULES[k];
    assert.ok(r && r.group && r.severity && r.title && r.checks && r.why && r.evidence, k);
    assert.ok(r.refs.length && r.refs.every(x => C.REFERENCES[x]), k);
  }
  for (const k of ["sdCtDependent", "sdPoissonK", "lateCtThreshold", "nrtMargin", "minStdRange"]) {
    const f = C.RULESET_FIELDS.find(x => x.key === k);
    assert.ok(f && f.evidence && f.detail && f.refs.length, k);
    assert.ok(k in C.DEFAULT_PROFILE.values, k);
  }
  assert.deepEqual([C.DEFAULT_PROFILE.values.lateCtThreshold, C.DEFAULT_PROFILE.values.nrtMargin, C.DEFAULT_PROFILE.values.sdCtDependent,
    C.DEFAULT_PROFILE.values.sdPoissonK, C.DEFAULT_PROFILE.values.minStdRange], [35, 5, false, 1.5, 3]);
});
