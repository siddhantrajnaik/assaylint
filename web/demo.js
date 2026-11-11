// Synthetic demo run (deterministic). Every value is generated; no real experiment is represented.
// It deliberately contains issues so that each family of checks has something to show.

function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

export const DEMO_TITLE = "Demo: GENE1 knockdown (synthetic data)";
export const DEMO_CONTEXT = {
  protocol: "SYBR Green two-step RT-qPCR, lab SOP v2.1",
  analysis_method: "ΔΔCq relative to GAPDH",
  run_settings: "95 °C 2 min; 40 × (95 °C 15 s, 60 °C 60 s); melt 65–95 °C in 0.5 °C steps; auto baseline",
  deviations: "Plate sealed about 20 min after setup (SOP: under 10 min).",
};

export function demoFiles() {
  const r = rng(7), jit = s => (r() - 0.5) * 2 * s;
  const rows = []; // [well, sample, target, content, group, bio rep, quantity, Cq]
  const units = [["ctrl-1", "control"], ["ctrl-2", "control"], ["kd-1", "knockdown"], ["kd-2", "knockdown"]];
  const base = { GAPDH: { control: 18.2, knockdown: 18.4 }, GENE1: { control: 24.2, knockdown: 26.1 } };
  for (const [R, t] of [["A", "GAPDH"], ["C", "GENE1"]]) {
    let c = 1;
    for (const [u, g] of units) for (let k = 0; k < 3; k++, c++) rows.push([R + c, u, t, "Unkn", g, u, "", (base[t][g] + jit(0.1)).toFixed(2)]);
  }
  const set = (well, ct) => { rows.find(x => x[0] === well)[7] = ct; };
  set("A12", "19.90");        // replicate spread
  set("C6", "abc");           // non-numeric value
  set("C8", "Undetermined");  // curve rises but no Cq
  rows.push(["B1", "", "GAPDH", "Unkn", "control", "", "", "18.31"]);          // unlabelled sample
  rows.push(["C3", "ctrl-1", "GENE1", "Unkn", "control", "ctrl-1", "", "24.05"]); // duplicate well
  rows.push(["Z9", "kd-2", "GENE1", "Unkn", "knockdown", "kd-2", "", "26.02"]);   // invalid coordinate
  let e = 1;
  for (const q of [1e6, 1e5, 1e4, 1e3, 1e2]) for (let k = 0; k < 2; k++, e++)
    rows.push(["E" + e, "", "GENE1", "Std", "", "", String(q), (38.6 - 3.4 * Math.log10(q) + jit(0.08)).toFixed(2)]);
  rows.push(["F1", "NTC", "GAPDH", "NTC", "", "", "", "Undetermined"]);
  rows.push(["F2", "NTC", "GENE1", "NTC", "", "", "", "33.20"]);
  rows.push(["F3", "POS", "GAPDH", "Pos Ctrl", "", "", "", "20.10"]);
  rows.push(["F4", "POS", "GENE1", "Pos Ctrl", "", "", "", "25.40"]);
  rows.push(["F5", "ctrl-1 RT-", "GENE1", "NRT", "", "", "", "Undetermined"]);
  rows.push(["F6", "ctrl-1 RT-", "GAPDH", "NRT", "", "", "", "31.50"]);
  const results = [["Well", "Sample Name", "Target Name", "Content", "Biological Group", "Bio Rep", "Starting Quantity (SQ)", "Cq"], ...rows]
    .map(x => x.join(",")).join("\n") + "\n";

  // Amplification curves, long layout. Midpoint chosen so a 10% threshold crosses at the reported Cq.
  const amp = [["Well", "Target", "Cycle", "Delta Rn"]], seen = new Set(), curveWells = [];
  for (const [well, , target, , , , , ct] of rows) {
    if (well === "B1" || well === "Z9" || seen.has(well)) continue; // B1 deliberately has no curve
    seen.add(well);
    let A = 1.8 + jit(0.15), c = Number(ct);
    if (well === "C8") c = 31;                 // rises, but no Cq was reported
    if (well === "F2") A = 0.6;                 // small late product in the NTC
    if (well === "F6") A = 1.0;
    const flat = !Number.isFinite(c) || well === "A5"; // A5 reports a Cq on a flat curve
    let mid = c + 1.6 * Math.log(A / 0.18 - 1);
    if (well === "A9") mid += 4;                // Cq inconsistent with the curve
    curveWells.push([well, target, flat ? null : true]);
    for (let cyc = 1; cyc <= 40; cyc++)
      amp.push([well, target, cyc, (jit(0.004) + (flat ? 0 : A / (1 + Math.exp(-(cyc - mid) / 1.6)))).toFixed(4)]);
  }

  // Melt derivative curves, wide layout.
  const tm = { GAPDH: 82.5, GENE1: 84.0 }, temps = [];
  for (let t = 65; t <= 95.001; t += 0.5) temps.push(+t.toFixed(1));
  const peak = (T, at, h, w = 0.8) => h * Math.exp(-((T - at) ** 2) / (2 * w * w));
  const cols = curveWells.map(([well, target, amplified]) => (T) => {
    let y = jit(0.01);
    if (well === "F2") return y + peak(T, 74.5, 0.45);
    if (!amplified) return y;
    y += peak(T, well === "A7" ? 84.2 : tm[target], 1 + jit(0.08));
    if (well === "C10") y += peak(T, 76.5, 0.45);
    return y;
  });
  const melt = [["Temperature", ...curveWells.map(w => w[0])], ...temps.map(T => [T, ...cols.map(f => f(T).toFixed(4))])];

  return { results, amp: amp.map(x => x.join(",")).join("\n") + "\n", melt: melt.map(x => x.join(",")).join("\n") + "\n" };
}
