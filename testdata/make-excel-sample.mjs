// Builds sample-data/4 QuantStudio Excel export.xlsx from sample 2, laid out the way QuantStudio's
// "Export to Excel" does it: one workbook, a block of run details on top of each sheet, numbers as real numbers.
// Run: node testdata/make-excel-sample.mjs
import { readFileSync, writeFileSync } from "node:fs";
import * as X from "../web/vendor/xlsx.mjs";
import { splitDelimited } from "../web/core.js";

const dir = new URL("../sample-data/", import.meta.url);
const txt = readFileSync(new URL("2 QuantStudio 384 TaqMan - results.txt", dir), "utf8");
const ampCsv = readFileSync(new URL("2 QuantStudio 384 TaqMan - amplification curves.csv", dir), "utf8");
const cells = t => splitDelimited(t).map(r => r.cells.map(v => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v) : v)));
const pre = txt.split(/\r?\n/).filter(l => l.startsWith("* ")).map(l => { const [k, ...v] = l.slice(2).split(" = "); return [k.trim(), v.join(" = ").trim()]; });
const results = cells(txt.slice(txt.indexOf("[Results]") + "[Results]".length).trim());
const setup = [...pre, [], ["Well", "Well Position", "Sample Name", "Target Name", "Task", "Reporter", "Quencher"],
  ...results.slice(1).filter(r => r.length > 7).map(r => [r[0], r[1], r[3], r[4], r[5], r[6], r[7]])];

const wb = X.utils.book_new();
X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(setup), "Sample Setup");
X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([...pre, [], ...cells(ampCsv)]), "Amplification Data");
const rs = X.utils.aoa_to_sheet([...pre, [], ...results]);
for (const [addr, c] of Object.entries(rs)) if (!addr.startsWith("!") && c.t === "n" && !Number.isInteger(c.v)) c.z = "0.000"; // Excel shows 3 decimals; the file keeps all
X.utils.book_append_sheet(wb, rs, "Results");
writeFileSync(new URL("4 QuantStudio Excel export.xlsx", dir), X.write(wb, { type: "buffer", bookType: "xlsx" }));
console.log("wrote sample-data/4 QuantStudio Excel export.xlsx");
