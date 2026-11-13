# PlateCheck 1.0 plan

Based on feedback from Sanket Mukherjee (PhD, KSBS, IIT Delhi), November 2026. PlateCheck stays a static website: everything runs in the browser, nothing is uploaded, no server.

## 1. Thresholds you can defend (evidence)

Every number PlateCheck uses to raise a flag gets a stated value, the reason for it, and a citation, preferably from methods or protocol papers (MIQE 2009 and MIQE 2.0, Nature Protocols, Methods, Genome Biology and similar).

- Thresholds covered: technical replicate SD, late Ct / low-expression cut-off, NTC and no-RT margins (ΔCt between sample and control), efficiency range, R², minimum dilution levels, melt Tm tolerance and secondary peaks, Ct vs curve tolerance.
- For each: the default, the range found in the literature, what changes for exceptional data (very low expression, single-cell, miRNA, high-throughput panels, digital vs real-time), and the citation.
- Shown in the app next to each threshold (Method details and thresholds) and in the report. Written up in `docs/thresholds.md`.
- Graphs: distribution of technical replicate SD across the plate, and technical vs biological variability per target, with the threshold drawn on them, so a user can see whether their data is unusual before changing a threshold.

## 2. Analysis module

Off until the user switches it on. The user chooses; PlateCheck never picks reference genes by itself.

- Normalisation: ΔCt against one or more reference genes (several references use their mean Ct, which is the geometric mean of quantities), ΔΔCt against a control group, fold change 2^−ΔΔCt. Efficiency-corrected (Pfaffl) when standard curves exist.
- Reference-gene stability check: flag a reference whose Ct differs between groups.
- Statistics on ΔCt values with biological replicates as n (technical replicates are averaged first): Welch t-test for two groups, one-way ANOVA for more, then each group against the control. Multiple-testing correction: Benjamini–Hochberg and Bonferroni, both reported. Results validated against SciPy / R reference values.
- Several plates in one experiment: a "study" groups saved runs. Inter-run calibration with a shared calibrator sample (as in qBase, Hellemans et al. 2007), otherwise plate-wise centring is offered with a clear warning. Results flag plates that are not connected by a calibrator.
- Graphs ready for a paper: fold change per gene with biological replicates as large dots, technical replicates as small dots in a second colour, mean ± SD (or SEM), significance marks with corrected p; a volcano plot when there are about 6 or more genes. SVG and 300-dpi PNG download. Colour-blind safe.

## 3. Genes and RNA types

- Each target gets a type: mRNA, miRNA, lncRNA, circRNA, snoRNA/snRNA, rRNA, genomic DNA / other. Guessed from the name (MIR…, hsa-miR-…, LINC…, SNOR…) and confirmed by the user. miRNA assays get their own notes (stem-loop or poly(A) RT, small RNA references such as U6, RNU44/RNU48, SNORD).
- Gene symbols checked against HUGO (HGNC) style, with Entrez and Ensembl IDs and a one-line description, through an optional "Look up genes" button that queries a public gene database (only gene symbols are sent, never data). Stored with the run and shown in the report.

## 4. More qPCR experiments (assay types)

Many experiments share a few calculations. 1.0 covers these, with the right controls for each:

| Calculation | Experiments |
|---|---|
| % input, fold enrichment over IgG / mock | ChIP, CUT&RUN, CUT&Tag, RIP / IP, CLIP, ChIRP, RAP, CHART, MeDIP, hMeDIP, MBD, MeRIP / m6A, acRIP |
| % methylation from digested vs mock | MSRE-qPCR; PMR for MethyLight / MS-qPCR |
| Relative accessibility vs a closed control region | ATAC, DNase, MNase, FAIRE |
| Relative crosslinking frequency (normalised to a control template and loading control) | 3C-qPCR |
| Distribution across fractions | polysome profiling, TRAP |
| Signal over blank, limit of detection | immuno-PCR, PLA, PEA |

Each calculation is documented with its formula and a methods citation in `docs/assays.md`.

## How the work is split

Four workstreams, each in its own files so they can be built at the same time and merged:

| Workstream | Owns |
|---|---|
| Thresholds & evidence | `docs/thresholds.md`, threshold citations in `web/core.js` (RULES / RULESET_FIELDS metadata only), `web/ui-variability.js`, report citations |
| Analysis & statistics | `web/stats.js`, `web/analysis.js`, `web/ui-analysis.js`, studies in `web/store.js`, `docs/analysis.md` |
| Genes & RNA types | `web/genes.js`, `web/ui-genes.js`, `docs/genes.md`, PRIVACY.md note |
| Assay types | `web/assays.js`, `web/ui-assays.js`, `docs/assays.md` |

Shared files (`web/app.js`, `web/core.js`, `web/report.js`, `web/style.css`) get only small, marked hooks from each workstream; they are merged by hand. Every workstream ships tests (`tests/*.test.mjs`), keeps the monkey test passing, and writes in the same plain first-person voice as the rest of the site.

Built since: ComBat batch correction for larger panels, more statistical tests (Student, paired, one-sample, Tukey, Dunnett, Mann–Whitney, Kruskal–Wallis + Dunn), four extra checks, RNA-type checks, 14 species in the gene lookup, 4sU labelling and efficiency correction in the assay calculations.

Later: GSEA (better suited to RNA-seq than to qPCR panels), the plate image idea once its meaning is clear.
