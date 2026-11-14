# Analysis: fold change, statistics and combining plates

The Analysis step works out relative expression from a checked plate: ΔCt against reference genes, ΔΔCt against a control group, fold change, a statistical test of your choice with corrected p values, and graphs. It's off until you switch it on. Everything runs in your browser, like the rest of PlateCheck.

It never picks reference genes for you. It marks targets whose names are often used as references (GAPDH, ACTB, B2M, 18S/RN18S1, HPRT1, TBP, U6/RNU6, RNU44, RNU48 and a few more), but whether a gene is stable in your samples is your call.

Code: `web/analysis.js` (calculations), `web/stats.js` (statistics), `web/combat.js` (ComBat), `web/gsea.js` (gene set enrichment), `web/ui-analysis.js` (screens and graphs). Tests: `tests/analysis.test.mjs`, `tests/stats.test.mjs`, `tests/combat.test.mjs`, `tests/gsea.test.mjs`.

## What goes in

- Only wells with the role Sample, a target, a biological unit (the bio_unit label, or the sample name when there isn't one) and a group label. Controls, standards and empty wells are left out.
- Wells marked Omit in the instrument software are left out by default (you can switch that off), and so are any wells you list under "Other wells to leave out". Only the analysis skips them; they stay in the data, the checks and the report.
- Wells with no Ct (Undetermined and the like) are left out and listed in the notes. If a gene didn't amplify because it isn't expressed, leaving those wells out makes its level look higher than it is, so the note says so.
- Technical replicates are averaged (arithmetic mean of Ct) per biological unit and target. From then on the biological unit is the unit of analysis; technical replicates are never counted as n.
- For the paired t-test and the Wilcoxon signed-rank test only: a pair label per biological unit (the optional `pair` field). Set it on the Plate step (More options, "Pair (for the paired t-test)") or give your file or plate-map template a column called Pair, Pair ID or Pairing. Units in different groups with the same pair label are matched (for example the same mouse before and after, or one donor's cells split into control and treated).

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
| Wilcoxon signed-rank (paired, non-parametric) | each group with the control, unit by unit | signed-rank sum of the differences `d` (same pairing as the paired t-test); W is the smaller of the positive and negative rank sums (Wilcoxon 1945) |
| One-way ANOVA (Welch) + Games–Howell | every pair of groups | Welch's F for all groups (Welch 1951), then for each pair `t = (mᵢ − mⱼ) / sqrt(sᵢ²/nᵢ + sⱼ²/nⱼ)` with Welch–Satterthwaite df and p = P(Q ≥ |t|·√2) for the studentized range with k groups (Games & Howell 1976) |
| One-way ANOVA + Tukey | every pair of groups | `q = |mᵢ − mⱼ| / sqrt(MSE/2 · (1/nᵢ + 1/nⱼ))`, MSE pooled over all k groups, p = P(Q ≥ q) for the studentized range with k groups and N − k df (Tukey 1949; Kramer 1956 for unequal n) |
| One-way ANOVA + Dunnett vs control | each group with the control | `tᵢ = (mᵢ − m₀) / sqrt(MSE (1/nᵢ + 1/n₀))`, p = P(maxⱼ |Tⱼ| ≥ |tᵢ|) under the multivariate t with N − k df (Dunnett 1955) |
| Mann–Whitney (non-parametric) | each group with the control | U of the group from the ranks of both groups together; exact or normal approximation (Mann & Whitney 1947) |
| Kruskal–Wallis + Dunn | all groups, then each group with the control | `H = [12/(N(N+1)) Σ Rᵢ²/nᵢ − 3(N+1)] / (1 − Σ(t³ − t)/(N³ − N))`, chi-square with k − 1 df (Kruskal & Wallis 1952); then Dunn's z for each group against the control (Dunn 1964) |

Details:

- **Welch vs Student.** I keep Welch as the default because it doesn't assume equal variances, and with groups of 3 to 6 you can't check that assumption. When the variances really are equal the two give nearly the same p.
- **Paired t-test.** Units are matched by their pair label. A unit without a label, or whose label has no partner in the other group, is left out and named in the notes. A label used twice in one group can't be paired; those are named too. If no unit in the analysis has a pair label, the app works out no p values and says why, instead of quietly running an unpaired test. The main fold changes and error bars are still the group means; the fold change from the pairs is shown next to them (see below).
- **Wilcoxon signed-rank.** The pairs are formed exactly as for the paired t-test (same Pair labels, same notes about unmatched or duplicated labels). It follows `scipy.stats.wilcoxon` with its defaults:
  - Zero differences (a unit and its partner with exactly the same ΔCt) are dropped before ranking. This is Wilcoxon's own rule and SciPy's default `zero_method="wilcox"`. Pratt's method, which ranks the zeros and then drops their ranks, is not offered.
  - No ties and no zeros, up to 50 pairs: the exact distribution of the rank sum (counted by the usual recursion over 2^n sign patterns).
  - Ties or zeros and 13 pairs or fewer: SciPy switches to a permutation test, and with 2^13 = 8192 sign patterns or fewer it enumerates all of them, so the p is still exact and deterministic. I do the same.
  - Otherwise: the normal approximation with the tie correction `σ² = (n(n+1)(2n+1) − Σ(t³ − t)/2)/24` and no continuity correction (SciPy's default `correction=False`).
  - The smallest two-sided p with n pairs is 2/2^n: 0.25 with 3 pairs, 0.0625 with 5, 0.031 with 6. The app warns when a comparison can't reach 0.05.
- **Games–Howell.** For groups with clearly different spreads, where Tukey's pooled variance is wrong. Each pair gets its own standard error and Welch df, so a noisy group doesn't make the comparisons between quiet groups look less certain. The omnibus test shown alongside is Welch's one-way ANOVA instead of the classic F: with `wᵢ = nᵢ/sᵢ²`, `W = Σwᵢ`, `m* = Σwᵢmᵢ/W` and `Λ = Σ(1 − wᵢ/W)²/(nᵢ − 1)`, `F = [Σwᵢ(mᵢ − m*)²/(k − 1)] / [1 + 2(k − 2)Λ/(k² − 1)]` with `k − 1` and `(k² − 1)/(3Λ)` df. Every group needs at least 2 units with some spread. Like Tukey and Dunnett, its p is already adjusted within a target.
- **Tukey.** All k(k − 1)/2 pairs are tested; the results table shows each group against the control, and a second table lists every pair. The studentized range CDF starts from a port of R's `ptukey` (Copenhaver & Holland 1988): Gauss–Legendre quadrature of Hartley's form for the range of k normals (`wprob`), integrated over the distribution of the variance estimate. R's outer integral loses accuracy at small df (errors up to about 2e-6 near 3 df, which showed up with the fractional df of Games–Howell), so up to 100 df I integrate `wprob` over the density of `s/σ` directly with 32 Gauss–Legendre panels (64 below 2 df), the same quadrature as for Dunnett. Above 100 df R's routine is used as before. This brought the Tukey p from within 5e-7 of SciPy to within 1.3e-11.
- **Dunnett.** The correlation between the comparisons i and j is `ρᵢⱼ = λᵢλⱼ` with `λᵢ = sqrt(nᵢ/(nᵢ + n₀))`, also with unequal n. Because of this product form the multivariate t probability is exactly a two-dimensional integral: given the standard normal Y shared through the control mean and `u = s/σ`, the comparisons are independent, so `P(all |Tᵢ| < c) = ∫ f(u) ∫ φ(y) Πᵢ [Φ((cu − λᵢy)/sqrt(1 − λᵢ²)) − Φ((−cu − λᵢy)/sqrt(1 − λᵢ²))] dy du`, where f is the density of u (`u² = χ²_df/df`). I integrate it with 16-point Gauss–Legendre on 6 panels over y in [0, 8.6] (the integrand is even in y) and 8 panels over u (12 when df < 3) covering all but a negligible part of f. Doubling the panels changes the result by less than 2e-14. This handles unequal n exactly, with no approximation beyond the quadrature. SciPy's `dunnett` computes the same probability by quasi-Monte Carlo (`multivariate_t.cdf`), which is why its p moves in the fourth decimal from one random seed to the next.
- **Mann–Whitney.** As `scipy.stats.mannwhitneyu(method="auto")`: the exact distribution of U when there are no ties and at least one group has 8 or fewer units (counted by the usual recursion), otherwise the normal approximation with the tie correction `σ² = n₁n₀/12 · ((N + 1) − Σ(t³ − t)/(N(N − 1)))` and a continuity correction of 0.5. With 3 units in each group the smallest possible two-sided p is 2/20 = 0.1, so the test can never reach 0.05. The app works out the smallest possible p for each comparison and warns when it is above 0.05.
- **Kruskal–Wallis + Dunn.** Ranks are taken over all groups of a target together (ties get the mean rank). Dunn's `z = (R̄ᵢ − R̄₀) / sqrt((N(N+1)/12 − Σ(t³ − t)/(12(N − 1))) · (1/nᵢ + 1/n₀))`, p from the normal distribution. Only the comparisons with the control are tested (k − 1 of them), and their p values are adjusted within the target by Benjamini–Hochberg or Bonferroni, whichever you chose. The Kruskal–Wallis H for each target is shown in its own table.
- **Paired fold change.** With the paired t-test or Wilcoxon, the results also show the fold change from the pairs: `2^−mean(d)`, where d is each unit's ΔCt minus its partner's, with a 95% CI from the paired t (n − 1 df). This is the effect the paired test actually looks at. It is labelled separately from the group-mean fold change, which uses every unit in the group. The two are the same when every unit has a partner, and differ when some units are left unpaired.
- **ANOVA alongside.** For the t-tests, Tukey and Dunnett, a target with more than two groups also gets the one-way ANOVA F test in a separate table. For the two rank tests it gets Kruskal–Wallis instead.
- **Small groups.** Fewer than 3 biological replicates in a group gives a warning. With one replicate there is no p value at all. Rank tests use only the order of the values, so with 3 to 5 replicates per group they have very little power: a real difference will often come out as not significant. The app says so next to the choice and in the notes.

### Confidence intervals

Every group gets two 95% confidence intervals, in the results table, the CSV and the report:

- **Of the group's fold change**: `mean ΔΔCt ± t(0.975, n − 1)·SD/√n`, transformed back as `2^−(…)`, so low and high swap places and the interval is asymmetric on a linear axis. It treats the control mean as fixed, so it says how precisely the group's own level is known.
- **Of the fold change against the control**: the difference in mean ΔCt from the control, `± t(0.975, df)·sqrt(s₁²/n₁ + s₀²/n₀)` with Welch's df, transformed back the same way. This one includes the uncertainty of the control mean, and is what I'd quote next to a fold change in a paper. It matches `scipy.stats.ttest_ind(equal_var=False).confidence_interval()`.

The error bars can show the first interval instead of SD or SEM ("Error bars: 95% confidence interval of the mean"). The default is still SD. The t quantile comes from bisection on the t CDF, to full double precision.

### Two-way ANOVA

Off by default. "Two-way ANOVA (optional)" in the settings adds a table per target that asks two questions at once:

- **Group × second factor.** For designs where two things were varied, for example treatment and time, or treatment and sex. Give each biological unit a "Second factor" label on the Plate step (More options) or a column called Factor2, Factor 2 or Second factor in the file or plate-map template. The model is group + second factor + their interaction. The group row asks whether the group matters once the second factor is allowed for; the interaction row asks whether the group effect depends on the second factor (a small p there means look at each level separately). Units without the label are left out of this table only, and named in the notes.
- **Group + plate as a block** (studies only). The model is group + plate with no interaction: each plate is assumed to shift every group by the same amount. A unit measured on more than one plate has no single plate, so it is left out of this table (with a note).

The sums of squares are type II, as `statsmodels` `anova_lm(typ=2)`: each main effect is tested after the other main effect, the interaction after both, and every F uses the residual mean square of the full model. Unlike type I, the answer doesn't depend on which factor is listed first, which matters for unbalanced designs. I fit each model by least squares (modified Gram–Schmidt on dummy-coded columns, so the df come from the rank of the design). The interaction is left out, with a note, when a combination of the two factors has no units or when every combination has one unit (nothing would be left to estimate the error). p values are corrected across targets by BH and Bonferroni, separately for each row. The two-way ANOVA is extra information; it doesn't change the main test or the graphs.

### Multiple testing

- Welch, Student, paired, Wilcoxon and Mann–Whitney: each p is for one comparison. Benjamini–Hochberg (1995) and Bonferroni are applied across every group-vs-control comparison of every target in the analysis, as before.
- Tukey, Games–Howell, Dunnett and Dunn: the p already accounts for the several comparisons within a target, so I don't correct within the target a second time. When there are several targets, BH and Bonferroni are applied across targets only, separately for each comparison (for example "drug A vs control" across all genes). With one target the BH and Bonferroni columns equal the test's own p.
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
| Studentized range tail | `studentized_range.sf` | absolute 1e-6 | 1.1e-9 |
| Tukey HSD p | `tukey_hsd` | absolute 1e-6 | 1.3e-11 |
| Dunnett p | `dunnett` (mean over 16 QMC seeds) | absolute 1e-4 | 5.3e-5 |
| Dunnett with one comparison | Student's t (exact equivalent) | absolute 1e-9 | 2.7e-12 |
| Mann–Whitney U and p, exact and normal | `mannwhitneyu(method="auto")` | relative 1e-10 | 4e-15 |
| Kruskal–Wallis H and p | `kruskal` | relative 1e-10 | 6e-15 |
| Dunn z, p, BH, Bonferroni | the formula written with `rankdata` and `norm.sf` | relative 1e-10 | 4e-15 |
| Wilcoxon W and p: exact, all sign flips, normal | `wilcoxon` (defaults) | relative 1e-10 | 0 (exact and sign flips), 3.5e-15 (normal) |
| t quantile | `t.ppf` | relative 1e-10 | 2.5e-14 |
| CI of a mean | `ttest_1samp(...).confidence_interval()` | relative 1e-10 | 2.6e-15 |
| Welch CI of a difference | `ttest_ind(equal_var=False).confidence_interval()` | relative 1e-10 | 1.1e-14 |
| Welch's ANOVA F, df, p | pingouin 0.7.0 `welch_anova` | relative 1e-10 | 5.2e-15 |
| Games–Howell df and p | pingouin 0.7.0 `pairwise_gameshowell` | absolute 1e-8 (p) | 7.6e-12 |
| Two-way ANOVA SS, df, F, p (type II) | statsmodels 0.15.0 `anova_lm(typ=2)` | relative 1e-10 | 1.1e-14 |

Notes on the comparison:

- The Tukey error used to be about 5e-7, the accuracy of R's outer integral at small df. With the direct integral up to 100 df it is now about 1e-11.
- SciPy has no Welch ANOVA or Games–Howell test, so those are checked against pingouin, which implements both. The script falls back to the formulas written out with SciPy if pingouin doesn't install. The two-way ANOVA is checked against statsmodels on balanced and unbalanced designs with interaction, and on balanced and unbalanced blocks without it.
- The Wilcoxon cases cover all three of SciPy's branches: exact, all sign flips (ties or zeros with 13 pairs or fewer) and the normal approximation (ties with more than 13 pairs, or more than 50 pairs).
- SciPy's Dunnett p comes from a quasi-Monte Carlo estimate. On these cases its standard deviation between random seeds is up to 1.7e-4, so a single SciPy run is not a precise reference. The fixture stores the mean of 16 seeds and their spread. My values differ from that mean by at most 5.3e-5, which is within the seed-to-seed noise. As an exact check, Dunnett's test with a single treated group must equal Student's t-test with the same pooled variance, and it does to 3e-12.
- SciPy has no Dunn test, so the Dunn reference is the formula above written out in Python with SciPy's ranking and normal distribution. It checks the arithmetic (ranks, ties, standard error, adjustment), not the choice of formula; that comes from Dunn (1964).
- The tests print the worst disagreement per function (`node --test tests/stats.test.mjs`).

To regenerate (in a throwaway virtual environment outside the repository):

```bash
python -m venv /tmp/platecheck-statsref
/tmp/platecheck-statsref/bin/python -m pip install scipy numpy statsmodels pandas pingouin
/tmp/platecheck-statsref/bin/python testdata/make-stats-reference.py
```

The file in the repository was made with SciPy 1.18.1, NumPy 2.5.4, statsmodels 0.15.0 and pingouin 0.7.0 (Python 3.14). The new cases use their own random seed, so every earlier case in the file is byte for byte the same as before.

## Reference gene check

For each chosen reference I compare its mean Ct between groups (units averaged first). It is flagged when

- the group means differ by more than 0.5 cycles (you can change this), or
- the difference is significant (Welch t-test for two groups, ANOVA for more, p < 0.05).

Why 0.5 cycles: a reference that moves by d cycles changes every fold change by about 2^d, so 0.5 cycles is already a 1.4-fold bias, which is about the size of effect many papers report. I added the p value because with good replicates a smaller shift can still be real; with 2 or 3 units per group the test has little power, which is why the cycle threshold is there as well. The check can't prove a reference is stable. geNorm (Vandesompele et al. 2002) with three or more candidate references is the better tool for choosing them in the first place.

## Several plates (a study)

"Combine plates" in the sidebar groups saved runs into a study. Studies are saved in your browser like runs. Biological units with the same name on different plates are treated as the same biological sample. After the plate correction their values are averaged across those plates, so each unit counts once in n and in every test, never once per plate. The app says so whenever it happens.

"Download study report (HTML)" at the bottom of the study view gives one file with the method in words, the plates, the correction used with its shifts and warnings, the results table, the graphs as inline SVG, the notes and the references for the methods that were used. It uses the same styles as the run report.

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

Units with no group (a calibrator, for example) aren't in the model and aren't corrected. A unit with no reference value on a plate isn't corrected on that plate either. Both cases get a note. A unit measured on two plates counts as two samples inside ComBat, because each plate's value is what the plate effect is estimated from. Before the statistics the corrected values are averaged per unit, so it counts once there.

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

## Gene set enrichment

Once the analysis has results, a "Gene set enrichment" card asks whether the genes of a pathway moved together. It is off until you choose where the gene sets come from. Code: `web/gsea.js`; tests: `tests/gsea.test.mjs`.

### The panel is the universe

A qPCR panel is a gene list somebody already picked, usually around the pathways the experiment is about. So every test here compares a set's genes with the other genes on the panel, never with the genome. "Enriched" means "moved more than the rest of this panel". On an inflammation array, an inflammation set that moved is a smaller surprise than the same result from RNA-seq would be, and a set that sits in the middle may still have moved compared with the genome. The card, the CSV and the report all say this.

### Ranking the genes

Every target that isn't a reference gets one number from the Analysis step, for one comparison (a group against the control; with more than two groups you pick which). Positive means higher in the group.

- **Signed −log10 p (default):** `sign(log2 fold change) × −log10 p`, with p from whatever test the analysis uses. I chose it as the default because every test in the analysis gives a p (the rank tests, Tukey and Dunnett too), and the p already allows for each gene's own n and df. With three replicates per group a t statistic can be very large just because the replicates happened to agree, and that one gene would then dominate the weighted running sum.
- **t statistic:** offered when the test has one (Welch, Student, paired, Dunnett). Its sign is turned round, because the tests run on ΔCt and a higher ΔCt is lower expression.

Genes without a p (or t) are left out of the ranking and named. Ties are broken by gene name so the order is reproducible.

### The two methods

**Rank test (competitive, Wilcoxon rank-sum).** For each set, the ranking statistics of its genes are compared with those of every other ranked gene on the panel by the Mann–Whitney U test, two-sided, exactly as `scipy.stats.mannwhitneyu(method="auto")` (the same code as the Mann–Whitney choice in the analysis). This is the idea behind limma's `geneSetTest` and `wilcoxGST` (Ritchie et al. 2015). The effect is shown as AUC = U / (n_set × n_rest), the chance that a set gene ranks above a gene outside the set: 0.5 is no shift, above 0.5 is up in the group. q is Benjamini–Hochberg across the sets tested.

**Preranked GSEA (Subramanian et al. 2005).** Walking down the ranked list, a set gene adds `|r|^p / N_R` (N_R = the sum of `|r|^p` over the set's genes) and any other gene subtracts `1 / (N − N_H)`. I use p = 1, the weighting of the 2005 paper. ES is the largest deviation of this running sum from zero (the maximum if its absolute value is larger than the minimum's, otherwise the minimum, as gseapy does). Significance comes from gene-set permutation, the only kind possible from a ranked list: for each set, 1000 random sets of the same size are drawn from the panel (adjustable, 100 to 10 000) with a seeded generator (mulberry32), so the same seed always gives the same p.

- p: for ES ≥ 0, the share of the non-negative permutation ES that are ≥ ES; for ES < 0, the share of the negative permutation ES that are < ES. A p of 0 is shown as "< 1/permutations".
- NES: ES divided by the mean of the permutation ES of the same sign (for a negative ES, by the absolute value of the mean of the negative ones). The permutation ES are normalised the same way.
- FDR q as in GSEA (and gseapy): for NES\* ≥ 0, q = [share of all permutation NES (all sets pooled) that are ≥ NES\* among those ≥ 0] / [share of the observed NES that are ≥ NES\* among those ≥ 0], and the mirror image for negative NES, capped at 1. The GSEA authors suggest q < 0.25 for exploratory work; rows below it are marked. With fewer than 10 sets this q is rough, and the card says so; the BH-adjusted p is in the CSV as well.

For the permutations I compute ES from the hit positions alone: the running sum peaks just after a hit and dips just before one or at the end, so ES needs O(k log k) work per random set instead of O(N). The tests check this against the full running sum.

**Leading edge.** For both methods: the set's genes from the top of the list down to the peak of the running sum (for a negative ES, from the trough to the bottom). These are the genes that carry the signal, and the ones to look at in the results table.

### The guards, and why

- **At least 15 ranked genes, or it refuses.** Below that a set of 3 is a fifth of the panel, the rank test has almost no resolution, and the permutations keep drawing the same few sets. Whatever came out would be a handful of genes you can read off the results table directly, so the card says that instead of showing a table.
- **Set size.** A set needs at least 3 genes on the panel (adjustable) and at most half the ranked genes (adjustable, up to the panel size minus 1), so the rest of the panel a set is compared with is at least as big as the set. A set that covers almost the whole panel is tested against the two or three genes left over, which says nothing about the set. Sets dropped either way are counted and named.
- **Method by panel size.** "Automatic" (the default) uses the rank test below 50 ranked genes and GSEA from 50 on. On a small panel, permutation GSEA draws random sets from the same few genes again and again, so its NES and p move with the seed. You can choose either method yourself; choosing GSEA on a small panel adds a note, and when a set has fewer distinct random sets than permutations (C(N, k) below the number of permutations) the card says the p can't get finer.
- **Identical sets are tested once.** GO terms in particular often hold exactly the same panel genes (a term and its parent). Such sets are merged into one row, named after the first, with the others listed, so they don't count several times in the BH or FDR correction.
- **Correlation.** Both tests are competitive and treat genes as independent. Genes of one pathway are usually correlated, which makes competitive tests too optimistic (Wu & Smyth 2012 showed how much). On a panel built around a few pathways this is likely to matter. I don't estimate the correlation (CAMERA does, but needs the per-sample data and enough samples to estimate it); the card says to read small p values as leads, not proof.

### Where the gene sets come from

No gene sets are built in, and no new network host is used. MSigDB's licence asks users to register, so I don't ship it.

1. **A GMT file you upload**: an MSigDB download, an Enrichr library or your own. One set per line: name, description, genes, separated by tabs. Blank lines, `#` comments, a byte-order mark, Windows line ends, empty descriptions and Enrichr's old `GENE,1.0` weights are handled; lines that aren't sets are counted and skipped; a repeated set name gets "(2)". Genes are matched to the panel by gene symbol (from the Targets panel, or guessed from the target name) or by the target name, without regard to case, so ACTB, Actb and actb all match. The exception is the fly, where FlyBase symbols differ by case alone (dl is dorsal, Dl was Delta), so fly genes must match exactly. Only the sets with at least 2 genes on the panel are kept with the run (up to 5000), each with its full size, so the table shows "12 of 19". The card reports how many sets were read, how many were kept and how many gene names aren't on the panel, and the results say how many ranked genes are in no set.
2. **GO biological-process terms** from the existing gene lookup. Tick "Use GO terms for gene sets" and press "Look up genes"; the same symbols go to the same host and the answer also carries each gene's GO terms (details in [genes.md](genes.md)). Panel genes that share a term make a set. GO terms are inferred, many electronically, and say what a gene can take part in, not what it did in your cells.
3. **Sets you type in**: a name and the genes, pasted with spaces, commas or new lines between them.

### Output

The table lists each set with its size on the panel (and in the original set), direction, ES and NES (GSEA) or AUC (rank test), p, q and the leading edge. The enrichment plot shows the running sum for a chosen set, a tick per set gene (leading-edge genes in vermillion) and the ranking statistic of every gene below, with SVG and 300-dpi PNG downloads like the other graphs. The CSV has both methods' p values, the BH-adjusted p, the leading edge, the genes of each set, the settings and the full ranked list. The settings are saved with the run (`analysis.gsea`), and the run report gets a "Gene set enrichment" section with the method, the table, the notes and the references.

### Checked against gseapy and SciPy

`testdata/make-gsea-reference.py` writes `tests/fixtures/gsea-reference.json` from gseapy 1.3.2 (`prerank`, weight 1) and SciPy 1.18.1 (`mannwhitneyu`) on four seeded cases: 60 genes with an up set, a down set, a random set and a set of 3; 96 genes with seven overlapping sets of 4 to 30; 30 genes with many ties (rank test only, since the GSEA order of tied genes is arbitrary); and 384 genes, the largest arrays.

| Quantity | Compared with | Required | Worst on the current file |
| --- | --- | --- | --- |
| ES | gseapy `prerank` | absolute 1e-12 | 1.4e-15 |
| Leading-edge genes | gseapy `Lead_genes` | identical | identical |
| NES | gseapy, 5000 permutations | 4 standard errors (or 2%) | 0.012 |
| Nominal p | gseapy, 5000 permutations | 4 binomial standard errors + 2/5000 | 0.015 |
| FDR q | gseapy, 5000 permutations | 4 standard errors (or 0.03) | 0.016 |
| Rank test U and p | `mannwhitneyu(method="auto")` | U exact, p relative 1e-10 | 8.4e-15 |

NES, p and q come from random permutations on both sides, and gseapy's random generator isn't mine, so they can't agree exactly. The script runs gseapy with three seeds and the test runs mine with three seeds, both with 5000 permutations, and compares the means. The allowed difference is four standard errors of the difference: the binomial standard error for p (about half the permutations have the same sign as ES), the spread between seeds for NES and q.

To regenerate (in a throwaway virtual environment outside the repository):

```bash
python -m venv /tmp/platecheck-statsref
/tmp/platecheck-statsref/bin/python -m pip install gseapy scipy numpy pandas
/tmp/platecheck-statsref/bin/python testdata/make-gsea-reference.py
```

### Limits

- Both methods test the ranking of one comparison. They don't use the per-sample values, so sample-label permutation (the original GSEA) and CAMERA's correlation adjustment aren't available.
- Correlation between genes inflates both tests (see above).
- The result depends on the panel's composition: the same set can look enriched on one panel and not on another.
- GO sets depend on what MyGene.info returns for your species; for some species (pig, for example) there are few GO terms.

## In the report

When the analysis is on, the HTML report gets an Analysis section: the method in words, the reference genes, the control group, the test used, n per group, the 95% confidence intervals, the test's p with both corrections, the Tukey or Games–Howell pairs, the paired fold change, the two-way ANOVA or Kruskal–Wallis results when those were chosen, the gene set enrichment when gene sets were chosen, and the notes. A study has its own HTML report (see "Several plates").

## Known limits

- Technical replicates are averaged with equal weight; the spread between them is not carried into the error bars (the usual approach when biological replicates are n).
- Fold change uses the arithmetic mean of control ΔCt, so the control group's own units scatter around 1 rather than sitting at exactly 1.
- The two-way ANOVA handles two factors only, with group as one of them. No repeated-measures or mixed models (for example the same animal at several time points), no follow-up comparisons within the two-way design, and the plate-as-block model assumes no group × plate interaction.
- Wilcoxon drops zero differences (SciPy's default). With ΔCt values rounded to two decimals, exact zeros can happen; each one removes a pair.
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
- Welch BL (1951). On the comparison of several mean values: an alternative approach. *Biometrika* 38(3–4):330–336. doi:10.1093/biomet/38.3-4.330
- Wilcoxon F (1945). Individual comparisons by ranking methods. *Biometrics Bulletin* 1(6):80–83. doi:10.2307/3001968
- Games PA, Howell JF (1976). Pairwise multiple comparison procedures with unequal N's and/or variances: a Monte Carlo study. *Journal of Educational Statistics* 1(2):113–125. doi:10.3102/10769986001002113
- Subramanian A, Tamayo P, Mootha VK, Mukherjee S, Ebert BL, Gillette MA, Paulovich A, Pomeroy SL, Golub TR, Lander ES, Mesirov JP (2005). Gene set enrichment analysis: a knowledge-based approach for interpreting genome-wide expression profiles. *PNAS* 102(43):15545–15550. doi:10.1073/pnas.0506580102
- Ritchie ME, Phipson B, Wu D, Hu Y, Law CW, Shi W, Smyth GK (2015). limma powers differential expression analyses for RNA-sequencing and microarray studies. *Nucleic Acids Research* 43(7):e47. doi:10.1093/nar/gkv007
- Wu D, Smyth GK (2012). Camera: a competitive gene set test accounting for inter-gene correlation. *Nucleic Acids Research* 40(17):e133. doi:10.1093/nar/gks461
