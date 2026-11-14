# Sample data to try PlateCheck

These files are made up but laid out exactly like real instrument exports. Each one has a few problems planted in it so you can see what PlateCheck catches.

Open https://siddhantrajnaik.github.io/platecheck/ and drop the files for one run onto the home page, all at once. It works out which file is which and takes you straight to the review.

## 1. Bio-Rad CFX96, SYBR Green (start here)

Drop all three `1 CFX96 SYBR` files together. Melt checks switch on by themselves because a melt file is included.

What's planted:
- The IL6 NTC (H02) amplifies, and its melt peak is low, which looks like primer-dimer
- B05 has a second melt peak
- H03 is labelled "Neg Ctrl", which is ambiguous: on the Plate page, click H03 and choose No-RT
- One set of replicates spreads too much

## 2. QuantStudio 5, 384-well TaqMan duplex

Drop both `2 QuantStudio 384 TaqMan` files together.

What's planted:
- A well marked Omit in the instrument software
- One NTC comes up late (Ct 36.8)
- A VIC signal failed in one well
- A 6-point standard curve (efficiency around 100%)

## 3. Simple hand-made CSV

Drop `3 Simple hand-made CSV - results.csv` on its own.

What's planted:
- A typo in a well name (A1O instead of A04)
- A missing Ct ("N/A")
- A blank line and an "Average" row, which PlateCheck handles without losing data

## 4. QuantStudio Excel export (one .xlsx file)

Drop `4 QuantStudio Excel export.xlsx` on its own. It's run 2 saved the way QuantStudio's "Export to Excel" does it: one workbook with Sample Setup, Amplification Data and Results sheets, each with the run details on top. PlateCheck picks the Results and Amplification Data sheets itself, and you get the same flags as run 2.

## 5 and 6. Assay calculations: ChIP-qPCR and MSRE-qPCR

These two runs are for the assay calculations (More, then Assay calculations). Drop one file, open that page, pick the experiment type and click "Fill in … wells from sample names". The run checks on the Review page work on them as usual.

### 5. ChIP-qPCR, % input and IgG (Bio-Rad CFX96 layout)

`5 ChIP-qPCR percent input - results.csv`: H3K27ac ChIP from WT and KO chromatin at the MYC promoter, a MYC enhancer and a gene desert (GAPDH-desert), with IP, 1% input and IgG wells in triplicate. The chromatin is in the Biological Set Name column, which PlateCheck uses as the set. Choose ChIP-qPCR, leave the input at 1% and set the negative region to GAPDH-desert.

What's planted:
- In KO at the MYC enhancer the IgG comes up earlier than the IP
- The KO input wells for GAPDH-desert were never loaded, so there's no % input there
- One WT IP replicate at the enhancer is 0.9 cycles off
- The MYC promoter NTC comes up at Ct 34.1 (a normal Review flag)

You should see about 4% input and 64-fold over IgG at the WT promoter.

### 6. MSRE-qPCR methylation (QuantStudio 3 text layout)

`6 MSRE-qPCR methylation - results.txt`: two normal and two tumour DNAs plus M.SssI-methylated DNA (SssI-DNA), each mock-digested and digested with HpaII, at the MGMT promoter, RASSF1A and a region without an HpaII site (noSite-ctrl). Choose MSRE-qPCR, set the region with no cut site to noSite-ctrl and the fully methylated set to SssI-DNA.

What's planted:
- The Tumour-2 mock digest for RASSF1A failed
- Tumour-1 RASSF1A comes out above 100%, because its digested wells came up earlier than the mock
- Normal-2 RASSF1A was cut completely (its digested wells are Undetermined)

The MGMT promoter comes out at about 75% methylated in Tumour-1 and about 5% in the normals.

## 7. ChIP-qPCR with biological replicates: WT vs KO

`7 ChIP-qPCR replicates WT vs KO - results.csv` (Bio-Rad CFX96 layout): H3K27ac ChIP from three WT and three KO chromatin preparations (WT-1, WT-2, WT-3, KO-1, KO-2, KO-3, in the Biological Set Name column) at the MYC promoter, a MYC enhancer and a gene desert (GAPDH-desert). Each chromatin has IP and 1% input in duplicate and one IgG well per region, plus an NTC per primer pair.

Drop the file, open Assay calculations, choose ChIP-qPCR, set the negative region to GAPDH-desert and click "Fill in … wells from sample names". Then, under "Comparing conditions", click "Fill in 6 conditions from set names" (WT-1 becomes WT, KO-2 becomes KO) and pick WT as the control condition.

What's planted:
- About 4% input at the MYC promoter in WT and about 1% in KO, with some spread between chromatin preparations. The Welch t-test on log2 % input is significant at the promoter after Benjamini–Hochberg.
- A smaller drop at the enhancer (about 2% to 1.4%)
- No difference at the gene desert (about 0.1% in both)

## 8. Pathway panel with gene set enrichment: TNF vs control

`8 Pathway panel 384 TNF vs control - results.csv` is a 96-assay pathway panel on a 384-well plate, laid out the way 384-well pathway arrays put four samples on one plate (each sample fills one quadrant: assay 1 in A1, A2, B1 and B2). There are 91 genes in ten pathways (NF-κB targets, interferon response, hypoxia, cell cycle, apoptosis, oxidative stress, Wnt, TGF-β, DNA damage and a few others) plus five reference genes: ACTB, B2M, GAPDH, HPRT1 and RPLP0. Two control samples (Ctrl-1, Ctrl-2) and two TNF-treated samples (TNF-1, TNF-2), with the group in the Group column. `8 Pathway panel gene sets.gmt` holds my own short lists for the ten pathways, in the GMT format MSigDB and Enrichr use.

Drop the results file, open Analysis, switch it on, tick the five reference genes and pick control as the control group. In the "Gene set enrichment" card, choose "A GMT file I upload" and pick the `.gmt` file.

What's planted:
- After TNF, the 12 NF-κB targets go up by 0.4 to 1.9 cycles, not all by the same amount. No single gene is convincing with two samples per group, but together they are: NFKB_TARGETS comes out on top with GSEA (91 genes, so the automatic choice is GSEA) and with the rank test, with all 12 genes in the leading edge.
- Two genes outside the pathway move on their own (MKI67 down, HMOX1 up), so the top of the gene list isn't simply the pathway.
- APOPTOSIS shares BIRC3 and TNFAIP3 with the NF-κB set and leans up a little because of them, without reaching significance.
- ALL_PANEL_SIGNALLING covers 89 of the 91 genes and is left out as too large; MTOR_AXIS_SMALL has only two genes on the panel and is left out as too small.
- The plate has no NTC wells, as pathway arrays usually don't, so the Review step flags a missing NTC for every target. With two samples per group the analysis also warns that the per-gene tests have little power, which is exactly the situation where looking at sets helps.

The files are made by `node testdata/make-gsea-sample.mjs`.
