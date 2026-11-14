"""Reference values for web/gsea.js, worked out with gseapy (preranked GSEA) and SciPy (rank test).

Writes tests/fixtures/gsea-reference.json. Run it from a throwaway virtual environment outside the repo:

    python -m venv %TEMP%/platecheck-statsref          (or /tmp/platecheck-statsref)
    <venv>/Scripts/python -m pip install gseapy scipy numpy pandas    (bin/python on Linux and macOS)
    <venv>/Scripts/python testdata/make-gsea-reference.py

ES and the leading edge are deterministic and must match exactly. NES, p and FDR q come from random permutations,
so gseapy is run with many permutations and three seeds; the test compares my values (same number of
permutations, my own seeded generator) within the permutation noise worked out from these runs.
The cases are fixed by a seed, so the file only changes when gseapy's or SciPy's answers change.
"""
import json
import math
import os

import numpy as np
import pandas as pd
import scipy
from scipy import stats
import gseapy

rng = np.random.RandomState(20261114)
NPERM = 5000
SEEDS = [11, 22, 33]


def r6(xs):
    return [round(float(x), 6) for x in xs]


def num(x):
    x = float(x)
    return x if math.isfinite(x) else None


def make_case(name, n, sets, shift=None, ties=False):
    genes = [f"G{i:03d}" for i in range(n)]
    vals = rng.normal(0, 1.5, n)
    if ties:
        vals = np.round(vals * 2) / 2  # many ties, for the rank test's normal approximation
    if shift:
        for g, d in shift.items():
            vals[genes.index(g)] += d
    vals = r6(vals)
    return {"name": name, "genes": genes, "values": vals, "sets": sets}


cases = []
# 1. a 60-gene panel with one set shifted up, one down, one random, one small
up = [f"G{i:03d}" for i in range(0, 10)]
down = [f"G{i:03d}" for i in range(20, 28)]
rand = [f"G{i:03d}" for i in (3, 15, 33, 41, 47, 52)]
small = ["G030", "G031", "G059"]
c = make_case("panel60", 60, {"UP": up, "DOWN": down, "RANDOM": rand, "SMALL": small},
              shift={**{g: 1.4 for g in up}, **{g: -1.2 for g in down}})
cases.append(c)
# 2. a 96-gene panel with overlapping sets
sets96 = {f"S{k}": [f"G{i:03d}" for i in rng.choice(96, size=int(s), replace=False)] for k, s in enumerate([4, 6, 9, 12, 15, 20, 30])}
cases.append(make_case("panel96", 96, sets96, shift={g: 0.9 for g in sets96["S3"]}))
# 3. a 30-gene panel (below the automatic GSEA threshold) for the rank test, with ties
sets30 = {"A": ["G000", "G001", "G002", "G003", "G004"], "B": [f"G{i:03d}" for i in range(10, 22)], "C": ["G025", "G026", "G027"]}
cases.append(make_case("panel30_ties", 30, sets30, shift={g: 1.0 for g in sets30["A"]}, ties=True))
# 4. a 384-gene panel, the largest qPCR arrays
sets384 = {f"P{k}": [f"G{i:03d}" for i in rng.choice(384, size=int(s), replace=False)] for k, s in enumerate([5, 10, 25, 40, 80])}
cases.append(make_case("panel384", 384, sets384, shift={g: 0.8 for g in sets384["P2"]}))

out = {"generated_with": {"gseapy": gseapy.__version__, "scipy": scipy.__version__, "numpy": np.__version__, "pandas": pd.__version__},
       "nperm": NPERM, "seeds": SEEDS, "cases": []}
for c in cases:
    has_ties = len(set(c["values"])) < len(c["values"])
    rec = {"name": c["name"], "genes": c["genes"], "values": c["values"], "sets": c["sets"], "gsea": None, "rank": {}}
    rnk = pd.DataFrame({"gene": c["genes"], "score": c["values"]})
    vals = dict(zip(c["genes"], c["values"]))
    for s, gs in c["sets"].items():
        a = [vals[g] for g in gs]
        b = [vals[g] for g in c["genes"] if g not in set(gs)]
        r = stats.mannwhitneyu(a, b, alternative="two-sided", method="auto")
        rec["rank"][s] = {"U": num(r.statistic), "p": num(r.pvalue)}
    if not has_ties:  # GSEA ES depends on the order of tied genes, so only lists without ties go to gseapy
        runs = []
        for seed in SEEDS:
            pre = gseapy.prerank(rnk=rnk, gene_sets=c["sets"], permutation_num=NPERM, weight=1, min_size=2, max_size=1000,
                                 seed=seed, threads=1, outdir=None, no_plot=True, verbose=False)
            d = pre.res2d.set_index("Term")
            runs.append({t: {"es": float(d.loc[t, "ES"]), "nes": float(d.loc[t, "NES"]), "p": float(d.loc[t, "NOM p-val"]),
                             "fdr": float(d.loc[t, "FDR q-val"]), "lead": str(d.loc[t, "Lead_genes"]).split(";")} for t in d.index})
        rec["gsea"] = {t: {"es": runs[0][t]["es"], "lead": runs[0][t]["lead"],
                           "nes": [x[t]["nes"] for x in runs], "p": [x[t]["p"] for x in runs], "fdr": [x[t]["fdr"] for x in runs]} for t in runs[0]}
    out["cases"].append(rec)

path = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "gsea-reference.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print("wrote", os.path.normpath(path))
