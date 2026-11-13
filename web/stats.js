// Small statistics library for the analysis module. Pure functions, no DOM.
// Checked against SciPy reference values in tests/stats.test.mjs (fixtures made by testdata/make-stats-reference.py).
// Functions return null where a value can't be worked out (too few values, no spread), never NaN.

const fin = x => typeof x === "number" && Number.isFinite(x);
const nums = xs => (Array.isArray(xs) ? xs.filter(fin) : []);

export function mean(xs) {
  const v = nums(xs);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
// Sample variance (n − 1 in the denominator). Two passes, so large Ct values don't lose precision.
export function variance(xs) {
  const v = nums(xs);
  if (v.length < 2) return null;
  const m = mean(v);
  return v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1);
}
export function sd(xs) { const s2 = variance(xs); return s2 === null ? null : Math.sqrt(s2); }
export function sem(xs) { const s = sd(xs); return s === null ? null : s / Math.sqrt(nums(xs).length); }

// ---------------------------------------------------------------- special functions
// log Γ(x) for x > 0: Lanczos approximation (g = 7, 9 coefficients), relative error around 1e-15.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
export function lgamma(x) {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);

// Continued fraction for the incomplete beta function (modified Lentz method).
function betacf(a, b, x) {
  const TINY = 1e-300, EPS = 1e-16;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 10000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
// Regularised incomplete beta I_x(a, b). y = 1 − x may be passed separately when it is known more precisely than 1 − x.
export function ibeta(x, a, b, y = 1 - x) {
  if (!(x >= 0 && x <= 1) || !(a > 0) || !(b > 0)) return NaN;
  if (x === 0) return 0;
  if (y === 0 || x === 1) return 1;
  const front = Math.exp(a * Math.log(x) + b * Math.log(y) - lbeta(a, b));
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, y)) / b;
}
// Two-sided p for Student's t with df degrees of freedom (df may be fractional, as in Welch's test).
export function tTwoSided(t, df) {
  if (!fin(t) || !(df > 0)) return null;
  const t2 = t * t;
  // P(|T| > |t|) = I_{df/(df+t²)}(df/2, 1/2)
  return Math.min(1, ibeta(df / (df + t2), df / 2, 0.5, t2 / (df + t2)));
}
// Upper tail P(F > f) of the F distribution with (d1, d2) degrees of freedom.
export function fUpper(f, d1, d2) {
  if (!fin(f) || !(d1 > 0) || !(d2 > 0)) return null;
  if (f <= 0) return 1;
  // P(F > f) = I_{d2/(d2+d1 f)}(d2/2, d1/2)
  const den = d2 + d1 * f;
  return ibeta(d2 / den, d2 / 2, d1 / 2, (d1 * f) / den);
}
// Lower tail of Student's t, for completeness: P(T ≤ t).
export function tCdf(t, df) {
  if (!fin(t) || !(df > 0)) return null;
  const t2 = t * t, half = 0.5 * ibeta(df / (df + t2), df / 2, 0.5, t2 / (df + t2));
  return t > 0 ? 1 - half : half;
}

// ---------------------------------------------------------------- tests
// Welch's unequal-variance t-test (Welch 1947), two-sided. a and b are arrays of numbers.
export function welch(a, b) {
  const x = nums(a), y = nums(b), n1 = x.length, n2 = y.length;
  const out = { t: null, df: null, p: null, n1, n2, mean1: mean(x), mean2: mean(y), diff: null };
  if (n1 < 2 || n2 < 2) return { ...out, reason: "each group needs at least two values" };
  out.diff = out.mean1 - out.mean2;
  const v1 = variance(x) / n1, v2 = variance(y) / n2, se2 = v1 + v2;
  if (!(se2 > 0)) return { ...out, reason: "no spread in either group" };
  out.t = out.diff / Math.sqrt(se2);
  out.df = (se2 * se2) / ((v1 * v1) / (n1 - 1) + (v2 * v2) / (n2 - 1));
  out.p = tTwoSided(out.t, out.df);
  return out;
}
// One-way ANOVA (equal variances assumed, as in the classic F test). groups is an array of arrays.
export function anova(groups) {
  const gs = (Array.isArray(groups) ? groups : []).map(nums).filter(g => g.length);
  const k = gs.length, N = gs.reduce((a, g) => a + g.length, 0);
  const out = { F: null, df1: k - 1, df2: N - k, p: null, k, N };
  if (k < 2 || N - k < 1) return { ...out, reason: "needs at least two groups and more values than groups" };
  const grand = gs.flat().reduce((a, b) => a + b, 0) / N;
  let ssb = 0, ssw = 0;
  for (const g of gs) {
    const m = mean(g);
    ssb += g.length * (m - grand) ** 2;
    for (const v of g) ssw += (v - m) ** 2;
  }
  if (!(ssw > 0)) return { ...out, reason: "no spread within groups" };
  out.F = (ssb / (k - 1)) / (ssw / (N - k));
  out.p = fUpper(out.F, k - 1, N - k);
  return out;
}

// ---------------------------------------------------------------- multiple testing
// Both take an array of p values (null entries stay null and are not counted) and return adjusted values, capped at 1.
export function bonferroni(ps) {
  const m = ps.filter(fin).length;
  return ps.map(p => (fin(p) ? Math.min(1, p * m) : null));
}
// Benjamini & Hochberg (1995) step-up adjustment, as in R's p.adjust(method = "BH").
export function benjaminiHochberg(ps) {
  const idx = ps.map((p, i) => [p, i]).filter(([p]) => fin(p)).sort((a, b) => b[0] - a[0]);
  const m = idx.length, out = ps.map(() => null);
  let min = 1;
  idx.forEach(([p, i], j) => { const rank = m - j; min = Math.min(min, (p * m) / rank); out[i] = Math.min(1, min); });
  return out;
}
