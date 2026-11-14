// ComBat batch correction (Johnson, Li & Rabinovic 2007, Biostatistics 8:118-127), used here to line up plates.
// Pure functions, no DOM. The formulas, the reasons behind each choice and the limits are in docs/analysis.md.
//
// combat() is the general method on a features x samples matrix: parametric empirical Bayes location/scale
// adjustment, or location only ("mean-only"), with group labels kept in the model so that real group
// differences are not taken out with the plate effect. It follows sva::ComBat step by step (n - 1 variances,
// the same priors, the same iteration and stopping rule), and tests/combat.test.mjs checks it against
// neuroCombat, a Python port of sva::ComBat (tests/fixtures/combat-reference.json, testdata/make-combat-reference.py).
//
// combatRecords() is the bridge to analysis.js: it builds ΔCt per biological unit and plate, runs combat()
// with plate as batch and group as covariate, and writes the corrected values back as Ct.

export const MIN_PER_PLATE = 2;        // below this a plate has no variance at all; ComBat can't run
export const MIN_TARGETS = 2;          // the prior on plate effects is estimated across targets; it needs at least two
export const ADVISED_TARGETS = 20;     // below this the prior rests on too few numbers to help much (see docs)
export const ADVISED_PER_PLATE = 4;    // below this a plate's variance is too rough to rescale by; use mean-only

export class CombatError extends Error {
  constructor(code, message) { super(message); this.name = "CombatError"; this.code = code; }
}

const ok = v => typeof v === "number" && Number.isFinite(v);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const avg = xs => sum(xs) / xs.length;
const var1 = xs => { const m = avg(xs); return sum(xs.map(x => (x - m) ** 2)) / (xs.length - 1); }; // n - 1, as R's var()
const uniq = xs => [...new Set(xs)];

// Rank of a matrix (array of rows) by Gaussian elimination with partial pivoting.
export function rank(rows, tol = 1e-9) {
  const m = rows.map(r => r.slice());
  const nr = m.length, nc = nr ? m[0].length : 0;
  const scale = Math.max(1, ...m.flat().map(Math.abs));
  let r = 0;
  for (let c = 0; c < nc && r < nr; c++) {
    let p = r;
    for (let i = r + 1; i < nr; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;
    if (Math.abs(m[p][c]) <= tol * scale) continue;
    [m[r], m[p]] = [m[p], m[r]];
    for (let i = r + 1; i < nr; i++) {
      const f = m[i][c] / m[r][c];
      for (let k = c; k < nc; k++) m[i][k] -= f * m[r][k];
    }
    r++;
  }
  return r;
}

// Least squares: solves (X'X) b = X'y. X is assumed to have full column rank (checked by the caller).
function lsq(X, y) {
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < X.length; i++) for (let a = 0; a < p; a++) {
    if (!X[i][a]) continue;
    for (let b = 0; b < p; b++) A[a][b] += X[i][a] * X[i][b];
    A[a][p] += X[i][a] * y[i];
  }
  for (let c = 0; c < p; c++) {
    let q = c;
    for (let i = c + 1; i < p; i++) if (Math.abs(A[i][c]) > Math.abs(A[q][c])) q = i;
    [A[c], A[q]] = [A[q], A[c]];
    for (let i = 0; i < p; i++) if (i !== c) {
      const f = A[i][c] / A[c][c];
      for (let k = c; k <= p; k++) A[i][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / row[i]);
}

// data: features x samples (numbers; null, undefined or NaN where a value is missing).
// batch: one label per sample. group: one label per sample, or null for no covariate.
// Returns the adjusted matrix (missing values stay missing) plus every estimate, so the steps can be checked.
export function combat(data, batch, { group = null, meanOnly = false, conv = 1e-4, maxIter = 10000, names = null } = {}) {
  const n = batch.length, G = data.length;
  if (!G) throw new CombatError("empty", "There are no values to correct.");
  if (data.some(r => r.length !== n) || (group && group.length !== n)) throw new CombatError("shape", "Every feature needs one value per sample.");
  const fname = g => (names ? names[g] : `feature ${g + 1}`);
  const batches = uniq(batch), B = batches.length, bi = batch.map(b => batches.indexOf(b));
  if (B < 2) throw new CombatError("one-batch", "ComBat needs at least two plates.");
  const nPer = batches.map((_, j) => bi.filter(x => x === j).length);
  const small = batches.filter((_, j) => nPer[j] < MIN_PER_PLATE);
  if (small.length) throw new CombatError("single-sample",
    `${small.join(", ")} ${small.length > 1 ? "have" : "has"} only one sample. ComBat estimates each plate's effect from the spread of its samples, and one sample has no spread, so a plate effect can't be told apart from that sample's own biology. Every plate needs at least ${MIN_PER_PLATE} samples (I'd want ${ADVISED_PER_PLATE} or more).`);

  // Design: one indicator per batch, then one column per group level except the first (the intercept is the batch columns).
  const levels = group ? uniq(group) : [];
  const design = Array.from({ length: n }, (_, i) => [...batches.map((_, j) => (bi[i] === j ? 1 : 0)), ...levels.slice(1).map(l => (group[i] === l ? 1 : 0))]);
  const P = B + Math.max(0, levels.length - 1);
  if (rank(design) < P) throw new CombatError("confounded",
    "Groups and plates are confounded: the plates can't be separated from the groups (for example every control on one plate and every treated sample on another). ComBat would then remove the group difference along with the plate effect. Put samples from several groups on each plate, or use a calibrator sample run on every plate.");

  const notes = [];
  const out = data.map(r => r.map(v => (ok(v) ? v : null)));
  const has = data.map(r => r.map(ok));
  // 1. Per feature: regression on batch + group, grand mean, pooled variance, standardised data.
  const fit = data.map((row, g) => {
    const idx = [...Array(n).keys()].filter(i => has[g][i]);
    if (idx.length < 2) return null;
    const cols = [...Array(P).keys()].filter(c => idx.some(i => design[i][c] !== 0));
    const X = idx.map(i => cols.map(c => design[i][c])), y = idx.map(i => row[i]);
    if (rank(X) < cols.length) { notes.push(`${fname(g)}: on the samples where it was measured, groups and plates are confounded, so it was left as it was.`); return null; }
    const b = lsq(X, y), beta = new Array(P).fill(0);
    cols.forEach((c, k) => { beta[c] = b[k]; });
    const cnt = batches.map((_, j) => idx.filter(i => bi[i] === j).length);
    const grand = sum(batches.map((_, j) => (cnt[j] / idx.length) * beta[j]));
    const mod = i => sum(levels.slice(1).map((_, k) => design[i][B + k] * beta[B + k]));
    const varPooled = sum(idx.map((i, k) => (y[k] - sum(design[i].map((d, c) => d * beta[c]))) ** 2)) / idx.length;
    if (!(varPooled > 1e-14)) { notes.push(`${fname(g)}: no variation left after the model, so it was left as it was.`); return null; }
    const standMean = Array.from({ length: n }, (_, i) => grand + mod(i));
    const s = Array.from({ length: n }, (_, i) => (has[g][i] ? (row[i] - standMean[i]) / Math.sqrt(varPooled) : null));
    return { beta, grand, varPooled, standMean, s };
  });
  // 2. Per feature and batch: the plate's location (gamma hat) and scale (delta hat) on the standardised data.
  const cell = fit.map((f, g) => f && batches.map((_, j) => {
    const v = [...Array(n).keys()].filter(i => bi[i] === j && has[g][i]).map(i => f.s[i]);
    return v.length < 2 ? (v.length ? { short: true } : null) : { v, gHat: avg(v), dHat: meanOnly ? 1 : var1(v) };
  }));
  // A feature with no spread at all within a plate can't be rescaled; sva::ComBat leaves such features out, and so do I.
  cell.forEach((c, g) => {
    if (c && !meanOnly && c.some(x => x && !x.short && !(x.dHat > 1e-14))) {
      notes.push(`${fname(g)}: identical values on ${batches.filter((_, j) => c[j] && !c[j].short && !(c[j].dHat > 1e-14)).join(", ")}, so it was left as it was.`);
      fit[g] = null; cell[g] = null;
    }
  });
  cell.forEach((c, g) => { if (c) c.forEach((x, j) => { if (x?.short) notes.push(`${fname(g)} has only one value on ${batches[j]}, so it was left as it was on that plate.`); }); });

  // 3. Empirical Bayes: priors per batch from all features, then the posterior estimates.
  const per = batches.map((label, j) => {
    const fs = [...Array(G).keys()].filter(g => cell[g]?.[j] && !cell[g][j].short);
    if (fs.length < MIN_TARGETS) throw new CombatError("few-features",
      `${label} has ${fs.length} target${fs.length === 1 ? "" : "s"} that can be corrected. ComBat estimates how large plate effects usually are from all targets together, so it needs at least ${MIN_TARGETS} (and works well from about ${ADVISED_TARGETS}).`);
    const gh = fs.map(g => cell[g][j].gHat), dh = fs.map(g => cell[g][j].dHat);
    const gBar = avg(gh), t2 = var1(gh);
    let a = null, b = null;
    if (!meanOnly) {
      const m = avg(dh), s2 = var1(dh);
      if (!(s2 > 0)) throw new CombatError("prior", `On ${label} every target has the same spread, so the prior on plate scale can't be estimated. Use the mean-only option.`);
      a = (2 * s2 + m * m) / s2; b = (m * s2 + m ** 3) / s2;
    }
    const gStar = new Array(G).fill(null), dStar = new Array(G).fill(null);
    let iterations = 0;
    if (meanOnly) for (const g of fs) { gStar[g] = (t2 * cell[g][j].gHat + gBar) / (t2 + 1); dStar[g] = 1; }
    else {
      const nn = fs.map(g => cell[g][j].v.length);
      let gOld = gh.slice(), dOld = dh.slice(), change = 1, gNew = gh, dNew = dh;
      while (change > conv && iterations < maxIter) {
        gNew = gh.map((x, k) => (t2 * nn[k] * x + dOld[k] * gBar) / (t2 * nn[k] + dOld[k]));
        dNew = fs.map((g, k) => (0.5 * sum(cell[g][j].v.map(v => (v - gNew[k]) ** 2)) + b) / (nn[k] / 2 + a - 1));
        const rel = (nw, od) => nw.map((x, k) => Math.abs(x - od[k]) / (od[k] === 0 ? 1 : Math.abs(od[k])));
        change = Math.max(...rel(gNew, gOld), ...rel(dNew, dOld));
        gOld = gNew; dOld = dNew; iterations++;
      }
      fs.forEach((g, k) => { gStar[g] = gNew[k]; dStar[g] = dNew[k]; });
    }
    return { batch: label, n: nPer[j], features: fs.length, gammaBar: gBar, t2, aPrior: a, bPrior: b, gammaStar: gStar, deltaStar: dStar, iterations,
      gammaHat: fs.reduce((o, g, k) => ((o[g] = gh[k]), o), new Array(G).fill(null)), deltaHat: fs.reduce((o, g, k) => ((o[g] = dh[k]), o), new Array(G).fill(null)) };
  });
  // 4. Adjust: take the plate's location out, divide by its scale, and put the pooled scale and model mean back.
  const adjusted = Array.from({ length: G }, () => new Array(B).fill(false));
  for (let g = 0; g < G; g++) {
    const f = fit[g];
    if (!f) continue;
    for (let i = 0; i < n; i++) {
      const j = bi[i], gs = per[j].gammaStar[g];
      if (!has[g][i] || gs === null) continue;
      out[g][i] = ((f.s[i] - gs) / Math.sqrt(per[j].deltaStar[g])) * Math.sqrt(f.varPooled) + f.standMean[i];
      adjusted[g][j] = true;
    }
  }
  return { data: out, batches, meanOnly, adjusted, perBatch: per, varPooled: fit.map(f => (f ? f.varPooled : null)), notes };
}

// ---------------------------------------------------------------- bridge to analysis.js
// plates: [{ plate, records: [{ unit, group, target, ct, tech: [{ ct }] }] }] as built by analysis.plateRecords().
// refs: the reference genes; weight(t): log2 of the efficiency factor (1 at 100%), as used in analysis.compute().
// Changes the records in place, like analysis.calibrate(), and returns a summary in the same shape.
export function combatRecords(plates, { refs = [], weight = () => 1, meanOnly = false } = {}) {
  const out = { mode: "combat", meanOnly, offsets: [], unconnected: [], warnings: [], applied: false, combat: null };
  out.warnings.push(`ComBat (Johnson et al. 2007) on ΔCt, ${meanOnly ? "plate location only (mean-only)" : "plate location and scale"}, with group as a covariate so group differences are kept. It assumes every target is shifted by its own plate effect and that groups are spread over the plates. It needs several samples per plate (at least ${MIN_PER_PLATE}, better ${ADVISED_PER_PLATE} or more) and many targets: the size of plate effects is learnt from all targets together, so with fewer than about ${ADVISED_TARGETS} targets a calibrator sample on every plate is the better choice.`);
  if (!refs.length) {
    out.warnings.push("ComBat works on ΔCt, so it needs the reference gene(s). Until you pick them the plates are combined without correction.");
    return out;
  }
  // Samples: one per plate and grouped biological unit with every reference measured on that plate.
  const samples = [], skipped = [];
  plates.forEach(p => {
    const byUnit = new Map();
    for (const r of p.records) { if (!byUnit.has(r.unit)) byUnit.set(r.unit, []); byUnit.get(r.unit).push(r); }
    for (const [unit, recs] of byUnit) {
      if (!recs[0].group && !recs.some(r => r.group)) continue; // calibrators and unlabelled units: not part of the model
      const t = Object.fromEntries(recs.map(r => [r.target, r]));
      if (!refs.every(r => t[r])) { skipped.push(`${unit} on ${p.plate}`); continue; }
      samples.push({ plate: p.plate, unit, group: recs.find(r => r.group).group, t, ref: avg(refs.map(r => weight(r) * t[r].ct)) });
    }
  });
  if (skipped.length) out.warnings.push(`ComBat: ${skipped.length} biological unit(s) have no reference value on a plate and were not corrected there: ${skipped.slice(0, 8).join(", ")}${skipped.length > 8 ? ` and ${skipped.length - 8} more` : ""}.`);
  const onPlates = t => uniq(samples.filter(s => s.t[t]).map(s => s.plate)).length;
  const allT = uniq(samples.flatMap(s => Object.keys(s.t))).filter(t => !refs.includes(t));
  const targets = allT.filter(t => onPlates(t) >= 2), lone = allT.filter(t => onPlates(t) < 2);
  if (lone.length) out.warnings.push(`ComBat: ${lone.join(", ")} ${lone.length > 1 ? "are" : "is"} on one plate only, so there is nothing to line up for ${lone.length > 1 ? "them" : "it"}.`);
  const used = samples.filter(s => targets.some(t => s.t[t]));
  const plateNames = uniq(used.map(s => s.plate));
  if (plateNames.length < 2) { out.warnings.push("ComBat: fewer than two plates share a target with grouped samples, so nothing was corrected."); return out; }
  const repeated = uniq(used.map(s => s.unit)).filter(u => used.filter(s => s.unit === u).length > 1);
  if (repeated.length) out.warnings.push(`ComBat treats ${repeated.length} biological unit(s) measured on several plates (${repeated.slice(0, 6).join(", ")}) as separate samples on each plate while it estimates the plate effects. After the correction their values are averaged across plates, so each still counts once in the statistics.`);
  const data = targets.map(t => used.map(s => (s.t[t] ? weight(t) * s.t[t].ct - s.ref : null)));
  let res;
  try {
    res = combat(data, used.map(s => s.plate), { group: used.map(s => s.group), meanOnly, names: targets });
  } catch (e) {
    if (!(e instanceof CombatError)) throw e;
    out.refused = e.message;
    out.warnings.push(`ComBat was not applied: ${e.message} The plates were combined without correction.`);
    return out;
  }
  out.warnings.push(...res.notes.map(x => `ComBat: ${x}`));
  if (targets.length < ADVISED_TARGETS) out.warnings.push(`ComBat with ${targets.length} target${targets.length === 1 ? "" : "s"}: the prior on plate effects is estimated from only ${targets.length} numbers per plate, so the empirical Bayes step does little more than per-plate centring with a group term. For a qPCR panel this small I'd use a calibrator sample on every plate instead.`);
  const thin = res.perBatch.filter(b => b.n < ADVISED_PER_PLATE);
  if (thin.length && !meanOnly) out.warnings.push(`ComBat: ${thin.map(b => `${b.batch} (${b.n} samples)`).join(", ")} ${thin.length > 1 ? "have" : "has"} fewer than ${ADVISED_PER_PLATE} samples, so the plate's spread is a rough estimate. Consider the mean-only option, which only shifts each plate.`);
  // Write back as Ct: ΔCt' = w·Ct' − reference level, so Ct' = (ΔCt' + reference level) / w. Reference genes are untouched.
  const before = [], after = [];
  targets.forEach((t, g) => {
    const vals = data[g].filter(ok), adj = res.data[g].filter(ok), mb = avg(vals), ma = avg(adj);
    used.forEach((s, i) => {
      if (!ok(data[g][i])) return;
      before.push({ plate: s.plate, target: t, value: data[g][i] - mb });
      after.push({ plate: s.plate, target: t, value: res.data[g][i] - ma });
    });
    for (const [j, plate] of res.batches.entries()) {
      if (!res.adjusted[g][j]) continue;
      const pb = res.perBatch[j], shifts = [];
      used.forEach((s, i) => {
        if (s.plate !== plate || !ok(data[g][i])) return;
        const r = s.t[t], ct = (res.data[g][i] + s.ref) / weight(t), shift = r.ct - ct;
        r.ct = ct;
        r.tech = r.tech.map(x => ({ ...x, ct: x.ct - shift }));
        shifts.push(shift);
      });
      out.offsets.push({ plate, target: t, factor: pb.gammaStar[g] * Math.sqrt(res.varPooled[g]), scale: pb.deltaStar[g], shift: avg(shifts) });
      out.applied = true;
    }
  });
  out.combat = { targets, plates: res.batches, samples: used.length, perPlate: res.perBatch.map(b => ({ plate: b.batch, n: b.n, targets: b.features })), before, after };
  return out;
}
