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
| miRNA | `MIR…`, `miR-…`, `let-7…`, with or without a miRBase species prefix (`hsa-`, `mmu-`, `dre-`, `cel-` …) |
| lncRNA | `LINC…`, `…-AS1`, `…-IT1`, `…-OT1`, `…-DT`, `SNHG…`, `MIR…HG`, and well-known names such as MALAT1, NEAT1, XIST, HOTAIR, H19, MEG3, GAS5, PVT1 |
| snoRNA / snRNA | `SNORD…`, `SNORA…`, `SCARNA…`, `RNU…`, `U6`, `7SK` |
| rRNA | `18S`, `28S`, `5.8S`, `RNA18SN…`, `RNA45SN…`, `MT-RNR1/2` |
| circRNA | `circ…`, `hsa_circ_…` |
| Genomic DNA / other | promoter, enhancer, intron, gDNA, Alu, GFP, luciferase, IgG, input, ERCC spike-ins, mitochondrial tRNAs (`MT-T…`) |

`MT-…` genes are marked as mitochondrial.

**Species.** Human unless the name says otherwise, and the panel tells you it assumed human. You can pick any of these:

| Species | NCBI taxonomy ID | Guessed from |
|---|---|---|
| Human | 9606 | `hsa-`, TaqMan `Hs…` |
| Mouse | 10090 | `mmu-`, TaqMan `Mm…` |
| Rat | 10116 | `rno-`, TaqMan `Rn…` |
| Zebrafish | 7955 | `dre-` |
| Fruit fly (*D. melanogaster*) | 7227 | `dme-`, FlyBase CG numbers (`CG1234`) |
| *C. elegans* | 6239 | `cel-` |
| Budding yeast (*S. cerevisiae* S288C) | 559292 | `sce-`, systematic names (`YFL039C`) |
| *Arabidopsis thaliana* | 3702 | `ath-`, AGI loci (`AT3G18780`) |
| Chicken | 9031 | `gga-` |
| Pig | 9823 | `ssc-` |
| Cow | 9913 | `bta-` |
| Dog | 9615 | `cfa-` |
| Rhesus macaque | 9544 | `mml-` |
| *Xenopus tropicalis* | 8364 | `xtr-` |
| Other | the ID you type | nothing |

I checked each taxonomy ID against MyGene.info in November 2026: a query for that species' actin gene with the ID as the species came back with the right gene (actb1, Act5C, act-1, ACT1, ACT2, ACTB, actb). Yeast is filed under the S288C reference strain (559292), not the species ID 4932, because that is where NCBI keeps the S. cerevisiae genes.

A species that comes from a prefix or an ID pattern is a guess, and the panel says so ("zebrafish, guessed from the "dre-" prefix"). Check it, then click **OK** to confirm or change it. `cel-miR-39` is usually a spike-in added to human or mouse samples; it is still a *C. elegans* sequence, so it is marked as *C. elegans*. A name written like `Gapdh` gets a note that it looks like a mouse or rat symbol, and an all-lower-case name with a digit (`sox10b`) gets a note that it looks like a zebrafish or Xenopus symbol, but I don't change the species for you.

For **Other**, type the NCBI taxonomy ID (digits only; look it up at https://www.ncbi.nlm.nih.gov/taxonomy). Without it the gene isn't looked up.

**Symbol check.** Each species has its own nomenclature, so the check follows it:

| Species | Style | Examples |
|---|---|---|
| Human, chicken, pig, cow, dog, rhesus macaque | HGNC style: upper-case letters, digits and hyphens (`C1orf112`-style names allowed) | ACTB, MIR21, MIRLET7A |
| Mouse, rat | MGI/RGD style: capital then lower case | Actb, Mir21a |
| Zebrafish, *Xenopus* | ZFIN and Xenbase: all lower case | actb1, sox10, mir21-1, mirlet7a-1 |
| *C. elegans* | a lower-case class, a hyphen and a number, or a sequence name; upper case is the protein | act-1, unc-54, mir-39, F53A9.10 |
| Yeast | standard name in upper case (lower case is a mutant allele), or the systematic name | ACT1, YFL039C |
| *Arabidopsis* | upper case (lower case is a mutant), or the AGI locus | ACT2, FLC, AT3G18780, MIR156a |
| Fruit fly | FlyBase symbols are case-sensitive in ways a pattern can't check, so any symbol is accepted | Act5C, w, dpp, CG1234, mir-1 |
| Other | not checked beyond the characters allowed in any symbol | |

The suggested symbol follows the same style: `SOX10` becomes sox10 for zebrafish, `ACT-1` becomes act-1 for a worm, `act1` becomes ACT1 for yeast. The list of lab nicknames (b-actin → ACTB and so on) is only applied to human-style species and to mouse and rat. For a fly, a worm, yeast or Arabidopsis the name is kept as written, because the human nicknames don't carry over.

miRNA gene symbols also differ, and I checked the patterns in MyGene.info: `dre-miR-21` becomes mir21 (and the lookup also tries mir21-1), `dme-miR-276a-3p` mir-276a, `cel-let-7` let-7, `ath-miR156` MIR156 (also tries MIR156a), `gga-miR-21-5p` MIR21.

You can change the symbol, species and type of any target, or click **OK** (or **Confirm all**) if the guess is right. Every change goes into the run's history with your name.

## Looking genes up

The **Look up genes** button asks a public gene database for the Entrez Gene ID, Ensembl gene ID, the species' own nomenclature ID (HGNC, MGI, RGD, ZFIN, FlyBase, WormBase, SGD, TAIR or Xenbase), the gene type and a one-line description. For fly, worm, yeast and Arabidopsis genes the "Ensembl" ID is the FlyBase, WormBase, SGD or TAIR ID, since Ensembl uses those.

Yeast systematic names and Arabidopsis loci are asked for as locus tags, so `YFL039C` comes back as ACT1 and `AT3G18780` as ACT2; the panel shows it the same way as an alias, and the locus is kept with the IDs.

- **What is sent:** only the gene symbols in the Symbol column, one per request, for example `ACTB` or `MIR21`, plus the species: `human`, `mouse` or `rat` by name, every other species by its NCBI taxonomy ID (for example `7955` for zebrafish). Sample names, Ct values, well data, file names and file contents are never sent. Targets that aren't genes (GFP, IgG, a promoter region, circBase IDs) aren't sent at all, and anything that doesn't look like a gene symbol is refused before a request is made.
- **To whom:** [MyGene.info](https://mygene.info) (run by the Su and Wu labs at Scripps Research). If MyGene.info can't be reached and the gene is human, the same symbol goes to the [HGNC REST service](https://www.genenames.org/help/rest/) instead. HGNC only names human genes, so for every other species there is no fallback and you'll see the error. Both allow requests straight from the browser, so there is no PlateCheck server in between. No cookies are sent with these requests.
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
- Fourteen species are named in the list; anything else needs its taxonomy ID typed in. A species guessed from a prefix or an ID pattern is only a guess.
- Fly symbols aren't checked, and the checks for the other species catch case mistakes, not misspellings. The lookup is the real check.
- MyGene.info coverage differs between species: RefSeq summaries (the one-line description) mostly exist for human and mouse, so for other species you'll usually get only the gene name.
- *Xenopus laevis* is not in the list. Its symbols carry .L and .S suffixes for the two subgenomes; use Other with taxonomy ID 8355 if you need it.
- The RNA type is used by three low-severity checks (a miRNA normalised to an mRNA reference or the other way round, miRNAs with no small-RNA reference on the plate, lncRNAs with no no-RT control). Where you haven't set a type, they use the guess from the name, and the finding says so. See [rules.md](rules.md) and [thresholds.md](thresholds.md#rna-type-notes).
