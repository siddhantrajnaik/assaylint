# Assay calculations

Many experiments end in a qPCR plate: ChIP, CUT&RUN, RIP, MeDIP, MSRE, MethyLight, DNase and ATAC, 3C, polysome profiling, immuno-PCR, 4sU labelling and more. They look different at the bench, but most of them come down to one of a few calculations, and PlateCheck does those. You pick the experiment under **More → Assay calculations**, mark which wells are IP, input, IgG and so on, and it shows a table, a chart and anything that looks off. The same section goes into the report.

The code is in `web/assays.js` (the maths) and `web/ui-assays.js` (the page). The tests in `tests/assays.test.mjs` use the worked examples below.

## How wells are labelled

PlateCheck's own roles (sample, NTC, positive control, no-RT, standard, not used) stay as they are. An IP, an input or a digested well is still a "sample" to the run checks, so its replicates are still compared and its target still needs an NTC. The assay labels are a second layer on top:

| Label | Used by |
|---|---|
| IP / pulldown, Input, IgG / mock IP | % input and fold enrichment |
| Digested, Mock-digested | MSRE-qPCR |
| Test sample, Fully methylated reference | MethyLight (PMR) |
| Treated / enriched, Untreated / naked DNA | DNase, MNase, ATAC, FAIRE |
| 3C library, Control template (BAC) | 3C-qPCR |
| Fraction (with a number or a name) | Polysome profiling, TRAP |
| Test sample, Blank | Immuno-PCR, PLA, PEA |
| Thiol-treated (NEM), Mock-treated | 4sU labelling, treated vs mock |
| IP / pulldown, Input | 4sU labelling, biotin pulldown vs total |

Each labelled well also has a **set**: the chromatin, DNA or lysate it came from. The IP, input and IgG of one chromatin share a set, and that's how they're matched. The set starts as the well's group (for example the Bio-Rad "Biological Set Name" column), or, if there's no group, the sample name with words like "input", "IgG", "mock" or "HpaII" taken out, so "WT input" and "WT IP" both become "WT". You can change it.

"Fill in from sample names" labels wells whose names say what they are (IP, input, IgG, mock, digested, BAC, blank, Fr 3 …). It only touches wells you haven't labelled yet. NTC and unused wells are never part of an assay calculation.

Why a separate layer and not new roles in `core.js`: the existing rules treat roles in specific ways. Replicate SD is only worked out for sample, positive and standard wells, missing Ct is only flagged for samples and standards, and the "no control wells" check counts anything that isn't a sample as a control. Adding "input" or "IgG" as roles would have taken those wells out of the replicate check and made an all-ChIP plate look as if it had controls. An IgG is a sample as far as the qPCR is concerned. So the assay labels are stored separately (`exp.assaySetup`, keyed by the row of the results file) and nothing in the run checks changes. If the results file is replaced, the old labels are set aside, because they point at rows of the old file.

## Shared rules for every calculation

- Technical replicates (same set, label, target and fraction) are averaged as Ct values first, the same way as PlateCheck's replicate table. Every well with a numeric Ct counts; wells without one are left out of the mean, and that's flagged.
- A replicate SD above your threshold (Method details and thresholds) is flagged, as is a mean Ct above 35 for wells that should amplify.
- A Ct difference becomes a ratio as E^ΔCt, where E = 1 + the PCR efficiency of that primer pair. By default E = 2 (every copy doubles each cycle, 100% efficiency), so results don't change unless you set an efficiency. The formulas below are written with 2; read 2 as E. See "PCR efficiency" below.
- Nothing is clipped. A % methylation of 140% is shown as 140% with a note, because that number tells you something went wrong.

## PCR efficiency

Haring et al. (2007) use a calibration line per primer pair because primer pairs don't all amplify equally well, and the ENGL acceptance range for an assay is 90–110% (sources in docs/thresholds.md). A pair at 90% instead of 100% turns a 6.6-cycle difference into 1.9^6.6 = 69-fold instead of 2^6.6 = 97-fold, so the efficiency matters most where the ΔCt is large (input dilution, IgG, digested vs mock).

On the Assay calculations page, under **PCR efficiency per primer pair**, each target in the labelled wells can be set to:

- **100% (assumed)**, the default.
- **Standard curve on this plate**: the efficiency PlateCheck already fits for the run checks (wells with the Standard role and a quantity; efficiency = 10^(−1/slope) − 1). Only offered when there is a curve for that target. If the curve later disappears (the results file is replaced, or the standards are relabelled), the calculation falls back to 100% and says so.
- **Typed in**: a percentage from your own assay validation, between 50 and 150.

A standard curve on the plate is never applied by itself; you pick it. The efficiency used is shown for every row of the results table and listed in the report, with the slope, R² and number of levels when it came from a curve. An efficiency outside 90–110% is flagged, but still used.

Where each efficiency goes:

| Calculation | With efficiencies |
|---|---|
| % input, fold over IgG | E(region)^ΔCt; the input dilution comes off the input Ct as log_E(100 / input %) |
| Fold over negative region | ratio of the two % inputs, each with its own E; IP-only: E(region)^−Ct ÷ E(negative)^−Ct |
| MSRE | E(region)^−ΔCt, divided by E(no-site)^−ΔCt and by the fully methylated control's value |
| PMR | 100 × E(gene)^(Ct ref − Ct sample) × E(control)^(Ct sample − Ct ref) |
| Accessibility | E(region)^d ÷ E(closed)^d(closed) (or the inverse for enriched DNA); % left = E(region)^−d |
| 3C | E(pair)^−(Ct library − Ct template) × E(loading)^(loading Ct − mean loading Ct) |
| Fractions | amount ∝ E(RNA)^−Ct, divided by E(spike-in)^−Ct(spike-in) |
| Signal over blank | E^ΔCt |
| 4sU labelling | E(RNA)^−d for treated vs mock; total % × E(RNA)^−(Ct pulldown − Ct total) |

With every E = 2 each line is exactly the formula given in its section.

**Worked example (% input).** IP 24, 1% input 26, at 90% efficiency (E = 1.9): % input = 1% × 1.9^2 = 3.61%, against 4% at 100%. Fold over an IgG at Ct 30: 1.9^6 = 47.0 instead of 64.

**Worked example (MSRE).** Mock 24, digested 25, at 95% (E = 1.95): 100 × 1.95^−1 = 51.3% methylated with a sensitive enzyme, 48.7% with a dependent one. With a no-site region that moved 0.5 cycles at 100% and the region at 90% after 1.5 cycles: 1.9^−1.5 ÷ 2^−0.5 = 0.540, so 54.0%.

**Caveat.** This corrects the slope part of the error only. Ratios between different primer pairs (fold over the negative region from IP alone, PMR, accessibility against a closed region, spike-in-corrected fractions) also depend on where each pair crosses the threshold, which an efficiency can't fix. That is why Haring et al., Hagège et al. and the MethyLight papers use a standard curve per primer pair and read quantities off it.

## 1. % input and fold enrichment

**Experiments:** ChIP, CUT&RUN, CUT&Tag, RIP / IP, CLIP, iCLIP, eCLIP, ChIRP, RAP, CHART, MeDIP, hMeDIP, MBD, MeRIP / m6A-RIP, acRIP, EU nascent-RNA capture.

**Plate:** for every primer pair (region) and every chromatin: IP wells, input wells, and preferably IgG (or no-antibody, mock, beads-only) wells, in technical replicate. A negative control region that your protein or mark shouldn't bind. NTC for each primer pair. CUT&RUN and CUT&Tag usually have no input, so the comparison is with IgG and the negative region.

**Formula**

    adjusted input Ct = Ct(input) − log2(100 / input %)
    % input          = 100 × 2^(adjusted input Ct − Ct(IP))
    fold over IgG    = 2^(Ct(IgG) − Ct(IP))
    fold over negative region = % input(region) / % input(negative region)

The input % is how much of the chromatin going into one IP you kept as input: 1% means a dilution factor of 100, so 6.64 cycles come off the input Ct. Without input, fold over the negative region is worked out from IP Ct values alone, 2^(Ct(IP, negative) − Ct(IP, region)), which only holds if both primer pairs amplify equally well; PlateCheck says so when it does this.

**Worked example (1% input).** IP Ct 24.0, input Ct 26.0. Adjusted input = 26.0 − 6.644 = 19.356. % input = 100 × 2^(19.356 − 24.0) = 4.0%. Put more simply, 1% × 2^(26 − 24) = 4%.

**Worked example (10% input).** IP Ct 27, input Ct 25. Adjusted input = 25 − 3.32 = 21.68; % input = 10% × 2^(25 − 27) = 2.5%.

**Worked example (IgG and a negative region).** At the promoter, IP 25, IgG 30, input 26 (1%): % input 2%, IgG 0.0625%, fold over IgG 2^5 = 32. At a gene desert, IP 29, input 26: 0.125%, so the promoter is 16-fold over the negative region.

**What gets flagged:** no input wells; input or IP that never amplified; IgG coming up at or before the IP (background as high as the signal); % input above 100% (usually a wrong input % or an extra dilution of the input); IgG that never came up (fold over IgG has no number then).

**Sources.** Haring et al. 2007 compare % input, fold enrichment and normalisation to control regions and explain the input and no-antibody controls. Solomon et al. 2021 write out the % input equation with the dilution factor. Mukhopadhyay et al. 2008 is a ChIP-qPCR protocol with the same controls.

- Haring M, Offermann S, Danker T, Horst I, Peterhansel C, Stam M. Chromatin immunoprecipitation: optimization, quantitative analysis and data normalization. *Plant Methods* 2007;3:11. https://doi.org/10.1186/1746-4811-3-11
- Solomon ER, Caldwell KK, Allan AM. A novel method for the normalization of ChIP-qPCR data. *MethodsX* 2021;8:101504. https://doi.org/10.1016/j.mex.2021.101504
- Mukhopadhyay A, Deplancke B, Walhout AJM, Tissenbaum HA. Chromatin immunoprecipitation (ChIP) coupled to detection by quantitative real-time PCR to study transcription factor binding to DNA in *Caenorhabditis elegans*. *Nat Protoc* 2008;3:698–709. https://doi.org/10.1038/nprot.2008.38

**Caveats.** % input assumes the same volume of IP and input DNA goes into each qPCR well; Solomon et al. show how to correct when equal nanograms were loaded instead, which PlateCheck doesn't do. For RNA pulldowns the input and IP have to go through the same reverse transcription. Fold over IgG says nothing about absolute occupancy, and a low IgG can make a weak IP look strong.

## 2. % methylation from digested vs mock (MSRE-qPCR)

**Experiments:** MSRE-qPCR with a methylation-sensitive enzyme (HpaII, HhaI, AciI) or a methylation-dependent one (McrBC, FspEI).

**Plate:** for every DNA and region: digested and mock-digested wells (same DNA, same buffer, no enzyme), in replicate. Optionally a region with no cut site (shows DNA lost in the digest), and DNA methylated in vitro as a fully methylated control. NTC per primer pair.

**Formula**

    ΔCt = Ct(digested) − Ct(mock)
    methylation-sensitive enzyme:  % methylated = 100 × 2^(−ΔCt)
    methylation-dependent enzyme:  % methylated = 100 × (1 − 2^(−ΔCt))

With a region without a cut site, its ΔCt is subtracted from each region's ΔCt. With a fully methylated control, ΔCt is replaced by ΔCt(sample) − ΔCt(control) (ΔΔCt), as Redshaw et al. did.

**Worked example.** Mock 24, digested 25: ΔCt 1, so 50% methylated with either enzyme type. Mock 24, digested 26: 25% with a sensitive enzyme, 75% with a dependent one. With a no-site region that moved 0.5 cycles and a fully methylated control at ΔCt 0.5 (after the same correction, 0), a sample at ΔCt 1.5 gives (1.5 − 0.5) − 0 = 1, so 50%.

**What gets flagged:** mock that never amplified; digested DNA that never came up (with a sensitive enzyme that means it was cut completely, shown as "below x%"); values outside 0–100%; a no-site region that moved more than one cycle.

**Sources**

- Oakes CC, La Salle S, Robaire B, Trasler JM. Evaluation of a quantitative DNA methylation analysis technique using methylation-sensitive/dependent restriction enzymes and real-time PCR. *Epigenetics* 2006;1:146–152. https://doi.org/10.4161/epi.1.3.3392
- Redshaw N, Huggett JF, Taylor MS, Foy CA, Devonshire AS. Quantification of epigenetic biomarkers: an evaluation of established and emerging methods for DNA methylation analysis. *BMC Genomics* 2014;15:1174. https://doi.org/10.1186/1471-2164-15-1174

**Caveats.** Redshaw et al. found that restriction-enzyme qPCR could reliably tell apart differences of 25% methylation or more, but not 10–15%, and that each enzyme type works best in part of the range (both papers note poorer accuracy at the far end of each enzyme's range). A 10% difference is only about 0.2 cycles. Incomplete digestion makes everything look more methylated with a sensitive enzyme.

## 2b. Percent of methylated reference (MethyLight, MS-qPCR)

**Plate:** bisulfite-converted DNA from each sample and from a fully methylated reference (for example M.SssI-treated DNA), each with the methylation-specific reaction and a methylation-independent control reaction (ALU-C4 or ACTB).

**Formula**

    ΔCt = Ct(methylation reaction) − Ct(control reaction), in the same DNA
    PMR = 100 × 2^−(ΔCt(sample) − ΔCt(fully methylated reference))

**Worked example.** Sample: MLH1 30, ALU 20 (ΔCt 10). Reference: MLH1 25, ALU 18 (ΔCt 7). PMR = 100 × 2^−3 = 12.5.

**Sources.** Eads et al. 2000 describe MethyLight; Campan et al. 2009 give the protocol and its quality-control reactions; Weisenberger et al. 2005 describe PMR with an M.SssI-treated reference and the Alu-based ALU-C4 control reaction.

- Eads CA, Danenberg KD, Kawakami K, et al. MethyLight: a high-throughput assay to measure DNA methylation. *Nucleic Acids Res* 2000;28:e32. https://doi.org/10.1093/nar/28.8.e32
- Campan M, Weisenberger DJ, Trinh B, Laird PW. MethyLight. *Methods Mol Biol* 2009;507:325–337. https://doi.org/10.1007/978-1-59745-522-0_23
- Weisenberger DJ, Campan M, Long TI, et al. Analysis of repetitive element DNA methylation by MethyLight. *Nucleic Acids Res* 2005;33:6823–6836. https://doi.org/10.1093/nar/gki987

**Caveats.** The papers calculate PMR from standard curves; the ΔΔCt form here is the same ratio if both reactions are 100% efficient, or if you set each reaction's efficiency. PMR can be above 100.

## 3. Accessibility relative to a closed region (DNase, MNase, ATAC, FAIRE)

**Plate:** for every chromatin and region: treated wells and untreated wells. "Treated" is nuclease-digested chromatin (DNase I, MNase), a FAIRE extract or an ATAC library. "Untreated" is undigested chromatin, total input DNA or tagmented naked genomic DNA from the same cells. A closed control region (a silent gene or gene desert) on the same plate.

There are two directions, and you choose which:

- **Digested chromatin** (DNase or MNase sensitivity): open DNA is cut, so it's *lost*. 
- **Enriched DNA** (FAIRE, ATAC, MNase-protected DNA): open (or protected) DNA is *kept*.

**Formula**

    d = Ct(treated) − Ct(untreated), for each region and for the closed region
    digested chromatin:  accessibility = 2^(d(region) − d(closed))    (how much more the region was lost)
                         % left after digestion = 100 × 2^(−d)
    enriched DNA:        enrichment = 2^(d(closed) − d(region))

**Worked example (DNase).** HS2: treated 27, untreated 24, so d = 3 (12.5% left). Closed region: 24.5 vs 24, d = 0.5. Accessibility = 2^(3 − 0.5) = 5.7: HS2 was lost 5.7 times more than the closed region.

**Worked example (FAIRE).** Enhancer: FAIRE 26, input 24 (d = 2). Closed region: 29 vs 24 (d = 5). Enrichment = 2^(5 − 2) = 8.

**What gets flagged:** missing untreated wells or closed-region results; a closed region that was digested too (more than one cycle), which means over-digestion; a treated region that never came up.

**Sources.** McArthur et al. 2001 measure DNase I sensitivity by real-time PCR as loss of template relative to undigested DNA. Simon et al. 2012 give the FAIRE protocol with guidance on qPCR analysis against total DNA.

- McArthur M, Gerum S, Stamatoyannopoulos G. Quantification of DNaseI-sensitivity by real-time PCR: quantitative analysis of DNaseI-hypersensitivity of the mouse beta-globin LCR. *J Mol Biol* 2001;313:27–34. https://doi.org/10.1006/jmbi.2001.4969
- Simon JM, Giresi PG, Davis IJ, Lieb JD. Using formaldehyde-assisted isolation of regulatory elements (FAIRE) to isolate active regulatory DNA. *Nat Protoc* 2012;7:256–267. https://doi.org/10.1038/nprot.2011.444

**Caveats.** A single enzyme concentration gives one point on a digestion curve; McArthur et al. follow digestion over time. The answer depends on the closed region you chose, so keep it the same across conditions. I didn't find a methods paper for ATAC-qPCR specifically; the calculation is the same as for FAIRE.

## 4. Relative crosslinking frequency (3C-qPCR)

**Plate:** for every 3C sample: each anchor–test primer pair on the 3C library, the same primer pairs on a control template (BAC or PAC clones covering the region, cut and religated so every ligation product is present in equal amounts), loading-control primers (inside one restriction fragment, for example in *Gapdh*) on every library, and optionally a control interaction (the *Ercc3* locus in the protocol).

**Formula**

    signal              = 2^−(Ct(3C library) − Ct(control template)), per primer pair
    loading-corrected   = signal × 2^(Ct(loading, this sample) − mean Ct(loading, all samples))
    relative to control = loading-corrected / loading-corrected(control interaction)

**Worked example.** Pair F19: library 30, BAC 25, so signal 2^−5 = 1/32. Loading Ct 20 in sample A and 21 in sample B (mean 20.5): A's corrected signal is 1/32 × 2^−0.5 = 0.022, B's is 1/32 × 2^0.5 = 0.044 (less DNA in B, so its signal is scaled up). Control pair *Ercc3*: library 28, BAC 26, signal 1/4. Relative to the control: (1/32) / (1/4) = 0.125 in both samples. The loading correction cancels in this ratio.

**What gets flagged:** a primer pair with no control-template wells or one that failed on the template; a sample without a loading-control Ct. A library well with no product is reported as 0 with "No ligation product detected".

**Source.** Hagège et al. 2007, the 3C-qPCR protocol: interaction frequencies are normalised to the BAC control template (for primer efficiency), to a loading control and to a set of control interaction frequencies (they use *ERCC3*).

- Hagège H, Klous P, Braem C, et al. Quantitative analysis of chromosome conformation capture assays (3C-qPCR). *Nat Protoc* 2007;2:1722–1733. https://doi.org/10.1038/nprot.2007.243

**Caveats.** The protocol uses a standard curve of the control template for every primer pair; PlateCheck uses one template level. Put several template dilutions on the plate as standards and the standard-curve check fits an efficiency per primer pair, which you can then pick under PCR efficiency.

## 5. Distribution across fractions (polysome profiling, TRAP)

**Plate:** RT-qPCR of the RNA from every gradient fraction, for each mRNA (and the same for a control mRNA). Label each well as a fraction with its number. Optionally a spike-in RNA added in equal amount to every fraction before RNA extraction. For TRAP, label the bound and unbound fractions "bound" and "unbound".

**Formula**

    relative amount in fraction i = 2^−(Ct_i − lowest Ct)       (with a spike-in: Ct_i − Ct(spike-in)_i)
    % of total in fraction i     = 100 × relative_i / sum over fractions

Optionally, the share in the polysome fractions (from a fraction number you give) is added up.

**Worked example.** Ct 25, 24, 23 and 26 in fractions 1–4. Relative amounts 0.25, 0.5, 1 and 0.125 (sum 1.875), so 13.3%, 26.7%, 53.3% and 6.7%. Polysomes from fraction 3: 60%.

**What gets flagged:** fraction wells without a number (left out); a fraction that never amplified (counts as 0%); a missing spike-in Ct in a fraction (that fraction is left out of the total).

**Sources.** Panda et al. 2017 give the per-fraction ΔCt calculation and % of total; Gandin et al. 2014 describe polysome fractionation; Heiman et al. 2014 is the TRAP protocol.

- Panda AC, Martindale JL, Gorospe M. Polysome fractionation to analyze mRNA distribution profiles. *Bio-protocol* 2017;7:e2126. https://doi.org/10.21769/BioProtoc.2126 (a correction notice was published later, PMID 31187050)
- Gandin V, Sikström K, Alain T, et al. Polysome fractionation and analysis of mammalian translatomes on a genome-wide scale. *J Vis Exp* 2014;(87):51455. https://doi.org/10.3791/51455
- Heiman M, Kulicke R, Fenster RJ, Greengard P, Heintz N. Cell type-specific mRNA purification by translating ribosome affinity purification (TRAP). *Nat Protoc* 2014;9:1282–1291. https://doi.org/10.1038/nprot.2014.085

**Caveats.** Without a spike-in, differences in RNA recovery between fractions go straight into the distribution. The spike-in correction is my addition, not from these papers. TRAP is often also reported as IP over input enrichment normalised to a reference gene; for that, use the % input calculation instead.

## 6. Signal over blank and limit of detection (immuno-PCR, PLA, PEA)

**Plate:** samples, and blanks (buffer, no antigen) for each assay, at least two and better three or more.

**Formula**

    ΔCt             = mean Ct(blank) − Ct(sample)
    fold over blank = 2^ΔCt
    LOD (as a Ct)   = mean Ct(blank) − k × SD(blank)      (k = 3 by default; a sample is above the LOD if its Ct is lower)

**Worked example.** Blanks 35.0, 35.5, 34.5: mean 35, SD 0.5, so the LOD Ct is 35 − 3 × 0.5 = 33.5. A sample at Ct 30 has ΔCt 5, fold 32, and is above the LOD. A sample at Ct 34 is below it.

**What gets flagged:** no blanks; only one blank with a Ct (no SD, so no LOD); blanks that never came up (the last cycle is used, so fold over blank is a lower bound); a sample later than its blank.

**Sources.** Niemeyer et al. 2007 (immuno-PCR protocol), Gullberg et al. 2004 (proximity ligation), Lundberg et al. 2011 (proximity extension; they give the lower limit of detection as 2 SD above the buffer background). Armbruster and Pry 2008 explain limit of blank and limit of detection.

- Niemeyer CM, Adler M, Wacker R. Detecting antigens by quantitative immuno-PCR. *Nat Protoc* 2007;2:1918–1930. https://doi.org/10.1038/nprot.2007.267
- Gullberg M, Gústafsdóttir SM, Schallmeiner E, et al. Cytokine detection by antibody-based proximity ligation. *Proc Natl Acad Sci USA* 2004;101:8420–8424. https://doi.org/10.1073/pnas.0400552101
- Lundberg M, Eriksson A, Tran B, Assarsson E, Fredriksson S. Homogeneous antibody-based proximity extension assays provide sensitive and specific detection of low-abundant proteins in human blood. *Nucleic Acids Res* 2011;39:e102. https://doi.org/10.1093/nar/gkr424
- Armbruster DA, Pry T. Limit of blank, limit of detection and limit of quantitation. *Clin Biochem Rev* 2008;29 Suppl 1:S49–S52. PMID 18852857

**Caveats.** The SD multiplier is a choice: Lundberg et al. used 2 SD, Armbruster and Pry define the limit of blank as mean + 1.645 SD (in concentration units) and the LOD from low-concentration samples as well. PlateCheck works in Ct, not concentration, and uses k = 3 unless you change it. Commercial PEA panels (NPX values) use extension and inter-plate controls that PlateCheck doesn't model.

## 7. New RNA after 4sU labelling (Roadblock-qPCR, 4sU-tagging, "SLAM-qPCR")

**What exists and what doesn't.** SLAM-seq (Herzog et al. 2017) labels new RNA with 4-thiouridine (4sU), alkylates it with iodoacetamide, and reads the label as T-to-C changes in sequencing reads. That change doesn't stop reverse transcription, so ordinary qPCR primers can't see it. I looked for a published qPCR version of SLAM and didn't find one (PubMed, November 2026). There are two published ways to read 4sU labelling out by qPCR, and PlateCheck does both:

- **Treated vs mock (Roadblock-qPCR, Watson et al. 2021).** Total RNA is treated with N-ethylmaleimide (NEM), which modifies 4sU so that reverse transcriptase stops there. New transcripts carry 4sU and drop out of the cDNA; what is left is the RNA made before the label. The same RNA without NEM is the mock.
- **Pulldown vs total (4sU-tagging, Dölken et al. 2008, Rädle et al. 2013).** The 4sU RNA is biotinylated and pulled down on streptavidin beads; qPCR on the pulldown and on total RNA.

**Plate:** for every sample (set) and RNA: treated and mock wells, or pulldown and total wells, in technical replicate. Cells grown without 4sU and taken through exactly the same steps, as their own set. NTC per primer pair.

**Formula, treated vs mock**

    d = Ct(treated) − Ct(mock)
    with no-4sU control cells:  d is replaced by d − d(no-4sU)
    % made before the label = 100 × 2^(−d)
    % new                   = 100 − % made before the label

**Formula, pulldown vs total**

    % in pulldown = total % × 2^(Ct(total) − Ct(pulldown))
    with no-4sU control cells:  % new = % in pulldown − % in the no-4sU pulldown
                                over background = % in pulldown / % in the no-4sU pulldown

"Total %" is how much total RNA you kept compared with what went into one pulldown, exactly like the input % in ChIP.

**My own adaptation.** The no-4sU background correction and the "% new" read-out are my choices, not a published qPCR method. Watson et al. use NEM-treated RNA to follow the pre-existing RNA over time and get half-lives; the single-time-point "% new" is my reading of the same numbers. Taking the no-4sU ΔCt off is the same idea as the no-cut-site correction in MSRE: anything the treatment does to RNA without 4sU isn't the label. For the pulldown, subtracting the no-4sU pulldown treats it like an IgG. Check the numbers against your own controls before relying on them.

**Worked example (treated vs mock).** 4sU cells: NEM 26, mock 25, so d = 1. No-4sU cells: NEM 25.2, mock 25, so d = 0.2. Corrected d = 0.8, so 100 × 2^−0.8 = 57.4% was made before the label and 42.6% is new. Without the no-4sU cells it would read 50% new.

**Worked example (pulldown).** Total kept 10%. 4sU cells: total 25, pulldown 27, so 10% × 2^−2 = 2.5%. No-4sU cells: total 25, pulldown 32, so 0.078%. Background-corrected 2.42%, and the pulldown is 32-fold over background.

**What gets flagged:** no no-4sU set; no-4sU cells whose Ct moved more than half a cycle with NEM (the compound is doing something besides blocking at 4sU); treated RNA coming up earlier than mock; a pulldown less than 2-fold over the no-4sU pulldown; wells labelled for the other read-out.

**Sources**

- Watson MJ, Park Y, Thoreen CC. Roadblock-qPCR: a simple and inexpensive strategy for targeted measurements of mRNA stability. *RNA* 2021;27:335–342. https://doi.org/10.1261/rna.076885.120
- Dölken L, Ruzsics Z, Rädle B, et al. High-resolution gene expression profiling for simultaneous kinetic parameter analysis of RNA synthesis and decay. *RNA* 2008;14:1959–1972. https://doi.org/10.1261/rna.1136108
- Rädle B, Rutkowski AJ, Ruzsics Z, Friedel CC, Koszinowski UH, Dölken L. Metabolic labeling of newly transcribed RNA for high resolution gene expression profiling of RNA synthesis, processing and decay in cell culture. *J Vis Exp* 2013;(78):50195. https://doi.org/10.3791/50195
- Herzog VA, Reichholf B, Neumann T, et al. Thiol-linked alkylation of RNA to assess expression dynamics. *Nat Methods* 2017;14:1198–1204. https://doi.org/10.1038/nmeth.4435 (SLAM-seq; cited for the chemistry, not for a qPCR read-out)

I checked all four on PubMed in November 2026.

**Caveats.** A transcript only drops out of the NEM-treated cDNA if the RT runs over at least one 4sU, so short amplicons on RNA with few uridines, or short labelling times, under-count new RNA. The pulldown never captures every labelled molecule, so "% new" from a pulldown is a lower bound and is best compared between conditions, not read as an absolute fraction. Neither read-out is a half-life; for that you need a time course.

## iCLIP and eCLIP

iCLIP (König et al. 2010) and eCLIP are listed with RIP and CLIP under % input and fold enrichment. Both are normally read out by sequencing; if you check a few targets by qPCR, the size-matched input is the input and the IgG or no-crosslink sample is the background.

- König J, Zarnack K, Rot G, et al. iCLIP reveals the function of hnRNP particles in splicing at individual nucleotide resolution. *Nat Struct Mol Biol* 2010;17:909–915. https://doi.org/10.1038/nsmb.1838

## Not covered yet

- Allele-specific qPCR for SLAM-seq T-to-C conversions. Nobody has published it as far as I could find, and it would need primers designed over each converted position.
- Reading quantities straight off a standard curve per primer pair (as the 3C and MethyLight protocols do), rather than correcting ΔCt with an efficiency.
- Statistics across biological replicates; the Analysis module (roadmap workstream 2) will take these numbers as input.
