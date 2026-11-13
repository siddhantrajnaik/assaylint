// Assay calculations checked against numbers worked out by hand (see docs/assays.md for the same examples).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as A from "../web/assays.js";
import * as C from "../web/core.js";

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);
// Builds labelled rows the way core.effectiveRows returns them, plus the assay labels.
function plate(wells) {
  const rows = [], labels = {};
  wells.forEach(([set, role, target, ct, fraction = ""], i) => {
    const id = i + 2;
    rows.push({ id, line: id, well: `W${i}`, key: String.fromCharCode(65 + Math.floor(i / 12)) + ((i % 12) + 1), sample: `${set} ${role}`, target, group: null, ct: ct == null ? "Undetermined" : String(ct), role: "sample" });
    labels[id] = { role, set, fraction };
  });
  return { rows, labels };
}
function run(type, wells, params = {}) {
  const { rows, labels } = plate(wells);
  return A.runAssay({ assaySetup: { type, params, wells: labels }, ruleset: { values: { sdThreshold: 0.3 } } }, rows);
}
const find = (out, f) => out.rows.find(r => Object.entries(f).every(([k, v]) => r[k] === v));
const warned = (out, re) => out.warnings.some(w => re.test(w.text));

test("% input with a 1% input: adjusted input = Ct − log2(100)", () => {
  // IP 24.0 (triplicate), input 26.0: 1 × 2^(26 − 24) = 4% input.
  const out = run("chip", [["WT", "ip", "GAPDH", 23.9], ["WT", "ip", "GAPDH", 24.0], ["WT", "ip", "GAPDH", 24.1], ["WT", "input", "GAPDH", 26], ["WT", "input", "GAPDH", 26]], { inputPercent: 1 });
  const r = find(out, { set: "WT", target: "GAPDH" });
  close(r.ctIP, 24); close(r.adjInput, 26 - Math.log2(100)); close(r.pctInput, 4);
});

test("% input with a 10% input", () => {
  // 10 × 2^(25 − 27) = 2.5%
  const r = find(run("chip", [["A", "ip", "R1", 27], ["A", "input", "R1", 25]], { inputPercent: 10 }), { target: "R1" });
  close(r.adjInput, 25 - Math.log2(10)); close(r.pctInput, 2.5);
});

test("fold enrichment over IgG and over a negative region", () => {
  const out = run("chip", [["S", "ip", "Prom", 25], ["S", "igg", "Prom", 30], ["S", "input", "Prom", 26],
    ["S", "ip", "Desert", 29], ["S", "igg", "Desert", 30], ["S", "input", "Desert", 26]], { inputPercent: 1, negTarget: "Desert" });
  const p = find(out, { target: "Prom" }), d = find(out, { target: "Desert" });
  close(p.foldIgG, 32);                 // 2^(30 − 25)
  close(p.pctInput, 2);                 // 1 × 2^(26 − 25)
  close(p.pctInputIgG, 0.0625);         // 1 × 2^(26 − 30)
  close(p.pctInput / p.pctInputIgG, 32);// same as fold over IgG when IP and IgG share the input
  close(d.pctInput, 0.125); close(p.foldNeg, 16); close(d.foldNeg, 1);
  assert.equal(out.chart.yLabel, "% input");
});

test("ChIP edge cases: missing input, undetermined IP, IgG above IP, impossible % input", () => {
  const out = run("chip", [["S", "ip", "R1", 24], ["S", "ip", "R2", null], ["S", "ip", "R2", null], ["S", "input", "R2", 26],
    ["S", "ip", "R3", 28], ["S", "igg", "R3", 27], ["S", "input", "R3", 29], ["S", "ip", "R4", 20], ["S", "input", "R4", 28]], { inputPercent: 1 });
  assert.equal(find(out, { target: "R1" }).pctInput, null);
  assert.ok(warned(out, /R1: no input wells/));
  assert.equal(find(out, { target: "R2" }).pctInput, null);
  assert.ok(warned(out, /R2: the IP did not amplify/));
  assert.ok(warned(out, /R3: IgG comes up at Ct 27\.00, earlier than the IP/));
  assert.ok(find(out, { target: "R4" }).pctInput > 100 && warned(out, /more than everything that went in/));
  assert.ok(!out.rows.some(r => Object.values(r).some(v => typeof v === "number" && !Number.isFinite(v))));
});

test("CUT&RUN without input uses IgG fold enrichment and IP-only fold over the negative region", () => {
  const out = run("cutrun", [["K", "ip", "Peak", 22], ["K", "igg", "Peak", 27], ["K", "ip", "Neg", 26], ["K", "igg", "Neg", 27]], { negTarget: "Neg" });
  close(find(out, { target: "Peak" }).foldIgG, 32); close(find(out, { target: "Peak" }).foldNeg, 16);
  assert.equal(out.chart.yLabel, "Fold over IgG");
  assert.ok(!warned(out, /No wells are labelled “Input”/));
});

test("replicate spread above the threshold is flagged", () => {
  const out = run("chip", [["S", "ip", "R", 24], ["S", "ip", "R", 25], ["S", "input", "R", 26]]);
  assert.ok(warned(out, /spread SD 0\.71/));
});

test("MSRE-qPCR % methylation, sensitive and dependent enzymes", () => {
  const w = [["S", "digested", "H19", 25], ["S", "mock", "H19", 24], ["S", "digested", "Igf2", 26], ["S", "mock", "Igf2", 24]];
  const s = run("msre", w, { enzyme: "sensitive" });
  close(find(s, { target: "H19" }).pctMeth, 50); close(find(s, { target: "Igf2" }).pctMeth, 25);
  const d = run("msre", w, { enzyme: "dependent" });
  close(find(d, { target: "H19" }).pctMeth, 50); close(find(d, { target: "Igf2" }).pctMeth, 75);
});

test("MSRE: no-site correction, fully methylated calibrator, complete digestion and >100%", () => {
  const out = run("msre", [["S", "digested", "T", 25.5], ["S", "mock", "T", 24], ["S", "digested", "NoSite", 24.5], ["S", "mock", "NoSite", 24],
    ["M", "digested", "T", 24.5], ["M", "mock", "T", 24], ["M", "digested", "NoSite", 24.5], ["M", "mock", "NoSite", 24],
    ["S", "digested", "U", null], ["S", "mock", "U", 24], ["S", "digested", "V", 23], ["S", "mock", "V", 24]], { noSiteTarget: "NoSite", calibratorSet: "M" });
  // sample: (1.5 − 0.5) = 1; calibrator: (0.5 − 0.5) = 0; ΔΔCt 1 → 50%
  const t = find(out, { set: "S", target: "T" });
  close(t.ddCt, 1); close(t.pctMeth, 50);
  assert.equal(find(out, { set: "S", target: "U" }).pctMeth, null);
  assert.match(find(out, { set: "S", target: "U" }).note, /below 0.01%/);
  assert.ok(warned(out, /outside 0–100%/));
  assert.ok(!out.rows.some(r => r.target === "NoSite"));
});

test("MethyLight PMR relative to a fully methylated reference and a control reaction", () => {
  const out = run("methylight", [["T1", "test", "MLH1", 30], ["T1", "test", "ALU", 20], ["SssI", "meth_ref", "MLH1", 25], ["SssI", "meth_ref", "ALU", 18]], { controlTarget: "ALU" });
  const r = find(out, { set: "T1", target: "MLH1" });
  close(r.dCt, 10); close(r.dCtRef, 7); close(r.pmr, 12.5);
  assert.ok(!out.rows.some(r => r.target === "ALU"));
  assert.ok(warned(run("methylight", [["T1", "test", "MLH1", 30]], {}), /control reaction/));
});

test("accessibility: nuclease digestion (loss) and FAIRE / ATAC enrichment, normalised to a closed region", () => {
  const loss = run("dnase", [["C", "treated", "HS2", 27], ["C", "untreated", "HS2", 24], ["C", "treated", "Closed", 24.5], ["C", "untreated", "Closed", 24]], { closedTarget: "Closed" });
  const h = find(loss, { target: "HS2" });
  close(h.index, 2 ** 2.5); close(h.pctLeft, 12.5);
  const enr = run("faire", [["C", "treated", "Enh", 26], ["C", "untreated", "Enh", 24], ["C", "treated", "Closed", 29], ["C", "untreated", "Closed", 24]], { closedTarget: "Closed" });
  close(find(enr, { target: "Enh" }).index, 8);
  const over = run("dnase", [["C", "treated", "HS2", 27], ["C", "untreated", "HS2", 24], ["C", "treated", "Closed", 26], ["C", "untreated", "Closed", 24]], { closedTarget: "Closed" });
  assert.ok(warned(over, /closed region was digested too/));
});

test("3C-qPCR: signal vs BAC template, loading control, control interaction", () => {
  const out = run("threec", [["A", "library", "F19", 30], ["X", "template", "F19", 25], ["A", "library", "Ercc3", 28], ["X", "template", "Ercc3", 26], ["A", "library", "Gapdh", 20],
    ["B", "library", "F19", 30], ["B", "library", "Ercc3", 28], ["B", "library", "Gapdh", 21]], { loadingTarget: "Gapdh", controlTarget: "Ercc3" });
  const a = find(out, { set: "A", target: "F19" }), b = find(out, { set: "B", target: "F19" });
  close(a.signal, 1 / 32);
  close(a.corrected, (1 / 32) * 2 ** -0.5);   // loading 20 vs mean 20.5
  close(b.corrected, (1 / 32) * 2 ** 0.5);    // loading 21: less DNA, so the signal is scaled up
  close(a.rcf, 0.125); close(b.rcf, 0.125);   // (1/32) / (1/4): loading cancels in the ratio
  assert.ok(!out.rows.some(r => r.target === "Gapdh"));
});

test("polysome distribution: % of total across fractions, with and without a spike-in", () => {
  const out = run("polysome", [["Ctrl", "fraction", "ACTB", 25, "1"], ["Ctrl", "fraction", "ACTB", 24, "2"], ["Ctrl", "fraction", "ACTB", 23, "3"], ["Ctrl", "fraction", "ACTB", 26, "4"]], { polysomeFrom: 3 });
  const pct = ["1", "2", "3", "4"].map(f => find(out, { fraction: f }).pct);
  [40 / 3, 80 / 3, 160 / 3, 20 / 3].forEach((v, i) => close(pct[i], v));
  close(out.summary[0].polysomal, 60);
  const sp = run("polysome", [["C", "fraction", "ACTB", 25, "1"], ["C", "fraction", "Luc", 20, "1"], ["C", "fraction", "ACTB", 25, "2"], ["C", "fraction", "Luc", 21, "2"]], { spikeTarget: "Luc" });
  // spike-corrected: 5 and 4 → relative 0.5 and 1 → 33.3% and 66.7%
  close(find(sp, { fraction: "1" }).pct, 100 / 3); close(find(sp, { fraction: "2" }).pct, 200 / 3);
  const missing = run("polysome", [["C", "fraction", "ACTB", 25, "1"], ["C", "fraction", "ACTB", null, "2"], ["C", "fraction", "ACTB", 25, ""]]);
  close(find(missing, { fraction: "1" }).pct, 100); assert.equal(find(missing, { fraction: "2" }).pct, 0);
  assert.ok(warned(missing, /no fraction number/) && warned(missing, /did not amplify and count as 0%/));
});

test("TRAP bound vs unbound as named fractions", () => {
  const out = run("trap", [["Drd1", "fraction", "Ppp1r1b", 24, "bound"], ["Drd1", "fraction", "Ppp1r1b", 25, "unbound"]]);
  close(find(out, { fraction: "bound" }).pct, 200 / 3);
});

test("immuno-PCR: ΔCt over blank and limit of detection (mean − 3 SD)", () => {
  const out = run("ipcr", [["Blank", "blank", "IL6", 35], ["Blank", "blank", "IL6", 35.5], ["Blank", "blank", "IL6", 34.5],
    ["S1", "test", "IL6", 30], ["S2", "test", "IL6", 34], ["S3", "test", "IL6", null]], { sdMultiplier: 3 });
  const s1 = find(out, { set: "S1" }), s2 = find(out, { set: "S2" });
  close(out.summary[0].blankSd, 0.5); close(s1.lod, 33.5);
  close(s1.dCt, 5); close(s1.fold, 32); assert.equal(s1.detected, "Above LOD");
  assert.equal(s2.detected, "Below LOD"); assert.equal(find(out, { set: "S3" }).detected, "Not detected");
  const noBlank = run("pla", [["B", "blank", "X", null], ["B", "blank", "X", null], ["S", "test", "X", 30]], { maxCycles: 40 });
  close(find(noBlank, { set: "S" }).dCt, 10); assert.ok(warned(noBlank, /lower bound/));
});

test("labels: guessing roles from sample names, sets, cleaning a damaged setup", () => {
  assert.equal(A.guessAssayRole("WT H3K4me3 IP", "enrichment").role, "ip");
  assert.equal(A.guessAssayRole("WT input 1%", "enrichment").role, "input");
  assert.equal(A.guessAssayRole("KO IgG", "enrichment").role, "igg");
  assert.equal(A.guessAssayRole("liver HpaII digested", "msre").role, "digested");
  assert.equal(A.guessAssayRole("liver mock", "msre").role, "mock");
  assert.deepEqual(A.guessAssayRole("Ctrl Fr 07", "fractions"), { role: "fraction", fraction: "7" });
  assert.equal(A.guessAssayRole("NTC", "enrichment"), null);
  assert.equal(A.defaultSet({ sample: "WT input" }), A.defaultSet({ sample: "WT IP" }));
  assert.equal(A.defaultSet({ sample: "x", group: "KO" }), "KO");
  const s = A.normalizeAssaySetup({ type: "nope", params: { a: {}, b: 1 }, wells: { 3: { role: "ip", set: 5 }, 4: { role: "bad" }, 5: null } });
  assert.deepEqual(s, { type: "", sourceSha: "", params: { b: 1 }, wells: { 3: { role: "ip", set: "5", fraction: "" } } });
  for (const junk of [null, 5, "x", [], { type: "chip", wells: [] }]) assert.doesNotThrow(() => A.runAssay({ assaySetup: junk }, []));
  assert.equal(A.runAssay({}, []), null);
  assert.ok(warned(A.runAssay({ assaySetup: { type: "chip" } }, []), /No wells are labelled “IP/));
});

test("a replaced results file sets the old labels aside", () => {
  const { rows, labels } = plate([["S", "ip", "R", 24], ["S", "input", "R", 26]]);
  const out = A.runAssay({ assaySetup: { type: "chip", sourceSha: "old", wells: labels }, source: { sha256: "new" } }, rows);
  assert.equal(out.labelled, 0); assert.ok(warned(out, /results file was replaced/));
});

test("every assay maps to a family with formula text and verified references", () => {
  for (const a of A.ASSAYS) {
    const f = A.FAMILIES[a.family];
    assert.ok(f && f.formula.length && f.refs.length, a.id);
    for (const r of a.require) assert.ok(f.roles.includes(r), `${a.id} requires ${r}`);
    for (const k of f.refs) assert.ok(A.REFS[k] && (A.REFS[k].doi || A.REFS[k].pmid), k);
  }
});

test("sample-data files: ChIP and MSRE runs give the planted results", () => {
  for (const [file, type, params, guessFamily] of [
    ["sample-data/5 ChIP-qPCR percent input - results.csv", "chip", { inputPercent: 1, negTarget: "GAPDH-desert" }, "enrichment"],
    ["sample-data/6 MSRE-qPCR methylation - results.txt", "msre", { enzyme: "sensitive", noSiteTarget: "noSite-ctrl", calibratorSet: "SssI-DNA" }, "msre"]]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const exp = C.newExperiment({ title: file });
    exp.source = { text, sha256: "x", name: file };
    const res = C.analyze(exp);
    exp.assaySetup = { type, params, wells: A.guessLabels(res.rows, guessFamily) };
    const out = A.runAssay(exp, res.rows);
    assert.ok(out.rows.length > 2, file);
    if (type === "chip") {
      const r = find(out, { set: "WT", target: "MYC-promoter" });
      assert.ok(r.pctInput > 1 && r.foldIgG > 10, JSON.stringify(r));
      assert.ok(warned(out, /IgG comes up/) && warned(out, /no input wells/) && warned(out, /spread SD/));
      assert.ok(res.findings.some(f => f.rule === "ntc_amplification"));
    } else {
      assert.ok(find(out, { set: "Tumour-1", target: "MGMT-prom" }).pctMeth > 50);
      assert.ok(find(out, { set: "Normal-1", target: "MGMT-prom" }).pctMeth < 10);
      assert.ok(warned(out, /outside 0–100%/) && warned(out, /mock digest did not amplify/));
    }
    assert.match(A.assayReportHtml(exp, res.rows, s => String(s)), /Assay calculation/);
  }
});

test("4sU labelling, treated vs mock (Roadblock-style): % new with and without a no-4sU background", () => {
  // 4sU cells: NEM-treated 26, mock 25, so d = 1. No-4sU cells: 25.2 vs 25, d = 0.2.
  const w = [["4sU", "blocked", "MYC", 26], ["4sU", "unblocked", "MYC", 25], ["no4sU", "blocked", "MYC", 25.2], ["no4sU", "unblocked", "MYC", 25]];
  const out = run("slam", w, { backgroundSet: "no4sU" });
  const r = find(out, { set: "4sU", target: "MYC" });
  close(r.d, 1); close(r.dBg, 0.2, 1e-9);
  close(r.pctOld, 100 * 2 ** -0.8); // 57.43%: made before the label
  close(r.pctNew, 100 - 100 * 2 ** -0.8); // 42.57% new
  close(r.pctOld, 57.4349177, 1e-6);
  assert.equal(find(out, { set: "no4sU" }).note, "No-4sU background");
  assert.ok(!out.chart.bars.some(b => b.series === "no4sU"));
  // Without the background: 100 × 2^−1 = 50% before the label, 50% new, and a reminder.
  const plain = run("slam", w.slice(0, 2));
  close(find(plain, { target: "MYC" }).pctNew, 50);
  assert.ok(warned(plain, /No no-4sU control set/));
  // The no-4sU cells moving more than half a cycle is flagged.
  const moved = run("slam", [...w.slice(0, 2), ["no4sU", "blocked", "MYC", 26], ["no4sU", "unblocked", "MYC", 25]], { backgroundSet: "no4sU" });
  assert.ok(warned(moved, /without 4sU the treatment moved the Ct by 1\.00/));
});

test("4sU labelling, pulldown vs total: % in pulldown minus the no-4sU pulldown", () => {
  // 10% total kept. 4sU: total 25, pulldown 27 → 10 × 2^−2 = 2.5%. No-4sU: total 25, pulldown 32 → 10 × 2^−7 = 0.078125%.
  const out = run("foursu", [["4sU", "ip", "MYC", 27], ["4sU", "input", "MYC", 25], ["no4sU", "ip", "MYC", 32], ["no4sU", "input", "MYC", 25]],
    { backgroundSet: "no4sU", totalPercent: 10 });
  const r = find(out, { set: "4sU", target: "MYC" });
  close(r.pctPull, 2.5); close(r.pctBg, 0.078125); close(r.pctNew, 2.421875); close(r.overBg, 32);
  const weak = run("foursu", [["4sU", "ip", "X", 27], ["4sU", "input", "X", 25], ["no4sU", "ip", "X", 27.5], ["no4sU", "input", "X", 25]], { backgroundSet: "no4sU" });
  assert.ok(warned(weak, /only 1\.41-fold over the no-4sU pulldown/));
  assert.equal(A.guessAssayRole("4sU 1h NEM", "labelling").role, "blocked");
  assert.equal(A.guessAssayRole("4sU 1h mock", "labelling").role, "unblocked");
  assert.equal(A.guessAssayRole("4sU biotin pulldown", "labelling").role, "ip");
  assert.equal(A.guessAssayRole("4sU total", "labelling").role, "input");
});

test("iCLIP is named in the catalogue next to eCLIP", () => {
  const rip = A.assayById("rip");
  assert.ok(rip.covers.includes("iCLIP") && rip.covers.includes("eCLIP"));
  assert.match(rip.name, /iCLIP \/ eCLIP/);
});

// ---------------------------------------------------------------- PCR efficiency
function runEff(type, wells, params, eff, stdCurves) {
  const { rows, labels } = plate(wells);
  return A.runAssay({ assaySetup: { type, params, wells: labels, eff }, ruleset: { values: { sdThreshold: 0.3 } } }, rows, { stdCurves });
}

test("efficiency: defaults stay at 100% (E = 2) and the table says so", () => {
  const w = [["WT", "ip", "R1", 24], ["WT", "input", "R1", 26]];
  const plain = run("chip", w, { inputPercent: 1 });
  const r = find(plain, { target: "R1" });
  close(r.pctInput, 4);
  assert.equal(r.eff, "100.0% (assumed)");
  assert.deepEqual(plain.columns.at(-1), ["eff", "Efficiency used"]);
  assert.deepEqual(plain.efficiencies.map(e => [e.target, e.pct, e.E, e.source]), [["R1", 100, 2, "assumed"]]);
  // A standard curve on the plate is not used unless the user picks it.
  const notPicked = runEff("chip", w, { inputPercent: 1 }, undefined, [{ target: "R1", efficiency: 90, slope: -3.587, r2: 0.999, levels: 5 }]);
  close(find(notPicked, { target: "R1" }).pctInput, 4);
});

test("efficiency-corrected % input and fold over IgG, by hand", () => {
  // 90% efficiency, E = 1.9. 1% input: % input = 1 × 1.9^(26 − 24) = 3.61%. IgG 30: fold = 1.9^(30 − 24) = 47.045881.
  const w = [["WT", "ip", "R1", 24], ["WT", "input", "R1", 26], ["WT", "igg", "R1", 30]];
  const typed = runEff("chip", w, { inputPercent: 1 }, { R1: 90 });
  const r = find(typed, { target: "R1" });
  close(r.pctInput, 3.61); close(r.foldIgG, 47.045881);
  close(r.adjInput, 26 - Math.log(100) / Math.log(1.9));
  assert.equal(r.eff, "90.0% (typed in)");
  // Same number from a standard curve with that efficiency.
  const curve = runEff("chip", w, { inputPercent: 1 }, { R1: "curve" }, [{ target: "R1", efficiency: 90, slope: -3.587, r2: 0.999, levels: 5 }]);
  close(find(curve, { target: "R1" }).pctInput, 3.61);
  assert.equal(find(curve, { target: "R1" }).eff, "90.0% (standard curve)");
  assert.ok(!warned(curve, /outside 90–110%/)); // 90 is inside the range
  // "Standard curve" with no curve on the plate: 100% and a warning.
  const missing = runEff("chip", w, { inputPercent: 1 }, { R1: "curve" }, []);
  close(find(missing, { target: "R1" }).pctInput, 4);
  assert.ok(warned(missing, /no standard curve for it on this plate, so 100% was used/));
  assert.ok(warned(runEff("chip", w, { inputPercent: 1 }, { R1: 80 }), /80\.0% is outside 90–110%/));
});

test("efficiency-corrected MSRE, by hand", () => {
  // E = 1.95. Mock 24, digested 25: sensitive 100 × 1.95^−1 = 51.282051%; dependent 48.717949%.
  const w = [["S", "digested", "H19", 25], ["S", "mock", "H19", 24]];
  close(find(runEff("msre", w, { enzyme: "sensitive" }, { H19: 95 }), { target: "H19" }).pctMeth, 51.282051);
  close(find(runEff("msre", w, { enzyme: "dependent" }, { H19: 95 }), { target: "H19" }).pctMeth, 48.717949);
  // With a no-site region at its own efficiency: T moved 1.5 cycles at E = 1.9, NoSite 0.5 cycles at E = 2.
  // left = 1.9^−1.5 / 2^−0.5 = 0.381830 / 0.707107 = 0.539996, so 54.00%.
  const ns = runEff("msre", [["S", "digested", "T", 25.5], ["S", "mock", "T", 24], ["S", "digested", "NoSite", 24.5], ["S", "mock", "NoSite", 24]],
    { noSiteTarget: "NoSite" }, { T: 90 });
  close(find(ns, { target: "T" }).pctMeth, 100 * 1.9 ** -1.5 / 2 ** -0.5);
  close(find(ns, { target: "T" }).pctMeth, 53.9996, 1e-3);
});

test("efficiency-corrected accessibility, 3C, fractions, signal and 4sU labelling reduce to E^ΔCt", () => {
  const acc = runEff("dnase", [["C", "treated", "HS2", 27], ["C", "untreated", "HS2", 24], ["C", "treated", "Closed", 24.5], ["C", "untreated", "Closed", 24]],
    { closedTarget: "Closed" }, { HS2: 90 });
  close(find(acc, { target: "HS2" }).pctLeft, 100 * 1.9 ** -3);
  close(find(acc, { target: "HS2" }).index, 1.9 ** 3 / 2 ** 0.5);
  const sig = runEff("ipcr", [["Blank", "blank", "IL6", 35], ["Blank", "blank", "IL6", 35], ["S1", "test", "IL6", 30]], {}, { IL6: 95 });
  close(find(sig, { set: "S1" }).fold, 1.95 ** 5);
  const fr = runEff("polysome", [["C", "fraction", "ACTB", 25, "1"], ["C", "fraction", "ACTB", 24, "2"]], {}, { ACTB: 90 });
  close(find(fr, { fraction: "1" }).pct, 100 / (1 + 1.9)); // 1 : 1.9
  const slam = runEff("slam", [["4sU", "blocked", "MYC", 26], ["4sU", "unblocked", "MYC", 25]], {}, { MYC: 90 });
  close(find(slam, { target: "MYC" }).pctNew, 100 - 100 / 1.9);
  const c3 = runEff("threec", [["A", "library", "F19", 30], ["X", "template", "F19", 25], ["A", "library", "Gapdh", 20]], { loadingTarget: "Gapdh" }, { F19: 90 });
  close(find(c3, { target: "F19" }).signal, 1.9 ** -5);
});

test("efficiency from the demo run's real standard curve, and the setting survives a save", () => {
  const exp = C.newExperiment({ title: "eff" });
  exp.source = { text: readFileSync(new URL("../examples/demo_results.csv", import.meta.url), "utf8"), sha256: "x", name: "demo.csv" };
  const res = C.analyze(exp);
  const curve = res.stdCurves.find(c => c.target === "GENE1");
  assert.ok(curve && curve.efficiency > 90 && curve.efficiency < 105);
  const out = runEff("chip", [["WT", "ip", "GENE1", 24], ["WT", "input", "GENE1", 26]], { inputPercent: 1 }, { GENE1: "curve" }, res.stdCurves);
  close(find(out, { target: "GENE1" }).pctInput, (1 + curve.efficiency / 100) ** 2);
  const s = A.normalizeAssaySetup(JSON.parse(JSON.stringify({ type: "chip", eff: { GENE1: "curve", R2: 95, bad: 500, worse: "x", "": 90 } })));
  assert.deepEqual(s.eff, { GENE1: "curve", R2: 95 });
  const p = A.normalizeAssaySetup(JSON.parse('{"type":"chip","eff":{"__proto__":92}}'));
  assert.equal(Object.getPrototypeOf(p.eff), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(p.eff, "__proto__").value, 92);
  const html = A.assayReportHtml({ ...exp, assaySetup: { type: "chip", params: { inputPercent: 1 }, eff: { GENE1: "curve" }, wells: {} } }, res.rows, x => String(x), res.stdCurves);
  assert.match(html, /E\^ΔCt/);
});
