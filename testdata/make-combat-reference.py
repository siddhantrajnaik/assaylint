"""Reference values for web/combat.js, worked out with neuroCombat.

Writes tests/fixtures/combat-reference.json. Run it from a throwaway virtual environment outside the repo:

    python -m venv %TEMP%/platecheck-combatref          (or /tmp/platecheck-combatref)
    <venv>/Scripts/python -m pip install neuroCombat==0.2.12 combat==0.3.3 pandas numpy
    <venv>/Scripts/python testdata/make-combat-reference.py

Why neuroCombat: its parametric and mean-only code is a line-by-line port of sva::ComBat (variances with
n - 1, the same priors, the same iteration and stopping rule). I'd rather have used inmoose's pycombat_norm,
but it has no wheels for Windows. pyComBat (the "combat" package) is run as a second opinion only: it uses
variances with n (numpy's default ddof=0) for delta hat, t2 and the priors, so it differs from sva::ComBat
slightly, and the script prints by how much.

The cases are fixed by a seed. Neither package accepts missing values, so the missing-value path of
combat.js is covered by its own tests instead.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
from neuroCombat import neuroCombat
from combat.pycombat import pycombat

rng = np.random.RandomState(20261113)


def make(n_features, batches, groups, shift=1.0, scale=0.6, effect=1.5):
    """features x samples: gene level + group effect + per-batch location and scale + noise."""
    labels = sorted(set(batches))
    levels = sorted(set(groups))
    base = rng.normal(5, 2, n_features)
    eff = {g: rng.normal(0, effect, n_features) * (k > 0) for k, g in enumerate(levels)}
    loc = {b: rng.normal(0, shift, n_features) for b in labels}
    sc = {b: np.exp(rng.normal(0, scale, n_features)) for b in labels}
    x = np.empty((n_features, len(batches)))
    for i, (b, g) in enumerate(zip(batches, groups)):
        x[:, i] = base + eff[g] + loc[b] + sc[b] * rng.normal(0, 0.5, n_features)
    return np.round(x, 6)  # rounded so the JSON holds the inputs exactly as used


def run(name, x, batches, groups, mean_only, covariate=True):
    covars = pd.DataFrame({"batch": batches, "group": groups})
    nc = neuroCombat(dat=x.copy(), covars=covars, batch_col="batch",
                     categorical_cols=["group"] if covariate else [], mean_only=mean_only)["data"]
    pc = pycombat(pd.DataFrame(x.copy()), list(batches), mod=list(groups) if covariate else [], mean_only=mean_only).values
    rel = np.max(np.abs(pc - nc) / np.maximum(1, np.abs(nc)))
    print(f"{name}: pyComBat vs neuroCombat, largest relative difference {rel:.2e}", file=sys.stderr)
    return {"name": name, "batch": list(batches), "group": list(groups) if covariate else None, "meanOnly": mean_only,
            "data": x.tolist(), "expected": [[float(v) for v in row] for row in nc]}


cases = []
# balanced: 3 plates x 6 samples, two groups split evenly on every plate, 25 targets
b = [f"P{k}" for k in (1, 2, 3) for _ in range(6)]
g = ["ctrl", "trt"] * 9
x = make(25, b, g)
cases.append(run("balanced", x, b, g, False))
cases.append(run("balanced, mean-only", x, b, g, True))
# unbalanced: plates of 3, 5 and 8 samples, groups unevenly spread (but not confounded), 30 targets
b = ["A"] * 3 + ["B"] * 5 + ["C"] * 8
g = ["ctrl", "ctrl", "trt"] + ["ctrl", "trt", "trt", "trt", "trt"] + ["ctrl"] * 6 + ["trt"] * 2
x = make(30, b, g, shift=1.5, scale=0.8)
cases.append(run("unbalanced", x, b, g, False))
cases.append(run("unbalanced, mean-only", x, b, g, True))
# three groups as covariate, two plates
b = ["plate 1"] * 9 + ["plate 2"] * 9
g = ["ctrl", "low", "high"] * 6
x = make(22, b, g, effect=2.0)
cases.append(run("three groups", x, b, g, False))
# no covariate at all
b = ["X"] * 5 + ["Y"] * 4 + ["Z"] * 6
g = ["a"] * 15
x = make(20, b, g, effect=0)
cases.append(run("no covariate", x, b, g, False, covariate=False))
cases.append(run("no covariate, mean-only", x, b, g, True, covariate=False))
# a small qPCR-sized panel: 6 targets, 2 plates of 4
b = ["run 1"] * 4 + ["run 2"] * 4
g = ["ctrl", "ctrl", "trt", "trt"] * 2
x = make(6, b, g, shift=0.8, scale=0.3)
cases.append(run("small panel", x, b, g, False))

out = {"generator": "testdata/make-combat-reference.py", "reference": "neuroCombat 0.2.12 (port of sva::ComBat)",
       "numpy": np.__version__, "cases": cases}
path = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "combat-reference.json")
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=1)
    f.write("\n")
print(f"wrote {len(cases)} cases to {os.path.normpath(path)}", file=sys.stderr)
