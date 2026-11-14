# Realistic qPCR run simulator for PlateCheck QA. Synthetic, but built from how real runs behave:
#  - template copies per well drawn from Poisson (so late Cts scatter more), pipetting CV, instrument noise
#  - per-assay efficiency 90-99%, Ct = threshold cycles for N0 copies at that efficiency
#  - biological variation between animals/cultures, true fold changes known
#  - instrument export layouts (QuantStudio 5 text, Bio-Rad CFX CSV) with their real column sets
#  - amplification (Delta Rn per cycle) and melt (derivative) curves consistent with each well
# Planted problems mimic common lab failures. Everything is written with a "Synthetic" note in the file.
import json, math, os, numpy as np
rng = np.random.default_rng(14112026)
OUT = os.path.dirname(os.path.abspath(__file__))
NOTE = "Synthetic example data for PlateCheck QA, simulated to mimic a real run; not a real experiment"
ROWS = "ABCDEFGH"

def ct_from_copies(n0, eff, thr_copies=1.5e12):
    """Cycles for n0 copies to reach the threshold amount at amplification factor E = 1 + eff."""
    E = 1 + eff
    if n0 <= 0: return None
    return math.log(thr_copies / n0) / math.log(E)

def well_ct(copies_mean, eff, pip_cv=0.04, inst_sd=0.05, max_cycles=40):
    n = rng.poisson(max(copies_mean * max(rng.normal(1, pip_cv), 0.01), 0))
    if n == 0: return None
    ct = ct_from_copies(n, eff) + rng.normal(0, inst_sd)
    return None if ct > max_cycles else ct

def amp_curve(ct, eff, cycles=40, plateau=None):
    """Delta Rn per cycle: logistic-like growth crossing 0.2 at the Ct (QuantStudio-style threshold)."""
    if ct is None: return [round(float(rng.normal(0, 0.004)), 4) for _ in range(cycles)]
    top = plateau or rng.uniform(1.6, 2.4); k = 0.75 + eff * 0.6
    mid = ct + math.log(top / 0.2 - 1) / k
    return [round(top / (1 + math.exp(-k * (c + 1 - mid))) + float(rng.normal(0, 0.004)), 4) for c in range(cycles)]

def melt_curve(peaks, temps):
    return [round(sum(h * math.exp(-((t - tm) ** 2) / (2 * 0.55 ** 2)) for tm, h in peaks) + float(rng.normal(0, 0.01)), 4) for t in temps]

# ---------------------------------------------------------------- 1. LPS time course, SYBR, QuantStudio 5, 96 wells
def experiment_1():
    targets = {  # name: (efficiency, Tm, copies per well in control, true fold change after LPS)
        "GAPDH": (0.97, 83.4, 2.0e6, 1.0), "ACTB": (0.95, 86.1, 3.0e6, 1.0), "HPRT1": (0.93, 81.2, 6.0e4, 1.0),
        "IL6": (0.94, 82.7, 1.5e3, 16.0), "TNF": (0.92, 85.0, 4.0e3, 6.0), "CXCL8": (0.96, 80.6, 8.0e3, 1.0)}
    samples = [(f"Ctrl-{i}", "control") for i in range(1, 5)] + [(f"LPS-{i}", "LPS") for i in range(1, 5)]
    bio = {s: rng.normal(0, 0.25) for s, _ in samples}            # RNA input differences (shared by all genes of a sample)
    biovar = {(s, t): rng.normal(0, 0.30) for s, _ in samples for t in targets}  # gene-level biological variation (log2)
    truth = {t: v[3] for t, v in targets.items()}
    rows, amp, melt_wells, layout = [], {}, {}, []
    temps = [round(65 + 0.25 * i, 2) for i in range(121)]
    # 8 samples x 6 targets x 2 technical replicates = 96 wells is too many with controls, so use 3 targets per plate row pair:
    # layout: rows A-H = samples, columns 1-12 = 6 targets x 2 replicates. Controls go on a second, smaller block below via 'ctrl' list.
    plan = []
    for r, (s, g) in enumerate(samples):
        for j, t in enumerate(targets):
            for k in range(2): plan.append((f"{ROWS[r]}{j * 2 + k + 1}", s, g, t, "UNKNOWN"))
    # The plate is full; NTC and no-RT go on the companion "controls" plate rows? Real labs often drop a sample row instead:
    # replace LPS-4's CXCL8 duplicate (H11, H12) by an NTC for GAPDH and a no-RT for ACTB. Planted: gDNA in the no-RT.
    plan = [p for p in plan if p[0] not in ("H11", "H12")]
    plan += [("H11", "NTC", "", "GAPDH", "NTC"), ("H12", "Ctrl-1 noRT", "control", "ACTB", "UNKNOWN")]
    for well, s, g, t, task in plan:
        eff, tm, c0, fc = targets[t]
        if s == "NTC":
            ct = 36.4 + rng.normal(0, 0.3); peaks = [(76.1, 0.35)]          # planted: primer-dimer in the NTC
        elif s.endswith("noRT"):
            ct = well_ct(c0 * 2 ** -12.5, eff); peaks = [(tm, 0.9)]          # planted: genomic DNA, about 12.5 cycles after the sample
        else:
            mult = (fc if g == "LPS" else 1.0) * 2 ** (bio[s] + biovar[(s, t)])
            ct = well_ct(c0 * mult, eff); peaks = [(tm, 1.0)]
            if s == "LPS-2" and t == "TNF" and well.endswith("10"): ct = ct + 1.3   # planted: pipetting error in one replicate
            if s == "Ctrl-3" and t == "IL6": peaks = [(tm, 1.0), (tm - 4.5, 0.45)]  # planted: second product in one sample
        rows.append({"well": well, "sample": s, "group": g, "target": t, "task": task, "ct": ct})
        amp[(well, t)] = amp_curve(ct, eff)
        melt_wells[well] = melt_curve(peaks, temps) if ct is not None else melt_curve([], temps)
    write_quantstudio("E1 QuantStudio5 LPS SYBR - results.txt", rows, "96-Well Block (0.2mL)", "SYBR", "LPS time course, 4 h")
    write_qs_amp("E1 QuantStudio5 LPS SYBR - amplification.txt", rows, amp)
    write_qs_melt("E1 QuantStudio5 LPS SYBR - melt derivative.txt", rows, melt_wells, temps)
    # standard curve for IL6 and GAPDH on a second plate would be typical; here a separate small file
    std_rows = []
    for t in ("IL6", "GAPDH"):
        eff = targets[t][0]
        for lvl, q in enumerate([1e7, 1e6, 1e5, 1e4, 1e3]):
            for k in range(3):
                std_rows.append({"well": f"{ROWS[lvl + (0 if t == 'IL6' else 0)]}{(1 if t == 'IL6' else 4) + k}", "sample": f"Std-{lvl + 1}", "group": "", "target": t,
                                 "task": "STANDARD", "ct": well_ct(q, eff), "quantity": q})
    std_rows.append({"well": "H1", "sample": "NTC", "group": "", "target": "IL6", "task": "NTC", "ct": None})
    std_rows.append({"well": "H4", "sample": "NTC", "group": "", "target": "GAPDH", "task": "NTC", "ct": None})
    write_quantstudio("E1b QuantStudio5 standard curves - results.txt", std_rows, "96-Well Block (0.2mL)", "SYBR", "IL6 and GAPDH standard curves")
    return {"experiment": "E1", "truth_fold_LPS_vs_control": truth, "efficiency": {t: v[0] for t, v in targets.items()},
            "planted": ["NTC H11 GAPDH Ct ~36.4 with a primer-dimer melt peak at 76 C", "no-RT H12 (Ctrl-1, ACTB) amplifies about 12.5 cycles after the sample (gDNA)",
                        "LPS-2 / TNF replicate in column 10 is +1.3 cycles (pipetting)", "Ctrl-3 / IL6 has a second melt peak 4.5 C below the main one",
                        "LPS-4 / CXCL8 has no wells (dropped for the controls), so that unit has CXCL8 missing"],
            "std_true_efficiency": {"IL6": 94.0, "GAPDH": 97.0}}

def write_quantstudio(name, rows, block, chem, exp):
    pre = [f"* Note = {NOTE}", f"* Block Type = {block}", f"* Chemistry = {chem}", f"* Experiment Name = {exp}",
           "* Instrument Type = QuantStudio™ 5 System", "* Passive Reference = ROX", "* Quantification Cycle Method = Ct", "", "[Results]"]
    hdr = ["Well", "Well Position", "Omit", "Sample Name", "Target Name", "Task", "Reporter", "Quencher", "Cт", "Cт Mean", "Cт SD", "Quantity", "Amp Status", "Biological Group"]
    lines = pre + ["\t".join(hdr)]
    by = {}
    for r in rows: by.setdefault((r["sample"], r["target"]), []).append(r["ct"])
    for r in sorted(rows, key=lambda r: (ROWS.index(r["well"][0]), int(r["well"][1:]))):
        n = ROWS.index(r["well"][0]) * 12 + int(r["well"][1:])
        vals = [c for c in by[(r["sample"], r["target"])] if c is not None]
        mean = f"{np.mean(vals):.3f}" if vals else ""; sd = f"{np.std(vals, ddof=1):.3f}" if len(vals) > 1 else ""
        ct = f"{r['ct']:.3f}" if r["ct"] is not None else "Undetermined"
        lines.append("\t".join([str(n), r["well"], "false", r["sample"], r["target"], r["task"], "SYBR", "None", ct, mean, sd,
                                f"{r.get('quantity', '')}" if r.get("quantity") else "", "Amp" if r["ct"] is not None else "No Amp", r.get("group", "")]))
    open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\r\n").write("\n".join(lines) + "\n")

def write_qs_amp(name, rows, amp):
    lines = [f"* Note = {NOTE}", "", "[Amplification Data]", "\t".join(["Well", "Well Position", "Cycle", "Target Name", "Rn", "Delta Rn"])]
    for r in rows:
        n = ROWS.index(r["well"][0]) * 12 + int(r["well"][1:])
        for c, d in enumerate(amp[(r["well"], r["target"])]): lines.append("\t".join([str(n), r["well"], str(c + 1), r["target"], f"{d + 1.0:.4f}", f"{d:.4f}"]))
    open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\r\n").write("\n".join(lines) + "\n")

def write_qs_melt(name, rows, melt, temps):
    wells = [r["well"] for r in rows]
    lines = [f"* Note = {NOTE}", "", "[Melt Curve Raw Data]", "\t".join(["Temperature"] + wells)]
    for i, t in enumerate(temps): lines.append("\t".join([f"{t:.2f}"] + [f"{melt[w][i]:.4f}" for w in wells]))
    open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\r\n").write("\n".join(lines) + "\n")

# ---------------------------------------------------------------- 2. Two CFX plates with an inter-run calibrator
def experiment_2():
    targets = {"RPLP0": (0.96, 1.0e6, 1.0), "B2M": (0.95, 5.0e5, 1.0), "MYC": (0.93, 6.0e3, 0.25), "CDKN1A": (0.95, 3.0e3, 3.0)}
    plates = {"P1": {"shift": {"RPLP0": 0.0, "B2M": 0.0, "MYC": 0.0, "CDKN1A": 0.0}, "samples": ["siCtrl-1", "siCtrl-2", "siCtrl-3", "siMYC-1", "siMYC-2", "siMYC-3"]},
              "P2": {"shift": {"RPLP0": 0.15, "B2M": 0.2, "MYC": 0.9, "CDKN1A": 0.6}, "samples": ["siCtrl-4", "siCtrl-5", "siCtrl-6", "siMYC-4", "siMYC-5", "siMYC-6"]}}
    bio = {s: rng.normal(0, 0.2) for p in plates.values() for s in p["samples"]}
    biovar = {(s, t): rng.normal(0, 0.25) for p in plates.values() for s in p["samples"] for t in targets}
    files = []
    for pname, p in plates.items():
        rows = []
        for i, s in enumerate(p["samples"] + ["IRC"]):
            for j, t in enumerate(targets):
                eff, c0, fc = targets[t]
                for k in range(3):
                    well = f"{ROWS[i]}{j * 3 + k + 1}"
                    if s == "IRC": mult = 1.0
                    else: mult = (fc if s.startswith("siMYC") else 1.0) * 2 ** (bio[s] + biovar[(s, t)])
                    ct = well_ct(c0 * mult, eff)
                    ct = None if ct is None else ct + p["shift"][t]      # target-specific run-to-run shift
                    rows.append((well, t, "Unkn" if s != "IRC" else "Unkn", s, "siMYC" if s.startswith("siMYC") else ("siCtrl" if s != "IRC" else ""), ct))
        for j, t in enumerate(targets): rows.append((f"H{j * 3 + 1}", t, "NTC", "", "", None))
        name = f"E2 CFX96 siMYC {pname} - Quantification Cq Results.csv"
        lines = [f'Note,"{NOTE}"', ",Well,Fluor,Target,Content,Sample,Biological Set Name,Cq,Cq Mean,Cq Std. Dev,Starting Quantity (SQ),Log Starting Quantity,SQ Mean,SQ Std. Dev,Set Point,Well Note"]
        for well, t, content, s, grp, ct in rows:
            w = f"{well[0]}{int(well[1:]):02d}"
            lines.append(f",{w},SYBR,{t},{content},{s},{grp},{'NaN' if ct is None else f'{ct:.2f}'},,,NaN,NaN,NaN,0,60,")
        open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\r\n").write("\n".join(lines) + "\n")
        files.append(name)
    return {"experiment": "E2", "files": files, "truth_fold_siMYC_vs_siCtrl": {t: v[2] for t, v in targets.items()},
            "plate_shift_P2": plates["P2"]["shift"], "calibrator": "IRC", "design": "3 siCtrl + 3 siMYC per plate (balanced)"}

# ---------------------------------------------------------------- 3. ChIP-qPCR, 3 chromatin preps per condition
def experiment_3():
    regions = {"MYC-promoter": {"WT": 0.040, "KO": 0.008}, "MYC-enhancer": {"WT": 0.015, "KO": 0.012}, "Desert": {"WT": 0.0008, "KO": 0.0008}}
    igg_frac = 0.0006
    input_copies = 2.0e4  # 1% input
    eff = {"MYC-promoter": 0.95, "MYC-enhancer": 0.93, "Desert": 0.96}
    lines = [f'Note,"{NOTE}"', ",Well,Fluor,Target,Content,Sample,Biological Set Name,Cq,Cq Mean,Cq Std. Dev,Starting Quantity (SQ),Log Starting Quantity,SQ Mean,SQ Std. Dev,Set Point,Well Note"]
    w = 0
    def add(t, s, sset, copies, content="Unkn"):
        nonlocal w
        ct = well_ct(copies, eff[t]); well = f"{ROWS[w // 12]}{w % 12 + 1:02d}"; w += 1
        lines.append(f",{well},SYBR,{t},{content},{s},{sset},{'NaN' if ct is None else f'{ct:.2f}'},,,NaN,NaN,NaN,0,60,")
    for cond in ("WT", "KO"):
        for rep in (1, 2, 3):
            chrom = 100 * input_copies * 2 ** rng.normal(0, 0.15)   # chromatin amount per IP (input = 1% of it)
            sset = f"{cond}-{rep}"
            for t, occ in regions.items():
                frac = occ[cond] * 2 ** rng.normal(0, 0.35)          # biological variation in occupancy
                for _ in range(2): add(t, "IP", sset, chrom * frac)
                for _ in range(2): add(t, "Input", sset, chrom * 0.01)
                add(t, "IgG", sset, chrom * igg_frac)
    for t in regions: add(t, "NTC", "", 0, "NTC")
    name = "E3 CFX96 ChIP H3K27ac WT vs KO - Quantification Cq Results.csv"
    open(os.path.join(OUT, name), "w", encoding="utf-8", newline="\r\n").write("\n".join(lines) + "\n")
    return {"experiment": "E3", "file": name, "truth_pct_input": {r: {c: 100 * v for c, v in o.items()} for r, o in regions.items()},
            "truth_fold_over_IgG": {r: {c: v / igg_frac for c, v in o.items()} for r, o in regions.items()}, "input_percent": 1}

truth = {"E1": experiment_1(), "E2": experiment_2(), "E3": experiment_3()}
json.dump(truth, open(os.path.join(OUT, "truth.json"), "w"), indent=1)
print("wrote", sorted(f for f in os.listdir(OUT) if f.startswith("E")))
