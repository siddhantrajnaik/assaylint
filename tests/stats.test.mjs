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
