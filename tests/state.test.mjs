// Rough handling of saved state: damaged experiments, tampered run files and random plate-map edits.
// The rule: either refuse with a clear error, or carry on correctly. Never crash later, never hang.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as R from "../web/report.js";
import { demoFiles } from "../web/demo.js";

let seed = 99;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];
const f = demoFiles();
async function demo() {
  const e = C.newExperiment({ title: "t" }, "tester");
  e.source = C.fileRecord({ name: "r.csv", text: f.results, sha: await C.sha256(f.results), format: "generic-ct-csv" });
  e.amp = C.fileRecord({ name: "a.csv", text: f.amp, sha: await C.sha256(f.amp) });
  e.melt = C.fileRecord({ name: "m.csv", text: f.melt, sha: await C.sha256(f.melt), valueType: "derivative" });
  e.ruleset.values.meltChecks = true;
  return e;
}
const JUNK = [null, undefined, 0, -1, 1e99, NaN, "", "x", "<script>alert(1)</script>", [], {}, [1, 2], { a: 1 }, true, "a".repeat(5000)];
// Everything the app does with an experiment after loading it.
function exercise(exp) {
  const res = C.analyze(exp);
  R.reportHtml(exp, res); R.wellsCsv(res); R.findingsCsv(exp, res); R.structuredJson(exp, res); R.packetJson(exp, res);
  C.nextSteps(exp, res); C.rulesetChanges(exp.ruleset); C.rulesetId(exp.ruleset); C.compareRuns(exp, res, exp, res);
  C.logAudit(exp, "t", "x", "y");
  return res;
}

test("experiments with damaged fields are repaired on load or fail with a ParseError", async () => {
  const base = await demo(), keys = Object.keys(base);
  let repaired = 0, refused = 0;
  for (let n = 0; n < 600; n++) {
    const e = structuredClone(base);
    for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) {
      const key = pick(keys), how = rnd();
      if (how < 0.3) delete e[key];
      else if (how < 0.8) e[key] = pick(JUNK);
      else if (e[key] && typeof e[key] === "object") { const sub = pick(Object.keys(e[key])); if (sub) e[key][sub] = pick(JUNK); }
    }
    try { exercise(C.normalizeExperiment(e)); repaired++; }
    catch (err) {
      const shape = JSON.stringify(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v && typeof v === "object" ? "{…}" : v]))).slice(0, 300);
      assert.ok(err instanceof C.ParseError, `case ${n}: crashed with ${err.constructor.name}: ${err.message}
${shape}`); refused++;
    }
  }
  assert.ok(repaired > 300, `only ${repaired} of 600 usable`);
  console.log(`  ${repaired} repaired, ${refused} refused with a clear error`);
});

test("tampered run files are refused or load safely", async () => {
  const exp = await demo(), packet = JSON.parse(R.packetJson(exp, C.analyze(exp)));
  let loaded = 0, refused = 0;
  for (let n = 0; n < 400; n++) {
    const p = structuredClone(packet), target = pick([p, p.experiment, p.experiment, p.experiment.source, p.experiment.ruleset, p.experiment.ruleset.values, p.experiment.reviews, p.experiment.map]);
    const key = pick(Object.keys(target).concat(["extra"]));
    if (rnd() < 0.3) delete target[key]; else target[key] = pick(JUNK);
    let back;
    try { back = await C.verifyPacket(p); }
    catch (err) { assert.ok(err instanceof C.ParseError, `case ${n} (${key}): verify crashed with ${err.constructor.name}: ${err.message}`); refused++; continue; }
    try { exercise(back); loaded++; }
    catch (err) { assert.ok(err instanceof C.ParseError, `case ${n} (${key}): accepted, then crashed with ${err.constructor.name}: ${err.message}`); refused++; }
  }
  for (const junk of JUNK) await assert.rejects(C.verifyPacket(junk), C.ParseError, `verifyPacket(${JSON.stringify(junk)?.slice(0, 30)})`);
  console.log(`  ${loaded} loaded, ${refused} refused`);
});

test("random plate-map edits never break the analysis or change raw values", async () => {
  const exp = await demo(), rows = C.analyze(exp).rows, raw = rows.map(r => r.ct);
  const VALUES = ["", "x", "NTC", "ctrl-1", "1e5", "-3", "abc", "<img src=x onerror=alert(1)>", "  ", "sample", "ntc", "standard", "empty", "positive", "nrt", "bogus", null, 5, {}];
  for (let n = 0; n < 500; n++) {
    const r = pick(rows), field = pick(["sample", "target", "group", "role", "bio_unit", "quantity", "nonsense"]);
    exp.map[pick([r.id, r.id, "9999", "x"])] = { ...(exp.map[r.id] || {}), [field]: pick(VALUES) };
    if (rnd() < 0.1) exp.controlNA[`${pick(["ntc", "positive", "nrt", "zzz"])}|${pick(["GAPDH", "GENE1", "nope"])}`] = pick([{ reason: "r", by: "b", at: new Date().toISOString() }, null, "x", {}]);
    if (rnd() < 0.1) exp.reviews[pick(C.analyze(exp).findings)?.id || "x"] = pick([{ disposition: "accepted" }, { disposition: "bogus" }, null, "x", { note: 5 }]);
    let res;
    try { res = exercise(C.normalizeExperiment(exp)); } catch (err) { assert.fail(`edit ${n} (${field}): ${err.constructor.name}: ${err.message}`); } // normalise as the app does on load
    assert.deepEqual(res.rows.map(x => x.ct), raw, `edit ${n}: raw Ct values changed`);
    assert.equal(res.rows.length, rows.length, `edit ${n}: rows lost`);
    const html = R.reportHtml(exp, res);
    assert.ok(!html.includes("<img src=x"), `edit ${n}: unescaped markup in report`);
  }
});

test("random plate-map files are applied or refused cleanly", async () => {
  const cells = ["A1", "a01", "H12", "Z9", "", "13", "B2", "P24", "sample", "NTC", "Pos Ctrl", "bogus", "1e5", "ctrl,1", "\"q\""];
  for (let n = 0; n < 300; n++) {
    const exp = await demo(), rows = C.analyze(exp).rows;
    const cols = ["well", "sample", "target", "group", "role", "bio_unit", "quantity", "junk"].filter(() => rnd() < 0.7);
    const text = cols.join(",") + "\n" + Array.from({ length: Math.floor(rnd() * 30) }, () => cols.map(() => pick(cells)).join(",")).join("\n");
    try { C.applyTemplate(exp, rows, C.parseTemplate(text), { name: "m.csv" }); }
    catch (err) { assert.ok(err instanceof C.ParseError, `template ${n}: ${err.constructor.name}: ${err.message}\n${text.slice(0, 200)}`); continue; }
    try { exercise(exp); } catch (err) { assert.fail(`template ${n}: after applying: ${err.constructor.name}: ${err.message}\n${text.slice(0, 200)}`); }
  }
});
