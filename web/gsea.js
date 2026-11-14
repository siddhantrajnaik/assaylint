// Gene set enrichment for qPCR panels: preranked GSEA (Subramanian et al. 2005) and a competitive rank test
// (Wilcoxon rank-sum of a set's genes against the rest of the panel, as limma's geneSetTest/wilcoxGST).
// Pure functions with no DOM access. Method, guards and their reasons are in docs/analysis.md ("Gene set enrichment").
//
// A qPCR panel is a gene list somebody already picked, so every result here is relative to the panel: the
// universe is the genes on the plate, never the genome.
import * as S from "./stats.js";
import { toCsv } from "./core.js";
import { targetTable } from "./genes.js";

export const MIN_GENES = 15; // fewer ranked genes than this and I refuse (see enrichment())
export const AUTO_GSEA_FROM = 50; // "auto" uses the rank test below this many ranked genes and GSEA from here on
export const DEFAULT_MIN_SIZE = 3;
export const DEFAULT_NPERM = 1000;
export const METHODS = { auto: "Automatic (by panel size)", rank: "Rank test (Wilcoxon, set vs rest of panel)", gsea: "GSEA (preranked, gene-set permutation)" };
export const STATS = { logp: "signed −log10 p", t: "t statistic" };
const fin = x => typeof x === "number" && Number.isFinite(x);
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const list = (xs, n = 8) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));

// Seeded random numbers (mulberry32), so the same seed gives the same permutations and the same p values.
export function rng(seed = 1) {
  let a = (Math.floor(Math.abs(Number(seed))) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- ranking statistic from the Analysis step
// One value per target gene (references left out) for one comparison, group vs control. Positive = higher
// expression in the group. "logp": sign(log2 fold change) × −log10 p of the test chosen in the analysis.
// "t": the t statistic (only the t-tests and Dunnett have one), with its sign turned round, because the tests run
// on ΔCt and a higher ΔCt means lower expression.
export function rankingFromAnalysis(a, { group = "", stat = "logp" } = {}) {
  const comps = (a?.summary || []).filter(r => !r.isControl);
  const groups = [...new Set(comps.map(r => r.group))];
  const g = groups.includes(group) ? group : groups[0] || "";
  const rows = comps.filter(r => r.group === g), notes = [];
  let use = stat === "t" ? "t" : "logp";
  if (use === "t" && !rows.some(r => fin(r.t))) {
    use = "logp";
    notes.push("The test chosen in the analysis has no t statistic, so the genes were ranked by signed −log10 p instead.");
  }
  const genes = [], dropped = [];
  for (const r of rows) {
    const v = use === "t" ? (fin(r.t) ? -r.t : null)
      : fin(r.p) && fin(r.log2fc) ? Math.sign(r.log2fc) * -Math.log10(Math.max(r.p, 1e-300)) : null;
    if (v === null) dropped.push(r.target); else genes.push({ gene: r.target, value: v, p: r.p, log2fc: r.log2fc });
  }
  genes.sort((x, y) => y.value - x.value || byName(x.gene, y.gene));
  if (dropped.length) notes.push(`Left out of the ranking because they have no ${use === "t" ? "t statistic" : "p value"} for ${g} vs ${a?.control}: ${list(dropped)}.`);
  return { group: g, groups, control: a?.control || "", stat: use, statLabel: STATS[use], genes, dropped, notes };
}

// ---------------------------------------------------------------- gene sets
// GMT: one set per line, tab-separated: name, description, then genes. Tolerates a byte-order mark, Windows or
// old Mac line ends, comment lines, blank lines, an empty description, and Enrichr's old "GENE,1.0" weights.
export function parseGmt(text) {
  if (typeof text !== "string" || !text.trim()) return { sets: [], skipped: 0, error: "The file is empty." };
  const sets = [], names = new Map();
  let skipped = 0;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    if (!raw.trim() || raw.startsWith("#")) continue;
    const cells = raw.split("\t");
    const name = (cells[0] || "").trim().slice(0, 200);
    const genes = [...new Set(cells.slice(2).map(c => c.split(",")[0].trim()).filter(c => c && c.length <= 60 && !/\s/.test(c)))];
    if (cells.length < 3 || !name || !genes.length) { skipped++; continue; }
    const n = (names.get(name) || 0) + 1;
    names.set(name, n);
    sets.push({ name: n > 1 ? `${name} (${n})` : name, genes });
    if (sets.length >= 100000) break;
  }
  if (!sets.length) return { sets, skipped, error: "No gene sets found. A GMT file has one set per line: the set name, a description and the genes, separated by tabs." };
  return { sets, skipped };
}
// Genes pasted by hand: commas, semicolons, spaces, tabs or new lines between them.
export const splitGenes = text => [...new Set(String(text || "").split(/[\s,;]+/).map(g => g.trim()).filter(g => g && g.length <= 60))];

// The panel as gene set matching needs it: target name, symbol (the user's or the guess), species and GO terms.
export function panelFromRun(exp, rows) {
  return targetTable(exp, rows).map(r => ({ target: r.name, symbol: r.symbol || "", species: r.species, go: Array.isArray(r.saved.go) ? r.saved.go : [] }));
}
// Maps the genes of each set onto panel targets, by symbol or target name. Case-insensitive (ACTB, Actb and actb
// match), except for the fly, where FlyBase symbols differ by case only (dl is dorsal, Dl was Delta).
export function matchSets(sets, panel) {
  const exact = new Map(), lower = new Map();
  for (const p of panel || []) for (const k of [p.symbol, p.target].filter(Boolean)) {
    if (p.species === "fly") { if (!exact.has(k)) exact.set(k, p.target); }
    else if (!lower.has(k.toLowerCase())) lower.set(k.toLowerCase(), p.target);
  }
  const find = g => exact.get(g) ?? lower.get(g.toLowerCase()) ?? null;
  const used = new Set(), off = new Set(), out = [];
  for (const s of sets || []) {
    const genes = [];
    for (const g of s.genes) { const t = find(g); if (t === null) off.add(g.toUpperCase()); else if (!genes.includes(t)) { genes.push(t); used.add(t); } }
    out.push({ name: s.name, genes, total: s.total ?? s.genes.length });
  }
  return { sets: out, unusedPanel: (panel || []).map(p => p.target).filter(t => !used.has(t)), offPanel: off.size };
}
// Sets from the GO biological-process terms the gene lookup returned: panel genes that share a term.
export function goSets(panel) {
  const by = new Map();
  for (const p of panel || []) for (const term of p.go || []) { if (!by.has(term)) by.set(term, new Set()); by.get(term).add(p.target); }
  return [...by].map(([name, s]) => ({ name, genes: [...s], total: s.size }));
}
// Sets that hold exactly the same panel genes are one test, not several: GO parents and children often do.
export function collapseIdentical(sets) {
  const by = new Map();
  for (const s of sets) {
    const key = [...s.genes].sort(byName).join("\u0000");
    if (!by.has(key)) by.set(key, { ...s, also: [] }); else by.get(key).also.push(s.name);
  }
  return [...by.values()];
}

// ---------------------------------------------------------------- enrichment score
// Running sum of Subramanian et al. (2005) with weight p: walking down the ranked list, a set gene adds
// |r|^p / N_R (N_R = sum of |r|^p over the set), any other gene subtracts 1 / (N − N_H). ES is the largest
// deviation from zero (the maximum when |max| > |min|, otherwise the minimum, as gseapy). values must be
// sorted from high to low; hits are the 0-based positions of the set's genes, ascending.
export function runningSum(values, hits, weight = 1) {
  const N = values.length, k = hits.length;
  if (!k || k >= N) return null;
  const isHit = new Uint8Array(N);
  let NR = 0;
  for (const i of hits) { isHit[i] = 1; NR += Math.abs(values[i]) ** weight; }
  if (!(NR > 0)) return null;
  const miss = 1 / (N - k), curve = new Array(N);
  let run = 0, mx = -Infinity, mn = Infinity, imx = 0, imn = 0;
  for (let i = 0; i < N; i++) {
    run += isHit[i] ? Math.abs(values[i]) ** weight / NR : -miss;
    curve[i] = run;
    if (run > mx) { mx = run; imx = i; }
    if (run < mn) { mn = run; imn = i; }
  }
  const es = Math.abs(mx) > Math.abs(mn) ? mx : mn, peak = es === mx ? imx : imn;
  return { curve, es, peak, leading: hits.filter(i => (es >= 0 ? i <= peak : i >= peak)) };
}
// The same ES from the hit positions alone, O(k): the running sum peaks just after a hit and dips just before one
// (or at the end). Used for the permutations, where the curve itself isn't needed.
function fastEs(absv, pos, N) {
  const k = pos.length, d = 1 / (N - k);
  let NR = 0;
  for (let i = 0; i < k; i++) NR += absv[pos[i]];
  if (!(NR > 0)) return null;
  let cum = 0, mx = -Infinity, mn = Infinity;
  for (let i = 0; i < k; i++) {
    if (pos[i] > 0) { const before = cum - (pos[i] - i) * d; if (before < mn) mn = before; }
    cum += absv[pos[i]] / NR;
    const after = cum - (pos[i] + 1 - (i + 1)) * d;
    if (after > mx) mx = after;
    if (after < mn) mn = after;
  }
  const end = cum - (N - k) * d;
  if (end > mx) mx = end;
  if (end < mn) mn = end;
  return Math.abs(mx) > Math.abs(mn) ? mx : mn;
}
export const esFromPositions = (values, pos, weight = 1) => fastEs(values.map(v => Math.abs(v) ** weight), pos, values.length);

const lowerBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; };
const upperBound = (a, x) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; };

// Preranked GSEA with gene-set permutation. ranked: [{ gene, value }] sorted high to low; sets: [{ name, genes }]
// with every gene in ranked. For each set, nperm random sets of the same size are drawn from the panel.
// NES = ES / mean of the permutation ES of the same sign; p = share of same-sign permutation ES at least as
// extreme; FDR q as in GSEA (and gseapy): the share of all permutation NES at least as extreme as this NES among
// those of the same sign, divided by the same share among the observed NES. q is capped at 1.
export function gseaPreranked(ranked, sets, { nperm = DEFAULT_NPERM, seed = 1, weight = 1 } = {}) {
  const N = ranked.length, values = ranked.map(r => r.value), absv = values.map(v => Math.abs(v) ** weight);
  const at = new Map(ranked.map((r, i) => [r.gene, i])), rand = rng(seed), idx = Int32Array.from({ length: N }, (_, i) => i);
  const rows = sets.map(s => {
    const hits = s.genes.map(g => at.get(g)).sort((a, b) => a - b), rs = runningSum(values, hits, weight);
    const nulls = new Float64Array(nperm);
    let nn = 0;
    if (rs) for (let b = 0; b < nperm; b++) {
      for (let i = 0; i < hits.length; i++) { const j = i + Math.floor(rand() * (N - i)), t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      const e = fastEs(absv, Array.from(idx.subarray(0, hits.length)).sort((a, b) => a - b), N);
      if (e !== null) nulls[nn++] = e;
    }
    const nul = nulls.subarray(0, nn);
    let pos = 0, neg = 0, sp = 0, sn = 0;
    for (const e of nul) if (e >= 0) { pos++; sp += e; } else { neg++; sn += e; }
    const mp = pos ? sp / pos : null, mnn = neg ? sn / neg : null;
    let p = null, nes = null;
    if (rs) {
      if (rs.es >= 0) { if (pos) { let c = 0; for (const e of nul) if (e >= rs.es) c++; p = c / pos; } if (mp) nes = rs.es / mp; }
      else { if (neg) { let c = 0; for (const e of nul) if (e < rs.es) c++; p = c / neg; } if (mnn) nes = -rs.es / mnn; }
    }
    const nullNes = mp === null && mnn === null ? [] : Array.from(nul, e => (e >= 0 ? (mp ? e / mp : NaN) : (mnn ? -e / mnn : NaN))).filter(fin);
    return { name: s.name, es: rs ? rs.es : null, nes, p, nperm: nn, nullNes };
  });
  const nvals = rows.flatMap(r => r.nullNes).sort((a, b) => a - b), nnes = rows.map(r => r.nes).filter(fin).sort((a, b) => a - b);
  for (const r of rows) {
    if (!fin(r.nes)) { r.fdr = null; continue; }
    let f;
    if (r.nes >= 0) {
      const allPos = nvals.length - lowerBound(nvals, 0), allHi = nvals.length - lowerBound(nvals, r.nes);
      const obsPos = nnes.length - lowerBound(nnes, 0), obsHi = nnes.length - lowerBound(nnes, r.nes);
      f = allPos && obsPos && obsHi ? (allHi / allPos) / (obsHi / obsPos) : 1;
    } else {
      const allNeg = lowerBound(nvals, 0), allLo = upperBound(nvals, r.nes), obsNeg = lowerBound(nnes, 0), obsLo = upperBound(nnes, r.nes);
      f = allNeg && obsNeg && obsLo ? (allLo / allNeg) / (obsLo / obsNeg) : 1;
    }
    r.fdr = Math.min(1, f);
  }
  for (const r of rows) delete r.nullNes;
  return rows;
}

// Competitive rank test: Wilcoxon rank-sum (Mann–Whitney) of the set's ranking statistics against those of the
// other panel genes, two-sided, exactly as scipy.stats.mannwhitneyu(method="auto") (stats.js). AUC = U / (n_set ·
// n_rest), the chance that a set gene ranks above a gene outside the set: 0.5 is no shift, above 0.5 is up.
export function rankTest(ranked, sets) {
  return sets.map(s => {
    const inSet = new Set(s.genes), a = [], b = [];
    for (const r of ranked) (inSet.has(r.gene) ? a : b).push(r.value);
    const m = S.mannWhitney(a, b);
    return { name: s.name, U: m.U, auc: fin(m.U) ? m.U / (a.length * b.length) : null, p: m.p, test: m.method, meanStat: S.mean(a) };
  });
}

// ---------------------------------------------------------------- the whole thing, with the guards
// ranking: from rankingFromAnalysis(). sets: [{ name, genes (panel targets), total?, also? }].
export function enrichment(ranking, sets, opts = {}) {
  const genes = ranking?.genes || [], N = genes.length;
  const o = { method: "auto", minSize: DEFAULT_MIN_SIZE, maxSize: 0, nperm: DEFAULT_NPERM, seed: 1, ...opts };
  const out = { ok: false, N, method: null, methodChosen: o.method, rows: [], dropped: { small: [], large: [] }, notes: [...(ranking?.notes || [])],
    group: ranking?.group, control: ranking?.control, stat: ranking?.stat, statLabel: ranking?.statLabel, ranked: genes };
  if (N < MIN_GENES) {
    out.reason = `Only ${N} gene${N === 1 ? "" : "s"} could be ranked, and I need at least ${MIN_GENES}. With so few genes a set of 3 is a fifth of the panel or more, the rank test has almost no resolution and permutations repeat the same few sets, so any "enriched" pathway would be a handful of genes you can read straight off the results table.`;
    return out;
  }
  const minSize = Math.max(2, Math.floor(o.minSize) || DEFAULT_MIN_SIZE);
  const maxSize = Math.min(N - 1, o.maxSize > 0 ? Math.floor(o.maxSize) : N - 3);
  out.minSize = minSize; out.maxSize = maxSize;
  const ranked = new Set(genes.map(g => g.gene)), keep = [];
  for (const s of sets || []) {
    const g = s.genes.filter(x => ranked.has(x));
    if (g.length < minSize) out.dropped.small.push(s.name);
    else if (g.length > maxSize) out.dropped.large.push(s.name);
    else keep.push({ ...s, genes: g });
  }
  if (out.dropped.large.length) out.notes.push(`Left out ${out.dropped.large.length} set(s) with more than ${maxSize} of the ${N} ranked genes (${list(out.dropped.large, 4)}). A set that covers almost the whole panel is compared with the two or three genes left over, which says nothing about the set.`);
  if (out.dropped.small.length) out.notes.push(`Left out ${out.dropped.small.length} set(s) with fewer than ${minSize} genes on the panel.`);
  if (!keep.length) { out.reason = `No gene set has between ${minSize} and ${maxSize} genes among the ${N} ranked genes on this panel.`; return out; }
  out.method = o.method === "rank" || o.method === "gsea" ? o.method : N < AUTO_GSEA_FROM ? "rank" : "gsea";
  out.notes.push(`The universe is this panel: the ${N} genes that were measured and ranked. A qPCR panel is a gene list somebody already chose, so "enriched" here means the set's genes moved more than the other genes on the panel, not more than the genome.`);
  if (o.method === "auto") out.notes.push(out.method === "rank" ? `With ${N} genes (fewer than ${AUTO_GSEA_FROM}) I used the rank test. Permutation GSEA draws random sets from the same few genes again and again, so its p values and NES are coarse and unstable on a panel this small.`
    : `With ${N} genes (${AUTO_GSEA_FROM} or more) I used preranked GSEA with ${o.nperm} gene-set permutations.`);
  else if (out.method === "gsea" && N < AUTO_GSEA_FROM) out.notes.push(`You chose GSEA with only ${N} genes. Random sets are drawn from the same small panel, so the p values move with the seed and the NES is rough. Read the rank test p (also in the CSV) next to it.`);
  out.notes.push("Both tests are competitive: they ask whether a set's genes stand out from the rest of the panel, treating genes as independent. Genes in one pathway are usually correlated, which makes such tests too optimistic (Wu & Smyth 2012); on a panel built around a few pathways this matters more, so treat small p values as leads to check, not proof.");
  const values = genes.map(g => g.value), pos = new Map(genes.map((g, i) => [g.gene, i]));
  const rt = rankTest(genes, keep), gs = out.method === "gsea" ? gseaPreranked(genes, keep, { nperm: o.nperm, seed: o.seed }) : null;
  out.rows = keep.map((s, i) => {
    const hits = s.genes.map(g => pos.get(g)).sort((a, b) => a - b), rs = runningSum(values, hits);
    const r = { name: s.name, also: s.also || [], size: s.genes.length, total: s.total ?? s.genes.length, genes: hits.map(h => genes[h].gene),
      es: rs ? rs.es : null, leading: rs ? rs.leading.map(h => genes[h].gene) : [], auc: rt[i].auc, U: rt[i].U, pRank: rt[i].p, rankMethod: rt[i].test, meanStat: rt[i].meanStat };
    if (gs) Object.assign(r, { nes: gs[i].nes, pGsea: gs[i].p, fdr: gs[i].fdr, nperm: gs[i].nperm });
    r.p = gs ? r.pGsea : r.pRank;
    r.direction = (gs ? r.es : r.auc - 0.5) > 0 ? "up" : (gs ? r.es : r.auc - 0.5) < 0 ? "down" : "";
    return r;
  });
  const bh = S.benjaminiHochberg(out.rows.map(r => r.p)), bhRank = S.benjaminiHochberg(out.rows.map(r => r.pRank));
  out.rows.forEach((r, i) => { r.pBH = bh[i]; r.pRankBH = bhRank[i]; r.q = gs ? r.fdr : r.pBH; });
  out.rows.sort((a, b) => (a.p ?? 2) - (b.p ?? 2) || Math.abs(b.es ?? 0) - Math.abs(a.es ?? 0) || byName(a.name, b.name));
  if (gs) {
    const coarse = out.rows.filter(r => r.size && lchoose(N, r.size) < Math.log(o.nperm));
    if (coarse.length) out.notes.push(`For ${list(coarse.map(r => r.name), 3)} there are fewer distinct random sets than permutations, so many permutations repeat and the p value can't get much finer.`);
    if (out.rows.length < 10) out.notes.push(`Only ${out.rows.length} set(s) were tested. The GSEA FDR q compares each set with the others, so with this few sets it is rough; the BH-adjusted p is in the CSV too.`);
    if (out.rows.some(r => r.p === 0)) out.notes.push(`A p value of 0 means no permutation reached the observed ES: p < 1/${o.nperm}.`);
  }
  out.nperm = gs ? o.nperm : 0; out.seed = o.seed; out.ok = true;
  return out;
}
const lchoose = (n, k) => S.lgamma(n + 1) - S.lgamma(k + 1) - S.lgamma(n - k + 1);

// Which sets the settings point at, matched to the panel. g: the gsea block of the analysis settings (core.js).
export function setsFromSettings(g, panel) {
  const info = { source: g?.source || "", unusedPanel: [], offPanel: 0, collapsed: 0, raw: 0 };
  let raw = [];
  if (info.source === "gmt") raw = (g.gmt?.sets || []).map(s => ({ name: s.name, genes: s.genes, total: s.total }));
  else if (info.source === "custom") raw = (g.custom || []).map(s => ({ name: s.name, genes: s.genes }));
  else if (info.source === "go") raw = goSets(panel);
  else return { sets: [], info };
  const m = matchSets(raw, panel);
  const nonEmpty = m.sets.filter(s => s.genes.length);
  const sets = collapseIdentical(nonEmpty);
  Object.assign(info, { raw: raw.length, unusedPanel: m.unusedPanel, offPanel: m.offPanel, collapsed: nonEmpty.length - sets.length, noneOnPanel: m.sets.length - nonEmpty.length });
  return { sets, info };
}
// Everything for one run: ranking, sets and enrichment, or a reason it can't run. a: analyzeRun() result.
export function gseaForRun(exp, res, a) {
  const g = exp?.analysis?.gsea;
  if (!g || !g.source) return { ok: false, reason: "Choose where the gene sets come from." };
  if (!a?.ok) return { ok: false, reason: "The analysis needs results first." };
  const panel = panelFromRun(exp, res?.rows || []);
  const ranking = rankingFromAnalysis(a, { group: g.group, stat: g.stat });
  const { sets, info } = setsFromSettings(g, panel);
  if (!sets.length) return { ok: false, info, ranking, reason: g.source === "go" ? "No GO terms yet. Tick “Use GO terms for gene sets” and press “Look up genes” (More, then Method details and thresholds, Targets panel)." : g.source === "gmt" ? (g.gmt ? "None of the sets in the GMT file has a gene on this panel." : "Upload a GMT file.") : "Add a gene set." };
  const r = enrichment(ranking, sets, { method: g.method, minSize: g.minSize, maxSize: g.maxSize, nperm: g.nperm, seed: g.seed });
  return { ...r, info, ranking, source: g.source };
}

// ---------------------------------------------------------------- CSV and report
const n6 = x => (fin(x) ? String(+x.toPrecision(8)) : "");
export function gseaCsv(r) {
  const head = ["gene_set", "same_genes_as", "genes_on_panel", "genes_in_set", "direction", "ES", "NES", "p_gsea", "fdr_q_gsea", "auc_rank_test", "p_rank_test", "p_rank_test_bh", "p_bh", "leading_edge", "genes"];
  return toCsv([head, ...(r.rows || []).map(x => [x.name, x.also.join(" | "), x.size, x.total, x.direction, n6(x.es), n6(x.nes), x.pGsea ?? "", x.fdr ?? "", n6(x.auc), x.pRank ?? "", x.pRankBH ?? "", x.pBH ?? "", x.leading.join(" "), x.genes.join(" ")]),
    [], ["method", r.method === "gsea" ? `preranked GSEA, weight 1, ${r.nperm} gene-set permutations, seed ${r.seed}` : "Wilcoxon rank-sum, set vs rest of panel"],
    ["ranking", `${r.statLabel}, ${r.group} vs ${r.control}`], ["universe", `${r.N} ranked genes on the panel`], [],
    ["rank", "gene", "ranking_statistic", "p", "log2_fold_change"], ...(r.ranked || []).map((g, i) => [i + 1, g.gene, n6(g.value), g.p ?? "", n6(g.log2fc)])]);
}
const fp = p => (!fin(p) ? "—" : p === 0 ? "0" : p < 1e-4 ? p.toExponential(1) : p < 0.001 ? p.toFixed(4) : p.toFixed(3));
export function methodText(r) {
  return `Gene set enrichment on ${r.N} panel genes ranked by ${r.statLabel} for ${r.group} vs ${r.control} (positive = higher in ${r.group}). ` +
    (r.method === "gsea" ? `Preranked GSEA (Subramanian et al. 2005): weighted running-sum enrichment score with weight 1, NES from the mean of same-sign permutation scores, p from ${r.nperm} gene-set permutations (seed ${r.seed}), FDR q as in GSEA. `
      : "Competitive rank test: Wilcoxon rank-sum of each set's ranking statistics against the rest of the panel, two-sided (as limma's geneSetTest), with Benjamini–Hochberg q across sets. ") +
    `Sets with fewer than ${r.minSize} or more than ${r.maxSize} ranked genes were left out. The universe is the panel, not the genome.`;
}
export function gseaReportHtml(r, esc) {
  if (!r) return "";
  if (!r.ok) return r.reason && r.info ? `<h3>Gene set enrichment</h3><p>${esc(r.reason)}</p>` : "";
  const f = x => (fin(x) ? x.toFixed(2) : "—");
  const body = r.rows.map(x => `<tr><td>${esc(x.name)}${x.also.length ? ` <small>(+${x.also.length} with the same genes)</small>` : ""}</td><td>${x.size}</td><td>${esc(x.direction)}</td><td>${r.method === "gsea" ? `${f(x.es)} / ${f(x.nes)}` : f(x.auc)}</td><td>${esc(fp(x.p))}</td><td>${esc(fp(x.q))}</td><td>${esc(x.leading.join(", "))}</td></tr>`).join("");
  return `<h3>Gene set enrichment</h3>
<p>${esc(methodText(r))}</p>
<table><thead><tr><th>Set</th><th>Genes</th><th>Direction</th><th>${r.method === "gsea" ? "ES / NES" : "AUC"}</th><th>p</th><th>${r.method === "gsea" ? "FDR q" : "q (BH)"}</th><th>Leading edge</th></tr></thead><tbody>${body}</tbody></table>
<ul>${r.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
}
export const REFERENCES = [
  ["Subramanian A, Tamayo P, Mootha VK, et al. (2005). Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. PNAS 102(43):15545–15550.", "10.1073/pnas.0506580102"],
  ["Ritchie ME, Phipson B, Wu D, et al. (2015). limma powers differential expression analyses for RNA-sequencing and microarray studies. Nucleic Acids Research 43(7):e47.", "10.1093/nar/gkv007"],
  ["Wu D, Smyth GK (2012). Camera: a competitive gene set test accounting for inter-gene correlation. Nucleic Acids Research 40(17):e133.", "10.1093/nar/gks461"],
];
