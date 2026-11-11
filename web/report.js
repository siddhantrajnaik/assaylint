// Human-readable report (FR-19) and structured exports (FR-20, FR-21). No DOM access.
import {
  TOOL, APP_VERSION, PARSER_VERSION, PACKET_VERSION, RULES, RULES_REVIEW, CATEGORY_LABEL, DISPOSITION_LABEL, ROLE_LABEL,
  FORMATS, CONTEXT_FIELDS, RULESET_FIELDS, rulesetId, rulesetChanges, toCsv,
} from "./core.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = iso => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));

export const LIMITATIONS = [
  "AssayLint flags possible issues for human review. It does not certify an experiment, determine whether a biological conclusion is correct, or guarantee reproducibility.",
  "Only the checks listed under “Checks performed” were run. Items under “Not assessed” were not checked and must not be read as passing.",
  "Rule thresholds are configurable placeholders and have not yet been reviewed by a qPCR domain expert.",
  "Possible causes are suggestions. AssayLint cannot diagnose contamination or the root cause of a failure from data files alone.",
  "No wells or values were removed, altered or down-weighted. Plate-map edits change labels only and are listed with the original file values.",
];

function table(head, rows, cls = "") {
  const body = rows.length ? rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${head.length}" class="none">None</td></tr>`;
  return `<table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
const kv = pairs => `<dl>${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "—")}</dd>`).join("")}</dl>`;

const CSS = `body{font:14px/1.55 "IBM Plex Sans","Segoe UI",system-ui,sans-serif;color:#17201c;font-variant-numeric:tabular-nums;max-width:1100px;margin:0 auto;padding:24px}
h1{margin:0 0 4px;font-size:24px}h2{font-size:17px;margin:32px 0 8px;padding-bottom:6px;border-bottom:1px solid #d3dad6}
.sub{color:#5b6762}.note{background:#e3f0ec;border-left:3px solid #0b6b5c;padding:10px 14px;margin:14px 0}
.status{display:inline-block;padding:3px 10px;border-radius:4px;font-weight:600;background:#e6ebe8}
.review_needed{background:#fde2e2;color:#9b1c1f}.findings_present{background:#fff1d6;color:#7a4a00}.no_flags{background:#ddf5e5;color:#145c2c}
table{border-collapse:collapse;width:100%;font-size:12.5px;margin:6px 0}th,td{border:1px solid #d3dad6;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#f4f6f5;font-weight:500;color:#5b6762}td.none{color:#5b6762}dl{display:grid;grid-template-columns:260px 1fr;gap:4px 12px;margin:0}dt{color:#5b6762}dd{margin:0;white-space:pre-wrap}
.counts{display:flex;gap:18px;flex-wrap:wrap}.counts div{border:1px solid #d3dad6;border-radius:6px;padding:8px 14px}.counts b{display:block;font-size:20px}
ul{margin:4px 0;padding-left:20px}.mono{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;word-break:break-all}
@media print{body{padding:0}h2{break-after:avoid}tr{break-inside:avoid}}`;

export function reportHtml(exp, res, generatedAt = new Date().toISOString()) {
  const s = res.summary, rv = exp.reviews || {}, rs = exp.ruleset;
  const ids = new Set(res.findings.map(f => f.id));
  const orphan = Object.entries(rv).filter(([id, r]) => !ids.has(id) && r.disposition && r.disposition !== "unreviewed");
  const changes = rulesetChanges(rs);
  const files = [["Results", exp.source], ["Amplification curves", exp.amp], ["Melt curves", exp.melt]].filter(([, f]) => f);
  const p = res.parsed;
  const finding = f => {
    const r = rv[f.id] || {};
    return [f.severity, CATEGORY_LABEL[f.category], `${f.rule} v${f.rule_version}`, `${f.title}. ${f.description}${f.uncertain ? " (cause uncertain)" : ""}`,
      f.wells.join(", ") || (f.target ? `target ${f.target}` : "run"), f.evidence, f.next_check,
      DISPOSITION_LABEL[r.disposition || "unreviewed"], r.note || "", r.by ? `${r.by}, ${when(r.at)}` : ""];
  };
  const main = res.findings.filter(f => f.category !== "missing_context" && f.severity !== "info");
  const missing = res.findings.filter(f => f.category === "missing_context");
  const info = res.findings.filter(f => f.severity === "info" && f.category !== "missing_context");
  const fHead = ["Severity", "Category", "Rule", "Finding", "Wells", "Evidence", "Next check", "Disposition", "Note", "Reviewed by"];
  const sev = s.bySeverity || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(`${TOOL} report — ${exp.title} (${exp.id})`)}</title><style>${CSS}</style></head><body>
<h1>${esc(TOOL)} report: ${esc(exp.title)}</h1>
<div class="sub">${esc(exp.id)} · qPCR · generated ${esc(when(generatedAt))} with ${esc(TOOL)} ${esc(APP_VERSION)}</div>
<p><span class="status ${esc(s.status)}">${esc(s.label)}</span></p>
<div class="note">AssayLint flagged the items below for review. This report is not a certification that the experiment or its conclusions are valid. Items marked “not assessed” were not checked.</div>

<h2>1. Summary</h2>
<div class="counts"><div><b>${sev.high || 0}</b>High</div><div><b>${sev.medium || 0}</b>Medium</div><div><b>${sev.low || 0}</b>Low</div><div><b>${sev.info || 0}</b>Info</div>
<div><b>${s.reviewed}/${s.total}</b>Reviewed</div><div><b>${s.open}</b>Open (not accepted, not applicable or resolved)</div></div>
<p>${Object.entries(s.byCategory || {}).map(([k, n]) => `${esc(CATEGORY_LABEL[k])}: ${n}`).join(" · ") || "No findings."}</p>

<h2>2. Experiment context</h2>
${kv([["Experiment ID", exp.id], ["Title", exp.title], ["Assay type", exp.assay], ["Run date", exp.date], ["Project", exp.project], ["Operator", exp.operator], ["Created", when(exp.created)], ["Last updated", when(exp.updated)],
  ...CONTEXT_FIELDS.map(f => [f.label, exp.context?.[f.key]])])}

<h2>3. Input files and parser</h2>
${table(["File", "Name", "SHA-256", "Imported", "Parser"], files.map(([k, f]) => [k, f.name, f.sha256, `${when(f.importedAt)} by ${f.importedBy}`, `v${f.parserVersion}`]), "mono")}
${p ? kv([["Detected format", FORMATS[p.format]], ["Parser version (this report)", PARSER_VERSION], ["Columns used", Object.entries(p.columns).map(([k, v]) => `${k} ← “${v}”`).join("; ")],
  ["Columns not used", p.unrecognized.join(", ")], ["Rows parsed", String(p.rows.length)], ["Rows not parsed", p.malformed.length ? p.malformed.map(m => `line ${m.line}`).join(", ") : "none"],
  ["File header metadata", Object.entries(p.metadata).map(([k, v]) => `${k} = ${v}`).join("; ")], ["Parser warnings", p.warnings.join(" ")],
  ["Melt values", exp.melt ? exp.melt.valueType : ""]]) : "<p>No results file imported.</p>"}

<h2>4. Rule set</h2>
${kv([["Rule set", `${rs.profile.name} (${rulesetId(rs)})`], ["Rule versions", [...new Set(Object.values(RULES).map(r => r.version))].join(", ")], ["Scientific review", RULES_REVIEW.status],
  ["Changed in this experiment", changes.map(c => `${c.label}: ${c.from} → ${c.to}`).join("; ") || "none"]])}
${table(["Setting", "Value"], RULESET_FIELDS.map(f => [f.label, String(rs.values[f.key])]))}
<p><b>Controls marked not applicable:</b> ${Object.entries(exp.controlNA || {}).map(([k, v]) => esc(`${k.replace("|", " for ")}: ${v.reason} (${v.by})`)).join("; ") || "none"}</p>

<h2>5. Checks performed and not performed</h2>
<p><b>Performed</b></p><ul>${res.checksRun.map(c => `<li>${esc(c)}</li>`).join("") || "<li>None</li>"}</ul>
<p><b>Not assessed</b></p><ul>${res.notAssessed.map(c => `<li>${esc(c)}</li>`).join("") || "<li>None</li>"}</ul>

<h2>6. Findings</h2>
${table(fHead, main.map(finding))}
${orphan.length ? `<p><b>Reviews of findings no longer present</b> (for example after a plate-map correction):</p>${table(["Finding", "Disposition", "Note", "Reviewed by"], orphan.map(([id, r]) => [`${id}: ${r.title || ""} ${r.description || ""}`, DISPOSITION_LABEL[r.disposition], r.note || "", `${r.by}, ${when(r.at)}`]))}` : ""}

<h2>7. Missing context and metadata</h2>
${table(fHead, missing.map(finding))}

<h2>8. Informational records</h2>
${table(fHead, info.map(finding))}

<h2>9. Technical replicates and biological units</h2>
${table(["Biological unit", "Group", "Target", "Wells", "Raw Ct/Cq", "n numeric", "Mean", "SD"], res.replicateGroups.map(g => [g.unit, g.group, g.target, g.wells.join(", "), g.raw_ct.map(x => x ?? "(empty)").join(", "), `${g.n_numeric} of ${g.n}`, num(g.mean), num(g.sd, 3)]))}
${table(["Group", "Target", "Biological units", "Units (n)", "Wells"], res.bioSummary.map(b => [b.group || "(no group)", b.target, b.units.join(", "), b.units.length, b.wells]))}
<p class="sub">Technical replicate wells are summarised within a biological unit; they are not counted as independent biological observations.</p>

<h2>10. Standard curves</h2>
${table(["Target", "Slope", "Intercept", "R²", "Efficiency", "Levels", "Wells"], res.stdCurves.map(c => [c.target, num(c.slope, 3), num(c.intercept), num(c.r2, 4), num(c.efficiency, 1) + "%", c.levels, c.points.length]))}

<h2>11. Plate map</h2>
${table(["Line", "Well", "Sample", "Target", "Group", "Role", "Role source", "Biological unit", "Quantity", "Raw Ct/Cq", "File values where edited"], res.rows.map(r => {
  const edited = Object.keys(exp.map?.[r.id] || {}).map(k => `${k}: ${r.file[k] ?? "(empty)"}`).join("; ");
  return [r.line, r.key || r.well, r.sample, r.target, r.group, ROLE_LABEL[r.role], r.roleSource, r.bio_unit, r.quantity, r.ct ?? "(empty)", edited];
}))}

<h2>12. Audit history</h2>
${table(["When", "Who", "Action", "Detail"], exp.audit.map(a => [when(a.at), a.actor, a.action, a.detail]))}

<h2>13. Limitations</h2>
<ul>${LIMITATIONS.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
${exp.feedback ? `<p class="sub">Usefulness feedback recorded in this experiment: ${esc(exp.feedback.value)} (${esc(exp.feedback.by)}).</p>` : ""}
</body></html>`;
}

export function wellsCsv(res) {
  return toCsv([["source_line", "well_raw", "well", "sample", "target", "group", "role", "role_source", "bio_unit", "quantity", "ct_raw",
    "file_sample", "file_target", "file_group", "file_role", "file_bio_unit", "file_quantity"],
    ...res.rows.map(r => [r.line, r.well, r.key ?? "", r.sample, r.target, r.group, r.role, r.roleSource, r.bio_unit, r.quantity, r.ct,
      r.file.sample, r.file.target, r.file.group, r.file.role, r.file.bio_unit, r.file.quantity])]);
}
export function findingsCsv(exp, res) {
  return toCsv([["finding_id", "rule", "rule_version", "category", "severity", "title", "description", "wells", "source_lines", "target", "evidence", "next_check", "disposition", "note", "reviewed_by", "reviewed_at"],
    ...res.findings.map(f => { const r = exp.reviews[f.id] || {};
      return [f.id, f.rule, f.rule_version, f.category, f.severity, f.title, f.description, f.wells.join(" "), f.lines.join(" "), f.target, f.evidence, f.next_check, r.disposition || "unreviewed", r.note, r.by, r.at]; })]);
}
function analysisJson(res) {
  return { ruleset: res.ruleset, checks_performed: res.checksRun, not_assessed: res.notAssessed, summary: res.summary, findings: res.findings,
    replicate_groups: res.replicateGroups, biological_units: res.bioSummary, controls: res.controls,
    standard_curves: res.stdCurves.map(({ points, ...c }) => ({ ...c, points })) };
}
export function structuredJson(exp, res) {
  const files = Object.fromEntries(["source", "amp", "melt"].filter(k => exp[k]).map(k => { const { text, ...meta } = exp[k]; return [k, meta]; }));
  return JSON.stringify({ format: "assaylint-results", tool: TOOL, app_version: APP_VERSION, parser_version: PARSER_VERSION, exported_at: new Date().toISOString(),
    experiment: { id: exp.id, title: exp.title, assay: exp.assay, date: exp.date, project: exp.project, operator: exp.operator, context: exp.context, files },
    analysis: analysisJson(res), reviews: exp.reviews, wells: res.rows }, null, 2);
}
export function packetJson(exp, res) {
  return JSON.stringify({ format: "assaylint-packet", packet_version: PACKET_VERSION, tool: TOOL, app_version: APP_VERSION, parser_version: PARSER_VERSION,
    exported_at: new Date().toISOString(), experiment: exp, analysis: analysisJson(res) }, null, 2);
}
