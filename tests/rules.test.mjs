// Ground-truth checks for the rules: clean plates must not be flagged, and each planted problem must be
// caught by the right rule on the right well. Curves use a realistic model (exponential growth that
// saturates), with varying plateau heights, noise and baseline drift.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";

let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += rnd(); return (u - 3) / Math.sqrt(0.5); }; // ~N(0,1)
const pos = i => String.fromCharCode(65 + Math.floor(i / 12)) + ((i % 12) + 1);

// A clean 96-well plate: 2 targets × 4 biological units × 3 replicates, 5-point standards in duplicate,
// NTC, positive and no-RT controls for each target.
function cleanPlate({ repSd = 0.06, stdSlope = -3.32, stdNoise = 0.04 } = {}) {
  const w = []; let i = 0;
  for (const [t, base] of [["GAPDH", 18], ["IL6", 25]]) for (const [u, g, d] of [["c1", "ctrl", 0], ["c2", "ctrl", 0.3], ["t1", "trt", 1.5], ["t2", "trt", 1.8]])
    for (let r = 0; r < 3; r++) w.push({ well: pos(i++), sample: u, target: t, role: "sample", group: g, ct: base + (t === "IL6" ? d : 0) + gauss() * repSd });
  for (const t of ["GAPDH", "IL6"]) {
    for (const q of [1e6, 1e5, 1e4, 1e3, 1e2]) for (let r = 0; r < 2; r++) w.push({ well: pos(i++), sample: "", target: t, role: "standard", quantity: q, ct: 38 + stdSlope * Math.log10(q) + gauss() * stdNoise });
    w.push({ well: pos(i++), sample: "NTC", target: t, role: "ntc", ct: null });
    w.push({ well: pos(i++), sample: "POS", target: t, role: "positive", ct: 22 + gauss() * 0.05 });
    w.push({ well: pos(i++), sample: "c1 -RT", target: t, role: "nrt", ct: null });
  }
  return w;
}
const fmtCt = ct => (ct == null ? "Undetermined" : typeof ct === "string" ? ct : ct.toFixed(3));
const toCsv = w => "well,sample,target,role,group,quantity,ct\n" + w.map(x => [x.well, x.sample, x.target, x.role, x.group || "", x.quantity ?? "", fmtCt(x.ct)].join(",")).join("\n") + "\n";

// Realistic amplification: F doubles each cycle (efficiency eff) until it saturates at plateau A.
// Fluorescence crosses a fixed threshold at about the same cycle whatever the plateau, as on a real instrument.
function ampCurve(ct, { A = 1.5, eff = 1.95, noise = 0.004, drift = 0, cycles = 40, thr = 0.15 } = {}) {
  return Array.from({ length: cycles }, (_, k) => {
    const c = k + 1, base = 0.2 + drift * c + gauss() * noise;
    if (ct == null) return base;
    const f0 = thr / Math.pow(eff, ct);                       // so that F(ct) ≈ thr in the exponential phase
    return base + A / (1 + (A / f0 - 1) * Math.pow(eff, -c));
  });
}
const ampCsv = (w, opts = () => ({})) => "Well,Target,Cycle,Rn\n" + w.flatMap(x => { const o = opts(x); return o === null ? [] : ampCurve(typeof x.ct === "number" ? x.ct : x.curveCt ?? null, o).map((y, k) => `${x.well},${x.target},${k + 1},${y.toFixed(5)}`); }).join("\n") + "\n";
const TM = { GAPDH: 82.5, IL6: 79.0 };
function meltCsv(w, peaksFor = x => (typeof x.ct === "number" ? [[TM[x.target], 1]] : [])) {
  const temps = Array.from({ length: 71 }, (_, k) => 60 + k * 0.5);
  return "Well,Target,Temperature,Derivative\n" + w.flatMap(x => temps.map(T => `${x.well},${x.target},${T},${(peaksFor(x).reduce((a, [tm, h]) => a + h * Math.exp(-((T - tm) ** 2) / (2 * 0.7 ** 2)), 0) + gauss() * 0.01).toFixed(4)}`)).join("\n") + "\n";
}
function run(w, { amp, melt, values = {} } = {}) {
  const e = C.newExperiment({}, "t");
  e.source = { name: "r.csv", text: toCsv(w), sha256: "-" };
  if (amp) e.amp = { name: "a.csv", text: amp, sha256: "-" };
  if (melt) { e.melt = { name: "m.csv", text: melt, sha256: "-", valueType: "derivative" }; e.ruleset.values.meltChecks = true; }
  Object.assign(e.ruleset.values, { expectPositive: true, expectNrt: true }, values);
  return C.analyze(e);
}
// Flags that say something is wrong with the data (not "you didn't fill in the method details").
const realFlags = res => res.findings.filter(f => f.category !== "missing_context" && f.severity !== "info");
const names = fs => fs.map(f => `${f.rule}[${f.wells.join(" ")}]`).join(", ");

test("100 clean plates raise no data flags", () => {
  const bad = [];
  for (let n = 0; n < 100; n++) { const fl = realFlags(run(cleanPlate())); if (fl.length) bad.push(`plate ${n}: ${names(fl)}`); }
  assert.equal(bad.length, 0, bad.slice(0, 5).join("\n"));
});

test("100 clean plates with realistic curves raise no curve flags", () => {
  const bad = [];
  for (let n = 0; n < 100; n++) {
    const w = cleanPlate(), cycles = [35, 40, 45][n % 3];
    const amp = ampCsv(w, () => ({ A: 0.4 + rnd() * 2.6, eff: 1.85 + rnd() * 0.15, noise: 0.002 + rnd() * 0.01, drift: (rnd() - 0.5) * 0.004, cycles }));
    const fl = realFlags(run(w, { amp, melt: meltCsv(w) }));
    if (fl.length) bad.push(`plate ${n} (${cycles} cycles): ${names(fl)}`);
  }
  assert.equal(bad.length, 0, `${bad.length} plates falsely flagged:\n${bad.slice(0, 8).join("\n")}`);
});

// Each case plants one problem in a clean plate and names the rule (and well) that must catch it.
const at = (w, well) => w.find(x => x.well === well);
const PLANTS = {
  "duplicate well": { edit: w => w.push({ ...at(w, "A1") }), rule: "duplicate_well_assignment", well: "A1" },
  "typo in well name": { edit: w => (at(w, "A2").well = "Z9"), rule: "invalid_well_coordinate", well: "Z9" },
  "sample name missing": { edit: w => (at(w, "A4").sample = ""), rule: "unmapped_well", well: "A4" },
  "target missing": { edit: w => (at(w, "A5").target = ""), rule: "unmapped_well", well: "A5" },
  "garbled Ct": { edit: w => (at(w, "A6").ct = "#VALUE!"), rule: "non_numeric_ct", well: "A6" },
  "sample did not amplify": { edit: w => (at(w, "A7").ct = null), rule: "missing_ct", well: "A7" },
  "one replicate 1.5 cycles off": { edit: w => (at(w, "A8").ct += 1.5), rule: "replicate_dispersion", well: "A8" },
  "NTC amplifies early": { edit: w => (w.find(x => x.role === "ntc").ct = 29.5), rule: "ntc_amplification", severity: "high" },
  "NTC amplifies late": { edit: w => (w.find(x => x.role === "ntc").ct = 37.5), rule: "ntc_amplification", severity: "medium" },
  "NTC wells left off the plate": { edit: w => { for (let i = w.length - 1; i >= 0; i--) if (w[i].role === "ntc" && w[i].target === "IL6") w.splice(i, 1); }, rule: "missing_control" },
  "positive control failed": { edit: w => (w.find(x => x.role === "positive").ct = null), rule: "positive_control_failed" },
  "no-RT control amplifies": { edit: w => (w.find(x => x.role === "nrt").ct = 31), rule: "nrt_amplification" },
  "standard without quantity": { edit: w => (w.find(x => x.role === "standard").quantity = ""), rule: "std_curve_missing_quantity" },
  "well marked empty has a Ct": { edit: w => (at(w, "A9").role = "empty"), rule: "empty_well_signal", well: "A9" },
  "same sample in two groups": { edit: w => (at(w, "A1").group = "trt"), rule: "bio_unit_in_multiple_groups" },
};
for (const [name, p] of Object.entries(PLANTS)) test(`planted: ${name} is caught by ${p.rule}`, () => {
  for (let n = 0; n < 20; n++) {
    const w = cleanPlate(); p.edit(w);
    const hits = run(w).findings.filter(f => f.rule === p.rule);
    assert.ok(hits.length > 0, `plate ${n}: ${p.rule} did not fire`);
    if (p.well) assert.ok(hits.some(f => f.wells.includes(p.well)), `plate ${n}: fired on ${hits.map(f => f.wells.join(" ")).join("; ")}, not ${p.well}`);
    if (p.severity) assert.equal(hits[0].severity, p.severity, `plate ${n}`);
  }
});

test("planted: poor standard curves are caught, good ones are not", () => {
  for (let n = 0; n < 20; n++) {
    assert.ok(run(cleanPlate({ stdSlope: -4.3 })).findings.some(f => f.rule === "std_curve_efficiency"), "71% efficiency not flagged");
    assert.ok(run(cleanPlate({ stdSlope: -2.9 })).findings.some(f => f.rule === "std_curve_efficiency"), "121% efficiency not flagged");
    assert.ok(run(cleanPlate({ stdNoise: 2.5 })).findings.some(f => f.rule === "std_curve_r2"), "noisy standards not flagged");
    for (const slope of [-3.2, -3.32, -3.5]) assert.ok(!run(cleanPlate({ stdSlope: slope })).findings.some(f => f.rule.startsWith("std_curve_e") || f.rule === "std_curve_r2"), `slope ${slope} wrongly flagged`);
  }
});

test("planted: replicate spread is flagged just above the threshold and not just below", () => {
  const spread = d => { const w = cleanPlate({ repSd: 0 }); at(w, "A2").ct += d; return run(w).findings.some(f => f.rule === "replicate_dispersion" && f.wells.includes("A2")); };
  assert.ok(!spread(0.45), "SD 0.26 flagged");   // three values a, a+0.45, a → SD 0.26
  assert.ok(spread(0.6), "SD 0.35 not flagged"); // → SD 0.35
});

test("planted: curve problems are caught on the right well", () => {
  for (let n = 0; n < 15; n++) {
    const w = cleanPlate(), o = () => ({ A: 0.8 + rnd() * 1.5, noise: 0.003 });
    const flat = run(w, { amp: ampCsv(w, x => (x.well === "A3" ? { ...o(), A: 0 } : o())) });
    assert.ok(flat.findings.some(f => f.rule === "amp_ct_without_rise" && f.wells.includes("A3")), `plate ${n}: flat curve with a Ct not caught`);
    const w2 = cleanPlate(); at(w2, "B2").ct = null; at(w2, "B2").curveCt = 27;
    const rise = run(w2, { amp: ampCsv(w2, o) });
    assert.ok(rise.findings.some(f => f.rule === "amp_rise_without_ct" && f.wells.includes("B2")), `plate ${n}: rising curve without a Ct not caught`);
    const w3 = cleanPlate();
    const shifted = run(w3, { amp: "Well,Target,Cycle,Rn\n" + w3.flatMap(x => ampCurve(typeof x.ct === "number" ? x.ct + (x.well === "A10" ? 5 : 0) : null, o()).map((y, k) => `${x.well},${x.target},${k + 1},${y.toFixed(5)}`)).join("\n") });
    assert.ok(shifted.findings.some(f => f.rule === "amp_ct_inconsistent" && f.wells.includes("A10")), `plate ${n}: Ct 5 cycles off its curve not caught`);
    const missing = run(w, { amp: ampCsv(w, x => (x.well === "A11" ? null : o())) });
    assert.ok(missing.findings.some(f => f.rule === "amp_curve_missing" && f.wells.includes("A11")), `plate ${n}: missing curve not reported`);
  }
});

test("planted: melt problems are caught on the right well", () => {
  for (let n = 0; n < 15; n++) {
    const w = cleanPlate(), norm = x => (typeof x.ct === "number" ? [[TM[x.target], 1]] : []);
    const res = run(w, { melt: meltCsv(w, x => x.well === "A1" ? [[82.5, 1], [75, 0.5]] : x.well === "A4" ? [[84.6, 1]] : x.well === "A7" ? [] : x.role === "ntc" && x.target === "GAPDH" ? [[74, 0.6]] : norm(x)) });
    const has = (rule, well) => res.findings.some(f => f.rule === rule && (!well || f.wells.includes(well)));
    assert.ok(has("melt_multiple_peaks", "A1"), `plate ${n}: second peak not caught`);
    assert.ok(has("melt_tm_deviation", "A4"), `plate ${n}: Tm shift not caught`);
    assert.ok(has("melt_no_peak", "A7"), `plate ${n}: missing peak not caught`);
    assert.ok(has("ntc_melt_peak"), `plate ${n}: NTC peak not caught`);
    const other = res.findings.filter(f => f.rule.startsWith("melt_") && !["A1", "A4", "A7"].some(k => f.wells.includes(k)));
    assert.equal(other.length, 0, `plate ${n}: extra melt flags ${names(other)}`);
  }
});

test("awkward curve files do not crash the analysis", () => {
  const w = cleanPlate();
  const cases = {
    "five cycles only": ampCsv(w, () => ({ cycles: 5 })),
    "one point per well": "Well,Target,Cycle,Rn\n" + w.map(x => `${x.well},${x.target},1,0.2`).join("\n"),
    "all zeros": "Well,Target,Cycle,Rn\n" + w.flatMap(x => Array.from({ length: 40 }, (_, k) => `${x.well},${x.target},${k + 1},0`)).join("\n"),
    "negative values": "Well,Target,Cycle,Rn\n" + w.flatMap(x => Array.from({ length: 40 }, (_, k) => `${x.well},${x.target},${k + 1},${(-1 + k * 0.01).toFixed(3)}`)).join("\n"),
    "gaps and text": "Well,Target,Cycle,Rn\n" + w.flatMap(x => Array.from({ length: 40 }, (_, k) => `${x.well},${x.target},${k + 1},${k % 7 === 0 ? "NaN" : k % 11 === 0 ? "" : (0.2 + k * 0.01).toFixed(3)}`)).join("\n"),
    "wells not on the plate": "Well,Target,Cycle,Rn\n" + Array.from({ length: 40 }, (_, k) => `P24,GAPDH,${k + 1},0.3`).join("\n"),
    "target names differ": ampCsv(w.map(x => ({ ...x, target: x.target.toLowerCase() }))),
    "cycles out of order": "Well,Target,Cycle,Rn\n" + w.flatMap(x => ampCurve(typeof x.ct === "number" ? x.ct : null).map((y, k) => `${x.well},${x.target},${k + 1},${y.toFixed(4)}`).reverse()).join("\n"),
  };
  for (const [name, amp] of Object.entries(cases)) {
    let res; assert.doesNotThrow(() => (res = run(w, { amp })), name);
    for (const f of res.findings) assert.ok(!/NaN|undefined|Infinity/.test(f.description + f.evidence), `${name}: ${f.rule} says "${(f.description + " " + f.evidence).slice(0, 120)}"`);
  }
  const meltCases = { "flat melt": meltCsv(w, () => []), "two temperatures": "Well,Target,Temperature,Derivative\n" + w.flatMap(x => [`${x.well},${x.target},60,0.1`, `${x.well},${x.target},95,0.1`]).join("\n") };
  for (const [name, melt] of Object.entries(meltCases)) {
    let res; assert.doesNotThrow(() => (res = run(w, { melt })), name);
    for (const f of res.findings) assert.ok(!/NaN|undefined|Infinity/.test(f.description + f.evidence), `${name}: ${f.rule} says "${(f.description + " " + f.evidence).slice(0, 120)}"`);
  }
});

test("odd thresholds and tiny plates do not crash or print nonsense", () => {
  const w = cleanPlate();
  for (const values of [{ sdThreshold: 0 }, { ntcCtThreshold: 0 }, { minStdLevels: 0 }, { minStdLevels: 99 }, { effMin: 200, effMax: 0 }, { r2Min: 2 }, { ctTolerance: 0 }, { meltTmTolerance: 0, meltSecondaryRatio: 0 }])
    assert.doesNotThrow(() => run(w, { values, amp: ampCsv(w), melt: meltCsv(w) }), JSON.stringify(values));
  for (const tiny of [[w[0]], w.filter(x => x.role === "ntc"), w.filter(x => x.role === "standard").slice(0, 1), w.map(x => ({ ...x, ct: null })), w.map(x => ({ ...x, role: "empty" })), w.map(x => ({ ...x, ct: 20 }))]) {
    let res; assert.doesNotThrow(() => (res = run(tiny, { amp: ampCsv(tiny), melt: meltCsv(tiny) })));
    for (const f of res.findings) assert.ok(!/NaN|undefined|Infinity/.test(f.description + f.evidence), `${f.rule}: ${(f.description + " " + f.evidence).slice(0, 120)}`);
  }
});
