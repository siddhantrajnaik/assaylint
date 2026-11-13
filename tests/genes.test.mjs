import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as G from "../web/genes.js";
import * as C from "../web/core.js";
import { reportHtml, structuredJson } from "../web/report.js";

test("common target names get the official symbol", () => {
  const cases = {
    "b-actin": "ACTB", "beta actin": "ACTB", "β-actin": "ACTB", "B-Actin": "ACTB", "ACTB mRNA": "ACTB", "actb": "ACTB",
    "18S": "RNA18SN5", "18S rRNA": "RNA18SN5", "RN18S1": "RNA18SN5", "5.8S": "RNA5-8SN5",
    "U6": "RNU6-1", "U6 snRNA": "RNU6-1", "RNU6B": "RNU6-2", "RNU44": "SNORD44", "RNU48": "SNORD48",
    "HPRT": "HPRT1", "IL-6": "IL6", "IL-1β": "IL1B", "TNF-alpha": "TNF", "p53": "TP53", "COX-2": "PTGS2", "GAPDH": "GAPDH",
    "NKX2-1": "NKX2-1", "HLA-A": "HLA-A", "MT-CO1": "MT-CO1", "c1orf112": "C1orf112", "ANRIL": "CDKN2B-AS1",
    "ACTB_Hs01060665_g1": "ACTB", "GAPDH (Hs99999905_m1)": "GAPDH", "GAPDH primers": "GAPDH",
  };
  for (const [name, sym] of Object.entries(cases)) assert.equal(G.analyzeTarget(name).symbol, sym, name);
});

test("mature miRNA names map to the gene they come from", () => {
  const cases = {
    "hsa-miR-21-5p": ["MIR21", "MIR21-1"], "miR-21": ["MIR21", "MIR21-1"], "mir21": ["MIR21", "MIR21-1"], "MIR21": ["MIR21", "MIR21-1"],
    "hsa-miR-16-5p": ["MIR16", "MIR16-1"], "miR-155-3p": ["MIR155", "MIR155-1"], "hsa-miR-199a-3p": ["MIR199A", "MIR199A1"],
    "miR-199a-1": ["MIR199A1"], "let-7a": ["MIRLET7A", "MIRLET7A1"], "hsa-let-7f-2-3p": ["MIRLET7F2"],
    "mmu-miR-21a-5p": ["Mir21a", "Mir21a-1"], "mmu-let-7a": ["Mirlet7a", "Mirlet7a-1"],
  };
  for (const [name, [sym, extra]] of Object.entries(cases)) {
    const a = G.analyzeTarget(name);
    assert.equal(a.symbol, sym, name);
    assert.equal(a.type, "miRNA", name);
    if (extra) assert.equal(a.extra[0], extra, name);
  }
  assert.match(G.analyzeTarget("hsa-miR-21-5p").notes.join(" "), /mature miRNA/);
});

test("RNA type is guessed from real target names", () => {
  const cases = {
    mRNA: ["ACTB", "GAPDH", "TBP", "YWHAZ", "IL6", "MYC", "Gapdh", "HPRT1", "B2M", "MT-CO1", "MT-ND1", "NKX2-1", "CDKN1A", "EEF1A1", "HLA-DRB1"],
    miRNA: ["hsa-miR-21-5p", "miR-155", "MIR21", "let-7a", "hsa-let-7g-5p", "MIRLET7B", "mmu-miR-122-5p", "miR-200c-3p", "cel-miR-39"],
    lncRNA: ["MALAT1", "NEAT1", "XIST", "HOTAIR", "H19", "MEG3", "GAS5", "PVT1", "LINC00657", "LINC01234", "HOXA-AS2", "CDKN2B-AS1",
      "SNHG1", "SNHG16", "MIR17HG", "MIR155HG", "KCNQ1OT1", "SPRY4-IT1", "FOXF1-AS1", "lncRNA-ATB"],
    snoRNA: ["SNORD44", "SNORD48", "SNORA73A", "RNU6-1", "U6", "RNU44", "RNU48", "SCARNA2", "7SK"],
    rRNA: ["18S", "18S rRNA", "28S", "RNA18SN5", "RNA45SN1", "MT-RNR1", "MT-RNR2", "5.8S"],
    circRNA: ["circHIPK3", "hsa_circ_0001946", "circ-ITCH", "CDR1as circRNA"],
    other: ["GAPDH promoter", "EGFP", "GFP", "Luciferase", "IgG", "Input", "gDNA", "ALU", "MT-TL1", "ERCC-00130", "SV40", "Intergenic region"],
  };
  for (const [type, names] of Object.entries(cases)) for (const n of names)
    assert.equal(G.analyzeTarget(n).type, type === "snoRNA" ? "sncRNA" : type, n);
});

test("species comes from prefixes and TaqMan IDs; human is the stated default", () => {
  assert.equal(G.analyzeTarget("mmu-miR-21a-5p").species, "mouse");
  assert.equal(G.analyzeTarget("rno-miR-21-5p").species, "rat");
  assert.equal(G.analyzeTarget("Actb (Mm02619580_g1)").species, "mouse");
  assert.equal(G.analyzeTarget("Actb (Mm02619580_g1)").symbol, "Actb");
  assert.equal(G.analyzeTarget("cel-miR-39").species, "other");
  const a = G.analyzeTarget("ACTB");
  assert.equal(a.species, "human");
  assert.equal(a.speciesFrom, "default");
  assert.match(a.notes.join(" "), /assuming human/);
  assert.match(G.analyzeTarget("Gapdh").notes.join(" "), /mouse or rat/);
});

test("HGNC-style symbol check", () => {
  for (const s of ["ACTB", "MIR21", "RNU6-1", "NKX2-1", "HLA-A", "MT-CO1", "C1orf112", "CDKN2B-AS1", "RNA5-8SN5", "LINC00657"]) assert.ok(G.checkSymbol(s).ok, s);
  for (const s of ["Actb", "IL 6", "β-actin", "-ACTB", "ACTB-", "ACT--B", "", "A".repeat(31), "IL(6)", "1ABC"]) assert.ok(!G.checkSymbol(s).ok, s);
  assert.match(G.checkSymbol("Actb").reason, /upper case: ACTB/);
  assert.ok(G.checkSymbol("Actb", "mouse").ok);
  assert.ok(G.checkSymbol("Mir21a", "mouse").ok);
  assert.ok(!G.checkSymbol("ACTB", "mouse").ok);
  assert.ok(G.analyzeTarget("hsa_circ_0001946").gene === false);
  assert.ok(G.isNonGene("GFP") && G.isNonGene("GAPDH promoter") && !G.isNonGene("GAPDH"));
});

test("normalizeExperiment keeps and cleans per-target annotations", () => {
  const exp = C.normalizeExperiment({ id: "AL-x", targets: {
    ACTB: { symbol: "ACTB", type: "mRNA", species: "human", entrez: "60", ensembl: "ENSG00000075624", hgncId: "HGNC:132", geneName: "actin beta",
      description: "This gene encodes one of six different actin proteins.", source: "MyGene.info", status: "found", checkedAt: "2026-11-13T10:00:00Z", confirmedBy: "Siddhant", extra: "dropped" },
    "miR-21": { symbol: "MIR21", type: "miRNA", entrez: "60; DROP TABLE", ensembl: "<script>", hgncId: "HGNC:abc", source: "evil.example", status: "weird", species: "dog" },
    bad1: "not an object", bad2: null, bad3: [1, 2], bad4: { type: "protein" }, bad5: { symbol: "has space" },
    ["x".repeat(201)]: { symbol: "X" },
    long: { symbol: "LONG", description: "d".repeat(2000) },
  } });
  assert.deepEqual(Object.keys(exp.targets), ["ACTB", "miR-21", "long"]);
  assert.equal(exp.targets.ACTB.hgncId, "HGNC:132");
  assert.equal(exp.targets.ACTB.extra, undefined);
  assert.deepEqual(exp.targets["miR-21"], { symbol: "MIR21", type: "miRNA" });
  assert.equal(exp.targets.long.description.length, 600);
  for (const v of [undefined, null, "x", 5, [1]]) assert.deepEqual(C.normalizeExperiment({ targets: v }).targets, {});
  // A target literally called "__proto__" is stored as data, not as the object's prototype.
  const t = G.cleanTargets(JSON.parse('{"__proto__": {"symbol": "ACTB", "type": "mRNA"}}'));
  assert.equal(Object.getPrototypeOf(t), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(t, "__proto__").value.symbol, "ACTB");
  // Survives a save and reload (JSON round trip).
  const again = C.normalizeExperiment(JSON.parse(JSON.stringify(exp)));
  assert.deepEqual(again.targets, exp.targets);
});

test("targetTable lists each target once with user choices over guesses", () => {
  const rows = [{ target: "b-actin" }, { target: "b-actin" }, { target: "miR-21" }, { target: "GFP" }, { target: null }, { target: "  " }];
  const tbl = G.targetTable({ targets: { "miR-21": { type: "other", confirmedBy: "me" } } }, rows);
  assert.deepEqual(tbl.map(r => r.name), ["b-actin", "miR-21", "GFP"]);
  assert.equal(tbl[0].symbol, "ACTB");
  assert.equal(tbl[0].lookup, true);
  assert.equal(tbl[1].type, "other");
  assert.equal(tbl[1].confirmed, true);
  assert.equal(tbl[2].lookup, false);
});

// ---------------------------------------------------------------- lookup with a fake fetch
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function fakeFetch(handler) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); };
  f.calls = calls;
  return f;
}
const ACTB_HIT = { HGNC: "132", _id: "60", ensembl: { gene: "ENSG00000075624" }, entrezgene: "60", name: "actin beta",
  summary: "This gene encodes one of six different actin proteins. Actins are highly conserved proteins. [provided by RefSeq, Aug 2017].", symbol: "ACTB", type_of_gene: "protein-coding" };

test("lookup: found in MyGene.info", async () => {
  const f = fakeFetch(() => json({ hits: [ACTB_HIT] }));
  const r = await G.lookupGene("ACTB", { fetch: f, now: "2026-11-13T00:00:00Z" });
  assert.equal(r.status, "found");
  assert.equal(r.symbol, "ACTB");
  assert.equal(r.entrez, "60");
  assert.equal(r.ensembl, "ENSG00000075624");
  assert.equal(r.hgncId, "HGNC:132");
  assert.equal(r.type, "mRNA");
  assert.equal(r.source, "MyGene.info");
  assert.equal(r.description, "This gene encodes one of six different actin proteins.");
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].url, /^https:\/\/mygene\.info\/v3\/query\?q=symbol%3AACTB&species=human&/);
  assert.equal(f.calls[0].opts.credentials, "omit");
});

test("lookup: miRNA tries the extra locus, then reads ncRNA as miRNA", async () => {
  const f = fakeFetch(url => json({ hits: /MIR16-1/.test(decodeURIComponent(url)) ? [{ symbol: "MIR16-1", entrezgene: 406950, name: "microRNA 16-1", type_of_gene: "ncRNA", HGNC: "31545" }] : [] }));
  const r = await G.lookupGene("MIR16", { fetch: f, extra: ["MIR16-1"] });
  assert.equal(r.status, "found");
  assert.equal(r.symbol, "MIR16-1");
  assert.equal(r.type, "miRNA");
  assert.equal(r.entrez, "406950");
});

test("lookup: alias and not found", async () => {
  const f = fakeFetch(url => json({ hits: /alias%3AHPRT/.test(url) ? [{ symbol: "HPRT1", entrezgene: "3251", name: "hypoxanthine phosphoribosyltransferase 1", type_of_gene: "protein-coding" }] : [] }));
  const a = await G.lookupGene("HPRT", { fetch: f });
  assert.equal(a.status, "alias");
  assert.equal(a.symbol, "HPRT1");
  assert.equal(a.asked, "HPRT");
  const n = await G.lookupGene("NOTAGENE", { fetch: f });
  assert.equal(n.status, "not_found");
  assert.equal(n.source, "MyGene.info");
});

test("lookup: falls back to HGNC when MyGene.info is down", async () => {
  const f = fakeFetch((url, opts) => {
    if (url.startsWith("https://mygene.info")) return json({}, 503);
    assert.equal(opts.headers.Accept, "application/json");
    return json({ response: { docs: /symbol\/MIR21$/.test(url) ? [{ symbol: "MIR21", name: "microRNA 21", hgnc_id: "HGNC:31586", entrez_id: "406991", ensembl_gene_id: "ENSG00000284190", locus_type: "RNA, micro" }] : [] } });
  });
  const r = await G.lookupGene("MIR21", { fetch: f });
  assert.equal(r.status, "found");
  assert.equal(r.source, "HGNC");
  assert.equal(r.hgncId, "HGNC:31586");
  assert.equal(r.type, "miRNA");
  assert.ok(f.calls.some(c => c.url === "https://rest.genenames.org/fetch/symbol/MIR21"));
});

test("lookup: network error is reported, not thrown", async () => {
  const f = fakeFetch(() => { throw new TypeError("Failed to fetch"); });
  const r = await G.lookupGene("ACTB", { fetch: f });
  assert.equal(r.status, "error");
  assert.match(r.error, /couldn't be reached|could be reached/);
  assert.match(r.error, /Failed to fetch/);
  const m = await G.lookupGene("Actb", { species: "mouse", fetch: f });
  assert.equal(m.status, "error");
  assert.ok(f.calls.every(c => !c.url.includes("genenames")) || f.calls.length > 1);
});

test("lookup never sends anything that isn't a symbol", async () => {
  const f = fakeFetch(() => json({ hits: [] }));
  for (const bad of ["Sample 1 Ct 23.4", "a&b=c", "", "<x>", "x".repeat(50), null, 5]) {
    const r = await G.lookupGene(bad, { fetch: f });
    assert.equal(r.status, "error");
  }
  assert.equal((await G.lookupGene("ACTB", { species: "other", fetch: f })).status, "error");
  assert.equal(f.calls.length, 0);
});

test("report lists targets with type, symbol, IDs and the database it came from", () => {
  const exp = C.newExperiment({ title: "t" });
  exp.source = { name: "demo.csv", text: readFileSync(new URL("../examples/demo_results.csv", import.meta.url), "utf8"), sha256: "x" };
  C.normalizeExperiment(exp);
  const res = C.analyze(exp);
  const name = res.rows.find(r => r.target).target;
  exp.targets = G.putTarget({}, name, { symbol: "GAPDH", type: "mRNA", entrez: "2597", hgncId: "HGNC:4141", description: "glyceraldehyde-3-phosphate dehydrogenase",
    source: "MyGene.info", checkedAt: "2026-11-13T09:00:00Z", status: "found" });
  const html = reportHtml(exp, res);
  const sec = html.slice(html.indexOf("<h2>Targets</h2>"), html.indexOf("<h2>Files</h2>"));
  assert.ok(sec.includes("Entrez 2597, HGNC:4141"));
  assert.ok(sec.includes("glyceraldehyde-3-phosphate dehydrogenase"));
  assert.ok(sec.includes("MyGene.info (https://mygene.info) on 2026-11-13"));
  assert.ok(sec.includes("Only gene symbols were sent"));
  assert.ok(JSON.parse(structuredJson(exp, res)).experiment.targets[name]);
  const empty = reportHtml(C.normalizeExperiment({ ...exp, targets: {} }), res);
  assert.ok(empty.includes("(guessed from name)"));
  assert.ok(empty.includes("No gene database was queried"));
});
