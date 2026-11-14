// "Assay calculations" page: pick the kind of experiment (ChIP, MSRE, 3C, polysome…), label the wells it needs,
// and see the result with a chart. The maths lives in assays.js; this file only builds the page.
// app.js passes in its own helpers (h, change, plateGrid…) so this page looks and behaves like the Plate page.
import * as A from "./assays.js";
import * as RS from "./assay-stats.js";

// Okabe–Ito colours: readable with the common kinds of colour blindness.
const SERIES = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#56B4E9", "#D55E00", "#8C7A2B", "#4D4D4D"];
const ROLE_TONE = { ip: "#0072B2", input: "#9AA59F", igg: "#E69F00", digested: "#CC79A7", mock: "#9AA59F", meth_ref: "#0B6B5C", test: "#0072B2",
  treated: "#009E73", untreated: "#9AA59F", library: "#0072B2", template: "#E69F00", fraction: "#56B4E9", blank: "#9AA59F", blocked: "#D55E00", unblocked: "#9AA59F" };
const NS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; }

// Grouped bar chart as SVG: one group per region (or fraction), one bar per set.
export function barChart(chart) {
  const bars = (chart?.bars || []).filter(b => typeof b.value === "number" && Number.isFinite(b.value));
  if (!bars.length) return null;
  const groups = [...new Set(bars.map(b => b.group))], series = [...new Set(bars.map(b => b.series))];
  const W = 680, H = 300, L = 62, R = 12, T = 14, B = 64;
  const vals = bars.map(b => b.value), ref = typeof chart.refLine === "number" ? [chart.refLine] : [];
  let lo = Math.min(0, ...vals, ...ref), hi = Math.max(0, ...vals, ...ref);
  if (hi === lo) hi = lo + 1;
  hi += (hi - lo) * 0.08;
  const raw = (hi - lo) / 5, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw);
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const gw = (W - L - R) / groups.length, bw = Math.max(3, Math.min(28, (gw * 0.8) / series.length));
  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${chart.yLabel} by ${groups.length > 1 ? "region" : "sample"}`, style: "width:100%;max-width:760px;height:auto;font:11px var(--sans)" });
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const t = +v.toFixed(10);
    svg.append(s("line", { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: t === 0 ? "#9AA59F" : "#E6EBE8" }),
      s("text", { x: L - 6, y: y(t) + 3.5, "text-anchor": "end", fill: "#5B6762" }, A.fmtNum(t, step < 1 ? (step < 0.1 ? 2 : 1) : 0)));
  }
  if (ref.length) svg.append(s("line", { x1: L, x2: W - R, y1: y(ref[0]), y2: y(ref[0]), stroke: "#17201C", "stroke-dasharray": "4 3" }));
  svg.append(s("text", { x: 14, y: (T + H - B) / 2, transform: `rotate(-90 14 ${(T + H - B) / 2})`, "text-anchor": "middle", fill: "#17201C" }, chart.yLabel));
  groups.forEach((g, gi) => {
    const x0 = L + gi * gw + (gw - bw * series.length) / 2;
    series.forEach((ser, si) => {
      const b = bars.find(q => q.group === g && q.series === ser);
      if (!b) return;
      const top = y(Math.max(0, b.value)), bot = y(Math.min(0, b.value)), color = SERIES[si % SERIES.length];
      svg.append(s("rect", { x: x0 + si * bw, y: top, width: bw - 2, height: Math.max(1, bot - top), fill: color, "fill-opacity": b.muted ? 0.4 : 0.9 },
        s("title", {}, `${ser}, ${g}: ${A.fmtNum(b.value, 3)}`)));
    });
    const label = String(g).length > 16 ? String(g).slice(0, 15) + "…" : String(g);
    svg.append(s("text", { x: L + gi * gw + gw / 2, y: H - B + 14, "text-anchor": groups.length > 6 ? "end" : "middle", fill: "#17201C",
      transform: groups.length > 6 ? `rotate(-35 ${L + gi * gw + gw / 2} ${H - B + 14})` : "" }, label));
  });
  const legend = document.createElement("div");
  legend.className = "legend";
  for (const [i, ser] of series.entries()) {
    const sw = document.createElement("span"); sw.className = "sw"; sw.style.cssText = `background:${SERIES[i % SERIES.length]};border-radius:2px`;
    const item = document.createElement("span"); item.append(sw, ser); legend.append(item);
  }
  const fig = document.createElement("figure");
  fig.append(svg, legend);
  return fig;
}

export function assayView(ctx) {
  const { h, st, card } = ctx;
  if (!st.res?.rows?.length) return [ctx.emptyCard("Import a results file first.", "data")];
  const setup = A.normalizeAssaySetup(st.exp.assaySetup);
  const sha = st.exp.source?.sha256 || "";
  const stale = !!(setup.sourceSha && sha && setup.sourceSha !== sha);
  if (stale) setup.wells = {};
  const assay = A.assayById(setup.type), family = assay && A.FAMILIES[assay.family];
  // Every edit goes through app.js's change(): logged in the history, re-analysed and saved.
  const save = (action, detail, fn, opts) => ctx.change(action, detail, () => {
    const next = A.normalizeAssaySetup(st.exp.assaySetup);
    if (next.sourceSha && sha && next.sourceSha !== sha) next.wells = {};
    fn(next); next.sourceSha = sha; st.exp.assaySetup = next;
  }, opts);
  const rows = st.res.rows, targets = [...new Set(rows.map(r => r.target).filter(Boolean))].sort();

  const picker = h("select", { "aria-label": "Experiment type", onchange: ev => {
    const id = ev.target.value, a = A.assayById(id);
    save("assay.type", a ? `Assay type set to ${a.name}` : "Assay type cleared", s => { s.type = id; if (A.assayById(setup.type)?.family !== a?.family) s.params = {}; });
  } },
  h("option", { value: "", selected: !assay }, "None: only check the run"),
  Object.entries(A.FAMILIES).map(([fid, f]) => h("optgroup", { label: f.name }, A.ASSAYS.filter(a => a.family === fid).map(a => h("option", { value: a.id, selected: a.id === setup.type }, a.name)))));

  const out = [card(h("h2", null, "Assay calculations"),
    h("p", { class: "lede" }, "Many experiments read out by qPCR: ChIP, CUT&RUN, RIP, MeDIP, MSRE, MethyLight, DNase and ATAC, 3C, polysome profiling, immuno-PCR, 4sU labelling. Pick yours, mark which wells are IP, input, IgG and so on, and I'll do the standard calculation for it. The run checks on the other pages still apply to every well."),
    h("div", { class: "row" }, h("label", { class: "field" }, h("span", null, "What kind of experiment is this?"), picker)),
    assay && h("p", { class: "fine" }, `Covers ${assay.covers.join(", ")}. Needs wells labelled ${assay.require.map(r => A.ASSAY_ROLE_LABEL[r]).join(" and ")}.`, assay.note ? ` ${assay.note}` : ""))];
  if (!assay) return out;

  // ---- settings for this calculation
  const params = A.assayParams(setup);
  const labelled = A.labelRows(rows, setup);
  const setNames = [...new Set(labelled.map(r => r.aset))].sort();
  const setParam = (p, raw) => {
    let v = raw;
    if (p.type === "number" && raw !== "") {
      v = Number(raw);
      if (!Number.isFinite(v) || v < 0 || (p.key === "inputPercent" && (v <= 0 || v > 100))) { ctx.flash(`${p.label}: “${raw}” isn't a usable number, so it wasn't changed.`, true); ctx.renderMain(); return; }
    }
    if ((setup.params[p.key] ?? "") === v) return;
    save("assay.param", `${p.label}: ${v === "" ? "cleared" : v}`, s => { if (v === "") delete s.params[p.key]; else s.params[p.key] = v; });
  };
  const control = p => {
    const val = params[p.key] ?? "";
    if (p.type === "number") return h("input", { type: "number", class: "num-in", step: p.step, min: 0, value: val === "" ? "" : String(val), "aria-label": p.label, onchange: ev => setParam(p, ev.target.value.trim()) });
    const opts = p.type === "select" ? p.options : [["", p.required ? "Choose…" : "None"], ...(p.type === "set" ? setNames : targets).map(t => [t, t])];
    return h("select", { "aria-label": p.label, onchange: ev => setParam(p, ev.target.value) }, opts.map(([v, l]) => h("option", { value: v, selected: String(val) === v }, l)));
  };
  out.push(card(h("h3", null, family.name),
    h("div", { class: "rows" }, family.params.map(p => h("label", { class: "line" }, h("span", { class: "line-l" }, p.label), h("span", { class: "line-c" }, control(p), p.hint && h("small", null, p.hint))))),
    h("details", null, h("summary", null, "How it's calculated"),
      h("pre", { class: "fd-evidence" }, family.formula.join("\n")),
      h("p", { class: "fine" }, "Technical replicates are averaged as Ct values first. A Ct difference becomes a ratio as E^ΔCt, where E = 1 + the PCR efficiency of that primer pair: E = 2 (every copy doubles each cycle, 100%) unless you set the efficiency below."),
      h("ul", { class: "fine" }, family.refs.map(k => h("li", null, A.REFS[k].cite, A.REFS[k].doi ? ` doi:${A.REFS[k].doi}` : ` PMID ${A.REFS[k].pmid}`))))));

  // ---- PCR efficiency per primer pair: 100% unless the user picks the plate's standard curve or types a value
  const effTargets = [...new Set(labelled.map(r => r.target).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (effTargets.length) {
    const effs = A.efficiencies(setup, st.res.stdCurves, effTargets), chosen = setup.eff || {};
    const setEff = (t, v, what) => save("assay.efficiency", `${t}: PCR efficiency ${what}`, s => {
      const next = { ...(s.eff || {}) };
      if (v === null) delete next[t]; else Object.defineProperty(next, t, { value: v, enumerable: true, writable: true, configurable: true });
      s.eff = next;
    });
    const typed = (t, raw) => {
      const v = Number(String(raw).trim());
      if (!String(raw).trim() || !Number.isFinite(v) || v < A.EFF_MIN || v > A.EFF_MAX) { ctx.flash(`Efficiency for ${t}: “${String(raw).slice(0, 20)}” isn't a percentage between ${A.EFF_MIN} and ${A.EFF_MAX}, so it wasn't changed.`, true); ctx.renderMain(); return; }
      if (chosen[t] === v) return;
      setEff(t, v, `set to ${v}% (typed in)`);
    };
    out.push(card(h("h3", null, "PCR efficiency per primer pair"),
      h("p", { class: "fine" }, "Every result assumes 100% efficiency (E = 2) unless you change it here. If the plate has a standard curve for a target (wells marked Standard with quantities), you can use its efficiency; otherwise type one in from your assay validation. The efficiency used is shown in the results table and the report."),
      h("div", { class: "rows" }, effTargets.map(t => {
        const e = effs.get(t), mode = chosen[t] === "curve" ? "curve" : typeof chosen[t] === "number" ? "typed" : "assumed";
        const sel = h("select", { "aria-label": `Efficiency source for ${t}`, onchange: ev => {
          const m = ev.target.value;
          if (m === "assumed") setEff(t, null, "back to 100% (assumed)");
          else if (m === "curve") setEff(t, "curve", e.curve !== null ? `from the standard curve (${A.fmtNum(e.curve, 1)}%)` : "from the standard curve");
          else { ctx.flash(`Type the efficiency for ${t} in the box next to it.`); typed(t, chosen[t] ?? 100); }
        } },
        h("option", { value: "assumed", selected: mode === "assumed" }, "100% (assumed)"),
        h("option", { value: "curve", selected: mode === "curve", disabled: e.curve === null && mode !== "curve" }, e.curve !== null ? `Standard curve on this plate: ${A.fmtNum(e.curve, 1)}%` : "Standard curve (none on this plate)"),
        h("option", { value: "typed", selected: mode === "typed" }, "Type it in"));
        return h("label", { class: "line" }, h("span", { class: "line-l mono" }, t),
          h("span", { class: "line-c" }, sel,
            mode === "typed" && h("input", { type: "number", class: "num-in", step: 0.1, min: A.EFF_MIN, max: A.EFF_MAX, value: String(chosen[t]), "aria-label": `Efficiency % for ${t}`, onchange: ev => typed(t, ev.target.value) }),
            h("small", null, `Used: ${A.effLabel(e)}${e.source === "curve" ? `, ${e.note}` : e.source === "missing" ? `, ${e.note}` : ""}`)));
      }))));
  }

  // ---- labelling wells, on the same plate picture as the Plate page
  const byKey = new Map();
  for (const r of rows) if (r.key) (byKey.get(r.key) || byKey.set(r.key, []).get(r.key)).push(r);
  const labelOf = new Map(labelled.map(r => [r.id, r]));
  const roleAt = k => { const set = new Set((byKey.get(k) || []).map(r => labelOf.get(r.id)?.arole || "")); return set.size === 1 ? [...set][0] : "mixed"; };
  const present = [...byKey.keys()];
  const toggle = keys => { const all = keys.every(k => st.sel.has(k)); for (const k of keys) all ? st.sel.delete(k) : st.sel.add(k); ctx.renderMain(); };
  const grid = ctx.plateGrid({ ...ctx.plateDims(rows),
    cls: k => (!byKey.has(k) ? "none" : roleAt(k) === "mixed" ? "mixed" : "r-sample") + (st.sel.has(k) ? " sel" : ""),
    style: k => { const r = roleAt(k); return byKey.has(k) && r !== "mixed" ? `--fill:${r ? ROLE_TONE[r] : "#fff"}` : ""; },
    title: k => (byKey.get(k) || []).map(r => { const l = labelOf.get(r.id); return `${k}: ${r.sample ?? "—"} / ${r.target ?? "—"}${l ? ` (${A.ASSAY_ROLE_LABEL[l.arole]}, set ${l.aset}${l.afraction ? `, fraction ${l.afraction}` : ""})` : ""}`; }).join("\n"),
    onCell: k => byKey.has(k) && toggle([k]), onRow: L => toggle(present.filter(k => k[0] === L)), onCol: c => toggle(present.filter(k => k.slice(1) === String(c))) });
  const picked = rows.filter(r => st.sel.has(r.key) && r.role !== "ntc" && r.role !== "empty"), keys = [...st.sel];
  const setFor = (what, patch) => {
    if (!picked.length) return;
    save("assay.label", `${what} for ${keys.join(", ")}`, s => {
      for (const r of picked) {
        if (patch === null) { delete s.wells[r.id]; continue; }
        if (!s.wells[r.id] && !patch.role) continue; // a set name alone doesn't say what the well is
        const cur = s.wells[r.id] || { role: patch.role || family.roles[0], set: A.defaultSet(r), fraction: "" };
        s.wells[r.id] = { ...cur, ...patch };
      }
    });
  };
  const setIn = h("input", { type: "text", placeholder: "Set, e.g. WT or KO-2", "aria-label": "Set name" });
  const fracIn = h("input", { type: "text", placeholder: "Fraction, e.g. 3 or bound", "aria-label": "Fraction" });
  const unl = rows.filter(r => r.role !== "ntc" && r.role !== "empty" && !setup.wells[r.id]);
  const guesses = A.guessLabels(unl, assay.family);
  const legendRoles = family.roles.filter(r => labelled.some(x => x.arole === r));
  out.push(card(h("h3", null, "Which wells are which"),
    h("p", { class: "fine" }, "Select wells, then say what they are. Wells from the same chromatin or DNA share a set (IP, input and IgG of one sample, for example); the set starts as the well's group, or the sample name without words like “input” or “IgG”. NTC and unused wells are never included."),
    stale && h("p", { class: "warn" }, "The results file was replaced since these wells were labelled, so the old labels were set aside."),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", disabled: !Object.keys(guesses).length, title: "Uses words like IP, input, IgG, mock, digested, blank or Fr 3 in the sample names. Wells you've labelled already are left alone.",
        onclick: () => save("assay.guess", `Labelled ${Object.keys(guesses).length} well(s) from their sample names`, s => { Object.assign(s.wells, guesses); }) },
      Object.keys(guesses).length ? `Fill in ${Object.keys(guesses).length} well${Object.keys(guesses).length === 1 ? "" : "s"} from sample names` : "Nothing to fill in from sample names"),
      Object.keys(setup.wells).length > 0 && h("button", { class: "link", type: "button", onclick: () => { if (confirm("Remove every assay label from this run? The wells and their Ct values stay as they are.")) save("assay.clear", "Cleared all assay labels", s => { s.wells = {}; }); } }, "Clear all labels")),
    h("div", { class: "plate-body" + (ctx.plateDims(rows).cols === 24 ? " p384" : "") }, grid),
    h("div", { class: "legend map-legend" }, legendRoles.map(r => h("span", null, h("span", { class: "sw", style: `background:${ROLE_TONE[r]}` }), A.ASSAY_ROLE_LABEL[r])),
      h("span", null, h("span", { class: "sw", style: "background:#fff;border:1px solid #C3CCC7" }), "Not labelled")),
    picked.length
      ? h("div", { class: "rolebar" },
        h("p", { class: "rb-q" }, `${keys.length} well${keys.length === 1 ? "" : "s"} selected (${keys.slice(0, 8).join(", ")}${keys.length > 8 ? "…" : ""}).`),
        h("div", { class: "seg roles", role: "group", "aria-label": "Assay label" }, family.roles.map(r => {
          const on = picked.every(x => labelOf.get(x.id)?.arole === r);
          return h("button", { type: "button", class: on ? "on" : "", "aria-pressed": String(on), title: A.ASSAY_ROLE_HELP[r], onclick: () => setFor(`label ${A.ASSAY_ROLE_LABEL[r]}`, { role: r }) }, A.ASSAY_ROLE_LABEL[r]);
        }), h("button", { type: "button", onclick: () => setFor("label removed", null) }, "Not part of it")),
        h("div", { class: "row rb-more" },
          setIn, h("button", { class: "btn", type: "button", onclick: () => setIn.value.trim() && setFor(`set “${setIn.value.trim()}”`, { set: setIn.value.trim().slice(0, 200) }) }, "Set name"),
          assay.family === "fractions" && [fracIn, h("button", { class: "btn", type: "button", onclick: () => fracIn.value.trim() && setFor(`fraction “${fracIn.value.trim()}”`, { role: "fraction", fraction: fracIn.value.trim().slice(0, 40) }) }, "Set fraction")],
          h("button", { class: "link", type: "button", onclick: () => { st.sel.clear(); ctx.renderMain(); } }, "Clear selection")))
      : h("p", { class: "rb-hint" }, "Select wells on the plate, then choose what they are. Click a row letter or column number to pick a whole row or column."),
    labelled.length > 0 && h("details", null, h("summary", null, `Labelled wells (${labelled.length})`),
      h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, ["Well", "Sample", "Target", "Ct/Cq (raw)", "Label", "Set", "Fraction"].map(x => h("th", null, x)))),
        h("tbody", null, labelled.map(r => h("tr", null, h("td", null, r.key || r.well), h("td", null, r.sample ?? ""), h("td", null, r.target ?? ""), h("td", { class: "mono" }, r.ct ?? "(empty)"),
          h("td", null, A.ASSAY_ROLE_LABEL[r.arole]), h("td", null, r.aset), h("td", null, r.afraction)))))))));

  // ---- results
  let res;
  try { res = A.runAssay(st.exp, rows, { stdCurves: st.res.stdCurves }); } catch (e) { out.push(card(h("p", { class: "error" }, `The calculation could not run: ${e.message}`))); return out; }
  const cell = (r, [k, , d]) => (typeof r[k] === "number" ? A.fmtNum(r[k], d ?? 2) : r[k] ?? "");
  const SEV = { high: "High", medium: "Medium", low: "Low" };
  out.push(card(h("h2", null, `Results: ${assay.name}`),
    res.warnings.length > 0 && h("ul", { class: "assay-warn", style: "list-style:none;padding:0;display:grid;gap:6px" }, res.warnings.map(w => h("li", { class: "warn" }, h("span", { class: "sev " + w.level, style: "margin-right:8px" }, SEV[w.level]), w.text))),
    res.rows.length && res.columns.length
      ? [barChart(res.chart),
        h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
          h("thead", null, h("tr", null, res.columns.map(c => h("th", null, c[1])))),
          h("tbody", null, res.rows.map(r => h("tr", { class: "click", tabindex: 0, onclick: () => { st.sel = new Set((r.wells || []).map(w => String(w))); ctx.renderMain(); } },
            res.columns.map(c => h("td", { class: typeof r[c[0]] === "number" ? "num" : "" }, cell(r, c)))))))),
        assay.family === "fractions" && res.summary?.length > 0 && h("p", null, `Share in polysome fractions (fraction ${params.polysomeFrom} onwards): ${res.summary.map(x => `${x.set} / ${x.target} ${A.fmtNum(x.polysomal, 1)}%`).join("; ")}.`),
        assay.family === "signal" && res.summary?.length > 0 && h("p", { class: "fine" }, "Blanks: " + res.summary.map(x => `${x.target} mean Ct ${A.fmtNum(x.blankMean)} (SD ${A.fmtNum(x.blankSd, 3)}, n = ${x.nBlank})`).join("; ") + ".")]
      : h("p", { class: "muted" }, "No results yet. Label the wells above."),
    h("p", { class: "fine" }, "Click a row to select its wells on the plate. The values come straight from the exported Ct values; nothing is removed or changed. The same table goes into the report.")));
  if (res.rows.length) out.push(replicateCard(ctx, setup, res, save));
  return out;
}

// ---------------------------------------------------------------- comparing conditions across biological replicates
function svgNode(n) {
  if (typeof n === "string") return document.createTextNode(n);
  const [tag, attrs, ...kids] = n, e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of kids) e.append(svgNode(c));
  return e;
}
function downloadPng(ctx, tree, name, dpi = 300) {
  const w = Number(tree[1].width), hh = Number(tree[1].height), k = dpi / 96, img = document.createElement("img");
  img.onload = () => {
    const cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(hh * k);
    const g = cv.getContext("2d"); if (!g) return;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
    cv.toBlob?.(async b => { if (b) ctx.download(name, new Uint8Array(await b.arrayBuffer()), "image/png"); }, "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(RS.svgString(tree));
}
function replicateCard(ctx, setup, res, save) {
  const { h, card } = ctx;
  const skip = new Set([res.params.calibratorSet, res.params.backgroundSet].filter(Boolean));
  const setNames = [...new Set(res.rows.map(r => r.set))].filter(s => s && !skip.has(s)).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  const cond = setup.cond || {}, st = RS.cleanStats(setup.stats), c = res.replicates;
  const known = [...new Set(Object.values(cond))].sort();
  const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  const setCond = (set, v) => { v = String(v).trim().slice(0, 80); if ((cond[set] || "") === v) return; save("assay.condition", `${set}: condition ${v || "cleared"}`, s => { const n = { ...(s.cond || {}) }; if (v) put(n, set, v); else delete n[set]; s.cond = n; }); };
  const guesses = setNames.filter(s => !cond[s] && RS.guessCondition(s));
  const setStat = (k, v, label) => save("assay.stats", `${label}: ${v}`, s => { s.stats = { ...RS.cleanStats(s.stats), [k]: v }; });
  const sel = (label, key, opts, val) => h("label", { class: "field" }, h("span", null, label),
    h("select", { "aria-label": label, onchange: ev => setStat(key, ev.target.value, label) }, opts.map(([v, l]) => h("option", { value: v, selected: v === val }, l))));
  const dl = "assay-cond-list";
  const parts = [h("h2", null, "Comparing conditions (biological replicates)"),
    h("p", { class: "fine" }, "Each set is one chromatin, DNA or lysate, so one biological replicate. Say which condition each set belongs to (for example WT-1, WT-2 and WT-3 are WT). Each region is then compared between conditions, with each set counted once. Leave a set empty to keep it out."),
    h("datalist", { id: dl }, known.map(k => h("option", { value: k }))),
    h("div", { class: "row" }, h("button", { class: "btn", type: "button", disabled: !guesses.length, title: "Takes the replicate number off the set name: WT-1 and WT rep2 become WT.",
      onclick: () => save("assay.condition", `Conditions filled in from set names for ${guesses.length} set(s)`, s => { const n = { ...(s.cond || {}) }; for (const g of guesses) put(n, g, RS.guessCondition(g)); s.cond = n; }) },
    guesses.length ? `Fill in ${guesses.length} condition${guesses.length === 1 ? "" : "s"} from set names` : "Nothing to fill in from set names"),
    Object.keys(cond).length > 0 && h("button", { class: "link", type: "button", onclick: () => save("assay.condition", "Cleared all conditions", s => { delete s.cond; }) }, "Clear conditions")),
    h("div", { class: "rows" }, setNames.map(s => h("label", { class: "line" }, h("span", { class: "line-l mono" }, s),
      h("span", { class: "line-c" }, h("input", { type: "text", list: dl, value: cond[s] || "", placeholder: "Condition, e.g. WT", "aria-label": `Condition for ${s}`, onchange: ev => setCond(s, ev.target.value) })))))];
  if (c) {
    parts.push(h("div", { class: "row wrap" },
      c.metrics.length > 1 && sel("Compare", "metric", c.metrics.map(m => [m[0], m[1]]), c.metric),
      sel("Test", "test", Object.entries(RS.TESTS).map(([k, v]) => [k, v.label]), st.test),
      sel("Adjust p across regions", "correction", Object.entries(RS.CORRECTIONS), st.correction),
      c.conditions.length > 1 && sel("Control condition", "control", c.conditions.map(x => [x, x]), c.control),
      c.kind === "pct" && sel("Scale for percentages", "pctScale", Object.entries(RS.PCT_SCALES), st.pctScale)),
    h("p", { class: "fine" }, `${RS.TESTS[st.test].help} The test runs on ${RS.scaleNote(c)}.`));
    if (c.warnings.length) parts.push(h("ul", { class: "assay-warn", style: "list-style:none;padding:0;display:grid;gap:6px" }, c.warnings.map(w => h("li", { class: "warn" }, h("span", { class: "sev " + w.level, style: "margin-right:8px" }, w.level[0].toUpperCase() + w.level.slice(1)), w.text))));
    if (c.comparisons.length) {
      const tb = RS.comparisonTable(c), tree = RS.replicateFigure(c), base = `${ctx.st.exp.id || "assay"}-${c.metric}-by-condition`;
      parts.push(h("div", { class: "tablewrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, tb.head.map(x => h("th", null, x)))),
        h("tbody", null, tb.rows.map(r => h("tr", null, r.map(x => h("td", null, String(x)))))))),
      c.regions.some(r => r.anova) && h("p", { class: "fine" }, c.regions.filter(r => r.anova).map(r => `${r.region}: ${r.anova.name} p ${RS.fmtP(r.anova.p)} (adjusted ${RS.fmtP(r.anova.pAdj)})`).join("; ")),
      c.regions.some(r => r.note) && h("p", { class: "fine" }, c.regions.filter(r => r.note).map(r => `${r.region}: ${r.note}`).join(" ")),
      tree && h("figure", { class: "ana-fig" }, h("div", { style: "overflow-x:auto" }, svgNode(tree))),
      h("div", { class: "row" },
        tree && h("button", { class: "btn", type: "button", onclick: () => ctx.download(`${base}.svg`, '<?xml version="1.0" encoding="UTF-8"?>\n' + RS.svgString(tree), "image/svg+xml") }, "Download SVG"),
        tree && h("button", { class: "btn", type: "button", onclick: () => downloadPng(ctx, tree, `${base}.png`) }, "Download PNG (300 dpi)"),
        h("button", { class: "btn", type: "button", onclick: () => ctx.download(`${base}.csv`, RS.comparisonCsv(c), "text/csv") }, "Download CSV")),
      h("p", { class: "fine" }, "Mean ± SD is arithmetic, in the units of the result. The same table and graph go into the report."));
    }
  }
  return card(...parts);
}
