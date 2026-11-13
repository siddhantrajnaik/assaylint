// Runs every file under testdata/ through PlateCheck and prints a per-file summary.
// Usage: node testdata/run-all.mjs [--detail]
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as C from "../web/core.js";

const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const detail = process.argv.includes("--detail");
const files = [];
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (!n.startsWith(".")) walk(p); } else if (/\.(csv|txt|tsv)$/i.test(n) && !/SOURCES|_amp|_melt|_map/i.test(n)) files.push(p); } };
walk(join(root, "public")); walk(join(root, "realistic"));
const sizes = JSON.parse(readFileSync(join(root, "plate-sizes.json"), "utf8"));
const rows = [];
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, "/"), text = readFileSync(f, "utf8");
  const exp = C.newExperiment({ title: rel }, "run-all");
  exp.source = { name: rel, text, sha256: "-", plateSize: sizes[rel] };
  for (const [k, suffix, extra] of [["amp", "_amp.csv", {}], ["melt", "_melt.csv", { valueType: "derivative" }]]) {
    try { const t = readFileSync(f.replace(/\.(csv|txt)$/i, suffix), "utf8"); exp[k] = { name: rel + suffix, text: t, sha256: "-", ...extra }; } catch { /* no curve file */ }
  }
  if (exp.melt) exp.ruleset.values.meltChecks = true;
  try {
    const res = C.analyze(exp), by = {};
    for (const x of res.findings) by[x.rule] = (by[x.rule] || 0) + 1;
    rows.push({ file: rel, ok: true, format: res.parsed.format, rows: res.rows.length, malformed: res.parsed.malformed.length,
      status: res.summary.status, sev: res.summary.bySeverity, rules: by, warnings: res.parsed.warnings });
  } catch (e) { rows.push({ file: rel, ok: false, error: e.message }); }
}
for (const r of rows) {
  if (!r.ok) { console.log(`✖ ${r.file}\n    ${r.error}`); continue; }
  console.log(`✔ ${r.file}  [${r.format}] ${r.rows} rows${r.malformed ? `, ${r.malformed} malformed` : ""} → ${r.status} (H${r.sev.high || 0} M${r.sev.medium || 0} L${r.sev.low || 0})`);
  if (detail) console.log("    " + Object.entries(r.rules).map(([k, v]) => `${k}×${v}`).join(", ") + (r.warnings.length ? `\n    warnings: ${r.warnings.join(" | ")}` : ""));
}
writeFileSync(join(root, "results.json"), JSON.stringify(rows, null, 2));
console.log(`\n${rows.filter(r => r.ok).length}/${rows.length} files parsed`);
