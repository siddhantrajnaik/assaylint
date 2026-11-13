# Analysis: fold change, statistics and combining plates

The Analysis step works out relative expression from a checked plate: ΔCt against reference genes, ΔΔCt against a control group, fold change, a statistical test of your choice with corrected p values, and graphs. It's off until you switch it on. Everything runs in your browser, like the rest of PlateCheck.

It never picks reference genes for you. It marks targets whose names are often used as references (GAPDH, ACTB, B2M, 18S/RN18S1, HPRT1, TBP, U6/RNU6, RNU44, RNU48 and a few more), but whether a gene is stable in your samples is your call.

Code: `web/analysis.js` (calculations), `web/stats.js` (statistics), `web/combat.js` (ComBat), `web/ui-analysis.js` (screens and graphs). Tests: `tests/analysis.test.mjs`, `tests/stats.test.mjs`, `tests/combat.test.mjs`.

## What goes in

- Only wells with the role Sample, a target, a biological unit (the bio_unit label, or the sample name when there isn't one) and a group label. Controls, standards and empty wells are left out.
- Wells marked Omit in the instrument software are left out by default (you can switch that off), and so are any wells you list under "Other wells to leave out". Only the analysis skips them; they stay in the data, the checks and the report.
- Wells with no Ct (Undetermined and the like) are left out and listed in the notes. If a gene didn't amplify because it isn't expressed, leaving those wells out makes its level look higher than it is, so the note says so.
- Technical replicates are averaged (arithmetic mean of Ct) per biological unit and target. From then on the biological unit is the unit of analysis; technical replicates are never counted as n.
- For the paired t-test only: a pair label per biological unit (the optional `pair` field). Set it on the Plate step (More options, "Pair (for the paired t-test)") or give your file or plate-map template a column called Pair, Pair ID or Pairing. Units in different groups with the same pair label are matched (for example the same mouse before and after, or one donor's cells split into control and treated).

## Formulas

For biological unit *u*, target *t* and reference genes *R* (one or more):

- Reference level: `Ct_ref(u) = mean over r in R of Ct_r(u)`. The mean of Ct values is the log of the geometric mean of the quantities, which is how several reference genes are combined in Vandesompele et al. (2002).
- `ΔCt(u, t) = Ct_t(u) − Ct_ref(u)`
- `ΔΔCt(u, t) = ΔCt(u, t) − mean of ΔCt(c, t) over the control group's units c`
- Fold change `= 2^−ΔΔCt` (Livak & Schmittgen 2001).
- Group fold change `= 2^−mean ΔΔCt`, the geometric mean of the units' fold changes. Error bars are worked out on the log scale and transformed back: `2^−(mean ΔΔCt ± SD)` (or SEM), so they are asymmetric on a linear axis and symmetric on the log axis.

### Efficiency correction (Pfaffl 2001)

When switched on, each target's efficiency comes from its standard curve on the plate: `E = 10^(−1/slope)` (the amplification factor, 2 for 100%). Every Ct is multiplied by `w_t = log2(E_t)` before the steps above:

- `ΔCt(u, t) = w_t·Ct_t(u) − mean over r of w_r·Ct_r(u)`

With one reference gene and group means this gives exactly Pfaffl's ratio

`ratio = E_target^(Ct_target(control) − Ct_target(sample)) / E_ref^(Ct_ref(control) − Ct_ref(sample))`

and with several references it is the qBase normalised relative quantity on the log2 scale (Hellemans et al. 2007). With `E = 2` everywhere, `w = 1` and it reduces to plain ΔΔCt. A target without a standard curve gets 100% and a note; an efficiency outside 90–110% gets a note too. If several plates in a study have a curve for the same target, their efficiencies are averaged.

## Statistics

- Tests run on ΔCt (log scale), with biological units as n. ΔΔCt differs from ΔCt by a constant, so the tests are the same either way. All tests are two-sided.
- You choose the test in the analysis settings. The default is Welch's t-test, as before. Under each choice the app says in one line when to use it.

### The tests

| Choice | What it compares | Statistic and p |
| --- | --- | --- |
| Welch t-test (default) | each group with the control | `t = (m₁ − m₀) / sqrt(s₁²/n₁ + s₀²/n₀)`, Welch–Satterthwaite df (Welch 1947) |
| Student t-test | each group with the control | `t = (m₁ − m₀) / sqrt(s_p² (1/n₁ + 1/n₀))`, `s_p²` pooled from the two groups, df = n₁ + n₀ − 2 (Student 1908) |
| Paired t-test | each group with the control, unit by unit | one-sample t-test of the differences `d = ΔCt(unit) − ΔCt(its control partner)` against 0: `t = mean(d) / (sd(d)/sqrt(n))`, df = pairs − 1 |
| One-way ANOVA + Tukey | every pair of groups | `q = |mᵢ − mⱼ| / sqrt(MSE/2 · (1/nᵢ + 1/nⱼ))`, MSE pooled over all k groups, p = P(Q ≥ q) for the studentized range with k groups and N − k df (Tukey 1949; Kramer 1956 for unequal n) |
| One-way ANOVA + Dunnett vs control | each group with the control | `tᵢ = (mᵢ − m₀) / sqrt(MSE (1/nᵢ + 1/n₀))`, p = P(maxⱼ |Tⱼ| ≥ |tᵢ|) under the multivariate t with N − k df (Dunnett 1955) |
| Mann–Whitney (non-parametric) | each group with the control | U of the group from the ranks of both groups together; exact or normal approximation (Mann & Whitney 1947) |
| Kruskal–Wallis + Dunn | all groups, then each group with the control | `H = [12/(N(N+1)) Σ Rᵢ²/nᵢ − 3(N+1)] / (1 − Σ(t³ − t)/(N³ − N))`, chi-square with k − 1 df (Kruskal & Wallis 1952); then Dunn's z for each group against the control (Dunn 1964) |

Details:

- **Welch vs Student.** I keep Welch as the default because it doesn't assume equal variances, and with groups of 3 to 6 you can't check that assumption. When the variances really are equal the two give nearly the same p.
- **Paired t-test.** Units are matched by their pair label. A unit without a label, or whose label has no partner in the other group, is left out and named in the notes. A label used twice in one group can't be paired; those are named too. If no unit in the analysis has a pair label, the app works out no p values and says why, instead of quietly running an unpaired test. Fold changes and error bars are still the group means; only the test is paired.
- **Tukey.** All k(k − 1)/2 pairs are tested; the results table shows each group against the control, and a second table lists every pair. The studentized range CDF is a port of R's `ptukey` (Copenhaver & Holland 1988): Gauss–Legendre quadrature of Hartley's form for the range of k normals, integrated over the distribution of the variance estimate. R's routine needs at least 2 df; for 1 df I integrate the same range CDF over the density of `s/σ` directly.
- **Dunnett.** The correlation between the comparisons i and j is `ρᵢⱼ = λᵢλⱼ` with `λᵢ = sqrt(nᵢ/(nᵢ + n₀))`, also with unequal n. Because of this product form the multivariate t probability is exactly a two-dimensional integral: given the standard normal Y shared through the control mean and `u = s/σ`, the comparisons are independent, so `P(all |Tᵢ| < c) = ∫ f(u) ∫ φ(y) Πᵢ [Φ((cu − λᵢy)/sqrt(1 − λᵢ²)) − Φ((−cu − λᵢy)/sqrt(1 − λᵢ²))] dy du`, where f is the density of u (`u² = χ²_df/df`). I integrate it with 16-point Gauss–Legendre on 6 panels over y in [0, 8.6] (the integrand is even in y) and 8 panels over u (12 when df < 3) covering all but a negligible part of f. Doubling the panels changes the result by less than 2e-14. This handles unequal n exactly, with no approximation beyond the quadrature. SciPy's `dunnett` computes the same probability by quasi-Monte Carlo (`multivariate_t.cdf`), which is why its p moves in the fourth decimal from one random seed to the next.
- **Mann–Whitney.** As `scipy.stats.mannwhitneyu(method="auto")`: the exact distribution of U when there are no ties and at least one group has 8 or fewer units (counted by the usual recursion), otherwise the normal approximation with the tie correction `σ² = n₁n₀/12 · ((N + 1) − Σ(t³ − t)/(N(N − 1)))` and a continuity correction of 0.5. With 3 units in each group the smallest possible two-sided p is 2/20 = 0.1, so the test can never reach 0.05. The app works out the smallest possible p for each comparison and warns when it is above 0.05.
- **Kruskal–Wallis + Dunn.** Ranks are taken over all groups of a target together (ties get the mean rank). Dunn's `z = (R̄ᵢ − R̄₀) / sqrt((N(N+1)/12 − Σ(t³ − t)/(12(N − 1))) · (1/nᵢ + 1/n₀))`, p from the normal distribution. Only the comparisons with the control are tested (k − 1 of them), and their p values are adjusted within the target by Benjamini–Hochberg or Bonferroni, whichever you chose. The Kruskal–Wallis H for each target is shown in its own table.
- **ANOVA alongside.** For the t-tests, Tukey and Dunnett, a target with more than two groups also gets the one-way ANOVA F test in a separate table. For the two rank tests it gets Kruskal–Wallis instead.
- **Small groups.** Fewer than 3 biological replicates in a group gives a warning. With one replicate there is no p value at all. Rank tests use only the order of the values, so with 3 to 5 replicates per group they have very little power: a real difference will often come out as not significant. The app says so next to the choice and in the notes.

### Multiple testing

- Welch, Student, paired and Mann–Whitney: each p is for one comparison. Benjamini–Hochberg (1995) and Bonferroni are applied across every group-vs-control comparison of every target in the analysis, as before.
- Tukey, Dunnett and Dunn: the p already accounts for the several comparisons within a target, so I don't correct within the target a second time. When there are several targets, BH and Bonferroni are applied across targets only, separately for each comparison (for example "drug A vs control" across all genes). With one target the BH and Bonferroni columns equal the test's own p.
- You choose which correction goes on the graphs. ANOVA and Kruskal–Wallis p values are corrected across targets in the same way.
- The results table, the CSV, the graph note and the report all name the test and say which p is shown.

### Distributions

- Student t and F: the regularised incomplete beta function (continued fraction, modified Lentz method; log-gamma by the Lanczos approximation).
- Normal and chi-square: the regularised incomplete gamma function (series below a + 1, continued fraction above), with `erfc(x) = Q(1/2, x²)`.
- Studentized range and Dunnett's multivariate t: Gauss–Legendre quadrature as described above.

### Checked against SciPy

`testdata/make-stats-reference.py` runs SciPy and NumPy on fixed cases and writes `tests/fixtures/stats-reference.json`; `tests/stats.test.mjs` compares every function with it. The earlier cases (Welch, ANOVA, the corrections, t and F tails) are unchanged. Cases include n = 1 and 2, ties, all values tied, identical groups, very unequal variances, tiny p, unequal n, 1 and 2 df, and seeded random data.

| Function | Compared with | Required | Worst on the current file |
| --- | --- | --- | --- |
| Welch, ANOVA, BH, Bonferroni, t and F tails | `ttest_ind(equal_var=False)`, `f_oneway`, `false_discovery_control`, `t`, `f` | relative 1e-10 | about 1e-11 |
| Student, one-sample, paired t-test | `ttest_ind`, `ttest_1samp`, `ttest_rel` | relative 1e-10 | 6e-15 |
| Normal and chi-square tails | `norm.sf`, `chi2.sf` | relative 1e-10 | 2e-14 |
| Studentized range tail | `studentized_range.sf` | absolute 1e-6 | 1.5e-9 |
| Tukey HSD p | `tukey_hsd` | absolute 1e-6 | 4.8e-7 |
| Dunnett p | `dunnett` (mean over 16 QMC seeds) | absolute 1e-4 | 5.3e-5 |
| Dunnett with one comparison | Student's t (exact equivalent) | absolute 1e-9 | 2.7e-12 |
| Mann–Whitney U and p, exact and normal | `mannwhitneyu(method="auto")` | relative 1e-10 | 4e-15 |
| Kruskal–Wallis H and p | `kruskal` | relative 1e-10 | 6e-15 |
| Dunn z, p, BH, Bonferroni | the formula written with `rankdata` and `norm.sf` | relative 1e-10 | 4e-15 |

Notes on the comparison:

- The Tukey error (about 5e-7 at most) is the accuracy of the R algorithm I ported; SciPy integrates the studentized range more precisely. It is far below anything that matters for a p value.
- SciPy's Dunnett p comes from a quasi-Monte Carlo estimate. On these cases its standard deviation between random seeds is up to 1.7e-4, so a single SciPy run is not a precise reference. The fixture stores the mean of 16 seeds and their spread. My values differ from that mean by at most 5.3e-5, which is within the seed-to-seed noise. As an exact check, Dunnett's test with a single treated group must equal Student's t-test with the same pooled variance, and it does to 3e-12.
- SciPy has no Dunn test, so the Dunn reference is the formula above written out in Python with SciPy's ranking and normal distribution. It checks the arithmetic (ranks, ties, standard error, adjustment), not the choice of formula; that comes from Dunn (1964).
- The tests print the worst disagreement per function (`node --test tests/stats.test.mjs`).

To regenerate (in a throwaway virtual environment outside the repository):

```bash
python -m venv /tmp/platecheck-statsref
/tmp/platecheck-statsref/bin/python -m pip install scipy numpy
/tmp/platecheck-statsref/bin/python testdata/make-stats-reference.py
```

The file in the repository was made with SciPy 1.18.1.

## Reference gene check

For each chosen reference I compare its mean Ct between groups (units averaged first). It is flagged when

- the group means differ by more than 0.5 cycles (you can change this), or
- the difference is significant (Welch t-test for two groups, ANOVA for more, p < 0.05).

Why 0.5 cycles: a reference that moves by d cycles changes every fold change by about 2^d, so 0.5 cycles is already a 1.4-fold bias, which is about the size of effect many papers report. I added the p value because with good replicates a smaller shift can still be real; with 2 or 3 units per group the test has little power, which is why the cycle threshold is there as well. The check can't prove a reference is stable. geNorm (Vandesompele et al. 2002) with three or more candidate references is the better tool for choosing them in the first place.

## Several plates (a study)

"Combine plates" in the sidebar groups saved runs into a study. Studies are saved in your browser like runs. Biological units with the same name on different plates are treated as the same biological sample, and their plates are averaged (the app says so when it happens).

Before the plates are merged, each target's Ct values are lined up between plates in one of four ways:

1. **Calibrator sample on every plate** (recommended). This is the inter-run calibration of qBase (Hellemans et al. 2007): the same sample (for example pooled cDNA) is run on every plate. For each target and plate the calibration factor is the mean Ct of the calibrators on that plate (the log of the geometric mean of their quantities), and every Ct of that target on that plate is shifted by that factor minus the mean factor over plates. qBase divides the normalised relative quantities, gene by gene, by a calibration factor equal to the geometric mean of the calibrators' NRQs; on the log scale that is the same subtraction, so the fold changes come out identical. Only calibrators measured on every plate that has the target are used. When there is none for a target, that target is left uncalibrated with a note. Plates that share no calibrator with the largest connected set of plates are listed as "not connected by a calibrator".
2. **Centre each plate** (no calibrator). Each target's Ct values on a plate are shifted so the plate's mean equals the mean over plates. This is only fair when every plate holds a similar mix of groups; if one plate holds mostly treated samples, centring removes the real difference. The app warns about this every time.
4. **ComBat** (large panels only). Empirical Bayes batch correction (Johnson, Li & Rabinovic 2007) on ΔCt, with plate as the batch and group as a covariate. Details below.
5. **No correction.** Only if every plate was run and analysed under the same conditions. Also warned about.

Calibrator samples don't need a group label; units without a group take part in calibration but not in the comparisons.

### ComBat

ComBat is the standard batch correction for microarray and RNA-seq data. I added it for studies that spread many targets over several plates without a calibrator. For a typical qPCR panel it is the wrong tool, and the app says so (see "When to use it").

**What goes in.** One value per biological unit, plate and target: ΔCt = w_t·Ct_t − mean over references of w_r·Ct_r, with the same efficiency weights as the rest of the analysis (w = 1 at 100% efficiency). The features are the targets that aren't references, and the samples are the grouped biological units on each plate. I use ΔCt rather than Ct for three reasons:

- the reference genes have already taken out differences in input amount, so the spread ComBat measures on each plate is the spread the t-tests later use, not loading noise;
- ΔCt is the scale the statistics run on;
- the references themselves would be poor features, since with one reference their ΔCt is exactly 0.

The corrected ΔCt is written back as Ct (Ct' = (ΔCt' + reference level) / w_t), and the technical replicates are shifted with it. The references are not changed.

Units with no group (a calibrator, for example) aren't in the model and aren't corrected. A unit with no reference value on a plate isn't corrected on that plate either. Both cases get a note. A unit measured on two plates counts as two samples.

**The model.** For target g, sample i on plate j:

`y_ijg = α_g + X_i·β_g + γ_jg + δ_jg·ε_ijg`, with `ε_ijg ~ N(0, σ_g²)`

X holds the group labels. Keeping them in the model is what stops ComBat from removing real group differences along with the plate effect. γ is the plate's additive effect on that target and δ its multiplicative effect on the spread. The steps:

1. Least squares on plate indicators plus group indicators, per target. Grand mean `α̂_g = Σ_j (n_j / n)·γ̂_jg`. Pooled variance `σ̂_g²` = mean squared residual (divided by n, as in sva).
2. Standardise: `z_ijg = (y_ijg − α̂_g − X_i·β̂_g) / σ̂_g`.
3. Per plate and target: `γ̂_jg` = mean of z on the plate, `δ̂²_jg` = its sample variance (n − 1).
4. Priors per plate, estimated across all targets (this is the empirical Bayes part): `γ_jg ~ N(γ̄_j, τ̄_j²)`, from the mean and variance of the γ̂. `δ²_jg ~ InvGamma(λ_j, θ_j)` with `λ = (2s² + m²)/s²` and `θ = (m·s² + m³)/s²`, where m and s² are the mean and variance of the δ̂².
5. Posterior estimates, iterated until no value changes by more than 0.01% (relative):
   `γ*_jg = (n_j·τ̄_j²·γ̂_jg + δ*²_jg·γ̄_j) / (n_j·τ̄_j² + δ*²_jg)` and
   `δ*²_jg = (θ_j + ½·Σ_i (z_ijg − γ*_jg)²) / (n_j/2 + λ_j − 1)`.
6. Adjust: `y*_ijg = σ̂_g·(z_ijg − γ*_jg)/δ*_jg + α̂_g + X_i·β̂_g`.

**Mean-only** switches off the scale part: `δ* = 1` and `γ*_jg = (τ̄_j²·γ̂_jg + γ̄_j)/(τ̄_j² + 1)`, the same formula sva::ComBat uses for `mean.only = TRUE`. It only shifts each plate, which is safer when plates hold few samples.

**When it refuses.** It runs nothing, says why, and combines the plates without correction when:

- a plate has only one sample. A single sample has no spread, so its plate effect can't be told apart from its own biology. sva::ComBat switches to mean-only here; I would rather say so plainly;
- groups are confounded with plates, for example every control on plate 1 and every treated sample on plate 2. I check that the design (plate indicators plus group indicators) has full rank. If it doesn't, the plate effect and the group difference are the same column, and removing one removes the other;
- a plate has fewer than 2 targets that can be corrected, because the prior is estimated across targets;
- every target has exactly the same spread on a plate, so the scale prior can't be estimated (mean-only still works).

A target that is missing on a plate is left alone on that plate (nothing to correct). A target with a single value on a plate is left alone on that plate. A target with identical values within a plate is left out of the correction entirely, as sva::ComBat does. Each case gets a note. With missing values, the grand mean and pooled variance of a target use only the samples where it was measured; sva differs slightly here.

**When to use it.** Only with all of these:

- at least 2 samples per plate. I'd want 4 or more before rescaling a plate, and below that the app suggests mean-only, since a variance from 2 or 3 values is very rough;
- groups spread over the plates;
- roughly 20 targets or more. The method's strength is that it borrows information across targets: how big plate effects usually are (γ̄, τ̄², λ, θ) is learnt from every target together. With 6 or 10 targets those four numbers come from 6 or 10 values per plate. The shrinkage then does little, and ComBat is close to per-plate centring with a group term, with extra assumptions. For panels below about 20 targets the app warns and recommends a calibrator sample on every plate, which corrects each target directly from a sample whose true value is the same on every plate.

The study view shows a before/after plot: for each plate, the ΔCt values minus their target's mean over all plates. After a good correction every plate's box sits around zero with a similar width.

**Checked against neuroCombat.** `testdata/make-combat-reference.py` runs neuroCombat 0.2.12, whose parametric and mean-only code is a direct port of sva::ComBat: n − 1 variances, the same priors, the same iteration and stopping rule. It covers eight fixed cases: balanced (3 plates × 6), unbalanced (plates of 3, 5 and 8 with uneven groups), each also mean-only, three groups as covariate, no covariate (with and without mean-only), and a 6-target panel. The results are in `tests/fixtures/combat-reference.json`, and `tests/combat.test.mjs` requires agreement to a relative error of 1e-6. The worst disagreement on the current file is 4e-8, on the 6-target case; the others agree to about 1e-15.

I would rather have used inmoose's pycombat_norm or sva itself, but inmoose has no Windows wheels and sva needs a Bioconductor install. I also ran pyComBat (the "combat" package, 0.3.3) as a second opinion. It differs from both by up to 70% in the scale-adjusted cases and about 1% in mean-only. In its source, delta hat, t² and the priors use variances with n rather than n − 1, and its iteration subtracts the first target's γ from every target, so I don't use it as the reference. Neither Python package accepts missing values, so the missing-value path is checked by its own tests instead.

To regenerate (in a throwaway virtual environment outside the repository):

```bash
python -m venv /tmp/platecheck-combatref
/tmp/platecheck-combatref/bin/python -m pip install neuroCombat==0.2.12 combat==0.3.3 pandas numpy
/tmp/platecheck-combatref/bin/python testdata/make-combat-reference.py
```

## Graphs

- Fold change: one panel per target, groups along the x axis. Large blue dots are biological replicates (the mean of their technical replicates); small orange dots are the individual technical replicates; the black line and whiskers are mean ± SD (or SEM). Above each group: stars and the adjusted p against the control (*** < 0.001, ** < 0.01, * < 0.05, ns otherwise). The note under the figure names the test and the adjustment. The fold-change axis is log scale by default (fold changes are ratios, so 0.5 and 2 are the same distance from 1); a linear axis is available.
- Volcano plot, when there are 6 or more target genes: log2 fold change against −log10 p, with points that stay significant after correction coloured and labelled. For the two-group tests the y axis is the unadjusted p; for Tukey, Dunnett and Dunn it is their p, already adjusted within each gene. The axis label says which.
- Colours are from a colour-blind safe palette (blue #0072B2, orange #E69F00, vermillion #D55E00). Text is Arial/Helvetica, which journals usually ask for. Gene names are in italics.
- Downloads: SVG (editable in Illustrator or Inkscape) and PNG at 300 dpi (the file carries the 300 dpi setting). The results table downloads as CSV, with a second block listing every biological unit.

## In the report

When the analysis is on, the HTML report gets an Analysis section: the method in words, the reference genes, the control group, the test used, n per group, the test's p with both corrections, the Tukey pairs or Kruskal–Wallis results when those were chosen, and the notes.

## Known limits

- Technical replicates are averaged with equal weight; the spread between them is not carried into the error bars (the usual approach when biological replicates are n).
- Fold change uses the arithmetic mean of control ΔCt, so the control group's own units scatter around 1 rather than sitting at exactly 1.
- No blocked or two-way designs (for example several plates as blocks, or treatment × time), no Wilcoxon signed-rank test for paired data, no Games–Howell for unequal variances with many groups, and no confidence intervals yet.
- Tukey and Dunnett assume equal variances across all groups of a target (the pooled MSE). With very unequal spreads, Welch t-tests with a correction are safer.
- The paired test pairs units only through the pair label. It doesn't check that the label means what you intend.
- Wells with no Ct are dropped rather than given a value such as 40.

## References

- Livak KJ, Schmittgen TD (2001). Analysis of relative gene expression data using real-time quantitative PCR and the 2^−ΔΔCT method. *Methods* 25(4):402–408. doi:10.1006/meth.2001.1262
- Pfaffl MW (2001). A new mathematical model for relative quantification in real-time RT-PCR. *Nucleic Acids Research* 29(9):e45. doi:10.1093/nar/29.9.e45
- Vandesompele J, De Preter K, Pattyn F, Poppe B, Van Roy N, De Paepe A, Speleman F (2002). Accurate normalization of real-time quantitative RT-PCR data by geometric averaging of multiple internal control genes. *Genome Biology* 3(7):research0034. doi:10.1186/gb-2002-3-7-research0034
- Hellemans J, Mortier G, De Paepe A, Speleman F, Vandesompele J (2007). qBase relative quantification framework and software for management and automated analysis of real-time quantitative PCR data. *Genome Biology* 8(2):R19. doi:10.1186/gb-2007-8-2-r19
- Benjamini Y, Hochberg Y (1995). Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society, Series B* 57(1):289–300. doi:10.2307/2346101
- Student (1908). The probable error of a mean. *Biometrika* 6(1):1–25. doi:10.1093/biomet/6.1.1
- Tukey JW (1949). Comparing individual means in the analysis of variance. *Biometrics* 5(2):99–114. doi:10.2307/3001913
- Kramer CY (1956). Extension of multiple range tests to group means with unequal numbers of replications. *Biometrics* 12(3):307–310. doi:10.2307/3001469
- Dunnett CW (1955). A multiple comparison procedure for comparing several treatments with a control. *Journal of the American Statistical Association* 50(272):1096–1121. doi:10.1080/01621459.1955.10501294
- Mann HB, Whitney DR (1947). On a test of whether one of two random variables is stochastically larger than the other. *Annals of Mathematical Statistics* 18(1):50–60. doi:10.1214/aoms/1177730491
- Kruskal WH, Wallis WA (1952). Use of ranks in one-criterion variance analysis. *Journal of the American Statistical Association* 47(260):583–621. doi:10.1080/01621459.1952.10483441
- Dunn OJ (1964). Multiple comparisons using rank sums. *Technometrics* 6(3):241–252. doi:10.1080/00401706.1964.10490181
- Copenhaver MD, Holland BS (1988). Computation of the distribution of the maximum studentized range statistic with application to multiple significance testing of simple effects. *Journal of Statistical Computation and Simulation* 30(1):1–15. doi:10.1080/00949658808811082
- Johnson WE, Li C, Rabinovic A (2007). Adjusting batch effects in microarray expression data using empirical Bayes methods. *Biostatistics* 8(1):118–127. doi:10.1093/biostatistics/kxj037 (published online in 2006, so sometimes cited as 2006)
- Welch BL (1947). The generalization of "Student's" problem when several different population variances are involved. *Biometrika* 34(1–2):28–35. doi:10.1093/biomet/34.1-2.28
