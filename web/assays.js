// PlateCheck assay types: the calculations behind ChIP-qPCR, MSRE-qPCR, 3C-qPCR, polysome profiling and the
// other experiments that read out by qPCR. Pure functions with no DOM access, shared by the web app, the report
// and the tests. The formulas and their sources are written up in docs/assays.md.
//
// How wells are labelled: PlateCheck's own roles (sample, NTC, positive, no-RT, standard, empty) stay as they are,
// so every existing check still runs on an IP or input well exactly as on any other sample. The assay labels are
// a second, separate layer kept in exp.assaySetup = { type, sourceSha, params, wells: { [rowId]: { role, set, fraction } } }.
// "set" ties wells of one chromatin / DNA / lysate together (IP, input and IgG from the same chromatin share a set).
import { ctNum, groupBy } from "./core.js";
import { cleanConditions, cleanStats, compareConditions, replicateReportHtml } from "./assay-stats.js";

// ---------------------------------------------------------------- references (checked against PubMed, Nov 2026)
export const REFS = {
  haring2007: { cite: "Haring M, Offermann S, Danker T, Horst I, Peterhansel C, Stam M. Chromatin immunoprecipitation: optimization, quantitative analysis and data normalization. Plant Methods 2007;3:11.", doi: "10.1186/1746-4811-3-11" },
  solomon2021: { cite: "Solomon ER, Caldwell KK, Allan AM. A novel method for the normalization of ChIP-qPCR data. MethodsX 2021;8:101504.", doi: "10.1016/j.mex.2021.101504" },
  mukhopadhyay2008: { cite: "Mukhopadhyay A, Deplancke B, Walhout AJM, Tissenbaum HA. Chromatin immunoprecipitation (ChIP) coupled to detection by quantitative real-time PCR to study transcription factor binding to DNA in Caenorhabditis elegans. Nat Protoc 2008;3:698–709.", doi: "10.1038/nprot.2008.38" },
  oakes2006: { cite: "Oakes CC, La Salle S, Robaire B, Trasler JM. Evaluation of a quantitative DNA methylation analysis technique using methylation-sensitive/dependent restriction enzymes and real-time PCR. Epigenetics 2006;1:146–152.", doi: "10.4161/epi.1.3.3392" },
  redshaw2014: { cite: "Redshaw N, Huggett JF, Taylor MS, Foy CA, Devonshire AS. Quantification of epigenetic biomarkers: an evaluation of established and emerging methods for DNA methylation analysis. BMC Genomics 2014;15:1174.", doi: "10.1186/1471-2164-15-1174" },
  eads2000: { cite: "Eads CA, Danenberg KD, Kawakami K, et al. MethyLight: a high-throughput assay to measure DNA methylation. Nucleic Acids Res 2000;28:e32.", doi: "10.1093/nar/28.8.e32" },
  campan2009: { cite: "Campan M, Weisenberger DJ, Trinh B, Laird PW. MethyLight. Methods Mol Biol 2009;507:325–337.", doi: "10.1007/978-1-59745-522-0_23" },
  weisenberger2005: { cite: "Weisenberger DJ, Campan M, Long TI, et al. Analysis of repetitive element DNA methylation by MethyLight. Nucleic Acids Res 2005;33:6823–6836.", doi: "10.1093/nar/gki987" },
  mcarthur2001: { cite: "McArthur M, Gerum S, Stamatoyannopoulos G. Quantification of DNaseI-sensitivity by real-time PCR: quantitative analysis of DNaseI-hypersensitivity of the mouse beta-globin LCR. J Mol Biol 2001;313:27–34.", doi: "10.1006/jmbi.2001.4969" },
  simon2012: { cite: "Simon JM, Giresi PG, Davis IJ, Lieb JD. Using formaldehyde-assisted isolation of regulatory elements (FAIRE) to isolate active regulatory DNA. Nat Protoc 2012;7:256–267.", doi: "10.1038/nprot.2011.444" },
  hagege2007: { cite: "Hagège H, Klous P, Braem C, et al. Quantitative analysis of chromosome conformation capture assays (3C-qPCR). Nat Protoc 2007;2:1722–1733.", doi: "10.1038/nprot.2007.243" },
  panda2017: { cite: "Panda AC, Martindale JL, Gorospe M. Polysome fractionation to analyze mRNA distribution profiles. Bio-protocol 2017;7:e2126.", doi: "10.21769/BioProtoc.2126" },
  gandin2014: { cite: "Gandin V, Sikström K, Alain T, et al. Polysome fractionation and analysis of mammalian translatomes on a genome-wide scale. J Vis Exp 2014;(87):51455.", doi: "10.3791/51455" },
  heiman2014: { cite: "Heiman M, Kulicke R, Fenster RJ, Greengard P, Heintz N. Cell type-specific mRNA purification by translating ribosome affinity purification (TRAP). Nat Protoc 2014;9:1282–1291.", doi: "10.1038/nprot.2014.085" },
  niemeyer2007: { cite: "Niemeyer CM, Adler M, Wacker R. Detecting antigens by quantitative immuno-PCR. Nat Protoc 2007;2:1918–1930.", doi: "10.1038/nprot.2007.267" },
  gullberg2004: { cite: "Gullberg M, Gústafsdóttir SM, Schallmeiner E, et al. Cytokine detection by antibody-based proximity ligation. Proc Natl Acad Sci USA 2004;101:8420–8424.", doi: "10.1073/pnas.0400552101" },
  lundberg2011: { cite: "Lundberg M, Eriksson A, Tran B, Assarsson E, Fredriksson S. Homogeneous antibody-based proximity extension assays provide sensitive and specific detection of low-abundant proteins in human blood. Nucleic Acids Res 2011;39:e102.", doi: "10.1093/nar/gkr424" },
  herzog2017: { cite: "Herzog VA, Reichholf B, Neumann T, et al. Thiol-linked alkylation of RNA to assess expression dynamics. Nat Methods 2017;14:1198–1204.", doi: "10.1038/nmeth.4435" },
  dolken2008: { cite: "Dölken L, Ruzsics Z, Rädle B, et al. High-resolution gene expression profiling for simultaneous kinetic parameter analysis of RNA synthesis and decay. RNA 2008;14:1959–1972.", doi: "10.1261/rna.1136108" },
  radle2013: { cite: "Rädle B, Rutkowski AJ, Ruzsics Z, Friedel CC, Koszinowski UH, Dölken L. Metabolic labeling of newly transcribed RNA for high resolution gene expression profiling of RNA synthesis, processing and decay in cell culture. J Vis Exp 2013;(78):50195.", doi: "10.3791/50195" },
  watson2021: { cite: "Watson MJ, Park Y, Thoreen CC. Roadblock-qPCR: a simple and inexpensive strategy for targeted measurements of mRNA stability. RNA 2021;27:335–342.", doi: "10.1261/rna.076885.120" },
  konig2010: { cite: "König J, Zarnack K, Rot G, et al. iCLIP reveals the function of hnRNP particles in splicing at individual nucleotide resolution. Nat Struct Mol Biol 2010;17:909–915.", doi: "10.1038/nsmb.1838" },
  assarsson2014: { cite: "Assarsson E, Lundberg M, Holmquist G, et al. Homogenous 96-plex PEA immunoassay exhibiting high sensitivity, specificity, and excellent scalability. PLoS One 2014;9:e95192.", doi: "10.1371/journal.pone.0095192" },
  olink2022: { cite: "Olink Proteomics. Data normalization and standardization. White paper 1096, v2.1, 2022-04-08 (Olink's own document, not peer reviewed).", doi: null, url: "https://olink.com/knowledge/documents" },
  zhang2012: { cite: "Zhang J, Markus J, Bies J, Paul T, Wolff L. Three murine leukemia virus integration regions within 100 kilobases upstream of c-myb are proximal to the 5' regulatory region of the gene through DNA looping. J Virol 2012;86:10524–10532.", doi: "10.1128/JVI.01077-12" },
  du2010: { cite: "Du P, Zhang X, Huang CC, et al. Comparison of Beta-value and M-value methods for quantifying methylation levels by microarray analysis. BMC Bioinformatics 2010;11:587.", doi: "10.1186/1471-2105-11-587" },
  armbruster2008: { cite: "Armbruster DA, Pry T. Limit of blank, limit of detection and limit of quantitation. Clin Biochem Rev 2008;29 Suppl 1:S49–S52.", doi: null, pmid: "18852857" },
};

// ---------------------------------------------------------------- well labels for assays
export const ASSAY_ROLES = ["ip", "input", "igg", "digested", "mock", "meth_ref", "test", "treated", "untreated", "library", "template", "fraction", "blank", "blocked", "unblocked", "ipc"];
export const ASSAY_ROLE_LABEL = {
  ip: "IP / pulldown", input: "Input", igg: "IgG / mock IP", digested: "Digested", mock: "Mock-digested",
  meth_ref: "Fully methylated reference", test: "Test sample", treated: "Treated / enriched", untreated: "Untreated / naked DNA",
  library: "3C library", template: "Control template (BAC)", fraction: "Fraction", blank: "Blank (no antigen)",
  blocked: "Thiol-treated (NEM)", unblocked: "Mock-treated", ipc: "Inter-plate control (IPC)",
};
export const ASSAY_ROLE_HELP = {
  ip: "DNA or RNA recovered with the specific antibody or probe.",
  input: "A saved portion of the starting chromatin or lysate, not immunoprecipitated.",
  igg: "Same procedure with a non-specific IgG, no antibody or beads only. Measures background.",
  digested: "DNA cut with the restriction enzyme.",
  mock: "The same DNA taken through the digestion without enzyme.",
  meth_ref: "DNA methylated in vitro (for example with M.SssI), used as the 100% reference.",
  test: "A sample being measured.",
  treated: "Nuclease-digested chromatin (DNase, MNase), a FAIRE extract or an ATAC library.",
  untreated: "Undigested chromatin, total input or naked genomic DNA from the same cells.",
  library: "The 3C ligation product from your cells.",
  template: "BAC or PAC DNA cut and religated so every ligation product is present at equal amounts.",
  fraction: "One fraction of the gradient (give it a number), or a bound / unbound fraction.",
  blank: "A reaction with no antigen (buffer only). Defines the background.",
  blocked: "Total RNA from 4sU-labelled (or unlabelled control) cells, treated with a thiol-reactive compound such as N-ethylmaleimide that stops reverse transcription at 4sU.",
  unblocked: "The same RNA taken through the treatment without the compound.",
  ipc: "The inter-plate control run as a sample (Olink runs it in triplicate). Its median per assay is taken off every sample.",
};

// ---------------------------------------------------------------- calculation families
const P = {
  inputPercent: { key: "inputPercent", label: "Input saved, as % of the chromatin in one IP", type: "number", def: 1, step: 0.5,
    hint: "1 if you kept 10 µl of input for every 1 ml going into an IP. Used as dilution factor = 100 / this number." },
  inputBasis: { key: "inputBasis", label: "How much IP and input DNA went into each qPCR well", type: "select", def: "volume",
    options: [["volume", "The same volume of IP and input DNA, eluted in the same volume (the usual way)"], ["amount", "A measured amount (ng) per well: correct with the DNA recovered in each IP and input (Solomon et al. 2021)"]],
    hint: "With measured amounts, enter for each set the total ng of DNA recovered in the IP and in the input, and the ng loaded per well. Leave this on the usual way if you loaded equal volumes." },
  negTarget: { key: "negTarget", label: "Negative control region (optional)", type: "target", def: "", hint: "A region your protein or mark shouldn't bind. Each region is also shown as fold over this one." },
  enzyme: { key: "enzyme", label: "Enzyme type", type: "select", def: "sensitive",
    options: [["sensitive", "Methylation-sensitive (HpaII, HhaI, AciI): cuts unmethylated DNA"], ["dependent", "Methylation-dependent (McrBC, FspEI): cuts methylated DNA"]] },
  noSiteTarget: { key: "noSiteTarget", label: "Region with no cut site (optional)", type: "target", def: "", hint: "Corrects for DNA lost in the digestion: its digested − mock ΔCt is subtracted." },
  calibratorSet: { key: "calibratorSet", label: "Fully methylated DNA set (optional)", type: "set", def: "", hint: "Digested and mock wells of DNA methylated in vitro. Results are scaled to it (ΔΔCt)." },
  controlTargetPmr: { key: "controlTarget", label: "Methylation-independent control reaction", type: "target", def: "", required: true, hint: "For example ALU-C4 or ACTB." },
  direction: { key: "direction", label: "What the treated sample is", type: "select", def: "loss",
    options: [["loss", "Digested chromatin: open DNA is lost (DNase or MNase sensitivity)"], ["enrichment", "Enriched DNA: open DNA is kept (FAIRE, ATAC, MNase-protected)"]] },
  closedTarget: { key: "closedTarget", label: "Closed control region", type: "target", def: "", required: true, hint: "A region that is inaccessible in these cells, for example a silent gene desert." },
  loadingTarget: { key: "loadingTarget", label: "Loading control primers", type: "target", def: "", required: true, hint: "Primers inside one restriction fragment (no ligation junction), for example in Gapdh." },
  controlTarget3c: { key: "controlTarget", label: "Control interaction (optional)", type: "target", def: "", hint: "For example the Ercc3 locus. Each interaction is divided by this one." },
  spikeTarget: { key: "spikeTarget", label: "Spike-in RNA (optional)", type: "target", def: "", hint: "An RNA added in equal amount to every fraction. Each fraction's Ct is taken relative to it." },
  polysomeFrom: { key: "polysomeFrom", label: "Polysome fractions start at fraction (optional)", type: "number", def: "", step: 1, hint: "Adds up the share of the RNA in this fraction and later ones." },
  sdMultiplier: { key: "sdMultiplier", label: "Limit of detection: blank mean minus this many SD", type: "number", def: 3, step: 0.5 },
  readout: { key: "readout", label: "How the labelled RNA is read out", type: "select", def: "block",
    options: [["block", "Chemistry on total RNA that stops RT at 4sU (Roadblock-qPCR, NEM): treated vs mock"], ["pulldown", "Biotin pulldown of the 4sU RNA (4sU-tagging): pulldown vs total"]] },
  backgroundSet: { key: "backgroundSet", label: "No-4sU control cells (set, optional)", type: "set", def: "",
    hint: "Cells grown without 4sU and taken through the same steps. Their signal is the background and is taken off every other set." },
  totalPercent: { key: "totalPercent", label: "Total RNA kept, as % of the RNA going into one pulldown", type: "number", def: 10, step: 1,
    hint: "Used only for the pulldown readout, like the input % in ChIP." },
  npxInput: { key: "npxInput", label: "What the Ct column holds", type: "select", def: "ct",
    options: [["ct", "Ct values: work out NPX from the extension control and the inter-plate control"], ["npx", "NPX values already (from Olink software or a service): use them as they are"]] },
  extTarget: { key: "extTarget", label: "Extension control (assay name)", type: "target", def: "", hint: "Measured in every sample. Each assay's Ct is taken relative to it (ΔCt). Needed for Ct values." },
  ic2Target: { key: "ic2Target", label: "Incubation control 2 (optional)", type: "target", def: "", hint: "Used for sample QC: a sample more than 0.3 NPX from the plate median is flagged." },
  ic1Target: { key: "ic1Target", label: "Incubation control 1 (optional)", type: "target", def: "", hint: "Shown with the controls; not part of the sample QC rule." },
  detTarget: { key: "detTarget", label: "Detection control (optional)", type: "target", def: "", hint: "Used for sample QC like incubation control 2." },
  correctionFactor: { key: "correctionFactor", label: "Correction factor (optional)", type: "number", def: 0, step: 0.1,
    hint: "Olink sets one per assay during panel validation so that background sits near 0 NPX. Without it NPX is relative to the inter-plate control; differences between samples don't change." },
  npxSd: { key: "npxSd", label: "Limit of detection: negative-control mean plus this many SD", type: "number", def: 3, step: 0.5 },
  maxCycles: { key: "maxCycles", label: "Cycles run (used when the blank never comes up)", type: "number", def: 40, step: 1 },
};
export const FAMILIES = {
  enrichment: { name: "% input and fold enrichment", roles: ["ip", "input", "igg"], params: [P.inputPercent, P.inputBasis, P.negTarget],
    formula: ["Adjusted input Ct = Ct(input) − log_E(DF), DF = 100 / input %",
      "Equal ng per well instead of equal volume (Solomon 2021): DF = (100 / input %) × (input DNA recovered / ng per input well) ÷ (IP DNA recovered / ng per IP well)", "% input = 100 × E^(adjusted input Ct − Ct(IP))", "Fold over IgG = E^(Ct(IgG) − Ct(IP))", "Fold over negative region = % input(region) / % input(negative region)"],
    refs: ["haring2007", "solomon2021", "mukhopadhyay2008"] },
  msre: { name: "% methylation from digested vs mock", roles: ["digested", "mock"], params: [P.enzyme, P.noSiteTarget, P.calibratorSet],
    formula: ["ΔCt = Ct(digested) − Ct(mock)", "Methylation-sensitive enzyme: % methylated = 100 × E^(−ΔCt)", "Methylation-dependent enzyme: % methylated = 100 × (1 − E^(−ΔCt))", "With a fully methylated control: ΔCt is replaced by ΔCt(sample) − ΔCt(control)"],
    refs: ["oakes2006", "redshaw2014"] },
  pmr: { name: "Percent of methylated reference (PMR)", roles: ["test", "meth_ref"], params: [P.controlTargetPmr],
    formula: ["ΔCt = Ct(methylation reaction) − Ct(control reaction), in the same DNA", "PMR = 100 × E^−(ΔCt(sample) − ΔCt(fully methylated reference))",
      "With a dilution series of the reference (Standard wells) for both reactions: Q = 10^((Ct − intercept) / slope); PMR = 100 × [Q(gene) / Q(control)] sample ÷ [Q(gene) / Q(control)] reference"],
    refs: ["eads2000", "campan2009", "weisenberger2005"] },
  accessibility: { name: "Accessibility relative to a closed region", roles: ["treated", "untreated"], params: [P.direction, P.closedTarget],
    formula: ["d = Ct(treated) − Ct(untreated), for the region and for the closed control region", "Digested chromatin: accessibility = E^(d(region) − d(closed)) (how much more the region was lost)", "Enriched DNA: enrichment = E^(d(closed) − d(region))", "% left after digestion = 100 × E^(−d)"],
    refs: ["mcarthur2001", "simon2012"] },
  threec: { name: "Relative crosslinking frequency", roles: ["library", "template"], params: [P.loadingTarget, P.controlTarget3c],
    formula: ["With a template dilution series (Standard wells) for the pair: signal = 10^((Ct(3C library) − intercept) / slope)",
      "Otherwise one template level: signal = E^−(Ct(3C library) − Ct(control template)), per primer pair", "Loading-corrected = signal × E^(Ct(loading, this sample) − mean Ct(loading, all samples))", "Relative to the control interaction = loading-corrected / loading-corrected(control pair)"],
    refs: ["hagege2007", "zhang2012"] },
  fractions: { name: "Distribution across fractions", roles: ["fraction"], params: [P.spikeTarget, P.polysomeFrom],
    formula: ["Relative amount in fraction i = E^−(Ct_i − lowest Ct) (with a spike-in: Ct_i − Ct(spike-in)_i)", "% of total in fraction i = 100 × relative_i / sum of relative over all fractions"],
    refs: ["panda2017", "gandin2014", "heiman2014"] },
  labelling: { name: "New RNA after 4sU labelling", roles: ["blocked", "unblocked", "ip", "input"], params: [P.readout, P.backgroundSet, P.totalPercent],
    formula: ["Treated vs mock (RT stopped at 4sU): d = Ct(treated) − Ct(mock), per set and RNA",
      "With no-4sU control cells: d is replaced by d − d(no-4sU)",
      "% still unlabelled (made before the label) = 100 × E^(−d); % new = 100 − that",
      "Pulldown vs total: % in pulldown = total % × E^(Ct(total) − Ct(pulldown))",
      "With no-4sU control cells: background-corrected % = % in pulldown − % in the no-4sU pulldown; over background = ratio of the two"],
    refs: ["watson2021", "dolken2008", "radle2013", "herzog2017"] },
  signal: { name: "Signal over blank and limit of detection", roles: ["test", "blank"], params: [P.sdMultiplier, P.maxCycles],
    formula: ["ΔCt = mean Ct(blank) − Ct(sample)", "Fold over blank = E^ΔCt", "Limit of detection (as a Ct) = mean Ct(blank) − k × SD(blank); a sample is above it if its Ct is lower"],
    refs: ["niemeyer2007", "lundberg2011", "armbruster2008"] },
  npx: { name: "PEA in NPX (Olink-style normalisation)", roles: ["test", "blank", "ipc"], params: [P.npxInput, P.extTarget, P.ic2Target, P.ic1Target, P.detTarget, P.correctionFactor, P.npxSd],
    formula: ["ΔCt = Ct(assay) − Ct(extension control), in the same sample", "ΔΔCt = ΔCt − median ΔCt of the inter-plate controls, per assay",
      "NPX = correction factor − ΔΔCt (log2 scale; higher means more protein)", "LOD per assay = mean NPX of the negative controls + k × SD (k = 3)",
      "Sample QC: incubation control 2 or detection control more than 0.3 NPX from the plate median"],
    refs: ["assarsson2014", "olink2022"] },
};

// The experiments, each mapped to one calculation. `defaults` override the family defaults.
export const ASSAYS = [
  { id: "chip", name: "ChIP-qPCR", family: "enrichment", covers: ["ChIP"], require: ["ip", "input"], note: "IgG or no-antibody control recommended for every primer pair." },
  { id: "cutrun", name: "CUT&RUN / CUT&Tag-qPCR", family: "enrichment", covers: ["CUT&RUN", "CUT&Tag"], require: ["ip"], note: "There is usually no input. Compare with IgG and a negative region; add input wells if you kept some." },
  { id: "rip", name: "RIP / CLIP / iCLIP / eCLIP / ChIRP / RAP / CHART-qPCR", family: "enrichment", covers: ["RIP", "IP", "CLIP", "iCLIP", "eCLIP", "ChIRP", "RAP", "CHART"], require: ["ip", "input"], note: "For RNA, the input and IP must go through the same reverse transcription." },
  { id: "medip", name: "MeDIP / hMeDIP / MBD-qPCR", family: "enrichment", covers: ["MeDIP", "hMeDIP", "MBD"], require: ["ip", "input"] },
  { id: "merip", name: "MeRIP / m6A / acRIP-qPCR", family: "enrichment", covers: ["MeRIP", "m6A-RIP", "acRIP"], require: ["ip", "input"] },
  { id: "capture", name: "Nascent RNA capture (EU)-qPCR", family: "enrichment", covers: ["EU-RNA capture"], require: ["ip", "input"], note: "Use the unlabelled-cell pulldown as the IgG / mock. For 4sU labelling, use the 4sU labelling entries instead." },
  { id: "msre", name: "MSRE-qPCR", family: "msre", covers: ["MSRE-qPCR", "MDRE-qPCR"], require: ["digested", "mock"] },
  { id: "methylight", name: "MethyLight / MS-qPCR (PMR)", family: "pmr", covers: ["MethyLight", "MS-qPCR"], require: ["test", "meth_ref"] },
  { id: "dnase", name: "DNase-qPCR", family: "accessibility", covers: ["DNase I sensitivity"], require: ["treated", "untreated"], defaults: { direction: "loss" } },
  { id: "mnase", name: "MNase-qPCR", family: "accessibility", covers: ["MNase sensitivity", "MNase protection"], require: ["treated", "untreated"], defaults: { direction: "loss" }, note: "Pick “Enriched DNA” if you measured MNase-protected (mononucleosomal) DNA." },
  { id: "atac", name: "ATAC-qPCR", family: "accessibility", covers: ["ATAC"], require: ["treated", "untreated"], defaults: { direction: "enrichment" }, note: "Untreated = tagmented naked genomic DNA, or total DNA from the same cells." },
  { id: "faire", name: "FAIRE-qPCR", family: "accessibility", covers: ["FAIRE"], require: ["treated", "untreated"], defaults: { direction: "enrichment" }, note: "Untreated = the reverse-crosslinked total DNA from the same chromatin." },
  { id: "threec", name: "3C-qPCR", family: "threec", covers: ["3C"], require: ["library", "template"] },
  { id: "polysome", name: "Polysome profiling + RT-qPCR", family: "fractions", covers: ["Polysome profiling"], require: ["fraction"] },
  { id: "trap", name: "TRAP-qPCR (bound vs unbound)", family: "fractions", covers: ["TRAP"], require: ["fraction"], note: "Label the bound and unbound fractions as fractions named “bound” and “unbound”." },
  { id: "slam", name: "4sU labelling, treated vs mock (Roadblock-qPCR, “SLAM-qPCR”)", family: "labelling", covers: ["4sU metabolic labelling", "Roadblock-qPCR", "SLAM-type chemistry read by qPCR"],
    require: ["blocked", "unblocked"], defaults: { readout: "block" },
    note: "The SLAM-seq chemistry (iodoacetamide) changes the base read at 4sU but doesn't stop reverse transcription, so ordinary qPCR can't see it. The qPCR-readable version uses a compound such as N-ethylmaleimide that blocks reverse transcription at 4sU." },
  { id: "foursu", name: "4sU labelling, biotin pulldown vs total (4sU-tagging)", family: "labelling", covers: ["4sU-tagging", "4sU pulldown"], require: ["ip", "input"], defaults: { readout: "pulldown" },
    note: "Label the streptavidin pulldown as IP / pulldown and the total RNA as Input." },
  { id: "ipcr", name: "Immuno-PCR", family: "signal", covers: ["immuno-PCR"], require: ["test", "blank"] },
  { id: "pla", name: "PLA-qPCR", family: "signal", covers: ["Proximity ligation assay"], require: ["test", "blank"] },
  { id: "pea", name: "PEA-qPCR", family: "signal", covers: ["Proximity extension assay"], require: ["test", "blank"] },
  { id: "olink", name: "PEA with NPX (Olink-style)", family: "npx", covers: ["Proximity extension assay, NPX", "Olink Target 96/48 (qPCR read-out)"], require: ["test"],
    note: "Label the negative controls (buffer) as Blank and the inter-plate controls as IPC. For Ct values, choose the extension control assay. This follows Olink's published normalisation; it doesn't replace Olink's software or their per-assay correction factors." },
];
export const assayById = id => ASSAYS.find(a => a.id === id) || null;

// ---------------------------------------------------------------- the saved setup
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const str = v => (typeof v === "string" ? v.slice(0, 200) : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
// PCR efficiency per primer pair, kept in exp.assaySetup.eff = { [target]: "curve" | percent }. Missing means 100%.
export const EFF_MIN = 50, EFF_MAX = 150; // a typed value outside this is refused; 90–110% is the usual acceptance range
const cleanEff = v => (v === "curve" ? "curve" : typeof v === "number" && Number.isFinite(v) && v >= EFF_MIN && v <= EFF_MAX ? v : null);
export const DNA_FIELDS = ["ip", "input", "igg", "ipWell", "inputWell", "iggWell"];
// Sets a key safely even when a target is literally called "__proto__".
const putKey = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
// Cleans exp.assaySetup (it may be missing, from an older version, or edited by hand). Never throws.
export function normalizeAssaySetup(x) {
  const out = { type: "", sourceSha: "", params: {}, wells: {} };
  if (!isObj(x)) return out;
  if (isObj(x.eff)) {
    const eff = {};
    for (const [t, v] of Object.entries(x.eff).slice(0, 500)) if (t && t.length <= 200 && cleanEff(v) !== null) putKey(eff, t, cleanEff(v));
    if (Object.keys(eff).length) out.eff = eff;
  }
  // Conditions per set and the settings for comparing them (statistics across biological replicates, assay-stats.js).
  const cond = cleanConditions(x.cond);
  if (Object.keys(cond).length) out.cond = cond;
  if (isObj(x.stats)) out.stats = cleanStats(x.stats);
  // DNA amounts per set for % input by amount: { [set]: { ip, input, igg, ipWell, inputWell, iggWell } } in ng.
  if (isObj(x.dna)) {
    const dna = {};
    for (const [k, v] of Object.entries(x.dna).slice(0, 1000)) {
      if (!k || k.length > 200 || !isObj(v)) continue;
      const e = {};
      for (const f of DNA_FIELDS) if (typeof v[f] === "number" && Number.isFinite(v[f]) && v[f] > 0) e[f] = v[f];
      if (Object.keys(e).length) putKey(dna, k, e);
    }
    if (Object.keys(dna).length) out.dna = dna;
  }
  out.type = assayById(x.type) ? x.type : "";
  out.sourceSha = str(x.sourceSha);
  if (isObj(x.params)) for (const [k, v] of Object.entries(x.params)) {
    if (typeof v === "number" && Number.isFinite(v)) out.params[k] = v;
    else if (typeof v === "string") out.params[k] = v.slice(0, 200);
  }
  if (isObj(x.wells)) for (const [id, w] of Object.entries(x.wells)) {
    if (!isObj(w) || !ASSAY_ROLES.includes(w.role)) continue;
    out.wells[id] = { role: w.role, set: str(w.set), fraction: str(w.fraction) };
  }
  return out;
}
// The efficiency used for each target: what the user chose, or 100% (E = 2). "curve" takes the efficiency of the
// standard curve that core.analyze() fitted for that target on this plate (res.stdCurves); without one it stays 100%.
export function efficiencies(setup, stdCurves, targetNames) {
  const curves = new Map((Array.isArray(stdCurves) ? stdCurves : []).filter(c => c && fin(c.efficiency)).map(c => [c.target, c]));
  const chosen = isObj(setup?.eff) ? setup.eff : {};
  const out = new Map();
  for (const t of targetNames) {
    const v = Object.prototype.hasOwnProperty.call(chosen, t) ? chosen[t] : null, c = curves.get(t);
    let pct = 100, source = "assumed", note = "";
    if (v === "curve" && c && c.efficiency > -100) { pct = c.efficiency; source = "curve"; note = `slope ${c.slope.toFixed(3)}, R² ${c.r2.toFixed(3)}, ${c.levels} levels`; }
    else if (v === "curve") { source = "missing"; note = "no standard curve for this target on the plate"; }
    else if (typeof v === "number") { pct = v; source = "typed"; }
    out.set(t, { target: t, pct, E: 1 + pct / 100, source, note, curve: c ? c.efficiency : null });
  }
  return out;
}
export const effLabel = e => !e ? "100% (assumed)" : `${fmtNum(e.pct, 1)}% (${{ assumed: "assumed", curve: "standard curve", typed: "typed in", missing: "assumed: no standard curve" }[e.source]})`;

// Parameters with the assay's and family's defaults filled in.
export function assayParams(setup) {
  const a = assayById(setup?.type);
  if (!a) return {};
  const out = {};
  for (const p of FAMILIES[a.family].params) out[p.key] = p.def;
  Object.assign(out, a.defaults || {});
  for (const [k, v] of Object.entries(setup.params || {})) if (k in out && v !== "" && v != null) out[k] = v;
  return out;
}

// Suggests an assay label from a sample name, so a well-named plate needs only a click. Returns null when unsure.
const has = (s, re) => re.test(s);
export function guessAssayRole(sample, family) {
  const s = String(sample ?? "").trim();
  if (!s) return null;
  if (/^(ntc|water|h2o|no[\s_-]?template)$/i.test(s)) return null;
  switch (family) {
    case "enrichment":
      if (has(s, /\binput\b|\binp\b|\btotal\b/i)) return { role: "input" };
      if (has(s, /\big[gG]\b|\bmock\b|no[\s_-]?ab\b|no[\s_-]?antibody|pre-?immune|beads?[\s_-]?only|\bunlabel+ed\b/i)) return { role: "igg" };
      return { role: "ip" };
    case "msre":
      if (has(s, /\bmock\b|\buncut\b|\bundigested\b|no[\s_-]?enzyme|\bminus\b/i)) return { role: "mock" };
      if (has(s, /digest|\bcut\b|hpaii|hhai|aci|mcrbc|fspei|msre|mdre/i)) return { role: "digested" };
      return null;
    case "pmr":
      return has(s, /sssi|fully[\s_-]?methylated|meth(ylated)?[\s_-]?(ref|control|std)|\bivd\b|100\s*%/i) ? { role: "meth_ref" } : { role: "test" };
    case "accessibility":
      if (has(s, /undigested|\bnaked\b|untreated|no[\s_-]?(dnase|mnase|enzyme|tn5)|\btotal\b|\binput\b|\bgdna\b|genomic/i)) return { role: "untreated" };
      return { role: "treated" };
    case "threec":
      return has(s, /\bbac\b|\bpac\b|control[\s_-]?template|\btemplate\b/i) ? { role: "template" } : { role: "library" };
    case "fractions": {
      const m = /(?:^|[\s_-])(?:fr(?:action)?|f)[\s_.#-]*(\d{1,2})\b/i.exec(s) || /^(\d{1,2})$/.exec(s);
      if (m) return { role: "fraction", fraction: String(Number(m[1])) };
      const b = /\b(unbound|bound|flow[\s_-]?through|supernatant)\b/i.exec(s);
      return b ? { role: "fraction", fraction: b[1].toLowerCase() } : null;
    }
    case "labelling":
      if (has(s, /\binput\b|\btotal\b/i)) return { role: "input" };
      if (has(s, /pull[\s_-]?down|\bbiotin|streptavidin|\bpd\b|\bnew\b|\beluate\b/i)) return { role: "ip" };
      if (has(s, /\bmock\b|no[\s_-]?(nem|iaa|chem)|untreated|\bdmso\b|\bminus\b/i)) return { role: "unblocked" };
      if (has(s, /\bnem\b|ethylmaleimide|\biaa\b|treated|\balkyl/i)) return { role: "blocked" };
      return null;
    case "npx":
      if (has(s, /\bipc\b|inter[\s_-]?plate/i)) return { role: "ipc" };
      return has(s, /\bblank\b|\bbuffer\b|\bneg(ative)?\b|\bnc\b/i) ? { role: "blank" } : { role: "test" };
    case "signal":
      return has(s, /\bblank\b|\bbuffer\b|no[\s_-]?antigen|\bzero\b|\bbackground\b|\bneg(ative)?\b/i) ? { role: "blank" } : { role: "test" };
    default: return null;
  }
}
// The default set for a well: its group if it has one, otherwise the sample name with the role words taken out
// ("WT input" and "WT IP" both become "WT").
const ROLE_WORDS = /\b(input|inp|total|igg|mock|no[\s_-]?ab|ip|chip|digested|undigested|uncut|cut|hpaii|hhai|acii?|mcrbc|fspei|blank|fraction|fr|bac|template|library|treated|untreated|naked|nem|iaa|pull[\s_-]?down|biotin|eluate)\b/gi;
export function defaultSet(row) {
  if (row.group) return String(row.group).trim();
  const s = String(row.sample ?? "").replace(ROLE_WORDS, " ").replace(/\s+/g, " ").replace(/^[\s_-]+|[\s_-]+$/g, "");
  return s || String(row.sample ?? "").trim();
}
export function guessLabels(rows, family) {
  const out = {};
  for (const r of rows) {
    if (r.role === "ntc" || r.role === "empty") continue;
    const g = guessAssayRole(r.sample, family);
    if (g && FAMILIES[family].roles.includes(g.role)) out[r.id] = { role: g.role, set: defaultSet(r), fraction: g.fraction || "" };
  }
  return out;
}

// ---------------------------------------------------------------- labelled wells and replicate means
// Rows from core.effectiveRows with their assay label. NTC and empty wells never take part.
export function labelRows(rows, setup) {
  const wells = setup?.wells || {};
  return rows.filter(r => wells[r.id] && r.role !== "ntc" && r.role !== "empty").map(r => {
    const w = wells[r.id];
    return { ...r, arole: w.role, aset: w.set || defaultSet(r), afraction: w.fraction || "", ctv: ctNum(r.ct, r.dc) };
  });
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const sdOf = xs => { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); };
// Technical replicates are averaged as Ct values (the same as PlateCheck's replicate table: every numeric well, nothing dropped).
export function replicate(rs) {
  const vals = rs.map(r => r.ctv).filter(x => x !== null);
  return { n: rs.length, nNum: vals.length, mean: vals.length ? mean(vals) : null, sd: sdOf(vals), wells: rs.map(r => r.key || r.well), raw: rs.map(r => r.ct) };
}
const fin = x => typeof x === "number" && Number.isFinite(x);
// E^x for an amplification factor E (2 = 100% efficiency). Every Ct difference in this file becomes a ratio this way.
const powE = (E, x) => (fin(x) && fin(E) ? E ** x : null);
export const fmtNum = (x, d = 2) => (fin(x) ? (Math.abs(x) >= 1e5 ? x.toExponential(2) : x.toFixed(d)) : "—");

// Collects replicate groups and their warnings: wide spread, undetermined or late wells.
function makeGroups(lr, opts, keyFn, warn) {
  const groups = new Map();
  for (const [k, rs] of groupBy(lr, keyFn)) {
    const g = replicate(rs);
    groups.set(k, g);
    const what = describe(rs[0]);
    if (g.sd !== null && g.sd > opts.sdThreshold) warn("medium", `${what}: technical replicates spread SD ${g.sd.toFixed(2)} cycles (threshold ${opts.sdThreshold}).`, g.wells);
    if (g.nNum && g.nNum < g.n) warn("low", `${what}: ${g.n - g.nNum} of ${g.n} wells have no Ct, so the mean uses ${g.nNum}.`, g.wells);
    if (g.mean !== null && g.mean > opts.lateCt && !["igg", "blank", "digested"].includes(rs[0].arole))
      warn("low", `${what}: mean Ct ${g.mean.toFixed(1)} is late (above ${opts.lateCt}), close to the detection limit.`, g.wells);
  }
  return groups;
}
const describe = r => [r.aset, ASSAY_ROLE_LABEL[r.arole], r.target, r.afraction && `fraction ${r.afraction}`].filter(Boolean).join(" / ");
const sets = lr => [...new Set(lr.map(r => r.aset))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const targets = lr => [...new Set(lr.map(r => r.target).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const DEFAULT_OPTS = { sdThreshold: 0.3, lateCt: 35 };

// ---------------------------------------------------------------- (a) % input and fold enrichment
export function calcEnrichment(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const pct = Number(params.inputPercent);
  const dfOk = fin(pct) && pct > 0 && pct <= 100;
  if (!dfOk) warn("high", `Input % must be a number above 0 and up to 100 (it is “${params.inputPercent}”), so % input wasn't worked out.`);
  const lnDf = dfOk ? Math.log(100 / pct) : null; // the input Ct comes down by log_E(100 / input %)
  // Solomon et al. 2021: when a fixed amount (ng) of IP and input DNA goes into each well instead of a fixed volume,
  // the dilution factor for that set becomes DFa = DFv × (input recovered / input ng per well) ÷ (IP recovered / IP ng per well).
  // Their paper loads the same ng of both, so the per-well amounts cancel; I keep them so unequal loading works too.
  const byAmount = params.inputBasis === "amount", dna = opts.dna || {};
  const amountLn = (s, role) => {
    const d = Object.prototype.hasOwnProperty.call(dna, s) ? dna[s] : {}, well = d[`${role}Well`] ?? d.ipWell ?? d.inputWell;
    const wellIn = d.inputWell ?? d.ipWell;
    if (!(d[role] > 0 && d.input > 0 && well > 0 && wellIn > 0)) return null;
    return Math.log((d.input / wellIn) / (d[role] / well)); // log of (DFa / DFv)
  };
  if (byAmount) for (const s of sets(lr)) if (amountLn(s, "ip") === null && lr.some(r => r.aset === s && r.arole === "ip")) warn("high", `${s}: % input by DNA amount needs the ng of DNA recovered in the IP and in the input (and the ng per well), so % input wasn't worked out for this set.`);
  const G = makeGroups(lr, opts, r => `${r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const get = (s, role, t) => G.get(`${s}\u0000${role}\u0000${t}`);
  const out = [];
  for (const s of sets(lr)) for (const t of targets(lr.filter(r => r.aset === s))) {
    const ip = get(s, "ip", t), inp = get(s, "input", t), igg = get(s, "igg", t);
    const row = { set: s, target: t, ctIP: ip?.mean ?? null, ctInput: inp?.mean ?? null, ctIgG: igg?.mean ?? null,
      adjInput: null, pctInput: null, pctInputIgG: null, foldIgG: null, foldNeg: null, wells: [ip, inp, igg].filter(Boolean).flatMap(g => g.wells) };
    const at = `${s} / ${t}`;
    if (!ip) warn("medium", `${at}: no IP wells, so there's nothing to compare.`, row.wells);
    else if (ip.mean === null) warn("high", `${at}: the IP did not amplify in any well (${ip.raw.map(x => x ?? "empty").join(", ")}). No enrichment can be worked out.`, ip.wells);
    if (!inp && ip) warn("medium", `${at}: no input wells, so % input can't be worked out.`, ip.wells);
    else if (inp && inp.mean === null) warn("high", `${at}: the input did not amplify, so % input can't be worked out. Check the input DNA and the primers.`, inp.wells);
    if (dfOk && inp?.mean != null && !byAmount) {
      row.adjInput = inp.mean - lnDf / Math.log(E(t));
      if (ip?.mean != null) row.pctInput = 100 * powE(E(t), row.adjInput - ip.mean);
      if (igg?.mean != null) row.pctInputIgG = 100 * powE(E(t), row.adjInput - igg.mean);
    } else if (dfOk && inp?.mean != null) {
      const a = amountLn(s, "ip"), g = amountLn(s, "igg");
      if (a !== null) {
        row.adjInput = inp.mean - (lnDf + a) / Math.log(E(t));
        if (ip?.mean != null) row.pctInput = 100 * powE(E(t), row.adjInput - ip.mean);
      }
      if (g !== null && igg?.mean != null) row.pctInputIgG = 100 * powE(E(t), inp.mean - (lnDf + g) / Math.log(E(t)) - igg.mean);
      else if (igg?.mean != null) row.note = "IgG % input needs the IgG DNA recovered";
    }
    if (ip?.mean != null && igg?.mean != null) {
      row.foldIgG = powE(E(t), igg.mean - ip.mean);
      if (igg.mean <= ip.mean) warn("high", `${at}: IgG comes up at Ct ${igg.mean.toFixed(2)}, ${igg.mean < ip.mean ? "earlier than" : "the same as"} the IP (Ct ${ip.mean.toFixed(2)}). The background is at least as high as the signal.`, [...ip.wells, ...igg.wells]);
    }
    if (ip?.mean != null && igg && igg.mean === null) warn("low", `${at}: IgG did not amplify, so fold over IgG can't be given as a number (the background is below detection).`, igg.wells);
    if (row.pctInput !== null && row.pctInput > 100) warn("high", `${at}: ${fmtNum(row.pctInput, 1)}% input is more than everything that went in. Check the input % (${pct}) and that the input wasn't diluted further.`, row.wells);
    out.push(row);
  }
  const neg = params.negTarget;
  if (neg) {
    let ipOnly = false;
    const noted = new Set();
    for (const row of out) {
      const n = out.find(x => x.set === row.set && x.target === neg);
      if (!n) { if (!noted.has(row.set)) warn("medium", `${row.set}: the negative region ${neg} has no wells in this set.`); noted.add(row.set); continue; }
      // The negative region is 1 against itself only when it can serve as the reference: it has a % input, or the whole set has no input (IP-only).
      if (row === n) { row.foldNeg = row.pctInput !== null || (row.ctIP !== null && !out.some(o => o.set === row.set && o.ctInput !== null)) ? 1 : null; continue; }
      if (row.pctInput !== null && n.pctInput) row.foldNeg = row.pctInput / n.pctInput;
      else if (row.ctInput === null && n.ctInput === null && row.ctIP !== null && n.ctIP !== null) { row.foldNeg = Math.exp(n.ctIP * Math.log(E(neg)) - row.ctIP * Math.log(E(row.target))); ipOnly = true; } // no input at all (CUT&RUN)
      else if (row.pctInput !== null && !noted.has(row.set)) { noted.add(row.set); warn("medium", `${row.set}: the negative region ${neg} has no % input in this set, so fold over it isn't given.`); }
    }
    if (ipOnly) warn("low", "Fold over the negative region was worked out from IP Ct values alone (no input). That assumes both primer pairs reach the threshold at the same amount of DNA, which their efficiencies don't tell you.");
    if (!out.some(r => r.target === neg)) warn("medium", `The negative region “${neg}” isn't among the labelled targets.`);
  }
  const hasInput = out.some(r => r.pctInput !== null);
  return { rows: out,
    columns: [["set", "Set"], ["target", "Region"], ["ctIP", "IP Ct", 2], ["ctInput", "Input Ct", 2], ["adjInput", "Adjusted input Ct", 2], ["ctIgG", "IgG Ct", 2],
      ["pctInput", "% input (IP)", 3], ["pctInputIgG", "% input (IgG)", 3], ["foldIgG", "Fold over IgG", 2], ...(neg ? [["foldNeg", `Fold over ${neg}`, 2]] : []), ...(byAmount ? [["note", "Note"]] : [])],
    chart: hasInput
      ? { yLabel: "% input", bars: out.flatMap(r => [{ group: r.target, series: r.set, value: r.pctInput }, ...(r.pctInputIgG !== null ? [{ group: r.target, series: `${r.set} IgG`, value: r.pctInputIgG, muted: true }] : [])]) }
      : { yLabel: "Fold over IgG", refLine: 1, bars: out.map(r => ({ group: r.target, series: r.set, value: r.foldIgG })) } };
}

// ---------------------------------------------------------------- (b) MSRE-qPCR % methylation
export function calcMsre(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const dep = params.enzyme === "dependent";
  const G = makeGroups(lr, opts, r => `${r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const get = (s, role, t) => G.get(`${s}\u0000${role}\u0000${t}`);
  const dct = (s, t) => { const d = get(s, "digested", t), m = get(s, "mock", t); return d?.mean != null && m?.mean != null ? d.mean - m.mean : null; };
  const corr = (s, t) => { const x = dct(s, t); if (x === null || !params.noSiteTarget) return x; const c = dct(s, params.noSiteTarget); return c === null ? null : x - c; };
  // Fraction of the DNA left after digestion, each primer pair with its own efficiency, corrected by the no-site region.
  const left = (s, t) => { const x = dct(s, t); if (x === null) return null; if (!params.noSiteTarget) return powE(E(t), -x); const c = dct(s, params.noSiteTarget); return c === null ? null : powE(E(t), -x) / powE(E(params.noSiteTarget), -c); };
  let cal = params.calibratorSet;
  if (cal && !lr.some(r => r.aset === cal)) { warn("medium", `The fully methylated set “${cal}” has no labelled wells, so results are not scaled to it.`); cal = ""; }
  const out = [];
  for (const s of sets(lr)) for (const t of targets(lr.filter(r => r.aset === s))) {
    if (t === params.noSiteTarget) {
      const x = dct(s, t);
      if (x !== null && Math.abs(x) > 1) warn("medium", `${s}: the region without a cut site (${t}) moved ${x.toFixed(2)} cycles after digestion. Expect about 0; DNA may have been lost or the region has a site after all.`);
      continue;
    }
    const d = get(s, "digested", t), m = get(s, "mock", t), at = `${s} / ${t}`;
    const row = { set: s, target: t, ctDigested: d?.mean ?? null, ctMock: m?.mean ?? null, dCt: dct(s, t), ddCt: null, pctMeth: null, note: "",
      wells: [d, m].filter(Boolean).flatMap(g => g.wells) };
    if (!m) warn("high", `${at}: no mock-digested wells, so methylation can't be worked out.`, row.wells);
    else if (m.mean === null) warn("high", `${at}: the mock digest did not amplify.`, m.wells);
    if (!d) warn("high", `${at}: no digested wells.`, row.wells);
    else if (d.mean === null && m?.mean != null) {
      const bound = 100 * powE(E(t), -((opts.maxCycles ?? 40) - m.mean));
      row.note = dep ? "Digested did not amplify: close to 100%" : `Digested did not amplify: below ${bound < 0.01 ? "0.01" : fmtNum(bound, 2)}%`;
      warn("low", `${at}: the digested DNA did not amplify, so it was cut completely (${row.note.split(": ")[1]} methylated).`, d.wells);
    }
    const x = corr(s, t);
    let f = left(s, t);
    if (x !== null && cal && s !== cal) {
      const c = corr(cal, t);
      if (c === null) { warn("medium", `${at}: the fully methylated set has no usable ${t} result, so this value isn't scaled to it.`); }
      else { row.ddCt = x - c; f = f / left(cal, t); }
    }
    if (f !== null) row.pctMeth = dep ? 100 * (1 - f) : 100 * f;
    if (row.pctMeth !== null && (row.pctMeth > 100.5 || row.pctMeth < -0.5))
      warn("medium", `${at}: ${fmtNum(row.pctMeth, 1)}% is outside 0–100%. It is shown as calculated, not clipped. Digestion can only remove template, so a value past 0–100% usually means the digested and mock wells didn't get the same amount of DNA. Check the DNA input and pipetting for this sample.`, row.wells);
    out.push(row);
  }
  return { rows: out,
    columns: [["set", "Set"], ["target", "Region"], ["ctDigested", "Digested Ct", 2], ["ctMock", "Mock Ct", 2], ["dCt", "ΔCt", 2], ...(cal ? [["ddCt", "ΔΔCt vs methylated control", 2]] : []), ["pctMeth", "% methylated", 1], ["note", "Note"]],
    chart: { yLabel: "% methylated", refLine: 100, bars: out.map(r => ({ group: r.target, series: r.set, value: r.pctMeth })) } };
}

// ---------------------------------------------------------------- (b) MethyLight PMR
export function calcPmr(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const ctl = params.controlTarget;
  const G = makeGroups(lr, opts, r => `${r.arole === "meth_ref" ? "\u0001ref" : r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const out = [];
  if (!ctl) { warn("high", "Choose the methylation-independent control reaction (for example ALU-C4 or ACTB) to work out PMR."); return { rows: out, columns: [], chart: null }; }
  const refCtl = G.get(`\u0001ref\u0000meth_ref\u0000${ctl}`), curves = opts.curves || new Map();
  if ((!refCtl || refCtl.mean === null) && !curves.has(ctl)) warn("high", `The fully methylated reference has no ${ctl} result, so PMR can't be worked out.`);
  const testRows = lr.filter(r => r.arole === "test");
  for (const s of sets(testRows)) {
    const sc = G.get(`${s}\u0000test\u0000${ctl}`);
    if (!sc || sc.mean === null) warn("high", `${s}: no ${ctl} control result, so PMR can't be worked out for this sample.`, sc?.wells || []);
    for (const t of targets(testRows.filter(r => r.aset === s)).filter(t => t !== ctl)) {
      const g = G.get(`${s}\u0000test\u0000${t}`), rg = G.get(`\u0001ref\u0000meth_ref\u0000${t}`);
      const row = { set: s, target: t, ctGene: g?.mean ?? null, ctControl: sc?.mean ?? null, refGene: rg?.mean ?? null, refControl: refCtl?.mean ?? null,
        dCt: null, dCtRef: null, pmr: null, note: "", wells: [g, sc].filter(Boolean).flatMap(x => x.wells) };
      if ((!rg || rg.mean === null) && !(curves.has(t) && curves.has(ctl))) warn("high", `${t}: the fully methylated reference has no result for this reaction.`, rg?.wells || []);
      if (g && g.mean === null) row.note = "Methylated reaction did not amplify (not detected)";
      if (row.ctGene !== null && row.ctControl !== null) row.dCt = row.ctGene - row.ctControl;
      if (row.refGene !== null && row.refControl !== null) row.dCtRef = row.refGene - row.refControl;
      // PMR = 100 × [gene / control in the sample] / [gene / control in the reference], each reaction with its own efficiency.
      const cg = curves.get(t), cc = curves.get(ctl);
      if (cg && cc) {
        // Standard curves of M.SssI reference DNA for both reactions (Eads 2000, Weisenberger 2005): amounts read off the curves.
        // If the reference wells are labelled, their ratio is the denominator; if not, the standards are the reference and it is 1.
        const Q = (c, ct) => (ct === null ? null : 10 ** ((ct - c.intercept) / c.slope));
        const rs = row.ctGene !== null && row.ctControl !== null ? Q(cg, row.ctGene) / Q(cc, row.ctControl) : null;
        const rr = row.refGene !== null && row.refControl !== null ? Q(cg, row.refGene) / Q(cc, row.refControl) : rg || refCtl ? null : 1;
        row.method = rg && refCtl ? "standard curves, reference wells" : "standard curves (standards are the reference)";
        if (rs !== null && rr !== null) row.pmr = 100 * rs / rr;
      } else {
        row.method = cg || cc ? "one reference level (curve for only one reaction)" : "one reference level";
        if (row.dCt !== null && row.dCtRef !== null) row.pmr = 100 * powE(E(t), row.refGene - row.ctGene) * powE(E(ctl), row.ctControl - row.refControl);
      }
      out.push(row);
    }
  }
  return { rows: out,
    columns: [["set", "Sample"], ["target", "Reaction"], ["ctGene", "Ct (methylated reaction)", 2], ["ctControl", `Ct (${ctl})`, 2], ["dCt", "ΔCt sample", 2], ["dCtRef", "ΔCt reference", 2], ["method", "Reference method"], ["pmr", "PMR", 1], ["note", "Note"]],
    chart: { yLabel: "PMR", refLine: 100, bars: out.map(r => ({ group: r.target, series: r.set, value: r.pmr })) } };
}

// ---------------------------------------------------------------- (c) accessibility vs a closed region
export function calcAccessibility(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const closed = params.closedTarget, loss = params.direction !== "enrichment";
  const G = makeGroups(lr, opts, r => `${r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const d = (s, t) => { const a = G.get(`${s}\u0000treated\u0000${t}`), b = G.get(`${s}\u0000untreated\u0000${t}`); return a?.mean != null && b?.mean != null ? a.mean - b.mean : null; };
  const out = [];
  if (!closed) warn("high", "Choose the closed control region; accessibility is given relative to it.");
  for (const s of sets(lr)) {
    const dc = closed ? d(s, closed) : null;
    if (closed && dc === null) warn("high", `${s}: the closed region ${closed} needs both treated and untreated wells with a Ct.`);
    if (loss && dc !== null && dc > 1) warn("medium", `${s}: the closed region was digested too (Ct moved ${dc.toFixed(2)} cycles). Over-digestion makes every region look less open than it is.`);
    for (const t of targets(lr.filter(r => r.aset === s))) {
      if (t === closed) continue;
      const a = G.get(`${s}\u0000treated\u0000${t}`), b = G.get(`${s}\u0000untreated\u0000${t}`), at = `${s} / ${t}`;
      const row = { set: s, target: t, ctTreated: a?.mean ?? null, ctUntreated: b?.mean ?? null, d: d(s, t), dClosed: dc, pctLeft: null, index: null, note: "",
        wells: [a, b].filter(Boolean).flatMap(g => g.wells) };
      if (!b) warn("high", `${at}: no untreated wells, so this region can't be normalised.`, row.wells);
      if (a && a.mean === null) { row.note = loss ? "Treated did not amplify: fully digested" : "Treated did not amplify: not enriched"; warn("low", `${at}: ${row.note.toLowerCase()}.`, a.wells); }
      if (row.d !== null) row.pctLeft = 100 * powE(E(t), -row.d);
      if (row.d !== null && dc !== null) row.index = loss ? powE(E(t), row.d) / powE(E(closed), dc) : powE(E(closed), dc) / powE(E(t), row.d);
      out.push(row);
    }
  }
  return { rows: out,
    columns: [["set", "Set"], ["target", "Region"], ["ctTreated", "Treated Ct", 2], ["ctUntreated", "Untreated Ct", 2], ["d", "ΔCt", 2], ["dClosed", `ΔCt ${closed || "closed"}`, 2],
      ...(loss ? [["pctLeft", "% left after digestion", 1]] : []), ["index", loss ? "Accessibility vs closed region" : "Enrichment vs closed region", 2], ["note", "Note"]],
    chart: { yLabel: loss ? "Accessibility vs closed region" : "Enrichment vs closed region", refLine: 1, bars: out.map(r => ({ group: r.target, series: r.set, value: r.index })) } };
}

// ---------------------------------------------------------------- (d) 3C relative crosslinking frequency
export function calc3C(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const load = params.loadingTarget, ctl = params.controlTarget;
  const G = makeGroups(lr, opts, r => `${r.arole === "template" ? "\u0001tpl" : r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const lib = lr.filter(r => r.arole === "library");
  const out = [];
  if (!load) warn("high", "Choose the loading control primers; 3C signals are corrected for the amount of DNA with them.");
  const loadCt = new Map(sets(lib).map(s => [s, G.get(`${s}\u0000library\u0000${load}`)?.mean ?? null]));
  const known = [...loadCt.values()].filter(x => x !== null), refLoad = known.length ? mean(known) : null;
  for (const [s, v] of loadCt) if (load && v === null) warn("high", `${s}: no loading-control Ct, so this sample can't be corrected for DNA amount.`);
  // Hagège et al. 2007: a dilution series of the control template for each primer pair; the library Ct is read off
  // that curve as an amount of template, Q = 10^((Ct − intercept) / slope). Every ligation product is present at the
  // same amount in the template, so Q is comparable between primer pairs. Without a curve: one template level.
  const curves = opts.curves || new Map();
  const signal = (s, t) => {
    const a = G.get(`${s}\u0000library\u0000${t}`), b = G.get(`\u0001tpl\u0000template\u0000${t}`), c = curves.get(t);
    if (c) return { a, b, c, q: a?.mean != null ? 10 ** ((a.mean - c.intercept) / c.slope) : null };
    return { a, b, q: a?.mean != null && b?.mean != null ? powE(E(t), -(a.mean - b.mean)) : null };
  };
  const corrected = (s, t) => { const { q } = signal(s, t), L = loadCt.get(s); return q !== null && L != null && refLoad !== null ? q * powE(E(load), L - refLoad) : null; };
  for (const s of sets(lib)) for (const t of targets(lib.filter(r => r.aset === s))) {
    if (t === load) continue;
    const { a, b, c, q } = signal(s, t), at = `${s} / ${t}`;
    const row = { set: s, target: t, ctLibrary: a?.mean ?? null, ctTemplate: c ? null : b?.mean ?? null, signal: q, loadCt: loadCt.get(s), corrected: corrected(s, t), rcf: null, note: "",
      method: c ? `standard curve (${c.levels} levels)` : "one template level", wells: [a, b].filter(Boolean).flatMap(g => g.wells) };
    if (c) { /* the curve replaces the single template level */ }
    else if (!b) warn("high", `${t}: no control template wells for this primer pair, so its efficiency can't be corrected.`, row.wells);
    else if (b.mean === null) warn("high", `${t}: the control template did not amplify. Check the primer pair on the template before trusting the 3C signal.`, b.wells);
    if (a && a.mean === null) { row.note = "No ligation product detected"; row.corrected = 0; }
    if (ctl && t !== ctl) {
      const c = corrected(s, ctl);
      if (c) row.rcf = (row.corrected ?? NaN) / c;
      if (!fin(row.rcf)) row.rcf = null;
    }
    out.push(row);
  }
  if (ctl && !lib.some(r => r.target === ctl)) warn("medium", `The control interaction “${ctl}” has no 3C library wells.`);
  const methods = new Set(out.map(r => r.method.startsWith("standard") ? "curve" : "single"));
  if (methods.size > 1) warn("medium", "Some primer pairs were read off a template standard curve and others against one template level. The two give amounts in different units unless the single level is the curve's unit amount, so compare pairs with care.");
  else if (methods.has("single") && out.length) warn("low", "No template standard curve on the plate, so each primer pair was compared with one template level (E^−ΔCt). Hagège et al. use a dilution series of the template for every primer pair; mark those wells as Standard with their amounts to use it.");
  const show = ctl ? "rcf" : "corrected";
  return { rows: out,
    columns: [["set", "Sample"], ["target", "Primer pair"], ["ctLibrary", "3C Ct", 2], ["ctTemplate", "Template Ct", 2], ["method", "Template method"], ["signal", "Signal vs template", 4], ["loadCt", "Loading Ct", 2],
      ["corrected", "Loading-corrected", 4], ...(ctl ? [["rcf", `Relative to ${ctl}`, 3]] : []), ["note", "Note"]],
    chart: { yLabel: ctl ? `Crosslinking frequency relative to ${ctl}` : "Loading-corrected crosslinking frequency", bars: out.filter(r => r.target !== ctl).map(r => ({ group: r.target, series: r.set, value: r[show] })) } };
}

// ---------------------------------------------------------------- (e) distribution across fractions
const fracOrder = (a, b) => { const x = Number(a), y = Number(b); return fin(x) && fin(y) && a !== "" && b !== "" ? x - y : String(a).localeCompare(String(b)); };
export function calcFractions(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const spike = params.spikeTarget, from = Number(params.polysomeFrom);
  const fr = lr.filter(r => r.arole === "fraction");
  const noLabel = fr.filter(r => !r.afraction);
  if (noLabel.length) warn("medium", `${noLabel.length} fraction well(s) have no fraction number and were left out.`, noLabel.map(r => r.key || r.well));
  const use = fr.filter(r => r.afraction);
  const G = makeGroups(use, opts, r => `${r.aset}\u0000${r.target}\u0000${r.afraction}`, warn);
  const out = [], summary = [];
  for (const s of sets(use)) for (const t of targets(use.filter(r => r.aset === s))) {
    if (t === spike) continue;
    const fracs = [...new Set(use.filter(r => r.aset === s && r.target === t).map(r => r.afraction))].sort(fracOrder);
    const items = fracs.map(f => {
      const g = G.get(`${s}\u0000${t}\u0000${f}`), sp = spike ? G.get(`${s}\u0000${spike}\u0000${f}`) : null;
      let c = g.mean;
      if (spike) { c = g.mean !== null && sp?.mean != null ? g.mean - sp.mean : null; if (g.mean !== null && sp?.mean == null) warn("high", `${s} / fraction ${f}: no spike-in Ct, so this fraction can't be spike-corrected and is left out of the total.`, g.wells); }
      return { f, g, c, sp };
    });
    // Amount in fraction i ∝ E(RNA)^−Ct_i, divided by E(spike)^−Ct(spike)_i when there is a spike-in. Worked in logs
    // and scaled to the largest fraction, which cancels when the shares are taken.
    const lnT = Math.log(E(t)), lnS = spike ? Math.log(E(spike)) : 0;
    for (const i of items) i.lv = i.c === null ? null : -i.g.mean * lnT + (spike ? i.sp.mean * lnS : 0);
    const ok = items.filter(i => i.lv !== null), top = ok.length ? Math.max(...ok.map(i => i.lv)) : null;
    const zero = items.filter(i => i.g.mean === null);
    if (zero.length) warn("low", `${s} / ${t}: fraction(s) ${zero.map(i => i.f).join(", ")} did not amplify and count as 0%.`, zero.flatMap(i => i.g.wells));
    for (const i of items) i.rel = i.g.mean === null ? 0 : i.lv === null ? null : Math.exp(i.lv - top);
    const total = items.reduce((a, i) => a + (i.rel ?? 0), 0);
    for (const i of items) out.push({ set: s, target: t, fraction: i.f, ct: i.g.mean, ctSpike: i.sp?.mean ?? null, rel: i.rel, pct: total > 0 && i.rel !== null ? (100 * i.rel) / total : null, wells: i.g.wells });
    if (fin(from) && params.polysomeFrom !== "") {
      const poly = out.filter(r => r.set === s && r.target === t && fin(Number(r.fraction)) && Number(r.fraction) >= from && r.pct !== null).reduce((a, r) => a + r.pct, 0);
      summary.push({ set: s, target: t, polysomal: poly });
    }
    if (fracs.length < 2) warn("medium", `${s} / ${t}: only ${fracs.length} fraction, so there is no distribution to show.`);
  }
  return { rows: out, summary,
    columns: [["set", "Set"], ["target", "RNA"], ["fraction", "Fraction"], ["ct", "Ct", 2], ...(spike ? [["ctSpike", `Spike-in Ct (${spike})`, 2]] : []), ["rel", "Relative amount", 4], ["pct", "% of total", 1]],
    chart: { yLabel: "% of total", bars: out.map(r => ({ group: r.fraction, series: `${r.set} · ${r.target}`, value: r.pct })) } };
}

// ---------------------------------------------------------------- (f) signal over blank, limit of detection
export function calcSignal(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const k = fin(Number(params.sdMultiplier)) ? Number(params.sdMultiplier) : 3, maxC = fin(Number(params.maxCycles)) ? Number(params.maxCycles) : 40;
  const G = makeGroups(lr, opts, r => `${r.arole === "blank" ? "\u0001blank" : r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const out = [], lods = [];
  const tests = lr.filter(r => r.arole === "test");
  for (const t of targets(lr)) {
    const bl = G.get(`\u0001blank\u0000blank\u0000${t}`);
    let bMean = bl?.mean ?? null, bSd = bl?.sd ?? null, lod = null;
    if (!bl) warn("high", `${t}: no blank wells, so there's no background to compare with.`);
    else if (bMean === null) { bMean = maxC; warn("low", `${t}: no blank well came up, so the blank is taken as Ct ${maxC} (the last cycle). Fold over blank is then a lower bound.`, bl.wells); }
    else if (bSd === null) warn("medium", `${t}: only ${bl.nNum} blank well with a Ct; at least 2 are needed for a limit of detection.`, bl.wells);
    if (bl?.mean != null && bSd !== null) lod = bMean - k * bSd;
    lods.push({ target: t, blankMean: bMean, blankSd: bSd, nBlank: bl?.nNum ?? 0, lod });
    for (const s of sets(tests.filter(r => r.target === t))) {
      const g = G.get(`${s}\u0000test\u0000${t}`);
      const row = { set: s, target: t, ct: g.mean, blankCt: bMean, dCt: null, fold: null, lod, detected: "", wells: g.wells };
      if (g.mean === null) row.detected = "Not detected";
      else if (bMean !== null) {
        row.dCt = bMean - g.mean; row.fold = powE(E(t), row.dCt);
        row.detected = lod === null ? "No LOD" : g.mean < lod ? "Above LOD" : "Below LOD";
        if (row.dCt < 0) warn("medium", `${s} / ${t}: the sample comes up later than the blank (ΔCt ${row.dCt.toFixed(2)}).`, g.wells);
      }
      out.push(row);
    }
  }
  return { rows: out, summary: lods,
    columns: [["set", "Sample"], ["target", "Target"], ["ct", "Ct", 2], ["blankCt", "Blank mean Ct", 2], ["dCt", "ΔCt (blank − sample)", 2], ["fold", "Fold over blank", 2], ["lod", `LOD Ct (mean − ${k} SD)`, 2], ["detected", "Detection"]],
    chart: { yLabel: "ΔCt over blank", refLine: 0, bars: out.map(r => ({ group: r.target, series: r.set, value: r.dCt })) } };
}

// ---------------------------------------------------------------- (g) 4sU labelling: new RNA
// Treated vs mock follows Roadblock-qPCR (Watson et al. 2021): the compound stops RT on 4sU-containing RNA, so what is
// left after treatment is the RNA made before the label. Pulldown vs total is % input applied to a 4sU-tagging pulldown
// (Dölken 2008, Rädle 2013). Subtracting a no-4sU control set and the "% new" read-out are my own adaptation, not a
// published qPCR method; docs/assays.md says so.
export function calcLabelling(lr, params, opts, warn) {
  const E = opts.E || (() => 2);
  const pull = params.readout === "pulldown", bg = params.backgroundSet;
  const G = makeGroups(lr, opts, r => `${r.aset}\u0000${r.arole}\u0000${r.target}`, warn);
  const get = (s, role, t) => G.get(`${s}\u0000${role}\u0000${t}`);
  const [rA, rB] = pull ? ["ip", "input"] : ["blocked", "unblocked"];
  const use = lr.filter(r => r.arole === rA || r.arole === rB);
  const other = lr.filter(r => r.arole !== rA && r.arole !== rB);
  if (other.length) warn("low", `${other.length} well(s) are labelled for the other read-out (${pull ? "treated / mock" : "pulldown / total"}) and were left out.`, other.map(r => r.key || r.well));
  let bgSet = bg;
  if (bgSet && !use.some(r => r.aset === bgSet)) { warn("medium", `The no-4sU set “${bgSet}” has no labelled wells for this read-out, so no background was taken off.`); bgSet = ""; }
  const pct = Number(params.totalPercent), pctOk = fin(pct) && pct > 0 && pct <= 100;
  if (pull && !pctOk) warn("high", `Total RNA % must be a number above 0 and up to 100 (it is “${params.totalPercent}”).`);
  const d = (s, t) => { const a = get(s, rA, t), b = get(s, rB, t); return a?.mean != null && b?.mean != null ? a.mean - b.mean : null; };
  const pctPull = (s, t) => { const x = d(s, t); return pull && pctOk && x !== null ? pct * powE(E(t), -x) : null; }; // d = Ct(pulldown) − Ct(total)
  const out = [];
  for (const s of sets(use)) for (const t of targets(use.filter(r => r.aset === s))) {
    const a = get(s, rA, t), b = get(s, rB, t), at = `${s} / ${t}`, isBg = !!bgSet && s === bgSet;
    const row = { set: s, target: t, ctA: a?.mean ?? null, ctB: b?.mean ?? null, d: d(s, t), dBg: null, pctOld: null, pctNew: null, pctPull: null, pctBg: null, overBg: null,
      note: isBg ? "No-4sU background" : "", wells: [a, b].filter(Boolean).flatMap(g => g.wells) };
    if (!b) warn("high", `${at}: no ${ASSAY_ROLE_LABEL[rB].toLowerCase()} wells to compare with.`, row.wells);
    else if (b.mean === null) warn("high", `${at}: the ${ASSAY_ROLE_LABEL[rB].toLowerCase()} RNA did not amplify.`, b.wells);
    if (!a) warn("high", `${at}: no ${ASSAY_ROLE_LABEL[rA].toLowerCase()} wells.`, row.wells);
    else if (a.mean === null && b?.mean != null) { row.note = pull ? "Pulldown did not amplify: no labelled RNA detected" : "Treated did not amplify: little or no RNA made before the label"; warn("low", `${at}: ${row.note.toLowerCase()}.`, a.wells); }
    if (bgSet && !isBg) {
      row.dBg = d(bgSet, t);
      if (row.dBg === null) warn("medium", `${at}: the no-4sU set has no usable ${t} result, so no background was taken off this one.`);
    }
    if (pull) {
      row.pctPull = pctPull(s, t);
      if (bgSet && !isBg) row.pctBg = pctPull(bgSet, t);
      if (row.pctPull !== null && row.pctBg !== null) { row.pctNew = row.pctPull - row.pctBg; row.overBg = row.pctBg > 0 ? row.pctPull / row.pctBg : null; }
      else if (row.pctPull !== null && !bgSet) row.pctNew = row.pctPull;
      if (row.overBg !== null && row.overBg < 2) warn("medium", `${at}: the pulldown is only ${fmtNum(row.overBg, 2)}-fold over the no-4sU pulldown, so most of it may be background.`, row.wells);
    } else if (row.d !== null) {
      const x = row.dBg !== null ? row.d - row.dBg : row.d;
      if (!bgSet || isBg || row.dBg !== null) { row.pctOld = 100 * powE(E(t), -x); row.pctNew = 100 - row.pctOld; }
      if (isBg && Math.abs(row.d) > 0.5) warn("medium", `${at}: in cells without 4sU the treatment moved the Ct by ${row.d.toFixed(2)} cycles. Expect about 0; the compound may be affecting the RNA or the RT in other ways.`, row.wells);
      if (x < -0.5) warn("medium", `${at}: the treated RNA comes up ${(-x).toFixed(2)} cycles earlier than the mock, which the method can't explain. Check that equal amounts went into each RT.`, row.wells);
    }
    if (!pull && !bgSet && !isBg) row.note ||= "No no-4sU control, background not taken off";
    out.push(row);
  }
  if (!bg) warn("low", "No no-4sU control set was chosen. Without it there's no way to tell how much of the signal comes from the treatment or the pulldown itself.");
  const cols = pull
    ? [["set", "Set"], ["target", "RNA"], ["ctA", "Pulldown Ct", 2], ["ctB", "Total Ct", 2], ["pctPull", "% of total in pulldown", 3], ...(bgSet ? [["pctBg", "% in no-4sU pulldown", 3], ["overBg", "Over no-4sU", 2]] : []), ["pctNew", bgSet ? "% new (background taken off)" : "% new (no background taken off)", 2], ["note", "Note"]]
    : [["set", "Set"], ["target", "RNA"], ["ctA", "Treated Ct", 2], ["ctB", "Mock Ct", 2], ["d", "ΔCt", 2], ...(bgSet ? [["dBg", "ΔCt no-4sU", 2]] : []), ["pctOld", "% made before the label", 1], ["pctNew", "% new", 1], ["note", "Note"]];
  return { rows: out, columns: cols,
    chart: { yLabel: "% new RNA", bars: out.filter(r => !(bgSet && r.set === bgSet)).map(r => ({ group: r.target, series: r.set, value: r.pctNew })) } };
}

// ---------------------------------------------------------------- (h) PEA in NPX, Olink-style
// Assarsson et al. 2014 and Olink's white paper 1096: ΔCt against the extension control of the same sample, ΔΔCt
// against the median of the inter-plate controls for that assay, NPX = correction factor − ΔΔCt. LOD = 3 SD above the
// negative controls (buffer). Sample QC: incubation control 2 and detection control within ±0.3 NPX of the plate median.
// For the QC I use the extension-normalised values; a constant per assay (IPC, correction factor) doesn't change the
// distance from the median. With "NPX already", the numbers in the Ct column are taken as NPX and nothing is normalised.
const median = xs => { const v = [...xs].sort((a, b) => a - b), n = v.length; return n ? (n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2) : null; };
export function calcNpx(lr, params, opts, warn) {
  const given = params.npxInput === "npx", ext = params.extTarget, cf = fin(Number(params.correctionFactor)) ? Number(params.correctionFactor) : 0;
  const k = fin(Number(params.npxSd)) ? Number(params.npxSd) : 3;
  const ctrlTargets = new Set([ext, params.ic1Target, params.ic2Target, params.detTarget].filter(Boolean));
  const G = makeGroups(lr, opts, r => `${r.arole}\u0000${r.aset}\u0000${r.target}`, warn);
  const ct = (role, s, t) => G.get(`${role}\u0000${s}\u0000${t}`)?.mean ?? null;
  const setsOf = role => sets(lr.filter(r => r.arole === role));
  if (!given && !ext) { warn("high", "Choose the extension control assay; NPX from Ct values needs it. Or say the Ct column already holds NPX."); return { rows: [], columns: [], chart: null }; }
  // ΔCt (extension-normalised) for one sample and assay; null when either is missing.
  const dct = (role, s, t) => { const a = ct(role, s, t); if (given || a === null) return a; const e = ct(role, s, ext); return e === null ? null : a - e; };
  for (const role of ["test", "blank", "ipc"]) for (const s of setsOf(role)) if (!given && ct(role, s, ext) === null) warn("high", `${s}: no extension control Ct, so no NPX for this ${role === "ipc" ? "inter-plate control" : "sample"}.`);
  const assays = targets(lr).filter(t => !ctrlTargets.has(t));
  const ipcSets = setsOf("ipc");
  if (!given && !ipcSets.length) warn("medium", "No inter-plate control wells, so NPX here is ΔCt against the extension control only (correction factor − ΔCt). Values can't be compared with another plate.");
  const ipcMed = new Map(assays.map(t => [t, given ? 0 : median(ipcSets.map(s => dct("ipc", s, t)).filter(fin)) ?? 0]));
  if (!given && ipcSets.length && ipcSets.length < 3) warn("low", `${ipcSets.length} inter-plate control set(s); Olink runs three and takes the median.`);
  const npx = (role, s, t) => { const d = dct(role, s, t); return d === null ? null : given ? d : cf - (d - ipcMed.get(t)); };
  const out = [], lods = [];
  for (const t of assays) {
    const neg = setsOf("blank").map(s => npx("blank", s, t)).filter(fin);
    const m = neg.length ? mean(neg) : null, sd = sdOf(neg), lod = m !== null && sd !== null ? m + k * sd : null;
    if (neg.length < 2) warn("medium", `${t}: ${neg.length} negative control(s) with a value; at least 2 (Olink runs 3) are needed for a limit of detection.`);
    lods.push({ target: t, negMean: m, negSd: sd, nNeg: neg.length, lod, ipc: ipcMed.get(t) });
    for (const role of ["test", "ipc", "blank"]) for (const s of setsOf(role)) {
      const v = npx(role, s, t), raw = ct(role, s, t);
      if (raw === null && !G.has(`${role}\u0000${s}\u0000${t}`)) continue;
      out.push({ set: s, target: t, kind: role === "test" ? "Sample" : role === "ipc" ? "Inter-plate control" : "Negative control", ct: given ? null : raw, ctExt: given ? null : ct(role, s, ext),
        dCt: given ? null : dct(role, s, t), npx: role === "test" ? v : v, lod, detected: role !== "test" ? "" : v === null ? (raw === null ? "Not detected" : "") : lod === null ? "No LOD" : v > lod ? "Above LOD" : "Below LOD",
        wells: G.get(`${role}\u0000${s}\u0000${t}`)?.wells || [] });
    }
  }
  // Sample QC on the internal controls.
  const qc = [];
  for (const [label, t] of [["Incubation control 2", params.ic2Target], ["Detection control", params.detTarget]]) {
    if (!t) continue;
    const vals = setsOf("test").map(s => { const a = ct("test", s, t); if (a === null) return [s, null]; if (given) return [s, a]; const e = ct("test", s, ext); return [s, e === null ? null : -(a - e)]; }).filter(([, v]) => fin(v));
    const med = median(vals.map(([, v]) => v));
    for (const [s, v] of vals) { const dev = v - med; qc.push({ set: s, control: label, deviation: dev }); if (Math.abs(dev) > 0.3) warn("medium", `${s}: ${label.toLowerCase()} is ${dev.toFixed(2)} NPX from the plate median (Olink's limit is ±0.3), so this sample fails QC.`); }
  }
  for (const r of out) { const bad = qc.filter(q => q.set === r.set && Math.abs(q.deviation) > 0.3); if (bad.length && r.kind === "Sample") r.detected = (r.detected ? r.detected + "; " : "") + "QC warning"; }
  if (!given && cf === 0) warn("low", "No correction factor was entered, so NPX is relative to the inter-plate control, not Olink's absolute NPX scale. Differences between samples are the same either way.");
  const samples = out.filter(r => r.kind === "Sample");
  return { rows: samples.concat(out.filter(r => r.kind !== "Sample")), summary: lods, qc,
    columns: [["set", "Sample"], ["target", "Assay"], ["kind", "Type"], ...(given ? [] : [["ct", "Ct", 2], ["ctExt", "Extension control Ct", 2], ["dCt", "ΔCt", 2]]), ["npx", "NPX", 2], ["lod", `LOD (mean + ${k} SD of negatives)`, 2], ["detected", "Detection"]],
    chart: { yLabel: "NPX", bars: samples.map(r => ({ group: r.target, series: r.set, value: r.npx })) } };
}

const CALC = { npx: calcNpx, labelling: calcLabelling, enrichment: calcEnrichment, msre: calcMsre, pmr: calcPmr, accessibility: calcAccessibility, threec: calc3C, fractions: calcFractions, signal: calcSignal };

// ---------------------------------------------------------------- one call for the app and the report
// exp: the experiment (uses exp.assaySetup, exp.source and exp.ruleset); rows: core.effectiveRows output.
// extra.stdCurves: res.stdCurves from core.analyze(), for targets whose efficiency is set to "standard curve".
export function runAssay(exp, rows, extra = {}) {
  const setup = normalizeAssaySetup(exp?.assaySetup);
  const assay = assayById(setup.type);
  if (!assay) return null;
  const family = FAMILIES[assay.family], params = assayParams(setup);
  const { stdCurves, ...rest } = extra;
  const opts = { ...DEFAULT_OPTS, dna: setup.dna, sdThreshold: exp?.ruleset?.values?.sdThreshold ?? DEFAULT_OPTS.sdThreshold, maxCycles: Number(params.maxCycles) || 40, ...rest };
  const warnings = [];
  const warn = (level, text, wells = []) => warnings.push({ level, text, wells });
  const stale = !!(setup.sourceSha && exp?.source?.sha256 && setup.sourceSha !== exp.source.sha256);
  if (stale) setup.wells = {};
  const lr = labelRows(rows || [], setup);
  const counts = Object.fromEntries(family.roles.map(r => [r, lr.filter(x => x.arole === r).length]));
  const offFamily = lr.filter(r => !family.roles.includes(r.arole));
  if (stale) warn("medium", "The results file was replaced, so the assay labels from the old file were set aside. Label the wells again.");
  if (offFamily.length) warn("low", `${offFamily.length} well(s) carry a label that ${assay.name} doesn't use (${[...new Set(offFamily.map(r => ASSAY_ROLE_LABEL[r.arole]))].join(", ")}); they were left out.`, offFamily.map(r => r.key || r.well));
  // Standard curves on the plate (wells with the Standard role and a quantity): 3C and PMR read amounts off them.
  const curves = new Map((Array.isArray(stdCurves) ? stdCurves : []).filter(c => c && fin(c.slope) && fin(c.intercept) && c.slope < 0).map(c => [c.target, c]));
  opts.curves = curves;
  const curveCovers = r => (assay.family === "threec" && r === "template" && lr.some(x => x.arole === "library" && curves.has(x.target)))
    || (assay.family === "pmr" && r === "meth_ref" && curves.has(params.controlTarget) && lr.some(x => x.arole === "test" && x.target !== params.controlTarget && curves.has(x.target)));
  for (const r of assay.require) if (!counts[r] && !curveCovers(r)) warn("high", `No wells are labelled “${ASSAY_ROLE_LABEL[r]}”, which ${assay.name} needs.`);
  for (const p of family.params) if (p.type === "target" && params[p.key] && !lr.some(r => r.target === params[p.key])) warn("medium", `${p.label.replace(/ \(optional\)$/, "")}: “${params[p.key]}” is not a target in the labelled wells.`);
  const effs = efficiencies(setup, stdCurves, targets(lr));
  opts.E = t => effs.get(t)?.E ?? 2;
  for (const e of effs.values()) {
    if (e.source === "missing") warn("medium", `${e.target}: efficiency is set to come from the standard curve, but there is no standard curve for it on this plate, so 100% was used.`);
    else if (e.source !== "assumed" && (e.pct < 90 || e.pct > 110)) warn("low", `${e.target}: efficiency ${fmtNum(e.pct, 1)}% is outside 90–110%. The corrected numbers use it, but an assay this far off is worth redesigning.`);
  }
  const r = CALC[assay.family](lr.filter(x => family.roles.includes(x.arole)), params, opts, warn);
  // The efficiency behind every row, so the table says what was assumed.
  for (const row of r.rows || []) row.eff = effLabel(effs.get(row.target));
  if (r.columns?.length) r.columns.push(["eff", "Efficiency used"]);
  const order = { high: 0, medium: 1, low: 2 };
  warnings.sort((a, b) => order[a.level] - order[b.level]);
  const replicates = compareConditions(assay.family, r, setup, params);
  return { assay, family, params, counts, labelled: lr.length, warnings, efficiencies: [...effs.values()], ...r, replicates };
}

// ---------------------------------------------------------------- report section (HTML string, no DOM)
export function assayReportHtml(exp, rows, esc, stdCurves) {
  let out;
  try { out = runAssay(exp, rows, { stdCurves }); } catch (e) { return `<h2>Assay calculation</h2><p>The assay calculation could not run: ${esc(e.message)}</p>`; }
  if (!out) return "";
  const { assay, family, params } = out;
  const cell = (r, [k, , d]) => (typeof r[k] === "number" ? fmtNum(r[k], d ?? 2) : r[k] ?? "");
  const tbl = out.columns.length && out.rows.length
    ? `<table><thead><tr>${out.columns.map(c => `<th>${esc(c[1])}</th>`).join("")}</tr></thead><tbody>${out.rows.map(r => `<tr>${out.columns.map(c => `<td>${esc(cell(r, c))}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="sub">No results: no wells are labelled for this assay yet.</p>`;
  const ps = family.params.filter(p => params[p.key] !== "" && params[p.key] != null)
    .map(p => `${p.label.replace(/ \(optional\)$/, "")}: ${p.type === "select" ? (p.options.find(o => o[0] === params[p.key])?.[1] ?? params[p.key]) : params[p.key]}`);
  const summary = out.summary?.length && assay.family === "fractions"
    ? `<p>Share in polysome fractions (from fraction ${esc(params.polysomeFrom)}): ${esc(out.summary.map(s => `${s.set} / ${s.target} ${fmtNum(s.polysomal, 1)}%`).join("; "))}.</p>` : "";
  return `<h2>Assay calculation: ${esc(assay.name)}</h2>
<p>${esc(family.name)}. ${out.labelled} labelled well(s): ${esc(Object.entries(out.counts).map(([k, n]) => `${ASSAY_ROLE_LABEL[k].toLowerCase()} ${n}`).join(", "))}. Technical replicates were averaged as Ct values before the calculation.</p>
${ps.length ? `<p class="sub">${esc(ps.join(". "))}.</p>` : ""}
<div class="ev">${family.formula.map(esc).join("\n")}</div>
${tbl}${summary}
${replicateReportHtml(out.replicates, esc)}
${out.warnings.length ? `<p><b>Things to check</b></p><ul>${out.warnings.map(w => `<li><span class="sev ${w.level}">${esc(w.level[0].toUpperCase() + w.level.slice(1))}</span>${esc(w.text)}</li>`).join("")}</ul>` : "<p>Nothing to flag in the assay calculation.</p>"}
<p class="sub small">Ct differences are turned into ratios as E^ΔCt, where E = 1 + efficiency for that primer pair. ${esc(out.efficiencies.length ? `Efficiency used: ${out.efficiencies.map(e => `${e.target} ${effLabel(e)}${e.source === "curve" ? ` [${e.note}]` : ""}`).join("; ")}.` : "")} Where no efficiency was set, 100% (E = 2) is assumed. Sources: ${family.refs.map(k => esc(REFS[k].cite) + (REFS[k].doi ? ` doi:${esc(REFS[k].doi)}` : REFS[k].pmid ? ` PMID ${esc(REFS[k].pmid)}` : REFS[k].url ? ` ${esc(REFS[k].url)}` : "")).join(" ")}</p>`;
}
