// Regression tests on realistic vendor-style fixtures (committed) and public instrument exports
// (downloaded with `node testdata/fetch-public.mjs`; skipped when absent).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import * as C from "../web/core.js";

const root = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..", "testdata");
const read = p => readFileSync(join(root, p), "utf8");
function run(rel, opts = {}) {
  const e = C.newExperiment({}, "test");
  e.source = { name: rel, text: read(rel), sha256: "-", plateSize: opts.plateSize };
  for (const [k, suf, extra] of [["amp", "_amp.csv", {}], ["melt", "_melt.csv", { valueType: "derivative" }]]) {
    const p = rel.replace(/\.(csv|txt)$/i, suf);
    if (existsSync(join(root, p))) e[k] = { name: p, text: read(p), sha256: "-", ...extra };
  }
  if (e.melt) e.ruleset.values.meltChecks = true;
  return C.analyze(e);
}

const expectations = JSON.parse(read("realistic/expectations.json"));
for (const [rel, x] of Object.entries(expectations)) {
  test(`realistic fixture: ${basename(rel)}`, () => {
    if (x.error) { assert.throws(() => run(rel), new RegExp(x.error.regex)); return; }
    const res = run(rel), rules = new Set(res.findings.map(f => f.rule));
    assert.equal(res.parsed.format, x.format);
    assert.equal(res.rows.length, x.rows, "row count");
    for (const r of x.must) assert.ok(rules.has(r), `expected ${r}`);
    for (const r of x.mustNot) assert.ok(!rules.has(r), `unexpected ${r}`);
  });
}

test("realistic: decimal-comma export gives the same numbers as the original", () => {
  const a = run("realistic/cfx96_sybr.csv"), b = run("realistic/cfx96_sybr_european.csv");
  assert.deepEqual(b.replicateGroups.map(g => g.mean?.toFixed(6)), a.replicateGroups.map(g => g.mean?.toFixed(6)));
  assert.ok(b.rows.some(r => /^\d+,\d+$/.test(r.ct)), "raw strings keep the comma");
});

test("realistic: blank line inside a hand-edited table does not drop rows", () => {
  const res = run("realistic/handmade_excel.csv");
  assert.deepEqual(res.rows.map(r => r.well), ["A01", "A02", "A03", "A1O", "A05", "A06", "B01"]);
  assert.ok(res.parsed.warnings.some(w => w.includes("footer")), "the Average line is reported as a footer");
  assert.equal(res.rows.find(r => r.well === "B01").role, "ntc");
});

test("realistic: QuantStudio results stop at the next [section]", () => {
  const res = run("realistic/quantstudio5_384_taqman.txt");
  assert.ok(res.rows.every(r => r.key));
  assert.equal(res.parsed.metadata["Instrument Type"], "QuantStudio™ 5 System");
  assert.ok(Math.abs(res.stdCurves[0].efficiency - 100) < 3);
});

const sources = JSON.parse(read("sources.json"));
for (const s of sources) {
  const rel = `public/${s.repo.replace("/", "__")}/${basename(s.path)}`;
  test(`public export: ${s.repo} ${basename(s.path)}`, { skip: !existsSync(join(root, rel)) && "run node testdata/fetch-public.mjs" }, () => {
    const res = run(rel, { plateSize: s.plateSize });
    assert.equal(res.parsed.format, s.format);
    assert.equal(res.rows.length, s.rows, "row count");
    assert.equal(res.parsed.malformed.length, 0, "no malformed rows");
    assert.ok(res.rows.every(r => r.key), "every row placed on the plate");
    assert.ok(!res.findings.some(f => f.rule === "invalid_well_coordinate"));
  });
}

test("public export: SDS 7900 numeric wells match the position-named samples", { skip: !existsSync(join(root, "public/reinson__qPCR_analysis/data.txt")) && "not downloaded" }, () => {
  for (const rel of ["public/reinson__qPCR_analysis/data.txt", "public/bleakley__pyqpcr/raw_data_AB7900_96w.txt"]) {
    const p = C.parseResults(read(rel), { plateSize: 384 }), named = p.rows.filter(r => C.wellKey(r.sample));
    assert.ok(named.length > 50);
    for (const r of named) assert.equal(r.key, C.wellKey(r.sample), `${rel} well ${r.well}`);
  }
  assert.throws(() => C.parseResults(read("public/bleakley__pyqpcr/raw_data_AB7900_96w.txt")), e => e.details?.needsPlateSize);
});
