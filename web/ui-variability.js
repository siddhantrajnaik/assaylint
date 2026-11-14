// Threshold evidence in the app: the "Why this number" notes beside each setting, and the graphs of
// technical and biological spread on the Review tab. Data functions are pure so they can be tested in Node.
import { groupBy, median, REFERENCES, poissonSd, sdLimit } from "./core.js";
import { plot } from "./charts.js";

// ---------------------------------------------------------------- numbers behind the graphs
const sampleSd = xs => {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
// Pooled SD: sqrt(Σ(n−1)·s² / Σ(n−1)), so bigger groups count for more.
const pooledSd = list => {
  const ok = list.filter(x => x.sd != null && x.n > 1), df = ok.reduce((a, x) => a + x.n - 1, 0);
  return df ? Math.sqrt(ok.reduce((a, x) => a + (x.n - 1) * x.sd ** 2, 0) / df) : null;
};

// Technical spread: every replicate group with an SD (samples, standards and positives).
// Biological spread, per target and experimental group: SD of the biological units' mean Ct.
// Technical wells are averaged first, so each unit counts once.
export function variabilityData(res) {
  const all = res?.replicateGroups || [];
  const groups = all.filter(g => Number.isFinite(g.sd)).map(g => ({ unit: g.unit, target: g.target, group: g.group ?? null, role: g.role, n: g.n_numeric, mean: g.mean, sd: g.sd, over: !!g.over }));
  const samples = all.filter(g => g.role === "sample");
  const perTarget = [...groupBy(samples, g => g.target)].map(([target, tg]) => {
    const tech = tg.filter(g => Number.isFinite(g.sd)).map(g => ({ unit: g.unit, n: g.n_numeric, sd: g.sd }));
    const bio = [...groupBy(tg.filter(g => Number.isFinite(g.mean)), g => g.group ?? "")].map(([group, gs]) => {
      const means = gs.map(g => g.mean);
      return { group, n: means.length, units: gs.map(g => g.unit), means, sd: sampleSd(means) };
    });
    return { target, tech, techPooled: pooledSd(tech), bio, bioPooled: pooledSd(bio) };
  });
  return { groups, sds: groups.map(g => g.sd), perTarget };
}

// poissonSd() (SD of Ct expected from Poisson sampling alone) lives in core.js, because the Ct-dependent
// SD threshold uses it too. Re-exported here for the graphs and the tests.
export { poissonSd };

export function histogram(values, { width } = {}) {
  if (!values.length) return { width: 0, bins: [] };
  const max = Math.max(...values);
  width ||= [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2].find(w => max / w <= 30) || 5;
  const bins = Array.from({ length: Math.floor(max / width) + 1 }, (_, i) => ({ x0: i * width, x1: (i + 1) * width, count: 0 }));
  for (const v of values) bins[Math.min(bins.length - 1, Math.floor(v / width))].count++;
  return { width, bins };
}

// ---------------------------------------------------------------- DOM (text nodes only; values come from user files)
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) k === "class" ? (e.className = v) : e.setAttribute(k, v);
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const fmt = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const TECH = "#0B6B5C", BIO = "#B25E09";

// One-line reason beside a setting, and the longer note with references behind "Why this number".
export function evidenceNote(f) {
  if (!f?.evidence) return null;
  return h("span", { class: "why" }, h("small", null, f.evidence),
    h("details", null, h("summary", null, "Why this number"),
      f.detail && h("p", null, f.detail),
      h("ul", null, (f.refs || []).map(k => REFERENCES[k]).filter(Boolean).map(r =>
        h("li", null, r.text, " ", h("a", { href: `https://doi.org/${r.doi}`, target: "_blank", rel: "noopener" }, `doi:${r.doi}`))))));
}

// Review tab card. `defer` runs a function after the card is in the page (canvases need their size).
export function variabilityCard(res, threshold, defer) {
  const d = variabilityData(res);
  if (!d.groups.length) return null;
  const chart = (label, data) => { const cv = h("canvas", { class: "chart", role: "img", "aria-label": label }); defer(() => plot(cv, data)); return cv; };
  // With the Ct-dependent option on, each group has its own limit (sdLimit in core.js), so the engine's verdict is used.
  const rules = res.ruleset?.values, ctDep = !!rules?.sdCtDependent;
  const over = d.groups.filter(g => g.over).length, hist = histogram(d.sds);
  const curve = [];
  const cts = d.groups.map(g => g.mean), lo = Math.min(...cts), hi = Math.max(...cts);
  for (let c = Math.floor(lo); c <= Math.ceil(hi) + 1e-9; c += 0.25) { const s = poissonSd(c); if (s != null) curve.push([c, s]); }
  const limit = [];
  if (ctDep) for (let c = Math.floor(lo); c <= Math.ceil(hi) + 1e-9; c += 0.25) limit.push([c, sdLimit(rules, c)]);
  const targets = d.perTarget.filter(t => t.tech.length || t.bio.some(b => b.sd != null));
  const pts = [], seg = [];
  targets.forEach((t, i) => {
    for (const x of t.tech) pts.push({ x: i - 0.15, y: x.sd, color: TECH });
    for (const b of t.bio) if (b.sd != null) pts.push({ x: i + 0.15, y: b.sd, color: BIO });
    if (t.techPooled != null) seg.push({ pts: [[i - 0.3, t.techPooled], [i, t.techPooled]], color: TECH, width: 2.5 });
    if (t.bioPooled != null) seg.push({ pts: [[i, t.bioPooled], [i + 0.3, t.bioPooled]], color: BIO, width: 2.5 });
  });
  // Only compare when there are at least 3 biological units in some group; with fewer, the biological SD says little.
  const noisy = targets.filter(t => t.techPooled != null && t.bioPooled != null && t.techPooled >= t.bioPooled && t.bio.some(b => b.n >= 3));
  const thin = targets.filter(t => !t.bio.some(b => b.n >= 3)).map(t => t.target);
  return h("section", { class: "sec variability" },
    h("h2", null, "Spread of technical and biological replicates"),
    h("p", { class: "lede" }, "Use these before changing the SD threshold: they show whether this plate is unusual or the threshold is simply too tight for how late your targets come up."),
    h("figure", null, chart("Histogram of technical replicate SD", { bars: hist.bins.map(b => ({ x0: b.x0, x1: b.x1, y: b.count })), vline: threshold, xLabel: "Technical SD of Ct (cycles)", yLabel: "Replicate groups" }),
      h("figcaption", null, `Technical SD of all ${d.sds.length} replicate groups with two or more Ct values; median ${fmt(median(d.sds), 3)} cycles. ${over} ${over === 1 ? "is" : "are"} ${ctDep ? `flagged. The dashed line is the fixed threshold of ${threshold}; on this run the limit rises for late Ct.` : `above the threshold of ${threshold} (dashed line).`}`)),
    h("figure", null, chart("Technical SD against mean Ct", { points: d.groups.map(g => ({ x: g.mean, y: g.sd, color: g.over ? "#B42318" : TECH })), series: [...(curve.length > 1 ? [{ pts: curve, color: "#5B6762", width: 1.25 }] : []), ...(limit.length > 1 ? [{ pts: limit, color: "#B42318", width: 1.25 }] : [])], hline: threshold, xLabel: "Mean Ct of the group", yLabel: "Technical SD (cycles)" }),
      h("figcaption", null, "Each dot is one replicate group. The grey curve is the SD expected from Poisson sampling alone, taking about 10 copies at Ct 35 and 100% efficiency; pipetting adds to it. Groups above the dashed threshold but near the curve are probably low-copy, not badly pipetted.",
        ctDep ? ` The red line is the limit used on this run: the larger of ${threshold} and ${rules.sdPoissonK} × the grey curve.` : " If that describes most of your flagged groups, the Ct-dependent SD option under More, then Method details and thresholds lets the threshold follow the curve.")),
    targets.length > 0 && h("figure", null, chart("Technical and biological SD per target", { points: pts, series: seg, hline: threshold, xTicks: targets.map((t, i) => ({ x: i, label: t.target })), yLabel: "SD of Ct (cycles)" }),
      h("figcaption", null, h("span", { style: `color:${TECH};font-weight:600` }, "Teal"), ": technical SD of each sample's replicates. ",
        h("span", { style: `color:${BIO};font-weight:600` }, "Orange"), ": biological SD, the SD of the biological units' mean Ct within each group. Short bars are pooled values; dashed line is the SD threshold.")),
    targets.length > 0 && h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, ["Target", "Technical SD (pooled)", "Biological SD (pooled)", "Groups with 2+ units"].map(x => h("th", null, x)))),
      h("tbody", null, targets.map(t => h("tr", null, h("td", null, t.target), h("td", { class: "num" }, fmt(t.techPooled, 3)), h("td", { class: "num" }, fmt(t.bioPooled, 3)),
        h("td", { class: "num" }, t.bio.filter(b => b.n > 1).length)))))),
    h("p", { class: "fine" }, noisy.length
      ? `For ${noisy.length > 1 ? noisy.slice(0, -1).map(t => t.target).join(", ") + " and " + noisy.at(-1).target : noisy[0].target}, technical spread is as large as the spread between biological units. Check first whether one group or one outlying well is causing it (the dots above). If not, the assay may be at its limit of quantification (Ruiz-Villalba et al. 2021), and more technical replicates or more template will help more than more samples.`
      : "Biological SD includes a little technical noise, since each unit's mean comes from a few wells. Where technical SD reaches the biological SD, the assay may be at its limit of quantification (Ruiz-Villalba et al. 2021)."),
    thin.length > 0 && h("p", { class: "fine" }, `${thin.join(", ")}: fewer than 3 biological units in every group, so the biological SD is too rough to compare with the technical SD.`));
}