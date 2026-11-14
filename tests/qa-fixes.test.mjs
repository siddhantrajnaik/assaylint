// Fixes from the QA review of blocks 0-2 (November 2026). Each test pins one behaviour that was wrong or unclear.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as X from "../web/vendor/xlsx.mjs";
import { readWorkbook } from "../web/excel.js";

const run = text => { const e = C.newExperiment({ title: "qa" }, "qa"); e.source = C.fileRecord({ name: "qa.csv", text, sha: "x", actor: "qa", format: "generic-ct-csv" }); return C.analyze(e); };

test("a sheet named exactly Results wins over 'Old results', and the other candidate is reported", async () => {
  const sheet = ct => X.utils.aoa_to_sheet([["Well", "Sample", "Target", "Ct"], ["A1", "s1", "GAPDH", ct], ["A2", "s1", "GAPDH", ct + 0.1]]);
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["notes"]]), "Notes");
  X.utils.book_append_sheet(wb, sheet(30), "Old results");
  X.utils.book_append_sheet(wb, sheet(20), "Results");
  const book = await readWorkbook("qa.xlsx", new Uint8Array(X.write(wb, { type: "array", bookType: "xlsx" })));
  assert.equal(book.best.results.sheet, "Results");
  assert.deepEqual(book.best.results.alternatives, ["Old results"]);
});

test("two columns that could be Ct: the first is used and a warning names both", () => {
  const p = C.parseResults("Well,Sample,Target,Ct,Ct\nA1,s1,GAPDH,20.1,30.1\n");
  assert.equal(p.rows[0].ct, "20.1");
  assert.ok(p.warnings.some(w => /More than one column could be the Ct\/Cq column/.test(w) && /column 4/.test(w) && /column 5/.test(w)));
});

test("no-RT controls are recognised from their names, NTC names still win, lookalikes are left alone", () => {
  const res = run("Well,Sample,Target,Ct\nA1,c1,GAPDH,20\nA2,c1,GAPDH,20.1\nA3,c1 noRT,GAPDH,\nA4,c1 -RT,GAPDH,\nA5,water,GAPDH,\nA6,RT-qPCR std,GAPDH,22\nA7,heart RT,GAPDH,21\n");
  const role = k => res.rows.find(r => r.key === k);
  assert.equal(role("A3").role, "nrt"); assert.match(role("A3").roleSource, /inferred/);
  assert.equal(role("A4").role, "nrt");
  assert.equal(role("A5").role, "ntc");
  assert.equal(role("A6").role, "sample"); assert.equal(role("A7").role, "sample");
  // A no-RT that did its job (no Ct) is not reported as a missing value.
  assert.ok(!res.findings.some(f => f.rule === "missing_ct" && f.wells.some(w => w === "A3" || w === "A4")));
});

test("a role from the file is never overridden by the name guess", () => {
  const res = run("Well,Sample,Target,Ct,Task\nA1,c1 noRT,GAPDH,30,STANDARD\n");
  assert.equal(res.rows[0].role, "standard");
});

test("an omitted well in a duplex says which target it is", () => {
  const res = run("Well,Sample,Target,Ct,Omit\nA5,s1,GENEX,25,true\nA5,s1,ACTB,19,true\n");
  const d = res.findings.filter(f => f.rule === "instrument_omit").map(f => f.description);
  assert.deepEqual(d.sort(), ["Well A5 (s1 / ACTB) is marked Omit in the instrument export.", "Well A5 (s1 / GENEX) is marked Omit in the instrument export."]);
});

test("version and build are exported, and the rule set has its own version", () => {
  assert.match(C.APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof C.BUILD, "string");
  assert.equal(C.DISPOSITION_LABEL.accepted, "Looks fine");
});
