# Analysis: fold change, statistics and combining plates

The Analysis step works out relative expression from a checked plate: ΔCt against reference genes, ΔΔCt against a control group, fold change, t-tests with corrected p values, and graphs. It's off until you switch it on. Everything runs in your browser, like the rest of PlateCheck.

It never picks reference genes for you. It marks targets whose names are often used as references (GAPDH, ACTB, B2M, 18S/RN18S1, HPRT1, TBP, U6/RNU6, RNU44, RNU48 and a few more), but whether a gene is stable in your samples is your call.

Code: `web/analysis.js` (calculations), `web/stats.js` (statistics), `web/ui-analysis.js` (screens and graphs). Tests: `tests/analysis.test.mjs`, `tests/stats.test.mjs`.

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

Before the plates are merged, each target's Ct values are lined up between plates in one of three ways:

1. **Calibrator sample on every plate** (recommended). This is the inter-run calibration of qBase (Hellemans et al. 2007): the same sample (for example pooled cDNA) is run on every plate. For each target and plate the calibration factor is the mean Ct of the calibrators on that plate (the log of the geometric mean of their quantities), and every Ct of that target on that plate is shifted by that factor minus the mean factor over plates. qBase divides the normalised relative quantities, gene by gene, by a calibration factor equal to the geometric mean of the calibrators' NRQs; on the log scale that is the same subtraction, so the fold changes come out identical. Only calibrators measured on every plate that has the target are used. When there is none for a target, that target is left uncalibrated with a note. Plates that share no calibrator with the largest connected set of plates are listed as "not connected by a calibrator".
2. **Centre each plate** (no calibrator). Each target's Ct values on a plate are shifted so the plate's mean equals the mean over plates. This is only fair when every plate holds a similar mix of groups; if one plate holds mostly treated samples, centring removes the real difference. The app warns about this every time.
3. **No correction.** Only if every plate was run and analysed under the same conditions. Also warned about.

Calibrator samples don't need a group label; units without a group take part in calibration but not in the comparisons.

ComBat-style batch correction for large panels is planned for later; it needs more plates and genes than a typical qPCR study has.

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
- Welch BL (1947). The generalization of "Student's" problem when several different population variances are involved. *Biometrika* 34(1–2):28–35. doi:10.1093/biomet/34.1-2.28
