// Relative expression analysis: ΔCt, ΔΔCt, fold change, statistics, and combining several plates.
// Pure functions with no DOM access. Formulas and the reasons behind each choice are in docs/analysis.md.
//
// Nothing here picks reference genes or the control group. The user chooses them; suggestReferences()
// only lists names that look like common reference genes so the user can confirm them.
import { ctNum, cleanAnalysisSettings, toCsv } from "./core.js";
import * as S from "./stats.js";
import { combatRecords } from "./combat.js"; // [combat] plate correction by ComBat (web/combat.js)

export const DEFAULT_SETTINGS = cleanAnalysisSettings({});
export const MIN_N = 3; // biological replicates per group below which I warn
export const ALPHA = 0.05;
const EFF_LOW = 90, EFF_HIGH = 110; // efficiency range (%) outside which I warn when correcting for it

// Names often used for reference genes and small-RNA references. Only used for suggestions.
const REFERENCE_NAMES = [
  /^gapdh?$/i, /^actb$/i, /^b[\s_-]?actin$/i, /^beta[\s_-]?actin$/i, /^β[\s_-]?actin$/i, /^b2m$/i, /^(rn)?18s(1|[\s_-]?rrna)?$/i, /^rn18s1$/i,
  /^hprt1?$/i, /^tbp$/i, /^u6([\s_-]?snrna)?$/i, /^rnu6([\s_-]?(1|2|b))?$/i, /^rnu44$/i, /^rnu48$/i, /^snord4[48]$/i, /^ppia$/i,
  /^rplp0$/i, /^rpl13a$/i, /^ywhaz$/i, /^ubc$/i, /^sdha$/i, /^gusb$/i, /^hmbs$/i, /^pgk1$/i, /^eef1a1$/i, /^tubb$/i, /^5s$/i,
];
export function suggestReferences(targets) {
  return (targets || []).filter(t => typeof t === "string" && REFERENCE_NAMES.some(re => re.test(t.trim())));
}

const mean = xs => S.mean(xs);
const uniq = xs => [...new Set(xs)];
const list = (xs, n = 8) => (xs.length > n ? `${xs.slice(0, n).join(", ")} and ${xs.length - n} more` : xs.join(", "));

// What can be chosen for a run: targets measured in sample wells and the group labels used.
export function choices(res) {
  const rows = (res?.rows || []).filter(r => r.role === "sample" && r.target);
  return { targets: uniq(rows.map(r => r.target)), groups: uniq(rows.filter(r => r.group && r.bio_unit).map(r => r.group)),
    units: uniq(rows.map(r => r.bio_unit).filter(Boolean)), hasGroups: rows.some(r => r.group) };
}

// ---------------------------------------------------------------- 1. one plate → unit × target records
// Each record holds the technical replicates of one biological unit for one target on one plate.
// Units without a group are kept (a calibrator sample usually has none) but left out of the statistics.
export function plateRecords(res, settings, plate = "", calibrators = []) {
  const s = cleanAnalysisSettings(settings) || DEFAULT_SETTINGS, out = { plate, records: [], warnings: [] };
  const excluded = new Set(s.excluded.map(w => w.trim().toUpperCase()));
  const omitted = [], manual = [], noCt = [], ungrouped = new Set(), unitGroups = new Map();
  const by = new Map();
  for (const r of res?.rows || []) {
    if (r.role !== "sample" || !r.target || !r.bio_unit) continue;
    const well = r.key || r.well;
    if (s.skipOmitted && r.omit) { omitted.push(well); continue; }
    if (excluded.has(String(well).toUpperCase())) { manual.push(well); continue; }
    if (!r.group) { if (!calibrators.includes(r.bio_unit)) ungrouped.add(r.bio_unit); }
    else {
      if (!unitGroups.has(r.bio_unit)) unitGroups.set(r.bio_unit, new Set());
      unitGroups.get(r.bio_unit).add(r.group);
    }
    const ct = ctNum(r.ct, r.dc);
    const k = `${r.bio_unit}\u0000${r.target}`;
    if (!by.has(k)) by.set(k, { plate, unit: r.bio_unit, group: r.group, target: r.target, tech: [], missing: [] });
    if (ct === null) { noCt.push(`${well} (${r.target})`); by.get(k).missing.push(well); continue; }
    by.get(k).tech.push({ ct, well, plate });
  }
  for (const u of ungrouped) if (unitGroups.has(u)) ungrouped.delete(u);
  for (const [u, gs] of unitGroups) if (gs.size > 1)
    out.warnings.push(`${plate ? `${plate}: ` : ""}biological unit ${u} is labelled with more than one group (${[...gs].join(", ")}). I used ${[...gs][0]}; fix the labels in the plate map.`);
  for (const rec of by.values()) {
    rec.group = unitGroups.has(rec.unit) ? [...unitGroups.get(rec.unit)][0] : null;
    if (rec.tech.length) out.records.push({ ...rec, ct: mean(rec.tech.map(t => t.ct)) });
  }
  const at = plate ? ` on ${plate}` : "";
  if (omitted.length) out.warnings.push(`Left out ${omitted.length} well(s)${at} marked Omit in the instrument software: ${list(omitted)}.`);
  if (manual.length) out.warnings.push(`Left out ${manual.length} well(s)${at} you chose to exclude: ${list(manual)}.`);
  if (noCt.length) out.warnings.push(`${noCt.length} sample well(s)${at} have no Ct/Cq (for example Undetermined) and were left out: ${list(noCt)}. If a gene didn't amplify because it isn't expressed, leaving those wells out makes its level look higher than it is.`);
  if (ungrouped.size) out.warnings.push(`${ungrouped.size} biological unit(s)${at} have no group label and were left out of the comparisons: ${list([...ungrouped])}. Add the group in the plate map.`);
  return out;
}

// ---------------------------------------------------------------- 2. several plates → calibration
// mode "calibrator": inter-run calibration as in qBase (Hellemans et al. 2007). For each target and plate, the
// calibration factor is the mean Ct of the calibrator samples (the log of the geometric mean of their quantities);
// subtracting it per gene and plate is the same, on the log scale, as dividing NRQs by qBase's calibration factor.
// mode "centre": every Ct of a target on a plate is shifted so the plate's mean for that target matches the
// overall mean. mode "none": plates are combined as they are. mode "combat": ComBat on ΔCt (web/combat.js).
export function calibrate(plates, { mode = "calibrator", calibrators = [], combat = {} } = {}) {
  const out = { mode, offsets: [], unconnected: [], warnings: [], applied: false };
  if (plates.length < 2) return { ...out, mode: "single" };
  if (mode === "combat") return combatRecords(plates, combat); // [combat] combat = { refs, weight, meanOnly }
  const cal = new Set(calibrators);
  if (mode === "calibrator" && !cal.size) {
    out.warnings.push("No calibrator sample was chosen, so the plates were combined without any correction for differences between runs.");
    return { ...out, mode: "none" };
  }
  if (mode === "none") {
    out.warnings.push("The plates were combined without any correction for differences between runs. Only do this if all plates were run and analysed under identical conditions.");
    return out;
  }
  if (mode === "centre") out.warnings.push("Plate-wise centring: each target's Ct values were shifted so every plate has the same mean. This assumes each plate holds a similar mix of groups. If one plate holds mostly one group, centring removes real differences. A calibrator sample run on every plate is better.");
  if (mode === "calibrator") {
    // Plates are connected when they share a calibrator with data. Report plates outside the largest connected set.
    const has = plates.map(p => new Set(p.records.filter(r => cal.has(r.unit)).map(r => r.unit)));
    const parent = plates.map((_, i) => i), find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < plates.length; i++) for (let j = i + 1; j < plates.length; j++)
      if ([...has[i]].some(u => has[j].has(u))) parent[find(i)] = find(j);
    const sizes = new Map();
    plates.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) || 0) + 1));
    const big = [...sizes].sort((a, b) => b[1] - a[1])[0][0];
    out.unconnected = plates.filter((_, i) => find(i) !== big).map(p => p.plate);
    if (out.unconnected.length) out.warnings.push(`Not connected by a calibrator: ${out.unconnected.join(", ")}. These plates share no calibrator sample with the others, so differences between them and the other plates can't be corrected.`);
  }
  const targets = uniq(plates.flatMap(p => p.records.map(r => r.target)));
  for (const t of targets) {
    const on = plates.filter(p => p.records.some(r => r.target === t));
    if (on.length < 2) continue;
    let factor;
    if (mode === "calibrator") {
      const sets = on.map(p => new Set(p.records.filter(r => r.target === t && cal.has(r.unit)).map(r => r.unit)));
      const common = [...sets[0]].filter(u => sets.every(s => s.has(u)));
      if (!common.length) {
        out.warnings.push(`${t}: no calibrator was measured on every plate that has ${t} (${on.map(p => p.plate).join(", ")}), so ${t} was left uncalibrated.`);
        continue;
      }
      factor = p => mean(p.records.filter(r => r.target === t && common.includes(r.unit)).map(r => r.ct));
      out.basis = out.basis || {};
      out.basis[t] = common;
    } else factor = p => mean(p.records.filter(r => r.target === t).map(r => r.ct));
    const f = on.map(factor), centre = mean(f);
    on.forEach((p, i) => {
      const shift = f[i] - centre;
      out.offsets.push({ plate: p.plate, target: t, factor: f[i], shift });
      for (const r of p.records) if (r.target === t) {
        r.ct -= shift;
        r.tech = r.tech.map(x => ({ ...x, ct: x.ct - shift }));
      }
    });
    out.applied = true;
  }
  return out;
}

// ---------------------------------------------------------------- 3. records → ΔCt, ΔΔCt, statistics
function efficiencies(stdCurves, targets, on) {
  const out = {}, warnings = [];
  for (const t of targets) {
    const effs = (stdCurves || []).filter(c => c.target === t && Number.isFinite(c.efficiency) && c.efficiency > -100).map(c => c.efficiency);
    if (on && effs.length) {
      const e = mean(effs);
      out[t] = { efficiency: e, E: 1 + e / 100, source: effs.length > 1 ? `mean of ${effs.length} standard curves` : "standard curve" };
      if (e < EFF_LOW || e > EFF_HIGH) warnings.push(`${t}: efficiency ${e.toFixed(1)}% is outside ${EFF_LOW}–${EFF_HIGH}%. The correction uses it as it is, so check the standard curve.`);
    } else out[t] = { efficiency: 100, E: 2, source: on ? "assumed (no standard curve)" : "assumed" };
  }
  const assumed = targets.filter(t => on && out[t].source.startsWith("assumed"));
  if (assumed.length) warnings.push(`Efficiency correction is on, but ${list(assumed)} ${assumed.length === 1 ? "has" : "have"} no standard curve, so I assumed 100% (doubling every cycle) for ${assumed.length === 1 ? "it" : "them"}.`);
  return { eff: out, warnings };
}

export function compute(records, settings, { stdCurves = [], plates = [""], calibration = null, warnings: pre = [] } = {}) {
  const s = cleanAnalysisSettings(settings) || DEFAULT_SETTINGS;
  const warnings = [...pre], needs = [];
  // Merge plates: one value per biological unit and target (the mean over the plates it was measured on).
  const units = new Map();
  for (const r of records) {
    if (!units.has(r.unit)) units.set(r.unit, { unit: r.unit, group: null, plates: new Set(), groups: new Set(), t: {} });
    const u = units.get(r.unit);
    u.plates.add(r.plate);
    if (r.group) { u.groups.add(r.group); u.group ||= r.group; }
    (u.t[r.target] ||= { per: [], tech: [] }).per.push(r.ct);
    u.t[r.target].tech.push(...r.tech);
  }
  for (const u of units.values()) {
    for (const v of Object.values(u.t)) v.ct = mean(v.per);
    if (u.groups.size > 1) warnings.push(`Biological unit ${u.unit} has different groups on different plates (${[...u.groups].join(", ")}). I used ${u.group}.`);
  }
  const multi = [...units.values()].filter(u => u.plates.size > 1);
  if (plates.length > 1 && multi.length) warnings.push(`${multi.length} biological unit(s) appear on more than one plate (${list(multi.map(u => u.unit))}). Units with the same name are treated as the same biological sample and their plates are averaged.`);

  const allTargets = uniq(records.map(r => r.target));
  const groupsSeen = uniq(records.map(r => r.group).filter(Boolean));
  const refs = s.refs.filter(t => allTargets.includes(t));
  const missingRefs = s.refs.filter(t => !allTargets.includes(t));
  if (missingRefs.length) warnings.push(`Reference gene${missingRefs.length > 1 ? "s" : ""} ${missingRefs.join(", ")} ${missingRefs.length > 1 ? "have" : "has"} no usable sample wells and ${missingRefs.length > 1 ? "were" : "was"} not used.`);
  if (!refs.length) needs.push("refs");
  const control = groupsSeen.includes(s.control) ? s.control : "";
  if (!control) needs.push("control");
  const groups = control ? [control, ...groupsSeen.filter(g => g !== control)] : groupsSeen;
  const targets = allTargets.filter(t => !refs.includes(t));
  if (refs.length && !targets.length) needs.push("targets");
  const base = { settings: s, refs, control, groups, targets, allTargets, plates, calibration, needs, warnings, rows: [], summary: [], anova: [], refStability: [], efficiency: {} };
  if (needs.length) return { ...base, ok: false };

  const { eff, warnings: ew } = efficiencies(stdCurves, allTargets, s.efficiency);
  warnings.push(...ew);
  const w = t => Math.log2(eff[t].E); // 1 when E = 2, so the formulas reduce to plain ΔΔCt

  // Reference level per unit: mean of the (efficiency-weighted) reference Cts, i.e. the log of the geometric mean of their quantities.
  const noRef = [];
  for (const u of units.values()) {
    if (!u.group) { u.ref = null; continue; }
    const have = refs.filter(r => u.t[r]);
    u.ref = have.length === refs.length ? mean(refs.map(r => w(r) * u.t[r].ct)) : null;
    if (u.ref === null) noRef.push(`${u.unit} (no ${refs.filter(r => !u.t[r]).join(", ")})`);
  }
  if (noRef.length) warnings.push(`${noRef.length} biological unit(s) lack a reference gene value and were left out: ${list(noRef)}.`);

  // Reference stability: does the reference Ct differ between groups?
  for (const r of refs) {
    const per = groups.map(g => ({ group: g, cts: [...units.values()].filter(u => u.group === g && u.t[r]).map(u => u.t[r].ct) })).filter(x => x.cts.length);
    const means = per.map(x => ({ group: x.group, n: x.cts.length, mean: mean(x.cts), sd: S.sd(x.cts) }));
    const range = means.length > 1 ? Math.max(...means.map(m => m.mean)) - Math.min(...means.map(m => m.mean)) : null;
    const test = per.length === 2 ? S.welch(per[0].cts, per[1].cts) : per.length > 2 ? S.anova(per.map(x => x.cts)) : { p: null };
    const flagged = (range !== null && range > s.refMaxShift) || (test.p !== null && test.p < ALPHA);
    base.refStability.push({ target: r, groups: means, range, p: test.p, test: per.length === 2 ? "Welch t-test" : per.length > 2 ? "one-way ANOVA" : null, flagged });
    if (flagged) warnings.push(`Reference ${r} may not be stable: its mean Ct differs between groups by ${range.toFixed(2)} cycles` +
      (test.p !== null ? ` (${per.length === 2 ? "Welch" : "ANOVA"} p = ${fmtP(test.p)})` : "") + `. A shift of d cycles in a reference changes every fold change by about 2^d (here ${(2 ** range).toFixed(2)}×). Consider another reference or several references.`);
  }

  // ΔCt per unit and target, then ΔΔCt against the control group's mean ΔCt.
  const comps = [];
  for (const t of targets) {
    const data = [...units.values()].filter(u => u.group && u.ref !== null && u.t[t]).map(u => ({ u, dct: w(t) * u.t[t].ct - u.ref }));
    const ctrl = data.filter(d => d.u.group === control).map(d => d.dct);
    if (!ctrl.length) { warnings.push(`${t}: the control group ${control} has no usable value, so ${t} can't be compared.`); continue; }
    const cm = mean(ctrl);
    for (const d of data) base.rows.push({ target: t, group: d.u.group, unit: d.u.unit, plates: [...d.u.plates], ct: d.u.t[t].ct, refCt: d.u.ref,
      dct: d.dct, ddct: d.dct - cm, fold: 2 ** -(d.dct - cm),
      tech: d.u.t[t].tech.map(x => ({ well: x.well, plate: x.plate, ct: x.ct, fold: 2 ** -(w(t) * x.ct - d.u.ref - cm) })) });
    const byGroup = groups.map(g => ({ g, v: data.filter(d => d.u.group === g).map(d => d.dct) })).filter(x => x.v.length);
    for (const { g, v } of byGroup) {
      const m = mean(v) - cm, sdv = S.sd(v), semv = S.sem(v), err = s.error === "sem" ? semv : sdv;
      const row = { target: t, group: g, isControl: g === control, n: v.length, meanDct: mean(v), sdDct: sdv, semDct: semv, meanDdct: m,
        fold: 2 ** -m, foldLow: err === null ? null : 2 ** -(m + err), foldHigh: err === null ? null : 2 ** -(m - err), log2fc: -m,
        t: null, df: null, p: null, pBH: null, pBonferroni: null, pAdj: null };
      if (g !== control) {
        const r = S.welch(v, ctrl);
        Object.assign(row, { t: r.t, df: r.df, p: r.p, testNote: r.reason || "" });
        comps.push(row);
      }
      base.summary.push(row);
    }
    if (byGroup.length > 2) {
      const a = S.anova(byGroup.map(x => x.v));
      base.anova.push({ target: t, F: a.F, df1: a.df1, df2: a.df2, p: a.p, groups: byGroup.length, note: a.reason || "" });
    }
  }
  // Corrections across every comparison with the control (all targets and groups together).
  const bh = S.benjaminiHochberg(comps.map(c => c.p)), bf = S.bonferroni(comps.map(c => c.p));
  comps.forEach((c, i) => { c.pBH = bh[i]; c.pBonferroni = bf[i]; c.pAdj = s.correction === "bonferroni" ? bf[i] : bh[i]; });
  const abh = S.benjaminiHochberg(base.anova.map(a => a.p)), abf = S.bonferroni(base.anova.map(a => a.p));
  base.anova.forEach((a, i) => { a.pBH = abh[i]; a.pBonferroni = abf[i]; });

  const small = base.summary.filter(r => r.n < MIN_N);
  if (small.length) warnings.push(`Fewer than ${MIN_N} biological replicates in: ${list(small.map(r => `${r.group} / ${r.target} (n = ${r.n})`))}. With so few, a t-test has little power and the p value is unreliable` +
    (small.some(r => r.n < 2) ? "; groups with one replicate get no p value at all" : "") + ".");
  base.efficiency = eff;
  base.comparisons = comps.length;
  base.method = methodText({ ...base, eff });
  return { ...base, ok: true };
}

// ---------------------------------------------------------------- entry points
export function analyzeRun(exp, res, settings = exp?.analysis) {
  const s = cleanAnalysisSettings(settings) || DEFAULT_SETTINGS;
  const p = plateRecords(res, s, "");
  return compute(p.records, s, { stdCurves: res?.stdCurves || [], plates: [exp?.title || ""], warnings: p.warnings });
}
// runs: [{ exp, res }]. study: { settings, mode, calibrators }.
export function analyzeStudy(runs, study) {
  const s = cleanAnalysisSettings(study?.settings) || DEFAULT_SETTINGS;
  const label = (r, i) => runs.filter(x => x.exp.title === r.exp.title).length > 1 ? `${r.exp.title} (${i + 1})` : r.exp.title;
  const calibrators = study?.mode === "calibrator" ? study?.calibrators || [] : [];
  const plates = runs.map((r, i) => ({ id: r.exp.id, ...plateRecords(r.res, { ...s, excluded: (study?.excluded?.[r.exp.id]) || [] }, label(r, i), calibrators) }));
  // [combat] ComBat works on ΔCt, so it gets the reference genes and the same efficiency weights compute() uses.
  const ceff = study?.mode === "combat" ? efficiencies(runs.flatMap(r => r.res?.stdCurves || []), uniq(plates.flatMap(p => p.records.map(r => r.target))), s.efficiency).eff : {};
  const cal = calibrate(plates, { mode: study?.mode || "calibrator", calibrators: study?.calibrators || [],
    combat: { refs: s.refs, weight: t => Math.log2(ceff[t]?.E || 2), meanOnly: study?.combatMeanOnly === true } });
  return compute(plates.flatMap(p => p.records), s, { stdCurves: runs.flatMap(r => r.res?.stdCurves || []), plates: plates.map(p => p.plate),
    calibration: cal, warnings: [...plates.flatMap(p => p.warnings), ...cal.warnings] });
}
// Units measured on at least two of the given runs: the candidates for calibrator samples.
export function sharedUnits(runs) {
  const seen = new Map();
  for (const r of runs) for (const u of new Set((r.res?.rows || []).filter(x => x.role === "sample" && x.bio_unit).map(x => x.bio_unit))) seen.set(u, (seen.get(u) || 0) + 1);
  return [...seen].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([u, n]) => ({ unit: u, plates: n }));
}

// ---------------------------------------------------------------- text and tables
export function fmtP(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return "—";
  if (p < 1e-4) return p.toExponential(1);
  return p < 0.001 ? p.toFixed(4) : p.toFixed(3);
}
export const stars = p => (p === null || !Number.isFinite(p) ? "" : p < 0.001 ? "***" : p < 0.01 ? "**" : p < ALPHA ? "*" : "ns");
const CORR = { bh: "Benjamini–Hochberg", bonferroni: "Bonferroni" };
function methodText(a) {
  const s = a.settings, e = s.efficiency;
  const refs = a.refs.length > 1 ? `the mean Ct of ${a.refs.join(", ")} (the geometric mean of their quantities)` : a.refs[0];
  const cal = a.calibration;
  const calText = !cal || cal.mode === "single" ? "" : cal.mode === "calibrator" ? ` Plates were combined with inter-run calibration on ${list(uniq(Object.values(cal.basis || {}).flat()))} as in qBase (Hellemans et al. 2007).`
    : cal.mode === "centre" ? " Plates were combined by centring each target's Ct values per plate (no calibrator)."
    : cal.mode === "combat" && cal.applied ? ` Plates were combined with ComBat on ΔCt (Johnson et al. 2007; parametric empirical Bayes, ${cal.meanOnly ? "location only" : "location and scale"}, group as covariate).` // [combat]
    : " Plates were combined without correction between runs.";
  return `Ct values of technical replicates were averaged per biological unit${s.skipOmitted ? ", leaving out wells marked Omit" : ""}. ` +
    `ΔCt = Ct(target) − Ct(reference), with ${refs} as reference. ΔΔCt = ΔCt − mean ΔCt of the control group (${a.control}); fold change = 2^−ΔΔCt` +
    (e ? `, with amplification efficiencies from standard curves (Pfaffl 2001; each Ct multiplied by log2 of its efficiency factor)` : " (Livak & Schmittgen 2001, assuming 100% efficiency)") + "." + calText +
    ` Each group was compared with the control by Welch's t-test on ΔCt with biological replicates as n` + (a.anova?.length ? "; one-way ANOVA across all groups for targets with more than two groups" : "") +
    `. p values were adjusted across ${a.comparisons === 1 ? "the one comparison" : `all ${a.comparisons} comparisons`} with Benjamini–Hochberg and Bonferroni; graphs show ${CORR[s.correction]}. Error bars: ${s.error === "sem" ? "SEM" : "SD"} of ΔΔCt.`;
}
const n4 = x => (x === null || x === undefined || !Number.isFinite(x) ? "" : String(+x.toFixed(6)));
export function resultsCsv(a) {
  const head = ["target", "group", "is_control", "n_biological", "mean_dCt", "sd_dCt", "sem_dCt", "mean_ddCt", "fold_change", "fold_low", "fold_high",
    "welch_t", "welch_df", "p", "p_bh", "p_bonferroni"];
  const rows = (a.summary || []).map(r => [r.target, r.group, r.isControl ? "yes" : "no", r.n, n4(r.meanDct), n4(r.sdDct), n4(r.semDct), n4(r.meanDdct), n4(r.fold),
    n4(r.foldLow), n4(r.foldHigh), n4(r.t), n4(r.df), r.p ?? "", r.pBH ?? "", r.pBonferroni ?? ""]);
  const units = (a.rows || []).map(r => [r.target, r.group, r.unit, r.plates.join(" | "), n4(r.ct), n4(r.refCt), n4(r.dct), n4(r.ddct), n4(r.fold), r.tech.map(t => n4(t.ct)).join(" ")]);
  return toCsv([head, ...rows, [], ["target", "group", "biological_unit", "plates", "mean_ct", "reference_level", "dCt", "ddCt", "fold_change", "technical_ct"], ...units]);
}

// Short section for the HTML report (web/report.js). esc escapes HTML.
export function analysisReportHtml(exp, res, esc) {
  if (!exp?.analysis?.on) return "";
  let a;
  try { a = analyzeRun(exp, res); } catch (e) { return `<h2>Analysis</h2><p>The analysis couldn't be worked out: ${esc(e.message)}</p>`; }
  if (!a.ok) return `<h2>Analysis</h2><p>The analysis is switched on, but ${esc([a.needs.includes("refs") && "no reference gene", a.needs.includes("control") && "no control group", a.needs.includes("targets") && "no target gene besides the references"].filter(Boolean).join(" and "))} has been chosen yet.</p>`;
  const f = x => (x === null || !Number.isFinite(x) ? "—" : x.toFixed(2));
  const body = a.summary.map(r => `<tr><td>${esc(r.target)}</td><td>${esc(r.group)}${r.isControl ? " (control)" : ""}</td><td>${r.n}</td><td>${f(r.fold)}</td><td>${f(r.foldLow)}–${f(r.foldHigh)}</td><td>${r.isControl ? "" : esc(fmtP(r.p))}</td><td>${r.isControl ? "" : esc(fmtP(r.pBH))}</td><td>${r.isControl ? "" : esc(fmtP(r.pBonferroni))}</td></tr>`).join("");
  return `<h2>Analysis</h2>
<p>${esc(a.method)}</p>
<p>Reference gene${a.refs.length > 1 ? "s" : ""}: ${esc(a.refs.join(", "))}. Control group: ${esc(a.control)}. Biological replicates (n) per group are in the table; technical replicates were averaged first and not counted as n.</p>
<table><thead><tr><th>Target</th><th>Group</th><th>n</th><th>Fold change</th><th>± ${a.settings.error === "sem" ? "SEM" : "SD"}</th><th>Welch p</th><th>p (BH)</th><th>p (Bonferroni)</th></tr></thead><tbody>${body}</tbody></table>
${a.anova.length ? `<p class="sub small">One-way ANOVA: ${a.anova.map(x => `${esc(x.target)} F(${x.df1}, ${x.df2}) = ${f(x.F)}, p = ${esc(fmtP(x.p))}`).join("; ")}.</p>` : ""}
${a.warnings.length ? `<p><b>Notes on the analysis</b></p><ul>${a.warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}`;
}
