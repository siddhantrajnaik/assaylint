// AssayLint web app. All processing and storage happen in this browser tab.
import * as C from "./core.js";
import * as R from "./report.js";
import * as S from "./store.js";
import { demoFiles, DEMO_CONTEXT, DEMO_TITLE } from "./demo.js";
import { plot } from "./charts.js";
import { CREDIT } from "./credit.js";

const $ = s => document.querySelector(s);
// File contents are untrusted: the DOM is built with text nodes only (no innerHTML).
const PROPS = new Set(["value", "checked", "disabled", "hidden", "selected", "colSpan", "title", "type", "placeholder", "rows", "step", "min", "accept", "srcdoc"]);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (PROPS.has(k)) e[k] = v;
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}

const st = { category: "", exp: null, res: null, err: null, tab: "setup", sel: new Set(), selFinding: null, pending: {}, sort: "severity",
  filter: "", hideClosed: false, compareId: "", mapFilter: "all", bulkField: "role", saveError: null, flash: null };
const after = [];
const actor = () => S.getSetting("actor") || "local user";
const fmt = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const when = iso => (iso ? iso.slice(0, 16).replace("T", " ") : "");
let plateHost = null, plate3d = null, webglFailed = false, mapRefresh = null;

// ---------------------------------------------------------------- state changes
function reanalyze() {
  st.err = null;
  try { st.res = st.exp ? C.analyze(st.exp) : null; } catch (e) { st.res = null; st.err = e.message; }
}
function persist() {
  if (!st.exp) return;
  try { S.save(st.exp, st.res?.summary); st.saveError = null; }
  catch { st.saveError = "Could not save to this browser's storage (it may be full or disabled). Export the experiment packet to keep your work."; }
}
// Every user change is logged to the audit history, re-analysed and autosaved.
function change(action, detail, fn, { rerender = true } = {}) {
  fn?.();
  C.logAudit(st.exp, actor(), action, detail);
  reanalyze(); persist();
  if (rerender) render(); else renderSidebar();
}
function openExp(id) {
  const e = S.load(id);
  if (!e) return;
  Object.assign(st, { exp: e, sel: new Set(), selFinding: null, pending: {}, compareId: "", tab: e.source ? "findings" : "data" });
  reanalyze(); render(); scrollTo(0, 0);
}
function flash(msg, bad = false) { st.flash = { msg, bad }; }
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
addEventListener("beforeunload", e => { if (st.saveError) e.preventDefault(); });

// ---------------------------------------------------------------- shell
function render() { renderSidebar(); renderMain(); }
const put = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));
const NS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, ...kids) { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; }
// A microplate drawn as wells; `lit` maps well keys to a colour variable.
function plateArt(rows, cols, lit = {}, r = 4.2) {
  const g = 11, s = svg("svg", { viewBox: `0 0 ${cols * g + 2} ${rows * g + 2}`, "aria-hidden": "true", class: "plate-art" });
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const k = String.fromCharCode(65 + i) + (j + 1);
    s.append(svg("circle", { cx: j * g + g / 2 + 1, cy: i * g + g / 2 + 1, r, style: `fill:var(${lit[k] || "--well"})` }));
  }
  return s;
}
function creditBlock(cls) {
  return h("div", { class: "credit " + cls },
    h("p", null, "Made by ", h("a", { href: CREDIT.github, class: "link", target: "_blank", rel: "noopener" }, CREDIT.name), `, ${CREDIT.affiliation}.`),
    h("p", null, "Questions, bugs or a file it can't read? Email me at ", h("a", { href: `mailto:${CREDIT.email}?subject=AssayLint`, class: "link" }, CREDIT.email), "."),
    CREDIT.linkedin && h("p", null, h("a", { href: CREDIT.linkedin, class: "link", target: "_blank", rel: "noopener" }, "LinkedIn")));
}
function renderSidebar() {
  const list = S.index();
  put($("#side"),
    h("div", { class: "brand" }, plateArt(2, 3, { A1: "--accent", A2: "--accent", B1: "--accent", B2: "--w-high" }, 4.4), h("span", { class: "wordmark" }, "AssayLint")),
    h("div", { class: "side-actions" },
      h("button", { class: "btn primary", type: "button", onclick: newExp }, "New experiment"),
      h("div", { class: "btn-row" },
        h("button", { class: "btn", type: "button", onclick: loadDemo }, "Open demo run"),
        h("label", { class: "btn" }, "Import packet", h("input", { type: "file", accept: ".json,application/json", onchange: e => importPacket(e.target.files[0]) })))),
    h("h2", { class: "side-h" }, "Experiments"),
    h("nav", { class: "explist", "aria-label": "Experiments" }, list.length ? list.map(x => h("button", { type: "button", class: "expitem" + (st.exp?.id === x.id ? " on" : ""), "aria-current": st.exp?.id === x.id ? "true" : null, onclick: () => openExp(x.id) },
      h("span", { class: "exp-title" }, x.title), h("span", { class: "exp-meta" }, h("span", { class: "status " + x.status }, x.label), h("span", null, x.date))))
      : h("p", { class: "muted" }, "Nothing here yet. Start a new one, or open the demo to see how it works.")),
    h("div", { class: "side-foot" },
      h("label", { class: "field" }, h("span", null, "Your name for the audit history"),
        h("input", { type: "text", value: S.getSetting("actor") || "", placeholder: "local user", onchange: e => { try { S.setSetting("actor", e.target.value.trim()); } catch { /* storage unavailable */ } } })),
      h("div", { class: "side-links" },
        h("button", { class: "link", type: "button", onclick: () => { $("#storage-usage").textContent = `AssayLint currently uses about ${(S.usageBytes() / 1024).toFixed(0)} KB of this browser's storage.`; $("#dlg-privacy").showModal(); } }, "Data handling"),
        h("button", { class: "link", type: "button", onclick: () => $("#dlg-glossary").showModal() }, "Glossary"),
        h("a", { href: "#", class: "link", id: "src-link", hidden: true }, "Source code")),
      st.exp && creditBlock("side-credit")),
    st.saveError && h("p", { class: "error" }, st.saveError));
  setSourceLink();
}
function setSourceLink() {
  if (!location.hostname.endsWith("github.io")) return;
  const user = location.hostname.split(".")[0], repo = location.pathname.split("/")[1], a = $("#src-link");
  if (a && repo) { a.href = `https://github.com/${user}/${repo}`; a.hidden = false; }
}

const TABS = [["setup", "Setup", 1], ["data", "Data", 2], ["map", "Plate map", 3], ["context", "Context & rules", 4],
  ["findings", "Findings", 5], ["report", "Report & export", 6], ["compare", "Compare runs", null]];
const tabLabel = k => TABS.find(t => t[0] === k)[1];
function renderMain() {
  after.length = 0; mapRefresh = null;
  const y = scrollY, m = $("#main");
  if (!st.exp) { put(m, welcome()); return; }
  const e = st.exp, sum = st.res?.summary;
  const flashEl = st.flash && h("p", { class: "flash" + (st.flash.bad ? " bad" : ""), role: "status" }, st.flash.msg);
  st.flash = null;
  put(m,
    h("header", { class: "exp-head" },
      h("div", null, h("h1", null, e.title),
        h("dl", { class: "meta" }, h("div", null, h("dt", null, "ID"), h("dd", { class: "mono" }, e.id)), h("div", null, h("dt", null, "Run date"), h("dd", null, e.date)),
          e.operator && h("div", null, h("dt", null, "Operator"), h("dd", null, e.operator)), e.source && h("div", null, h("dt", null, "Results"), h("dd", null, e.source.name)))),
      sum && h("span", { class: "status big " + sum.status }, sum.label)),
    h("nav", { class: "steps", role: "tablist", "aria-label": "Experiment steps" }, TABS.map(([k, label, n]) =>
      h("button", { type: "button", role: "tab", class: k === st.tab ? "on" : "", "aria-selected": String(k === st.tab),
        onclick: () => { if (k !== st.tab) { st.sel = new Set(); st.selFinding = null; } st.tab = k; renderMain(); scrollTo(0, 0); } }, n && h("span", { class: "step-n" }, n), label))),
    flashEl,
    st.err && h("p", { class: "error" }, `The analysis could not run: ${st.err}`),
    ...VIEWS[st.tab]());
  scrollTo(0, y);
  for (const fn of after) fn();
}
const card = (...kids) => h("section", { class: "sec" }, ...kids);
const emptyCard = (msg, tab) => card(h("p", null, msg), tab && h("button", { class: "btn primary", type: "button", onclick: () => { st.tab = tab; renderMain(); } }, "Go to " + tabLabel(tab)));

function welcome() {
  const lit = { C3: "--w-high", C4: "--w-ok", C5: "--w-ok", E8: "--w-medium", E9: "--w-ok", B10: "--w-low", G2: "--w-ok", G3: "--w-ok", G4: "--w-ok", F11: "--w-high" };
  return h("section", { class: "welcome" },
    h("div", { class: "welcome-text" },
      h("h1", null, "Check your qPCR run before you trust the numbers"),
      h("p", { class: "lede" }, "I made AssayLint to catch the boring mistakes in a qPCR run before you analyse it: a mislabelled well, an NTC that came up, replicates that don't agree, a missing control. Upload your instrument export and it shows you what looks off and the exact values behind each flag."),
      h("ol", { class: "how" },
        h("li", null, "Upload the results file from your instrument."),
        h("li", null, "Check the plate map: samples, targets, controls."),
        h("li", null, "Add your method details."),
        h("li", null, "Go through the flags and note what you did about each one."),
        h("li", null, "Download a report to keep with your notebook.")),
      h("div", { class: "btn-row" },
        h("button", { class: "btn primary", type: "button", onclick: newExp }, "New experiment"),
        h("button", { class: "btn", type: "button", onclick: loadDemo }, "Open demo run")),
      h("p", { class: "fine" }, "Your files never leave your browser. AssayLint points out things worth a second look; it can't tell you your experiment is right.")),
    h("figure", { class: "welcome-plate" }, plateArt(8, 12, lit),
      h("figcaption", null, "Each well gets the colour of its worst open flag.")),
    creditBlock("welcome-credit"));
}

// ---------------------------------------------------------------- experiment lifecycle (FR-1, FR-23)
function newExp() {
  st.exp = C.newExperiment({ operator: S.getSetting("actor") || "" }, actor());
  Object.assign(st, { tab: "setup", sel: new Set(), selFinding: null, pending: {} });
  reanalyze(); persist(); render();
  setTimeout(() => $("#f-title")?.select(), 0);
}
async function loadDemo() {
  const f = demoFiles(), a = actor();
  const e = C.newExperiment({ title: DEMO_TITLE, operator: "Demo user", project: "AssayLint demo" }, a);
  e.source = C.fileRecord({ name: "demo_results.csv", text: f.results, sha: await C.sha256(f.results), actor: a, format: C.parseResults(f.results).format });
  e.amp = C.fileRecord({ name: "demo_amplification.csv", text: f.amp, sha: await C.sha256(f.amp), actor: a });
  e.melt = C.fileRecord({ name: "demo_melt_derivative.csv", text: f.melt, sha: await C.sha256(f.melt), actor: a, valueType: "derivative" });
  for (const k of ["source", "amp", "melt"]) C.logAudit(e, a, "file.import", `${e[k].name} (sha256 ${e[k].sha256.slice(0, 12)}…)`);
  e.context = { ...DEMO_CONTEXT };
  Object.assign(e.ruleset.values, { meltChecks: true, expectPositive: true, expectNrt: true });
  C.logAudit(e, a, "ruleset.edit", "Demo: enabled melt checks and expected positive and no-RT controls");
  Object.assign(st, { exp: e, tab: "findings", sel: new Set(), selFinding: null, pending: {} });
  reanalyze(); persist(); render(); scrollTo(0, 0);
}
function deleteExp() {
  const e = st.exp;
  if (!confirm(`Delete “${e.title}” (${e.id}) from this browser?\n\nThis removes its imported files, plate map, context, review notes and audit history. It cannot be undone. Export the packet first if you want a copy.`)) return;
  S.remove(e.id);
  st.exp = null; st.res = null; render();
}
async function importPacket(file) {
  if (!file) return;
  try {
    const exp = await C.verifyPacket(JSON.parse(await file.text()));
    if (S.load(exp.id) && !confirm(`An experiment with ID ${exp.id} already exists in this browser. Replace it with the imported packet?`)) return;
    C.logAudit(exp, actor(), "packet.import", `Imported packet ${file.name}; embedded file checksums verified`);
    Object.assign(st, { exp, tab: exp.source ? "findings" : "data", sel: new Set(), selFinding: null, pending: {} });
    reanalyze(); persist(); flash(`Imported ${exp.title}. Checksums of the embedded files were verified.`); render();
  } catch (e) { flash(`Could not import ${file.name}: ${e.message}`, true); renderMain(); }
}

// ---------------------------------------------------------------- 1 · Setup
const field = (label, input, hint) => h("label", { class: "field" }, h("span", null, label), input, hint && h("small", null, hint));
function textInput(value, onCommit, o = {}) {
  const attrs = { id: o.id, value: value ?? "", placeholder: o.placeholder || "", onchange: ev => onCommit(ev.target.value) };
  return o.multiline ? h("textarea", { rows: 3, ...attrs }) : h("input", { type: o.type || "text", ...attrs });
}
const setExp = (k, label) => val => {
  const old = st.exp[k] ?? "";
  if (old === val) return;
  change("experiment.edit", `${label}: "${old}" → "${val}"`, () => (st.exp[k] = val), { rerender: k === "title" || k === "date" || k === "operator" });
};
const VIEWS = {};
VIEWS.setup = () => {
  const e = st.exp;
  return [
    card(h("h2", null, "Experiment"), h("div", { class: "form2" },
      field("Title", textInput(e.title, setExp("title", "Title"), { id: "f-title" })),
      field("Assay type", h("input", { type: "text", value: "qPCR", disabled: true }), "This version supports qPCR only."),
      field("Run date", textInput(e.date, setExp("date", "Run date"), { type: "date" })),
      field("Operator", textInput(e.operator, setExp("operator", "Operator"))),
      field("Project (optional)", textInput(e.project, setExp("project", "Project"))),
      field("Experiment ID", h("input", { type: "text", value: e.id, disabled: true }), "Stable and unique; included in every export.")),
      h("div", { class: "row", style: "margin-top:1rem" }, h("button", { class: "btn primary", type: "button", onclick: () => { st.tab = "data"; renderMain(); } }, "Continue to Data"))),
    h("section", { class: "sec danger" }, h("h3", null, "Delete experiment"),
      h("p", { class: "muted" }, "This removes the experiment and everything saved with it from this browser. Download the experiment packet first if you want to keep a copy."),
      h("button", { class: "btn danger", type: "button", onclick: deleteExp }, "Delete experiment…"))];
};

// ---------------------------------------------------------------- 2 · Data (FR-2, FR-3, FR-26)
const KIND = {
  results: { slot: "source", title: "qPCR results file", sub: "Required. The Ct/Cq table exported from the instrument software." },
  amp: { slot: "amp", title: "Amplification curves (optional)", sub: "Fluorescence per cycle. Enables curve checks." },
  melt: { slot: "melt", title: "Melt curves (optional)", sub: "Derivative or raw fluorescence per temperature. Checked only if melt checks are enabled for the assay." },
};
async function stage(kind, file) {
  if (!file) return;
  if (file.size > 25e6) { flash(`${file.name} is larger than 25 MB and was not read.`, true); renderMain(); return; }
  stageText(kind, file.name, await file.text());
}
async function stageText(kind, name, text, plateSize) {
  const sha = await C.sha256(text);
  try {
    const parsed = kind === "results" ? C.parseResults(text, { plateSize }) : C.parseCurves(text, kind);
    st.pending[kind] = { name, text, sha, parsed, valueType: parsed.guessedValueType, plateSize };
  } catch (err) { st.pending[kind] = { name, text, sha, error: err.message, details: err.details || {} }; }
  renderMain();
}
function confirmImport(kind) {
  const p = st.pending[kind], k = KIND[kind], e = st.exp;
  const rec = C.fileRecord({ name: p.name, text: p.text, sha: p.sha, actor: actor(), ...(kind === "results" ? { format: p.parsed.format, plateSize: p.plateSize || null } : {}), ...(kind === "melt" ? { valueType: p.valueType } : {}) });
  const old = e[k.slot], clearMap = kind === "results" && old && Object.keys(e.map).length > 0;
  if (clearMap && !confirm("Replacing the results file clears plate-map edits, which are tied to rows of the previous file. Review notes are kept. Continue?")) return;
  delete st.pending[kind];
  const desc = kind === "results" ? `${C.FORMATS[rec.format]}, ${p.parsed.rows.length} rows` : `${p.parsed.layout} layout, ${Object.keys(p.parsed.series).length} curves${kind === "melt" ? `, values: ${rec.valueType}` : ""}`;
  change("file.import", `${k.title}: ${p.name} (sha256 ${p.sha.slice(0, 12)}…; ${desc}; parser ${C.PARSER_VERSION})${old ? `; replaced ${old.name} (sha256 ${old.sha256.slice(0, 12)}…)` : ""}`,
    () => { e[k.slot] = rec; if (clearMap) e.map = {}; });
}
function removeFile(kind) {
  const k = KIND[kind], f = st.exp[k.slot];
  if (!confirm(`Remove ${f.name} from this experiment? The related checks will be reported as not assessed.`)) return;
  change("file.remove", `${k.title}: removed ${f.name} (sha256 ${f.sha256.slice(0, 12)}…)`, () => (st.exp[k.slot] = null));
}
function dropzone(kind, label) {
  const z = h("div", { class: "drop", ondragover: ev => { ev.preventDefault(); z.classList.add("over"); }, ondragleave: () => z.classList.remove("over"),
    ondrop: ev => { ev.preventDefault(); z.classList.remove("over"); stage(kind, ev.dataTransfer.files[0]); } },
    h("strong", null, "Drop a file here, or"),
    h("label", { class: "btn primary" }, label, h("input", { type: "file", accept: ".csv,.txt,.tsv,text/csv,text/plain,text/tab-separated-values", onchange: ev => stage(kind, ev.target.files[0]) })));
  return z;
}
const kv = pairs => h("dl", { class: "kv" }, pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v === "" || v == null ? "—" : v)]));
function preview(kind, p) {
  const cancel = h("button", { class: "btn", type: "button", onclick: () => { delete st.pending[kind]; renderMain(); } }, p.error ? "Dismiss" : "Cancel");
  if (p.error) return h("div", { class: "preview bad" },
    h("b", null, `Could not import ${p.name}. No checks were run.`), h("p", null, p.error),
    p.details.headers?.length > 0 && h("p", { class: "muted" }, "Columns found: " + p.details.headers.join(", ")),
    p.details.recognized && Object.keys(p.details.recognized).length > 0 && h("p", { class: "muted" }, "Recognised: " + Object.entries(p.details.recognized).map(([k, v]) => `${C.FIELD_LABEL[k]} ← “${v}”`).join(", ")),
    p.details.needsPlateSize && h("div", { class: "row" }, h("b", null, "Plate layout:"),
      [96, 384].filter(n => n >= p.details.maxWell).map(n => h("button", { class: "btn primary", type: "button", onclick: () => stageText(kind, p.name, p.text, n) }, `${n}-well (row by row)`)),
      h("small", { class: "muted" }, "Pick the plate your instrument used. The preview will show the resulting positions so you can check them.")),
    kind === "results" && !p.details.needsPlateSize && h("p", null, "AssayLint needs a well column (for example “Well” or “Well Position”) and a Ct/Cq column. If your export differs, copy the data into the import template."),
    h("div", { class: "row" }, kind === "results" && h("button", { class: "btn primary", type: "button", onclick: () => download("assaylint-import-template.csv", C.IMPORT_TEMPLATE, "text/csv") }, "Download import template"), cancel));
  const r = p.parsed, confirmBtn = h("button", { class: "btn primary", type: "button", onclick: () => confirmImport(kind) }, "Confirm import");
  if (kind !== "results") {
    const used = new Set((st.res?.rows || []).map(x => x.key).filter(Boolean));
    const covered = [...used].filter(k => r.wells.includes(k)).length;
    return h("div", { class: "preview" }, h("b", null, `Preview of ${p.name}`),
      kv([["Layout", r.layout === "long" ? "One row per well and " + (kind === "amp" ? "cycle" : "temperature") : "One column per well"],
        ["X column", r.xName], ["Value column", r.layout === "long" ? r.yName : "(well columns)"], ["Curves", String(Object.keys(r.series).length)], ["Data points", String(r.points)],
        ["Wells", r.wells.slice(0, 40).join(", ") + (r.wells.length > 40 ? ` … (${r.wells.length})` : "")],
        used.size ? ["Coverage of results wells", `${covered} of ${used.size}`] : null,
        r.malformed ? ["Values not parsed", `${r.malformed} (empty or non-numeric; excluded)`] : null]),
      kind === "melt" && field("These values are", h("select", { onchange: ev => (p.valueType = ev.target.value) },
        h("option", { value: "derivative", selected: p.valueType === "derivative" }, "Derivative (−dF/dT)"),
        h("option", { value: "fluorescence", selected: p.valueType === "fluorescence" }, "Raw fluorescence (AssayLint computes −dF/dT)")),
        `Detected: ${r.guessedValueType}. Please confirm; AssayLint cannot always tell from the numbers.`),
      h("div", { class: "row" }, confirmBtn, cancel));
  }
  const keys = r.rows.map(x => x.key).filter(Boolean);
  const roles = C.groupBy(r.rows.filter(x => x.role), x => x.role);
  const inferredNtc = r.rows.filter(x => !x.role && x.sample && /^(ntc|no[\s_-]?template([\s_-]?control)?|water|h2o|blank)$/i.test(x.sample)).length;
  return h("div", { class: "preview" }, h("b", null, `Preview of ${p.name}. Check it before importing.`),
    kv([["Detected format", r.formatLabel], ["Columns used", Object.entries(r.columns).map(([k, v]) => `${C.FIELD_LABEL[k]} ← “${v}”`).join(", ")],
      ["Columns not used", r.unrecognized.join(", ")], ["Rows parsed", String(r.rows.length)],
      ["Distinct wells", `${new Set(keys).size}` + (r.rows.length - keys.length ? `; ${r.rows.length - keys.length} row(s) with an invalid position` : "")],
      ["Targets", [...new Set(r.rows.map(x => x.target).filter(Boolean))].join(", ")],
      ["Samples", String(new Set(r.rows.map(x => x.sample).filter(Boolean)).size)],
      ["Roles from file", [...roles].map(([k, v]) => `${C.ROLE_LABEL[k]}: ${v.length}`).join("; ") || "none (no role column)"],
      inferredNtc ? ["Roles inferred", `${inferredNtc} well(s) will be treated as NTC because of their sample name. You can change this in the plate map.`] : null,
      r.plateSize ? ["Plate layout", `${r.plateSize}-well, positions derived from well numbers`] : null,
      ["Table starts at", `line ${r.headerLine}`],
      Object.keys(r.metadata).length ? ["File header", Object.entries(r.metadata).slice(0, 8).map(([k, v]) => `${k} = ${v}`).join("; ")] : null]),
    r.warnings.map(w => h("div", { class: "warn" }, w)),
    r.malformed.length > 0 && h("div", { class: "warn" }, "Rows not parsed: " + r.malformed.slice(0, 10).map(m => `line ${m.line} (${m.reason})`).join("; ")),
    h("div", { class: "tablewrap", style: "max-height:220px" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, ["Line", "Well", "Sample", "Target", "Role (file)", "Ct/Cq (raw)"].map(x => h("th", null, x)))),
      h("tbody", null, r.rows.slice(0, 12).map(x => h("tr", null, h("td", null, x.line), h("td", null, x.key && x.key !== x.well ? `${x.well} → ${x.key}` : x.well), h("td", null, x.sample ?? ""), h("td", null, x.target ?? ""), h("td", null, x.roleRaw ?? ""), h("td", { class: "mono" }, x.ct ?? "(empty)")))))),
    h("p", { class: "fine" }, "Nothing is checked until you confirm. Your original file is kept exactly as it is."),
    h("div", { class: "row" }, confirmBtn, cancel));
}
VIEWS.data = () => {
  const cards = Object.entries(KIND).map(([kind, k]) => {
    const cur = st.exp[k.slot], p = st.pending[kind];
    return card(h("h2", null, k.title), h("p", { class: "muted", style: "margin-top:-.4rem" }, k.sub),
      cur && h("div", { class: "filemeta" }, h("b", null, cur.name), h("small", { class: "mono" }, `sha256 ${cur.sha256}`),
        kv([["Imported", `${when(cur.importedAt)} by ${cur.importedBy}`], ["Parser", `version ${cur.parserVersion}`], cur.format && ["Format", C.FORMATS[cur.format]],
          cur.plateSize && ["Plate layout", `${cur.plateSize}-well`], cur.valueType && ["Melt values", cur.valueType]]),
        h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: () => download(cur.name, cur.text, "text/plain") }, "Download original"),
          kind !== "results" && h("button", { class: "btn", type: "button", onclick: () => removeFile(kind) }, "Remove"))),
      p ? preview(kind, p) : (kind === "results" || st.exp.source) ? dropzone(kind, cur ? "Choose a replacement" : "Choose file") : h("p", { class: "fine" }, "Add the results file first."));
  });
  return [...cards, card(h("h2", null, "Supported layouts"),
    h("ul", null, Object.values(C.FORMATS).map(f => h("li", null, f)),
      h("li", null, "Curves: long layout (well, optional target, cycle or temperature, value) or wide layout (a cycle or temperature column plus one column per well).")),
    h("p", { class: "fine" }, "I've tested it on real exports from QuantStudio, Bio-Rad CFX and ABI 7500/7900HT machines, plus LightCycler 480 and European-format files. Other machines may lay things out differently, so look at the preview before you confirm. Excel and raw run files (.eds, .pcrd) won't open; export CSV or text instead. If your file doesn't work, email it to me and I'll add support."),
    h("button", { class: "btn", type: "button", onclick: () => download("assaylint-import-template.csv", C.IMPORT_TEMPLATE, "text/csv") }, "Download import template"))];
};

// ---------------------------------------------------------------- 3 · Plate map (FR-4, FR-5)
function plateDims(rows) {
  const big = st.res?.parsed?.plateSize === 384 || /384/.test(st.res?.parsed?.metadata?.["Block Type"] || "") ||
    rows.some(r => r.key && (r.key.charCodeAt(0) > 72 || Number(r.key.slice(1)) > 12));
  return big ? { rows: 16, cols: 24 } : { rows: 8, cols: 12 };
}
function plateGrid({ rows, cols, cls, label = () => "", title = () => "", style = () => "", onCell, onRow, onCol }) {
  const g = h("div", { class: "pgrid", style: `grid-template-columns:1.3em repeat(${cols},minmax(0,1fr))`, "aria-label": "Plate layout" });
  g.append(h("span"));
  for (let c = 1; c <= cols; c++) g.append(h("button", { type: "button", class: "ph", title: `Select column ${c}`, onclick: () => onCol?.(c) }, c));
  for (let r = 0; r < rows; r++) {
    const L = String.fromCharCode(65 + r);
    g.append(h("button", { type: "button", class: "ph", title: `Select row ${L}`, onclick: () => onRow?.(L) }, L));
    for (let c = 1; c <= cols; c++) { const k = L + c; g.append(h("button", { type: "button", class: "pc " + cls(k), style: style(k) || null, title: title(k), "aria-label": title(k) || k, "aria-pressed": st.sel.has(k) ? "true" : null, onclick: () => onCell(k) }, label(k))); }
  }
  return g;
}
const GROUP_TONES = ["#6C8796", "#8DA68A", "#B79A62", "#9C8AA5", "#6F9C98", "#A3877C"];
const MAP_FIELDS = [["sample", "Sample"], ["target", "Target"], ["group", "Group / condition"], ["role", "Role"], ["bio_unit", "Biological unit"], ["quantity", "Quantity (standards)"]];
const currentRow = id => st.res.rows.find(r => r.id === id);
function setCell(id, f, val) {
  const r = currentRow(id), old = r[f] ?? "";
  if (old === val) return;
  change("map.edit", `${r.key || r.well} (line ${r.line}) ${f}: "${old}" → "${val}"`, () => { st.exp.map[id] = { ...st.exp.map[id], [f]: val }; }, { rerender: false });
  mapRefresh?.();
}
function toggle(keys) {
  const all = keys.every(k => st.sel.has(k));
  for (const k of keys) all ? st.sel.delete(k) : st.sel.add(k);
  renderMain();
}
VIEWS.map = () => {
  const res = st.res;
  if (!res?.rows.length) return [emptyCard("Import a results file first.", "data")];
  const present = [...new Set(res.rows.map(r => r.key).filter(Boolean))];
  const gridHost = h("div"), count = h("span", { class: "muted" });
  const legendHost = h("div", { class: "legend map-legend" });
  mapRefresh = () => {
    const all = st.res.rows, rows = C.groupBy(all.filter(r => r.key), r => r.key);
    // Samples take a muted tone per experimental group; standards get darker with more template.
    const groups = [...new Set(all.filter(r => r.role === "sample").map(r => r.group || ""))].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
    const named = groups.filter(Boolean), tone = g => (g ? GROUP_TONES[named.indexOf(g) % GROUP_TONES.length] : "#AEB8B3");
    const logq = r => { const q = C.toNum(r.quantity, r.dc); return q > 0 ? Math.log10(q) : null; };
    const qs = all.filter(r => r.role === "standard").map(logq).filter(x => x !== null), qmin = Math.min(...qs), qmax = Math.max(...qs);
    const roleOf = k => { const rs = rows.get(k); if (!rs) return null; const set = new Set(rs.map(r => r.role)); return set.size > 1 ? "mixed" : [...set][0]; };
    const wellStyle = k => {
      const role = roleOf(k), r = rows.get(k)?.[0];
      if (role === "sample") return `--fill:${tone(r.group)}`;
      if (role === "standard") { const v = logq(r), t = v === null || qmax === qmin ? 0.5 : (v - qmin) / (qmax - qmin); return `--fill:color-mix(in srgb, var(--accent) ${Math.round(22 + t * 78)}%, #fff)`; }
      return "";
    };
    gridHost.replaceChildren(h("div", { class: "plate-body" + (plateDims(all).cols === 24 ? " p384" : "") }, plateGrid({ ...plateDims(all),
      cls: k => (roleOf(k) ? (roleOf(k) === "mixed" ? "mixed" : "r-" + roleOf(k)) : "none") + (st.sel.has(k) ? " sel" : ""),
      style: wellStyle,
      title: k => rows.get(k)?.map(r => `${k}: ${r.sample ?? "—"} / ${r.target ?? "—"} (${C.ROLE_LABEL[r.role]})`).join("\n") ?? "",
      onCell: k => rows.has(k) && toggle([k]), onRow: L => toggle(present.filter(k => k[0] === L)), onCol: c => toggle(present.filter(k => k.slice(1) === String(c))) })));
    const roles = new Set([...rows.keys()].map(roleOf));
    const item = (swatch, text) => h("span", null, swatch, text);
    legendHost.replaceChildren(
      ...groups.map(g => item(h("span", { class: "sw", style: `background:${tone(g)}` }), g ? g : "Sample, no group")),
      roles.has("standard") && item(h("span", { class: "sw sw-std" }), "Standard, darker = more template"),
      ...[["positive", "Positive control"], ["ntc", "No-template control"], ["nrt", "No-RT control"], ["empty", "Not used"], ["mixed", "Mixed roles"]]
        .filter(([k]) => roles.has(k)).map(([k, l]) => item(h("span", { class: "sw pc " + (k === "mixed" ? "mixed" : "r-" + k) }), l)),
      item(h("span", { class: "sw pc none" }), "No data"));
    count.textContent = `${st.sel.size} well${st.sel.size === 1 ? "" : "s"} selected`;
  };
  mapRefresh();
  const valueInput = st.bulkField === "role"
    ? h("select", { id: "bulkval", "aria-label": "Value" }, C.ROLES.map(r => h("option", { value: r }, C.ROLE_LABEL[r])))
    : h("input", { type: "text", id: "bulkval", placeholder: "Value (leave empty to clear)", "aria-label": "Value" });
  const applyBulk = () => {
    const val = $("#bulkval").value.trim(), f = st.bulkField, hits = res.rows.filter(r => st.sel.has(r.key));
    change("map.bulk", `${f} = "${val}" for ${hits.length} row(s): ${[...st.sel].join(", ")}`, () => { for (const r of hits) st.exp.map[r.id] = { ...st.exp.map[r.id], [f]: val }; });
  };
  const resetSel = () => {
    const hits = res.rows.filter(r => st.sel.has(r.key) && st.exp.map[r.id]);
    if (!hits.length) return;
    change("map.reset", `Reverted plate-map edits to file values for ${[...new Set(hits.map(r => r.key))].join(", ")}`, () => { for (const r of hits) delete st.exp.map[r.id]; });
  };
  const importTpl = async file => {
    if (!file) return;
    const text = await file.text();
    try {
      const tpl = C.parseTemplate(text), sha = await C.sha256(text);
      let out;
      change("map.template", `Applied template ${file.name} (sha256 ${sha.slice(0, 12)}…)`, () => {
        out = C.applyTemplate(st.exp, res.rows, tpl, { name: file.name, sha256: sha, importedAt: new Date().toISOString(), importedBy: actor() });
        C.logAudit(st.exp, actor(), "map.template.changes", out.changes.join("; ") || "no changes");
      }, { rerender: false });
      flash(`Template ${file.name}: ${out.changes.length} change(s) from ${tpl.entries.length} template row(s).` + (out.issues.length ? ` Not applied: ${out.issues.join("; ")}.` : ""), out.issues.length > 0);
    } catch (e) { flash(`Template ${file.name} was not applied: ${e.message}`, true); }
    renderMain();
  };
  const src = (r, f) => {
    if (f === "role") return r.roleSource === "file" ? "" : r.roleSource === "user" ? `file: ${r.file.role ?? "(none)"}` : r.roleSource;
    if (st.exp.map[r.id] && f in st.exp.map[r.id]) return `file: ${r.file[f] ?? "(empty)"}`;
    if (f === "bio_unit" && r.bioSource?.startsWith("default")) return "from sample name";
    return "";
  };
  const cell = (r, f) => h("td", null, f === "role"
    ? h("select", { onchange: ev => setCell(r.id, f, ev.target.value), "aria-label": `Role for ${r.key || r.well}` }, C.ROLES.map(x => h("option", { value: x, selected: x === r.role }, C.ROLE_LABEL[x])))
    : h("input", { type: "text", value: r[f] ?? "", "aria-label": `${f} for ${r.key || r.well}`, onchange: ev => setCell(r.id, f, ev.target.value.trim()) }), src(r, f) && h("small", null, src(r, f)));
  const shown = st.mapFilter === "selected" ? res.rows.filter(r => st.sel.has(r.key)) : res.rows;
  return [card(h("div", { class: "head" }, h("div", null, h("h2", null, "Plate map"),
      h("p", { class: "muted", style: "margin:0;max-width:640px" }, "Click wells, or a row letter or column number, to select them. Changing a label here doesn't touch your data; the original value is shown under anything you edit.")),
      h("div", { class: "row" },
        h("label", { class: "btn" }, "Import plate-map template", h("input", { type: "file", accept: ".csv,.txt,.tsv", onchange: ev => importTpl(ev.target.files[0]) })),
        h("button", { class: "btn", type: "button", onclick: () => download(`${st.exp.id}.platemap.csv`, C.mapTemplateCsv(st.res.rows), "text/csv") }, "Download plate map"))),
    gridHost,
    legendHost,
    st.exp.template && h("p", { class: "fine" }, `Template applied: ${st.exp.template.name} (${st.exp.template.wells.length} wells, ${when(st.exp.template.importedAt)}).`),
    h("div", { class: "bulk" }, count,
      h("select", { onchange: ev => { st.bulkField = ev.target.value; renderMain(); }, "aria-label": "Field to set" }, MAP_FIELDS.map(([k, l]) => h("option", { value: k, selected: k === st.bulkField }, l))),
      valueInput, h("button", { class: "btn primary", type: "button", disabled: !st.sel.size, onclick: applyBulk }, "Apply to selected"),
      h("button", { class: "btn", type: "button", disabled: !st.sel.size, onclick: resetSel }, "Revert selected to file values"),
      h("button", { class: "btn", type: "button", onclick: () => { st.sel = new Set(present); renderMain(); } }, "Select all"),
      h("button", { class: "btn", type: "button", onclick: () => { st.sel.clear(); renderMain(); } }, "Clear selection")),
    h("p", { class: "fine" }, "Wells with the same biological unit and target count as technical replicates. A biological unit is one independent sample (one mouse, one culture). Leave it blank and the sample name is used instead.")),
  card(h("div", { class: "head" }, h("h2", null, `Wells (${shown.length} rows)`),
      h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.mapFilter === "selected", onchange: ev => { st.mapFilter = ev.target.checked ? "selected" : "all"; renderMain(); } }), "Show selected wells only")),
    h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, ["Line", "Well", "Sample", "Target", "Group", "Role", "Biological unit", "Quantity", "Ct/Cq (raw)"].map(x => h("th", null, x)))),
      h("tbody", null, shown.map(r => h("tr", { class: st.sel.has(r.key) ? "sel" : "" }, h("td", null, r.line), h("td", null, r.key || r.well),
        cell(r, "sample"), cell(r, "target"), cell(r, "group"), cell(r, "role"), cell(r, "bio_unit"), cell(r, "quantity"),
        h("td", { class: "mono" }, r.ct ?? "(empty)")))))))];
};

// ---------------------------------------------------------------- 4 · Context & rules (FR-6, FR-9, FR-16)
function setContext(f, val) {
  const old = st.exp.context[f.key] ?? "";
  if (old === val) return;
  change("context.edit", `${f.label}: "${old}" → "${val}"`, () => (st.exp.context[f.key] = val), { rerender: false });
}
function setRule(f, raw) {
  const v = f.type === "bool" ? raw : Number(raw);
  if (f.type === "number" && (raw === "" || !Number.isFinite(v) || v < 0)) { flash(`${f.label}: “${raw}” is not a valid non-negative number; the value was not changed.`, true); renderMain(); return; }
  const old = st.exp.ruleset.values[f.key];
  if (old === v) return;
  change("ruleset.edit", `${f.label}: ${old} → ${v}`, () => (st.exp.ruleset.values[f.key] = v));
}
function applyProfile(id) {
  let p = C.DEFAULT_PROFILE;
  if (id !== C.DEFAULT_PROFILE.id) { const x = S.profiles().find(q => q.id === id), last = x.versions.at(-1); p = { id: x.id, name: x.name, version: last.version, values: last.values }; }
  change("ruleset.apply", `Applied rule profile ${p.name} (${p.id}@v${p.version}); replaced ${C.rulesetId(st.exp.ruleset)}`, () => (st.exp.ruleset = C.rulesetFrom(p)));
}
function saveProfile(asNew) {
  const list = S.profiles(), rs = st.exp.ruleset;
  let p = list.find(x => x.id === rs.profile.id);
  if (asNew || !p) {
    const name = prompt("Name for the new rule profile (for example “Smith lab SYBR default”):");
    if (!name?.trim()) return;
    p = { id: "lab-" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36), name: name.trim(), versions: [] };
    list.push(p);
  }
  const version = p.versions.length + 1;
  p.versions.push({ version, created: new Date().toISOString(), createdBy: actor(), values: { ...rs.values } });
  try { S.saveProfiles(list); } catch { flash("Could not save the profile: browser storage is full or disabled.", true); renderMain(); return; }
  change("ruleset.profile.save", `Saved rule profile ${p.name} as ${p.id}@v${version}`, () => (st.exp.ruleset = C.rulesetFrom({ id: p.id, name: p.name, version, values: rs.values })));
}
function setNA(role, target, reason) {
  const key = `${role}|${target}`;
  if (reason == null) change("control.na.clear", `Cleared “not applicable” for ${C.ROLE_LABEL[role]} / ${target}`, () => delete st.exp.controlNA[key]);
  else if (reason.trim()) change("control.na", `${C.ROLE_LABEL[role]} / ${target} marked not applicable: ${reason.trim()}`, () => (st.exp.controlNA[key] = { reason: reason.trim(), by: actor(), at: new Date().toISOString() }));
  else { flash("Enter a reason before marking a control not applicable.", true); renderMain(); }
}
VIEWS.context = () => {
  const e = st.exp, rs = e.ruleset, fileInst = Object.entries(st.res?.parsed?.metadata || {}).find(([k]) => /instrument/i.test(k));
  const profiles = S.profiles(), changes = C.rulesetChanges(rs);
  const controls = (st.res?.controls || []).filter(c => c.expected || c.wells.length);
  return [
    card(h("h2", null, "Run and method context"),
      h("p", { class: "muted", style: "margin-top:-.3rem" }, "Fill in what you have. Anything blank shows up as \u201cnot provided\u201d, not as a problem with your assay."),
      h("div", { class: "form2" }, C.CONTEXT_FIELDS.map(f => field(h("span", null, f.label, f.severity === "medium" ? h("span", { class: "req" }, "Recommended") : (f.severity === "info" || !f.severity) ? h("span", { class: "opt" }, "Optional") : null),
        textInput(e.context[f.key], v => setContext(f, v), { multiline: f.multiline, placeholder: f.key === "instrument" && fileInst ? `From file: ${fileInst[1]}` : "" }),
        f.key === "efficiency_evidence" ? "Satisfied automatically when this run has a standard curve." : f.key === "instrument" && fileInst ? "The file header names the instrument, so this is optional." : null)))),
    card(h("div", { class: "head" }, h("div", null, h("h2", null, "Rule set"),
        h("p", { class: "muted", style: "margin:0" }, rs.profile.name, h("br"), h("span", { class: "mono" }, C.rulesetId(rs))),
        changes.length > 0 && h("p", { class: "warn", style: "margin:.4rem 0 0" }, "Changed in this experiment: " + changes.map(c => `${c.label} ${c.from} → ${c.to}`).join("; "))),
      h("div", { class: "row" },
        h("select", { id: "profile-pick", "aria-label": "Rule profile" }, h("option", { value: C.DEFAULT_PROFILE.id }, C.DEFAULT_PROFILE.name + " v1"),
          profiles.map(p => h("option", { value: p.id, selected: p.id === rs.profile.id }, `${p.name} v${p.versions.at(-1).version}`))),
        h("button", { class: "btn", type: "button", onclick: () => applyProfile($("#profile-pick").value) }, "Apply profile"),
        h("button", { class: "btn", type: "button", onclick: () => saveProfile(true) }, "Save as new profile…"),
        profiles.some(p => p.id === rs.profile.id) && h("button", { class: "btn", type: "button", onclick: () => saveProfile(false) }, "Save as next version"))),
      h("div", { class: "form2" }, C.RULESET_FIELDS.map(f => f.type === "bool"
        ? h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!rs.values[f.key], onchange: ev => setRule(f, ev.target.checked) }), f.label)
        : field(f.label, h("input", { type: "number", step: f.step, min: 0, value: rs.values[f.key], onchange: ev => setRule(f, ev.target.value) })))),
      h("p", { class: "fine" }, "The defaults are common rules of thumb, not reviewed standards, so change them to match your lab. Saving a profile makes a new version; old experiments keep the values they were checked with.")),
    card(h("h2", null, "Expected controls by target"),
      controls.length ? h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, ["Target", "Control", "Expected", "Wells", "Status", "Not applicable"].map(x => h("th", null, x)))),
        h("tbody", null, controls.map(c => {
          const reason = h("input", { type: "text", placeholder: "Reason", value: c.na || "", "aria-label": "Reason" });
          return h("tr", null, h("td", null, c.target), h("td", null, c.label), h("td", null, c.expected ? "yes" : "no"), h("td", null, c.wells.join(", ") || "—"),
            h("td", null, c.wells.length ? (c.amplified.length ? "amplified: " + c.amplified.join(", ") : "no amplification") : c.na ? "not applicable" : c.expected ? "missing" : "—"),
            h("td", null, !c.wells.length && c.expected ? h("div", { class: "row" }, reason,
              h("button", { class: "btn", type: "button", onclick: () => setNA(c.role, c.target, reason.value) }, c.na ? "Update" : "Mark N/A"),
              c.na && h("button", { class: "btn", type: "button", onclick: () => setNA(c.role, c.target, null) }, "Clear")) : ""));
        })))) : h("p", { class: "muted" }, "Import results to see controls per target."),
      h("p", { class: "fine" }, "Set which controls you expect in the rule set above, and mark control wells on the Plate map tab."))];
};

// ---------------------------------------------------------------- 5 · Findings (FR-10..FR-18)
const SORTS = { severity: "Severity", well: "Well", sample: "Sample", target: "Target", category: "Category", rule: "Rule" };
const SEV = { high: 0, medium: 1, low: 2, info: 3 };
function sorted(list) {
  const by = st.sort, s = (a, b) => String(a ?? "~").localeCompare(String(b ?? "~")), sv = (a, b) => SEV[a.severity] - SEV[b.severity];
  const cmp = { well: (a, b) => C.wellOrder(a.wells[0]) - C.wellOrder(b.wells[0]) || sv(a, b), sample: (a, b) => s(a.sample, b.sample) || sv(a, b),
    target: (a, b) => s(a.target, b.target) || sv(a, b), category: (a, b) => s(a.category, b.category) || sv(a, b), rule: (a, b) => s(a.rule, b.rule), severity: sv };
  return [...list].sort(cmp[by]);
}
function setReview(f, patch) {
  const old = st.exp.reviews[f.id] || {}, next = { ...old, ...patch, by: actor(), at: new Date().toISOString(),
    rule: f.rule, rule_version: f.rule_version, title: f.title, description: f.description };
  const what = "disposition" in patch ? `disposition ${C.DISPOSITION_LABEL[old.disposition || "unreviewed"]} → ${C.DISPOSITION_LABEL[patch.disposition]}` : `note: "${old.note || ""}" → "${patch.note}"`;
  change("review", `${f.id}: ${what}`, () => (st.exp.reviews[f.id] = next), { rerender: "disposition" in patch });
}
function selectFinding(f) {
  st.selFinding = st.selFinding === f.id ? null : f.id;
  st.sel = new Set(st.selFinding ? f.wells.map(C.wellKey).filter(Boolean) : []);
  renderMain();
}
function plateFlags() {
  const RANK = { high: 3, medium: 2, low: 1 }, flags = new Map();
  for (const f of st.res.findings) {
    if (f.severity === "info" || C.CLOSED.has(st.exp.reviews[f.id]?.disposition)) continue;
    for (const w of f.wells) { const k = C.wellKey(w); if (k && RANK[f.severity] > (RANK[flags.get(k)] || 0)) flags.set(k, f.severity); }
  }
  return flags;
}
async function mountPlate() {
  const data = { ...plateDims(st.res.rows), flags: plateFlags(), present: new Set(st.res.rows.map(r => r.key).filter(Boolean)) };
  const pick = k => { st.selFinding = null; st.sel = new Set([k]); renderMain(); };
  if (!webglFailed) {
    try {
      if (!plate3d) { const { createPlate } = await import("./plate3d.js"); plate3d = createPlate(plateHost, pick); }
      plate3d.setData(data); plate3d.select([...st.sel]); return;
    } catch (e) { console.warn("3D plate unavailable; using the 2D plate.", e); webglFailed = true; plate3d = null; }
  }
  plateHost.replaceChildren(plateGrid({ ...data, cls: k => (!data.present.has(k) ? "none" : data.flags.get(k) || "ok") + (st.sel.has(k) ? " sel" : ""),
    title: k => k, onCell: k => data.present.has(k) && pick(k) }));
}
const cap = s => s[0].toUpperCase() + s.slice(1);
const sevTag = sev => h("span", { class: "sev " + sev }, cap(sev));
function findingRow(f) {
  const rv = st.exp.reviews[f.id] || {}, closed = C.CLOSED.has(rv.disposition), sel = st.selFinding === f.id;
  const where = f.wells.length ? f.wells.slice(0, 6).join(", ") + (f.wells.length > 6 ? ` and ${f.wells.length - 6} more` : "") : f.target ? `Target ${f.target}` : "Whole run";
  return h("button", { type: "button", class: `frow${sel ? " sel" : ""}${closed ? " closed" : ""}`, "aria-pressed": String(sel), onclick: () => selectFinding(f) },
    sevTag(f.severity),
    h("span", { class: "frow-body" }, h("span", { class: "frow-title" }, f.title), h("span", { class: "frow-sub" }, where)),
    rv.disposition && rv.disposition !== "unreviewed" && h("span", { class: "frow-disp" }, C.DISPOSITION_LABEL[rv.disposition]));
}
function findingDetail(f) {
  const rv = st.exp.reviews[f.id] || {};
  return h("article", { class: "fdetail", "aria-label": "Selected finding" },
    h("div", { class: "fd-head" }, sevTag(f.severity), h("h2", null, f.title)),
    h("p", { class: "fd-desc" }, f.description),
    h("pre", { class: "fd-evidence", "aria-label": "Values from the file" }, f.evidence),
    h("p", null, f.why),
    h("p", null, h("strong", null, "Check next. "), f.next_check),
    h("p", { class: "fd-rule" }, `How this was checked: ${C.RULES[f.rule].checks} Rule ${f.rule}, version ${f.rule_version}.`),
    h("div", { class: "review" },
      field("Review decision", h("select", { onchange: ev => setReview(f, { disposition: ev.target.value }) },
        C.DISPOSITIONS.map(d => h("option", { value: d, selected: d === (rv.disposition || "unreviewed") }, C.DISPOSITION_LABEL[d])))),
      field("Note or action taken", h("input", { type: "text", value: rv.note || "", placeholder: "Optional", onchange: ev => setReview(f, { note: ev.target.value }) })),
      rv.at && h("p", { class: "fine" }, `Last changed by ${rv.by} on ${when(rv.at)}. Your decision is saved alongside the flag; the flag itself stays in the report.`)));
}
function curvesBlock() {
  const res = st.res, keys = [...st.sel];
  if (!res.amp && !res.melt && !st.exp.melt) return null;
  const chart = (data, label) => { const cv = h("canvas", { class: "chart", role: "img", "aria-label": label }); after.push(() => plot(cv, data)); return cv; };
  const seriesFor = (entries, toPts) => {
    const bg = [], hi = [];
    for (const [k, v] of entries) (keys.includes(k.split("|")[0]) ? hi : bg).push({ pts: toPts(v, k) });
    return [...bg.map(s => ({ ...s, color: "#B4BDB8", alpha: 0.6, width: 1 })), ...hi.map(s => ({ ...s, color: "#0B6B5C", width: 2.25 }))];
  };
  const parts = [h("h3", null, "Curves"), h("p", { class: "fine" }, keys.length ? `Highlighted: ${keys.join(", ")}.` : "Pick a flag or a well to highlight its curves.")];
  if (res.amp) parts.push(h("figure", null, chart({ series: seriesFor(Object.entries(res.amp.series), (pts, k) => pts.map(([x, y]) => [x, y - res.amp.stats[k].mean])),
    hline: res.amp.threshold || null, xLabel: "Cycle", yLabel: "ΔF", empty: "No curves" }, "Amplification curves"),
    h("figcaption", null, `Amplification, baseline-subtracted. Dashed line: AssayLint's common threshold (${fmt(res.amp.threshold, 3)}), used only to compare wells.`)));
  if (res.melt) parts.push(h("figure", null, chart({ series: seriesFor(Object.entries(res.melt.stats), s => s.curve), xLabel: "Temperature (°C)", yLabel: "−dF/dT", empty: "No curves" }, "Melt curves"),
    h("figcaption", null, "Melt curves, first derivative.")));
  else if (st.exp.melt) parts.push(h("p", { class: "fine" }, "Melt data is imported, but melt checks are off for this assay. Turn them on under Context & rules."));
  return h("div", { class: "block" }, ...parts);
}
VIEWS.findings = () => {
  const res = st.res;
  if (!res || !st.exp.source) return [emptyCard("Import a results file to run the checks.", "data")];
  const sum = res.summary, sev = sum.bySeverity;
  plateHost ||= h("div", { class: "plate3d" });
  after.push(mountPlate);
  const q = st.filter.toLowerCase();
  const list = sorted(res.findings).filter(f => (!st.hideClosed || !C.CLOSED.has(st.exp.reviews[f.id]?.disposition)) &&
    (!st.category || f.category === st.category) &&
    (!q || [f.rule, f.title, f.description, f.evidence, f.wells.join(" "), f.target, f.sample].join(" ").toLowerCase().includes(q)));
  const sel = st.selFinding && res.findings.find(f => f.id === st.selFinding);
  const selRows = res.rows.filter(r => st.sel.has(r.key));
  const fb = st.exp.feedback?.value;
  return [
    h("section", { class: "sec summary" },
      h("p", { class: "tally" }, (() => {
        const parts = [["high", "high"], ["medium", "medium"], ["low", "low"], ["info", "informational"]].filter(([k]) => sev[k]).map(([k, l]) => `${sev[k]} ${l}`);
        const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + " and " + parts.at(-1) : parts[0];
        return parts.length ? `${list} finding${res.findings.length === 1 ? "" : "s"}. You've reviewed ${sum.reviewed} of ${sum.total}.` : "Nothing was flagged.";
      })()),
      h("details", { class: "scope" }, h("summary", null, `What was checked: ${res.checksRun.length} groups of checks, ${res.notAssessed.length} item${res.notAssessed.length === 1 ? "" : "s"} not assessed`),
        h("div", { class: "scope-cols" },
          h("div", null, h("h3", null, "Checked"), h("ul", null, res.checksRun.map(c => h("li", null, c)))),
          h("div", null, h("h3", null, "Not assessed"), h("ul", null, res.notAssessed.length ? res.notAssessed.map(c => h("li", null, c)) : h("li", null, "Nothing. Every configured check had the data it needs."))))),
      h("p", { class: "fine" }, "This isn't a score. It just tells you whether anything still needs a look.")),
    h("section", { class: "sec split" },
      h("div", { class: "flist-col" },
        h("div", { class: "ftools" },
          h("input", { type: "search", placeholder: "Search findings", value: st.filter, "aria-label": "Search findings", onchange: ev => { st.filter = ev.target.value; renderMain(); } }),
          h("select", { "aria-label": "Category", onchange: ev => { st.category = ev.target.value; renderMain(); } }, h("option", { value: "" }, "All categories"),
            Object.entries(C.CATEGORY_LABEL).map(([k, l]) => h("option", { value: k, selected: st.category === k }, `${l} (${sum.byCategory[k] || 0})`))),
          h("select", { "aria-label": "Sort", onchange: ev => { st.sort = ev.target.value; renderMain(); } }, Object.entries(SORTS).map(([k, l]) => h("option", { value: k, selected: k === st.sort }, "Sort by " + l.toLowerCase()))),
          h("label", { class: "check" }, h("input", { type: "checkbox", checked: st.hideClosed, onchange: ev => { st.hideClosed = ev.target.checked; renderMain(); } }), "Hide closed")),
        h("p", { class: "fine count" }, `${list.length} of ${res.findings.length} findings`),
        h("div", { class: "flist", role: "list" }, list.length ? list.map(findingRow) : h("p", { class: "muted" }, res.findings.length ? "No findings match these filters." : "Nothing was flagged. That's a good sign, not a guarantee."))),
      h("div", { class: "detail-col" },
        sel ? findingDetail(sel) : h("p", { class: "muted pick" }, "Pick a flag on the left to see what was checked and why, or click a well on the plate."),
        h("div", { class: "block" }, h("h3", null, "Plate"), plateHost,
          h("div", { class: "legend" }, [["high", "High"], ["medium", "Medium"], ["low", "Low"], ["ok", "No open finding"]].map(([k, l]) => h("span", null, h("span", { class: "sw", style: `background:var(--w-${k})` }), l))),
          h("p", { class: "fine" }, "Each well shows its worst open flag. Drag to rotate, scroll to zoom."),
          selRows.length > 0 && h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
            h("thead", null, h("tr", null, ["Well", "Sample", "Target", "Role", "Ct/Cq as exported", "Line"].map(x => h("th", null, x)))),
            h("tbody", null, selRows.map(r => h("tr", null, h("td", null, r.key), h("td", null, r.sample ?? "—"), h("td", null, r.target ?? "—"), h("td", null, C.ROLE_LABEL[r.role]),
              h("td", { class: "mono" }, r.ct ?? "(empty)"), h("td", { class: "num" }, r.line))))))),
        curvesBlock())),
    card(h("h2", null, "Technical replicates"),
      h("p", { class: "lede" }, "Wells with the same biological unit and target. SD is worked out from every well; nothing is dropped. These are technical repeats, so don't count them as separate biological samples."),
      h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, ["Biological unit", "Group", "Target", "Wells", "Ct/Cq as exported", "n", "Mean", "SD", ""].map(x => h("th", null, x)))),
        h("tbody", null, res.replicateGroups.map(g => h("tr", { class: "click" + (g.over ? " flag" : ""), tabindex: 0, onclick: () => { st.selFinding = null; st.sel = new Set(g.wells.map(C.wellKey).filter(Boolean)); renderMain(); } },
          h("td", null, g.unit), h("td", null, g.group ?? ""), h("td", null, g.target), h("td", null, g.wells.join(", ")), h("td", { class: "mono" }, g.raw_ct.map(x => x ?? "(empty)").join(", ")),
          h("td", { class: "num" }, g.n_numeric === g.n ? g.n : `${g.n_numeric} of ${g.n}`), h("td", { class: "num" }, fmt(g.mean)), h("td", { class: "num" }, fmt(g.sd, 3)),
          h("td", null, g.sd === null ? "Not assessed" : g.over ? `Above ${st.exp.ruleset.values.sdThreshold}` : "")))))),
      h("h3", null, "Biological units per group"),
      h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
        h("thead", null, h("tr", null, ["Group", "Target", "Biological units", "Units", "Wells"].map(x => h("th", null, x)))),
        h("tbody", null, res.bioSummary.map(b => h("tr", null, h("td", null, b.group || "No group"), h("td", null, b.target), h("td", null, b.units.join(", ")), h("td", { class: "num" }, b.units.length), h("td", { class: "num" }, b.wells))))))),
    res.stdCurves.length > 0 && card(h("h2", null, "Standard curves"), res.stdCurves.map(c => {
      const cv = h("canvas", { class: "chart", role: "img", "aria-label": `Standard curve for ${c.target}` });
      after.push(() => plot(cv, { points: c.points.map(p => ({ x: p.x, y: p.y })), line: c, xLabel: "log10 quantity", yLabel: "Ct/Cq" }));
      return h("figure", null, cv, h("figcaption", null, `${c.target}: efficiency ${fmt(c.efficiency, 1)}%, R² ${fmt(c.r2, 4)}, slope ${fmt(c.slope, 3)}, ${c.levels} levels.`));
    })),
    card(h("h2", null, "Was this useful?"),
      h("p", { class: "lede" }, "Your answer stays with this experiment. Nothing gets sent to me; if you want to tell me something, email me."),
      h("div", { class: "seg", role: "group", "aria-label": "Usefulness" }, ["Yes", "Partly", "No"].map(v => h("button", { type: "button", class: fb === v ? "on" : "", "aria-pressed": String(fb === v),
        onclick: () => change("feedback", `Usefulness: ${v}`, () => (st.exp.feedback = { value: v, by: actor(), at: new Date().toISOString() })) }, v))))];
};

// ---------------------------------------------------------------- 6 · Report & export (FR-19..FR-21)
VIEWS.report = () => {
  if (!st.res) return [emptyCard("The analysis has not run yet.", "data")];
  const base = st.exp.id;
  const frame = h("iframe", { class: "report-frame", sandbox: "allow-same-origin allow-modals", title: "Report preview" });
  frame.srcdoc = R.reportHtml(st.exp, st.res);
  const box = (title, desc, label, fn) => h("div", { class: "inner" }, h("b", null, title), h("small", { class: "muted" }, desc), h("button", { class: title === "Report (HTML)" ? "btn primary" : "btn", type: "button", onclick: fn }, label));
  const log = (what, name) => change("export", `${what}: ${name}`, null, { rerender: false });
  const go = (what, name, text, type) => () => { download(name, text(), type); log(what, name); };
  return [card(h("h2", null, "Export"),
      h("div", { class: "exports" },
        box("Report (HTML)", "Readable in any browser without AssayLint: context, files and checksums, checks performed and not performed, findings with dispositions, missing metadata, audit history.", "Download report",
          go("Report", `${base}.report.html`, () => R.reportHtml(st.exp, st.res), "text/html")),
        box("Report (PDF)", "Opens the print dialog for the report; choose “Save as PDF”.", "Print / save as PDF", () => { frame.contentWindow.print(); log("Report print", "print dialog"); }),
        box("Well data (CSV)", "Normalised well-level data with original identifiers, raw values and file values.", "Download CSV", go("Well data", `${base}.wells.csv`, () => R.wellsCsv(st.res), "text/csv")),
        box("Findings (CSV)", "One row per finding with rule version, evidence and disposition.", "Download CSV", go("Findings", `${base}.findings.csv`, () => R.findingsCsv(st.exp, st.res), "text/csv")),
        box("Structured results (JSON)", "Experiment context, analysis, findings, reviews and wells in one file.", "Download JSON", go("Structured results", `${base}.results.json`, () => R.structuredJson(st.exp, st.res), "application/json")),
        box("Experiment packet", "Everything, including the original files and audit history. Re-import it here or archive it with your notebook.", "Download packet", go("Experiment packet", `${base}.assaylint-packet.json`, () => R.packetJson(st.exp, st.res), "application/json"))),
      h("p", { class: "fine" }, "Every download is noted in the experiment's history.")),
    card(h("h2", null, "Report preview"), frame)];
};

// ---------------------------------------------------------------- Compare runs (FR-7)
VIEWS.compare = () => {
  const others = S.index().filter(x => x.id !== st.exp.id);
  if (!others.length) return [emptyCard("Create or import a second experiment to compare runs.")];
  const out = [card(h("h2", null, "Compare with another run"),
    h("select", { "aria-label": "Run to compare", onchange: ev => { st.compareId = ev.target.value; renderMain(); } }, h("option", { value: "" }, "Choose a run…"),
      others.map(o => h("option", { value: o.id, selected: o.id === st.compareId }, `${o.title} (${o.date}, ${o.id})`))),
    h("p", { class: "fine" }, "Shows what's different between the two runs. It doesn't judge which one is right."))];
  const other = st.compareId && S.load(st.compareId);
  if (!other) return out;
  let ores = null;
  try { ores = C.analyze(other); } catch (e) { out.push(card(h("p", { class: "error" }, `The other run could not be analysed: ${e.message}`))); }
  const c = C.compareRuns(st.exp, st.res, other, ores), A = st.exp.title, B = other.title;
  const tbl = (head, rows) => h("div", { class: "tablewrap" }, h("table", { class: "tbl" }, h("thead", null, h("tr", null, head.map(x => h("th", null, x)))), h("tbody", null, rows)));
  const diffs = c.fields.filter(f => !f.same).length;
  out.push(card(h("h2", null, `Recorded context and settings (${diffs} differ)`), tbl(["Item", A, B], c.fields.map(f => h("tr", { class: f.same ? "" : "diff" }, h("td", null, f.label), h("td", null, f.a || "—"), h("td", null, f.b || "—"))))),
    card(h("h2", null, "Mean Ct/Cq by biological unit and target"), tbl(["Target", "Biological unit", `${A}: mean (SD)`, `${B}: mean (SD)`, "Difference (B − A)"],
      c.groups.map(g => h("tr", null, h("td", null, g.target), h("td", null, g.unit), h("td", { class: "num" }, `${fmt(g.a)} (${fmt(g.sdA, 3)})`), h("td", { class: "num" }, `${fmt(g.b)} (${fmt(g.sdB, 3)})`), h("td", { class: "num" }, fmt(g.delta)))))),
    card(h("h2", null, "Controls"), tbl(["Target", "Control", A, B], c.controls.map(x => h("tr", { class: x.a === x.b ? "" : "diff" }, h("td", null, x.target), h("td", null, x.label), h("td", null, x.a), h("td", null, x.b))))),
    card(h("h2", null, "Findings by severity"), tbl(["Severity", A, B], C.SEVERITIES.map(s => h("tr", null, h("td", null, s), h("td", { class: "num" }, c.counts.a[s] || 0), h("td", { class: "num" }, c.counts.b[s] || 0))))));
  return out;
};

// ---------------------------------------------------------------- start
const first = S.index()[0];
if (first) openExp(first.id); else render();
