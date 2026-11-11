// Generates realistic instrument-style exports for cases the public files do not cover.
// Layouts follow the vendors' documented/observed export structure; all values are synthetic.
// Usage: node testdata/make-realistic.mjs   (writes testdata/realistic/*)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "realistic");
mkdirSync(dir, { recursive: true });
let seed = 11;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const jit = s => (rnd() - 0.5) * 2 * s;
const pos = (i, cols) => String.fromCharCode(65 + Math.floor(i / cols)) + ((i % cols) + 1);
const pad = k => k[0] + k.slice(1).padStart(2, "0");
const curve = (ct, A = 1.8, cycles = 40) => Array.from({ length: cycles }, (_, i) => {
  const c = i + 1, base = 0.003 * c; // slight upward drift, as in raw Rn
  return ct == null ? base + jit(0.004) : base + jit(0.004) + A / (1 + Math.exp(-(c - (ct + 1.6 * Math.log(A / 0.18 - 1))) / 1.6));
});
const melt = (peaks, temps) => temps.map(T => peaks.reduce((a, [tm, h]) => a + h * Math.exp(-((T - tm) ** 2) / (2 * 0.7 ** 2)), jit(0.01)));
const temps = Array.from({ length: 61 }, (_, i) => 65 + i * 0.5);
const write = (name, text) => { writeFileSync(join(dir, name), text); console.log("wrote", name); };
const expect = {};

// ---------------------------------------------------------------- A. QuantStudio 5, 384-well TaqMan duplex (text export)
{
  const wells = []; // [wellKey, sample, task, quantity, {GENEX: ct, ACTB: ct}, omit]
  let i = 0;
  const units = ["ctrl-1", "ctrl-2", "ctrl-3", "ctrl-4", "drug-1", "drug-2", "drug-3", "drug-4"];
  for (const u of units) for (let r = 0; r < 3; r++) wells.push([pos(i++, 24), u, "UNKNOWN", "", { GENEX: (u.startsWith("drug") ? 27.4 : 25.1) + jit(0.12), ACTB: 19.3 + jit(0.1) }, false]);
  i = 48;
  for (const q of [1e6, 1e5, 1e4, 1e3, 1e2, 1e1]) for (let r = 0; r < 3; r++) wells.push([pos(i++, 24), "", "STANDARD", String(q), { GENEX: 38.9 - 3.32 * Math.log10(q) + jit(0.1), ACTB: null }, false]);
  i = 96;
  for (let r = 0; r < 3; r++) wells.push([pos(i++, 24), "NTC", "NTC", "", { GENEX: r === 2 ? 36.8 : null, ACTB: null }, false]);
  for (let r = 0; r < 2; r++) wells.push([pos(i++, 24), "ctrl-1 noRT", "UNKNOWN", "", { GENEX: null, ACTB: r ? 34.9 : null }, false]);
  wells[4][4].GENEX = 26.9; wells[4][5] = true;               // outlier the user omitted in the instrument software
  wells[13][4].ACTB = null;                                     // VIC failed in one well
  const hdr = ["Well", "Well Position", "Omit", "Sample Name", "Target Name", "Task", "Reporter", "Quencher", "Cт", "Cт Mean", "Cт SD", "Quantity", "Quantity Mean", "Quantity SD",
    "Automatic Ct Threshold", "Ct Threshold", "Automatic Baseline", "Baseline Start", "Baseline End", "Amp Status", "Comments", "Cq Conf", "EXPFAIL", "HIGHSD", "NOAMP"];
  const lines = [], amp = [["Well", "Well Position", "Cycle", "Target Name", "Rn", "Delta Rn"]];
  for (const [k, s, task, q, cts, omit] of wells) for (const [t, rep, quen] of [["GENEX", "FAM", "NFQ-MGB"], ["ACTB", "VIC", "QSY"]]) {
    if (task === "STANDARD" && t === "ACTB") continue;
    const ct = cts[t], idx = (k.charCodeAt(0) - 65) * 24 + Number(k.slice(1));
    lines.push([idx, k, omit ? "true" : "false", s, t, task, rep, quen, ct == null ? "Undetermined" : ct.toFixed(3), "", "", task === "STANDARD" ? q : "", "", "",
      "true", "0.200", "true", 3, ct == null ? 39 : Math.max(3, Math.floor(ct) - 3), ct == null ? "No Amp" : "Amp", "", ct == null ? "0.000" : (0.9 + jit(0.05)).toFixed(3), "N", "N", ct == null ? "Y" : "N"].join("\t"));
    curve(ct).forEach((y, c) => amp.push([idx, k, c + 1, t, (y + 0.9).toFixed(4), y.toFixed(4)]));
  }
  write("quantstudio5_384_taqman.txt", ["* Block Type = 384-Well Block", "* Calibration Background is expired  = No", "* Chemistry = TAQMAN",
    "* Experiment Barcode = ", "* Experiment Comment = ", "* Experiment Name = 2025-02-14 GENEX drug response", "* Experiment Run End Time = 2025-02-14 16:02:11 PM CET",
    "* Instrument Name = QS5-lab2", "* Instrument Serial Number = 272510000", "* Instrument Type = QuantStudio™ 5 System", "* Passive Reference = ROX",
    "* Quantification Cycle Method = Ct", "* Signal Smoothing On = true", "* Stage/ Cycle where Analysis is performed = Stage 2, Step 2",
    "", "[Results]", hdr.join("\t"), ...lines, "", "[Melt Curve Result]", "Well\tWell Position\tTm1", "", "* Analysis Type = Singleplex",
    "* Reference Sample = ctrl-1", ""].join("\r\n"));
  write("quantstudio5_384_taqman_amp.csv", amp.map(r => r.join(",")).join("\r\n") + "\r\n");
  expect["realistic/quantstudio5_384_taqman.txt"] = { format: "thermo-quantstudio", rows: lines.length,
    must: ["instrument_omit", "ntc_amplification", "std_curve_summary", "missing_ct"], mustNot: ["invalid_well_coordinate", "malformed_row", "melt_multiple_peaks"] };
}

// ---------------------------------------------------------------- B. Bio-Rad CFX96, SYBR, three files
const cfx = { rows: [], amp: {}, melt: {} };
{
  const add = (k, target, content, sample, set, cq, sq = "", peaks = null) => {
    cfx.rows.push({ k, target, content, sample, set, cq, sq });
    cfx.amp[k] = curve(cq, cq != null && content === "NTC" ? 0.5 : 1.8);
    cfx.melt[k] = melt(peaks ?? (cq == null ? [] : [[target === "HPRT1" ? 81.5 : 83.0, 1 + jit(0.05)]]), temps);
  };
  let i = 0;
  for (const [t, base] of [["HPRT1", 22.6], ["IL6", 28.9]]) for (const [u, set, d] of [["WT-1", "WT", 0], ["WT-2", "WT", 0.2], ["KO-1", "KO", 3.1], ["KO-2", "KO", 2.8]])
    for (let r = 0; r < 3; r++) add(pad(pos(i++, 12)), t, `Unkn-0${Math.floor(i / 3)}`, u, set, base + (t === "IL6" ? d : 0) + jit(0.1));
  add("H01", "HPRT1", "NTC", "", "", null);
  add("H02", "IL6", "NTC", "", "", 34.6, "", [[74.8, 0.5]]);                           // primer-dimer
  add("H03", "IL6", "Neg Ctrl", "WT-1 -RT", "", null);                                  // ambiguous role
  add("H04", "IL6", "Pos Ctrl", "cDNA pool", "", 25.2);
  cfx.rows[16].cq = 33.4; cfx.amp["B05"] = curve(33.4); cfx.melt["B05"] = melt([[83.0, 0.6], [75.5, 0.35]], temps); // secondary peak
  const hdr = ",Well,Fluor,Target,Content,Sample,Biological Set Name,Cq,Cq Mean,Cq Std. Dev,Starting Quantity (SQ),Log Starting Quantity,SQ Mean,SQ Std. Dev,Set Point,Well Note";
  const body = r => ["", r.k, "SYBR", r.target, r.content, r.sample, r.set, r.cq == null ? "NaN" : String(r.cq), "", "", "NaN", "NaN", "NaN", "0", "60", ""];
  write("cfx96_sybr.csv", [hdr, ...cfx.rows.map(r => body(r).join(","))].join("\r\n") + "\r\n");
  const keys = Object.keys(cfx.amp);
  write("cfx96_sybr_amp.csv", [",Cycle," + keys.join(","), ...Array.from({ length: 40 }, (_, c) => `,${c + 1},` + keys.map(k => (cfx.amp[k][c] * 1000).toFixed(3)).join(","))].join("\r\n") + "\r\n");
  write("cfx96_sybr_melt.csv", [",Temperature," + keys.join(","), ...temps.map((T, j) => `,${T.toFixed(2)},` + keys.map(k => (cfx.melt[k][j] * 400).toFixed(3)).join(","))].join("\r\n") + "\r\n");
  expect["realistic/cfx96_sybr.csv"] = { format: "biorad-cfx-cq", rows: cfx.rows.length,
    must: ["unmapped_role", "ntc_amplification", "ntc_melt_peak", "melt_multiple_peaks", "replicate_dispersion"], mustNot: ["malformed_row", "invalid_well_coordinate", "amp_curve_missing"] };

  // C. same plate exported with a German locale: semicolons and decimal commas
  const de = v => String(v).replace(".", ",");
  write("cfx96_sybr_european.csv", [hdr.replace(/,/g, ";"), ...cfx.rows.map(r => body(r).map(de).join(";"))].join("\r\n") + "\r\n");
  expect["realistic/cfx96_sybr_european.csv"] = { format: "biorad-cfx-cq", rows: cfx.rows.length,
    must: ["unmapped_role", "ntc_amplification", "replicate_dispersion"], mustNot: ["non_numeric_ct", "malformed_row"] };
}

// ---------------------------------------------------------------- D. Roche LightCycler 480 "Abs Quant/2nd Derivative Max" text export
{
  const rows = [];
  let i = 0;
  for (const q of [1e5, 1e4, 1e3, 1e2]) for (let r = 0; r < 2; r++) rows.push([pos(i++, 12), `Std ${q.toExponential(0)}`, (35.1 - 3.45 * Math.log10(q) + jit(0.1)).toFixed(2), q.toExponential(2)]);
  for (const s of ["Patient A", "Patient B", "Patient C"]) for (let r = 0; r < 2; r++) rows.push([pos(i++, 12), s, (24 + jit(0.15) + s.charCodeAt(8) % 3).toFixed(2), ""]);
  rows.push([pos(i++, 12), "H2O", "", ""]);
  const lines = ["Experiment: 2024-03-11 CMV load  Selected Filter: SYBR Green I / HRM Dye (465-510)",
    "Include\tColor\tPos\tName\tCp\tConcentration\tStandard\tStatus",
    ...rows.map(([k, n, cp, std]) => ["True", "255", k, n, cp, cp ? (1e5 * Math.pow(10, (13.85 - Number(cp)) / 3.45)).toExponential(2) : "", std, ""].join("\t"))];
  write("lightcycler480_absquant.txt", lines.join("\r\n") + "\r\n");
  expect["realistic/lightcycler480_absquant.txt"] = { format: "generic-ct-csv", rows: rows.length, must: ["unmapped_well"], mustNot: ["malformed_row", "missing_control"] };
}

// ---------------------------------------------------------------- E. Hand-edited CSV saved from Excel
{
  write("handmade_excel.csv", "﻿Well,Sample,Gene,Ct,Notes\r\nA01,\"mouse 3, liver\",Gapdh,17.92,\r\nA02,\"mouse 3, liver\",Gapdh,18.05 ,\r\nA03,\"mouse 3, liver\",Gapdh,N/A,bubble\r\n" +
    "\r\nA1O,\"mouse 4, liver\",Gapdh,18.40,typo in well\r\nA05,\"mouse 4, liver\",Gapdh,18.31,\r\nA06,\"mouse 4, liver\",Gapdh,18.22,\r\nB01,water,Gapdh,,\r\n" +
    ",,,,\r\n,,,,\r\nAverage,,,18.15,\r\n");
  expect["realistic/handmade_excel.csv"] = { format: "generic-ct-csv", rows: 7, must: ["invalid_well_coordinate", "missing_ct"], mustNot: ["malformed_row", "non_numeric_ct", "missing_control"] };
}

// ---------------------------------------------------------------- F. Truncated download (connection dropped mid-row)
{
  const full = [",Well,Fluor,Target,Content,Sample,Biological Set Name,Cq", ...cfx.rows.slice(0, 20).map(r => ["", r.k, "SYBR", r.target, r.content, r.sample, r.set, r.cq == null ? "NaN" : r.cq.toFixed(2)].join(","))].join("\n");
  write("cfx_truncated.csv", full.slice(0, full.lastIndexOf(",SYBR,") + 9));
  expect["realistic/cfx_truncated.csv"] = { format: "biorad-cfx-cq", rows: 19, must: ["malformed_row"], mustNot: [] };
}

// ---------------------------------------------------------------- G. Wrong file chosen: amplification data uploaded as results
expect["realistic/cfx96_sybr_amp_as_results.csv"] = { error: /Ct\/Cq/ };
write("cfx96_sybr_amp_as_results.csv", [",Cycle,A01,A02", ",1,10.2,11.0", ",2,10.4,11.1"].join("\r\n"));

write("expectations.json", JSON.stringify(expect, (k, v) => (v instanceof RegExp ? { regex: v.source } : v), 2));
