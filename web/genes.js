// Targets as genes: what kind of RNA each target is, its gene symbol, and an optional lookup in a public
// gene database. Everything here except lookupGene() is pure and runs in node for the tests.
// lookupGene() only sends a gene symbol, and only when the user presses "Look up genes".

export const RNA_TYPES = [
  ["mRNA", "mRNA"], ["miRNA", "miRNA"], ["lncRNA", "lncRNA"], ["circRNA", "circRNA"],
  ["sncRNA", "snoRNA / snRNA"], ["rRNA", "rRNA"], ["other", "Genomic DNA / other"],
];
export const RNA_TYPE_LABEL = Object.fromEntries(RNA_TYPES);
export const SPECIES = [["human", "Human"], ["mouse", "Mouse"], ["rat", "Rat"], ["other", "Other"]];
export const SPECIES_LABEL = Object.fromEntries(SPECIES);
export const SOURCES = {
  "MyGene.info": "https://mygene.info",
  HGNC: "https://www.genenames.org",
};

// Names people use in plate maps that aren't the official symbol. Keys are compacted (see compact()).
const ALIASES = {
  BACTIN: "ACTB", BETAACTIN: "ACTB", ACTINB: "ACTB", ACTINBETA: "ACTB", BACT: "ACTB",
  G3PDH: "GAPDH", GAPD: "GAPDH",
  B2MG: "B2M", BETA2M: "B2M", BETA2MICROGLOBULIN: "B2M", B2MICROGLOBULIN: "B2M",
  HPRT: "HPRT1", PBGD: "HMBS", "36B4": "RPLP0", ARBP: "RPLP0", CYCLOPHILINA: "PPIA", CYCA: "PPIA",
  EF1A: "EEF1A1", EF1ALPHA: "EEF1A1", EEF1A: "EEF1A1", L32: "RPL32", L13A: "RPL13A", "14333Z": "YWHAZ",
  "18S": "RNA18SN5", "18SRRNA": "RNA18SN5", "18SRNA": "RNA18SN5", RN18S: "RNA18SN5", RN18S1: "RNA18SN5", RNA18S5: "RNA18SN5", RRN18S: "RNA18SN5",
  "28S": "RNA28SN5", "28SRRNA": "RNA28SN5", RN28S1: "RNA28SN5", "58S": "RNA5-8SN5", "58SRRNA": "RNA5-8SN5", "5S": "RNA5S1", "5SRRNA": "RNA5S1",
  U6: "RNU6-1", U6SNRNA: "RNU6-1", RNU6: "RNU6-1", RNU61: "RNU6-1", RNU6B: "RNU6-2", RNU62: "RNU6-2",
  RNU44: "SNORD44", U44: "SNORD44", RNU48: "SNORD48", U48: "SNORD48", RNU43: "SNORD43", U43: "SNORD43", U47: "SNORD47", RNU47: "SNORD47",
  RNU24: "SNORD24", U24: "SNORD24", U1: "RNU1-1", U2: "RNU2-1", "7SK": "RN7SK", "7SL": "RN7SL1",
  TNFA: "TNF", TNFALPHA: "TNF", IL1BETA: "IL1B", IL1A: "IL1A", IL1ALPHA: "IL1A", IFNGAMMA: "IFNG", IFNG: "IFNG", IFNBETA: "IFNB1", IFNB: "IFNB1",
  IFNALPHA: "IFNA1", TGFBETA: "TGFB1", TGFBETA1: "TGFB1", TGFB: "TGFB1", P53: "TP53", P21: "CDKN1A", P16: "CDKN2A", P27: "CDKN1B",
  COX2: "PTGS2", COX1: "PTGS1", VEGF: "VEGFA", HER2: "ERBB2", NEU: "ERBB2", PDL1: "CD274", PD1: "PDCD1", ECADHERIN: "CDH1", NCADHERIN: "CDH2",
  VIMENTIN: "VIM", OCT4: "POU5F1", OCT34: "POU5F1", KI67: "MKI67", BCL2: "BCL2", CMYC: "MYC", NFKB: "NFKB1", HIF1A: "HIF1A", HIF1ALPHA: "HIF1A",
  ANRIL: "CDKN2B-AS1", LINCP21: "TP53COR1", NRF2: "NFE2L2", PGC1A: "PPARGC1A", PGC1ALPHA: "PPARGC1A", SMA: "ACTA2", ASMA: "ACTA2", ALPHASMA: "ACTA2",
  GLUT1: "SLC2A1", GLUT4: "SLC2A4", INSULIN: "INS", COL1: "COL1A1", ALBUMIN: "ALB", AFP: "AFP", TERT: "TERT",
};
const LNC_NAMES = new Set(["MALAT1", "NEAT1", "XIST", "TSIX", "HOTAIR", "HOTTIP", "H19", "MEG3", "GAS5", "PVT1", "TUG1", "KCNQ1OT1", "HULC", "UCA1",
  "CRNDE", "DANCR", "FTX", "JPX", "NORAD", "PCAT1", "PCA3", "MIAT", "FENDRR", "CCAT1", "CCAT2", "HOXA-AS2", "SPRY4-IT1", "ZFAS1", "LINC-ROR",
  "MIR17HG", "MIR22HG", "MIR155HG", "TP53COR1", "CASC2", "LUCAT1", "PANDAR", "THRIL", "MEG8"]);
// Words that mean the target isn't a gene transcript at all.
const OTHER_RE = /\b(g?dna|genomic|promoter|enhancer|intron(ic)?|intergenic|tss|chr\d+|alu|line-?1|e?gfp|yfp|rfp|mcherry|luc(iferase)?|renilla|sv40|wpre|cre|neo(mycin)?|puro|hygro|spike|ercc|igg|input|lambda|plasmid|vector|transgene|mycoplasma|16s)\b/i;

const compact = s => s.normalize("NFKD").replace(/β/g, "beta").replace(/α/g, "alpha").replace(/γ/g, "gamma").replace(/κ/g, "kappa")
  .replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const cap = s => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

// Pulls a species out of the name: hsa-/mmu-/rno- prefixes (miRBase) or TaqMan assay IDs (Hs…/Mm…/Rn…_g1).
function speciesHint(raw) {
  let m = /^(hsa|mmu|rno|cel)[-_]/i.exec(raw);
  if (m) return { species: { hsa: "human", mmu: "mouse", rno: "rat", cel: "other" }[m[1].toLowerCase()], source: `the “${m[1].toLowerCase()}-” prefix` };
  m = TAQMAN_RE.exec(raw);
  if (m) return { species: { Hs: "human", Mm: "mouse", Rn: "rat" }[m[1]], source: `the TaqMan assay ID ${m[0]}` };
  return null;
}
const TAQMAN_RE = /(?<![A-Za-z0-9])(Hs|Mm|Rn)\d{6,8}_[a-z]\d(?![A-Za-z0-9])/;
// Removes assay IDs, bracketed notes and primer-set suffixes that aren't part of the gene name.
function cleanName(raw) {
  return raw.replace(new RegExp(TAQMAN_RE.source, "g"), " ").replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/[\s_-]+(primers?|assay|set\s*\d*|pair\s*\d*|fwd|rev|f|r|qpcr|taqman|sybr)$/i, "").replace(/[\s_]+$/, "").replace(/^[\s_]+/, "").replace(/\s+/g, " ").trim();
}

// hsa-miR-21-5p, miR-21, mir21, miR-199a-1-3p, let-7a, hsa-let-7f-2 → { human: MIR21 / MIR199A1 / MIRLET7A, extra loci to try }
const MIR_RE = /^(?:(?:hsa|mmu|rno|cel|ath|dme)[-_])?(?:mi[rR]|MIR)-?(\d+)([a-zA-Z])?(?:-(\d+))?(?:-(?:5p|3p))?\*?$/;
const LET_RE = /^(?:(?:hsa|mmu|rno|cel)[-_])?(?:let|LET)-?7([a-zA-Z])?(?:-(\d+))?(?:-(?:5p|3p))?\*?$/;
function mirSymbol(name, species) {
  const mouse = species === "mouse" || species === "rat";
  let m = MIR_RE.exec(name);
  const mature = /^(?:[a-z]{3}[-_])?miR|-[35]p\*?$/.test(name);
  if (m) {
    const [, n, letter = "", locus] = m, L = letter.toUpperCase();
    if (mouse) {
      const base = `Mir${n}${letter.toLowerCase()}`;
      return { symbol: locus ? `${base}-${locus}` : base, extra: locus ? [] : [`${base}-1`], mature };
    }
    const base = `MIR${n}${L}`;
    const withLocus = l => (L ? `${base}${l}` : `${base}-${l}`);
    return { symbol: locus ? withLocus(locus) : base, extra: locus ? [] : [withLocus(1)], mature };
  }
  m = LET_RE.exec(name);
  if (m) {
    const [, letter = "", locus] = m;
    if (mouse) { const base = `Mirlet7${letter.toLowerCase()}`; return { symbol: locus ? `${base}-${locus}` : base, extra: locus ? [] : [`${base}-1`], mature: true }; }
    const base = `MIRLET7${letter.toUpperCase()}`;
    return { symbol: locus ? `${base}${locus}` : base, extra: locus ? [] : [`${base}1`], mature: true };
  }
  return null;
}

// Is this written the way HGNC (human) or MGI/RGD (mouse, rat) write symbols? Returns { ok, reason }.
export function checkSymbol(symbol, species = "human") {
  const s = String(symbol ?? "");
  if (!s) return { ok: false, reason: "No symbol given." };
  if (s.length > 30) return { ok: false, reason: "Too long for a gene symbol." };
  if (/\s/.test(s)) return { ok: false, reason: "Gene symbols have no spaces." };
  if (/[^A-Za-z0-9-.]/.test(s)) return { ok: false, reason: "Gene symbols use only letters, digits and hyphens (no Greek letters or brackets)." };
  if (/^-|-$|--/.test(s)) return { ok: false, reason: "A hyphen can't start or end a symbol." };
  if (species === "human") {
    if (/^C(\d{1,2}|X|Y)orf\d+$/.test(s)) return { ok: true, reason: "" };
    if (/[a-z]/.test(s)) return { ok: false, reason: `Human (HGNC) symbols are upper case: ${s.toUpperCase()}, not ${s}.` };
    if (!/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/.test(s)) return { ok: false, reason: "HGNC symbols start with a letter and use upper-case letters, digits and hyphens." };
    return { ok: true, reason: "" };
  }
  if (species === "mouse" || species === "rat") {
    if (/^[A-Z0-9]{2,}$/.test(s) && /[A-Z].*[A-Z]/.test(s) && !/^[A-Z]\d*$/.test(s))
      return { ok: false, reason: `${SPECIES_LABEL[species]} symbols start with a capital and continue in lower case (${cap(s)}), unlike human ones.` };
    return { ok: true, reason: "" };
  }
  return { ok: true, reason: "" };
}

// Suggested symbol for a target name as written in the file. Doesn't touch the network.
export function suggestSymbol(raw, species = "human") {
  const name = cleanName(String(raw ?? "").trim());
  if (!name) return { symbol: "", extra: [], note: "" };
  const mir = mirSymbol(name.replace(/\s+/g, ""), species);
  if (mir) return { symbol: mir.symbol, extra: mir.extra,
    note: mir.mature ? `${name} is the mature miRNA; ${mir.symbol} is the gene it's made from.${mir.extra.length ? ` If that symbol doesn't exist, the lookup also tries ${mir.extra[0]}, because some miRNAs come from more than one gene.` : ""}` : "" };
  const bare = name.replace(/^(hsa|mmu|rno)[-_]/i, "");
  const circ = /^circ(?:RNA)?[-_ ]?([A-Za-z][A-Za-z0-9-]+)$/i.exec(bare);
  if (circ && !/^hsa_circ_\d+$/i.test(name)) { const host = suggestSymbol(circ[1], species).symbol; return { symbol: host, extra: [], note: `circ${circ[1]} is a circular RNA; ${host} is its host gene, which is what the lookup describes.` }; }
  if (/^hsa_circ_\d+$/i.test(name)) return { symbol: "", extra: [], note: "circBase IDs aren't gene symbols, so there's nothing to look up." };
  const key = compact(bare);
  if (ALIASES[key]) {
    let sym = ALIASES[key];
    if (species === "mouse" || species === "rat") sym = { RNA18SN5: "Rn18s", RNA28SN5: "Rn28s1", "RNU6-1": "Rnu6", "RNU6-2": "Rnu6" }[sym] || cap(sym);
    return { symbol: sym, extra: [], note: sym === compact(bare) || sym === bare ? "" : `“${name}” is usually written ${sym}.` };
  }
  // "ACTB mRNA", "GAPDH promoter": the first word is the gene.
  let sym = bare.split(/\s+/)[0];
  if (species === "human") {
    if (!/^C(\d{1,2}|X|Y)orf\d+$/i.test(sym)) sym = sym.toUpperCase();
    else sym = sym.replace(/^c/, "C").replace(/ORF/i, "orf");
    // IL-6 → IL6, CD-4 → CD4; leave real hyphenated symbols (NKX2-1, HLA-A, MT-CO1, RNU6-1, *-AS1) alone.
    const h = /^([A-Z]{2,5})-(\d+[A-Z]?\d*)$/.exec(sym);
    if (h && !/^(MT|HLA|RNU\d|LINC|MIR)$/.test(h[1])) sym = h[1] + h[2];
  }
  return { symbol: sym, extra: [], note: "" };
}

// Best guess at the RNA type from the target name and the suggested symbol.
export function guessType(raw, symbol = "") {
  const name = cleanName(String(raw ?? "").trim()), s = String(symbol || "").toUpperCase(), n = name.toUpperCase();
  if (!name && !s) return "mRNA";
  if (/^(hsa_)?circ/i.test(name) || /circ[-_ ]?rna/i.test(name)) return "circRNA";
  if (!/HG$/i.test(s) && !/HG$/i.test(name) && (/^(?:[a-z]{3}[-_])?(mi[rR]|MIR)-?\d|^(?:[a-z]{3}[-_])?let-?7/i.test(name) || /^MIR(LET7|\d)/.test(s))) return "miRNA";
  if (/^MT-RNR/.test(s) || /^(RNA(18|28|45)S|RNA5-8S|RNA5S|RN(18|28)S|RN5-8S)/.test(s) || /^(18|28|5\.?8|45)S\b/.test(n)) return "rRNA";
  if (/^MT-T[A-Z]/.test(s)) return "other";
  if (/^(SNORD|SNORA|SCARNA|RNU\d|RN7SK|RNU[0-9A-Z]+ATAC)/.test(s) || /^(U\d{1,2}|RNU\d+|7SK)\b/i.test(name)) return "sncRNA";
  if (/^(LINC|LNC)\d/.test(s) || /-(AS|IT|OT)\d+$/.test(s) || /-DT$/.test(s) || /^SNHG\d+$/.test(s) || /^MIR\d+[A-Z]?HG$/.test(s) || LNC_NAMES.has(s) || /^LINC-|lncRNA/i.test(name)) return "lncRNA";
  if (OTHER_RE.test(name)) return "other";
  return "mRNA";
}

// Everything PlateCheck can say about a target name without the network.
export function analyzeTarget(raw) {
  const hint = speciesHint(String(raw ?? ""));
  const species = hint?.species || "human";
  const sug = suggestSymbol(raw, species);
  const type = guessType(raw, sug.symbol);
  const notes = [];
  if (sug.note) notes.push(sug.note);
  if (hint) notes.push(`Species ${SPECIES_LABEL[species].toLowerCase()}, from ${hint.source}.`);
  else {
    notes.push("No species in the name, so I'm assuming human.");
    const bare = cleanName(String(raw ?? ""));
    if (/^[A-Z][a-z][a-z0-9]*$/.test(bare) && bare.length > 2) notes.push(`“${bare}” is written like a mouse or rat symbol; change the species if that's what it is.`);
  }
  if (/^MT-/.test(sug.symbol)) notes.push("This is a mitochondrial gene.");
  if (species === "other" && /^cel[-_]miR/i.test(String(raw))) notes.push("cel-miR-39 and other C. elegans miRNAs are usually spike-in controls added before extraction.");
  const check = checkSymbol(sug.symbol, species === "other" ? "human" : species);
  return { name: String(raw ?? ""), symbol: sug.symbol, extra: sug.extra, type, species, speciesFrom: hint ? hint.source : "default", notes,
    valid: check.ok, reason: check.reason, gene: !isNonGene(raw) && !!sug.symbol };
}
// Names that clearly aren't a gene transcript (genomic regions, transgenes, spike-ins, IgG/input), so not looked up.
export function isNonGene(raw) {
  const name = cleanName(String(raw ?? ""));
  return OTHER_RE.test(name) || /^hsa_circ_\d+$/i.test(name);
}

// Short notes per RNA type, shown under the targets table and in nowhere else.
export const TYPE_NOTES = {
  mRNA: "Primers that span an exon–exon junction keep genomic DNA out of the signal; a no-RT control shows whether it got in anyway. Check that the reference genes stay stable across your conditions rather than assuming it.",
  miRNA: "A mature miRNA is about 22 nt, too short for ordinary primers, so the RT step defines the assay: a stem-loop RT primer per miRNA (as in TaqMan miRNA assays) or poly(A) tailing followed by an oligo-dT adaptor RT (one RT for all miRNAs). Write which one you used in the assay details. Normalise to small RNAs that go through the same RT, such as U6 (RNU6-1), RNU44 (SNORD44), RNU48 (SNORD48) or other SNORDs, or to a spike-in such as cel-miR-39 for serum and plasma, not to GAPDH or ACTB. Members of one family (let-7a/b/c, miR-200a/b/c) differ by a base or two and can cross-react. The gene symbol names the locus; some mature miRNAs come from more than one locus.",
  lncRNA: "Many lncRNAs are low in abundance and mostly nuclear (MALAT1, NEAT1, XIST), and many have few or no introns to span, so DNase treatment and a no-RT control for each lncRNA assay are the main way to tell RNA from genomic DNA. If you separate nuclear and cytoplasmic RNA, check the split with markers (MALAT1 or NEAT1 for nuclear, a cytoplasmic mRNA or mitochondrial transcript for cytoplasmic). Antisense (-AS1) and overlapping transcripts share sequence with another gene; strand-specific RT avoids measuring both.",
  circRNA: "Use divergent primers across the back-splice junction and check the product by sequencing. RNase R treatment should leave the circRNA and remove the linear host mRNA. A gene lookup here describes the host gene, not the circRNA.",
  sncRNA: "snoRNAs and snRNAs are mostly used as references for miRNA work, so they need the same RT method as the miRNAs they normalise. Their levels can change with tissue and treatment, so check their stability in your samples.",
  rRNA: "18S and 28S rRNA are very abundant (Ct often below 10), so they may need diluted cDNA to stay in the linear range. They have no poly(A) tail and are poorly represented in oligo-dT primed cDNA; use random primers. They are made by RNA polymerase I, not II, which makes them a weak reference for mRNA.",
  other: "Genomic DNA regions, ChIP or other enrichment targets, transgenes (GFP, luciferase) and spike-ins aren't looked up. Say what the target is in the assay details.",
};
export const MITO_NOTE = "Mitochondrial genes have no introns, and nuclear DNA carries copies of mitochondrial sequence (NUMTs), so DNase treatment and a no-RT control matter.";

// ---------------------------------------------------------------- stored annotations (exp.targets)
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
const FIELD_RE = { entrez: /^\d{1,12}$/, ensembl: /^ENS[A-Z]*G\d{6,15}(\.\d+)?$/, hgncId: /^(HGNC|MGI|RGD):\d{1,10}$/ };
// Sets a key safely even when a target is literally called "__proto__".
export function putTarget(targets, name, rec) {
  Object.defineProperty(targets, name, { value: rec, enumerable: true, writable: true, configurable: true });
  return targets;
}
// Keeps only well-formed per-target annotations; used by normalizeExperiment() in core.js.
export function cleanTargets(v) {
  const out = {};
  if (!isObj(v)) return out;
  for (const [name, t] of Object.entries(v).slice(0, 1000)) {
    if (!name || name.length > 200 || !isObj(t)) continue;
    const r = {};
    const sym = str(t.symbol, 40).trim();
    if (sym && !/[^A-Za-z0-9-.]/.test(sym)) r.symbol = sym;
    if (t.type in RNA_TYPE_LABEL) r.type = t.type;
    if (t.species in SPECIES_LABEL) r.species = t.species;
    for (const [k, re] of Object.entries(FIELD_RE)) if (typeof t[k] === "string" && re.test(t[k])) r[k] = t[k];
    for (const [k, max] of [["asked", 40], ["geneName", 300],["description", 600], ["dbType", 60], ["checkedAt", 40], ["confirmedBy", 120], ["confirmedAt", 40]]) { const s = str(t[k], max); if (s) r[k] = s; }
    if (t.source in SOURCES) r.source = t.source;
    if (["found", "alias", "not_found"].includes(t.status)) r.status = t.status;
    if (Object.keys(r).length) putTarget(out, name, r);
  }
  return out;
}
// One row per target in the run: the user's choices where they made them, otherwise the guess.
export function targetTable(exp, rows) {
  const names = [...new Set((rows || []).map(r => r.target).filter(t => typeof t === "string" && t.trim()))];
  const saved = isObj(exp?.targets) ? exp.targets : {};
  return names.map(name => {
    const g = analyzeTarget(name), s = Object.prototype.hasOwnProperty.call(saved, name) ? saved[name] : {};
    const symbol = s.symbol ?? g.symbol, species = s.species || g.species, type = s.type || g.type;
    const check = checkSymbol(symbol, species === "other" ? "human" : species);
    return { name, guess: g, saved: s, symbol, species, type, confirmed: !!s.confirmedBy, check,
      // Looked up only if it reads as a gene symbol of a supported species and isn't plainly a non-gene target.
      lookup: !!(check.ok && species !== "other" && sendable(symbol) && (g.gene || (s.symbol && s.symbol !== g.symbol))) };
  });
}

// ---------------------------------------------------------------- database lookup (network, opt-in)
const TYPE_FROM_DB = {
  "protein-coding": "mRNA", snoRNA: "sncRNA", snRNA: "sncRNA", scRNA: "sncRNA", rRNA: "rRNA", tRNA: "other", pseudo: "other",
  "gene with protein product": "mRNA", "RNA, micro": "miRNA", "RNA, long non-coding": "lncRNA", "RNA, small nucleolar": "sncRNA",
  "RNA, small nuclear": "sncRNA", "RNA, ribosomal": "rRNA", "RNA, transfer": "other", pseudogene: "other",
};
// Maps the database's own gene type to ours. NCBI calls miRNAs and lncRNAs both "ncRNA", so the symbol decides.
export function typeFromDb(dbType, symbol) {
  if (dbType === "ncRNA") return /^MIR(LET7|\d)/i.test(symbol) && !/HG$/i.test(symbol) ? "miRNA" : /^(SNOR|SCARNA|RNU)/i.test(symbol) ? "sncRNA" : "lncRNA";
  return TYPE_FROM_DB[dbType] || null;
}
// First sentence of a RefSeq summary, without the "[provided by RefSeq…]" tag.
export function firstSentence(text, max = 240) {
  const t = String(text || "").replace(/\s*\[provided by[^\]]*\]\.?/gi, "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const m = /^(.+?[.!?])(\s+[A-Z(]|$)/.exec(t);
  const s = m ? m[1] : t;
  return s.length > max ? s.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : s;
}
// RefSeq summaries shared by a whole gene family say nothing about this gene, so they're left out.
const BOILERPLATE = /^\s*(microRNAs \(miRNAs\) are short|45S ribosomal DNA|This gene encodes a small nucleolar RNA|Small nucleolar RNAs)/i;
// One line for a table: the gene name, then the first sentence of its summary when there is one.
export const describe = t => [t?.geneName, t?.description && t.description !== t.geneName ? t.description : ""].filter(Boolean).join(". ");
// Only symbols that look like symbols are ever sent.
export const sendable = s => typeof s === "string" && /^[A-Za-z0-9][A-Za-z0-9.-]{0,39}$/.test(s);
const MYGENE_FIELDS = "symbol,name,entrezgene,ensembl.gene,type_of_gene,summary,HGNC,MGI,RGD";

async function getJson(fetchFn, url, headers) {
  const signal = typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined;
  const r = await fetchFn(url, { headers, signal, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!r || !r.ok) throw new Error(`the server answered ${r ? r.status : "nothing"}`);
  return r.json();
}
function fromMyGene(hit, species, now) {
  const ens = [hit.ensembl].flat().map(e => e?.gene).filter(Boolean);
  const want = { human: "ENSG", mouse: "ENSMUSG", rat: "ENSRNOG" }[species];
  const id = hit.HGNC ? `HGNC:${hit.HGNC}` : typeof hit.MGI === "string" ? hit.MGI : hit.RGD ? `RGD:${hit.RGD}` : "";
  return { symbol: String(hit.symbol || ""), geneName: String(hit.name || ""), description: BOILERPLATE.test(hit.summary || "") ? "" : firstSentence(hit.summary),
    entrez: hit.entrezgene != null ? String(hit.entrezgene) : "", ensembl: ens.find(e => e.startsWith(want + "0")) || ens[0] || "", hgncId: id,
    dbType: String(hit.type_of_gene || ""), type: typeFromDb(hit.type_of_gene, hit.symbol || ""), source: "MyGene.info", checkedAt: now };
}
function fromHgnc(doc, now) {
  return { symbol: String(doc.symbol || ""), geneName: String(doc.name || ""), description: "",
    entrez: doc.entrez_id ? String(doc.entrez_id) : "", ensembl: doc.ensembl_gene_id ? String(doc.ensembl_gene_id) : "", hgncId: String(doc.hgnc_id || ""),
    dbType: String(doc.locus_type || ""), type: typeFromDb(doc.locus_type, doc.symbol || ""), source: "HGNC", checkedAt: now };
}

// Looks one symbol up. Tries MyGene.info (symbol, then the extra loci, then aliases); if MyGene.info can't be
// reached and the gene is human, asks HGNC instead. Never throws: returns { status: "found" | "alias" |
// "not_found" | "error", ... }. `fetch` is passed in so the tests (and the monkey test) never touch the network.
export async function lookupGene(symbol, { species = "human", extra = [], fetch: fetchFn = globalThis.fetch, now = new Date().toISOString() } = {}) {
  if (!sendable(symbol)) return { status: "error", error: "That isn't a gene symbol, so I didn't send it." };
  if (!SPECIES_LABEL[species] || species === "other") return { status: "error", error: "Lookup works for human, mouse and rat genes only." };
  if (typeof fetchFn !== "function") return { status: "error", error: "This browser can't make the request." };
  const cands = [symbol, ...extra.filter(sendable)];
  const mg = (q, size = 3) => getJson(fetchFn, `https://mygene.info/v3/query?q=${encodeURIComponent(q)}&species=${species}&fields=${MYGENE_FIELDS}&size=${size}`);
  let myGeneError = null;
  try {
    for (const c of cands) {
      const d = await mg(`symbol:${c}`);
      const hit = (d?.hits || []).find(x => String(x.symbol).toLowerCase() === c.toLowerCase()) || null;
      if (hit) return { status: "found", ...fromMyGene(hit, species, now) };
    }
    const d = await mg(`alias:${symbol}`, 5), hits = d?.hits || [];
    if (hits.length) return { status: "alias", ...fromMyGene(hits[0], species, now), others: hits.slice(1).map(x => String(x.symbol)), asked: symbol };
    return { status: "not_found", source: "MyGene.info", checkedAt: now, asked: symbol };
  } catch (e) { myGeneError = e; }
  if (species !== "human") return { status: "error", error: `MyGene.info couldn't be reached (${myGeneError.message}).` };
  try {
    const hg = (field, v) => getJson(fetchFn, `https://rest.genenames.org/fetch/${field}/${encodeURIComponent(v)}`, { Accept: "application/json" });
    for (const c of cands) {
      const doc = (await hg("symbol", c))?.response?.docs?.[0];
      if (doc) return { status: "found", ...fromHgnc(doc, now) };
    }
    for (const field of ["prev_symbol", "alias_symbol"]) {
      const docs = (await hg(field, symbol))?.response?.docs || [];
      if (docs.length) return { status: "alias", ...fromHgnc(docs[0], now), others: docs.slice(1).map(x => String(x.symbol)), asked: symbol };
    }
    return { status: "not_found", source: "HGNC", checkedAt: now, asked: symbol };
  } catch (e) {
    return { status: "error", error: `Neither MyGene.info nor HGNC could be reached (${myGeneError.message}; ${e.message}). Check your connection and try again.` };
  }
}

// ---------------------------------------------------------------- report section
// HTML for the "Targets" section of the report. esc() and table() come from report.js so the look matches.
export function targetsReportHtml(exp, res, { esc, table }) {
  const rows = targetTable(exp, res?.rows);
  if (!rows.length) return "";
  const ids = r => [r.saved.entrez && `Entrez ${r.saved.entrez}`, r.saved.ensembl, r.saved.hgncId].filter(Boolean).join(", ");
  const typeCell = r => RNA_TYPE_LABEL[r.type] + (r.confirmed ? "" : r.saved.type && r.saved.source ? ` (from ${r.saved.source})` : " (guessed from name)");
  const symCell = r => (r.symbol || "—") + (r.saved.status === "not_found" ? " (not found)" : r.saved.symbol ? "" : " (suggested)");
  const desc = r => describe(r.saved);
  const sources = new Map();
  for (const r of rows) if (r.saved.source && r.saved.checkedAt) {
    const k = r.saved.source, d = r.saved.checkedAt.slice(0, 10);
    if (!sources.has(k)) sources.set(k, new Set());
    sources.get(k).add(d);
  }
  const from = [...sources].map(([k, ds]) => `${k} (${SOURCES[k]}) on ${[...ds].sort().join(", ")}`);
  const confirmed = rows.filter(r => r.confirmed).length;
  return `<h2>Targets</h2>
${table(["Target in file", "RNA type", "Gene symbol", "Species", "IDs", "Description"], rows.map(r => [r.name, typeCell(r), symCell(r), SPECIES_LABEL[r.species], ids(r), desc(r)]))}
<p class="sub small">${esc(`${confirmed} of ${rows.length} targets confirmed by the user. `)}${from.length ? esc(`Gene IDs and descriptions from ${from.join("; ")}. Only gene symbols were sent.`) : esc("No gene database was queried for this run.")}</p>`;
}
