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

// ---------------------------------------------------------------- more distributions
// Regularised incomplete gamma Q(a, x) = 1 − P(a, x): power series below a + 1, continued fraction
// (modified Lentz) above it, as in Numerical Recipes. Used for the normal and chi-square tails.
function gammaSeries(a, x) {
  let sum = 1 / a, del = sum, ap = a;
  for (let n = 1; n <= 10000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-17) break; }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaCf(a, x) {
  const TINY = 1e-300;
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i <= 10000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
export function gammaQ(a, x) { return x <= 0 ? 1 : x < a + 1 ? 1 - gammaSeries(a, x) : gammaCf(a, x); }
// Standard normal upper tail P(Z > z), through erfc(x) = Q(1/2, x²), and the CDF.
export function normSf(z) {
  if (Number.isNaN(z) || typeof z !== "number") return null;
  if (!Number.isFinite(z)) return z > 0 ? 0 : 1;
  const q = 0.5 * gammaQ(0.5, (z * z) / 2);
  return z >= 0 ? q : 1 - q;
}
export function normCdf(z) { return normSf(-z); }
// Upper tail of chi-square with df degrees of freedom.
export function chi2Sf(x, df) {
  if (!fin(x) || !(df > 0)) return null;
  return x <= 0 ? 1 : gammaQ(df / 2, x / 2);
}

// Gauss–Legendre nodes and weights on [−1, 1] (Newton's method on the Legendre polynomial).
function gaussLegendre(n) {
  const x = new Float64Array(n), w = new Float64Array(n);
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1, p2 = 0;
      for (let j = 1; j <= n; j++) { const p3 = p2; p2 = p1; p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j; }
      dp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / dp;
      z -= dz;
      if (Math.abs(dz) < 1e-15) break;
    }
    x[i] = -z; x[n - 1 - i] = z;
    w[i] = w[n - 1 - i] = 2 / ((1 - z * z) * dp * dp);
  }
  return { x, w };
}
const GL = gaussLegendre(16);
// ∫ f over [a, b], split into `panels` pieces with 16-point Gauss–Legendre on each.
function integrate(f, a, b, panels) {
  const h = (b - a) / panels;
  let s = 0;
  for (let p = 0; p < panels; p++) {
    const mid = a + (p + 0.5) * h;
    for (let i = 0; i < 16; i++) s += GL.w[i] * f(mid + 0.5 * h * GL.x[i]);
  }
  return 0.5 * h * s;
}
// Density of u = S/σ, where S² is a variance estimate on df degrees of freedom (u = sqrt(χ²_df / df)),
// and an interval that holds all but a negligible part of it (well under 1e-12).
function sDensity(df) {
  const c = Math.log(2) + (df / 2) * Math.log(df / 2) - lgamma(df / 2);
  const f = u => (u <= 0 ? 0 : Math.exp(c + (df - 1) * Math.log(u) - (df * u * u) / 2));
  const sd = 1 / Math.sqrt(2 * df);
  return { f, lo: Math.max(0, 1 - 14 * sd), hi: Math.sqrt((df + 12 * Math.sqrt(2 * df) + 60) / df) };
}

// ---------------------------------------------------------------- studentized range (Tukey)
// ptukey(q, k, df) = P(range of k standard normals / u ≤ q), ported from R's ptukey (Copenhaver & Holland 1988):
// wprob() is the CDF of the range of k normals (Hartley's form, Gauss–Legendre), and ptukey() integrates it over
// the distribution of the variance estimate. Up to 100 df (and for df < 2, which R's version can't do) I integrate
// wprob over the density of u directly with the quadrature used for Dunnett's test instead; R's outer integral is
// used above 100 df.
const W_X = [0.981560634246719250690549090149, 0.904117256370474856678465866119, 0.769902674194304687036893833213,
  0.587317954286617447296702418941, 0.367831498998180193752691536644, 0.125233408511468915472441369464];
const W_A = [0.047175336386511827194615961485, 0.106939325995318430960254718194, 0.160078328543346226334652529543,
  0.203167426723065921749064455810, 0.233492536538354808760849898925, 0.249147045813402785000562436043];
function wprob(w, rr, cc) {
  const nleg = 12, ihalf = 6, C1 = -30, C2 = -50, C3 = 60, bb = 8, wlar = 3;
  const qsqz = w * 0.5;
  if (qsqz >= bb) return 1;
  let prw = 2 * normCdf(qsqz) - 1;
  prw = prw >= Math.exp(C2 / cc) ? prw ** cc : 0;
  const wincr = w > wlar ? 2 : 3, binc = (bb - qsqz) / wincr, cc1 = cc - 1;
  let blb = qsqz, bub = blb + binc, einsum = 0;
  for (let wi = 1; wi <= wincr; wi++) {
    let elsum = 0;
    const a = 0.5 * (bub + blb), b = 0.5 * (bub - blb);
    for (let jj = 1; jj <= nleg; jj++) {
      let j, xx;
      if (ihalf < jj) { j = nleg - jj + 1; xx = W_X[j - 1]; } else { j = jj; xx = -W_X[j - 1]; }
      const ac = a + b * xx, qexpo = ac * ac;
      if (qexpo > C3) break;
      const rinsum = normCdf(ac) - normCdf(ac - w);
      if (rinsum >= Math.exp(C1 / cc1)) elsum += W_A[j - 1] * Math.exp(-(0.5 * qexpo)) * rinsum ** cc1;
    }
    elsum *= (2 * b * cc) / Math.sqrt(2 * Math.PI);
    einsum += elsum;
    blb = bub; bub += binc;
  }
  prw += einsum;
  if (prw <= Math.exp(C1 / rr)) return 0;
  prw = prw ** rr;
  return prw >= 1 ? 1 : prw;
}
const Q_X = [0.989400934991649932596154173450, 0.944575023073232576077988415535, 0.865631202387831743880467897712,
  0.755404408355003033895101194847, 0.617876244402643748446671764049, 0.458016777657227386342419442984,
  0.281603550779258913230460501460, 0.950125098376374401853193354250e-1];
const Q_A = [0.271524594117540948517805724560e-1, 0.622535239386478928628438369944e-1, 0.951585116824927848099251076022e-1,
  0.124628971255533872052476282192, 0.149595988816576732081501730547, 0.169156519395002538189312079030,
  0.182603415044923588866763667969, 0.189450610455068496285396723208];
export function ptukey(q, k, df) {
  if (typeof q !== "number" || Number.isNaN(q) || !(k >= 2) || !(df >= 1)) return null;
  if (q <= 0) return 0;
  if (q === Infinity) return 1;
  if (df > 25000) return wprob(q, 1, k);
  if (df <= 100) {
    // R's outer quadrature loses accuracy at small df (errors up to about 2e-6 near df = 3, which matters for the
    // fractional df of Games–Howell), so up to 100 df I integrate wprob over the density of u directly.
    const d = sDensity(df);
    return Math.min(1, integrate(u => d.f(u) * wprob(q * u, 1, k), d.lo, d.hi, df < 2 ? 64 : 32));
  }
  const f2 = df * 0.5, f21 = f2 - 1, ff4 = df * 0.25;
  const ulen = df <= 100 ? 1 : df <= 800 ? 0.5 : df <= 5000 ? 0.25 : 0.125;
  const f2lf = f2 * Math.log(df) - df * Math.LN2 - lgamma(f2) + Math.log(ulen);
  let ans = 0;
  for (let i = 1; i <= 50; i++) {
    let otsum = 0;
    const twa1 = (2 * i - 1) * ulen;
    for (let jj = 1; jj <= 16; jj++) {
      const up = jj > 8, j = up ? jj - 9 : jj - 1, xu = Q_X[j] * ulen;
      const t1 = up ? f2lf + f21 * Math.log(twa1 + xu) - (xu + twa1) * ff4 : f2lf + f21 * Math.log(twa1 - xu) + (xu - twa1) * ff4;
      if (t1 >= -30) otsum += wprob(q * Math.sqrt(((up ? xu : -xu) + twa1) * 0.5), 1, k) * Q_A[j] * Math.exp(t1);
    }
    if (i * ulen >= 1 && otsum <= 1e-14) break;
    ans += otsum;
  }
  return Math.min(1, ans);
}
// Upper tail P(Q ≥ q) of the studentized range.
export function tukeySf(q, k, df) { const c = ptukey(q, k, df); return c === null ? null : Math.max(0, 1 - c); }

// ---------------------------------------------------------------- more t-tests
// One-sample t-test of mean = mu, two-sided.
export function oneSample(a, mu = 0) {
  const x = nums(a), n = x.length;
  const out = { t: null, df: null, p: null, n, mean: mean(x), diff: null };
  if (n < 2) return { ...out, reason: "needs at least two values" };
  out.diff = out.mean - mu;
  const se = Math.sqrt(variance(x) / n);
  if (!(se > 0)) return { ...out, reason: "no spread in the values" };
  out.t = out.diff / se; out.df = n - 1; out.p = tTwoSided(out.t, out.df);
  return out;
}
// Paired t-test: the one-sample t-test on the differences a[i] − b[i]. Pairs with a missing value are dropped.
export function paired(a, b) {
  const d = [];
  for (let i = 0; i < Math.min(a?.length || 0, b?.length || 0); i++) if (fin(a[i]) && fin(b[i])) d.push(a[i] - b[i]);
  const r = oneSample(d, 0);
  const reason = d.length < 2 ? "needs at least two complete pairs" : r.reason === "no spread in the values" ? "every pair has the same difference" : r.reason;
  return { ...r, pairs: d.length, ...(reason ? { reason } : {}) };
}
// Student's two-sample t-test with pooled variance (equal variances assumed), two-sided.
export function student(a, b) {
  const x = nums(a), y = nums(b), n1 = x.length, n2 = y.length;
  const out = { t: null, df: null, p: null, n1, n2, mean1: mean(x), mean2: mean(y), diff: null };
  if (n1 < 1 || n2 < 1 || n1 + n2 < 3) return { ...out, reason: "needs one value in each group and at least three in all" };
  out.diff = out.mean1 - out.mean2;
  const df = n1 + n2 - 2, ss = (n1 > 1 ? variance(x) * (n1 - 1) : 0) + (n2 > 1 ? variance(y) * (n2 - 1) : 0);
  const se = Math.sqrt((ss / df) * (1 / n1 + 1 / n2));
  if (!(se > 0)) return { ...out, reason: "no spread within the groups" };
  out.t = out.diff / se; out.df = df; out.p = tTwoSided(out.t, df);
  return out;
}

// Pooled within-group variance over every group (the ANOVA mean square error) and its df.
function pooled(gs) {
  let ss = 0, n = 0;
  for (const g of gs) { const m = mean(g); for (const v of g) ss += (v - m) ** 2; n += g.length; }
  const df = n - gs.length;
  return { mse: df > 0 ? ss / df : null, df };
}

// ---------------------------------------------------------------- Tukey HSD
// All pairwise comparisons (Tukey 1949; the Tukey–Kramer form for unequal n, as scipy.stats.tukey_hsd):
// q = |mean_i − mean_j| / sqrt(MSE/2 · (1/n_i + 1/n_j)), p = P(Q(k, N − k) ≥ q), MSE pooled over all k groups.
// Returns { pairs: [{ i, j, diff, q, p }], k, df, mse }. Empty groups are skipped; i and j index the input.
export function tukeyHsd(groups) {
  const all = (Array.isArray(groups) ? groups : []).map(nums), idx = all.map((_, i) => i).filter(i => all[i].length);
  const gs = idx.map(i => all[i]), k = gs.length, { mse, df } = pooled(gs);
  const out = { pairs: [], k, df, mse };
  if (k < 2 || !(df >= 1)) return { ...out, reason: "needs at least two groups and more values than groups" };
  if (!(mse > 0)) return { ...out, reason: "no spread within groups" };
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
    const diff = mean(gs[a]) - mean(gs[b]), q = Math.abs(diff) / Math.sqrt((mse / 2) * (1 / gs[a].length + 1 / gs[b].length));
    out.pairs.push({ i: idx[a], j: idx[b], diff, q, p: tukeySf(q, k, df) });
  }
  return out;
}

// ---------------------------------------------------------------- Dunnett
// Many-to-one comparisons with a control (Dunnett 1955), two-sided. groups[control] is the control.
// t_i = (mean_i − mean_0) / sqrt(MSE (1/n_i + 1/n_0)) with MSE pooled over all groups, and
// p_i = P(max_j |T_j| ≥ |t_i|) under the multivariate t with correlations ρ_ij = λ_i λ_j, λ_i = sqrt(n_i / (n_i + n_0)).
// Because the correlations have this product form (with equal or unequal n), the probability is exactly a
// two-dimensional integral (over the shared control mean and over the variance estimate), done by Gauss–Legendre.
export function dunnettCdf(c, lambdas, df) {
  if (!(c > 0)) return 0;
  const s = lambdas.map(l => Math.sqrt(1 - l * l)), d = sDensity(df), r2pi = Math.sqrt(2 * Math.PI);
  const inner = u => {
    const cu = c * u;
    return 2 * integrate(y => { // the integrand is even in y
      let prod = Math.exp(-0.5 * y * y) / r2pi;
      for (let i = 0; i < lambdas.length && prod > 0; i++) {
        const ly = lambdas[i] * y;
        prod *= normSf((-cu - ly) / s[i]) - normSf((cu - ly) / s[i]);
      }
      return prod;
    }, 0, 8.6, 6);
  };
  return Math.min(1, integrate(u => d.f(u) * inner(u), d.lo, d.hi, df < 3 ? 12 : 8));
}
export function dunnett(groups, control = 0) {
  const all = (Array.isArray(groups) ? groups : []).map(nums);
  const out = { comparisons: [], df: null, mse: null };
  if (!all[control]?.length) return { ...out, reason: "the control group has no values" };
  const idx = all.map((_, i) => i).filter(i => i !== control && all[i].length);
  const { mse, df } = pooled([all[control], ...idx.map(i => all[i])]);
  Object.assign(out, { df, mse });
  if (!idx.length || !(df >= 1)) return { ...out, reason: "needs a control, another group and more values than groups" };
  if (!(mse > 0)) return { ...out, reason: "no spread within groups" };
  const n0 = all[control].length, m0 = mean(all[control]);
  const lambdas = idx.map(i => Math.sqrt(all[i].length / (all[i].length + n0)));
  for (const i of idx) {
    const diff = mean(all[i]) - m0, t = diff / Math.sqrt(mse * (1 / all[i].length + 1 / n0));
    out.comparisons.push({ i, diff, t, p: Math.max(0, Math.min(1, 1 - dunnettCdf(Math.abs(t), lambdas, df))) });
  }
  return out;
}

// ---------------------------------------------------------------- rank tests
// Average ranks (ties share the mean of their ranks) and the sizes of the tie groups.
export function rank(xs) {
  const v = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]), r = new Array(xs.length), ties = [];
  for (let i = 0; i < v.length;) {
    let j = i;
    while (j + 1 < v.length && v[j + 1][0] === v[i][0]) j++;
    for (let k = i; k <= j; k++) r[v[k][1]] = (i + j) / 2 + 1;
    ties.push(j - i + 1);
    i = j + 1;
  }
  return { ranks: r, ties };
}
const tieSum = ties => ties.reduce((s, t) => s + t ** 3 - t, 0);
// Exact null distribution of U for sample sizes m and n without ties: counts[u], out of C(m + n, m) in total.
const mwuCache = new Map();
function mwuCounts(m, n) {
  const key = `${m},${n}`;
  if (mwuCache.has(key)) return mwuCache.get(key);
  let out;
  if (m === 0 || n === 0) out = [1];
  else {
    const a = mwuCounts(m - 1, n), b = mwuCounts(m, n - 1);
    out = new Array(m * n + 1).fill(0);
    a.forEach((c, u) => { out[u + n] += c; });
    b.forEach((c, u) => { out[u] += c; });
  }
  if (mwuCache.size < 5000) mwuCache.set(key, out);
  return out;
}
// Mann–Whitney U test (Mann & Whitney 1947), two-sided, as scipy.stats.mannwhitneyu(method="auto"):
// exact when there are no ties and at least one sample has 8 or fewer values; otherwise the normal approximation
// with the tie correction and a continuity correction. U is the statistic of the first sample.
export function mannWhitney(a, b) {
  const x = nums(a), y = nums(b), n1 = x.length, n2 = y.length;
  const out = { U: null, p: null, n1, n2, method: null, z: null };
  if (!n1 || !n2) return { ...out, reason: "each group needs at least one value" };
  const { ranks, ties } = rank([...x, ...y]);
  const U1 = ranks.slice(0, n1).reduce((s, r) => s + r, 0) - (n1 * (n1 + 1)) / 2, U = Math.max(U1, n1 * n2 - U1);
  out.U = U1;
  if ((n1 > 8 && n2 > 8) || ties.some(t => t > 1)) {
    const n = n1 + n2, num = U1 - (n1 * n2) / 2, s = Math.sqrt(((n1 * n2) / 12) * (n + 1 - tieSum(ties) / (n * (n - 1))));
    out.method = "normal approximation";
    if (!(s > 0)) return { ...out, reason: "all values are the same" };
    out.z = (num - 0.5 * Math.sign(num)) / s;
    out.p = Math.min(1, 2 * normSf(Math.abs(out.z)));
  } else {
    const c = mwuCounts(Math.min(n1, n2), Math.max(n1, n2));
    let tail = 0, total = 0;
    c.forEach((v, u) => { total += v; if (u >= U) tail += v; });
    out.method = "exact";
    out.p = Math.min(1, (2 * tail) / total);
  }
  return out;
}
// Kruskal–Wallis H test (Kruskal & Wallis 1952) with the tie correction; chi-square with k − 1 df.
export function kruskal(groups) {
  const gs = (Array.isArray(groups) ? groups : []).map(nums).filter(g => g.length), k = gs.length, N = gs.reduce((s, g) => s + g.length, 0);
  const out = { H: null, df: k - 1, p: null, k, N };
  if (k < 2 || N < 3) return { ...out, reason: "needs at least two groups and three values" };
  const { ranks, ties } = rank(gs.flat());
  let o = 0, h = 0;
  for (const g of gs) { const R = ranks.slice(o, o + g.length).reduce((s, r) => s + r, 0); h += (R * R) / g.length; o += g.length; }
  h = (12 / (N * (N + 1))) * h - 3 * (N + 1);
  const corr = 1 - tieSum(ties) / (N ** 3 - N);
  if (!(corr > 0)) return { ...out, reason: "all values are the same" };
  out.H = h / corr; out.p = chi2Sf(out.H, k - 1);
  return out;
}
// Dunn's test (Dunn 1964) after Kruskal–Wallis. Ranks are taken over all groups together; for groups i and j
// z = (mean rank_i − mean rank_j) / sqrt((N(N+1)/12 − Σ(t³ − t) / (12(N − 1))) · (1/n_i + 1/n_j)), p two-sided normal.
// pairs: the [i, j] index pairs to test (default: every group against group 0). Each comparison gets the raw p and
// the Bonferroni and Benjamini–Hochberg adjustments over the pairs tested.
export function dunn(groups, pairs = null) {
  const all = (Array.isArray(groups) ? groups : []).map(nums), N = all.reduce((s, g) => s + g.length, 0);
  const want = pairs || all.map((_, i) => [i, 0]).slice(1);
  const out = { comparisons: [], N };
  if (N < 3) return { ...out, reason: "needs at least three values" };
  const { ranks, ties } = rank(all.flat()), mr = [];
  let o = 0;
  for (const g of all) { mr.push(g.length ? ranks.slice(o, o + g.length).reduce((s, r) => s + r, 0) / g.length : null); o += g.length; }
  const v = (N * (N + 1)) / 12 - tieSum(ties) / (12 * (N - 1));
  for (const [i, j] of want) {
    if (!all[i]?.length || !all[j]?.length) continue;
    const se = Math.sqrt(v * (1 / all[i].length + 1 / all[j].length)), z = se > 0 ? (mr[i] - mr[j]) / se : null;
    out.comparisons.push({ i, j, diff: z === null ? null : mr[i] - mr[j], z, p: z === null ? null : Math.min(1, 2 * normSf(Math.abs(z))) });
  }
  const ps = out.comparisons.map(c => c.p), bh = benjaminiHochberg(ps), bf = bonferroni(ps);
  out.comparisons.forEach((c, k) => { c.pBH = bh[k]; c.pBonferroni = bf[k]; });
  return out;
}

// ---------------------------------------------------------------- quantiles and confidence intervals
// Quantile of Student's t: the t with P(T ≤ t) = p, by bisection on tCdf (to full double precision; cheap enough here).
export function tQuantile(p, df) {
  if (!(p > 0 && p < 1) || !(df > 0)) return null;
  if (p === 0.5) return 0;
  let lo = -1, hi = 1;
  while (tCdf(lo, df) > p) lo *= 2;
  while (tCdf(hi, df) < p) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    if (tCdf(mid, df) < p) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}
// Two-sided t-based confidence interval for a mean: mean ± t(1 − α/2, n − 1) · SD/√n.
export function meanCi(xs, level = 0.95) {
  const v = nums(xs), n = v.length, m = mean(v);
  if (n < 2) return { mean: m, low: null, high: null, df: null, se: null, reason: "needs at least two values" };
  const se = Math.sqrt(variance(v) / n), df = n - 1, h = tQuantile(0.5 + level / 2, df) * se;
  return { mean: m, low: m - h, high: m + h, df, se };
}
// Confidence interval for mean(a) − mean(b) with the Welch standard error and Welch–Satterthwaite df,
// as scipy.stats.ttest_ind(a, b, equal_var=False).confidence_interval().
export function welchCi(a, b, level = 0.95) {
  const x = nums(a), y = nums(b), r = welch(x, y);
  if (r.df === null) return { diff: r.diff, low: null, high: null, df: null, se: null, reason: r.reason };
  const se = Math.sqrt(variance(x) / x.length + variance(y) / y.length), h = tQuantile(0.5 + level / 2, r.df) * se;
  return { diff: r.diff, low: r.diff - h, high: r.diff + h, df: r.df, se };
}

// ---------------------------------------------------------------- Wilcoxon signed-rank test
// Exact null distribution of the signed-rank sum for n differences without ties: counts[w] of the 2^n sign patterns.
const srCache = new Map();
function signedRankCounts(n) {
  if (srCache.has(n)) return srCache.get(n);
  let c = [1];
  for (let k = 1; k <= n; k++) {
    const next = new Array(c.length + k).fill(0);
    c.forEach((v, w) => { next[w] += v; next[w + k] += v; });
    c = next;
  }
  srCache.set(n, c);
  return c;
}
// Wilcoxon (1945) signed-rank test on the paired differences a[i] − b[i] (or on a alone when b is not given), two-sided,
// as scipy.stats.wilcoxon with its defaults (zero_method="wilcox", correction=False, method="auto"):
// - zero differences are dropped before ranking (Wilcoxon's own rule, SciPy's "wilcox");
// - no ties and no zeros, up to 50 differences: exact distribution of the rank sum;
// - ties or zeros and 13 or fewer pairs: exact permutation test over all 2^n sign flips (SciPy's PermutationMethod,
//   which enumerates every flip when 2^n is below its 9999 resamples, so the p is deterministic);
// - otherwise the normal approximation with the tie correction and no continuity correction.
// W is the smaller of the positive and negative rank sums, as SciPy reports for a two-sided test.
export function wilcoxon(a, b = null) {
  const d = [];
  if (b === null) for (const x of nums(a)) d.push(x);
  else for (let i = 0; i < Math.min(a?.length || 0, b?.length || 0); i++) if (fin(a[i]) && fin(b[i])) d.push(a[i] - b[i]);
  const N = d.length, nz = d.filter(x => x !== 0), n = nz.length, zeros = N - n;
  const out = { W: null, p: null, pairs: N, zeros, n, method: null, z: null, rPlus: null, rMinus: null };
  if (N < 2) return { ...out, reason: "needs at least two complete pairs" };
  if (!n) return { ...out, reason: "every pair has the same value" };
  const { ranks, ties } = rank(nz.map(Math.abs)), hasTies = ties.some(t => t > 1);
  const rPlus = ranks.reduce((s, r, i) => s + (nz[i] > 0 ? r : 0), 0), rMinus = ranks.reduce((s, r, i) => s + (nz[i] < 0 ? r : 0), 0);
  Object.assign(out, { rPlus, rMinus, W: Math.min(rPlus, rMinus) });
  if (!hasTies && !zeros && N <= 50) {
    const c = signedRankCounts(n), total = 2 ** n;
    let sf = 0, cdf = 0;
    c.forEach((v, w) => { if (w >= Math.floor(rPlus)) sf += v; if (w <= Math.ceil(rPlus)) cdf += v; });
    out.method = "exact";
    out.p = Math.min(1, (2 * Math.min(sf, cdf)) / total);
  } else if (N <= 13) {
    // every sign pattern of the non-zero differences (a zero stays zero when flipped, so it changes nothing)
    const tol = Math.abs(rPlus) * 2.220446049250313e-14, total = 2 ** n;
    let le = 0, ge = 0;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) s += ranks[i];
      if (s <= rPlus + tol) le++;
      if (s >= rPlus - tol) ge++;
    }
    out.method = "exact (all sign flips)";
    out.p = Math.min(1, (2 * Math.min(le, ge)) / total);
  } else {
    const mn = (n * (n + 1)) / 4, se = Math.sqrt((n * (n + 1) * (2 * n + 1) - tieSum(ties) / 2) / 24);
    out.method = "normal approximation";
    if (!(se > 0)) return { ...out, reason: "no spread in the differences" };
    out.z = (rPlus - mn) / se;
    out.p = Math.min(1, 2 * normSf(Math.abs(out.z)));
  }
  return out;
}
// The smallest two-sided p the signed-rank test can give with n non-zero differences (all of one sign).
export const wilcoxonMinP = n => (n >= 1 ? Math.min(1, 2 / 2 ** n) : 1);

// ---------------------------------------------------------------- Welch's ANOVA and Games–Howell
// Welch's (1951) one-way ANOVA without equal variances. With w_i = n_i / s_i², W = Σ w_i, m* = Σ w_i m_i / W and
// Λ = Σ (1 − w_i/W)² / (n_i − 1): F = [Σ w_i (m_i − m*)² / (k − 1)] / [1 + 2(k − 2)Λ / (k² − 1)],
// df1 = k − 1, df2 = (k² − 1) / (3Λ). Same as pingouin.welch_anova and R's oneway.test(var.equal = FALSE).
export function welchAnova(groups) {
  const gs = (Array.isArray(groups) ? groups : []).map(nums).filter(g => g.length), k = gs.length;
  const out = { F: null, df1: k - 1, df2: null, p: null, k, N: gs.reduce((a, g) => a + g.length, 0) };
  if (k < 2) return { ...out, reason: "needs at least two groups" };
  if (gs.some(g => g.length < 2)) return { ...out, reason: "each group needs at least two values" };
  if (gs.some(g => !(variance(g) > 0))) return { ...out, reason: "a group has no spread" };
  const w = gs.map(g => g.length / variance(g)), W = w.reduce((a, b) => a + b, 0), m = gs.map(mean);
  const mStar = w.reduce((s, wi, i) => s + wi * m[i], 0) / W;
  const A = w.reduce((s, wi, i) => s + wi * (m[i] - mStar) ** 2, 0) / (k - 1);
  const lam = w.reduce((s, wi, i) => s + (1 - wi / W) ** 2 / (gs[i].length - 1), 0);
  out.F = A / (1 + (2 * (k - 2) * lam) / (k * k - 1));
  out.df2 = (k * k - 1) / (3 * lam);
  out.p = fUpper(out.F, out.df1, out.df2);
  return out;
}
// Games & Howell (1976) pairwise comparisons for unequal variances: for groups i and j
// t = (m_i − m_j) / sqrt(s_i²/n_i + s_j²/n_j), Welch–Satterthwaite df, and p = P(Q(k, df) ≥ |t|·√2) from the
// studentized range, k being the number of groups. Same as pingouin.pairwise_gameshowell.
export function gamesHowell(groups) {
  const all = (Array.isArray(groups) ? groups : []).map(nums), idx = all.map((_, i) => i).filter(i => all[i].length);
  const k = idx.length, out = { pairs: [], k };
  if (k < 2) return { ...out, reason: "needs at least two groups" };
  if (idx.some(i => all[i].length < 2)) return { ...out, reason: "each group needs at least two values" };
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) {
    const r = welch(all[idx[a]], all[idx[b]]);
    if (r.t === null) { out.pairs.push({ i: idx[a], j: idx[b], diff: r.diff, t: null, q: null, df: null, p: null, reason: r.reason }); continue; }
    const q = Math.abs(r.t) * Math.SQRT2;
    out.pairs.push({ i: idx[a], j: idx[b], diff: r.diff, t: r.t, q, df: r.df, p: tukeySf(q, k, r.df) });
  }
  return out;
}

// ---------------------------------------------------------------- two-way ANOVA (type II sums of squares)
// Residual sum of squares and rank of the least-squares fit of y on the columns of X (an array of columns),
// by modified Gram–Schmidt, orthogonalising twice; a column that is (nearly) a combination of earlier ones is dropped.
function lsFit(cols, y) {
  const q = [], r = y.slice();
  for (const c0 of cols) {
    const c = c0.slice(), n0 = Math.sqrt(c.reduce((s, v) => s + v * v, 0));
    if (!(n0 > 0)) continue;
    for (let pass = 0; pass < 2; pass++) for (const u of q) {
      const dot = u.reduce((s, v, i) => s + v * c[i], 0);
      for (let i = 0; i < c.length; i++) c[i] -= dot * u[i];
    }
    const nn = Math.sqrt(c.reduce((s, v) => s + v * v, 0));
    if (nn <= 1e-9 * n0) continue;
    const u = c.map(v => v / nn);
    q.push(u);
    for (let pass = 0; pass < 2; pass++) {
      const dot = u.reduce((s, v, i) => s + v * r[i], 0);
      for (let i = 0; i < r.length; i++) r[i] -= dot * u[i];
    }
  }
  return { rss: r.reduce((s, v) => s + v * v, 0), rank: q.length };
}
// Two-way ANOVA of y on factors a and b (arrays of labels, one per value), with type II sums of squares as
// statsmodels anova_lm(typ=2): each main effect is tested after the other main effect (ignoring the interaction),
// the interaction after both main effects; every F uses the residual mean square of the full model.
// Works for balanced and unbalanced designs. With interaction: true the model is a + b + a:b; the interaction is
// dropped (with a note) when a combination of levels has no values, or when no residual df would be left.
// terms: [{ term: "a" | "b" | "ab", ss, df, F, p }].
export function twoWayAnova(y, a, b, { interaction = true } = {}) {
  const keep = (y || []).map((_, i) => i).filter(i => fin(y[i]) && a[i] != null && a[i] !== "" && b[i] != null && b[i] !== "");
  const Y = keep.map(i => y[i]), fa = keep.map(i => String(a[i])), fb = keep.map(i => String(b[i])), N = Y.length;
  const la = [...new Set(fa)], lb = [...new Set(fb)];
  const out = { terms: [], residual: null, interaction: false, N, levelsA: la, levelsB: lb, notes: [] };
  if (la.length < 2 || lb.length < 2) return { ...out, reason: "each factor needs at least two levels" };
  // centre y first so the sums of squares don't lose digits on large values
  const my = Y.reduce((s, v) => s + v, 0) / N, Yc = Y.map(v => v - my), ones = Y.map(() => 1);
  const dummies = (f, levels) => levels.slice(1).map(l => f.map(x => (x === l ? 1 : 0)));
  const A = dummies(fa, la), B = dummies(fb, lb), AB = A.flatMap(ca => B.map(cb => ca.map((v, i) => v * cb[i])));
  const cells = new Set(fa.map((x, i) => `${x}\u0000${fb[i]}`));
  let inter = interaction;
  if (inter && cells.size < la.length * lb.length) { inter = false; out.notes.push("some combinations of the two factors have no values, so the interaction can't be estimated and was left out"); }
  if (inter && N - la.length * lb.length < 1) { inter = false; out.notes.push("with one value per combination nothing is left to estimate the error once the interaction is in, so the interaction was left out"); }
  const fA = lsFit([ones, ...A], Yc), fB = lsFit([ones, ...B], Yc), fAB = lsFit([ones, ...A, ...B], Yc);
  const full = inter ? lsFit([ones, ...A, ...B, ...AB], Yc) : fAB;
  const dfr = N - full.rank;
  if (dfr < 1) return { ...out, reason: "no residual degrees of freedom are left" };
  const mse = full.rss / dfr;
  out.residual = { ss: full.rss, df: dfr, ms: mse };
  out.interaction = inter;
  const term = (name, ss, df) => {
    const F = df > 0 && mse > 0 ? Math.max(0, ss) / df / mse : null;
    out.terms.push({ term: name, ss: Math.max(0, ss), df, F, p: F === null ? null : fUpper(F, df, dfr) });
  };
  term("a", fB.rss - fAB.rss, fAB.rank - fB.rank);
  term("b", fA.rss - fAB.rss, fAB.rank - fA.rank);
  if (inter) term("ab", fAB.rss - full.rss, full.rank - fAB.rank);
  if (!(mse > 0)) out.reason = "no spread within the combinations of the two factors";
  return out;
}
