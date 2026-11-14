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
  assert.equal(G.analyzeTarget("cel-miR-39").species, "worm");
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
    "miR-21": { symbol: "MIR21", type: "miRNA", entrez: "60; DROP TABLE", ensembl: "<script>", hgncId: "HGNC:abc", source: "evil.example", status: "weird", species: "unicorn", taxid: "96O6" },
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
  assert.ok(sec.includes("Only gene symbols and species were sent"));
  assert.ok(JSON.parse(structuredJson(exp, res)).experiment.targets[name]);
  const empty = reportHtml(C.normalizeExperiment({ ...exp, targets: {} }), res);
  assert.ok(empty.includes("(guessed from name)"));
  assert.ok(empty.includes("No gene database was queried"));
});

// ---------------------------------------------------------------- other species
test("species is guessed from miRBase prefixes, locus IDs and CG numbers, and says it's a guess", () => {
  const cases = { "dre-miR-21": "zebrafish", "dme-miR-1-3p": "fly", "cel-miR-39": "worm", "ath-miR156a": "arabidopsis", "gga-miR-21-5p": "chicken",
    "ssc-miR-21": "pig", "bta-miR-21-5p": "cow", "cfa-miR-21": "dog", "mml-miR-21": "macaque", "xtr-miR-21": "xenopus",
    YFL039C: "yeast", "AT3G18780": "arabidopsis", "at3g18780 primers": "arabidopsis", CG1234: "fly", ACTB: "human" };
  for (const [name, sp] of Object.entries(cases)) assert.equal(G.analyzeTarget(name).species, sp, name);
  const z = G.analyzeTarget("dre-miR-21");
  assert.notEqual(z.speciesFrom, "default");
  assert.match(z.notes.join(" "), /zebrafish, guessed from the “dre-” prefix\. Change it if that's wrong\./);
  // A guess is only a guess: the user's choice in exp.targets wins.
  const [row] = G.targetTable({ targets: { "dre-miR-21": { species: "human" } } }, [{ target: "dre-miR-21" }]);
  assert.equal(row.species, "human");
  assert.match(G.analyzeTarget("sox10b").notes.join(" "), /lower case, as zebrafish and Xenopus symbols are/);
});

test("miRNA gene symbols follow each species' style", () => {
  const cases = {
    "dre-miR-21": ["mir21", "mir21-1"], "dre-let-7a": ["mirlet7a", "mirlet7a-1"], "xtr-miR-21-5p": ["mir21", "mir21-1"],
    "dme-miR-276a-3p": ["mir-276a"], "cel-miR-39-3p": ["mir-39"], "cel-let-7-5p": ["let-7"],
    "ath-miR156a": ["MIR156a"], "ath-miR156": ["MIR156", "MIR156a"], "gga-miR-21-5p": ["MIR21", "MIR21-1"], "bta-let-7a": ["MIRLET7A", "MIRLET7A1"],
  };
  for (const [name, [sym, extra]] of Object.entries(cases)) {
    const a = G.analyzeTarget(name);
    assert.equal(a.symbol, sym, name);
    assert.equal(a.type, "miRNA", name);
    assert.equal(a.valid, true, `${name}: ${a.reason}`);
    if (extra) assert.equal(a.extra[0], extra, name); else assert.deepEqual(a.extra, [], name);
  }
});

test("symbols are suggested and checked in each species' style", () => {
  const sug = (n, sp) => G.suggestSymbol(n, sp).symbol;
  assert.equal(sug("SOX10", "zebrafish"), "sox10");
  assert.equal(sug("IL-6", "xenopus"), "il6");
  assert.equal(sug("ACT-1", "worm"), "act-1");
  assert.equal(sug("act1", "yeast"), "ACT1");
  assert.equal(sug("yfl039c", "yeast"), "YFL039C");
  assert.equal(sug("flc", "arabidopsis"), "FLC");
  assert.equal(sug("Act5C", "fly"), "Act5C");
  assert.equal(sug("b-actin", "pig"), "ACTB");
  assert.equal(sug("b-actin", "fly"), "b-actin"); // the human nickname list isn't applied to flies
  const ok = { zebrafish: ["actb1", "mir21-1", "si-ch211"], xenopus: ["actb", "sox2"], worm: ["act-1", "unc-54", "mir-39", "F53A9.10"],
    yeast: ["ACT1", "YFL039C", "YAR028W", "TDH3"], arabidopsis: ["ACT2", "AT3G18780", "MIR156a", "FLC"], fly: ["Act5C", "w", "CG1234", "mir-1"],
    chicken: ["ACTB", "MIR21"], pig: ["ACTB"], cow: ["MIR218-1"], dog: ["ACTB"], macaque: ["ACTB"], other: ["anything", "Abc1"] };
  for (const [sp, syms] of Object.entries(ok)) for (const s of syms) assert.ok(G.checkSymbol(s, sp).ok, `${sp} ${s}: ${G.checkSymbol(s, sp).reason}`);
  const bad = { zebrafish: [["Actb1", /all lower case: actb1/]], xenopus: [["SOX2", /lower case/]], worm: [["ACT-1", /lower case: act-1/], ["act1", /hyphen/]],
    yeast: [["act1", /upper case: ACT1/], ["yfl039c", /upper case/]], arabidopsis: [["flc", /upper case: FLC.*mutant/], ["at3g18780", /upper case/]],
    chicken: [["Actb", /Chicken symbols follow the human \(HGNC\) style and are upper case: ACTB/]], dog: [["actb", /upper case/]] };
  for (const [sp, list] of Object.entries(bad)) for (const [s, re] of list) {
    const c = G.checkSymbol(s, sp);
    assert.ok(!c.ok, `${sp} ${s}`); assert.match(c.reason, re, `${sp} ${s}`);
  }
});

test("every species has a taxonomy ID, and stored annotations keep the new IDs", () => {
  for (const [k] of G.SPECIES) if (k !== "other") assert.match(G.TAXID[k], /^\d+$/, k);
  assert.deepEqual([G.TAXID.zebrafish, G.TAXID.fly, G.TAXID.worm, G.TAXID.yeast, G.TAXID.arabidopsis, G.TAXID.chicken, G.TAXID.pig, G.TAXID.cow, G.TAXID.dog, G.TAXID.macaque, G.TAXID.xenopus],
    ["7955", "7227", "6239", "559292", "3702", "9031", "9823", "9913", "9615", "9544", "8364"]);
  const t = G.cleanTargets({
    a: { symbol: "actb1", species: "zebrafish", hgncId: "ZFIN:ZDB-GENE-000329-1", ensembl: "ENSDARG00000037746" },
    b: { symbol: "Act5C", species: "fly", hgncId: "FB:FBgn0000042", ensembl: "FBgn0000042" },
    c: { symbol: "ACT1", species: "yeast", hgncId: "SGD:S000001855", ensembl: "YFL039C", locus: "YFL039C" },
    d: { symbol: "X", species: "other", taxid: "4932" },
    e: { symbol: "X", species: "other", taxid: "4932; DROP", hgncId: "ZFIN:<b>", locus: "nope" },
  });
  assert.equal(t.a.hgncId, "ZFIN:ZDB-GENE-000329-1"); assert.equal(t.b.ensembl, "FBgn0000042"); assert.equal(t.c.locus, "YFL039C");
  assert.equal(t.d.taxid, "4932");
  assert.deepEqual(t.e, { symbol: "X", species: "other" });
  // "Other" is looked up only once it has a taxonomy ID.
  const rows = [{ target: "Foo1" }];
  assert.equal(G.targetTable({ targets: { Foo1: { species: "other" } } }, rows)[0].lookup, false);
  const withId = G.targetTable({ targets: { Foo1: { species: "other", taxid: "4932" } } }, rows)[0];
  assert.equal(withId.lookup, true); assert.equal(withId.taxid, "4932");
  assert.equal(G.speciesText(withId), "Other (taxid 4932)");
  assert.equal(G.targetTable({ targets: { Foo1: { species: "zebrafish", symbol: "foo1" } } }, rows)[0].taxid, "7955");
});

test("lookup for other species: taxonomy ID in the request, the species' own IDs back, no HGNC fallback", async () => {
  const ZF = { ZFIN: "ZDB-GENE-000329-1", _id: "57934", ensembl: [{ gene: "ENSDARG00000113649" }, { gene: "ENSDARG00000037746" }], entrezgene: "57934",
    name: "actin, beta 1", symbol: "actb1", taxid: 7955, type_of_gene: "protein-coding" };
  const f = fakeFetch(() => json({ hits: [ZF] }));
  const r = await G.lookupGene("actb1", { species: "zebrafish", fetch: f });
  assert.equal(r.status, "found");
  assert.match(f.calls[0].url, /^https:\/\/mygene\.info\/v3\/query\?q=symbol%3Aactb1&species=7955&/);
  assert.match(f.calls[0].url, /ZFIN/);
  assert.equal(r.hgncId, "ZFIN:ZDB-GENE-000329-1");
  assert.match(r.ensembl, /^ENSDARG\d{11}$/);
  assert.equal(r.entrez, "57934");

  const fly = fakeFetch(() => json({ hits: [{ FLYBASE: "FBgn0000042", ensembl: { gene: "FBgn0000042" }, entrezgene: "31521", name: "Actin 5C", symbol: "Act5C", type_of_gene: "protein-coding" }] }));
  const fr = await G.lookupGene("Act5C", { species: "fly", fetch: fly });
  assert.match(fly.calls[0].url, /species=7227&/);
  assert.equal(fr.hgncId, "FB:FBgn0000042"); assert.equal(fr.ensembl, "FBgn0000042");

  // Yeast systematic names are asked for as locus tags, and the standard name comes back.
  const y = fakeFetch(url => json({ hits: /locus_tag%3AYFL039C/.test(url) ? [{ SGD: "S000001855", ensembl: { gene: "YFL039C" }, entrezgene: "850504", locus_tag: "YFL039C", name: "actin", symbol: "ACT1", type_of_gene: "protein-coding" }] : [] }));
  const yr = await G.lookupGene("YFL039C", { species: "yeast", fetch: y });
  assert.equal(y.calls.length, 1);
  assert.match(y.calls[0].url, /q=locus_tag%3AYFL039C&species=559292&/);
  assert.equal(yr.status, "alias"); assert.equal(yr.symbol, "ACT1"); assert.equal(yr.asked, "YFL039C");
  assert.equal(yr.hgncId, "SGD:S000001855"); assert.equal(yr.locus, "YFL039C");

  const at = fakeFetch(url => json({ hits: /locus_tag%3AAT3G18780/.test(url) ? [{ TAIR: "AT3G18780", ensembl: { gene: "AT3G18780" }, entrezgene: "821411", locus_tag: "AT3G18780", name: "actin 2", symbol: "ACT2" }] : [] }));
  const ar = await G.lookupGene("AT3G18780", { species: "arabidopsis", fetch: at });
  assert.match(at.calls[0].url, /species=3702&/);
  assert.equal(ar.symbol, "ACT2"); assert.equal(ar.hgncId, "TAIR:AT3G18780");

  // "Other" sends the taxonomy ID the user typed, and nothing at all without one.
  const o = fakeFetch(() => json({ hits: [] }));
  assert.equal((await G.lookupGene("ACT1", { species: "other", taxid: "4932", fetch: o })).status, "not_found");
  assert.match(o.calls[0].url, /species=4932&/);
  const n = o.calls.length;
  for (const bad of ["", "abc", "4932&q=x", "1234567890"]) assert.equal((await G.lookupGene("ACT1", { species: "other", taxid: bad, fetch: o })).status, "error", bad);
  assert.equal((await G.lookupGene("ACT1", { species: "unicorn", fetch: o })).status, "error");
  assert.equal(o.calls.length, n);

  // MyGene.info down: HGNC is human-only, so a zebrafish gene is never sent there.
  const down = fakeFetch(() => json({}, 503));
  const d = await G.lookupGene("actb1", { species: "zebrafish", fetch: down });
  assert.equal(d.status, "error"); assert.match(d.error, /only has human genes/);
  assert.ok(down.calls.every(c => c.url.startsWith("https://mygene.info/")));
  // Every request carries only the symbol and species (plus the fixed field list and page size).
  for (const c of [...f.calls, ...y.calls, ...o.calls, ...down.calls]) {
    const u = new URL(c.url);
    assert.deepEqual([...u.searchParams.keys()].sort(), ["fields", "q", "size", "species"]);
  }
});

// ---------------------------------------------------------------- fruit fly (FlyBase conventions)
test("fly symbols: annotation IDs, mir-N, colon forms and case slips", () => {
  for (const s of ["Act5C", "w", "dpp", "CG1234", "CG10000", "CR43027", "mir-1", "mir-276a", "mir-let7", "Noc3", "N"]) assert.ok(G.checkSymbol(s, "fly").ok, `${s}: ${G.checkSymbol(s, "fly").reason}`);
  const bad = [["cg1234", /upper case: CG1234/], ["CG123", /four or five digits/], ["CG123456", /four or five digits/], ["lncRNA:CR45187", /annotation ID, CR45187/],
    ["miR-1", /mir-1, not miR-1/], ["MIR276A", /mir-276a/], ["mir1", /mir-1/], ["let-7", /mir-let7/], ["RPL32", /FlyBase writes RpL32/], ["act5c", /Act5C/], ["DPP", /dpp/]];
  for (const [s, re] of bad) { const c = G.checkSymbol(s, "fly"); assert.ok(!c.ok, s); assert.match(c.reason, re, s); }
  const sug = n => G.suggestSymbol(n, "fly");
  assert.equal(sug("rp49").symbol, "RpL32");
  assert.equal(sug("RPL32").symbol, "RpL32"); assert.match(sug("RPL32").note, /FlyBase writes this gene RpL32/);
  assert.equal(sug("cg4027").symbol, "CG4027");
  assert.equal(sug("lncRNA:CR45187").symbol, "CR45187");
  assert.equal(G.analyzeTarget("dme-let-7-5p").symbol, "mir-let7");
  assert.equal(G.analyzeTarget("CR43027").species, "fly");
  assert.equal(G.analyzeTarget("CG4027").species, "fly");
  assert.equal(G.cleanTargets({ a: { locus: "CG4027" } }).a.locus, "CG4027");
});

test("fly lookup: CG numbers as Dmel_ locus tags, exact case wins, case-only matches are flagged", async () => {
  const ACT = { FLYBASE: "FBgn0000042", ensembl: { gene: "FBgn0000042" }, locus_tag: "Dmel_CG4027", name: "Actin 5C", symbol: "Act5C", type_of_gene: "protein-coding" };
  const f = fakeFetch(url => json({ hits: new URL(url).searchParams.get("q") === "locus_tag:Dmel_CG4027" ? [ACT] : [] }));
  const r = await G.lookupGene("CG4027", { species: "fly", fetch: f });
  assert.equal(f.calls.length, 1);
  assert.equal(r.status, "alias"); assert.equal(r.symbol, "Act5C"); assert.equal(r.asked, "CG4027"); assert.equal(r.locus, "CG4027");
  // "Dl": MyGene.info answers with dorsal (dl); the lookup says so and lists the gene that has Dl as an alias.
  const DL = { symbol: "dl", name: "dorsal", FLYBASE: "FBgn0260632" };
  const g = fakeFetch(url => { const q = new URL(url).searchParams.get("q");
    return json({ hits: q === "symbol:Dl" ? [DL] : q === "alias:Dl" ? [DL, { symbol: "Delta", name: "delta" }] : [] }); });
  const d = await G.lookupGene("Dl", { species: "fly", fetch: g });
  assert.equal(d.symbol, "dl"); assert.equal(d.asked, "Dl");
  assert.match(d.lookupNote, /differs from Dl only in case/); assert.match(d.lookupNote, /alias of Delta/);
  const e = fakeFetch(() => json({ hits: [{ symbol: "dl" }, { symbol: "Dl", name: "x" }] }));
  const ex = await G.lookupGene("Dl", { species: "fly", fetch: e });
  assert.equal(ex.symbol, "Dl"); assert.equal(ex.lookupNote, undefined); assert.equal(e.calls.length, 1);
});

// ---------------------------------------------------------------- Ensembl ID choice
test("Ensembl: the reference-assembly ID is chosen and the others are listed", async () => {
  // Shapes as MyGene.info returned them in Nov 2026 (trimmed).
  const zf = { ensembl: [{ gene: "ENSDARG00000113649" }, { gene: "ENSDARG00000037746" }],
    genomic_pos: [{ chr: "ALT_CTG1_1_1", ensemblgene: "ENSDARG00000113649" }, { chr: "1", ensemblgene: "ENSDARG00000037746" }] };
  const z = G.chooseEnsembl(zf, "zebrafish");
  assert.equal(z.id, "ENSDARG00000037746");
  assert.match(z.note, /lists 2 Ensembl gene IDs\. I used ENSDARG00000037746, which is in the reference assembly's ID range \(ENSDARG00000…\) and on chromosome 1\. Others: ENSDARG00000113649\./);
  const pigIds = [["ENSSSCG00045027458", "LUXT01070954.1"], ["ENSSSCG00070011353", "3"], ["ENSSSCG00005020690", "KQ003943.1"], ["ENSSSCG00000007585", "3"], ["ENSSSCG00030003451", "LUXR01007394.1"]];
  const pig = { ensembl: pigIds.map(([gene]) => ({ gene })), genomic_pos: pigIds.map(([ensemblgene, chr]) => ({ ensemblgene, chr })) };
  const p = G.chooseEnsembl(pig, "pig");
  assert.equal(p.id, "ENSSSCG00000007585"); // ENSSSCG00070011353 is on a chromosome too, but in another breed's ID range
  assert.match(p.note, /Others: ENSSSCG00045027458, ENSSSCG00070011353, ENSSSCG00005020690, ENSSSCG00030003451\./);
  const hla = { ensembl: [{ gene: "ENSG00000235657" }, { gene: "ENSG00000206503" }], genomic_pos: [{ chr: "HSCHR6_MHC_DBB_CTG1", ensemblgene: "ENSG00000235657" }, { chr: "6", ensemblgene: "ENSG00000206503" }] };
  assert.equal(G.chooseEnsembl(hla, "human").id, "ENSG00000206503");
  // Without positions the standard prefix decides; with nothing to go on, the first ID and a note saying so.
  assert.equal(G.chooseEnsembl({ ensembl: [{ gene: "ENSSSCG00045027458" }, { gene: "ENSSSCG00000007585" }] }, "pig").id, "ENSSSCG00000007585");
  const none = G.chooseEnsembl({ ensembl: [{ gene: "ENSXXXG1" }, { gene: "ENSXXXG2" }] }, "other");
  assert.equal(none.id, "ENSXXXG1"); assert.match(none.note, /the first listed/);
  assert.deepEqual(G.chooseEnsembl({ ensembl: { gene: "FBgn0000042" } }, "fly"), { id: "FBgn0000042", note: "" });
  // In a lookup the note travels with the result, and the field list asks for the positions.
  const f = fakeFetch(() => json({ hits: [{ symbol: "actb1", ZFIN: "ZDB-GENE-000329-1", ...zf }] }));
  const r = await G.lookupGene("actb1", { species: "zebrafish", fetch: f });
  assert.equal(r.ensembl, "ENSDARG00000037746"); assert.match(r.lookupNote, /ENSDARG00000113649/);
  assert.match(new URL(f.calls[0].url).searchParams.get("fields"), /genomic_pos\.chr,genomic_pos\.ensemblgene/);
});

// ---------------------------------------------------------------- Xenopus laevis
test("Xenopus laevis: taxid 8355, xla- prefix, .L/.S suffix in guess and check", () => {
  assert.equal(G.TAXID.xlaevis, "8355");
  assert.equal(G.SPECIES_LABEL.xlaevis, "Xenopus laevis");
  assert.equal(G.analyzeTarget("xla-miR-16a-5p").species, "xlaevis");
  assert.equal(G.analyzeTarget("xla-miR-16a-5p").symbol, "mir16a");
  const a = G.analyzeTarget("ACTB.L");
  assert.equal(a.species, "xlaevis");
  assert.equal(a.symbol, "actb.L");
  assert.match(a.notes.join(" "), /\.L suffix/);
  for (const s of ["actb.L", "sox2.S", "actb", "mir16a"]) assert.ok(G.checkSymbol(s, "xlaevis").ok, s);
  assert.match(G.checkSymbol("actb.l", "xlaevis").reason, /actb\.L/);
  assert.match(G.checkSymbol("ACTB.L", "xlaevis").reason, /actb\.L/);
  assert.match(G.checkSymbol("actb.L", "xenopus").reason, /Xenopus laevis/);
  assert.equal(G.suggestSymbol("Sox2.s", "xlaevis").symbol, "sox2.S");
  assert.equal(G.cleanTargets({ a: { species: "xlaevis", hgncId: "Xenbase:XB-GENE-866011" } }).a.species, "xlaevis");
});

test("Xenopus laevis lookup: a symbol without suffix asks for both homeologs in one request", async () => {
  const L = { Xenbase: "XB-GENE-866011", entrezgene: "398459", name: "actin, beta L homeolog", symbol: "actb.L", type_of_gene: "protein-coding" };
  const S = { Xenbase: "XB-GENE-17335697", entrezgene: "108703086", name: "actin, beta S homeolog", symbol: "actb.S", type_of_gene: "protein-coding" };
  const f = fakeFetch(url => json({ hits: / OR /.test(new URL(url).searchParams.get("q")) ? [S, L] : [] }));
  const r = await G.lookupGene("actb", { species: "xlaevis", fetch: f });
  assert.match(f.calls[0].url, /species=8355&/);
  assert.equal(new URL(f.calls.at(-1).url).searchParams.get("q"), "symbol:actb.L OR symbol:actb.S");
  assert.equal(r.status, "alias"); assert.equal(r.symbol, "actb.L"); assert.deepEqual(r.others, ["actb.S"]);
  assert.equal(r.hgncId, "Xenbase:XB-GENE-866011");
  assert.match(r.lookupNote, /two copies of actb: actb\.L and actb\.S\. I used actb\.L/);
  const direct = fakeFetch(() => json({ hits: [L] }));
  const d = await G.lookupGene("actb.L", { species: "xlaevis", fetch: direct });
  assert.equal(d.status, "found"); assert.equal(direct.calls.length, 1); assert.equal(d.lookupNote, undefined);
  assert.equal(G.cleanTargets({ x: { symbol: "actb.L", lookupNote: r.lookupNote } }).x.lookupNote, r.lookupNote);
});
