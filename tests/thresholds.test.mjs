// Threshold evidence: every setting has a stated reason and sources that resolve, the report lists them,
// and the variability numbers behind the Review graphs are right.
import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../web/core.js";
import * as R from "../web/report.js";
import { variabilityData, poissonSd, histogram } from "../web/ui-variability.js";

const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} is not close to ${b}`);

test("every threshold setting has evidence and references that resolve", () => {
  for (const f of C.RULESET_FIELDS) {
    assert.ok(typeof f.evidence === "string" && f.evidence.length > 20, `${f.key}: evidence`);
    assert.ok(typeof f.detail === "string" && f.detail.length > 40, `${f.key}: detail`);
    assert.ok(Array.isArray(f.refs) && f.refs.length > 0, `${f.key}: refs`);
    for (const k of f.refs) assert.ok(C.REFERENCES[k], `${f.key}: unknown reference ${k}`);
  }
});

test("rule references resolve and every reference is complete", () => {
  for (const [id, r] of Object.entries(C.RULES)) for (const k of r.refs || []) assert.ok(C.REFERENCES[k], `${id}: unknown reference ${k}`);
  for (const k of ["replicate_dispersion", "ntc_amplification", "nrt_amplification", "std_curve_efficiency", "std_curve_r2", "melt_tm_deviation", "melt_multiple_peaks", "amp_ct_inconsistent"])
    assert.ok(C.RULES[k].refs?.length && C.RULES[k].evidence, `${k} has evidence`);
  for (const [k, r] of Object.entries(C.REFERENCES)) {
    assert.match(r.doi, /^10\.\d{4,}\/\S+$/, `${k}: doi`);
    assert.match(r.text, /\b(19|20)\d\d\b/, `${k}: year in text`);
    assert.ok(r.short, `${k}: short label`);
  }
  // No reference sits unused.
  const used = new Set([...C.RULESET_FIELDS.flatMap(f => f.refs), ...Object.values(C.RULES).flatMap(r => r.refs || [])]);
  for (const k of Object.keys(C.REFERENCES)) assert.ok(used.has(k), `${k} is not used`);
});

// Two groups of biological units, duplicate wells each, plus an NTC that amplified.
const FIXTURE = "well,sample,target,role,group,bio_unit,ct\n" + [
  ["A1", "c1", "ctrl", 20.0], ["A2", "c1", "ctrl", 20.2], ["A3", "c2", "ctrl", 21.0], ["A4", "c2", "ctrl", 21.2],
  ["A5", "t1", "trt", 22.0], ["A6", "t1", "trt", 22.4], ["A7", "t2", "trt", 23.0], ["A8", "t2", "trt", 23.4],
  ["A9", "t3", "trt", 24.0], ["A10", "t3", "trt", 24.2],
].map(([w, u, g, ct]) => `${w},${u},G,sample,${g},${u},${ct}`).join("\n") + "\nB1,NTC,G,ntc,,,30\n";
async function fixture() {
  const e = C.newExperiment({ title: "fixture" }, "tester");
  e.source = C.fileRecord({ name: "f.csv", text: FIXTURE, sha: await C.sha256(FIXTURE) });
  return [e, C.analyze(e)];
}

test("report lists the references behind the thresholds and the flags raised", async () => {
  const [e, res] = await fixture();
  assert.ok(res.findings.some(f => f.rule === "ntc_amplification"));
  const html = R.reportHtml(e, res);
  assert.match(html, /<h2>References<\/h2>/);
  const refs = C.referencesFor(res.findings);
  for (const k of new Set(C.RULESET_FIELDS.flatMap(f => f.refs))) {
    assert.ok(refs.some(r => r.key === k), `${k} in referencesFor`);
    assert.ok(html.includes(`doi.org/${C.REFERENCES[k].doi}`), `${k} in report`);
  }
  assert.match(html, /<th>Basis<\/th>/);
  assert.ok(html.includes(C.RULESET_FIELDS[0].evidence.replace(/'/g, "&#39;")));
});

test("variability numbers: technical SD per group, biological SD of unit means", async () => {
  const [, res] = await fixture();
  const d = variabilityData(res);
  assert.equal(d.sds.length, 5);
  for (const g of d.groups) close(g.sd, ["t1", "t2"].includes(g.unit) ? Math.SQRT2 * 0.2 : Math.SQRT2 * 0.1);
  assert.equal(d.perTarget.length, 1);
  const t = d.perTarget[0];
  assert.equal(t.target, "G");
  close(t.techPooled, Math.sqrt(0.044));                // (0.02 + 0.02 + 0.08 + 0.08 + 0.02) / 5
  const ctrl = t.bio.find(b => b.group === "ctrl"), trt = t.bio.find(b => b.group === "trt");
  assert.deepEqual([ctrl.n, trt.n], [2, 3]);
  close(ctrl.sd, Math.SQRT1_2);                         // means 20.1 and 21.1
  close(trt.sd, Math.sqrt(((22.2 - 23.1667) ** 2 + (23.2 - 23.1667) ** 2 + (24.1 - 23.1667) ** 2) / 2));
  close(t.bioPooled, Math.sqrt((1 * 0.5 + 2 * trt.sd ** 2) / 3));
});

test("Poisson SD and histogram helpers", () => {
  close(poissonSd(35), 1 / (Math.sqrt(10) * Math.LN2));  // 10 copies: about 0.46 cycles
  close(poissonSd(31.68), 1 / (Math.sqrt(100) * Math.LN2), 2e-3);
  assert.equal(poissonSd(40), null);                       // under 3 copies: not quantitative
  const hst = histogram([0.01, 0.06, 0.07, 0.31], { width: 0.05 });
  assert.deepEqual(hst.bins.map(b => b.count), [1, 2, 0, 0, 0, 0, 1]);
  assert.deepEqual(histogram([]).bins, []);
  assert.deepEqual(variabilityData(null), { groups: [], sds: [], perTarget: [] });
});
