// web/stats.js against reference values from SciPy (tests/fixtures/stats-reference.json, made by testdata/make-stats-reference.py).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as S from "../web/stats.js";

const REF = JSON.parse(readFileSync(new URL("./fixtures/stats-reference.json", import.meta.url), "utf8"));
const TOL = 1e-10;
function close(got, want, what) {
  if (want === null) return assert.equal(got, null, `${what}: expected null, got ${got}`);
  assert.ok(typeof got === "number" && Number.isFinite(got), `${what}: expected ${want}, got ${got}`);
  const err = Math.abs(got - want) / Math.max(Math.abs(want), 1e-300);
  assert.ok(err <= TOL || Math.abs(got - want) <= 1e-300, `${what}: got ${got}, SciPy ${want} (relative error ${err.toExponential(2)})`);
}

test("the reference file was made by SciPy", () => {
  assert.match(REF.scipy, /^\d+\.\d+/);
  assert.ok(REF.welch.length >= 15 && REF.anova.length >= 10 && REF.adjust.length >= 10);
});

test("mean, SD and SEM match NumPy/SciPy", () => {
  for (const c of REF.descriptive) {
    close(S.mean(c.x), c.mean, `mean ${c.x}`);
    close(S.sd(c.x), c.sd, `sd ${c.x}`);
    close(S.sem(c.x), c.sem, `sem ${c.x}`);
  }
  assert.equal(S.mean([]), null);
  assert.equal(S.sd([5]), null);
  assert.equal(S.mean([1, NaN, 3, null]), 2, "non-numbers are ignored");
});

test("Student t and F tails match SciPy", () => {
  for (const c of REF.t_tails) {
    close(S.tTwoSided(c.t, c.df), c.p_two_sided, `two-sided p t=${c.t} df=${c.df}`);
    close(S.tCdf(c.t, c.df), c.cdf, `cdf t=${c.t} df=${c.df}`);
  }
  for (const c of REF.f_tails) close(S.fUpper(c.f, c.d1, c.d2), c.p_upper, `F=${c.f} (${c.d1}, ${c.d2})`);
  close(S.lgamma(0.5), Math.log(Math.sqrt(Math.PI)), "lgamma(1/2)");
  close(S.lgamma(10), Math.log(362880), "lgamma(10)");
});

test("Welch t-test matches scipy.stats.ttest_ind(equal_var=False)", () => {
  for (const c of REF.welch) {
    const r = S.welch(c.a, c.b);
    close(r.t, c.t, `t for ${c.a} vs ${c.b}`);
    close(r.df, c.df, `df for ${c.a} vs ${c.b}`);
    close(r.p, c.p, `p for ${c.a} vs ${c.b}`);
  }
  assert.equal(S.welch([1], [2, 3]).p, null, "n = 1 gives no p");
  assert.equal(S.welch([2, 2], [2, 2]).p, null, "no spread at all gives no p");
});

test("one-way ANOVA matches scipy.stats.f_oneway", () => {
  for (const c of REF.anova) {
    const r = S.anova(c.groups);
    close(r.F, c.F, `F for ${JSON.stringify(c.groups)}`);
    assert.equal(r.df1, c.df1); assert.equal(r.df2, c.df2);
    close(r.p, c.p, `p for ${JSON.stringify(c.groups)}`);
  }
  assert.equal(S.anova([[1, 2]]).p, null, "one group");
  assert.equal(S.anova([[1, 1], [2, 2]]).p, null, "no spread within groups");
});

test("Benjamini–Hochberg and Bonferroni match SciPy", () => {
  for (const c of REF.adjust) {
    S.benjaminiHochberg(c.p).forEach((v, i) => close(v, c.bh[i], `BH ${c.p}[${i}]`));
    S.bonferroni(c.p).forEach((v, i) => close(v, c.bonferroni[i], `Bonferroni ${c.p}[${i}]`));
  }
  assert.deepEqual(S.benjaminiHochberg([0.01, null, 0.04]), [0.02, null, 0.04], "missing p values stay missing and aren't counted");
  assert.deepEqual(S.bonferroni([0.01, null, 0.04]), [0.02, null, 0.08]);
});

// ---------------------------------------------------------------- tests added with the test choice in the Analysis step
// Worst disagreement per test, printed so docs/analysis.md can quote it.
const worst = {};
function track(name, got, want, { abs = false } = {}) {
  const e = abs ? Math.abs(got - want) : Math.abs(got - want) / Math.max(Math.abs(want), 1e-300);
  worst[name] = Math.max(worst[name] || 0, e);
  return e;
}
const closeAbs = (got, want, tol, what) => {
  assert.ok(typeof got === "number" && Number.isFinite(got), `${what}: expected ${want}, got ${got}`);
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, SciPy ${want} (absolute error ${Math.abs(got - want).toExponential(2)})`);
};

test("normal, chi-square and studentized range tails match SciPy", () => {
  for (const c of REF.norm_tails) { close(S.normSf(c.z), c.sf, `norm.sf(${c.z})`); track("normal tail", S.normSf(c.z), c.sf); }
  for (const c of REF.chi2_tails) { close(S.chi2Sf(c.x, c.df), c.sf, `chi2.sf(${c.x}, ${c.df})`); track("chi-square tail", S.chi2Sf(c.x, c.df), c.sf); }
  for (const c of REF.tukey_tails) {
    closeAbs(S.tukeySf(c.q, c.k, c.df), c.sf, 1e-6, `studentized_range.sf(${c.q}, ${c.k}, ${c.df})`);
    track("studentized range tail (absolute)", S.tukeySf(c.q, c.k, c.df), c.sf, { abs: true });
  }
  assert.equal(S.ptukey(0, 3, 10), 0);
  assert.equal(S.ptukey(NaN, 3, 10), null);
});

test("Student, one-sample and paired t-tests match SciPy", () => {
  for (const c of REF.student) {
    const r = S.student(c.a, c.b);
    close(r.t, c.t, `Student t ${c.a} vs ${c.b}`); close(r.df, c.df, "Student df"); close(r.p, c.p, `Student p ${c.a} vs ${c.b}`);
    track("Student t-test", r.p, c.p);
  }
  for (const c of REF.one_sample) {
    const r = S.oneSample(c.x, c.mu);
    close(r.t, c.t, `one-sample t ${c.x}`); close(r.p, c.p, `one-sample p ${c.x}`); assert.equal(r.df, c.df);
    track("one-sample t-test", r.p, c.p);
  }
  for (const c of REF.paired) {
    const r = S.paired(c.a, c.b);
    close(r.t, c.t, `paired t ${c.a} / ${c.b}`); close(r.p, c.p, `paired p ${c.a} / ${c.b}`); assert.equal(r.df, c.df);
    track("paired t-test", r.p, c.p);
  }
  assert.equal(S.student([1], [2]).p, null, "two values in all: no df");
  assert.equal(S.paired([1, 2, 3], [0, 1, 2]).p, null, "every pair has the same difference");
  assert.match(S.paired([1], [2]).reason, /two complete pairs/);
  assert.equal(S.paired([1, 2, null], [1.5, 2.2, 3]).pairs, 2, "an incomplete pair is dropped");
});

test("Tukey HSD matches scipy.stats.tukey_hsd", () => {
  for (const c of REF.tukey) {
    const r = S.tukeyHsd(c.groups);
    for (const want of c.pairs) {
      const got = r.pairs.find(x => x.i === want.i && x.j === want.j);
      closeAbs(got.p, want.p, 1e-6, `Tukey p ${JSON.stringify(c.groups)} [${want.i}, ${want.j}]`);
      track("Tukey HSD (absolute)", got.p, want.p, { abs: true });
    }
  }
  assert.equal(S.tukeyHsd([[1, 1], [2, 2]]).pairs.length, 0, "no spread within groups");
});

test("Dunnett matches scipy.stats.dunnett and reduces to Student's t with one comparison", () => {
  for (const c of REF.dunnett) {
    const r = S.dunnett(c.groups, 0);
    r.comparisons.forEach((x, k) => {
      close(x.t, c.t[k], `Dunnett t ${JSON.stringify(c.groups)}`);
      // SciPy's multivariate t CDF is quasi-Monte Carlo; mine is deterministic quadrature.
      closeAbs(x.p, c.p[k], 1e-4, `Dunnett p ${JSON.stringify(c.groups)} [${k}]`);
      track("Dunnett vs SciPy QMC (absolute)", x.p, c.p[k], { abs: true });
    });
  }
  // One treatment group: the multivariate t has one dimension, so p must equal Student's t exactly.
  for (const c of REF.student.filter(x => x.p !== null && x.a.length > 1 && x.b.length > 1)) {
    const p = S.dunnett([c.b, c.a], 0).comparisons[0].p;
    assert.ok(Math.abs(p - c.p) <= 1e-9, `Dunnett with one comparison: ${p} vs Student ${c.p}`);
    track("Dunnett with one comparison vs Student (absolute)", p, c.p, { abs: true });
  }
  assert.match(S.dunnett([[], [1, 2]]).reason, /control/);
});

test("Mann–Whitney U matches scipy.stats.mannwhitneyu(method='auto')", () => {
  for (const c of REF.mannwhitney) {
    const r = S.mannWhitney(c.a, c.b);
    close(r.U, c.U, `U ${c.a} vs ${c.b}`);
    if (c.p === null) { assert.equal(r.p, null, `all tied ${c.a} vs ${c.b}`); continue; }
    close(r.p, c.p, `p ${c.a} vs ${c.b} (${r.method})`);
    track(`Mann–Whitney (${r.method})`, r.p, c.p);
  }
  assert.equal(S.mannWhitney([1, 2, 3], [4, 5, 6]).method, "exact");
  assert.equal(S.mannWhitney([1, 2, 2], [4, 5, 6]).method, "normal approximation");
});

test("Kruskal–Wallis matches scipy.stats.kruskal; Dunn's test matches the formula written with SciPy", () => {
  for (const c of REF.kruskal) {
    const r = S.kruskal(c.groups);
    close(r.H, c.H, `H ${JSON.stringify(c.groups)}`); close(r.p, c.p, `p ${JSON.stringify(c.groups)}`);
    track("Kruskal–Wallis", r.p, c.p);
  }
  for (const c of REF.dunn) {
    const r = S.dunn(c.groups);
    c.comparisons.forEach((want, k) => {
      const got = r.comparisons[k];
      assert.equal(got.i, want.i);
      close(got.z, want.z, `Dunn z ${JSON.stringify(c.groups)}`); close(got.p, want.p, "Dunn p");
      close(got.pBH, want.p_bh, "Dunn p BH"); close(got.pBonferroni, want.p_bonferroni, "Dunn p Bonferroni");
      track("Dunn", got.p, want.p);
    });
  }
  assert.equal(S.kruskal([[1, 1], [1, 1]]).p, null, "all values the same");
});

test("report of the worst disagreement per test", () => {
  for (const [k, v] of Object.entries(worst)) console.log(`# worst ${k}: ${v.toExponential(2)}`);
});
