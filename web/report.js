// Human-readable report (FR-19) and structured exports (FR-20, FR-21). No DOM access.
import {
  TOOL, APP_VERSION, PARSER_VERSION, PACKET_VERSION, RULES, RULES_REVIEW, CATEGORY_LABEL, DISPOSITION_LABEL, ROLE_LABEL,
  FORMATS, FIELD_LABEL, CONTEXT_FIELDS, RULESET_FIELDS, REFERENCES, rulesetId, rulesetChanges, referencesFor, toCsv,
} from "./core.js";
import { CREDIT } from "./credit.js";
import { analysisReportHtml } from "./analysis.js"; // analysis module
import { assayReportHtml } from "./assays.js"; // assay types: workstream 4

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const when = iso => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "");
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));

export const LIMITATIONS = [
  "PlateCheck points out things worth a second look. It can't tell you whether the experiment or its conclusions are right.",
  "Only the checks under “What was checked” ran. Anything under “Not checked” wasn't looked at, so don't read it as a pass.",
  "Each threshold's source is listed under References. Some are published acceptance criteria and some are my own rules of thumb; none has been reviewed by a qPCR expert for this tool yet.",
  "Possible causes are suggestions. Contamination or the reason a reaction failed can't be worked out from the data files alone.",
  "No wells or values were removed or changed. Plate-map edits only change labels, and the original values are listed above.",
];

function table(head, rows, cls = "") {
  if (!rows.length) return `<p class="sub">None.</p>`;
  const body = rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table class="${cls}"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}
const kv = pairs => `<dl>${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v || "Not recorded")}</dd>`).join("")}</dl>`;
const onoff = v => (v === true ? "on" : v === false ? "off" : String(v));
const sentence = list => (list.length > 1 ? list.slice(0, -1).join(", ") + " and " + list.at(-1) : list[0] || "");

const CSS = `body{font:15px/1.6 "IBM Plex Sans","Segoe UI",system-ui,sans-serif;color:#17201c;font-variant-numeric:tabular-nums;max-width:860px;margin:0 auto;padding:40px 28px 64px}
h1{margin:0 0 6px;font-size:26px;line-height:1.2;letter-spacing:-.01em}
h2{font-size:18px;margin:40px 0 10px;padding-top:14px;border-top:1px solid #d3dad6}
h3{font-size:15.5px;margin:0 0 4px}
p{margin:0 0 10px}.sub{color:#5b6762}.small{font-size:13px}
.meta{display:flex;flex-wrap:wrap;gap:4px 24px;margin:0 0 18px;font-size:13.5px;color:#5b6762}.meta b{font-weight:500;color:#17201c}
.status{font-weight:600}.review_needed{color:#b42318}.findings_present{color:#b25e09}.no_flags{color:#1d6b3a}
.finding{padding:14px 0;border-bottom:1px solid #e6ebe8}.finding:last-child{border-bottom:0}
.sev{font-weight:600;margin-right:8px}.sev.high{color:#b42318}.sev.medium{color:#b25e09}.sev.low{color:#7a6300}.sev.info{color:#5b6762;font-weight:500}
.ev{font:12.5px/1.5 "IBM Plex Mono",ui-monospace,Consolas,monospace;background:#f4f6f5;border-radius:5px;padding:7px 10px;white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0 8px}
.decision{font-size:13.5px;color:#5b6762}.decision b{color:#17201c;font-weight:500}
table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0 14px}th,td{padding:6px 10px 6px 0;text-align:left;vertical-align:top;border-bottom:1px solid #e6ebe8}
th{font-weight:500;color:#5b6762;border-bottom:1px solid #d3dad6}
dl{display:grid;grid-template-columns:220px minmax(0,1fr);gap:5px 16px;margin:0 0 12px}dt{color:#5b6762}dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.mono{font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;font-size:12.5px}
ul{margin:4px 0 12px;padding-left:20px}li{margin:3px 0}.refs{font-size:13px;padding-left:22px}.refs li{margin:5px 0;overflow-wrap:anywhere}
.file{margin:0 0 16px}.file h3{margin-bottom:6px}
footer{margin-top:48px;padding-top:14px;border-top:1px solid #d3dad6;font-size:13px;color:#5b6762}
a{color:#0b6b5c}
@media (max-width:640px){dl{grid-template-columns:1fr}dd{margin-bottom:8px}}
@media print{body{padding:0;max-width:none}h2{break-after:avoid}.finding,tr{break-inside:avoid}}`;

export function reportHtml(exp, res, generatedAt = new Date().toISOString()) {
  const s = res.summary, rv = exp.reviews || {}, rs = exp.ruleset, sev = s.bySeverity || {};
  const ids = new Set(res.findings.map(f => f.id));
  const orphan = Object.entries(rv).filter(([id, r]) => !ids.has(id) && r.disposition && r.disposition !== "unreviewed");
  const changes = rulesetChanges(rs);
  const files = [["Results", exp.source], ["Amplification curves", exp.amp], ["Melt curves", exp.melt]].filter(([, f]) => f);
  const p = res.parsed;
  const main = res.findings.filter(f => f.category !== "missing_context" && f.severity !== "info");
  const missing = res.findings.filter(f => f.category === "missing_context");
  const info = res.findings.filter(f => f.severity === "info" && f.category !== "missing_context");
  const counts = [["high", "high"], ["medium", "medium"], ["low", "low"], ["info", "informational"]].filter(([k]) => sev[k]).map(([k, l]) => `${sev[k]} ${l}`);
  const decision = f => {
    const r = rv[f.id];
    if (!r?.disposition || r.disposition === "unreviewed") return `<p class="decision">Not reviewed yet.</p>`;
    return `<p class="decision"><b>${esc(DISPOSITION_LABEL[r.disposition])}</b> by ${esc(r.by)} on ${esc(when(r.at))}.${r.note ? ` ${esc(r.note)}` : ""}</p>`;
  };
  const finding = f => `<div class="finding">
<h3><span class="sev ${esc(f.severity)}">${esc(f.severity[0].toUpperCase() + f.severity.slice(1))}</span>${esc(f.title)}</h3>
<p>${esc(f.description)}${f.wells.length ? ` <span class="sub">Wells: ${esc(f.wells.join(", "))}.</span>` : ""}</p>
<div class="ev">${esc(f.evidence)}</div>
<p>${esc(f.why)} <b>Check next.</b> ${esc(f.next_check)}</p>
${decision(f)}
<p class="sub small">Checked by rule ${esc(f.rule)}, version ${esc(f.rule_version)}.</p></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(`${exp.title}: qPCR run review`)}</title><style>${CSS}</style></head><body>
<h1>${esc(exp.title)}</h1>
<div class="meta"><span>qPCR run review</span><span>ID <b class="mono">${esc(exp.id)}</b></span><span>Run date <b>${esc(exp.date)}</b></span>${exp.operator ? `<span>Operator <b>${esc(exp.operator)}</b></span>` : ""}<span>Report made <b>${esc(when(generatedAt))}</b></span></div>
<p><span class="status ${esc(s.status)}">${esc(s.label)}.</span> ${counts.length ? `${esc(sentence(counts))} findings; ${s.reviewed} of ${s.total} reviewed, ${s.open} still open.` : "Nothing was flagged by the checks that ran."}</p>
<p class="sub">These are things PlateCheck thought worth a second look. It doesn't certify the experiment or its conclusions, and anything listed under “not checked” below wasn't looked at.</p>

<h2>Findings</h2>
${main.length ? main.map(finding).join("") : `<p>None.</p>`}
${orphan.length ? `<h3 style="margin-top:18px">Earlier decisions on findings that no longer appear</h3><p class="sub small">For example after a plate-map correction.</p><ul>${orphan.map(([, r]) => `<li>${esc(r.title || "")}: ${esc(DISPOSITION_LABEL[r.disposition])} by ${esc(r.by)} on ${esc(when(r.at))}${r.note ? `. ${esc(r.note)}` : ""}</li>`).join("")}</ul>` : ""}

<h2>Method details not provided</h2>
${missing.length ? `<ul>${missing.map(f => `<li>${esc(f.title.replace(/^Not provided: /, ""))}${f.severity === "info" ? ' <span class="sub">(optional)</span>' : ""}${rv[f.id]?.disposition && rv[f.id].disposition !== "unreviewed" ? ` <span class="sub">${esc(DISPOSITION_LABEL[rv[f.id].disposition].toLowerCase())}${rv[f.id].note ? `: ${esc(rv[f.id].note)}` : ""}</span>` : ""}</li>`).join("")}</ul>` : "<p>Everything asked for was provided.</p>"}

<h2>What was checked</h2>
<ul>${res.checksRun.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
<p><b>Not checked</b></p>
<ul>${res.notAssessed.map(c => `<li>${esc(c)}</li>`).join("") || "<li>Nothing; every check had the data it needed.</li>"}</ul>
${info.length ? `<p><b>Other notes</b></p><ul>${info.map(f => `<li>${esc(f.description)} <span class="sub">${esc(f.evidence)}</span></li>`).join("")}</ul>` : ""}

<h2>Experiment</h2>
${kv([["Title", exp.title], ["Project", exp.project], ["Operator", exp.operator], ["Run date", exp.date], ...CONTEXT_FIELDS.map(f => [f.label, exp.context?.[f.key]])])}

<h2>Files</h2>
${files.map(([k, f]) => `<div class="file"><h3>${esc(k)}: ${esc(f.name)}</h3>${kv([["Imported", `${when(f.importedAt)} by ${f.importedBy}`], f.workbook && ["From Excel file", `${f.workbook.name}, sheet “${f.workbook.sheet}”`], ["SHA-256 checksum", null], f.valueType && ["Melt values", f.valueType], f.plateSize && ["Plate layout", `${f.plateSize}-well`]]).replace("<dd>Not recorded</dd>", `<dd class="mono">${esc(f.sha256)}</dd>`)}</div>`).join("")}
${p ? kv([["Layout recognised", FORMATS[p.format]], ["Columns read", Object.entries(p.columns).map(([k, v]) => `${FIELD_LABEL[k]} from “${v}”`).join(", ")],
  p.unrecognized.length && ["Columns ignored", p.unrecognized.join(", ")], ["Rows read", String(p.rows.length)], p.malformed.length && ["Rows that couldn't be read", p.malformed.map(m => `line ${m.line}`).join(", ")],
  p.warnings.length && ["Notes from reading the file", p.warnings.join(" ")], ["Reader version", PARSER_VERSION]]) : "<p>No results file imported.</p>"}

<h2>Settings used</h2>
<p>${esc(rs.profile.name)}, version ${esc(String(rs.profile.version))}. ${esc(RULES_REVIEW.status)}.${changes.length ? ` Changed for this experiment: ${esc(sentence(changes.map(c => `${c.label[0].toLowerCase() + c.label.slice(1)} ${onoff(c.to)} (default ${onoff(c.from)})`)))}.` : ""}</p>
${table(["Setting", "Value", "Basis"], RULESET_FIELDS.map(f => [f.label, onoff(rs.values[f.key]), [f.evidence, (f.refs || []).map(k => REFERENCES[k].short).join("; ")].filter(Boolean).join(" ")]))}
${Object.keys(exp.controlNA || {}).length ? `<p><b>Controls marked not applicable</b></p><ul>${Object.entries(exp.controlNA).map(([k, v]) => { const [role, t] = k.split("|"); return `<li>${esc(ROLE_LABEL[role])} for ${esc(t)}: ${esc(v.reason)} (${esc(v.by)})</li>`; }).join("")}</ul>` : ""}

<h2>Technical replicates</h2>
${table(["Biological unit", "Group", "Target", "Wells", "Ct/Cq as exported", "Mean", "SD"], res.replicateGroups.map(g => [g.unit, g.group, g.target, g.wells.join(", "), g.raw_ct.map(x => x ?? "(empty)").join(", "), num(g.mean), num(g.sd, 3)]))}
<p class="sub small">Wells sharing a biological unit and target. They are technical repeats, not separate biological samples. Biological units per group: ${esc(res.bioSummary.map(b => `${b.group || "no group"} / ${b.target}: ${b.units.length}`).join("; ") || "none")}.</p>

${analysisReportHtml(exp, res, esc) /* analysis module: empty unless switched on */}
${exp.assaySetup?.type ? assayReportHtml(exp, res.rows, esc) /* workstream 4 */ : ""}

${res.stdCurves.length ? `<h2>Standard curves</h2>${table(["Target", "Efficiency", "R²", "Slope", "Intercept", "Levels"], res.stdCurves.map(c => [c.target, num(c.efficiency, 1) + "%", num(c.r2, 4), num(c.slope, 3), num(c.intercept), c.levels]))}` : ""}

<h2>Plate map</h2>
${table(["Well", "Sample", "Target", "Group", "Role", "Biological unit", "Quantity", "Ct/Cq as exported", "Changed from file"], res.rows.map(r => {
  const edited = Object.keys(exp.map?.[r.id] || {}).map(k => `${FIELD_LABEL[k] || k} was “${r.file[k] ?? ""}”`).join("; ");
  return [r.key || r.well, r.sample, r.target, r.group, ROLE_LABEL[r.role] + (r.roleSource.startsWith("inferred") ? " (from name)" : ""), r.bio_unit, r.quantity, r.ct ?? "(empty)", edited];
}))}

<h2>History</h2>
${table(["When", "Who", "What"], exp.audit.map(a => [when(a.at), a.actor, a.detail]))}

<h2>References</h2>
<p class="sub small">Sources for the thresholds above and for the checks that raised a flag. The reasoning behind each number is in docs/thresholds.md in the PlateCheck repository.</p>
<ol class="refs">${referencesFor(res.findings).map(r => `<li>${esc(r.text)} <a href="https://doi.org/${esc(r.doi)}">doi:${esc(r.doi)}</a></li>`).join("")}</ol>

<h2>Limits of this report</h2>
<ul>${LIMITATIONS.map(l => `<li>${esc(l)}</li>`).join("")}</ul>
${exp.feedback ? `<p class="sub">Asked whether this review was useful: ${esc(exp.feedback.value.toLowerCase())}.</p>` : ""}
<footer>Made with PlateCheck ${esc(APP_VERSION)}, by ${esc(CREDIT.name)}, ${esc(CREDIT.affiliation)}. Questions: <a href="mailto:${esc(CREDIT.email)}">${esc(CREDIT.email)}</a>${CREDIT.linkedin ? ` or <a href="${esc(CREDIT.linkedin)}">LinkedIn</a>` : ""}.${CREDIT.guidance?.length ? ` With guidance from ${CREDIT.guidance.map(g => `${esc(g.name)}, ${esc(g.affiliation)} (<a href="mailto:${esc(g.email)}">${esc(g.email)}</a>)`).join(", ")}.` : ""}</footer>
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
