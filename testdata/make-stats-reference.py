"""Reference values for web/stats.js, worked out with SciPy and NumPy.

Writes tests/fixtures/stats-reference.json. Run it from a throwaway virtual environment outside the repo:

    python -m venv %TEMP%/platecheck-statsref          (or /tmp/platecheck-statsref)
    <venv>/Scripts/python -m pip install scipy numpy    (bin/python on Linux and macOS)
    <venv>/Scripts/python testdata/make-stats-reference.py

The cases are fixed by a seed, so the file only changes when SciPy's answers change.
"""
import json
import math
import os
import sys

import numpy as np
import scipy
from scipy import stats

rng = np.random.RandomState(20261113)
r6 = lambda xs: [round(float(x), 6) for x in xs]  # inputs rounded so the JSON holds them exactly as used


def num(x):
    x = float(x)
    return x if math.isfinite(x) else None


# ---------------------------------------------------------------- descriptive
descriptive = []
for vals in [[1.0, 2.0], [20.1, 20.1, 20.1], [18.2, 18.31, 18.05], [24.0], [0.1, -0.2, 0.3, 5.0, 1e-3],
             r6(rng.normal(25, 0.3, 4)), r6(rng.normal(30, 2, 9)), r6(rng.normal(-3, 0.01, 2))]:
    a = np.array(vals)
    descriptive.append({"x": vals, "mean": num(a.mean()),
                        "sd": num(a.std(ddof=1)) if len(a) > 1 else None,
                        "sem": num(stats.sem(a)) if len(a) > 1 else None})

# ---------------------------------------------------------------- distribution tails
t_tails = []
for t, df in [(0.0, 1), (0.5, 1), (2.0, 2), (-2.0, 2), (1.96, 1000), (3.1, 2.37), (10.0, 3.5), (25.0, 4),
              (0.01, 7.25), (4.2, 11.8), (-6.5, 5.01), (60.0, 9), (1.0, 0.5), (2.5, 150.3), (0.3, 2.000001)]:
    t_tails.append({"t": t, "df": df, "p_two_sided": num(2 * stats.t.sf(abs(t), df)), "cdf": num(stats.t.cdf(t, df))})
f_tails = []
for f, d1, d2 in [(0.0, 1, 1), (1.0, 2, 3), (3.5, 2, 6), (10.0, 3, 8), (0.2, 4, 20), (50.0, 1, 2),
                  (120.0, 2, 9), (2.0, 5, 100), (0.999, 3, 3), (7.7, 1, 4)]:
    f_tails.append({"f": f, "d1": d1, "d2": d2, "p_upper": num(stats.f.sf(f, d1, d2))})

# ---------------------------------------------------------------- Welch t-tests
cases = [
    ([1.0, 2.0], [3.0, 5.0]),                              # n = 2 each
    ([5.1, 5.3], [5.2, 5.25, 5.4]),                        # n = 2 vs 3
    ([10.0, 10.0, 10.5], [11.0, 11.0, 11.0, 11.4]),        # ties
    ([1.0, 1.1, 0.9], [1.0, 1.1, 0.9]),                    # identical groups, p = 1
    ([2.0, 2.0, 2.1, 2.1], [8.0, 8.1, 8.0, 8.1]),          # huge t
    ([0.1, 0.2, 0.15], [5.0, -4.0, 12.0, 3.0, -7.0]),      # very unequal variances
    ([-6.08, -5.81, -6.3], [-4.02, -4.4, -3.79]),          # ΔCt-like
]
for _ in range(14):
    n1, n2 = rng.randint(2, 9), rng.randint(2, 9)
    cases.append((r6(rng.normal(rng.uniform(-8, 8), rng.uniform(0.05, 3), n1)),
                  r6(rng.normal(rng.uniform(-8, 8), rng.uniform(0.05, 3), n2))))
welch = []
for a, b in cases:
    r = stats.ttest_ind(a, b, equal_var=False)
    df = getattr(r, "df", None)
    welch.append({"a": a, "b": b, "t": num(r.statistic), "df": num(df) if df is not None else None, "p": num(r.pvalue)})

# ---------------------------------------------------------------- one-way ANOVA
anova = []
acases = [
    [[1.0, 2.0], [3.0, 4.0], [5.0, 7.0]],
    [[20.0, 20.0, 20.5], [20.1, 20.2], [19.9, 20.4, 20.3, 20.0]],     # ties
    [[1.0, 1.1], [1.0, 1.1]],                                          # two equal groups
    [[2.0, 2.1, 2.05], [9.0, 9.1, 9.05], [15.0, 15.1, 15.02]],        # tiny p
]
for _ in range(10):
    k = rng.randint(2, 6)
    acases.append([r6(rng.normal(rng.uniform(-3, 3), rng.uniform(0.1, 2), rng.randint(2, 7))) for _ in range(k)])
for gs in acases:
    r = stats.f_oneway(*gs)
    N, k = sum(len(g) for g in gs), len(gs)
    anova.append({"groups": gs, "F": num(r.statistic), "df1": k - 1, "df2": N - k, "p": num(r.pvalue)})

# ---------------------------------------------------------------- multiple-testing corrections
adjust = []
pcases = [[0.01], [0.01, 0.02, 0.03, 0.04, 0.05], [0.05, 0.05, 0.05], [1.0, 0.5, 0.0001, 0.2],
          [0.04, 0.001, 0.001, 0.9, 0.03, 0.03, 0.6], [0.3, 0.2, 0.1]]
for _ in range(6):
    pcases.append(r6(rng.uniform(0, 1, rng.randint(2, 15)) ** 3))
for ps in pcases:
    adjust.append({"p": ps, "bh": [num(x) for x in stats.false_discovery_control(ps, method="bh")],
                   "bonferroni": [min(1.0, p * len(ps)) for p in ps]})

out = {"generated_by": "testdata/make-stats-reference.py", "python": sys.version.split()[0],
       "scipy": scipy.__version__, "numpy": np.__version__,
       "descriptive": descriptive, "t_tails": t_tails, "f_tails": f_tails, "welch": welch, "anova": anova, "adjust": adjust}
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(root, "tests", "fixtures", "stats-reference.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(out, fh, indent=1)
    fh.write("\n")
print(f"wrote {path}: {len(welch)} Welch, {len(anova)} ANOVA, {len(adjust)} correction cases")
