# Where PlateCheck's thresholds come from

Every number PlateCheck uses to raise a flag is listed here with its default, what the literature says, my reasoning, and what to change when your data is unusual. The same notes appear in the app under **More → Method details and thresholds** ("Why this number") and in the References section of the report. They live in `web/core.js` (`RULESET_FIELDS`, `REFERENCES`).

I read each paper cited here and checked that it says what I say it says. Where I found no published number, I say so: some thresholds are my own rules of thumb, and they are marked as such. None of this has been reviewed by a qPCR expert for this tool yet.

## Summary

| Setting | Default | What the literature says | Status |
|---|---|---|---|
| Technical replicate SD | 0.3 cycles | Replicates > 0.5 cycles apart are commonly discarded (rule attributed to Nolan et al. 2006); that range is what 15% pipetting error gives at high copy number. Up to 2 cycles is acceptable for Ct up to 35 [3, 4] | Rule of thumb, consistent with the literature for Ct below about 32 |
| NTC rated high below Ct | 35 | 10 copies ≈ Ct 35 at 90% efficiency (LLOQ), 3 copies ≈ Ct 37 (LOD) [2, 3]. NTC signal near Ct 40 can be ignored when the lowest unknown is below Ct 35 [1] | Supported |
| Ct-dependent SD threshold | off; when on, 1.5 × the Poisson SD | Below about 100 copies Poisson sampling dominates the spread [2, 3]; a Poisson-based range replaces the 0.5-cycle rule for low input [4] | Model from the literature; the factor 1.5 is my rule of thumb |
| Late Ct note | mean Ct above 35 | Cq > 40 is suspect [1]; below 10 copies (Ct ≈ 35) results are not quantitative, below 3 copies not even qualitative [2, 3] | Supported |
| No-RT margin | 5 cycles | A sample counts as positive only if its Cq is at least 5 cycles before an amplifying negative control [2] | Supported |
| Efficiency range | 90–110% | Slope −3.6 to −3.1 [7]; a good assay reaches ≥ 90% [6] | Supported (published acceptance criterion) |
| Standard curve R² | ≥ 0.98 | R² ≥ 0.98 for each curve [7]; MIQE asks for R² to be reported, no number [1] | Supported (published acceptance criterion) |
| Minimum dilution levels | 3 | ≥ 3 orders of magnitude, ideally 5–6 [1]; 4–5 orders with ≥ 3 replicates per point [2]; 3–4 replicates per point [6] | Minimum to fit a line |
| Standard curve range | note below 3 log10 units | ≥ 3 orders of magnitude [1]; 4–5 orders [2] | Supported (MIQE 2009 minimum) |
| Melt Tm tolerance | ±1 °C | Products less than 2 °C apart can be told apart by melt curve [9] | Reasoned from [9] |
| Secondary melt peak | ≥ 0.3 × main peak | No published ratio. One product can give two peaks [2] | My heuristic |
| Curve vs reported Ct | 2 cycles | No published value. Cq depends on baseline and threshold [3, 8] | My heuristic |

Numbers in brackets refer to the reference list at the end.

## Technical replicate SD (default 0.3 cycles)

**What PlateCheck does.** For each biological unit and target, it takes the sample SD of the Ct values of the technical replicate wells and flags the group when the SD is above the threshold. Nothing is removed.

**Literature.**
- A widely used rule discards technical replicates whose Cq values differ by more than 0.5 cycles. de Ronde et al. (2017) and Ruiz-Villalba et al. (2021) both attribute it to Nolan et al. 2006 (Nat Protoc, doi:10.1038/nprot.2006.236; I could not get the full text of that paper, so I cite the two papers that discuss the rule). Both show that a 0.5-cycle range is what a 15% pipetting error produces when template is plentiful.
- Below about 100 copies per reaction, Poisson sampling of the template adds more spread than pipetting does [3]. Ruiz-Villalba et al. state that for Cq values up to 35, a difference of up to two cycles between technical replicates should be considered acceptable, depending on efficiency [3]. de Ronde et al. replace the fixed 0.5-cycle rule with a Poisson-based acceptable range for low-input samples such as circulating miRNA [4].
- MIQE 2.0: "At low target copy numbers, technical variability is primarily influenced by the unavoidable Poisson sampling distribution", and the remedy is more technical replicates, more concentrated samples or larger volumes [2]. MIQE (2009) says precision decreases with copy number and that CVs should not be calculated on Cq values [1].

**How 0.3 relates to the 0.5-cycle rule.** For three replicates whose range is 0.5 cycles, the SD is between 0.25 (one value in the middle) and 0.29 (two values at one end); for duplicates 0.5 apart it is 0.35. So 0.3 is the 0.5-cycle rule restated as an SD.

**What Poisson sampling alone predicts.** If a well receives on average N copies, the SD of its Ct from sampling alone is about 1 / (√N · ln E) cycles (E = 2 at 100% efficiency). Taking the rule of thumb that 10 copies give Ct 35 [2, 3]:

| Copies per well | Approx. Ct (E = 2) | Expected SD from sampling alone |
|---|---|---|
| 1000 | 30 | 0.05 |
| 100 | 31.7 | 0.14 |
| 50 | 32.7 | 0.20 |
| 25 | 33.7 | 0.29 |
| 10 | 35 | 0.46 (exact Poisson: 0.50) |
| 5 | 36 | 0.65 (exact: 0.73) |

(Approximation from the delta method; the exact values are from summing the Poisson distribution for N ≥ 1. With 90% efficiency the values are about 8% larger.) Pipetting and instrument noise come on top. The "Technical SD against mean Ct" graph on the Review tab draws this curve.

**Reasoning.** 0.3 is right for most mRNA targets coming up before about Ct 32, where pipetting dominates. Above about Ct 33 it will flag groups that are behaving exactly as expected for a low-copy target.

**Exceptional data.**
- Very low expression, rare transcripts, pathogen loads near the LOD: raise the threshold to 0.5 or more, or better, use more replicates (4–6). Look at the SD-against-Ct graph: if flagged groups sit on or below the Poisson curve, they are sampling noise, not technique.
- Single-cell qPCR: most targets are in the low-copy range, so a fixed SD threshold says little. Ståhlberg and Kubista (2018, Mol Aspects Med 59:28–35, doi:10.1016/j.mam.2017.07.004) review the single-cell workflow, where few molecules are handled per reaction. Judge spread against the Poisson curve rather than a fixed number.
- miRNA, especially circulating miRNA: de Ronde et al. [4] use duplicate wells and a Poisson-based acceptable range instead of 0.5 cycles. Use 0.5 or higher here.
- High-throughput panels (for example 384-well or microfluidic): replicates are often single wells. Spread cannot be assessed per sample; check it on a few replicated samples or reference RNA instead.

## Ct-dependent SD threshold (off by default; factor 1.5)

**What PlateCheck does.** With "Let the SD threshold rise for late Ct" switched on, each replicate group gets its own limit: the larger of the fixed SD threshold and k × the Poisson SD expected at the group's mean Ct (the curve in the table above, k = 1.5 by default). Past about Ct 36.7 (under 3 copies) the limit stays at its 3-copy value, since Ct is no longer quantitative there. It is off by default, so results do not change until you switch it on. The replicate table and the SD-against-Ct graph show the limit used for each group.

With k = 1.5 the limit stays at 0.3 up to about Ct 32.6, then rises: 0.48 at Ct 34, 0.68 at Ct 35, 0.97 at Ct 36 and 1.25 from about Ct 36.7 on.

**Literature.** The model is the Poisson sampling argument above [2, 3]; de Ronde et al. [4] use a Poisson-based acceptable range in place of the 0.5-cycle rule for low-input samples. The factor k is mine: 1.5 leaves room for pipetting on top of sampling noise. For comparison, the 2-cycle range Ruiz-Villalba et al. accept up to Ct 35 [3] is an SD of about 1.0–1.15 for triplicates, so 1.5 × Poisson is the stricter of the two.

**Exceptional data.** Turn it on for miRNA, single-cell and other low-copy work. Leave it off if your targets come up before about Ct 32, where it changes nothing. Raise k to 2–3 if groups sitting just above the curve are still flagged.

## Late Ct note (default: mean Ct above 35)

**What PlateCheck does.** Sample replicate groups whose mean Ct is above this setting get a low-severity note, one per target listing the groups: read them as detected or not detected, or add replicates. Nothing is removed, and the Ct is still used everywhere else. Set 0 to switch the note off.

**Literature.**
- MIQE (2009): Cq values above 40 are suspect because of the implied low efficiency, but arbitrary cut-offs can be too low (losing valid results) or too high (adding false positives) [1].
- MIQE 2.0: the LOD cannot be below 3 copies; variability increases below 10 copies per reaction, the LLOQ of a good assay; at 90% efficiency the LLOQ is reached at 35 cycles and the LOD at 37; at 70% efficiency at 42 and 45 [2]. MIQE 2.0 also says a positive reaction in a validated qualitative assay should be reported whatever its Cq.
- Ruiz-Villalba et al.: "for inputs below 10 copies the PCR cannot be used for quantitative analysis", and below three copies "even the qualitative (yes/no) conclusion becomes unreliable" [3]. They define the LOQ in practice as the point where technical variation exceeds biological variation, which is what the Review-tab graph compares.
- Forootan et al. describe how to measure LOD and LOQ with replicate dilution series; under sampling noise alone the 95% LOD is 3 molecules [5].

**Reasoning.** 35 is where a good assay reaches its LLOQ (about 10 copies) [2, 3]. Users who have measured their own LOQ (as in [5]) should enter that Ct instead. For assays with low efficiency the number should rise (MIQE 2.0: 42 at 70%).

**Exceptional data.** For miRNA and single-cell work, many real results lie past Ct 35; set the cut-off from your own dilution series, not from 35.

## NTC amplification (default: rated high below Ct 35)

**What PlateCheck does.** Any amplification in an NTC is flagged. Before the threshold it is high severity, after it medium.

**Literature.** MIQE (2009) says NTCs should be on each plate or batch with rejection rules set in advance, and gives as an example that NTCs with Cq values around 40 could be ignored if the lowest-concentration unknown has a Cq below 35 [1]. MIQE 2.0: if a negative control amplifies, a sample should be counted positive only if its Cq precedes the control's by at least 5 cycles [2]. In dye assays, NTC artefacts can usually be told apart from the product by melt curve [2].

**Reasoning.** An NTC before Ct 35 carries roughly 10 or more copies (Ct ≈ 35 at 10 copies [2, 3]), which is enough to change a quantity. After 35 it is near the LOD and more often primer-dimer or a stray copy.

**Exceptional data.** If your samples themselves come up after Ct 30 (miRNA, rare transcripts), the useful question is the gap between the NTC and your latest sample, not the NTC's absolute Ct. Use the 5-cycle rule: an NTC at Ct 36 is a problem for samples at Ct 33.

**Proposal (not built).** Rate the NTC by its distance from the latest sample Ct for the same target (high if under 5 cycles), in addition to the fixed Ct.

## No-RT controls and the no-RT margin (default 5 cycles; "Expect a no-RT control" is off by default)

**What PlateCheck does.** Amplification in a no-RT well is flagged (medium) as before, and the evidence gives how many cycles after the earliest sample well it came up. On top of that, when the no-RT comes up fewer than 5 cycles after the mean Ct of the samples it controls, a second medium flag says so, with the share of the sample signal genomic DNA could explain. PlateCheck matches a no-RT well to its sample by name ("c1 -RT", "c1 RT-", "c1_noRT", "NRT c1" all go to "c1", as does a biological unit set in the plate map); if no name matches, it uses all sample wells of that target. Set the margin to 0 to switch the second flag off.

**Literature.** MIQE (2009) and the MIQE 2.0 checklist: a no-RT control is essential when RNA is first extracted; once the sample is shown to be DNA-free it is desirable but no longer essential [1, 2]. The MIQE 2.0 text says RT-qPCR assays should include one, and describes correcting for genomic DNA signal with a gDNA assay [2]. The 5-cycle rule for negative controls [2] applies here too: 5 cycles is 2⁵ = 32-fold, so genomic DNA contributes about 3% of the signal; 3.3 cycles would be 10%.

**Why medium, not high.** I first proposed rating a no-RT high when it is within 5 cycles. I kept it at medium, the same as the existing no-RT flag, because how much a few percent of genomic DNA matters depends on the fold change being measured, and PlateCheck cannot know that.

**Exceptional data.** Tighten the margin (7–10 cycles) for small fold changes. Turn "Expect a no-RT control" on for new RNA preps, single-exon or intronless genes, and primers that do not span an exon junction. I have no source on no-RT practice specific to miRNA assays; follow your kit's instructions there.

## PCR efficiency (default 90–110%)

**What PlateCheck does.** For each target with standards, it fits Ct against log10 quantity and computes efficiency as 10^(−1/slope) − 1.

**Literature.**
- The European Network of GMO Laboratories accepts slopes from −3.6 to −3.1, "corresponding to an amplification efficiency of 90 - 110 %" [7].
- Svec et al. (2015): a properly designed assay should amplify with at least 90% efficiency. The estimate is imprecise: with one replicate per dilution the 95% interval of the efficiency for one assay was about 89–99%, narrowing with three replicates; they recommend one robust curve with 3–4 replicates per concentration [6].
- MIQE 2.0: dilution errors give slopes below −3.32 (apparent efficiency over 100%), and inhibitors that are diluted out also raise the apparent efficiency [2]. MIQE (2009) requires target and reference to have comparable efficiencies for the ΔΔCq method [1].

**Exceptional data.** If an assay is reproducibly outside the range (some miRNA and GC-rich assays), report the measured efficiency and use an efficiency-corrected calculation (Pfaffl 2001 [10]) rather than one that assumes 100%. For digital PCR the efficiency range does not apply.

## Standard curve R² (default ≥ 0.98)

**Literature.** ENGL: R² of at least 0.98 (stated both for the average R² and, in its worked examples, for every curve) [7]. MIQE (2009) asks that R² be reported, with confidence intervals across the linear range, but sets no number [1].

**Reasoning and exceptional data.** R² depends on the width of the range: the same pipetting scatter gives a lower R² over 2 logs than over 5. If your curve is narrow (for example a low-abundance target where only 3 levels are above the LOD), R² below 0.98 may still come with an acceptable efficiency; look at the residuals rather than lowering the number blindly.

## Minimum dilution levels (default 3)

**What PlateCheck does.** Below this many levels it does not fit a curve and says so.

**Literature.** MIQE (2009): the dynamic range should cover at least 3 orders of magnitude and ideally 5–6 log10 concentrations [1]. MIQE 2.0: 4–5 orders of magnitude, at least 3 technical replicates per dilution [2]. Svec et al.: 3–4 replicates per concentration [6].

**Reasoning.** 3 is the smallest number that can show curvature at all; it is a floor for fitting, not a recommendation.

I did not raise this default to 4 or 5, because it would stop PlateCheck from reporting efficiency for curves people do run, and the dilution factor (2-, 4-, 5- or 10-fold) changes how many levels a given range needs. The range is checked separately, below.

## Standard curve range (default: note below 3 log10 units)

**What PlateCheck does.** For each fitted curve it takes log10 of the highest quantity minus log10 of the lowest, counting only standards with both a quantity and a Ct. Under the setting, the curve is still fitted and reported, with a low-severity note that efficiency and R² are less certain. Set 0 to switch it off.

**Literature.** MIQE (2009): at least 3 orders of magnitude, ideally 5–6 [1]. MIQE 2.0: 4–5 orders [2].

**Exceptional data.** Raise it to 4 or 5 to follow MIQE 2.0. Lower it or switch it off when a low-abundance target leaves only a few levels above the LOD.

## Melt Tm tolerance (default ±1 °C from the target's median)

**Literature.** Ririe et al. (1997) showed melt curves can differentiate products "separated by less than 2 degrees C" in Tm [9]. MIQE 2.0: Tm depends on reaction composition, ramp rate and instrument calibration, but is specific to an amplicon; two different products can share a Tm, so one peak at the right Tm does not prove identity [2].

**Reasoning.** Within one run the composition and instrument are the same, so a shift of more than half the separable difference is worth a look.

**Exceptional data.** On high-resolution melt instruments tighten to about 0.5 °C. For wells with very different template or salt content (crude lysates, different elution buffers) loosen it.

## Secondary melt peaks (default ≥ 0.3 × the main peak)

**Literature.** I found no paper that sets a height ratio. MIQE 2.0 notes that amplicons with unbalanced GC content can melt in blocks and show several peaks from one product, and that dyes differ in how well they show low-Tm products [2].

**What I searched (November 2026).** PubMed and web searches for a published height or area ratio between a secondary and the main melt peak (terms: melt curve, secondary peak, primer-dimer, peak height ratio, automated classification). I found none in a peer-reviewed methods paper. The qpcR R package (Ritz and Spiess) drops melt peaks below an area cut-off, but that cut-off is an absolute area with a default of 0, not a fraction of the main peak; I checked this in its source code. The ratios I did find were in vendor blogs and patents, which I do not cite. So 0.3 stays a rule of thumb.

**Reasoning.** This is my heuristic: a second peak at 30% of the main one is large enough to contribute to the Ct, while small primer-dimer bumps are below it. Peaks less than 2 °C from the main peak are ignored.

**Exceptional data.** Lower it (0.1–0.2) to catch primer-dimer in late-Ct targets such as miRNA. Raise it for amplicons predicted (for example with uMELT, which MIQE 2.0 mentions) to melt in two domains.

## Curve vs reported Ct tolerance (default 2 cycles)

**What PlateCheck does.** It redraws one common threshold on the baseline-subtracted curves, computes the offset between each well's reported Ct and that crossing, and flags wells whose offset differs from the plate median by more than this. Its rise test uses 10 × the baseline SD, the usual instrument default described by Ruiz-Villalba et al. [3].

**Literature.** Baseline estimation errors change the apparent efficiency and so the Cq (Ruijter et al. 2009 [8]); Cq values shift with the threshold setting [3]. There is no published tolerance for this comparison. I searched PubMed and the web for a tolerance between a reported Cq and one recalculated from the curves (terms: reported versus recalculated Cq, Cq tolerance, baseline, threshold, outlier well) and found none. Ruiz-Villalba et al. [3] show that Cq variability depends on where the threshold sits in the exponential phase, more so at low input, but give no number in cycles. So 2 cycles stays a rule of thumb.

**Reasoning.** My heuristic, wide enough to ignore normal differences in curve shape and plateau height.

**Exceptional data.** If your instrument uses one threshold and baseline for the whole plate, 1 cycle is enough. For multiplexed or probe assays with low plateaus, keep 2 or more.

## RNA-type notes (no setting)

**What PlateCheck does.** It takes each target's RNA type from the Genes step, or guesses it from the name when you haven't set one (the finding says which), and adds three low-severity notes. Each target is reported by at most one of the two miRNA notes.

- **Target and reference of different RNA types.** With the Analysis step on, a miRNA target normalised to an mRNA reference gene, or an mRNA target normalised to a miRNA or snoRNA/snRNA reference.
- **miRNA targets without a small-RNA reference.** miRNA targets on the plate, no snoRNA or snRNA target, and no miRNA or small RNA chosen as reference in Analysis. Choosing a stable miRNA or a spike-in such as cel-miR-39 as reference clears it.
- **lncRNA without a no-RT control.** An lncRNA target with no no-RT well. Not reported when "Expect a no-RT control" is on, because the missing-control check already covers every target, or when the no-RT control is marked not applicable for that target.

**Literature.** Schwarzenbach et al. review miRNA normalisation; they note that reference genes of the same RNA class are preferred, and that RNU6, the most used small-RNA reference, was unstable in several of the studies they review [11]. A miRNA and an mRNA are also usually reverse transcribed differently (stem-loop or poly(A) RT against oligo-dT or random primers). In GENCODE the most common lncRNA transcript has two exons, against four for protein-coding transcripts [12], so lncRNA primers often cannot span an exon junction; MIQE asks for a no-RT control at least for new RNA preps [1, 2].

**Exceptional data.** If your miRNA reference is on another plate, choose it in Analysis when you combine plates. If the type guessed from a name is wrong, correct it in the Genes step.

## Expected controls

- **NTC (on by default):** MIQE (2009) asks for NTCs on every plate or batch [1].
- **Positive control (off):** MIQE (2009) calls positive controls essential when calibration curves are not run in each run [1]; turn it on if your plates have no standards.
- **No-RT (off):** see above.
- **Melt checks (off):** MIQE 2.0 calls melt analysis essential for dye-based assays [2]; it does not apply to probe assays, which is why it is off until you say your assay uses a dye.

## The variability graphs

On the Review tab, under the replicate tables:

1. **Histogram of technical SD** for every replicate group with at least two numeric Ct values (samples, standards and positive controls), with the SD threshold as a dashed line.
2. **Technical SD against mean Ct**, with the threshold and the Poisson curve from the table above. Groups above the threshold but close to the curve are probably low-copy rather than badly pipetted. With the Ct-dependent SD threshold on, a red line shows the limit actually used.
3. **Technical vs biological SD per target.** Technical SD is each sample's replicate SD. Biological SD is the SD of the biological units' mean Ct within each experimental group (technical wells averaged first, so each unit counts once). Short bars show pooled values (weighted by degrees of freedom). When the pooled technical SD reaches the biological SD, the assay is at the limit of quantification as Ruiz-Villalba et al. define it [3]: more technical replicates or more template help more than more samples.

Biological SD here still contains a little technical noise (each unit mean comes from a few wells), so it slightly overstates true biological variation.

## Defaults I changed

None. Each existing default is either a published acceptance criterion (efficiency, R²), follows directly from MIQE (NTC at Ct 35, expected controls), or is a restatement of a common rule (SD 0.3 ≈ 0.5-cycle range).

Four checks were added as new settings rather than changes to old ones: the late-Ct note (35), the no-RT margin (5 cycles), the Ct-dependent SD threshold (off, k = 1.5) and the standard-curve range note (3 log10 units). With the defaults, earlier results are unchanged except for these new notes and flags; the Ct-dependent SD changes nothing until it is switched on.

## References

1. Bustin SA, Benes V, Garson JA, et al. The MIQE guidelines: minimum information for publication of quantitative real-time PCR experiments. Clin Chem. 2009;55(4):611–622. doi:10.1373/clinchem.2008.112797
2. Bustin SA, Ruijter JM, van den Hoff MJB, et al. MIQE 2.0: revision of the Minimum Information for Publication of Quantitative Real-Time PCR Experiments guidelines. Clin Chem. 2025;71(6):634–651. doi:10.1093/clinchem/hvaf043
3. Ruiz-Villalba A, Ruijter JM, van den Hoff MJB. Use and misuse of Cq in qPCR data analysis and reporting. Life (Basel). 2021;11(6):496. doi:10.3390/life11060496
4. de Ronde MWJ, Ruijter JM, Lanfear D, et al. Practical data handling pipeline improves performance of qPCR-based circulating miRNA measurements. RNA. 2017;23(5):811–821. doi:10.1261/rna.059063.116
5. Forootan A, Sjöback R, Björkman J, Sjögreen B, Linz L, Kubista M. Methods to determine limit of detection and limit of quantification in quantitative real-time PCR (qPCR). Biomol Detect Quantif. 2017;12:1–6. doi:10.1016/j.bdq.2017.04.001
6. Svec D, Tichopad A, Novosadova V, Pfaffl MW, Kubista M. How good is a PCR efficiency estimate: recommendations for precise and robust qPCR efficiency assessments. Biomol Detect Quantif. 2015;3:9–16. doi:10.1016/j.bdq.2015.01.005
7. Hougs L, Gatto F, Goerlich O, et al. Verification of analytical methods for GMO testing when implementing interlaboratory validated methods, version 2. European Network of GMO Laboratories. EUR 29015 EN. Publications Office of the European Union; 2017. doi:10.2760/645114
8. Ruijter JM, Ramakers C, Hoogaars WMH, et al. Amplification efficiency: linking baseline and bias in the analysis of quantitative PCR data. Nucleic Acids Res. 2009;37(6):e45. doi:10.1093/nar/gkp045
9. Ririe KM, Rasmussen RP, Wittwer CT. Product differentiation by analysis of DNA melting curves during the polymerase chain reaction. Anal Biochem. 1997;245(2):154–160. doi:10.1006/abio.1996.9916
10. Pfaffl MW. A new mathematical model for relative quantification in real-time RT-PCR. Nucleic Acids Res. 2001;29(9):e45. doi:10.1093/nar/29.9.e45
11. Schwarzenbach H, da Silva AM, Calin G, Pantel K. Data normalization strategies for microRNA quantification. Clin Chem. 2015;61(11):1333–1342. doi:10.1373/clinchem.2015.239459
12. Harrow J, Frankish A, Gonzalez JM, et al. GENCODE: the reference human genome annotation for The ENCODE Project. Genome Res. 2012;22(9):1760–1774. doi:10.1101/gr.135350.111

Also mentioned: Nolan T, Hands RE, Bustin SA. Quantification of mRNA using real-time RT-PCR. Nat Protoc. 2006;1(3):1559–1582. doi:10.1038/nprot.2006.236 (cited through [3] and [4]; I could not read the full text). Ståhlberg A, Kubista M. Technical aspects and recommendations for single-cell qPCR. Mol Aspects Med. 2018;59:28–35. doi:10.1016/j.mam.2017.07.004 (abstract only).

Left out because I could not check the number in the paper itself: Taylor et al. 2019 (Trends Biotechnol 37:761–774, doi:10.1016/j.tibtech.2018.12.002), which is widely quoted for 90–110% efficiency. The full text was not reachable from here; the ENGL and Svec references cover the same point.
