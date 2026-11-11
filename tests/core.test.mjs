import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as R from "../web/report.js";
import { demoFiles } from "../web/demo.js";

const f = demoFiles();
async function demoExp({ amp = true, melt = true, meltChecks = true } = {}) {
  const e = C.newExperiment({ title: "t" }, "tester");
  e.source = C.fileRecord({ name: "r.csv", text: f.results, sha: await C.sha256(f.results), format: "generic-ct-csv" });
  if (amp) e.amp = C.fileRecord({ name: "a.csv", text: f.amp, sha: await C.sha256(f.amp) });
  if (melt) e.melt = C.fileRecord({ name: "m.csv", text: f.melt, sha: await C.sha256(f.melt), valueType: "derivative" });
  Object.assign(e.ruleset.values, { meltChecks, expectPositive: true, expectNrt: true });
  return e;
}
const rules = res => new Set(res.findings.map(x => x.rule));

test("demo exercises every family of checks", async () => {
  const res = C.analyze(await demoExp());
  for (const r of ["duplicate_well_assignment", "invalid_well_coordinate", "unmapped_well", "non_numeric_ct", "missing_ct", "replicate_dispersion",
    "ntc_amplification", "nrt_amplification", "std_curve_summary", "amp_ct_without_rise", "amp_rise_without_ct", "amp_ct_inconsistent",
    "amp_curve_missing", "melt_multiple_peaks", "melt_tm_deviation", "ntc_melt_peak", "missing_metadata"])
    assert.ok(rules(res).has(r), r);
  assert.equal(res.summary.status, "review_needed");
  const sc = res.stdCurves[0];
  assert.ok(sc.efficiency > 95 && sc.efficiency < 99 && sc.r2 > 0.999, `${sc.efficiency} ${sc.r2}`);
});

test("analysis is idempotent apart from timestamps (FR-27)", async () => {
  const e = await demoExp();
  assert.deepEqual(JSON.stringify(C.analyze(e).findings), JSON.stringify(C.analyze(e).findings));
});

test("raw values are preserved through import, analysis and export", async () => {
  const e = await demoExp(), res = C.analyze(e);
  assert.equal(res.rows.find(r => r.key === "C6").ct, "abc");
  assert.equal(res.rows.find(r => r.key === "C8").ct, "Undetermined");
  const csv = R.wellsCsv(res);
  assert.match(csv, /,abc,/); assert.match(csv, /,Undetermined,/); assert.match(csv, /,Z9,,/);
  assert.equal(res.rows.length, f.results.trim().split("\n").length - 1); // nothing dropped
});

test("missing curve data is reported as not assessed, never as passing", async () => {
  const res = C.analyze(await demoExp({ amp: false, melt: false }));
  assert.ok(res.notAssessed.some(x => x.startsWith("Amplification curves")));
  assert.ok(res.notAssessed.some(x => x.startsWith("Melt curves")));
  assert.ok(![...rules(res)].some(r => r.startsWith("amp_") || r.startsWith("melt_")));
});

test("melt checks only run when configured (FR-12)", async () => {
  const res = C.analyze(await demoExp({ meltChecks: false }));
  assert.ok(res.notAssessed.some(x => x.includes("not enabled")));
  assert.ok(!rules(res).has("melt_multiple_peaks"));
});

test("thresholds are configurable and rule severity follows them", async () => {
  const e = await demoExp();
  e.ruleset.values.sdThreshold = 5;
  assert.ok(!rules(C.analyze(e)).has("replicate_dispersion"));
  e.ruleset.values.ntcCtThreshold = 30;
  assert.equal(C.analyze(e).findings.find(x => x.rule === "ntc_amplification").severity, "medium");
  const changed = C.rulesetChanges(e.ruleset).map(c => c.key);
  assert.ok(changed.includes("sdThreshold") && changed.includes("ntcCtThreshold"));
});

test("control marked not applicable replaces the missing-control finding", async () => {
  const e = await demoExp();
  e.ruleset.values.expectPositive = true;
  e.source.text = f.results.split("\n").filter(l => !l.includes("Pos Ctrl")).join("\n");
  assert.ok(C.analyze(e).findings.some(x => x.id === "missing_control:positive|GAPDH"));
  e.controlNA["positive|GAPDH"] = { reason: "validated assay", by: "t", at: new Date().toISOString() };
  const res = C.analyze(e);
  assert.ok(!res.findings.some(x => x.id === "missing_control:positive|GAPDH"));
  assert.ok(res.findings.some(x => x.id === "control_not_applicable:positive|GAPDH"));
});

test("review dispositions change status but not findings (FR-15)", async () => {
  const e = await demoExp(), before = C.analyze(e);
  for (const x of before.findings) e.reviews[x.id] = { disposition: "accepted" };
  const after = C.analyze(e);
  assert.deepEqual(after.findings.map(x => x.id), before.findings.map(x => x.id));
  assert.equal(after.summary.status, "findings_present");
  assert.equal(after.summary.open, 0);
});

test("plate-map edits are labels only; file values stay visible", async () => {
  const e = await demoExp(), rows = C.analyze(e).rows, b1 = rows.find(r => r.key === "B1");
  e.map[b1.id] = { sample: "ctrl-3" };
  const r2 = C.analyze(e).rows.find(r => r.key === "B1");
  assert.equal(r2.sample, "ctrl-3"); assert.equal(r2.file.sample, null); assert.equal(r2.ct, "18.31");
  assert.ok(!C.analyze(e).findings.some(x => x.rule === "unmapped_well" && x.wells.includes("B1")));
});

test("template import applies labels and reports coverage mismatches", async () => {
  const e = await demoExp(), rows = C.analyze(e).rows;
  const tpl = C.parseTemplate("well,role,bio_unit\nF5,empty,\nH12,sample,x\nQ99,sample,y\n");
  const out = C.applyTemplate(e, rows, tpl, { name: "map.csv" });
  assert.equal(out.issues.length, 1); // Q99
  const res = C.analyze(e);
  assert.equal(res.rows.find(r => r.key === "F5").role, "empty");
  assert.ok(res.findings.some(x => x.rule === "map_wells_not_in_data" && x.wells.includes("H12")));
  assert.ok(res.findings.some(x => x.rule === "data_wells_not_in_map"));
});

test("Bio-Rad CFX layout is detected", () => {
  const p = C.parseResults(",Well,Fluor,Target,Content,Sample,Cq\n0,A01,SYBR,GAPDH,Unkn-01,s1,18.2\n1,A02,SYBR,GAPDH,NTC,NTC,NaN\n2,A03,SYBR,GAPDH,Neg Ctrl,x,NaN\n");
  assert.equal(p.format, "biorad-cfx-cq");
  assert.deepEqual(p.rows.map(r => [r.key, r.role, r.ct]), [["A1", "sample", "18.2"], ["A2", "ntc", "NaN"], ["A3", null, "NaN"]]);
  assert.ok(p.warnings.some(w => w.includes("Neg Ctrl")));
});

test("QuantStudio layout is detected, with header metadata and true line numbers", () => {
  const p = C.parseResults("* Instrument Type = QuantStudio 5\n* Block Type = 96-Well 0.2-mL Block\n\n[Results]\nWell\tWell Position\tSample Name\tTarget Name\tTask\tCт\n1\tA1\ts1\tGAPDH\tUNKNOWN\t18.2\n2\tA2\tNTC\tGAPDH\tNTC\tUndetermined\n\n[Melt Curve Result]\nfoo\n");
  assert.equal(p.format, "thermo-quantstudio");
  assert.equal(p.metadata["Instrument Type"], "QuantStudio 5");
  assert.deepEqual(p.rows.map(r => [r.line, r.key, r.role, r.ct]), [[6, "A1", "sample", "18.2"], [7, "A2", "ntc", "Undetermined"]]);
});

test("unsafe input fails before any check runs (FR-26)", () => {
  assert.throws(() => C.parseResults(""), C.ParseError);
  assert.throws(() => C.parseResults("well,sample\nA1,x\n"), /Ct\/Cq/);
  assert.throws(() => C.parseResults("Well,Ct\n1,20\n2,21\n"), e => e.details?.needsPlateSize === true);
  assert.deepEqual(C.parseResults("Well,Ct\n1,20\n13,21\n", { plateSize: 96 }).rows.map(r => r.key), ["A1", "B1"]);
  assert.throws(() => C.parseResults("well,ct,sample\nA1\nA2\nA3,20,x\n"), /could not be parsed/);
  const p = C.parseResults("well,ct,sample\nA1,20,x\nA2,21,y\nA3\n");
  assert.equal(p.malformed.length, 1);
});

test("malformed rows become findings instead of being guessed", async () => {
  const e = C.newExperiment({}, "t"), text = "well,ct,sample,target\nA1,20,x,G\nA2,21,x,G\nA3\n";
  e.source = C.fileRecord({ name: "x.csv", text, sha: await C.sha256(text) });
  const res = C.analyze(e);
  assert.ok(res.findings.some(x => x.rule === "malformed_row" && x.lines[0] === 4));
});

test("curve parser handles long and wide layouts and melt value types", () => {
  const amp = C.parseCurves(f.amp, "amp"), melt = C.parseCurves(f.melt, "melt");
  assert.equal(amp.layout, "long"); assert.equal(melt.layout, "wide"); assert.equal(melt.guessedValueType, "derivative");
  const raw = C.parseCurves("Temperature,A1\n70,10\n75,9\n80,8\n85,2\n90,1\n95,0.5\n", "melt");
  assert.equal(raw.guessedValueType, "fluorescence");
});

test("report escapes file content and states limits", async () => {
  const e = C.newExperiment({ title: "<b>x</b>" }, "t"), text = 'well,sample,target,ct\nA1,"<script>alert(1)</script>",G,20\n';
  e.source = C.fileRecord({ name: "x.csv", text, sha: await C.sha256(text) });
  const html = R.reportHtml(e, C.analyze(e));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /doesn't certify/);
  assert.match(html, /Not checked/);
});

test("packets round-trip and detect tampering", async () => {
  const e = await demoExp(), packet = JSON.parse(R.packetJson(e, C.analyze(e)));
  const back = await C.verifyPacket(packet);
  assert.equal(back.id, e.id);
  assert.deepEqual(C.analyze(back).findings.map(x => x.id), C.analyze(e).findings.map(x => x.id));
  packet.experiment.source.text = packet.experiment.source.text.replace("18.31", "18.30");
  await assert.rejects(C.verifyPacket(packet), /Checksum mismatch/);
});

test("run comparison lists differing variables", async () => {
  const a = await demoExp(), b = await demoExp();
  b.context.protocol = "SOP v3"; b.ruleset.values.sdThreshold = 0.5;
  const c = C.compareRuns(a, C.analyze(a), b, C.analyze(b));
  const diff = c.fields.filter(x => !x.same).map(x => x.label);
  assert.ok(diff.includes("Protocol name and version") && diff.some(x => x.startsWith("Rule: Technical")));
  assert.ok(c.groups.every(g => g.delta === null || g.delta === 0));
});

test("rule catalog is complete", () => {
  for (const [id, r] of Object.entries(C.RULES)) for (const k of ["version", "category", "severity", "title", "checks", "why"]) assert.ok(r[k], `${id}.${k}`);
});

test("detectFileKind tells results, amplification and melt files apart", () => {
  assert.equal(C.detectFileKind(f.results).kind, "results");
  assert.equal(C.detectFileKind(f.amp).kind, "amp");
  assert.equal(C.detectFileKind(f.melt).kind, "melt");
  assert.equal(C.detectFileKind("hello,world\n1,2\n").kind, null);
  const sds = C.detectFileKind("Well\tSample Name\tDetector\tCt\n1\ta\tG\t20\n13\tb\tG\t21\n");
  assert.equal(sds.kind, "results"); assert.ok(sds.needsPlateSize);
});

test("nextSteps follows the run's state", async () => {
  const e = await demoExp(), res = C.analyze(e);
  const s = Object.fromEntries(C.nextSteps(e, res).map(x => [x.id, x]));
  assert.ok(s.upload.done);
  assert.ok(!s.labels.done && s.labels.text.includes("B1"));
  assert.ok(s.controls.done);
  assert.ok(!s.flags.done && !s.report.done);
  for (const x of res.findings) e.reviews[x.id] = { disposition: "accepted" };
  C.logAudit(e, "t", "export", "Report: x.report.html");
  const after = Object.fromEntries(C.nextSteps(e, C.analyze(e)).map(x => [x.id, x]));
  assert.ok(after.labels.done && after.flags.done && after.report.done);
  assert.equal(C.nextSteps(C.newExperiment({}, "t"), null)[0].id, "upload");
});
