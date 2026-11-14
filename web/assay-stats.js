// Statistics across biological replicates for the assay calculations (ChIP % input, MSRE % methylation, 3C and so on).
// Each "set" in assays.js is one chromatin / DNA / lysate, so one biological replicate. The user says which condition
// each set belongs to (WT, KO …); here every region is compared between conditions with the tests in stats.js.
// Pure functions, no DOM: the page (ui-assays.js) and the report (assays.js) both use them.
// The method and the reasons for each scale are written up in docs/assays.md, "Comparing conditions".
import * as S from "./stats.js";

const fin = x => typeof x === "number" && Number.isFinite(x);
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

// Which numbers of each calculation can be compared, and on what scale the test runs.
// "log2": ratios and fold changes (the test is on log2, so on the same scale as the Ct values they came from).
// "pct": a share of 0–100% (logit by default, or raw; see PCT_SCALES). "raw": already a log-scale number (ΔCt, NPX).
export const METRICS = {
  enrichment: [["pctInput", "% input", "log2"], ["foldNeg", "Fold over the negative region", "log2"], ["foldIgG", "Fold over IgG", "log2"]],
  msre: [["pctMeth", "% methylated", "pct"]],
  pmr: [["pmr", "PMR", "log2"]],
  accessibility: [["index", "Accessibility / enrichment vs closed region", "log2"], ["pctLeft", "% left after digestion", "pct"]],
  threec: [["rcf", "Relative to the control interaction", "log2"], ["corrected", "Loading-corrected crosslinking frequency", "log2"]],
  fractions: [["pct", "% of total in each fraction", "pct"], ["polysomal", "Share in the polysome fractions", "pct"]],
  labelling: [["pctNew", "% new RNA", "pct"], ["pctPull", "% of total in the pulldown", "log2"]],
  signal: [["dCt", "ΔCt over blank", "raw"]],
  npx: [["npx", "NPX", "raw"]],
};
export const TESTS = {
  welch: { label: "Welch t-test (default)", short: "Welch t-test", help: "Doesn't assume the conditions have the same spread. With 3–6 replicates you can't check that, so it's the safe default." },
  student: { label: "Student t-test", short: "Student t-test", help: "Assumes both conditions have the same spread (pooled variance)." },
  mannwhitney: { label: "Mann–Whitney (rank test)", short: "Mann–Whitney", help: "Uses only the order of the values. With 3 replicates per condition the smallest possible p is 0.1, so it can never reach 0.05." },
  tukey: { label: "One-way ANOVA + Tukey (every pair)", short: "Tukey HSD", help: "For more than two conditions: every pair of conditions, with the p already adjusted within the region." },
  dunnett: { label: "One-way ANOVA + Dunnett (each vs control)", short: "Dunnett", help: "For more than two conditions: each condition against the control one, with the p already adjusted within the region." },
};
export const CORRECTIONS = { bh: "Benjamini–Hochberg", bonferroni: "Bonferroni" };
export const PCT_SCALES = { logit: "logit (M-value, default)", raw: "raw percentage" };

// ---------------------------------------------------------------- saved settings
// setup.cond = { [set]: condition }; setup.stats = { metric, test, correction, control, pctScale }.
const str = (v, n = 80) => (typeof v === "string" ? v.trim().slice(0, n) : "");
export function cleanConditions(x) {
  const out = {};
  if (!isObj(x)) return out;
  for (const [k, v] of Object.entries(x).slice(0, 1000)) {
    const c = str(v);
    if (k && k.length <= 200 && c) Object.defineProperty(out, k, { value: c, enumerable: true, writable: true, configurable: true });
  }
  return out;
}
export function cleanStats(x) {
  const s = isObj(x) ? x : {};
  return { metric: str(s.metric, 40), test: TESTS[s.test] ? s.test : "welch", correction: CORRECTIONS[s.correction] ? s.correction : "bh",
    control: str(s.control), pctScale: PCT_SCALES[s.pctScale] ? s.pctScale : "logit" };
}
// "WT-1", "WT rep2", "KO_3", "KO (3)" → "WT", "WT", "KO", "KO". Returns "" when there's no replicate number to take off.
export function guessCondition(set) {
  const s = String(set ?? "").trim(), m = /^(.*?)[\s_.-]*(?:\(?\s*(?:rep(?:licate)?|bio(?:rep)?|r|n|#)?\s*\d{1,3}\s*\)?)$/i.exec(s);
  const c = m ? m[1].replace(/[\s_.-]+$/, "").trim() : "";
  return c && c !== s ? c : "";
}

// ---------------------------------------------------------------- scales
const LOG2 = x => (x > 0 ? Math.log2(x) : null);
const LOGIT = x => (x > 0 && x < 100 ? Math.log2(x / (100 - x)) : null); // Du et al. 2010 M-value: log2(β / (1 − β)), β = % / 100
export function transformFor(scale) {
  if (scale === "log2") return { name: "log2", f: LOG2, why: "log2 of the value" };
  if (scale === "logit") return { name: "logit", f: LOGIT, why: "logit (M-value) of the percentage" };
  return { name: "raw", f: x => x, why: "the value as it is" };
}
const stars = p => (!fin(p) ? "" : p < 0.001 ? "***" : p < 0.01 ? "**" : p < 0.05 ? "*" : "ns");

// ---------------------------------------------------------------- the comparison
// out: the result of assays.runAssay (rows, summary, family key). setup: the cleaned assay setup. params: assay params.
// Returns null when fewer than two conditions are set; otherwise { metric, regions, comparisons, warnings, … }.
export function compareConditions(familyKey, out, setup, params = {}) {
  const cond = cleanConditions(setup?.cond), st = cleanStats(setup?.stats);
  const metrics = (METRICS[familyKey] || []).filter(([k]) => valuesFor(familyKey, out, k).some(v => fin(v.value)));
  const warnings = [];
  const warn = (level, text) => warnings.push({ level, text });
  if (!metrics.length) return null;
  const metric = metrics.find(m => m[0] === st.metric) || metrics[0];
  const [mKey, mLabel, mKind] = metric;
  const scale = mKind === "pct" ? st.pctScale : mKind;
  // Sets that are references inside the calculation, not biological replicates.
  const skip = new Set([params.calibratorSet, params.backgroundSet].filter(Boolean));
  const items = valuesFor(familyKey, out, mKey).filter(v => fin(v.value) && !skip.has(v.set) && cond[v.set]);
  for (const s of skip) if (cond[s]) warn("low", `${s} is the ${s === params.calibratorSet ? "fully methylated control" : "no-4sU background"} set, so it was left out of the comparison.`);
  const conds = [...new Set(items.map(v => cond[v.set]))].sort(byName);
  if (conds.length < 2) return conds.length || Object.keys(cond).length ? { metric: mKey, metricLabel: mLabel, metrics, scale, settings: st, conditions: conds, regions: [], comparisons: [], warnings: [{ level: "medium", text: "Give at least two conditions (for example WT and KO) to the sets to compare them." }] } : null;
  const control = conds.includes(st.control) ? st.control : conds[0];
  if (st.control && st.control !== control) warn("low", `The control condition “${st.control}” has no values for ${mLabel}, so ${control} is the control.`);
  const order = [control, ...conds.filter(c => c !== control)];
  const unassigned = [...new Set(valuesFor(familyKey, out, mKey).filter(v => fin(v.value) && !skip.has(v.set) && !cond[v.set]).map(v => v.set))];
  if (unassigned.length) warn("low", `Not in any condition, so left out: ${unassigned.join(", ")}.`);
  let test = st.test;
  if (order.length > 2 && test !== "tukey" && test !== "dunnett") warn("low", `${order.length} conditions: each is compared with ${control} by ${TESTS[test].short}, and the p values are adjusted across every comparison. One-way ANOVA + Dunnett or Tukey is made for this case.`);
  const regionNames = [...new Set(items.map(v => v.region))].sort(byName);
  const regions = [];
  for (const region of regionNames) {
    let tr = transformFor(scale);
    const its = items.filter(v => v.region === region);
    let note = "";
    if (scale === "logit" && its.some(v => tr.f(v.value) === null)) { tr = transformFor("raw"); note = "A value at or beyond 0% or 100% has no logit, so this region was tested on raw percentages."; }
    const dropped = its.filter(v => tr.f(v.value) === null);
    if (dropped.length) note = `${dropped.map(v => v.set).join(", ")}: ${mLabel} is 0 or below, which has no log, so ${dropped.length === 1 ? "it was" : "they were"} left out.`;
    const groups = order.map(c => {
      const vs = its.filter(v => cond[v.set] === c && tr.f(v.value) !== null).sort((a, b) => byName(a.set, b.set));
      const vals = vs.map(v => v.value), t = vs.map(v => tr.f(v.value));
      return { condition: c, n: vs.length, sets: vs.map(v => v.set), values: vals, tvalues: t, mean: S.mean(vals), sd: S.sd(vals), tmean: S.mean(t), tsd: S.sd(t) };
    });
    for (const g of groups) if (g.n === 1) warn("medium", `${region} / ${g.condition}: only one biological replicate, so there's no spread and no p value for it.`);
    else if (g.n === 2) warn("low", `${region} / ${g.condition}: two biological replicates. A p value from two is very uncertain; three or more is the usual minimum.`);
    const R = { region, groups, scale: tr.name, note, comparisons: [], anova: null };
    const T = groups.map(g => g.tvalues), ci = 0;
    const cmp = (i, j, p, diff, extra = {}) => R.comparisons.push({ region, a: order[i], b: order[j], i, j, p: fin(p) ? p : null, diff: fin(diff) ? diff : null, ...extra });
    if (test === "tukey") {
      const r = S.tukeyHsd(T);
      for (const pr of r.pairs) cmp(pr.i, pr.j, pr.p, -pr.diff); // tukeyHsd gives mean_i − mean_j; shown as later vs earlier
      if (!r.pairs.length) for (let j = 1; j < order.length; j++) cmp(ci, j, null, null, { reason: r.reason });
    } else if (test === "dunnett") {
      const r = S.dunnett(T, 0);
      for (const c of r.comparisons) cmp(0, c.i, c.p, c.diff);
      if (!r.comparisons.length) for (let j = 1; j < order.length; j++) cmp(0, j, null, null, { reason: r.reason });
    } else {
      for (let j = 1; j < order.length; j++) {
        const r = test === "student" ? S.student(T[j], T[0]) : test === "mannwhitney" ? S.mannWhitney(T[j], T[0]) : S.welch(T[j], T[0]);
        const diff = groups[j].n && groups[0].n ? groups[j].tmean - groups[0].tmean : null;
        cmp(0, j, r.p, diff, r.reason ? { reason: r.reason } : {});
      }
    }
    if (order.length > 2) {
      const a = test === "mannwhitney" ? S.kruskal(T) : S.anova(T);
      R.anova = { name: test === "mannwhitney" ? "Kruskal–Wallis" : "One-way ANOVA", stat: a.F ?? a.H ?? null, p: a.p ?? null, pAdj: null };
    }
    regions.push(R);
  }
  // Multiple testing across regions. t-tests and Mann–Whitney: every comparison in the table together.
  // Tukey and Dunnett already adjust within a region, so across regions only, one comparison (e.g. KO vs WT) at a time.
  const all = regions.flatMap(r => r.comparisons);
  const adj = ps => (st.correction === "bonferroni" ? S.bonferroni(ps) : S.benjaminiHochberg(ps));
  if (test === "tukey" || test === "dunnett") {
    const keys = [...new Set(all.map(c => `${c.a}\u0000${c.b}`))];
    for (const k of keys) { const cs = all.filter(c => `${c.a}\u0000${c.b}` === k), a = adj(cs.map(c => c.p)); cs.forEach((c, i) => { c.pAdj = a[i]; }); }
  } else { const a = adj(all.map(c => c.p)); all.forEach((c, i) => { c.pAdj = a[i]; }); }
  const an = regions.filter(r => r.anova), aa = adj(an.map(r => r.anova.p));
  an.forEach((r, i) => { r.anova.pAdj = aa[i]; });
  for (const c of all) {
    c.mark = stars(c.pAdj);
    const R = regions.find(r => r.region === c.region), A = R.groups[c.i], B = R.groups[c.j];
    c.effect = effectText(R.scale, mKind, A, B);
  }
  if (test === "mannwhitney" && regions.some(r => r.groups.every(g => g.n <= 3))) warn("medium", "With 3 or fewer replicates per condition the Mann–Whitney test can't give p below 0.1, so nothing can come out significant. A t-test on the log scale is the usual choice here.");
  if (!all.some(c => c.p !== null)) warn("medium", "No p value could be worked out: each condition needs at least two biological replicates with a value (and some spread).");
  return { metric: mKey, metricLabel: mLabel, metrics, scale, kind: mKind, settings: { ...st, test }, conditions: order, control, regions, comparisons: all, warnings };
}

// The values of one metric, one per set and region. Fractions are compared fraction by fraction.
export function valuesFor(familyKey, out, key) {
  if (!out) return [];
  if (familyKey === "fractions" && key === "polysomal") return (out.summary || []).map(s => ({ set: s.set, region: s.target, value: s.polysomal }));
  if (familyKey === "fractions") return (out.rows || []).map(r => ({ set: r.set, region: `${r.target} · fraction ${r.fraction}`, value: r[key] }));
  return (out.rows || []).filter(r => !(key === "foldNeg" && r.foldNeg === 1)).map(r => ({ set: r.set, region: r.target, value: r[key] }));
}
function effectText(scale, kind, A, B) {
  if (!A.n || !B.n) return "";
  if (scale === "log2") return `×${fmt(2 ** (B.tmean - A.tmean), 3)} (geometric means)`;
  const d = B.mean - A.mean;
  return `${d >= 0 ? "+" : "−"}${fmt(Math.abs(d), 2)}${kind === "pct" ? " points" : ""}`;
}
export const fmt = (x, d = 2) => (fin(x) ? (Math.abs(x) >= 1e5 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d)) : "—");
export const fmtP = p => (!fin(p) ? "—" : p < 0.0001 ? p.toExponential(1) : p.toFixed(4));
// Mean ± SD as shown in the tables: arithmetic, in the units of the result.
export const meanSd = g => (g.n ? `${fmt(g.mean, 3)} ± ${g.sd === null ? "—" : fmt(g.sd, 3)}` : "—");
export const scaleNote = c => c.scale === "log2" ? "log2 of the value (ratios become differences, like the Ct values they came from)"
  : c.scale === "logit" ? "logit of the percentage, log2(p / (100 − p)), the M-value of Du et al. 2010" : c.kind === "pct" ? "raw percentages" : "the value as it is (already on a log2 scale)";

// ---------------------------------------------------------------- tables and CSV
export function comparisonTable(c) {
  const head = ["Region", "Comparison", `${"Control"} mean ± SD (n)`, "Mean ± SD (n)", "Effect", "p", `p (${CORRECTIONS[c.settings.correction]})`, "Mark"];
  const rows = c.comparisons.map(x => {
    const R = c.regions.find(r => r.region === x.region), A = R.groups[x.i], B = R.groups[x.j];
    return [x.region, `${x.b} vs ${x.a}`, `${meanSd(A)} (${A.n})`, `${meanSd(B)} (${B.n})`, x.effect, fmtP(x.p) + (x.reason && x.p === null ? ` (${x.reason})` : ""), fmtP(x.pAdj), x.mark];
  });
  return { head, rows };
}
const csvCell = v => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) && !/^-?\d/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s; };
const csvNum = x => (fin(x) ? String(+x.toPrecision(10)) : "");
export function comparisonCsv(c) {
  const lines = [["region", "metric", "test", "test_scale", "condition_a", "n_a", "mean_a", "sd_a", "condition_b", "n_b", "mean_b", "sd_b", "difference_on_test_scale", "effect", "p", "p_adjusted", "correction", "mark"]];
  for (const x of c.comparisons) {
    const R = c.regions.find(r => r.region === x.region), A = R.groups[x.i], B = R.groups[x.j];
    lines.push([x.region, c.metricLabel, TESTS[c.settings.test].short, R.scale, x.a, A.n, csvNum(A.mean), csvNum(A.sd), x.b, B.n, csvNum(B.mean), csvNum(B.sd), csvNum(x.diff), x.effect, csvNum(x.p), csvNum(x.pAdj), CORRECTIONS[c.settings.correction], x.mark]);
  }
  lines.push([]);
  lines.push(["region", "condition", "set", "value", "value_on_test_scale"]);
  for (const R of c.regions) for (const g of R.groups) g.sets.forEach((s, k) => lines.push([R.region, g.condition, s, csvNum(g.values[k]), csvNum(g.tvalues[k])]));
  return lines.map(l => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- the graph, as a plain tree
// Each node is [tag, attrs, ...children]; a child string is text. svgString() turns it into markup for the report and
// the SVG download; ui-assays.js builds DOM nodes from the same tree (text nodes only).
const FONT = "Arial, Helvetica, sans-serif";
const COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#8C7A2B", "#4D4D4D"];
const t = (x, y, s, o = {}) => ["text", { x: r1(x), y: r1(y), "font-size": o.size || 11, "text-anchor": o.anchor || "middle", fill: o.fill || "#222222", ...(o.bold ? { "font-weight": "bold" } : {}), ...(o.rotate ? { transform: `rotate(${o.rotate} ${r1(x)} ${r1(y)})` } : {}) }, String(s)];
const ln = (x1, y1, x2, y2, o = {}) => ["line", { x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), stroke: o.stroke || "#222222", "stroke-width": o.w || 1, ...(o.dash ? { "stroke-dasharray": o.dash } : {}) }];
const r1 = x => Math.round(x * 10) / 10;
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function niceStep(range, n = 5) { const raw = range / n || 1, mag = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10; }

export function replicateFigure(c, { title = "" } = {}) {
  const regs = c.regions.filter(r => r.groups.some(g => g.n));
  if (!regs.length) return null;
  const k = c.conditions.length, gw = 64, pw = 70 + k * gw, cols = Math.min(4, regs.length), rowsN = Math.ceil(regs.length / cols);
  const nBr = Math.max(0, ...regs.map(r => r.comparisons.length)), brH = 15;
  const ph = 230 + nBr * brH, top = title ? 26 : 8, W = Math.max(cols * pw + 20, 440);
  const note = wrap(`Dots: biological replicates (one per set). ${c.scale === "log2" ? "Line and whiskers: geometric mean and ×/÷ SD (on the log2 scale)" : "Line and whiskers: mean ± SD"}. Test: ${TESTS[c.settings.test].short} on ${c.scale === "log2" ? "log2 values" : c.scale === "logit" ? "logit (M-value)" : "raw values"}; ${CORRECTIONS[c.settings.correction]}-adjusted p across regions. *** < 0.001, ** < 0.01, * < 0.05, ns not significant.`, Math.floor((W - 20) / 5.3));
  const H = top + rowsN * ph + 40 + note.length * 13;
  const svg = ["svg", { xmlns: "http://www.w3.org/2000/svg", width: W, height: H, viewBox: `0 0 ${W} ${H}`, "font-family": FONT, role: "img", "aria-label": `${c.metricLabel} by condition` }, ["rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }]];
  if (title) svg.push(t(10, 18, title, { anchor: "start", size: 13, bold: true }));
  const log = c.scale === "log2";
  regs.forEach((R, ri) => {
    const ox = 10 + (ri % cols) * pw, oy = top + Math.floor(ri / cols) * ph;
    const L = ox + 52, Rt = ox + pw - 8, T = oy + 22 + R.comparisons.length * brH, B = oy + ph - 42;
    // y range over the dots and whiskers
    const pts = R.groups.flatMap(g => g.values.concat(whisk(g, log))).filter(x => fin(x) && (!log || x > 0));
    let lo, hi, ticks = [];
    if (log) {
      const l = pts.map(Math.log2); lo = Math.min(...l); hi = Math.max(...l);
      if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
      const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
      const step = Math.max(1, Math.ceil((hi - lo) / 6));
      for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) ticks.push([e, 2 ** e >= 0.01 && 2 ** e < 1e5 ? String(+(2 ** e).toPrecision(3)) : `2^${e}`]);
    } else {
      lo = Math.min(0, ...pts); hi = Math.max(0, ...pts); if (hi === lo) hi = lo + 1;
      const pad = (hi - lo) * 0.08; hi += pad; if (lo < 0) lo -= pad;
      const step = niceStep(hi - lo);
      for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push([+v.toFixed(10), String(+v.toFixed(6))]);
    }
    const Y = v => B - ((log ? Math.log2(v) : v) - lo) / (hi - lo) * (B - T), Yt = e => B - (e - lo) / (hi - lo) * (B - T);
    svg.push(t((L + Rt) / 2, oy + 12, clip(R.region, Math.floor(pw / 6.5)), { size: 11.5, bold: true }), ln(L, T, L, B), ln(L, B, Rt, B));
    for (const [e, lab] of ticks) svg.push(ln(L - 4, Yt(e), L, Yt(e)), t(L - 7, Yt(e) + 3.5, lab, { anchor: "end", size: 9.5 }));
    if (!log && lo < 0) svg.push(ln(L, Y(0), Rt, Y(0), { stroke: "#9a9a9a", dash: "3 3" }));
    const X = i => L + (i + 0.5) * ((Rt - L) / k);
    R.groups.forEach((g, i) => {
      const cx = X(i), col = COLORS[i % COLORS.length];
      g.values.forEach((v, j) => { if (fin(v) && (!log || v > 0)) svg.push(["circle", { cx: r1(cx + (g.n > 1 ? (j / (g.n - 1) - 0.5) * 18 : 0)), cy: r1(Y(v)), r: 4.2, fill: col, "fill-opacity": 0.85, stroke: "#ffffff", "stroke-width": 0.8 }, ["title", {}, `${g.sets[j]}: ${fmt(v, 3)}`]]); });
      const ctr = log ? (fin(g.tmean) ? 2 ** g.tmean : null) : g.mean;
      if (fin(ctr)) {
        svg.push(ln(cx - 16, Y(ctr), cx + 16, Y(ctr), { w: 2 }));
        const [a, b] = whisk(g, log);
        if (fin(a) && fin(b) && (!log || a > 0)) svg.push(ln(cx, Y(a), cx, Y(b)), ln(cx - 6, Y(a), cx + 6, Y(a)), ln(cx - 6, Y(b), cx + 6, Y(b)));
      }
      svg.push(t(cx, B + 14, clip(g.condition, 11), { size: 10 }), t(cx, B + 26, `n = ${g.n}`, { size: 9, fill: "#666666" }));
    });
    R.comparisons.forEach((x, m) => {
      const y = T - 8 - m * brH, x1 = X(x.i), x2 = X(x.j);
      svg.push(ln(x1, y + 4, x1, y), ln(x1, y, x2, y), ln(x2, y, x2, y + 4), t((x1 + x2) / 2, y - 2, x.mark || "n/a", { size: 10, fill: x.mark && x.mark !== "ns" ? "#D55E00" : "#555555" }));
    });
    if (ri % cols === 0) svg.push(t(ox + 12, (T + B) / 2, clip(c.metricLabel, 34), { rotate: -90, size: 10.5 }));
  });
  note.forEach((line, i) => svg.push(t(10, top + rowsN * ph + 24 + i * 13, line, { anchor: "start", size: 9.5, fill: "#555555" })));
  return svg;
}
function whisk(g, log) {
  if (log) return fin(g.tmean) && fin(g.tsd) ? [2 ** (g.tmean - g.tsd), 2 ** (g.tmean + g.tsd)] : [null, null];
  return fin(g.mean) && fin(g.sd) ? [g.mean - g.sd, g.mean + g.sd] : [null, null];
}
function wrap(text, n) { return text.split(" ").reduce((ls, w) => { const l = ls[ls.length - 1]; if (l && (l + " " + w).length <= n) ls[ls.length - 1] = l + " " + w; else ls.push(w); return ls; }, []); }
const escX = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function svgString(node) {
  if (typeof node === "string") return escX(node);
  const [tag, attrs, ...kids] = node;
  return `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${escX(v)}"`).join("")}>${kids.map(svgString).join("")}</${tag}>`;
}

// ---------------------------------------------------------------- report section (HTML string)
export function replicateReportHtml(c, esc) {
  if (!c) return "";
  const tb = comparisonTable(c);
  const fig = replicateFigure(c);
  const groups = c.regions.flatMap(R => R.groups.map(g => [R.region, g.condition, g.n, meanSd(g), g.sets.map((s, i) => `${s} ${fmt(g.values[i], 3)}`).join("; ")]));
  const an = c.regions.filter(r => r.anova);
  return `<h3>Comparing conditions (biological replicates)</h3>
<p>${esc(c.metricLabel)}, one value per set (biological replicate). Conditions: ${esc(c.conditions.join(", "))}; control ${esc(c.control)}. Test: ${esc(TESTS[c.settings.test].short)} on ${esc(scaleNote(c))}. p values adjusted across regions by ${esc(CORRECTIONS[c.settings.correction])}.</p>
<table><thead><tr>${["Region", "Condition", "n", "Mean ± SD", "Replicates"].map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${groups.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<table><thead><tr>${tb.head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${tb.rows.map(r => `<tr>${r.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}</tbody></table>
${an.length ? `<p class="sub">${esc(an.map(r => `${r.region}: ${r.anova.name} p ${fmtP(r.anova.p)} (adjusted ${fmtP(r.anova.pAdj)})`).join("; "))}.</p>` : ""}
${c.regions.some(r => r.note) ? `<p class="sub">${esc(c.regions.filter(r => r.note).map(r => `${r.region}: ${r.note}`).join(" "))}</p>` : ""}
${fig ? `<div style="overflow-x:auto">${svgString(fig)}</div>` : ""}
${c.warnings.length ? `<ul>${c.warnings.map(w => `<li><span class="sev ${esc(w.level)}">${esc(w.level[0].toUpperCase() + w.level.slice(1))}</span>${esc(w.text)}</li>`).join("")}</ul>` : ""}
<p class="sub small">Mean ± SD is arithmetic, in the units of the result. Technical replicates were averaged as Ct first; each set counts once. Scale for % values: Du P, Zhang X, Huang CC, et al. Comparison of Beta-value and M-value methods for quantifying methylation levels by microarray analysis. BMC Bioinformatics 2010;11:587. doi:10.1186/1471-2105-11-587</p>`;
}
