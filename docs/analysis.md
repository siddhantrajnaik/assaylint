# Analysis: fold change, statistics and combining plates

The Analysis step works out relative expression from a checked plate: ΔCt against reference genes, ΔΔCt against a control group, fold change, t-tests with corrected p values, and graphs. It's off until you switch it on. Everything runs in your browser, like the rest of PlateCheck.

It never picks reference genes for you. It marks targets whose names are often used as references (GAPDH, ACTB, B2M, 18S/RN18S1, HPRT1, TBP, U6/RNU6, RNU44, RNU48 and a few more), but whether a gene is stable in your samples is your call.

Code: `web/analysis.js` (calculations), `web/stats.js` (statistics), `web/combat.js` (ComBat), `web/ui-analysis.js` (screens and graphs). Tests: `tests/analysis.test.mjs`, `tests/stats.test.mjs`, `tests/combat.test.mjs`.

## What goes in

- Only wells with the role Sample, a target, a biological unit (the bio_unit label, or the sample name when there isn't one) and a group label. Controls, standards and empty wells are left out.
- Wells marked Omit in the instrument software are left out by default (you can switch that off), and so are any wells you list under "Other wells to leave out". Only the analysis skips them; they stay in the data, the checks and the report.
- Wells with no Ct (Undetermined and the like) are left out and listed in the notes. If a gene didn't amplify because it isn't expressed, leaving those wells out makes its level look higher than it is, so the note says so.
- Technical replicates are averaged (arithmetic mean of Ct) per biological unit and target. From then on the biological unit is the unit of analysis; technical replicates are never counted as n.

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

- Tests run on ΔCt (log scale), with biological units as n. ΔΔCt differs from ΔCt by a constant, so the tests are the same either way.
- Each group against the control: Welch's t-test (Welch 1947), two-sided. I use Welch rather than Student's t because it doesn't assume equal variances, and with groups of 3 to 6 you can't check that assumption.
- More than two groups: one-way ANOVA across all groups per target, reported alongside. The group-vs-control comparisons are still Welch t-tests with a multiple-testing correction, not Dunnett's test.
- Multiple testing: Benjamini–Hochberg (1995) false discovery rate and Bonferroni, both computed across every group-vs-control comparison of every target in the analysis, and both shown in the table and the CSV. You choose which one goes on the graphs. ANOVA p values are corrected across targets in the same way.
- Fewer than 3 biological replicates in a group: a warning. With one replicate there is no p value at all.
- p values come from the Student t and F distributions through the regularised incomplete beta function (continued fraction, modified Lentz method; log-gamma by the Lanczos approximation).

### Checked against SciPy

`testdata/make-stats-reference.py` runs SciPy (`ttest_ind(equal_var=False)`, `f_oneway`, `false_discovery_control`, `t.sf`, `t.cdf`, `f.sf`) and NumPy on fixed cases: n = 2, n = 1, tied values, very unequal variances, identical groups (p = 1), huge t (p around 1e-13), fractional degrees of freedom. The results are in `tests/fixtures/stats-reference.json`, and `tests/stats.test.mjs` requires agreement to a relative error of 1e-10. The worst disagreement on the current file is about 1e-11.

To regenerate (in a throwaway virtual environment outside the repository):

```bash
python -m venv /tmp/platecheck-statsref
/tmp/platecheck-statsref/bin/python -m pip install scipy numpy
/tmp/platecheck-statsref/bin/python testdata/make-stats-reference.py
```

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

- Fold change: one panel per target, groups along the x axis. Large blue dots are biological replicates (the mean of their technical replicates); small orange dots are the individual technical replicates; the black line and whiskers are mean ± SD (or SEM). Above each group: stars and the adjusted p against the control (*** < 0.001, ** < 0.01, * < 0.05, ns otherwise). The fold-change axis is log scale by default (fold changes are ratios, so 0.5 and 2 are the same distance from 1); a linear axis is available.
- Volcano plot, when there are 6 or more target genes: log2 fold change against −log10 of the unadjusted p, with points that stay significant after correction coloured and labelled.
- Colours are from a colour-blind safe palette (blue #0072B2, orange #E69F00, vermillion #D55E00). Text is Arial/Helvetica, which journals usually ask for. Gene names are in italics.
- Downloads: SVG (editable in Illustrator or Inkscape) and PNG at 300 dpi (the file carries the 300 dpi setting). The results table downloads as CSV, with a second block listing every biological unit.

## In the report

When the analysis is on, the HTML report gets an Analysis section: the method in words, the reference genes, the control group, n per group, the test, both corrections and the notes.

## Known limits

- Technical replicates are averaged with equal weight; the spread between them is not carried into the error bars (the usual approach when biological replicates are n).
- Fold change uses the arithmetic mean of control ΔCt, so the control group's own units scatter around 1 rather than sitting at exactly 1.
- No Dunnett's or Tukey's post-hoc tests, no non-parametric tests, no paired or blocked designs, no confidence intervals yet.
- Wells with no Ct are dropped rather than given a value such as 40.

## References

- Livak KJ, Schmittgen TD (2001). Analysis of relative gene expression data using real-time quantitative PCR and the 2^−ΔΔCT method. *Methods* 25(4):402–408. doi:10.1006/meth.2001.1262
- Pfaffl MW (2001). A new mathematical model for relative quantification in real-time RT-PCR. *Nucleic Acids Research* 29(9):e45. doi:10.1093/nar/29.9.e45
- Vandesompele J, De Preter K, Pattyn F, Poppe B, Van Roy N, De Paepe A, Speleman F (2002). Accurate normalization of real-time quantitative RT-PCR data by geometric averaging of multiple internal control genes. *Genome Biology* 3(7):research0034. doi:10.1186/gb-2002-3-7-research0034
- Hellemans J, Mortier G, De Paepe A, Speleman F, Vandesompele J (2007). qBase relative quantification framework and software for management and automated analysis of real-time quantitative PCR data. *Genome Biology* 8(2):R19. doi:10.1186/gb-2007-8-2-r19
- Benjamini Y, Hochberg Y (1995). Controlling the false discovery rate: a practical and powerful approach to multiple testing. *Journal of the Royal Statistical Society, Series B* 57(1):289–300. doi:10.2307/2346101
- Johnson WE, Li C, Rabinovic A (2007). Adjusting batch effects in microarray expression data using empirical Bayes methods. *Biostatistics* 8(1):118–127. doi:10.1093/biostatistics/kxj037 (published online in 2006, so sometimes cited as 2006)
- Welch BL (1947). The generalization of "Student's" problem when several different population variances are involved. *Biometrika* 34(1–2):28–35. doi:10.1093/biomet/34.1-2.28
