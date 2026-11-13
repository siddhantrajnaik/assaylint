# Genes and RNA types

qPCR isn't only for mRNA. A run can measure miRNAs, lncRNAs, circRNAs, small nuclear and nucleolar RNAs, rRNA or genomic DNA, and each of these needs different controls and reference genes. So PlateCheck records, for each target in the run, what kind of RNA it is and which gene it is.

You'll find this under **More → Method details and thresholds**, in the **Targets** panel. It also appears in the report, in the run file and in the JSON export.

## What I guess from the name

For every target name in your file, PlateCheck suggests a gene symbol, an RNA type and a species. Nothing here uses the network.

**Symbol.** Common lab names are turned into the official symbol: `b-actin`, `beta actin` and `β-actin` become ACTB; `HPRT` becomes HPRT1; `IL-6` becomes IL6; `18S` becomes RNA18SN5 (the current HGNC symbol; older papers use RN18S1); `U6` becomes RNU6-1, `RNU6B` RNU6-2, `RNU44` SNORD44 and `RNU48` SNORD48. TaqMan assay IDs (`Hs01060665_g1`), bracketed notes and words like "primers" are dropped.

Mature miRNA names are turned into the gene they come from: `hsa-miR-21-5p`, `miR-21` and `mir21` become MIR21; `hsa-miR-199a-3p` becomes MIR199A; `let-7a` becomes MIRLET7A. Some mature miRNAs come from more than one gene (miR-16 from MIR16-1 and MIR16-2), so if the plain symbol doesn't exist the lookup also tries the first locus (MIR16-1). The panel says so when it does this.

**RNA type.** mRNA unless the name says otherwise:

| Type | Recognised from |
|---|---|
| miRNA | `MIR…`, `miR-…`, `let-7…`, with or without `hsa-`/`mmu-`/`rno-` |
| lncRNA | `LINC…`, `…-AS1`, `…-IT1`, `…-OT1`, `…-DT`, `SNHG…`, `MIR…HG`, and well-known names such as MALAT1, NEAT1, XIST, HOTAIR, H19, MEG3, GAS5, PVT1 |
| snoRNA / snRNA | `SNORD…`, `SNORA…`, `SCARNA…`, `RNU…`, `U6`, `7SK` |
| rRNA | `18S`, `28S`, `5.8S`, `RNA18SN…`, `RNA45SN…`, `MT-RNR1/2` |
| circRNA | `circ…`, `hsa_circ_…` |
| Genomic DNA / other | promoter, enhancer, intron, gDNA, Alu, GFP, luciferase, IgG, input, ERCC spike-ins, mitochondrial tRNAs (`MT-T…`) |

`MT-…` genes are marked as mitochondrial.

**Species.** Human unless the name says otherwise, and the panel tells you it assumed human. `hsa-`, `mmu-` and `rno-` prefixes and TaqMan IDs (`Hs…`, `Mm…`, `Rn…`) set the species. A name written like `Gapdh` gets a note that it looks like a mouse or rat symbol, but I don't change the species for you.

**Symbol check.** Human symbols are checked against HGNC style: upper-case letters, digits and hyphens, starting with a letter (`C1orf112`-style names are allowed). Mouse and rat symbols are expected in MGI/RGD style (`Actb`, `Mir21a`).

You can change the symbol, species and type of any target, or click **OK** (or **Confirm all**) if the guess is right. Every change goes into the run's history with your name.

## Looking genes up

The **Look up genes** button asks a public gene database for the Entrez Gene ID, Ensembl gene ID, HGNC ID (MGI or RGD for mouse and rat), the gene type and a one-line description.

- **What is sent:** only the gene symbols in the Symbol column, one per request, for example `ACTB` or `MIR21`, plus the species. Sample names, Ct values, well data, file names and file contents are never sent. Targets that aren't genes (GFP, IgG, a promoter region, circBase IDs) aren't sent at all, and anything that doesn't look like a gene symbol is refused before a request is made.
- **To whom:** [MyGene.info](https://mygene.info) (run by the Su and Wu labs at Scripps Research). If MyGene.info can't be reached and the gene is human, the same symbol goes to the [HGNC REST service](https://www.genenames.org/help/rest/) instead. Both allow requests straight from the browser, so there is no PlateCheck server in between. No cookies are sent with these requests.
- **When:** only when you press the button. Opening the page, importing a file or editing targets sends nothing.
- **What comes back** is saved with the run: symbol, IDs, gene name, the first sentence of the RefSeq summary (left out when it is the same text for a whole family, as for miRNAs), the database name and the date. It isn't asked for again unless you change the symbol or press the button when everything has already been looked up.

If a symbol isn't found, the panel says so; check the spelling or the species. If the database knows it under another name (HPRT is an old name for HPRT1), the official symbol is filled in and the panel tells you. If you're offline or both services are down, nothing is saved and you'll see the error.

The database's gene type doesn't overwrite an RNA type you've confirmed yourself; if they disagree, the panel shows what the database says.

## Notes by RNA type

The panel shows short notes for the RNA types in your run. In brief:

- **miRNA:** the RT step defines the assay (stem-loop RT primers per miRNA, or poly(A) tailing with an oligo-dT adaptor). Normalise to small RNAs that go through the same RT (U6/RNU6-1, RNU44/SNORD44, RNU48/SNORD48, other SNORDs) or a spike-in such as cel-miR-39, not to GAPDH or ACTB. Family members can cross-react.
- **lncRNA:** often nuclear, low and with few introns, so DNase treatment and a no-RT control for each assay matter. Check nuclear/cytoplasmic fractions with markers. Antisense transcripts overlap another gene.
- **circRNA:** divergent primers across the back-splice junction, RNase R to confirm. The lookup describes the host gene.
- **snoRNA / snRNA:** mostly used as miRNA references; same RT as the miRNAs, and check they're stable in your samples.
- **rRNA:** very abundant, absent from oligo-dT cDNA, made by a different polymerase than mRNA.
- **Mitochondrial genes:** no introns and nuclear copies (NUMTs), so DNase and no-RT controls matter.

## Limits

- The alias list covers common reference genes and lab nicknames, not every name in use. The database lookup catches many more (it searches aliases too).
- A mature miRNA's gene symbol names one locus; the qPCR assay can't tell loci apart when they give the same mature sequence.
- Species other than human, mouse and rat aren't looked up.
- The RNA type isn't used by the checks yet; it is recorded and reported so a reader knows what was measured.
