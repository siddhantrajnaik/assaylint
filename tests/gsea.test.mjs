// Gene set enrichment (web/gsea.js): checked against gseapy and SciPy, plus the guards and the gene set handling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import * as G from "../web/genes.js";
import * as GS from "../web/gsea.js";
import * as R from "../web/report.js";

const REF = JSON.parse(readFileSync(new URL("./fixtures/gsea-reference.json", import.meta.url), "utf8"));
const rankedOf = c => c.genes.map((gene, i) => ({ gene, value: c.values[i] })).sort((a, b) => b.value - a.value || (a.gene < b.gene ? -1 : 1));
const setsOf = c => Object.entries(c.sets).map(([name, genes]) => ({ name, genes }));

test("ES and leading edge match gseapy exactly", () => {
  let worst = 0, n = 0;
  for (const c of REF.cases.filter(c => c.gsea)) {
    const ranked = rankedOf(c), values = ranked.map(r => r.value), at = new Map(ranked.map((r, i) => [r.gene, i]));
    for (const [name, genes] of Object.entries(c.sets)) {
      const ref = c.gsea[name], hits = genes.map(g => at.get(g)).sort((a, b) => a - b), rs = GS.runningSum(values, hits);
      worst = Math.max(worst, Math.abs(rs.es - ref.es)); n++;
      assert.ok(Math.abs(rs.es - ref.es) < 1e-12, `${c.name}/${name}: ES ${rs.es} vs gseapy ${ref.es}`);
      assert.deepEqual(rs.leading.map(i => ranked[i].gene).sort(), [...ref.lead].sort(), `${c.name}/${name}: leading edge`);
      assert.ok(Math.abs(GS.esFromPositions(values, hits) - rs.es) < 1e-12, "fast ES equals the running sum");
    }
  }
  console.log(`  ES vs gseapy ${REF.generated_with.gseapy}: ${n} sets, worst |difference| ${worst.toExponential(1)}`);
});

// NES, p and q are permutation estimates on both sides. gseapy was run with 3 seeds; I run 3 seeds of my own with
// the same number of permutations and compare the means. Allowed difference: 4 standard errors of the difference of
// two means of 3 runs, using the binomial SE for p (p(1 − p)/n per run, with n the same-sign permutations, about
// half of them) and the observed spread between seeds for NES and q, with small floors.
test("NES, p and FDR q agree with gseapy within permutation noise", () => {
  const worst = { nes: 0, p: 0, fdr: 0 };
  const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length, sd = xs => Math.sqrt(xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1));
  for (const c of REF.cases.filter(c => c.gsea)) {
    const ranked = rankedOf(c), sets = setsOf(c);
    const mine = [1, 2, 3].map(seed => GS.gseaPreranked(ranked, sets, { nperm: REF.nperm, seed }));
    sets.forEach((s, i) => {
      const ref = c.gsea[s.name], m = k => mine.map(r => r[i][k]);
      const pm = mean(m("p")), pr = mean(ref.p), pbar = (pm + pr) / 2;
      const seP = Math.sqrt((2 * pbar * (1 - pbar)) / (REF.nperm / 2) / 3);
      const dp = Math.abs(pm - pr), dn = Math.abs(mean(m("nes")) - mean(ref.nes)), df = Math.abs(mean(m("fdr")) - mean(ref.fdr));
      const tolN = Math.max(0.02 * Math.abs(mean(ref.nes)), 4 * Math.hypot(sd(ref.nes), sd(m("nes"))) / Math.sqrt(3));
      const tolF = Math.max(0.03, 4 * Math.hypot(sd(ref.fdr), sd(m("fdr"))) / Math.sqrt(3));
      assert.ok(dp <= 4 * seP + 2 / REF.nperm, `${c.name}/${s.name}: p ${pm} vs gseapy ${pr}`);
      assert.ok(dn <= tolN, `${c.name}/${s.name}: NES ${mean(m("nes"))} vs gseapy ${mean(ref.nes)}`);
      assert.ok(df <= tolF, `${c.name}/${s.name}: FDR ${mean(m("fdr"))} vs gseapy ${mean(ref.fdr)}`);
      worst.nes = Math.max(worst.nes, dn); worst.p = Math.max(worst.p, dp); worst.fdr = Math.max(worst.fdr, df);
    });
  }
  console.log(`  permutation statistics vs gseapy (${REF.nperm} permutations, means of 3 seeds each): worst |ΔNES| ${worst.nes.toFixed(4)}, |Δp| ${worst.p.toFixed(4)}, |ΔFDR| ${worst.fdr.toFixed(4)}`);
});

test("rank test matches scipy.stats.mannwhitneyu", () => {
  let worst = 0;
  for (const c of REF.cases) {
    const ranked = rankedOf(c), rows = GS.rankTest(ranked, setsOf(c));
    for (const r of rows) {
      const ref = c.rank[r.name];
      assert.equal(r.U, ref.U, `${c.name}/${r.name}: U`);
      const rel = Math.abs(r.p - ref.p) / Math.max(ref.p, 1e-300);
      worst = Math.max(worst, rel);
      assert.ok(rel < 1e-10, `${c.name}/${r.name}: p ${r.p} vs SciPy ${ref.p}`);
    }
  }
  console.log(`  rank test vs SciPy ${REF.generated_with.scipy}: worst relative p difference ${worst.toExponential(1)}`);
});

test("same seed, same result; different seed, nearly the same", () => {
  const c = REF.cases[0], ranked = rankedOf(c), sets = setsOf(c);
  assert.deepEqual(GS.gseaPreranked(ranked, sets, { nperm: 500, seed: 7 }), GS.gseaPreranked(ranked, sets, { nperm: 500, seed: 7 }));
  const a = GS.gseaPreranked(ranked, sets, { nperm: 500, seed: 7 }), b = GS.gseaPreranked(ranked, sets, { nperm: 500, seed: 8 });
  assert.notDeepEqual(a, b);
  a.forEach((r, i) => assert.equal(r.es, b[i].es));
});

// ---------------------------------------------------------------- guards
const fake = n => ({ genes: Array.from({ length: n }, (_, i) => ({ gene: `G${i}`, value: n / 2 - i + 0.1 })), notes: [], statLabel: "x", group: "B", control: "A" });
test("refuses below the minimum number of ranked genes and says why", () => {
  const r = GS.enrichment(fake(GS.MIN_GENES - 1), [{ name: "s", genes: ["G0", "G1", "G2"] }]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /at least 15/);
  assert.equal(GS.enrichment(fake(GS.MIN_GENES), [{ name: "s", genes: ["G0", "G1", "G2"] }]).ok, true);
});
test("set size limits: too small and almost-whole-panel sets are dropped", () => {
  const all = Array.from({ length: 19 }, (_, i) => `G${i}`);
  const r = GS.enrichment(fake(20), [{ name: "tiny", genes: ["G0", "G1"] }, { name: "huge", genes: all }, { name: "ok", genes: ["G0", "G1", "G2"] }, { name: "max", genes: all.slice(0, 17) }]);
  assert.deepEqual(r.dropped.small, ["tiny"]);
  assert.deepEqual(r.dropped.large, ["huge"]);
  assert.deepEqual(r.rows.map(x => x.name).sort(), ["max", "ok"]);
  assert.equal(r.maxSize, 17);
  const r2 = GS.enrichment(fake(20), [{ name: "ok", genes: ["G0", "G1", "G2"] }, { name: "max", genes: all.slice(0, 17) }], { minSize: 4, maxSize: 10 });
  assert.deepEqual([r2.dropped.small, r2.dropped.large], [["ok"], ["max"]]);
  assert.equal(GS.enrichment(fake(20), [{ name: "tiny", genes: ["G0"] }]).ok, false);
});
test("automatic method by panel size, user can override, universe stated, leading edge reported", () => {
  const s = [{ name: "top", genes: ["G0", "G1", "G2", "G3"] }];
  const small = GS.enrichment(fake(30), s), big = GS.enrichment(fake(60), s, { nperm: 200 }), forced = GS.enrichment(fake(30), s, { method: "gsea", nperm: 200 });
  assert.equal(small.method, "rank");
  assert.equal(big.method, "gsea");
  assert.equal(forced.method, "gsea");
  assert.ok(forced.notes.some(n => /You chose GSEA with only 30 genes/.test(n)));
  assert.ok(GS.enrichment(fake(60), s, { method: "rank" }).method === "rank");
  for (const r of [small, big]) {
    assert.ok(r.notes.some(n => /universe is this panel/.test(n)));
    assert.ok(r.notes.some(n => /correlated/.test(n)));
    assert.deepEqual(r.rows[0].leading, ["G0", "G1", "G2", "G3"]);
    assert.equal(r.rows[0].direction, "up");
  }
  assert.ok(small.rows[0].auc === 1 && small.rows[0].p < 0.01);
  assert.equal(big.rows[0].pGsea, 0);
});

// ---------------------------------------------------------------- gene sets
test("GMT parsing is robust", () => {
  const p = GS.parseGmt("FEFF# comment\r\nSET_A\thttp://x\tACTB\tGAPDH,1.0\tACTB\r\n\r\nSET_B\t\ttp53\nSET_A\td\tIL6\tCXCL8\nonly-a-name\nNO_GENES\tdesc\t\t\n");
  assert.deepEqual(p.sets, [{ name: "SET_A", genes: ["ACTB", "GAPDH"] }, { name: "SET_B", genes: ["tp53"] }, { name: "SET_A (2)", genes: ["IL6", "CXCL8"] }]);
  assert.equal(p.skipped, 2);
  assert.match(GS.parseGmt("Well,Ct\nA1,20\n").error, /No gene sets found/);
  assert.match(GS.parseGmt("").error, /empty/);
  assert.deepEqual(GS.splitGenes("IL6, cxcl8;\nTNF  IL6"), ["IL6", "cxcl8", "TNF"]);
});
test("symbols match case-insensitively, except for the fly; unmatched are reported", () => {
  const panel = [{ target: "Il6 primers", symbol: "Il6", species: "mouse" }, { target: "Cxcl1", symbol: "Cxcl1", species: "mouse" }, { target: "Gapdh", symbol: "Gapdh", species: "mouse" }];
  const m = GS.matchSets([{ name: "S", genes: ["IL6", "CXCL1", "TNF", "IL1B"] }], panel);
  assert.deepEqual(m.sets[0].genes, ["Il6 primers", "Cxcl1"]);
  assert.equal(m.sets[0].total, 4);
  assert.equal(m.offPanel, 2);
  assert.deepEqual(m.unusedPanel, ["Gapdh"]);
  const fly = GS.matchSets([{ name: "F", genes: ["dl", "Dl2"] }], [{ target: "Dl", symbol: "Dl", species: "fly" }, { target: "dl", symbol: "dl", species: "fly" }]);
  assert.deepEqual(fly.sets[0].genes, ["dl"]);
});
test("GO sets group panel genes that share a term; identical sets are tested once", () => {
  const panel = [{ target: "A", go: ["GO:0000001 one", "GO:0000002 two"] }, { target: "B", go: ["GO:0000001 one", "GO:0000002 two"] }, { target: "C", go: ["GO:0000003 three"] }];
  const sets = GS.collapseIdentical(GS.goSets(panel));
  assert.equal(sets.length, 2);
  assert.deepEqual(sets[0], { name: "GO:0000001 one", genes: ["A", "B"], total: 2, also: ["GO:0000002 two"] });
});

// ---------------------------------------------------------------- the gene lookup asks for GO terms only when ticked
test("lookup asks for GO terms only when asked, from the same host, and keeps descriptions unchanged", async () => {
  const urls = [];
  const hit = { symbol: "ACTB", name: "actin beta", entrezgene: 60, summary: "", go: { BP: [{ id: "GO:0007015", term: "actin filament organization", evidence: "IDA" }, { id: "GO:0000001", term: "x", qualifier: "NOT involved_in" }, { id: "GO:0007015", term: "actin filament organization", evidence: "IEA" }] } };
  const fetch = async url => { urls.push(url); return { ok: true, json: async () => ({ hits: [hit] }) }; };
  const plain = await G.lookupGene("ACTB", { fetch, now: "t" }), withGo = await G.lookupGene("ACTB", { fetch, now: "t", go: true });
  assert.ok(!/go\.BP/.test(urls[0]) && /go\.BP\.id/.test(urls[1]));
  assert.ok(urls.every(u => u.startsWith("https://mygene.info/v3/query?q=symbol%3AACTB&")));
  assert.equal(plain.go, undefined);
  assert.deepEqual(withGo.go, ["GO:0007015 actin filament organization"]);
  assert.equal(withGo.description, plain.description); // human descriptions never come from GO
  const t = G.cleanTargets({ ACTB: { symbol: "ACTB", go: [...withGo.go, "junk", 5, "GO:123 short"] } });
  assert.deepEqual(t.ACTB.go, ["GO:0007015 actin filament organization"]);
});

// ---------------------------------------------------------------- the sample run, end to end
function sampleRun(gsea) {
  const text = readFileSync(new URL("../sample-data/8 Pathway panel 384 TNF vs control - results.csv", import.meta.url), "utf8");
  const e = C.newExperiment({ title: "panel" }, "tester");
  e.source = C.fileRecord({ name: "panel.csv", text, sha: "x", format: "generic-ct-csv" });
  const res = C.analyze(e);
  e.analysis = C.cleanAnalysisSettings({ on: true, refs: ["ACTB", "B2M", "GAPDH", "HPRT1", "RPLP0"], control: "control", gsea });
  return { e, res };
}
test("sample run 8: the planted NF-κB shift comes out on top with both methods", () => {
  const gmt = GS.parseGmt(readFileSync(new URL("../sample-data/8 Pathway panel gene sets.gmt", import.meta.url), "utf8"));
  const { e, res } = sampleRun({});
  const m = GS.matchSets(gmt.sets, GS.panelFromRun(e, res.rows));
  for (const method of ["auto", "rank"]) {
    e.analysis = C.cleanAnalysisSettings({ ...e.analysis, gsea: { source: "gmt", method, gmt: { name: "x", sets: m.sets, read: gmt.sets.length, offPanel: m.offPanel } } });
    const a = A.analyzeRun(e, res), r = GS.gseaForRun(e, res, a);
    assert.equal(r.ok, true);
    assert.equal(r.N, 91);
    assert.equal(r.method, method === "auto" ? "gsea" : "rank");
    assert.equal(r.rows[0].name, "NFKB_TARGETS");
    assert.equal(r.rows[0].direction, "up");
    assert.ok(r.rows[0].q < 0.01);
    assert.ok(r.rows.slice(1).every(x => !(x.q < 0.05)), "nothing else stands out");
    assert.deepEqual(r.dropped.large, ["ALL_PANEL_SIGNALLING"]);
    assert.deepEqual(r.dropped.small, ["MTOR_AXIS_SMALL"]);
    assert.match(R.reportHtml(e, res), /Gene set enrichment/);
    assert.match(GS.gseaCsv(r), /^gene_set,/);
  }
});
test("defaults change nothing: no gene sets chosen, no enrichment and no report section", () => {
  const { e, res } = sampleRun(undefined);
  assert.equal(e.analysis.gsea.source, "");
  const a = A.analyzeRun(e, res);
  assert.equal(GS.gseaForRun(e, res, a).ok, false);
  assert.doesNotMatch(R.reportHtml(e, res), /Gene set enrichment/);
});
test("settings are cleaned", () => {
  const g = C.cleanAnalysisSettings({ gsea: { source: "evil", method: "x", minSize: -1, nperm: 5, seed: 0.5, custom: [{ name: "a", genes: ["X", 5, ""] }, { name: "", genes: ["Y"] }, null], gmt: { name: "f", sets: [{ name: "s", genes: [] }] } } }).gsea;
  assert.deepEqual([g.source, g.method, g.minSize, g.nperm, g.seed, g.gmt], ["", "auto", 3, 1000, 1, null]);
  assert.deepEqual(g.custom, [{ name: "a", genes: ["X"] }]);
});
