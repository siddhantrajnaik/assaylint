// Analysis views: the "Analysis" step of a run and "Combine plates" (a study of several saved runs).
// The calculations live in analysis.js and stats.js; this file only draws. Graphs are SVG built by hand
// (text nodes only, never innerHTML), downloadable as SVG or as a 300-dpi PNG.
// The app passes its helpers in `ax` (see the hook in app.js): { h, card, download, change, renderMain, st, flash, S, C, openExp, goTab }.
import * as A from "./analysis.js";

const NS = "http://www.w3.org/2000/svg";
// Okabe & Ito colour-blind safe colours: biological replicates blue, technical replicates orange.
export const COLORS = { bio: "#0072B2", tech: "#E69F00", sig: "#D55E00", ink: "#222222", mute: "#8a8a8a", grid: "#e4e4e4" };
const FONT = "Arial, Helvetica, sans-serif"; // what most journals ask for, and present on every system that rasterises the SVG
const fin = x => typeof x === "number" && Number.isFinite(x);
const fmt = (x, d = 2) => (fin(x) ? x.toFixed(d) : "—");
const fmtFold = x => (!fin(x) ? "—" : x >= 1000 || x < 0.001 ? x.toExponential(2) : x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(x < 0.1 ? 3 : 2));
const CORR = { bh: "Benjamini–Hochberg", bonferroni: "Bonferroni" };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) e.setAttribute(k, String(v));
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
const txt = (x, y, s, o = {}) => el("text", { x, y, "font-size": o.size || 11, "text-anchor": o.anchor || "middle", fill: o.fill || COLORS.ink,
  "font-style": o.italic ? "italic" : null, "font-weight": o.bold ? "bold" : null, transform: o.rotate ? `rotate(${o.rotate} ${x} ${y})` : null }, s);
const clip = (s, n = 18) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// ---------------------------------------------------------------- axis scales
function niceStep(range, n = 5) {
  const raw = range / n, mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || mag * 10;
}
function scale(values, log, extra = 0.16) {
  const v = values.filter(fin);
  if (log) {
    const l = v.filter(x => x > 0).map(Math.log2);
    let lo = Math.min(0, ...l), hi = Math.max(0, ...l);
    if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
    const pad = (hi - lo) * 0.06; lo -= pad; hi += (hi - lo) * extra;
    const step = Math.max(1, Math.ceil((hi - lo) / 7));
    const ticks = [];
    for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) ticks.push(k);
    const lab = k => (k >= 0 ? String(2 ** k) : 2 ** k >= 0.001 ? String(+(2 ** k).toPrecision(3)) : `2^${k}`);
    return { lo, hi, map: x => Math.log2(x), ticks: ticks.map(k => ({ at: k, label: lab(k) })) };
  }
  let hi = Math.max(1, ...v);
  hi += hi * extra;
  const step = niceStep(hi), ticks = [];
  for (let t = 0; t <= hi + 1e-9; t += step) ticks.push({ at: t, label: String(+t.toFixed(6)) });
  return { lo: 0, hi, map: x => x, ticks };
}

// ---------------------------------------------------------------- fold-change figure
// One panel per target; groups along x. Large blue dots: biological replicates (mean of their technical replicates).
// Small orange dots: individual technical replicates. Black line and whiskers: mean ± SD or SEM. Above each group: adjusted p.
export function foldChart(a, { title = "" } = {}) {
  const s = a.settings, log = s.scale !== "linear", targets = a.targets.filter(t => a.summary.some(r => r.target === t));
  const groups = a.groups, gw = 66, pw = 58 + groups.length * gw, ph = 310, cols = Math.min(4, Math.max(1, targets.length));
  const rowsN = Math.ceil(targets.length / cols), W = Math.max(cols * pw + 20, 420), top = title ? 26 : 6, H = top + rowsN * ph + 78;
  const svg = el("svg", { xmlns: NS, width: W, height: H, viewBox: `0 0 ${W} ${H}`, "font-family": FONT, role: "img", "aria-label": title || "Fold change by target and group" });
  svg.append(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));
  if (title) svg.append(txt(10, 18, title, { anchor: "start", size: 13, bold: true }));
  targets.forEach((t, ti) => {
    const x0 = 10 + (ti % cols) * pw, y0 = top + Math.floor(ti / cols) * ph;
    const L = x0 + 52, T = y0 + 44, B = y0 + 218, R = L + groups.length * gw;
    const sum = a.summary.filter(r => r.target === t), rows = a.rows.filter(r => r.target === t);
    const sc = scale([...rows.map(r => r.fold), ...rows.flatMap(r => r.tech.map(x => x.fold)), ...sum.flatMap(r => [r.foldLow, r.foldHigh])], log);
    const Y = v => B - ((sc.map(v) - sc.lo) / (sc.hi - sc.lo)) * (B - T);
    const g = el("g", { "aria-label": t });
    g.append(txt((L + R) / 2, y0 + 16, clip(t, 28), { size: 13, italic: true, bold: true }));
    for (const tk of sc.ticks) {
      const y = B - ((tk.at - sc.lo) / (sc.hi - sc.lo)) * (B - T);
      g.append(el("line", { x1: L - 4, x2: L, y1: y, y2: y, stroke: COLORS.ink, "stroke-width": 1 }), txt(L - 7, y + 3.5, tk.label, { anchor: "end", size: 10 }));
    }
    if (log && sc.lo <= 0 && sc.hi >= 0) { const y = B - ((0 - sc.lo) / (sc.hi - sc.lo)) * (B - T); g.append(el("line", { x1: L, x2: R, y1: y, y2: y, stroke: COLORS.mute, "stroke-dasharray": "3 3", "stroke-width": 0.8 })); }
    g.append(el("line", { x1: L, x2: L, y1: T - 6, y2: B, stroke: COLORS.ink, "stroke-width": 1 }), el("line", { x1: L, x2: R, y1: B, y2: B, stroke: COLORS.ink, "stroke-width": 1 }));
    if (ti % cols === 0) g.append(txt(x0 + 10, (T + B) / 2, log ? "Fold change (log scale)" : "Fold change", { rotate: -90, size: 11 }));
    groups.forEach((gr, gi) => {
      const cx = L + gw * gi + gw / 2, r = sum.find(x => x.group === gr), units = rows.filter(x => x.group === gr);
      const long = gr.length > 8;
      g.append(txt(cx, B + 14, `n = ${r ? r.n : 0}`, { size: 9.5, fill: COLORS.mute }),
        txt(long ? cx + 4 : cx, B + 28, clip(gr), { size: 11, anchor: long ? "end" : "middle", rotate: long ? -35 : 0 }));
      if (!r) return;
      // technical replicates under the biological dots
      units.forEach((u, ui) => {
        const ux = cx + (units.length > 1 ? (ui - (units.length - 1) / 2) * Math.min(12, 40 / units.length) : 0);
        u.tech.forEach((tq, k) => { if (fin(tq.fold) && tq.fold > 0) g.append(el("circle", { cx: ux + (k - (u.tech.length - 1) / 2) * 3.2, cy: Y(tq.fold), r: 2.1, fill: COLORS.tech, "fill-opacity": 0.85 })); });
      });
      if (fin(r.foldLow) && fin(r.foldHigh) && r.foldLow > 0) {
        const yl = Y(r.foldLow), yh = Y(r.foldHigh);
        g.append(el("line", { x1: cx, x2: cx, y1: yl, y2: yh, stroke: COLORS.ink, "stroke-width": 1.3 }),
          el("line", { x1: cx - 7, x2: cx + 7, y1: yl, y2: yl, stroke: COLORS.ink, "stroke-width": 1.3 }), el("line", { x1: cx - 7, x2: cx + 7, y1: yh, y2: yh, stroke: COLORS.ink, "stroke-width": 1.3 }));
      }
      units.forEach((u, ui) => {
        const ux = cx + (units.length > 1 ? (ui - (units.length - 1) / 2) * Math.min(12, 40 / units.length) : 0);
        if (fin(u.fold) && u.fold > 0) g.append(el("circle", { cx: ux, cy: Y(u.fold), r: 4.6, fill: COLORS.bio, stroke: "#ffffff", "stroke-width": 1 }, el("title", {}, `${u.unit}: ${fmtFold(u.fold)}`)));
      });
      if (fin(r.fold) && r.fold > 0) g.append(el("line", { x1: cx - 18, x2: cx + 18, y1: Y(r.fold), y2: Y(r.fold), stroke: COLORS.ink, "stroke-width": 2.2 }));
      if (!r.isControl && fin(r.pAdj)) {
        const vals = [r.foldHigh, ...units.map(u => u.fold), ...units.flatMap(u => u.tech.map(x => x.fold))].filter(v => fin(v) && v > 0);
        const yTop = Math.max(T - 4, Math.min(...vals.map(Y)) - 6);
        g.append(txt(cx, yTop - 11, A.stars(r.pAdj), { size: 12, bold: A.stars(r.pAdj) !== "ns" }), txt(cx, yTop, `p = ${A.fmtP(r.pAdj)}`, { size: 9 }));
      }
    });
    svg.append(g);
  });
  // legend and method note
  const ly = top + rowsN * ph + 10;
  svg.append(el("circle", { cx: 18, cy: ly, r: 4.6, fill: COLORS.bio }), txt(28, ly + 4, "Biological replicate (mean of its technical replicates)", { anchor: "start", size: 10.5 }),
    el("circle", { cx: 18, cy: ly + 18, r: 2.1, fill: COLORS.tech }), txt(28, ly + 22, "Technical replicate", { anchor: "start", size: 10.5 }),
    el("line", { x1: 11, x2: 25, y1: ly + 36, y2: ly + 36, stroke: COLORS.ink, "stroke-width": 2.2 }), txt(28, ly + 40, `Mean ± ${s.error === "sem" ? "SEM" : "SD"}`, { anchor: "start", size: 10.5 }));
  svg.append(txt(10, ly + 60, clip(`Fold change = 2^−ΔΔCt vs ${a.control}; reference: ${a.refs.join(" + ")}${s.efficiency ? "; efficiency-corrected" : ""}. p: Welch t-test on ΔCt vs control, ${CORR[s.correction]}-adjusted. *** < 0.001, ** < 0.01, * < 0.05.`, 170), { anchor: "start", size: 9.5, fill: "#555555" }));
  return svg;
}

// Volcano plot: one point per comparison with the control. x = log2 fold change, y = −log10 p (unadjusted);
// points significant after correction are drawn in vermillion and labelled.
export function volcano(a) {
  const comps = a.summary.filter(r => !r.isControl && fin(r.p) && r.p > 0 && fin(r.log2fc));
  const W = 460, H = 340, L = 54, R = W - 16, T = 20, B = H - 48;
  const svg = el("svg", { xmlns: NS, width: W, height: H, viewBox: `0 0 ${W} ${H}`, "font-family": FONT, role: "img", "aria-label": "Volcano plot" });
  svg.append(el("rect", { x: 0, y: 0, width: W, height: H, fill: "#ffffff" }));
  const xs = comps.map(r => r.log2fc), ys = comps.map(r => -Math.log10(r.p));
  const xm = Math.max(1.5, ...xs.map(Math.abs)) * 1.12, ym = Math.max(2, ...ys) * 1.1;
  const X = v => L + ((v + xm) / (2 * xm)) * (R - L), Y = v => B - (v / ym) * (B - T);
  const sx = niceStep(2 * xm, 6), sy = niceStep(ym, 5);
  for (let v = Math.ceil(-xm / sx) * sx; v <= xm; v += sx) svg.append(el("line", { x1: X(v), x2: X(v), y1: B, y2: B + 4, stroke: COLORS.ink }), txt(X(v), B + 16, String(+v.toFixed(3)), { size: 10 }));
  for (let v = 0; v <= ym; v += sy) svg.append(el("line", { x1: L - 4, x2: L, y1: Y(v), y2: Y(v), stroke: COLORS.ink }), txt(L - 7, Y(v) + 3.5, String(+v.toFixed(3)), { size: 10, anchor: "end" }));
  svg.append(el("line", { x1: L, x2: R, y1: B, y2: B, stroke: COLORS.ink }), el("line", { x1: L, x2: L, y1: T, y2: B, stroke: COLORS.ink }),
    el("line", { x1: L, x2: R, y1: Y(-Math.log10(A.ALPHA)), y2: Y(-Math.log10(A.ALPHA)), stroke: COLORS.mute, "stroke-dasharray": "4 3" }),
    txt(R, Y(-Math.log10(A.ALPHA)) - 4, "p = 0.05 (unadjusted)", { anchor: "end", size: 9, fill: "#555555" }),
    el("line", { x1: X(0), x2: X(0), y1: T, y2: B, stroke: COLORS.grid }),
    txt((L + R) / 2, H - 14, "log2 fold change", { size: 11 }), txt(16, (T + B) / 2, "−log10 p", { size: 11, rotate: -90 }));
  const many = a.groups.length > 2;
  comps.forEach(r => {
    const sig = fin(r.pAdj) && r.pAdj < A.ALPHA, x = X(r.log2fc), y = Y(-Math.log10(r.p));
    svg.append(el("circle", { cx: x, cy: y, r: sig ? 4.5 : 3.5, fill: sig ? COLORS.sig : COLORS.mute, "fill-opacity": 0.9 }, el("title", {}, `${r.target}${many ? ` (${r.group})` : ""}`)));
    if (sig) svg.append(txt(x + 6, y - 5, clip(r.target + (many ? ` (${r.group})` : ""), 22), { anchor: "start", size: 9.5, italic: true }));
  });
  svg.append(txt(L + 4, T + 4, `Coloured: ${CORR[a.settings.correction]}-adjusted p < 0.05`, { anchor: "start", size: 9, fill: "#555555" }));
  return svg;
}

// ---------------------------------------------------------------- downloads
export function serialize(svg) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new (document.defaultView.XMLSerializer)().serializeToString(svg);
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
// Adds (or replaces) the pHYs chunk so the PNG says 300 dpi; image programs and journal checks read it.
export function pngWithDpi(bytes, dpi = 300) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return bytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts = [bytes.slice(0, 8)];
  let i = 8, done = false;
  const ppm = Math.round(dpi / 0.0254), chunk = new Uint8Array(21), cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9); chunk.set([112, 72, 89, 115], 4); cv.setUint32(8, ppm); cv.setUint32(12, ppm); chunk[16] = 1;
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  while (i + 8 <= bytes.length) {
    const len = dv.getUint32(i), type = String.fromCharCode(...bytes.subarray(i + 4, i + 8)), end = i + 12 + len;
    if (type !== "pHYs") parts.push(bytes.slice(i, end));
    if (type === "IHDR" && !done) { parts.push(chunk); done = true; }
    i = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function downloadPng(ax, svg, name, dpi = 300) {
  const w = Number(svg.getAttribute("width")), hgt = Number(svg.getAttribute("height")), k = dpi / 96; // the SVG is laid out at 96 px per inch
  const img = document.createElement("img");
  img.onload = () => {
    const cv = document.createElement("canvas");
    cv.width = Math.round(w * k); cv.height = Math.round(hgt * k);
    const g = cv.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
    cv.toBlob?.(async b => { if (b) ax.download(name, pngWithDpi(new Uint8Array(await b.arrayBuffer()), dpi), "image/png"); }, "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialize(svg));
}
function figure(ax, svg, base, caption) {
  const { h } = ax;
  return h("figure", { class: "ana-fig" }, h("div", { class: "ana-svg", style: "overflow-x:auto" }, svg),
    caption && h("figcaption", null, caption),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", onclick: () => ax.download(`${base}.svg`, serialize(svg), "image/svg+xml") }, "Download SVG"),
      h("button", { class: "btn", type: "button", onclick: () => downloadPng(ax, svg, `${base}.png`) }, "Download PNG (300 dpi)")));
}

// ---------------------------------------------------------------- settings
// info: { targets, groups, hasCurves }. set(patch, detail) stores a change.
function settingsPanel(ax, s, info, set) {
  const { h } = ax, sugg = new Set(A.suggestReferences(info.targets));
  const toggleRef = t => { const refs = s.refs.includes(t) ? s.refs.filter(x => x !== t) : [...s.refs, t]; set({ refs }, `Reference genes: ${refs.join(", ") || "none"}`); };
  const sel = (label, value, opts, key, detail) => h("label", { class: "field" }, h("span", null, label),
    h("select", { "aria-label": label, onchange: e => set({ [key]: e.target.value }, `${detail}: ${opts.find(o => o[0] === e.target.value)?.[1] ?? e.target.value}`) },
      opts.map(([v, l]) => h("option", { value: v, selected: v === value }, l))));
  return h("div", { class: "ana-settings" },
    h("div", { class: "field" }, h("span", null, "Reference gene(s)"),
      h("div", { class: "row wrap" }, info.targets.map(t => h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.refs.includes(t), onchange: () => toggleRef(t) }), t,
        sugg.has(t) && h("small", { class: "muted" }, " (often used as a reference)")))),
      h("small", null, "You pick these. I only mark names that are often used as references; whether a gene is stable in your samples is something only your data and your judgement can tell. With several, I use the mean of their Ct values.")),
    info.groups.length ? sel("Control group", s.control, [["", "Choose…"], ...info.groups.map(g => [g, g])], "control", "Control group")
      : h("p", { class: "warn" }, "No sample has a group label yet. Add groups (for example control and treated) on the Plate step, or in your file."),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.efficiency, disabled: !info.hasCurves && !s.efficiency, onchange: e => set({ efficiency: e.target.checked }, `Efficiency correction ${e.target.checked ? "on" : "off"}`) }),
      "Correct for amplification efficiency (Pfaffl)", h("small", { class: "muted" }, info.hasCurves ? " uses the standard curves on the plate" : " needs a standard curve; none on this plate")),
    h("div", { class: "row wrap" },
      sel("Error bars", s.error, [["sd", "SD (spread of the replicates)"], ["sem", "SEM (precision of the mean)"]], "error", "Error bars"),
      sel("p value shown on graphs", s.correction, [["bh", "Benjamini–Hochberg adjusted"], ["bonferroni", "Bonferroni adjusted"]], "correction", "Graph correction"),
      sel("Fold-change axis", s.scale, [["log2", "Log scale"], ["linear", "Linear"]], "scale", "Axis")),
    h("label", { class: "check" }, h("input", { type: "checkbox", checked: s.skipOmitted, onchange: e => set({ skipOmitted: e.target.checked }, `Leave out wells marked Omit: ${e.target.checked ? "yes" : "no"}`) }), "Leave out wells marked Omit in the instrument software"),
    info.excluded !== false && h("label", { class: "field" }, h("span", null, "Other wells to leave out"),
      h("input", { type: "text", value: s.excluded.join(", "), placeholder: "for example A12, C6", "aria-label": "Wells to leave out",
        onchange: e => { const excluded = e.target.value.split(/[\s,;]+/).map(x => x.trim().toUpperCase()).filter(Boolean); set({ excluded }, `Wells left out of the analysis: ${excluded.join(", ") || "none"}`); } }),
      h("small", null, "Only for the analysis. The wells stay in the data, the checks and the report.")),
    h("label", { class: "field" }, h("span", null, "Flag a reference if its group means differ by more than (cycles)"),
      h("input", { type: "number", step: "0.1", min: "0.1", value: String(s.refMaxShift), "aria-label": "Reference shift threshold",
        onchange: e => { const v = Number(e.target.value); if (v > 0 && v <= 10) set({ refMaxShift: v }, `Reference stability threshold: ${v} cycles`); } })));
}

// ---------------------------------------------------------------- results
function resultsBlock(ax, a, base) {
  const { h, card } = ax;
  if (!a.ok) {
    const need = { refs: "Pick at least one reference gene.", control: "Pick the control group.", targets: "Every target is ticked as a reference. Leave at least one gene of interest unticked." };
    return [card(h("h2", null, "Results"), a.needs.map(n => h("p", null, need[n])), a.warnings.length > 0 && h("ul", { class: "ana-warn" }, a.warnings.map(w => h("li", null, w))))];
  }
  const tbl = (head, rows) => h("div", { class: "tablewrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, head.map(x => h("th", null, x)))), h("tbody", null, rows)));
  const err = a.settings.error === "sem" ? "SEM" : "SD";
  const out = [];
  if (a.warnings.length) out.push(card(h("h2", null, "Worth knowing before you use these numbers"), h("ul", { class: "ana-warn" }, a.warnings.map(w => h("li", null, w)))));
  out.push(card(h("h2", null, "Fold change"),
    a.summary.length ? figure(ax, foldChart(a), `${base}-fold-change`, "Each panel is one gene. Drawn as SVG, so it stays sharp at any size; the PNG is 300 dpi.")
      : h("p", { class: "muted" }, "Nothing to plot yet."),
    a.targets.length >= 6 && h("div", null, h("h3", null, "Volcano plot"), figure(ax, volcano(a), `${base}-volcano`, "Every gene and group compared with the control. Hover a point for its name."))));
  out.push(card(h("h2", null, "Results table"),
    tbl(["Target", "Group", "n", "Mean ΔCt", `${err} ΔCt`, "ΔΔCt", "Fold change", `Fold range (± ${err})`, "Welch t (df)", "p", "p (BH)", "p (Bonferroni)"],
      a.summary.map(r => h("tr", { class: !r.isControl && fin(r.pAdj) && r.pAdj < A.ALPHA ? "diff" : "" },
        h("td", null, r.target), h("td", null, r.group, r.isControl ? " (control)" : ""), h("td", { class: "num" }, r.n), h("td", { class: "num" }, fmt(r.meanDct)),
        h("td", { class: "num" }, fmt(a.settings.error === "sem" ? r.semDct : r.sdDct, 3)), h("td", { class: "num" }, fmt(r.meanDdct)), h("td", { class: "num" }, fmtFold(r.fold)),
        h("td", { class: "num" }, fin(r.foldLow) ? `${fmtFold(r.foldLow)}–${fmtFold(r.foldHigh)}` : "—"),
        h("td", { class: "num" }, r.isControl ? "" : fin(r.t) ? `${fmt(r.t)} (${fmt(r.df, 1)})` : r.testNote || "—"),
        h("td", { class: "num" }, r.isControl ? "" : A.fmtP(r.p)), h("td", { class: "num" }, r.isControl ? "" : A.fmtP(r.pBH)), h("td", { class: "num" }, r.isControl ? "" : A.fmtP(r.pBonferroni))))),
    a.anova.length > 0 && h("div", null, h("h3", null, "One-way ANOVA (all groups)"),
      tbl(["Target", "Groups", "F", "df", "p", "p (BH)", "p (Bonferroni)"], a.anova.map(x => h("tr", null, h("td", null, x.target), h("td", { class: "num" }, x.groups), h("td", { class: "num" }, fin(x.F) ? fmt(x.F) : x.note || "—"),
        h("td", { class: "num" }, `${x.df1}, ${x.df2}`), h("td", { class: "num" }, A.fmtP(x.p)), h("td", { class: "num" }, A.fmtP(x.pBH)), h("td", { class: "num" }, A.fmtP(x.pBonferroni)))))),
    h("p", { class: "fine" }, a.method),
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => ax.download(`${base}-analysis.csv`, A.resultsCsv(a), "text/csv") }, "Download table (CSV)"))));
  out.push(card(h("h2", null, "Reference gene check"),
    h("p", { class: "lede" }, `A reference should have the same Ct in every group. I flag one whose group means differ by more than ${a.settings.refMaxShift} cycles, or differ with p < 0.05.`),
    tbl(["Reference", ...a.groups.map(g => `${g}: mean Ct (SD, n)`), "Range", "p", ""], a.refStability.map(r => h("tr", { class: r.flagged ? "flag" : "" }, h("td", null, r.target),
      a.groups.map(g => { const m = r.groups.find(x => x.group === g); return h("td", { class: "num" }, m ? `${fmt(m.mean)} (${fmt(m.sd, 2)}, ${m.n})` : "—"); }),
      h("td", { class: "num" }, fmt(r.range)), h("td", { class: "num" }, A.fmtP(r.p)), h("td", null, r.flagged ? "Check this reference" : "Looks steady"))))));
  out.push(card(h("h2", null, "Biological units"),
    tbl(["Target", "Group", "Biological unit", "Mean Ct", "Reference level", "ΔCt", "ΔΔCt", "Fold change", "Technical Ct values"],
      a.rows.map(r => h("tr", null, h("td", null, r.target), h("td", null, r.group), h("td", null, r.unit), h("td", { class: "num" }, fmt(r.ct)), h("td", { class: "num" }, fmt(r.refCt)),
        h("td", { class: "num" }, fmt(r.dct)), h("td", { class: "num" }, fmt(r.ddct)), h("td", { class: "num" }, fmtFold(r.fold)), h("td", { class: "mono" }, r.tech.map(t => t.ct.toFixed(2)).join(", "))))),
    a.calibration?.offsets?.length > 0 && h("div", null, h("h3", null, "Plate corrections"),
      tbl(["Plate", "Target", a.calibration.mode === "calibrator" ? "Calibrator mean Ct" : "Plate mean Ct", "Shift applied (cycles)"],
        a.calibration.offsets.map(o => h("tr", null, h("td", null, o.plate), h("td", null, o.target), h("td", { class: "num" }, fmt(o.factor)), h("td", { class: "num" }, fmt(-o.shift, 3))))))));
  return out;
}

// ---------------------------------------------------------------- the Analysis step of a run
export function analysisView(ax) {
  const { h, card, st, C } = ax;
  if (!st.res?.rows?.length) return [card(h("p", null, "Upload a results file first; the analysis works from its Ct values."))];
  const s = st.exp.analysis || C.cleanAnalysisSettings({}), ch = A.choices(st.res);
  const set = (patch, detail) => ax.change("analysis.edit", detail, () => { st.exp.analysis = C.cleanAnalysisSettings({ ...s, ...patch }); });
  if (!s.on) return [card(h("h2", null, "Analysis"),
    h("p", { class: "lede" }, "Relative expression from this plate: ΔCt against reference genes you choose, ΔΔCt against a control group, fold change, t-tests with corrected p values, and graphs you can put in a paper."),
    h("p", null, "It's off until you switch it on, and it never picks reference genes for you. Check the flags on the Review step first: the analysis uses the plate as it is labelled now."),
    h("button", { class: "btn primary", type: "button", onclick: () => set({ on: true }, "Analysis switched on") }, "Switch on the analysis"),
    h("p", { class: "fine" }, "Several plates from one experiment? Use “Combine plates” in the sidebar."))];
  const a = A.analyzeRun(st.exp, st.res, s);
  const base = (st.exp.title || st.exp.id).replace(/[^\w.-]+/g, "_").slice(0, 60) || "run";
  return [card(h("h2", null, "Analysis settings"),
      settingsPanel(ax, s, { targets: ch.targets, groups: ch.groups, hasCurves: (st.res.stdCurves || []).length > 0 }, set),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => set({ on: false }, "Analysis switched off") }, "Switch the analysis off"))),
    ...resultsBlock(ax, a, base)];
}

// ---------------------------------------------------------------- Combine plates (a study)
function loadRuns(ax, ids) {
  const out = [], missing = [];
  for (const id of ids) {
    const exp = ax.S.load(id);
    if (!exp) { missing.push(id); continue; }
    try { out.push({ exp, res: ax.C.analyze(exp) }); } catch { missing.push(id); }
  }
  return { runs: out, missing };
}
export function studyView(ax) {
  const { h, card, st, S } = ax;
  const saved = S.studies(), runsIdx = S.index();
  const head = card(h("h1", null, "Combine plates"),
    h("p", { class: "lede" }, "Analyse several saved runs from one experiment together, for example when the samples or genes didn't fit on one plate. Runs stay as they are; the study only remembers which runs belong together and how to analyse them."),
    h("div", { class: "row wrap" },
      h("button", { class: "btn primary", type: "button", onclick: () => { st.study = S.normalizeStudy({ title: "New study", runs: st.study?.runs || [] }); ax.renderMain(); } }, "New study"),
      saved.map(x => h("button", { class: "btn" + (st.study?.id === x.id ? " on" : ""), type: "button", onclick: () => { st.study = S.loadStudy(x.id); ax.renderMain(); } }, `${x.title} (${x.runs} runs)`))));
  const sd = st.study;
  if (!sd) return [head, card(h("p", { class: "muted" }, saved.length ? "Open a study above, or start a new one." : "Start a new study to pick the runs that belong together."))];
  const save = (patch, rerender = true) => {
    Object.assign(sd, patch);
    try { st.study = S.saveStudy(sd) || sd; } catch { ax.flash("Couldn't save the study: this browser's storage is full or disabled.", true); }
    if (rerender) ax.renderMain();
  };
  const { runs, missing } = loadRuns(ax, sd.runs);
  const ch = runs.map(r => A.choices(r.res));
  const info = { targets: [...new Set(ch.flatMap(c => c.targets))], groups: [...new Set(ch.flatMap(c => c.groups))], hasCurves: runs.some(r => r.res.stdCurves?.length), excluded: false };
  const shared = A.sharedUnits(runs);
  const toggleRun = id => save({ runs: sd.runs.includes(id) ? sd.runs.filter(x => x !== id) : [...sd.runs, id] });
  const out = [head, card(h("h2", null, "Study"),
    h("label", { class: "field" }, h("span", null, "Title"), h("input", { type: "text", value: sd.title, "aria-label": "Study title", onchange: e => save({ title: e.target.value.trim() || "Untitled study" }) })),
    h("div", { class: "field" }, h("span", null, "Runs in this study"),
      runsIdx.length ? h("div", { class: "rows" }, runsIdx.map(r => h("label", { class: "check" }, h("input", { type: "checkbox", checked: sd.runs.includes(r.id), onchange: () => toggleRun(r.id) }), `${r.title} (${r.date})`)))
        : h("p", { class: "muted" }, "No saved runs yet. Check each plate first; they're saved in this browser automatically.")),
    missing.length > 0 && h("p", { class: "warn" }, `${missing.length} run(s) in this study are no longer saved in this browser and were left out.`),
    h("label", { class: "field" }, h("span", null, "How to line the plates up"),
      h("select", { "aria-label": "Plate correction", onchange: e => save({ mode: e.target.value }) },
        [["calibrator", "Calibrator sample on every plate (recommended)"], ["centre", "Centre each plate (no calibrator)"], ["none", "No correction"]].map(([v, l]) => h("option", { value: v, selected: sd.mode === v }, l))),
      h("small", null, sd.mode === "calibrator" ? "The same sample (for example a pooled cDNA) run on every plate. Each plate is shifted so the calibrator agrees, gene by gene, as in qBase."
        : sd.mode === "centre" ? "Only fair when every plate holds a similar mix of groups. If one plate is mostly one group, this hides real differences."
          : "Only if every plate was run and analysed under the same conditions.")),
    sd.mode === "calibrator" && h("div", { class: "field" }, h("span", null, "Calibrator sample(s)"),
      shared.length ? h("div", { class: "row wrap" }, shared.map(u => h("label", { class: "check" },
        h("input", { type: "checkbox", checked: sd.calibrators.includes(u.unit), onchange: () => save({ calibrators: sd.calibrators.includes(u.unit) ? sd.calibrators.filter(x => x !== u.unit) : [...sd.calibrators, u.unit] }) }),
        `${u.unit} (on ${u.plates} of ${runs.length} plates)`)))
        : h("p", { class: "muted" }, runs.length > 1 ? "No sample name appears on more than one of these plates." : "Add at least two runs.")),
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => {
      if (!confirm(`Delete the study “${sd.title}”? The runs themselves are kept.`)) return;
      try { S.removeStudy(sd.id); } catch { /* storage unavailable */ }
      st.study = null; ax.renderMain();
    } }, "Delete study")))];
  if (!runs.length) return out;
  out.push(card(h("h2", null, "Analysis settings"), settingsPanel(ax, sd.settings, info, patch => save({ settings: { ...sd.settings, ...patch, on: true } }))));
  const a = A.analyzeStudy(runs, sd);
  const base = sd.title.replace(/[^\w.-]+/g, "_").slice(0, 60) || "study";
  return [...out, ...resultsBlock(ax, a, base)];
}
