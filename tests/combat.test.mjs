// ComBat (web/combat.js): agreement with neuroCombat (a port of sva::ComBat), the designs it must refuse,
// and what it must do to a study: remove a planted plate shift and keep a real group difference.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as C from "../web/core.js";
import * as A from "../web/analysis.js";
import { combat, CombatError, rank } from "../web/combat.js";

const REF = JSON.parse(readFileSync(new URL("./fixtures/combat-reference.json", import.meta.url), "utf8"));
let seed = 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const norm = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const refused = (fn, code) => assert.throws(fn, e => e instanceof CombatError && e.code === code);

test("matches neuroCombat (sva::ComBat) on every reference case to 1e-6", () => {
  assert.ok(REF.cases.length >= 8);
  for (const c of REF.cases) {
    const r = combat(c.data, c.batch, { group: c.group, meanOnly: c.meanOnly });
    let worst = 0;
    c.expected.forEach((row, g) => row.forEach((v, i) => { worst = Math.max(worst, Math.abs(r.data[g][i] - v) / Math.max(1, Math.abs(v))); }));
    assert.ok(worst < 1e-6, `${c.name}: worst relative difference ${worst}`);
    if (c.meanOnly) assert.ok(r.perBatch.every(b => b.deltaStar.every(d => d === null || d === 1)), `${c.name}: mean-only never rescales`);
  }
});

test("refuses a plate with one sample and explains why", () => {
  const data = [[1, 2, 3, 4], [2, 3, 4, 6], [5, 4, 3, 1]];
  refused(() => combat(data, ["A", "A", "A", "B"]), "single-sample");
  assert.throws(() => combat(data, ["A", "A", "A", "B"]), /B has only one sample/);
  refused(() => combat(data, ["A", "A", "A", "A"]), "one-batch");
});

test("refuses designs where group is confounded with plate", () => {
  const data = Array.from({ length: 5 }, () => Array.from({ length: 8 }, norm));
  const plate = ["P1", "P1", "P1", "P1", "P2", "P2", "P2", "P2"];
  refused(() => combat(data, plate, { group: ["c", "c", "c", "c", "t", "t", "t", "t"] }), "confounded");
  // Three plates, groups X on plates 1-2 and Y on plate 3: the group column equals plate 3's column.
  refused(() => combat(data, ["1", "1", "2", "2", "3", "3", "3", "3"], { group: ["X", "X", "X", "X", "Y", "Y", "Y", "Y"] }), "confounded");
  assert.throws(() => combat(data, plate, { group: ["c", "c", "c", "c", "t", "t", "t", "t"] }), /remove the group difference/);
  // Unbalanced but not confounded is fine.
  assert.doesNotThrow(() => combat(data, plate, { group: ["c", "t", "t", "t", "c", "c", "c", "t"] }));
  assert.equal(rank([[1, 0, 1], [1, 0, 1], [0, 1, 0]]), 2);
});

test("keeps a real group difference in an unbalanced design and removes the plate shift", () => {
  seed = 11;
  // Plate 1 is mostly treated, plate 2 mostly control; plate 2 reads 2 cycles later on every target.
  // Target 0 has a true treated-vs-control difference of −3; the other 29 have none.
  const plate = [...Array(8).fill("P1"), ...Array(8).fill("P2")];
  const group = ["t", "t", "t", "t", "t", "t", "c", "c", "c", "c", "c", "c", "c", "c", "t", "t"];
  const base = Array.from({ length: 30 }, () => 5 + 2 * norm());
  const data = base.map((b, g) => plate.map((p, i) => b + (g === 0 && group[i] === "t" ? -3 : 0) + (p === "P2" ? 2 + 0.3 * norm() : 0) + 0.3 * norm()));
  const diff = (row, pl) => avg(row.filter((_, i) => group[i] === "t" && (!pl || plate[i] === pl))) - avg(row.filter((_, i) => group[i] === "c" && (!pl || plate[i] === pl)));
  for (const meanOnly of [false, true]) {
    const r = combat(data, plate, { group, meanOnly });
    assert.ok(Math.abs(diff(r.data[0]) - -3) < 0.35, `group difference kept (mean-only ${meanOnly}): ${diff(r.data[0])}`);
    // the plate shift is gone: same group, different plates, same level
    const ctrl = (row, p) => avg(row.filter((_, i) => group[i] === "c" && plate[i] === p));
    for (let g = 1; g < 30; g++) assert.ok(Math.abs(ctrl(r.data[g], "P2") - ctrl(r.data[g], "P1")) < 0.6, `target ${g} plate shift removed`);
    assert.ok(Math.abs(diff(r.data[5])) < 0.5, "no difference invented");
  }
  // Without the group in the model, the unbalanced design leaks the plate shift into the group difference.
  const naive = combat(data, plate, { group: null });
  assert.ok(Math.abs(diff(naive.data[0]) - -3) > Math.abs(diff(combat(data, plate, { group }).data[0]) - -3), "the covariate matters");
});

test("missing values: a target absent on a plate is left alone there, one value on a plate is noted", () => {
  seed = 5;
  const plate = ["A", "A", "A", "A", "B", "B", "B", "B"];
  const data = Array.from({ length: 6 }, (_, g) => plate.map(p => g + (p === "B" ? 1 : 0) + 0.2 * norm()));
  data[4] = data[4].map((v, i) => (plate[i] === "B" ? null : v));
  data[5] = data[5].map((v, i) => (i === 5 || i === 6 || i === 7 ? NaN : v));
  const r = combat(data, plate);
  assert.deepEqual(r.data[4].slice(4), [null, null, null, null], "missing stays missing");
  assert.deepEqual(r.adjusted[4], [true, false]);
  assert.equal(r.data[5][4], data[5][4], "single value on B left as it was");
  assert.ok(r.notes.some(n => /feature 6 has only one value on B/.test(n)));
  // identical values within a plate: left out entirely, as sva does
  const flat = data.map(row => row.slice());
  flat[0] = [1, 1, 1, 1, 2, 3, 2, 4];
  const f = combat(flat, plate);
  assert.deepEqual(f.data[0], flat[0]);
  assert.ok(f.notes.some(n => /feature 1: identical values on A/.test(n)));
});

// ---------------------------------------------------------------- through analyzeStudy
const wells = []; for (const r of "ABCDEFGHIJKLMNOP") for (let c = 1; c <= 24; c++) wells.push(r + c);
const TARGETS = Array.from({ length: 24 }, (_, k) => `G${k + 1}`);
// units: [[name, group]]; shift: per-target Ct shift on this plate. G1 is 2 cycles lower in treated.
function plateRun(title, units, shift, noise) {
  const rows = ["Well,Sample,Target,Ct,Group"]; let i = 0;
  for (const [u, g] of units) {
    rows.push(`${wells[i++]},${u},GAPDH,${(18 + noise[u].load).toFixed(5)},${g}`);
    for (const t of TARGETS) rows.push(`${wells[i++]},${u},${t},${(25 + noise[u].load + (g === "trt" && t === "G1" ? -2 : 0) + (shift[t] || 0) + noise[u][t]).toFixed(5)},${g}`);
  }
  const e = C.newExperiment({ title }, "tester");
  e.source = C.fileRecord({ name: `${title}.csv`, text: rows.join("\n") + "\n", sha: "x", format: "generic-ct-csv" });
  return { exp: e, res: C.analyze(e) };
}
function study(withShift) {
  seed = 99;
  const layout = [["P1", [["a1", "ctrl"], ["a2", "ctrl"], ["a3", "trt"], ["a4", "trt"]]], ["P2", [["b1", "ctrl"], ["b2", "trt"], ["b3", "trt"], ["b4", "trt"]]], ["P3", [["c1", "ctrl"], ["c2", "ctrl"], ["c3", "ctrl"], ["c4", "trt"]]]];
  const noise = {};
  for (const [, us] of layout) for (const [u] of us) noise[u] = { load: 0.3 * norm(), ...Object.fromEntries(TARGETS.map(t => [t, 0.2 * norm()])) };
  const shifts = { P1: 0, P2: 1.5, P3: -1 };
  return layout.map(([p, us]) => plateRun(p, us, withShift ? Object.fromEntries(TARGETS.map(t => [t, shifts[p] * (1 + 0.2 * norm())])) : {}, noise));
}
const settings = { on: true, refs: ["GAPDH"], control: "ctrl" };
const row = (a, t, g) => a.summary.find(r => r.target === t && r.group === g);

test("study: ComBat removes a planted plate shift and keeps the G1 difference", () => {
  const truth = A.analyzeStudy(study(false), { settings, mode: "none" });
  const shifted = study(true);
  const raw = A.analyzeStudy(shifted, { settings, mode: "none" });
  const cb = A.analyzeStudy(shifted, { settings, mode: "combat" });
  assert.equal(cb.ok, true);
  assert.equal(cb.calibration.mode, "combat");
  assert.equal(cb.calibration.applied, true);
  assert.match(cb.method, /ComBat on ΔCt \(Johnson et al\. 2007/);
  near(row(cb, "G1", "trt").meanDdct, -2, 0.25, "G1 difference kept");
  // the uneven group mix makes the uncorrected shift leak into the result for targets with no real difference
  const err = a => avg(TARGETS.slice(1).map(t => Math.abs(row(a, t, "trt").meanDdct - row(truth, t, "trt").meanDdct)));
  assert.ok(err(raw) > 0.3, `uncorrected error ${err(raw)}`);
  assert.ok(err(cb) < 0.15, `ComBat error ${err(cb)}`);
  assert.ok(row(cb, "G2", "ctrl").sdDct < row(raw, "G2", "ctrl").sdDct / 2, "plate spread taken out of the control group");
  assert.equal(cb.calibration.combat.plates.length, 3);
  assert.equal(cb.calibration.combat.before.length, cb.calibration.combat.after.length);
  // Below 20 targets it would warn; here 24, so no such warning, but the general one is always there
  assert.ok(cb.warnings.some(w => /needs several samples per plate/.test(w)));
  assert.ok(!cb.warnings.some(w => /I'd use a calibrator sample on every plate instead/.test(w)));
  const mo = A.analyzeStudy(shifted, { settings, mode: "combat", combatMeanOnly: true });
  assert.equal(mo.calibration.meanOnly, true);
  assert.ok(mo.calibration.offsets.every(o => o.scale === 1));
});

test("study: ComBat refuses confounded plates and small panels get the calibrator advice", () => {
  seed = 3;
  const noise = u => ({ load: 0.2 * norm(), ...Object.fromEntries(TARGETS.map(t => [t, 0.2 * norm()])) });
  const n = Object.fromEntries(["a1", "a2", "a3", "b1", "b2", "b3"].map(u => [u, noise(u)]));
  const conf = [plateRun("P1", [["a1", "ctrl"], ["a2", "ctrl"], ["a3", "ctrl"]], {}, n), plateRun("P2", [["b1", "trt"], ["b2", "trt"], ["b3", "trt"]], {}, n)];
  const a = A.analyzeStudy(conf, { settings, mode: "combat" });
  assert.equal(a.calibration.applied, false);
  assert.ok(a.warnings.some(w => /ComBat was not applied: Groups and plates are confounded/.test(w)));
  assert.ok(!/ComBat on ΔCt \(/.test(a.method), "method text doesn't claim ComBat ran");
  const one = [plateRun("P1", [["a1", "ctrl"], ["a2", "trt"], ["a3", "ctrl"]], {}, n), plateRun("P2", [["b1", "trt"]], {}, n)];
  assert.ok(A.analyzeStudy(one, { settings, mode: "combat" }).warnings.some(w => /ComBat was not applied: P2 has only one sample/.test(w)));
  // No reference chosen yet: ComBat can't form ΔCt
  assert.ok(A.analyzeStudy(one, { settings: { on: true }, mode: "combat" }).warnings.some(w => /needs the reference gene/.test(w)));
});

test("study: a qPCR-sized panel runs but is told to use a calibrator", () => {
  seed = 8;
  const units = [["a1", "ctrl"], ["a2", "trt"], ["a3", "ctrl"], ["a4", "trt"]], units2 = units.map(([u, g]) => [u.replace("a", "b"), g]);
  const noise = Object.fromEntries([...units, ...units2].map(([u]) => [u, { load: 0.2 * norm(), ...Object.fromEntries(TARGETS.map(t => [t, 0.2 * norm()])) }]));
  const runs = [plateRun("P1", units, {}, noise), plateRun("P2", units2, Object.fromEntries(TARGETS.map(t => [t, 1])), noise)];
  for (const r of runs) r.res.rows = r.res.rows.filter(x => ["GAPDH", "G1", "G2", "G3", "G4", "G5", "G6"].includes(x.target));
  const a = A.analyzeStudy(runs, { settings, mode: "combat" });
  assert.equal(a.calibration.applied, true);
  assert.ok(a.warnings.some(w => /ComBat with 6 targets/.test(w) && /calibrator sample on every plate instead/.test(w)));
});

test("a study keeps the ComBat choice when saved", async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
    key: i => [...mem.keys()][i], get length() { return mem.size; } };
  const S = await import("../web/store.js");
  const s = S.saveStudy({ title: "Panel", mode: "combat", combatMeanOnly: true });
  assert.equal(S.loadStudy(s.id).mode, "combat");
  assert.equal(S.loadStudy(s.id).combatMeanOnly, true);
  assert.equal(S.normalizeStudy({ mode: "combat", combatMeanOnly: "yes" }).combatMeanOnly, false);
  delete globalThis.localStorage;
});

function near(got, want, tol, what) { assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want}`); }
