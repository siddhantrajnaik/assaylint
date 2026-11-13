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

# ---------------------------------------------------------------- normal, chi-square and studentized range tails
norm_tails = [{"z": z, "sf": num(stats.norm.sf(z))} for z in [0.0, 0.1, -0.5, 1.0, 1.959964, 2.5, -3.2, 4.0, 6.5, 8.0, 12.0, -1e-3]]
chi2_tails = [{"x": x, "df": df, "sf": num(stats.chi2.sf(x, df))}
              for x, df in [(0.0, 1), (0.5, 1), (3.841459, 1), (2.0, 2), (7.3, 3), (11.0, 4), (30.0, 5), (0.01, 6), (55.0, 9), (1.5, 1.5)]]
tukey_tails = []
for q, k, df in [(0.5, 2, 5), (2.0, 3, 10), (3.5, 3, 10), (3.877, 3, 12), (4.5, 4, 6), (5.2, 5, 20), (1.0, 6, 30), (6.0, 3, 2),
                 (8.0, 4, 3), (3.0, 2, 200), (4.0, 8, 1000), (2.5, 3, 1), (10.0, 5, 1), (3.0, 10, 40), (12.0, 3, 9)]:
    tukey_tails.append({"q": q, "k": k, "df": df, "sf": num(stats.studentized_range.sf(q, k, df))})


def random_groups(k, lo=2, hi=7, shift=2.0):
    return [r6(rng.normal(rng.uniform(-shift, shift), rng.uniform(0.2, 1.5), rng.randint(lo, hi))) for _ in range(k)]


# ---------------------------------------------------------------- Student, one-sample and paired t-tests
student = []
for a, b in cases + [([1.0], [2.0, 3.0, 2.5]), ([4.0, 4.4, 3.9], [4.1])]:
    r = stats.ttest_ind(a, b, equal_var=True)
    student.append({"a": a, "b": b, "t": num(r.statistic), "df": num(r.df), "p": num(r.pvalue)})
one_sample = []
for x, mu in [([1.0, 2.0], 0.0), ([0.3, -0.1, 0.25, 0.4], 0.0), ([5.1, 5.3, 5.2], 5.0), ([-2.0, -2.2, -1.9, -2.1, -2.05], 0.0)] + \
             [(r6(rng.normal(rng.uniform(-2, 2), rng.uniform(0.1, 2), rng.randint(2, 10))), 0.0) for _ in range(6)]:
    r = stats.ttest_1samp(x, mu)
    one_sample.append({"x": x, "mu": mu, "t": num(r.statistic), "df": num(r.df), "p": num(r.pvalue)})
paired = []
for _ in range(8):
    n = rng.randint(2, 9)
    a = r6(rng.normal(rng.uniform(-8, -4), 0.8, n))
    b = r6(np.array(a) + rng.normal(rng.uniform(-1.5, 1.5), rng.uniform(0.05, 0.8), n))
    r = stats.ttest_rel(a, b)
    paired.append({"a": a, "b": b, "t": num(r.statistic), "df": num(r.df), "p": num(r.pvalue)})

# ---------------------------------------------------------------- Tukey HSD and Dunnett
post_cases = [
    [[1.0, 2.0, 3.0, 2.5], [3.0, 4.0, 5.0, 4.2], [2.0, 3.0, 2.2, 3.1]],
    [[5.0, 5.2], [6.1, 6.0, 6.3], [5.1, 5.4, 4.9, 5.2], [7.0, 7.4, 7.1]],          # unequal n
    [[0.0, 0.1, -0.1], [0.05, 0.0, 0.1]],                                        # two groups
    [[2.0, 2.1, 2.05], [9.0, 9.1, 9.05], [15.0, 15.1, 15.02]],                  # tiny p
    [[1.0, 1.5], [2.0, 2.5], [1.2, 1.9]],                                        # df = 3
]
for _ in range(9):
    post_cases.append(random_groups(rng.randint(3, 7)))
tukey = []
for gs in post_cases:
    r = stats.tukey_hsd(*gs)
    pairs = [{"i": i, "j": j, "p": num(r.pvalue[i, j])} for i in range(len(gs)) for j in range(i + 1, len(gs))]
    tukey.append({"groups": gs, "pairs": pairs})
dunnett = []
for gs in post_cases:
    # SciPy's p comes from a quasi-Monte Carlo multivariate t CDF, which moves by about 1e-4 between seeds;
    # the mean over 16 seeds is used as the reference (its spread is also stored).
    runs = [stats.dunnett(*gs[1:], control=gs[0], alternative="two-sided", rng=np.random.default_rng(seed)) for seed in range(16)]
    ps = np.array([r.pvalue for r in runs])
    dunnett.append({"groups": gs, "t": [num(x) for x in runs[0].statistic], "p": [num(x) for x in ps.mean(axis=0)],
                    "p_sd_between_seeds": [num(x) for x in ps.std(axis=0, ddof=1)]})

# ---------------------------------------------------------------- Mann–Whitney, Kruskal–Wallis, Dunn
mwu = []
mcases = [([1.0, 2.0, 3.0], [4.0, 5.0, 6.0, 7.0]), ([1.0, 2.0], [3.0, 4.0]), ([1.0], [2.0, 3.0]), ([5.0, 1.0, 3.0], [2.0, 4.0, 6.0]),
          ([1.0, 2.0, 2.0], [2.0, 3.0, 4.0]),                         # ties: normal approximation
          ([3.0, 3.0, 3.0], [3.0, 3.0]),                              # all tied
          ([1.1, 2.2, 3.3, 4.4], [1.1, 2.2, 3.3, 4.4]),               # identical with ties
          (list(range(1, 10)), list(range(5, 15)))]                   # n > 8 both, ties
for _ in range(8):
    n1, n2 = rng.randint(1, 12), rng.randint(1, 12)
    mcases.append((r6(rng.normal(0, 1, n1)), r6(rng.normal(rng.uniform(-1, 1.5), 1, n2))))
for _ in range(3):
    mcases.append(([float(v) for v in rng.randint(0, 5, rng.randint(4, 12))], [float(v) for v in rng.randint(1, 6, rng.randint(4, 12))]))
for a, b in mcases:
    a, b = [float(v) for v in a], [float(v) for v in b]
    r = stats.mannwhitneyu(a, b, alternative="two-sided", method="auto")
    mwu.append({"a": a, "b": b, "U": num(r.statistic), "p": num(r.pvalue) if math.isfinite(r.pvalue) else None})
kruskal = []
kcases = [[[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [2.0, 2.0, 9.0]], [[1.0, 1.0, 2.0], [2.0, 3.0, 3.0]], [[0.5, 0.7], [1.1, 0.9, 1.3], [2.0, 2.2, 1.8, 2.4]]]
for _ in range(9):
    kcases.append(random_groups(rng.randint(2, 6)))
kcases.append([[float(v) for v in rng.randint(0, 4, 5)] for _ in range(4)])
for gs in kcases:
    r = stats.kruskal(*gs)
    kruskal.append({"groups": gs, "H": num(r.statistic), "p": num(r.pvalue)})


def dunn_ref(gs):
    # Dunn (1964) z statistics written out with scipy.stats.rankdata and scipy.stats.norm (SciPy has no Dunn test).
    allv = np.concatenate([np.asarray(g, float) for g in gs])
    ranks = stats.rankdata(allv)
    N = len(allv)
    _, counts = np.unique(allv, return_counts=True)
    v = N * (N + 1) / 12 - np.sum(counts ** 3 - counts) / (12 * (N - 1))
    out, o = [], 0
    mr = []
    for g in gs:
        mr.append(ranks[o:o + len(g)].mean())
        o += len(g)
    for i in range(1, len(gs)):
        z = (mr[i] - mr[0]) / math.sqrt(v * (1 / len(gs[i]) + 1 / len(gs[0])))
        out.append({"i": i, "j": 0, "z": z, "p": num(2 * stats.norm.sf(abs(z)))})
    ps = [c["p"] for c in out]
    bh = stats.false_discovery_control(ps, method="bh")
    for c, b in zip(out, bh):
        c["p_bh"] = num(b)
        c["p_bonferroni"] = min(1.0, c["p"] * len(ps))
    return out


dunn = [{"groups": gs, "comparisons": dunn_ref(gs)} for gs in kcases]

out = {"generated_by": "testdata/make-stats-reference.py", "python": sys.version.split()[0],
       "scipy": scipy.__version__, "numpy": np.__version__,
       "descriptive": descriptive, "t_tails": t_tails, "f_tails": f_tails, "welch": welch, "anova": anova, "adjust": adjust,
       "norm_tails": norm_tails, "chi2_tails": chi2_tails, "tukey_tails": tukey_tails, "student": student, "one_sample": one_sample,
       "paired": paired, "tukey": tukey, "dunnett": dunnett, "mannwhitney": mwu, "kruskal": kruskal, "dunn": dunn}
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = os.path.join(root, "tests", "fixtures", "stats-reference.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8", newline="\n") as fh:
    json.dump(out, fh, indent=1)
    fh.write("\n")
print(f"wrote {path}: {len(welch)} Welch, {len(anova)} ANOVA, {len(adjust)} correction, {len(tukey)} Tukey, {len(dunnett)} Dunnett, {len(mwu)} Mann-Whitney, {len(kruskal)} Kruskal-Wallis cases")
