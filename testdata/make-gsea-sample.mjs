// Makes sample run 8: a 96-assay pathway panel on a 384-well plate (the 4 × 96 layout of RT² Profiler-style arrays),
// two control and two TNF-treated samples, with a coordinated rise in the NF-κB target genes, plus a small GMT file.
// Usage: node testdata/make-gsea-sample.mjs   (deterministic: same files every time)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { rng } from "../web/gsea.js";

const ROOT = join(import.meta.dirname, "..");
const rand = rng(1);
const normal = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

const BLOCKS = {
  NFKB_TARGETS: ["NFKBIA", "TNFAIP3", "CXCL8", "IL6", "IL1B", "CCL2", "ICAM1", "RELB", "NFKB2", "BIRC3", "PTGS2", "SOD2"],
  INTERFERON_RESPONSE: ["ISG15", "IFIT1", "MX1", "OAS1", "STAT1", "IRF7", "IFI6", "CXCL10"],
  HYPOXIA: ["HIF1A", "VEGFA", "SLC2A1", "LDHA", "CA9", "BNIP3", "ADM", "EPAS1", "EGLN3", "NDRG1"],
  CELL_CYCLE_G1_S: ["CCND1", "CCNE1", "CDK2", "CDK4", "CDK6", "CDKN1A", "CDKN1B", "CDKN2A", "E2F1", "RB1", "MKI67", "PCNA"],
  APOPTOSIS: ["BAX", "BCL2", "BCL2L1", "BAK1", "CASP3", "CASP8", "CASP9", "FAS", "FASLG", "BID"],
  OXIDATIVE_STRESS: ["NQO1", "HMOX1", "GCLM", "TXNRD1", "CAT", "GPX1", "NFE2L2", "SOD1"],
  WNT_SIGNALING: ["CTNNB1", "AXIN2", "LEF1", "TCF7", "MYC", "WNT3A", "DKK1", "FZD7", "LGR5"],
  TGFB_SIGNALING: ["TGFB1", "TGFBR1", "TGFBR2", "SMAD2", "SMAD3", "SMAD4", "SMAD7", "SERPINE1", "SKIL"],
  DNA_DAMAGE_RESPONSE: ["ATM", "ATR", "CHEK1", "CHEK2", "GADD45A", "MDM2", "TP53", "BRCA1"],
  OTHER: ["EGFR", "KRAS", "PTEN", "AKT1", "MTOR"],
};
const REFS = ["ACTB", "B2M", "GAPDH", "HPRT1", "RPLP0"];
const GENES = [...Object.values(BLOCKS).flat(), ...REFS];
if (GENES.length !== 96 || new Set(GENES).size !== 96) throw new Error(`panel has ${GENES.length} assays`);

// What TNF does here (change in Ct; negative = more mRNA). NF-κB targets go up by 0.4 to 1.9 cycles, not all equally;
// two genes outside the pathway move on their own so the top of the gene list isn't simply the pathway.
const SHIFT = { NFKBIA: -1.6, TNFAIP3: -1.9, CXCL8: -1.7, IL6: -1.2, IL1B: -0.9, CCL2: -1.1, ICAM1: -1.0, RELB: -0.7, NFKB2: -0.8, BIRC3: -1.3, PTGS2: -0.5, SOD2: -0.4,
  MKI67: 0.8, HMOX1: -0.9 };
const SAMPLES = [["Ctrl-1", "control"], ["Ctrl-2", "control"], ["TNF-1", "TNF"], ["TNF-2", "TNF"]];
const base = Object.fromEntries(GENES.map(g => [g, REFS.includes(g) ? 16.5 + rand() * 5 : 21 + rand() * 9.5]));
base.LGR5 = 33.6; base.FASLG = 32.4; // two low genes, as on most real panels
const load = SAMPLES.map(() => normal() * 0.3); // input amount per sample, shared by every assay

const rows = [["Well", "Sample Name", "Target Name", "Task", "Ct", "Group"]];
SAMPLES.forEach(([name, group], s) => GENES.forEach((g, i) => {
  // 96 → 384 interleave: assay i of sample s sits in quadrant s of the 384-well plate.
  const row = 2 * Math.floor(i / 12) + (s >> 1), col = 2 * (i % 12) + (s & 1) + 1;
  const ct = base[g] + load[s] + (group === "TNF" ? SHIFT[g] || 0 : 0) + normal() * (base[g] > 31 ? 0.45 : 0.18);
  rows.push([`${"ABCDEFGHIJKLMNOP"[row]}${col}`, name, g, "UNKNOWN", ct.toFixed(3), group]);
}));
rows.sort((a, b) => (a[0] === "Well" ? -1 : b[0] === "Well" ? 1 : a[0].localeCompare(b[0], "en", { numeric: true })));
writeFileSync(join(ROOT, "sample-data", "8 Pathway panel 384 TNF vs control - results.csv"), rows.map(r => r.join(",")).join("\n") + "\n");

// The GMT file: my own short lists, each with some genes that aren't on the panel (as real sets have), one set
// that covers almost the whole panel and one with only two panel genes, to show the size limits at work.
const EXTRA = { NFKB_TARGETS: ["NFKB1", "RELA", "TNF", "CXCL1", "CXCL2", "IRF1", "JUNB"], INTERFERON_RESPONSE: ["IFIT3", "OAS2", "RSAD2"], HYPOXIA: ["PDK1", "ENO1", "ALDOA"],
  CELL_CYCLE_G1_S: ["CCNA2", "CDC25A"], APOPTOSIS: ["BIRC3", "TNFAIP3", "CFLAR", "XIAP"], OXIDATIVE_STRESS: ["SOD2", "GSR", "SRXN1"], WNT_SIGNALING: ["APC", "GSK3B"],
  TGFB_SIGNALING: ["ID1", "JUNB"], DNA_DAMAGE_RESPONSE: ["CDKN1A", "RAD51", "XRCC5"] };
const gmt = Object.entries(BLOCKS).filter(([k]) => k !== "OTHER").map(([k, gs]) => [k, "PlateCheck sample set", ...gs, ...(EXTRA[k] || [])]);
gmt.push(["ALL_PANEL_SIGNALLING", "covers almost the whole panel", ...Object.values(BLOCKS).flat().slice(0, 89)]);
gmt.push(["MTOR_AXIS_SMALL", "only two genes on the panel", "MTOR", "AKT1", "RPTOR", "RICTOR", "RPS6KB1"]);
writeFileSync(join(ROOT, "sample-data", "8 Pathway panel gene sets.gmt"), gmt.map(r => r.join("\t")).join("\n") + "\n");
console.log(`wrote ${rows.length - 1} wells and ${gmt.length} gene sets`);
