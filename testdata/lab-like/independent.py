# Independent ΔΔCt analysis of the simulated exports with pandas + scipy (not PlateCheck code), to check PlateCheck's numbers.
import json, os, io, numpy as np, pandas as pd
from scipy import stats
D = os.path.dirname(os.path.abspath(__file__))
app = json.load(open(os.path.join(D, "app.json"))); truth = json.load(open(os.path.join(D, "truth.json")))

def qs(name):
    t = open(os.path.join(D, name), encoding="utf-8").read().split("[Results]")[1].strip()
    df = pd.read_csv(io.StringIO(t), sep="\t")
    df["ct"] = pd.to_numeric(df["Cт"], errors="coerce"); return df

def ddct(df, refs, ctrl, trt, sample="Sample Name", target="Target Name", group="Biological Group"):
    d = df[df[group].isin([ctrl, trt]) & df["ct"].notna()]
    m = d.groupby([sample, group, target])["ct"].mean().unstack(target)          # technical replicates averaged
    ref = m[refs].mean(axis=1)                                                    # mean Ct of references = log of geometric mean
    out = {}
    for t in [c for c in m.columns if c not in refs]:
        dct = (m[t] - ref).dropna(); g = dct.index.get_level_values(1)
        c, x = dct[g == ctrl], dct[g == trt]
        w = stats.ttest_ind(x, c, equal_var=False)
        out[t] = {"n": int(len(x)), "fold": float(2 ** -(x.mean() - c.mean())), "p": float(w.pvalue)}
    return out

print("E1 (QuantStudio, refs GAPDH+ACTB+HPRT1), app vs independent vs truth")
ind = ddct(qs("E1 QuantStudio5 LPS SYBR - results.txt"), ["GAPDH", "ACTB", "HPRT1"], "control", "LPS")
for r in app["E1"]["analysis"]:
    i = ind[r["target"]]; tr = truth["E1"]["truth_fold_LPS_vs_control"][r["target"]]
    print(f"  {r['target']:6} n {r['n']}/{i['n']}  fold {r['fold']:.6f} / {i['fold']:.6f}  p {r['p']:.6g} / {i['p']:.6g}  truth {tr}  CI {r['ci'][0]:.2f}-{r['ci'][1]:.2f} {'contains truth' if r['ci'][0] <= tr <= r['ci'][1] else 'MISSES truth'}")

print("E1b standard curves (independent least squares)")
s = qs("E1b QuantStudio5 standard curves - results.txt"); s = s[s["Task"] == "STANDARD"]
for t, g in s.groupby("Target Name"):
    sl, ic, r, *_ = stats.linregress(np.log10(g["Quantity"].astype(float)), g["ct"]); eff = (10 ** (-1 / sl) - 1) * 100
    a = next(c for c in app["E1b"]["curves"] if c["target"] == t)
    print(f"  {t:6} eff {a['eff']:.4f} / {eff:.4f}  R2 {a['r2']:.6f} / {r * r:.6f}  true {truth['E1']['std_true_efficiency'][t]}")

print("E2 two CFX plates, calibrator IRC (independent: shift each plate's target Cts by its IRC mean minus the mean over plates)")
plates = []
for k, n in enumerate(truth["E2"]["files"]):
    lines = open(os.path.join(D, n), encoding="utf-8").read().splitlines()[1:]
    df = pd.read_csv(io.StringIO("\n".join(lines))); df["ct"] = pd.to_numeric(df["Cq"], errors="coerce"); df["plate"] = k; plates.append(df)
df = pd.concat(plates)
cal = df[df["Sample"] == "IRC"].groupby(["plate", "Target"])["ct"].mean().unstack("Target")
adj = cal - cal.mean()
df["ctc"] = df.apply(lambda r: r["ct"] - adj.loc[r["plate"], r["Target"]] if pd.notna(r["ct"]) else np.nan, axis=1)
for col, label in (("ctc", "calibrator"), ("ct", "none")):
    d = df[df["Biological Set Name"].isin(["siCtrl", "siMYC"])].copy(); d["ct"] = d[col]
    res = ddct(d, ["RPLP0", "B2M"], "siCtrl", "siMYC", sample="Sample", target="Target", group="Biological Set Name")
    for r in app["E2"][label]:
        i = res[r["target"]]; tr = truth["E2"]["truth_fold_siMYC_vs_siCtrl"][r["target"]]
        print(f"  {label:10} {r['target']:7} fold {r['fold']:.6f} / {i['fold']:.6f}  p {r['p']:.4g} / {i['p']:.4g}  truth {tr}")
