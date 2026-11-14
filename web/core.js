// PlateCheck core: parsers, rules, analysis and run comparison.
// Pure functions with no DOM access; shared by the web app, the Node CLI (cli.mjs) and the tests.
// Raw input is never modified: parsed values keep their original strings and the source text is stored verbatim.
import { cleanTargets, targetTable } from "./genes.js"; // genes and RNA types per target

export const TOOL = "PlateCheck";
export const APP_VERSION = "0.9.0";
// Replaced with the commit hash at deploy (tools/stamp.mjs), so every report names the exact code that made it.
export const BUILD = "dev";
export const PARSER_VERSION = "0.4.0";
export const PACKET_VERSION = 1;

export class ParseError extends Error {
  constructor(message, details = {}) { super(message); this.name = "ParseError"; this.details = details; }
}

// ---------------------------------------------------------------- vocabulary
export const ROLES = ["sample", "ntc", "positive", "nrt", "standard", "empty"];
export const ROLE_LABEL = {
  sample: "Sample (unknown)", ntc: "No-template control (NTC)", positive: "Positive control",
  nrt: "No-RT control", standard: "Standard (dilution series)", empty: "Empty / not used",
};
export const ROLE_SHORT = { sample: "S", ntc: "N", positive: "P", nrt: "R", standard: "Std", empty: "·" };
export const CATEGORY_LABEL = {
  data_issue: "Data issue", review_warning: "Review warning", missing_context: "Missing context",
  info: "Informational", not_assessed: "Not assessed",
};
export const SEVERITIES = ["high", "medium", "low", "info"];
export const DISPOSITIONS = ["unreviewed", "accepted", "not_applicable", "resolved", "unresolved"];
export const DISPOSITION_LABEL = {
  unreviewed: "Not reviewed", accepted: "Looks fine", not_applicable: "Doesn't apply",
  resolved: "Fixed", unresolved: "Still to fix",
};
export const CLOSED = new Set(["accepted", "not_applicable", "resolved"]);
export const STATUS_LABEL = {
  no_data: "No data imported", review_needed: "Review needed",
  findings_present: "Findings present", no_flags: "No configured checks flagged",
};
export const FORMATS = {
  "generic-ct-csv": "Generic Ct/Cq table (comma, tab or semicolon separated)",
  "biorad-cfx-cq": "Bio-Rad CFX “Quantification Cq Results” export",
  "thermo-quantstudio": "Thermo Fisher QuantStudio results export (text, CSV or Excel, with instrument preamble)",
  "abi-sds": "Applied Biosystems SDS export (7000/7300/7500/7900HT, SDS 1.x/2.x)",
};
export const IMPORT_TEMPLATE =
  "well,sample,target,ct,role,group,bio_unit,quantity\n" +
  "A1,ctrl-1,GAPDH,18.21,sample,control,ctrl-1,\n" +
  "A2,ctrl-1,GAPDH,18.30,sample,control,ctrl-1,\n" +
  "B1,,GAPDH,16.9,standard,,,1e6\n" +
  "H12,NTC,GAPDH,Undetermined,ntc,,,\n";

// ---------------------------------------------------------------- rule catalog
// Severity is a property of the rule (PRD §9), not a generic score.
const V = "0.4.0"; // rule-set version: bump when a rule is added or its logic changes
const BASIS = "Informed by MIQE 2.0 guidance; thresholds are placeholders pending expert review.";
export const RULES_REVIEW = { status: "Not yet reviewed by a qPCR domain expert", reviewed_on: null };
export const RULES = {
  malformed_row: { group: "Structure", category: "data_issue", severity: "high", title: "Row could not be parsed",
    checks: "Each data row has the same number of fields as the header.",
    why: "A row with missing or extra fields may be shifted. It was excluded from every other check rather than guessed." },
  invalid_well_coordinate: { group: "Structure", category: "data_issue", severity: "high", title: "Invalid well coordinate",
    checks: "Well labels are valid plate positions (A1 to P24).",
    why: "An invalid position usually means a column shift or typo, so the row cannot be placed on the plate." },
  duplicate_well_assignment: { group: "Structure", category: "data_issue", severity: "high", title: "Duplicate well assignment",
    checks: "Each well holds at most one result per target.",
    why: "Two results for one well and target can mean a merged export or mapping error, and averages could double-count." },
  unmapped_role: { group: "Structure", category: "missing_context", severity: "medium", title: "Role in file not recognised",
    checks: "Roles or tasks in the file map to a known role.",
    why: "Labels such as “Neg Ctrl” are ambiguous (NTC, no-RT or a negative sample). The well is treated as a sample until you assign a role." },
  instrument_omit: { group: "Structure", category: "review_warning", severity: "low", title: "Well omitted in instrument software",
    checks: "Wells excluded in the instrument software are surfaced rather than silently dropped.",
    why: "An omitted well changes the instrument's means and standard curves; the reason should be recorded." },
  unmapped_well: { group: "Structure", category: "missing_context", severity: "medium", title: "Well lacks a sample or target label",
    checks: "Every used well has a target, and sample-type wells have a sample label.",
    why: "Unlabelled wells cannot be grouped into replicates or matched to controls." },
  non_numeric_ct: { group: "Structure", category: "data_issue", severity: "medium", title: "Non-numeric Ct/Cq",
    checks: "Ct/Cq values are numbers or a recognised no-amplification marker (for example Undetermined, NaN).",
    why: "An unrecognised value cannot be used in calculations and may indicate an export problem." },
  missing_ct: { group: "Structure", category: "review_warning", severity: "low", title: "No Ct/Cq value",
    checks: "Sample and standard wells report a Ct/Cq.",
    why: "No amplification in a sample well may be real (target absent or below detection) or a failed reaction." },
  empty_well_signal: { group: "Structure", category: "review_warning", severity: "medium", title: "Signal in a well marked empty",
    checks: "Wells marked empty do not report a Ct/Cq.",
    why: "A Ct in an unused well suggests the plate map does not match the plate." },
  map_wells_not_in_data: { group: "Structure", category: "data_issue", severity: "medium", title: "Plate-map wells missing from data",
    checks: "Every well in the imported plate-map template appears in the results file.",
    why: "Mapped wells with no data can mean the wrong file, plate orientation or a dropped well." },
  data_wells_not_in_map: { group: "Structure", category: "missing_context", severity: "medium", title: "Data wells missing from plate map",
    checks: "Every well in the results file appears in the imported plate-map template.",
    why: "Wells outside the plate map keep their file labels only, which may not be what was intended." },
  bio_unit_in_multiple_groups: { group: "Structure", category: "data_issue", severity: "medium", title: "Biological unit in more than one group",
    checks: "Each biological unit belongs to a single experimental group.",
    why: "A unit labelled in two groups usually indicates a labelling error that would mix conditions." },
  replicate_structure_inferred: { group: "Replicates", category: "missing_context", severity: "low", title: "Biological units not labelled",
    checks: "Biological units (independent samples) are labelled separately from technical replicate wells.",
    why: "PlateCheck assumed each sample name is one biological unit. Technical wells are never counted as independent biological observations." },
  insufficient_replicates: { group: "Replicates", category: "not_assessed", severity: "low", title: "Replicate spread not assessed",
    checks: "Each technical replicate group has at least two numeric Ct/Cq values.",
    why: "With fewer than two values, dispersion cannot be estimated." },
  replicate_dispersion: { group: "Replicates", category: "review_warning", severity: "medium", title: "Technical replicates spread above threshold",
    checks: "Sample standard deviation of Ct/Cq within a technical replicate group is at or below the threshold. With the Ct-dependent option on, the threshold for a group is the larger of the set value and a multiple of the SD expected from Poisson sampling at that group's mean Ct.",
    why: "Wide technical spread can come from pipetting, low template or an outlier well. No value was removed or down-weighted." },
  late_ct: { group: "Replicates", category: "review_warning", severity: "low", title: "Late Ct: low copy number",
    checks: "Sample replicate groups have a mean Ct/Cq at or below the late-Ct setting.",
    why: "Past about Ct 35 a well holds roughly 10 template copies or fewer, so how many copies land in each well is down to chance. Replicates scatter, some wells stay empty, and the result is closer to detected / not detected than to a quantity. This is a note, not a fault." },
  missing_control: { group: "Controls", category: "missing_context", severity: "medium", title: "Expected control not found",
    checks: "Each target has the controls the selected rule set expects.",
    why: "Without the control, contamination or reaction failure for this target cannot be assessed from the data." },
  control_not_applicable: { group: "Controls", category: "info", severity: "info", title: "Control marked not applicable",
    checks: "Expected controls that a user marked not applicable are recorded with the reason.",
    why: "Keeps the decision visible in the report." },
  no_control_roles: { group: "Controls", category: "missing_context", severity: "medium", title: "No control wells identified",
    checks: "At least one well has a control or standard role.",
    why: "Without identified controls, none of the control checks can run." },
  ntc_amplification: { group: "Controls", category: "review_warning", severity: "high", title: "NTC shows amplification",
    checks: "No-template controls do not amplify. Amplification earlier than the NTC Ct threshold is rated high, later amplification medium.",
    why: "Amplification in an NTC can indicate contamination or primer-dimer. The cause cannot be determined from Ct alone." },
  positive_control_failed: { group: "Controls", category: "data_issue", severity: "high", title: "Positive control did not amplify",
    checks: "Positive controls report a Ct/Cq.",
    why: "If the positive control failed, negative results for this target cannot be told apart from reaction failure." },
  nrt_amplification: { group: "Controls", category: "review_warning", severity: "medium", title: "No-RT control shows amplification",
    checks: "No-RT controls do not amplify.",
    why: "Signal without reverse transcription can indicate genomic DNA. Its distance from the sample Ct matters for interpretation." },
  nrt_margin: { group: "Controls", category: "review_warning", severity: "medium", title: "No-RT control too close to the samples",
    checks: "An amplifying no-RT control comes up at least the configured number of cycles after the mean Ct of the samples it controls (the sample it was made from when the names match, otherwise all samples of that target).",
    why: "The gap says how much of the sample signal could be genomic DNA: 5 cycles is about 3%, 3.3 cycles about 10%, 1 cycle about half. A small gap means the sample Ct is not a clean measure of the RNA." },
  std_curve_missing_quantity: { group: "Standard curve", category: "data_issue", severity: "medium", title: "Standard without a usable quantity",
    checks: "Standard wells have a positive numeric quantity.",
    why: "Standards without a quantity cannot be placed on the curve." },
  std_curve_insufficient: { group: "Standard curve", category: "not_assessed", severity: "low", title: "Too few standard levels",
    checks: "A standard curve has at least the configured number of dilution levels with numeric Ct/Cq.",
    why: "Efficiency and linearity are not meaningful with too few levels." },
  std_curve_summary: { group: "Standard curve", category: "info", severity: "info", title: "Standard curve fitted",
    checks: "Linear fit of Ct/Cq against log10 quantity.", why: "Records slope, R² and efficiency for the report." },
  std_curve_efficiency: { group: "Standard curve", category: "review_warning", severity: "medium", title: "Efficiency outside configured range",
    checks: "Efficiency computed as 10^(−1/slope) − 1 is within the configured range.",
    why: "Efficiency far from 100% can bias relative quantification methods that assume equal efficiency." },
  std_curve_r2: { group: "Standard curve", category: "review_warning", severity: "medium", title: "Standard curve R² below threshold",
    checks: "The linear fit reaches the configured R².", why: "Poor linearity can indicate dilution errors, inhibition or a range that is too wide." },
  std_curve_range: { group: "Standard curve", category: "review_warning", severity: "low", title: "Standard curve covers a narrow range",
    checks: "The standards with a quantity and a Ct/Cq span at least the configured number of log10 units, lowest to highest quantity.",
    why: "Slope, efficiency and R² are poorly pinned down by a short curve: the same pipetting scatter moves them more over 2 logs than over 5. The curve was still fitted and reported." },
  amp_curve_missing: { group: "Amplification", category: "not_assessed", severity: "low", title: "No amplification curve for some wells",
    checks: "Every used well has an amplification curve in the curve file.", why: "Curve checks could not run for these wells." },
  amp_curve_ambiguous: { group: "Amplification", category: "not_assessed", severity: "low", title: "Curve could not be matched to a target",
    checks: "Each curve can be matched to exactly one well and target.",
    why: "In multiplexed wells a curve without a target label cannot be assigned, so it was not used." },
  amp_ct_without_rise: { group: "Amplification", category: "review_warning", severity: "medium", title: "Ct/Cq reported but the curve does not rise",
    checks: "Wells with a numeric Ct/Cq show a fluorescence rise above baseline noise.",
    why: "A Ct on a flat curve can be a threshold artefact from noise or drift." },
  amp_rise_without_ct: { group: "Amplification", category: "review_warning", severity: "medium", title: "Curve rises but no Ct/Cq was reported",
    checks: "Wells whose curve rises above baseline noise report a Ct/Cq.",
    why: "The instrument's threshold or baseline settings may have missed real amplification, or the rise is an artefact." },
  amp_ct_inconsistent: { group: "Amplification", category: "review_warning", severity: "low", title: "Ct/Cq inconsistent with the curve",
    checks: "The offset between the reported Ct/Cq and the curve's crossing of a common threshold matches the rest of the plate.",
    why: "A well-specific offset can indicate per-well baseline settings or an unusual curve shape. PlateCheck's threshold is a heuristic." },
  melt_no_peak: { group: "Melt curve", category: "review_warning", severity: "low", title: "No clear melt peak",
    checks: "Amplified wells show a melt peak of comparable size to the rest of the target.",
    why: "A Ct without a melt product can indicate a non-specific or artefactual signal." },
  melt_multiple_peaks: { group: "Melt curve", category: "review_warning", severity: "medium", title: "More than one melt peak",
    checks: "Each well has one main melt peak; secondary peaks at least the configured fraction of the main peak are flagged.",
    why: "Additional peaks can indicate non-specific products or primer-dimer, which would contribute to the Ct." },
  melt_tm_deviation: { group: "Melt curve", category: "review_warning", severity: "low", title: "Melt temperature differs from the target",
    checks: "The main peak Tm is within the configured tolerance of the target's median Tm.",
    why: "A shifted Tm can indicate a different product, or a salt or volume difference in that well." },
  ntc_melt_peak: { group: "Melt curve", category: "review_warning", severity: "medium", title: "NTC has a melt peak",
    checks: "No-template controls have no melt peak comparable to the target product.",
    why: "A Tm near the product suggests template contamination; a lower Tm is often primer-dimer. The cause is not certain." },
  rna_type_reference_mismatch: { group: "RNA type", category: "review_warning", severity: "low", title: "Target and reference are different kinds of RNA",
    checks: "In the Analysis step, miRNA targets are not normalised to an mRNA reference gene, and mRNA targets not to a miRNA or snoRNA/snRNA reference. RNA types come from the Genes step, or are guessed from the target name.",
    why: "A miRNA and an mRNA are usually reverse transcribed in different ways (stem-loop or poly(A) RT against oligo-dT or random primers), so a ΔCt between them also carries the difference between those reactions. References of the same RNA class are preferred." },
  mirna_no_small_rna_reference: { group: "RNA type", category: "missing_context", severity: "low", title: "miRNA targets without a small-RNA reference",
    checks: "When the plate has miRNA targets, it also has a small-RNA reference (a snoRNA or snRNA such as U6, RNU44 or RNU48), or a miRNA or spike-in is chosen as reference in the Analysis step.",
    why: "miRNAs are best normalised to small RNAs that go through the same RT and behave alike in extraction. Without one on the plate, the usual references cannot be applied to these targets." },
  lncrna_no_nrt: { group: "RNA type", category: "missing_context", severity: "low", title: "lncRNA target without a no-RT control",
    checks: "Each lncRNA target has at least one no-RT well, unless no-RT controls are already expected for every target or marked not applicable.",
    why: "Many lncRNAs have one or two exons, so primers often cannot span an exon junction, and genomic DNA is then amplified like the RNA. A no-RT control is the way to see whether it was." },
  missing_metadata: { group: "Method metadata", category: "missing_context", severity: "low", title: "Method detail not provided",
    checks: "Key method context (protocol, assay details, efficiency evidence, analysis method, instrument) is recorded.",
    why: "Missing context is reported as not provided, not as a failed assay. It makes later review and reporting harder." },
};
for (const r of Object.values(RULES)) { r.version = V; r.basis ||= BASIS; }

// ---------------------------------------------------------------- rule sets
export const RULESET_FIELDS = [
  { key: "sdThreshold", label: "Technical replicate SD threshold (cycles)", type: "number", step: 0.05 },
  { key: "sdCtDependent", label: "Let the SD threshold rise for late Ct (Poisson sampling)", type: "bool" },
  { key: "sdPoissonK", label: "Late-Ct SD threshold as a multiple of the expected Poisson SD", type: "number", step: 0.1 },
  { key: "lateCtThreshold", label: "Note sample groups with a mean Ct above (0 = off)", type: "number", step: 1 },
  { key: "ntcCtThreshold", label: "NTC amplification rated high below Ct", type: "number", step: 1 },
  { key: "expectNtc", label: "Expect an NTC for every target", type: "bool" },
  { key: "expectPositive", label: "Expect a positive control for every target", type: "bool" },
  { key: "expectNrt", label: "Expect a no-RT control for every target", type: "bool" },
  { key: "nrtMargin", label: "No-RT margin: cycles an amplifying no-RT must trail the samples (0 = off)", type: "number", step: 0.5 },
  { key: "ctTolerance", label: "Curve vs reported Ct/Cq tolerance (cycles)", type: "number", step: 0.5 },
  { key: "meltChecks", label: "Run melt-curve checks (intercalating-dye assay)", type: "bool" },
  { key: "meltTmTolerance", label: "Melt Tm tolerance from target median (°C)", type: "number", step: 0.1 },
  { key: "meltSecondaryRatio", label: "Flag secondary melt peaks at ≥ this fraction of the main peak", type: "number", step: 0.05 },
  { key: "effMin", label: "Standard curve efficiency minimum (%)", type: "number", step: 1 },
  { key: "effMax", label: "Standard curve efficiency maximum (%)", type: "number", step: 1 },
  { key: "r2Min", label: "Standard curve minimum R²", type: "number", step: 0.005 },
  { key: "minStdLevels", label: "Minimum dilution levels for a standard curve", type: "number", step: 1 },
  { key: "minStdRange", label: "Note standard curves spanning fewer log10 units than (0 = off)", type: "number", step: 0.5 },
];
export const DEFAULT_PROFILE = {
  id: "assaylint-default", name: "PlateCheck defaults", version: 1,
  values: { sdThreshold: 0.3, sdCtDependent: false, sdPoissonK: 1.5, lateCtThreshold: 35,
    ntcCtThreshold: 35, expectNtc: true, expectPositive: false, expectNrt: false, nrtMargin: 5,
    ctTolerance: 2, meltChecks: false, meltTmTolerance: 1, meltSecondaryRatio: 0.3,
    effMin: 90, effMax: 110, r2Min: 0.98, minStdLevels: 3, minStdRange: 3 },
};

// ---------------------------------------------------------------- threshold evidence (metadata only)
// Where each number comes from. Every reference below was checked against the paper itself (see
// docs/thresholds.md for the passages and the reasoning). `evidence` is the one-line reason shown next
// to a setting, `detail` the longer note behind "Why this number", `refs` keys into REFERENCES.
export const REFERENCES = {
  miqe2009: { short: "Bustin et al. 2009 (MIQE)", doi: "10.1373/clinchem.2008.112797",
    text: "Bustin SA, Benes V, Garson JA, et al. The MIQE guidelines: minimum information for publication of quantitative real-time PCR experiments. Clin Chem. 2009;55(4):611–622." },
  miqe2025: { short: "Bustin et al. 2025 (MIQE 2.0)", doi: "10.1093/clinchem/hvaf043",
    text: "Bustin SA, Ruijter JM, van den Hoff MJB, et al. MIQE 2.0: revision of the Minimum Information for Publication of Quantitative Real-Time PCR Experiments guidelines. Clin Chem. 2025;71(6):634–651." },
  ruizvillalba2021: { short: "Ruiz-Villalba et al. 2021", doi: "10.3390/life11060496",
    text: "Ruiz-Villalba A, Ruijter JM, van den Hoff MJB. Use and misuse of Cq in qPCR data analysis and reporting. Life (Basel). 2021;11(6):496." },
  deronde2017: { short: "de Ronde et al. 2017", doi: "10.1261/rna.059063.116",
    text: "de Ronde MWJ, Ruijter JM, Lanfear D, et al. Practical data handling pipeline improves performance of qPCR-based circulating miRNA measurements. RNA. 2017;23(5):811–821." },
  forootan2017: { short: "Forootan et al. 2017", doi: "10.1016/j.bdq.2017.04.001",
    text: "Forootan A, Sjöback R, Björkman J, Sjögreen B, Linz L, Kubista M. Methods to determine limit of detection and limit of quantification in quantitative real-time PCR (qPCR). Biomol Detect Quantif. 2017;12:1–6." },
  svec2015: { short: "Svec et al. 2015", doi: "10.1016/j.bdq.2015.01.005",
    text: "Svec D, Tichopad A, Novosadova V, Pfaffl MW, Kubista M. How good is a PCR efficiency estimate: recommendations for precise and robust qPCR efficiency assessments. Biomol Detect Quantif. 2015;3:9–16." },
  engl2017: { short: "Hougs et al. 2017 (ENGL)", doi: "10.2760/645114",
    text: "Hougs L, Gatto F, Goerlich O, et al. Verification of analytical methods for GMO testing when implementing interlaboratory validated methods, version 2. European Network of GMO Laboratories. EUR 29015 EN. Publications Office of the European Union; 2017." },
  pfaffl2001: { short: "Pfaffl 2001", doi: "10.1093/nar/29.9.e45",
    text: "Pfaffl MW. A new mathematical model for relative quantification in real-time RT-PCR. Nucleic Acids Res. 2001;29(9):e45." },
  ruijter2009: { short: "Ruijter et al. 2009", doi: "10.1093/nar/gkp045",
    text: "Ruijter JM, Ramakers C, Hoogaars WMH, et al. Amplification efficiency: linking baseline and bias in the analysis of quantitative PCR data. Nucleic Acids Res. 2009;37(6):e45." },
  ririe1997: { short: "Ririe et al. 1997", doi: "10.1006/abio.1996.9916",
    text: "Ririe KM, Rasmussen RP, Wittwer CT. Product differentiation by analysis of DNA melting curves during the polymerase chain reaction. Anal Biochem. 1997;245(2):154–160." },
  schwarzenbach2015: { short: "Schwarzenbach et al. 2015", doi: "10.1373/clinchem.2015.239459",
    text: "Schwarzenbach H, da Silva AM, Calin G, Pantel K. Data normalization strategies for microRNA quantification. Clin Chem. 2015;61(11):1333–1342." },
  harrow2012: { short: "Harrow et al. 2012 (GENCODE)", doi: "10.1101/gr.135350.111",
    text: "Harrow J, Frankish A, Gonzalez JM, et al. GENCODE: the reference human genome annotation for The ENCODE Project. Genome Res. 2012;22(9):1760–1774." },
};
const THRESHOLD_EVIDENCE = {
  sdThreshold: { refs: ["deronde2017", "ruizvillalba2021", "miqe2025"],
    evidence: "Pipetting error alone gives replicates up to about 0.5 cycles apart; 0.3 SD is about that for triplicates. Late Ct values spread more.",
    detail: "A common rule discards technical replicates more than 0.5 cycles apart, which is what a 15% pipetting error gives when there is plenty of template (de Ronde et al. 2017; Ruiz-Villalba et al. 2021). For three replicates an SD of 0.3 is roughly that range. Below about 100 copies per well, Poisson sampling adds more spread than pipetting does: about 0.29 cycles at 25 copies and 0.46 at 10 copies, which is around Ct 35. So a fixed 0.3 will flag late-Ct groups that are behaving as expected. Ruiz-Villalba et al. accept up to 2 cycles between replicates for Ct values up to 35. For low-expression targets, raise this number or run more replicates rather than dropping wells." },
  sdCtDependent: { refs: ["deronde2017", "ruizvillalba2021", "miqe2025"],
    evidence: "Below about 100 copies per well, chance in how many copies each well gets adds more spread than pipetting. Off by default so results do not change until you ask for it.",
    detail: "When this is on, a replicate group is flagged only if its SD is above both the fixed threshold and a multiple of the SD that Poisson sampling alone predicts at the group's mean Ct: 1 / (√N · ln 2) cycles for N copies, taking 10 copies at Ct 35 and 100% efficiency. That is the curve drawn on the SD-against-Ct graph. de Ronde et al. (2017) replace the fixed 0.5-cycle rule with a Poisson-based range for low-input samples, and Ruiz-Villalba et al. (2021) accept up to 2 cycles between replicates for Ct values up to 35. Past about Ct 36.7 (under 3 copies) I hold the limit at its 3-copy value, since Ct is no longer quantitative there. Turn it on for miRNA, single-cell or other low-copy work; leave it off if all your targets come up before about Ct 32, where it changes nothing." },
  sdPoissonK: { refs: ["deronde2017", "ruizvillalba2021"],
    evidence: "Only used when the option above is on. 1.5 × the Poisson SD is my own allowance for pipetting on top of sampling noise; no paper sets this factor.",
    detail: "With the default 1.5 the limit stays at the fixed 0.3 up to about Ct 32.6, then rises: 0.48 at Ct 34, 0.68 at Ct 35, 0.97 at Ct 36 and 1.25 from about Ct 36.7 on. For comparison, the range of 2 cycles that Ruiz-Villalba et al. (2021) accept up to Ct 35 is an SD of about 1.0 to 1.15 for triplicates and 1.4 for duplicates, so 1.5 is the stricter of the two. The factor itself is a rule of thumb of mine, not a published number. Raise it to 2 or 3 if groups sitting just above the curve on the graph are still being flagged." },
  lateCtThreshold: { refs: ["miqe2025", "ruizvillalba2021", "forootan2017", "miqe2009"],
    evidence: "About 10 copies reach Ct 35 at 90–100% efficiency, the usual lower limit of quantification; under 3 copies (about Ct 37) even detection is unreliable.",
    detail: "MIQE 2.0 puts the lower limit of quantification of a good assay near 10 copies per reaction, reached at about 35 cycles at 90% efficiency, and the limit of detection at 3 copies (about 37 cycles). Ruiz-Villalba et al. (2021) say inputs below 10 copies cannot be used for quantitative analysis, and Forootan et al. (2017) show that sampling noise alone puts the 95% limit of detection at 3 molecules. So a sample group whose mean Ct is past 35 gets a low-severity note: read it as detected or not detected, or add replicates. MIQE (2009) warns that a fixed cut-off can be too low or too high, which is why this is a note and nothing is removed. If you have measured your own limit of quantification from a dilution series, enter that Ct here. For low-efficiency assays the number should be higher (MIQE 2.0: 42 cycles at 70%). Set 0 to switch the note off." },
  nrtMargin: { refs: ["miqe2025", "miqe2009"],
    evidence: "MIQE 2.0: a sample counts as positive only if its Cq is at least 5 cycles before an amplifying negative control. Five cycles is 32-fold, so about 3% of the signal.",
    detail: "Any amplification in a no-RT well is still flagged as before. This setting adds a second, separate flag when the no-RT comes up fewer than this many cycles after the mean Ct of the samples it controls. PlateCheck matches a no-RT well to its sample by name (for example “c1 -RT” to “c1”); if no name matches it uses all sample wells of that target. The 5-cycle figure is the MIQE 2.0 rule for negative controls: 2⁵ = 32-fold, so genomic DNA would account for about 3% of the signal; 3.3 cycles would be 10%. Tighten it (7–10 cycles) for small fold changes, loosen it only if you correct for genomic DNA signal separately. Set 0 to switch the margin flag off." },
  ntcCtThreshold: { refs: ["miqe2009", "miqe2025", "ruizvillalba2021"],
    evidence: "About 10 copies reach Ct 35 at 90–100% efficiency. MIQE gives NTC signal near Ct 40 as ignorable when the lowest sample is below Ct 35.",
    detail: "MIQE 2.0 puts the lower limit of quantification near 10 copies per reaction (Ct about 35 at 90% efficiency) and the limit of detection at 3 copies (Ct about 37). An NTC before Ct 35 means roughly 10 or more contaminating copies, enough to change a quantity, so I rate it high. Later NTC signal is still reported, as medium. MIQE 2.0 also says a sample should count as positive only if its Cq comes at least 5 cycles before an amplifying negative control. If your targets come up late (miRNA, single cells, rare transcripts), compare the NTC with your latest sample, not with a fixed Ct." },
  expectNtc: { refs: ["miqe2009", "miqe2025"],
    evidence: "MIQE asks for NTCs on each plate or batch of samples.",
    detail: "NTCs pick up reagent contamination and, in dye-based assays, primer-dimer. MIQE (2009) says they should be included on each plate or batch, with the rules for rejecting data set in advance." },
  expectPositive: { refs: ["miqe2009", "miqe2025"],
    evidence: "MIQE calls positive controls essential when there is no calibration curve in the run. Off by default because many plates carry standards instead.",
    detail: "A positive control tells a failed reaction apart from a true negative. MIQE (2009) calls it essential when calibration curves are not run on every plate; MIQE 2.0 adds that positive controls at several concentrations help set LOD and LOQ. Turn this on if your plates have no standard curve." },
  expectNrt: { refs: ["miqe2009", "miqe2025"],
    evidence: "A no-RT control is essential the first time an RNA prep is checked; after that MIQE calls it desirable. Off by default for that reason.",
    detail: "No-RT wells show genomic DNA signal. The MIQE checklists (2009 and 2.0) call it essential when RNA is first extracted and desirable once the prep is shown to be DNA-free; the MIQE 2.0 text says RT-qPCR should include one. Turn this on for new RNA preps, for primers that do not span an intron, and for single-exon or intronless targets." },
  ctTolerance: { refs: ["ruijter2009", "ruizvillalba2021"],
    evidence: "No published value. Ct depends on each instrument's baseline and threshold, so I compare each well's offset with the plate's usual offset.",
    detail: "Baseline errors change the observed efficiency and Ct (Ruijter et al. 2009), and Cq moves with the threshold setting (Ruiz-Villalba et al. 2021). PlateCheck redraws one common threshold and flags a well only when its offset from the reported Ct differs from the plate median offset by more than this many cycles. Two cycles is a heuristic of mine, wide enough to ignore normal curve-shape differences. Tighten it if your instrument uses a single threshold for the whole plate." },
  meltChecks: { refs: ["miqe2025"],
    evidence: "For dye-based assays, MIQE 2.0 calls melt curve analysis essential. Off by default because probe assays have no melt step.",
    detail: "Intercalating dyes report every double-stranded product, so the melt curve is the main check that one product amplified. MIQE 2.0 calls it essential for dye assays. Probe-based assays do not need it." },
  meltTmTolerance: { refs: ["ririe1997", "miqe2025"],
    evidence: "Melt curves can tell apart products less than 2 °C apart (Ririe et al. 1997); 1 °C is half that.",
    detail: "Ririe et al. (1997) separated products whose Tm differed by less than 2 °C. A shift of more than 1 °C from the target's median therefore may be a different product, though salt, volume and instrument calibration also move Tm (MIQE 2.0). On high-resolution melt instruments you can tighten this to about 0.5 °C." },
  meltSecondaryRatio: { refs: ["miqe2025", "ririe1997"],
    evidence: "No published cut-off. My heuristic: a second peak at 30% or more of the main peak is big enough to affect Ct.",
    detail: "I found no paper that sets a height ratio. MIQE 2.0 notes that amplicons with uneven GC content can melt in blocks and show more than one peak from a single product, so check the expected melt shape (for example with uMELT) before acting on this flag. Lower the ratio to catch small primer-dimer peaks; raise it for amplicons known to melt in two domains." },
  effMin: { refs: ["engl2017", "svec2015", "miqe2025"],
    evidence: "ENGL acceptance criterion for validated qPCR methods: slope −3.6 to −3.1, i.e. 90–110% efficiency.",
    detail: "The European Network of GMO Laboratories accepts standard curves with slopes between −3.6 and −3.1 (Hougs et al. 2017), which is 90–110%. Svec et al. (2015) found that a well-designed assay should reach at least 90%, and that the estimate itself is imprecise: with one replicate per dilution the 95% interval was about 89–99% for one assay. MIQE 2.0 notes that dilution errors can push the apparent efficiency above 100%." },
  effMax: { refs: ["engl2017", "miqe2025", "pfaffl2001"],
    evidence: "Same ENGL range (90–110%). Above 100% usually points to dilution error or inhibition in the concentrated standards.",
    detail: "Efficiency cannot truly exceed 100%. MIQE 2.0 lists pipetting errors in the dilution series (slopes below −3.32) and inhibitors that are diluted out in the higher dilutions as the usual causes of values above it. If an assay is reproducibly outside the range and cannot be redesigned, use an efficiency-corrected calculation (Pfaffl 2001) rather than one that assumes 100%." },
  r2Min: { refs: ["engl2017", "miqe2009"],
    evidence: "ENGL acceptance criterion: R² ≥ 0.98. MIQE asks for R² to be reported but sets no number.",
    detail: "Hougs et al. (2017) accept standard curves with R² of at least 0.98. MIQE (2009) asks for R² and, ideally, confidence intervals across the linear range. R² rises with the width of the range, so a curve over 2 logs can fail at 0.98 even with good pipetting." },
  minStdLevels: { refs: ["miqe2009", "miqe2025", "svec2015"],
    evidence: "Three levels is the fewest that can show a curve. MIQE asks for at least 3 orders of magnitude (4 tenfold points), MIQE 2.0 for 4–5.",
    detail: "This setting only decides whether PlateCheck fits a curve at all. MIQE (2009) asks for a range of at least 3 orders of magnitude, ideally 5–6; MIQE 2.0 asks for 4–5 orders with at least 3 replicates per dilution, and Svec et al. (2015) recommend 3–4 replicates per concentration for a precise efficiency. If you run tenfold dilutions, 5 levels is a better minimum." },
  minStdRange: { refs: ["miqe2009", "miqe2025"],
    evidence: "MIQE asks for a standard curve covering at least 3 orders of magnitude (ideally 5–6); MIQE 2.0 asks for 4–5.",
    detail: "The range is log10 of the highest quantity minus log10 of the lowest, counting only standards that have both a quantity and a Ct. Three log10 units is four tenfold points. MIQE (2009) asks for at least 3 orders of magnitude and ideally 5–6; MIQE 2.0 asks for 4–5. A shorter curve is still fitted and its efficiency reported, with a low-severity note, because R² and the slope are less certain over a short range. Raise this to 4 or 5 to follow MIQE 2.0, or set 0 to switch the note off, for example when a low-abundance target leaves only a few levels above the limit of detection." },
};
for (const f of RULESET_FIELDS) Object.assign(f, THRESHOLD_EVIDENCE[f.key]);
const RULE_EVIDENCE = {
  late_ct: THRESHOLD_EVIDENCE.lateCtThreshold,
  nrt_margin: THRESHOLD_EVIDENCE.nrtMargin,
  std_curve_range: THRESHOLD_EVIDENCE.minStdRange,
  rna_type_reference_mismatch: { refs: ["schwarzenbach2015"], evidence: "Schwarzenbach et al. (2015) review miRNA normalisation and note that reference genes of the same RNA class are preferred." },
  mirna_no_small_rna_reference: { refs: ["schwarzenbach2015"], evidence: "Small RNAs (snoRNAs, snRNAs, stable miRNAs, spike-ins) are the references used for miRNAs; Schwarzenbach et al. (2015) compare them." },
  lncrna_no_nrt: { refs: ["harrow2012", "miqe2009", "miqe2025"], evidence: "In GENCODE the most common lncRNA transcript has two exons, against four for protein-coding ones (Harrow et al. 2012). MIQE asks for a no-RT control, at least for new RNA preps." },
  missing_ct: { refs: ["miqe2025", "forootan2017"], evidence: "Below 3 copies per well Poisson sampling means some replicates get no template at all." },
  replicate_dispersion: THRESHOLD_EVIDENCE.sdThreshold,
  ntc_amplification: THRESHOLD_EVIDENCE.ntcCtThreshold,
  positive_control_failed: THRESHOLD_EVIDENCE.expectPositive,
  nrt_amplification: { refs: ["miqe2025", "miqe2009"],
    evidence: "MIQE 2.0: a sample counts as positive only if its Cq is at least 5 cycles before an amplifying negative control. Five cycles is about 32-fold, or 3% of the signal." },
  std_curve_insufficient: THRESHOLD_EVIDENCE.minStdLevels,
  std_curve_efficiency: THRESHOLD_EVIDENCE.effMin,
  std_curve_r2: THRESHOLD_EVIDENCE.r2Min,
  amp_ct_without_rise: { refs: ["ruizvillalba2021"], evidence: "Instruments usually set the threshold about 10 SD above the baseline noise; I use the same 10 × baseline SD for a rise." },
  amp_rise_without_ct: { refs: ["ruizvillalba2021"], evidence: "Instruments usually set the threshold about 10 SD above the baseline noise; I use the same 10 × baseline SD for a rise." },
  amp_ct_inconsistent: THRESHOLD_EVIDENCE.ctTolerance,
  melt_multiple_peaks: THRESHOLD_EVIDENCE.meltSecondaryRatio,
  melt_tm_deviation: THRESHOLD_EVIDENCE.meltTmTolerance,
  ntc_melt_peak: THRESHOLD_EVIDENCE.meltChecks,
};
for (const [k, e] of Object.entries(RULE_EVIDENCE)) Object.assign(RULES[k], { evidence: e.evidence, refs: e.refs });
// References behind the settings and the rules that produced findings, in a stable order.
export function referencesFor(findings = []) {
  const keys = new Set([...RULESET_FIELDS.flatMap(f => f.refs || []), ...findings.flatMap(f => RULES[f.rule]?.refs || [])]);
  return Object.keys(REFERENCES).filter(k => keys.has(k)).map(k => ({ key: k, ...REFERENCES[k] }));
}

export function rulesetFrom(profile) {
  return { profile: { id: profile.id, name: profile.name, version: profile.version },
    values: { ...DEFAULT_PROFILE.values, ...profile.values }, base: { ...DEFAULT_PROFILE.values, ...profile.values } };
}
export function rulesetId(rs) { return `${rs.profile.id}@v${rs.profile.version}`; }
export function rulesetChanges(rs) {
  return RULESET_FIELDS.filter(f => rs.values[f.key] !== rs.base[f.key])
    .map(f => ({ key: f.key, label: f.label, from: rs.base[f.key], to: rs.values[f.key] }));
}

// ---------------------------------------------------------------- method context (FR-6, FR-13)
// severity: what is reported when the field is empty. null = never reported.
export const CONTEXT_FIELDS = [
  { key: "protocol", label: "Protocol name and version", severity: "low" },
  { key: "assay_details", label: "Assay / primer details (sequences, assay IDs, amplicon)", severity: "medium", multiline: true },
  { key: "efficiency_evidence", label: "Efficiency / assay validation evidence", severity: "medium", multiline: true },
  { key: "analysis_method", label: "Analysis method (e.g. ΔΔCq with named reference genes)", severity: "low" },
  { key: "instrument", label: "Instrument and software version", severity: "low" },
  { key: "run_settings", label: "Run settings (cycling, threshold and baseline settings)", severity: "info", multiline: true },
  { key: "reagent_lots", label: "Reagent and primer lot numbers", severity: "info" },
  { key: "deviations", label: "Deviations from protocol", severity: null, multiline: true },
];

// ---------------------------------------------------------------- small helpers
export function groupBy(items, keyFn) {
  const m = new Map();
  for (const x of items) { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}
function stats(vals) {
  if (!vals.length) return { mean: null, sd: null };
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, x) => a + (x - mean) ** 2, 0) / (vals.length - 1)) : null;
  return { mean, sd };
}
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function linfit(pts) {
  const n = pts.length; if (n < 2) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 1, n };
}
// SD of Ct expected from Poisson sampling alone, for the copy number implied by a Ct. Uses the rule of thumb
// that about 10 copies give Ct 35 (MIQE 2.0; Ruiz-Villalba et al. 2021). SD(log_E N) ≈ 1 / (√N · ln E).
// Pipetting and instrument noise come on top of this. Returns null below 3 copies, where Ct is not quantitative.
export function poissonSd(ct, { copiesAt35 = 10, efficiency = 2 } = {}) {
  const n = copiesAt35 * efficiency ** (35 - ct);
  return Number.isFinite(n) && n >= 3 ? 1 / (Math.sqrt(n) * Math.log(efficiency)) : null;
}
const POISSON_SD_3_COPIES = 1 / (Math.sqrt(3) * Math.LN2);
// The SD limit for a replicate group. Fixed unless the Ct-dependent option is on; then it never drops below
// the fixed value, and past 3 copies it stays at the 3-copy value.
export function sdLimit(values, meanCt) {
  if (!values.sdCtDependent || !Number.isFinite(meanCt)) return values.sdThreshold;
  return Math.max(values.sdThreshold, values.sdPoissonK * (poissonSd(meanCt) ?? POISSON_SD_3_COPIES));
}
// "c1 -RT", "c1 RT-", "c1_noRT", "NRT c1" → "c1": the sample a no-RT well was made from, as far as the name says.
export function nrtBaseName(s) {
  return String(s ?? "").toLowerCase()
    .replace(/(?:(?<![a-z0-9])(?:no[\s_-]?rt|nrt|minus[\s_-]?rt|rt[\s_-]?(?:minus|neg(?:ative)?)|nac)(?![a-z0-9])|[-−–]\s?rt(?![a-z0-9])|(?<![a-z0-9])rt[-−–](?![a-z0-9]))(?:[\s_-]*(?:control|ctrl)(?![a-z0-9]))?/g, " ")
    .replace(/^[\s_()[\]:,-]+|[\s_()[\]:,-]+$/g, "").replace(/\s+/g, " ");
}
const fmtRaw = v => (v == null ? "(empty)" : `'${v}'`);
const f2 = x => (x == null ? "—" : x.toFixed(2));
export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------- wells and values
const WELL_RE = /^([A-Pa-p])0*([1-9]\d?)$/;
export function wellKey(w) {
  const m = WELL_RE.exec(String(w ?? "").trim());
  if (!m) return null;
  const n = Number(m[2]);
  return n >= 1 && n <= 24 ? m[1].toUpperCase() + n : null;
}
export function wellOrder(k) {
  const key = wellKey(k);
  return key ? (key.charCodeAt(0) - 65) * 100 + Number(key.slice(1)) : 1e6;
}
const NO_AMP = new Set(["", "undetermined", "nan", "n/a", "na", "no ct", "no cq", "-", "none", "no amp"]);
export const isNoAmp = ct => ct == null || NO_AMP.has(String(ct).trim().toLowerCase());
// Parses a numeric string. dc = the file uses decimal commas (semicolon-separated exports from some locales).
export function toNum(v, dc = false) {
  if (v == null) return null;
  let t = String(v).trim();
  if (dc && /^-?\d+,\d+$/.test(t)) t = t.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
}
export const ctNum = (ct, dc = false) => (isNoAmp(ct) ? null : toNum(ct, dc));
const isNonNumeric = (ct, dc) => !isNoAmp(ct) && ctNum(ct, dc) === null;
const NTC_NAME_RE = /^(ntc|no[\s_-]?template([\s_-]?control)?|water|h2o|blank)$/i;
// No-RT controls are usually named after their sample: "c1 noRT", "c1 -RT", "c1_RT-", "NRT c1", "c1 minus RT".
export const NRT_NAME_RE = /(?:^|[\s_(-])(?:no[\s_-]?rt|minus[\s_-]?rt|nrt|rt[\s_-]?(?:neg|minus))(?=$|[\s_)-])|-rt(?=$|[\s_)])|(?:^|[\s_])rt-(?=$|[\s_)])/i;

export function normalizeRole(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(unkn|unknown|sample)/.test(s)) return "sample";
  if (/^(ntc|no[ _-]?template)/.test(s)) return "ntc";
  if (/^(std|standard)/.test(s)) return "standard";
  if (/^(pos|positive)/.test(s)) return "positive";
  if (/^(nrt|no[ _-]?rt|minus[ _-]?rt|-rt|nac)/.test(s)) return "nrt";
  if (/^(empty|unused)$/.test(s)) return "empty";
  return null; // e.g. "Neg Ctrl" is ambiguous and must be assigned by the user
}

// ---------------------------------------------------------------- delimited text
// Looks at the first line that has a delimiter in it (a title line on its own says nothing). On a tie, tab wins:
// tab-separated text often has commas inside cells, but CSV files almost never contain tabs.
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  const first = lines.find(l => /[,\t;]/.test(l)) || lines[0] || "";
  const count = ch => first.split(ch).length - 1;
  return ["\t", ",", ";"].map(d => [d, count(d)]).sort((a, b) => b[1] - a[1])[0][0];
}
export function splitDelimited(text, delim = detectDelimiter(text)) {
  const rows = []; let row = [], cell = "", q = false, line = 1, start = 1;
  const push = () => { row.push(cell); cell = ""; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else { if (c === "\n") line++; cell += c; }
    } else if (c === '"' && cell.trim() === "") { cell = ""; q = true; }
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      push(); rows.push({ cells: row, line: start }); row = []; line++; start = line;
    } else cell += c;
  }
  if (cell !== "" || row.length) { push(); rows.push({ cells: row, line: start }); }
  return rows.filter(r => r.cells.some(x => x.trim() !== ""));
}

const FIELD_ALIASES = {
  well: ["well position", "well", "pos", "position"],
  sample: ["sample", "sample name", "name"],
  target: ["target", "target name", "detector", "detector name", "gene", "assay"],
  ct: ["ct", "cq", "cт", "c_t", "crt", "cp"],
  role: ["role", "task", "content", "type"],
  quantity: ["quantity", "starting quantity (sq)", "sq", "qty"],
  group: ["group", "condition", "biological group", "biological set name"],
  bio_unit: ["bio_unit", "biological unit", "biological replicate", "bio rep"],
  pair: ["pair", "pair id", "pairing"],
  factor2: ["factor2", "factor 2", "second factor"], // two-way ANOVA (analysis module)
  fluor: ["fluor", "reporter", "dye"],
  omit: ["omit"],
};
export const FIELD_LABEL = { well: "Well", sample: "Sample", target: "Target", ct: "Ct/Cq", role: "Role / task",
  quantity: "Quantity", group: "Group", bio_unit: "Biological unit", pair: "Pair", factor2: "Second factor", fluor: "Fluorophore", omit: "Omit flag" };
const normHeader = h => String(h ?? "").trim().toLowerCase().replace(/\s+/g, " ");
function mapHeaders(headers) {
  const norm = headers.map(normHeader), columns = {}, names = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES))
    for (const a of aliases) { const i = norm.indexOf(a); if (i >= 0) { columns[field] = i; names[field] = headers[i].trim(); break; } }
  const used = new Set(Object.values(columns));
  // A field that more than one column could fill (two "Ct" columns, say). The first is used; the parser warns.
  const duplicates = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const idx = norm.map((n, i) => (aliases.includes(n) ? i : -1)).filter(i => i >= 0);
    if (idx.length > 1) duplicates[field] = idx.map(i => `“${headers[i].trim()}” (column ${i + 1})`);
  }
  const unrecognized = headers.map((h, i) => [String(h).trim(), i]).filter(([h, i]) => h && !used.has(i)).map(([h]) => h);
  return { columns, names, unrecognized, duplicates };
}

// ---------------------------------------------------------------- results parser (FR-2, FR-3, FR-26)
export function parseResults(input, opts = {}) {
  const text = String(input ?? "").replace(/^﻿/, "");
  if (!text.trim()) throw new ParseError("The file is empty.");
  const lines = text.split(/\r\n|\r|\n/).map(l => l.replace(/^﻿/, ""));
  // Instrument exports often put a metadata preamble before the table, so search for the header row.
  let hi = -1, delim = ",", firstCells = null;
  for (let i = 0; i < Math.min(lines.length, 500); i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*\*/.test(l) || /^\s*\[.+\]/.test(l)) continue;
    const d = detectDelimiter(l), cells = splitDelimited(l, d)[0]?.cells;
    if (!cells || cells.filter(c => c.trim()).length < 2) continue;
    firstCells ||= cells;
    const m = mapHeaders(cells);
    if ("well" in m.columns && "ct" in m.columns) { hi = i; delim = d; break; }
  }
  if (hi < 0) {
    const m = firstCells ? mapHeaders(firstCells) : { columns: {}, names: {} };
    const missing = ["well", "ct"].filter(f => !(f in m.columns));
    throw new ParseError(`Required column(s) not found: ${missing.map(f => FIELD_LABEL[f]).join(", ")}. No row in the first 500 lines has both a well and a Ct/Cq column.`,
      { recognized: m.names, headers: (firstCells || []).map(s => s.trim()).filter(Boolean) });
  }
  const metadata = {};
  for (const l of lines.slice(0, hi)) {
    const star = /^\*\s*([^=]+?)\s*=\s*(.*?)[,\t;]*$/.exec(l.trim());
    if (star) { metadata[star[1]] = star[2]; continue; }
    const cells = l.split(/[,\t;]/).map(s => s.trim()).filter(Boolean);
    const colon = /^([^:\t,]{2,60}):\s*(.+)$/.exec(l.trim());
    if (colon) metadata[colon[1]] = colon[2].replace(/\t/g, " ").trim();
    else if (cells.length === 2) metadata[cells[0]] = cells[1];
  }
  const preamble = lines.slice(0, hi).join("\n");
  const wellCol = mapHeaders(splitDelimited(lines[hi], delim)[0].cells).columns.well;
  const isHeader = l => FIELD_ALIASES.well.includes(normHeader(splitDelimited(l, delim)[0]?.cells[wellCol]));
  let end = lines.findIndex((l, i) => i > hi && (/^\s*\[.+\]/.test(l) || isHeader(l)));
  if (end < 0) end = lines.length;
  const rows = splitDelimited(lines.slice(hi, end).join("\n"), delim), offset = hi;
  const header = rows[0];
  const headerMap = mapHeaders(header.cells), { columns, names, unrecognized } = headerMap;
  const headers = header.cells.map(s => s.trim()).filter(Boolean);
  let format = "generic-ct-csv";
  if (/^\s*\[results\]/im.test(preamble) || "Block Type" in metadata || (/^well position$/i.test(names.well || "") && "omit" in columns)) format = "thermo-quantstudio";
  else if (/^SDS\s|SDS v\d|\.sds\b/im.test(preamble) || /^detector( name)?$/i.test(names.target || "")) format = "abi-sds";
  else if ("fluor" in columns && /^content$/i.test(names.role || "")) format = "biorad-cfx-cq";
  const width = header.cells.length, need = Math.max(columns.well, columns.ct) + 1;
  const out = [], malformed = [], warnings = [];
  // Footer: summary lines after the last row that has a well position or number (e.g. Slope / R², "Analysis Type").
  // Only a trailing block is cut, so a typo in the middle of the table is still reported, never dropped.
  const numericWells = !rows.slice(1).some(r => wellKey(r.cells[columns.well]));
  const wellLike = r => { const w = (r.cells[columns.well] ?? "").trim(); return !!wellKey(w) || (numericWells && /^\d+$/.test(w)); };
  let last = rows.length - 1;
  // Summary labels are words ("Average", "Slope"); a mistyped well is short and has a digit ("Z9", "A1O").
  const typoWell = r => { const w = (r.cells[columns.well] ?? "").trim(), c = (r.cells[columns.ct] ?? "").trim();
    return /^(?=.*\d)[A-Za-z0-9]{1,4}$/.test(w) && c !== "" && (ctNum(c) !== null || isNoAmp(c)); };
  while (last > 0 && !wellLike(rows[last]) && !typoWell(rows[last])) last--;
  const footer = rows.slice(last + 1);
  if (footer.length) warnings.push(`${footer.length} line(s) after the table (lines ${footer[0].line + offset}–${footer.at(-1).line + offset}) have no well position and were treated as a summary footer, not data.`);
  for (const r of rows.slice(1, last + 1)) {
    const line = r.line + offset;
    const extra = r.cells.slice(width).some(c => c.trim() !== "");
    if (r.cells.length < need || extra) {
      malformed.push({ line, reason: `expected up to ${width} fields with well and Ct/Cq present, found ${r.cells.length}`, raw: r.cells.join(" | ") });
      continue;
    }
    const get = f => (f in columns ? (r.cells[columns[f]] ?? "").trim() : "") || null;
    const roleRaw = get("role");
    out.push({ id: line, line, well: get("well") ?? "", key: wellKey(get("well")), sample: get("sample"), target: get("target"),
      ct: get("ct"), roleRaw, role: normalizeRole(roleRaw), quantity: get("quantity"), group: get("group"),
      bio_unit: get("bio_unit"), pair: get("pair"), factor2: get("factor2"), fluor: get("fluor"), omit: /^(true|yes|1)$/i.test(get("omit") || "") });
  }
  const decimalComma = delim === ";" && out.some(r => /^-?\d+,\d+$/.test(r.ct || ""));
  if (decimalComma) {
    for (const r of out) r.dc = true;
    warnings.push("Decimal commas were detected (for example “24,31”) and are read as decimal numbers. The raw values are kept unchanged.");
  }
  if (!out.length && !malformed.length) throw new ParseError("The header was found but there are no data rows.", { recognized: names, headers, format });
  if (malformed.length > out.length)
    throw new ParseError(`${malformed.length} of ${malformed.length + out.length} data rows could not be parsed, so no checks were run.`, { recognized: names, headers, format, malformed });
  // Some exports (e.g. SDS 2.x) number wells 1..N without positions. Positions depend on the plate size,
  // which is used only when the file states it, the numbers exceed 96, or the user chooses it. It is never guessed.
  let plateSize = null;
  if (out.length && out.every(r => /^\d+$/.test(r.well))) {
    const max = Math.max(...out.map(r => Number(r.well)));
    const stated = Object.entries(metadata).map(([k, v]) => `${k} ${v}`).join(" ").match(/\b(96|384)[- ]?well/i);
    plateSize = opts.plateSize || (stated ? Number(stated[1]) : max > 96 ? 384 : null);
    if (!plateSize) throw new ParseError(`The well column (“${names.well}”) holds numbers 1–${max} without plate positions, and the file does not state the plate size. Choose 96 or 384 wells so the numbers can be converted.`,
      { recognized: names, headers, format, needsPlateSize: true, maxWell: max });
    if (max > plateSize) throw new ParseError(`Well number ${max} does not fit a ${plateSize}-well plate.`, { recognized: names, headers, format, needsPlateSize: true, maxWell: max });
    const cols = plateSize === 384 ? 24 : 12;
    for (const r of out) { const i = Number(r.well) - 1; r.key = String.fromCharCode(65 + Math.floor(i / cols)) + ((i % cols) + 1); }
    warnings.push(`Well positions were derived from well numbers assuming a ${plateSize}-well plate numbered row by row (1 = A1, ${cols + 1} = B1)` +
      (opts.plateSize ? ", as you chose." : stated ? ", as stated in the file header." : `, because the largest well number is ${max}.`) + " Check a few wells against your plate layout.");
  }
  for (const [f, cols] of Object.entries(headerMap.duplicates || {}))
    warnings.push(`More than one column could be the ${FIELD_LABEL[f] || f} column: ${cols.join(" and ")}. I used the first one; check that it's the right one, and remove or rename the other column if not.`);
  if (!("target" in columns)) warnings.push("No target column was found. Assign targets in the plate map.");
  if (!("sample" in columns)) warnings.push("No sample column was found. Assign samples in the plate map.");
  if (out.some(r => r.omit)) warnings.push(`${out.filter(r => r.omit).length} well(s) are marked Omit in the instrument software. PlateCheck keeps and checks them, and flags them for review.`);
  const unmapped = [...new Set(out.filter(r => r.roleRaw && !r.role).map(r => r.roleRaw))];
  if (unmapped.length) warnings.push(`Role values not mapped automatically: ${unmapped.join(", ")}. Assign these roles in the plate map.`);
  if (malformed.length) warnings.push(`${malformed.length} row(s) could not be parsed and will be excluded from checks and reported.`);
  return { format, formatLabel: FORMATS[format], parserVersion: PARSER_VERSION, columns: names, unrecognized, headerLine: hi + 1,
    rows: out, malformed, metadata, warnings, plateSize, footerLines: footer.length, decimalComma };
}

// ---------------------------------------------------------------- curve parser (FR-11, FR-12)
const X_ALIASES = { amp: ["cycle", "cycle number", "cycles", "cycle #"], melt: ["temperature", "temp", "temperature (°c)", "temp (°c)", "temperature (c)"] };
const Y_ALIASES = {
  amp: ["delta rn", "δrn", "deltarn", "rfu", "fluorescence", "rn", "value"],
  melt: ["derivative", "-df/dt", "-d(rfu)/dt", "-rn'", "derivative reporter", "fluorescence", "rfu", "value"],
};
export function parseCurves(input, kind) {
  const text = String(input ?? "").replace(/^﻿/, "");
  const delim = detectDelimiter(text), dc = delim === ";", all = splitDelimited(text, delim);
  // The header is the first row with a cycle or temperature column. QuantStudio puts a block of run details above it.
  const hi = all.slice(0, 500).findIndex(r => r.cells.some(c => X_ALIASES[kind].includes(normHeader(c.trim()))));
  const rows = hi > 0 ? all.slice(hi) : all;
  if (rows.length < 2) throw new ParseError("The curve file has no data rows.");
  const hdr = rows[0].cells.map(s => s.trim()), norm = hdr.map(normHeader);
  const find = list => { for (const a of list) { const i = norm.indexOf(a); if (i >= 0) return i; } return -1; };
  const xi = find(X_ALIASES[kind]);
  if (xi < 0) throw new ParseError(`No ${kind === "amp" ? "cycle" : "temperature"} column was found.`, { headers: hdr.filter(Boolean) });
  const wi = find(FIELD_ALIASES.well), ti = find(FIELD_ALIASES.target);
  const series = {}; let malformed = 0, layout, yName;
  const add = (k, x, y) => {
    const X = toNum(x, dc), Y = toNum(y, dc);
    if (X === null || Y === null) { malformed++; return; }
    (series[k] ||= []).push([X, Y]);
  };
  if (wi >= 0) {
    const yi = find(Y_ALIASES[kind]);
    if (yi < 0) throw new ParseError("No fluorescence or derivative value column was found.", { headers: hdr.filter(Boolean) });
    layout = "long"; yName = hdr[yi];
    for (const r of rows.slice(1)) {
      const key = wellKey(r.cells[wi]);
      if (!key) { malformed++; continue; }
      add(`${key}|${ti >= 0 ? (r.cells[ti] || "").trim() : ""}`, r.cells[xi], r.cells[yi]);
    }
  } else {
    const wellCols = hdr.map((h, i) => [wellKey(h), i]).filter(([k]) => k);
    if (!wellCols.length) throw new ParseError("No well column and no well-named columns (A1, A2, …) were found.", { headers: hdr.filter(Boolean) });
    layout = "wide"; yName = "value";
    for (const r of rows.slice(1)) for (const [k, i] of wellCols) add(`${k}|`, r.cells[xi], r.cells[i]);
  }
  for (const s of Object.values(series)) s.sort((a, b) => a[0] - b[0]);
  if (!Object.keys(series).length) throw new ParseError("No numeric curve values were found.", { headers: hdr.filter(Boolean) });
  let guessedValueType = null;
  if (kind === "melt") {
    if (layout === "long") guessedValueType = /deriv|df\/dt|d\(rfu\)|rn'/i.test(yName) ? "derivative" : "fluorescence";
    else { // raw melt fluorescence falls steadily with temperature; derivative curves peak
      const falling = Object.values(series).filter(s => s.length > 4 && s[0][1] > 2 * Math.abs(s[s.length - 1][1]) && s[0][1] > 0).length;
      guessedValueType = falling > Object.keys(series).length / 2 ? "fluorescence" : "derivative";
    }
  }
  const wells = [...new Set(Object.keys(series).map(k => k.split("|")[0]))].sort((a, b) => wellOrder(a) - wellOrder(b));
  return { kind, layout, xName: hdr[xi], yName, series, wells, malformed,
    points: Object.values(series).reduce((a, s) => a + s.length, 0), guessedValueType, parserVersion: PARSER_VERSION };
}

function curveStats(pts) {
  let base = pts.filter(p => p[0] >= 3 && p[0] <= 15);
  if (base.length < 3) base = pts.slice(0, Math.max(3, Math.floor(pts.length / 4)));
  const s = stats(base.map(p => p[1]));
  const mean = s.mean ?? 0, sd = s.sd ?? 0;
  return { mean, sd, delta: Math.max(...pts.map(p => p[1])) - mean };
}
function crossing(pts, mean, T) {
  const from = pts.findIndex(p => p[0] >= 3);
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const a = pts[i - 1][1] - mean, b = pts[i][1] - mean;
    if (a < T && b >= T) return pts[i - 1][0] + ((T - a) * (pts[i][0] - pts[i - 1][0])) / (b - a);
  }
  return null;
}
function meltStats(pts, isDerivative) {
  let d = isDerivative ? pts.map(p => [p[0], p[1]]) : pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return [p[0], b[0] === a[0] ? 0 : -(b[1] - a[1]) / (b[0] - a[0])];
  });
  d = d.map((p, i) => [p[0], (d[Math.max(0, i - 1)][1] + p[1] + d[Math.min(d.length - 1, i + 1)][1]) / 3]);
  const peaks = [];
  for (let i = 1; i < d.length - 1; i++) if (d[i][1] > d[i - 1][1] && d[i][1] >= d[i + 1][1]) peaks.push({ t: d[i][0], h: d[i][1] });
  peaks.sort((a, b) => b.h - a.h);
  return { curve: d, main: peaks[0] || null, peaks };
}

// ---------------------------------------------------------------- plate-map templates (FR-4)
export function parseTemplate(input) {
  const rows = splitDelimited(String(input ?? "").replace(/^﻿/, ""));
  if (rows.length < 2) throw new ParseError("The plate-map template has no rows.");
  const { columns } = mapHeaders(rows[0].cells);
  if (!("well" in columns)) throw new ParseError("The plate-map template needs a well column.");
  const fields = ["sample", "target", "group", "role", "bio_unit", "quantity", "pair", "factor2"].filter(f => f in columns);
  if (!fields.length) throw new ParseError("The template has no recognised columns (sample, target, group, role, bio_unit, quantity).");
  const entries = [], invalid = [];
  for (const r of rows.slice(1)) {
    const w = (r.cells[columns.well] || "").trim(), key = wellKey(w);
    if (!key) { invalid.push({ line: r.line, well: w }); continue; }
    const e = { key, line: r.line };
    for (const f of fields) { const val = (r.cells[columns[f]] ?? "").trim(); e[f] = f === "role" && val ? normalizeRole(val) ?? val : val; }
    entries.push(e);
  }
  return { fields, entries, invalid };
}
export function applyTemplate(exp, rows, tpl, meta) {
  const changes = [], issues = tpl.invalid.map(i => `line ${i.line}: '${i.well}' is not a plate position`);
  for (const t of tpl.entries) {
    let hits = rows.filter(r => r.key === t.key);
    if (t.target && hits.length > 1) { const m = hits.filter(r => r.file.target === t.target || r.target === t.target); if (m.length) hits = m; }
    for (const r of hits) for (const f of tpl.fields) {
      const val = t[f];
      if (val === "") continue; // an empty template cell leaves the current value
      if (f === "role" && !ROLES.includes(val)) { issues.push(`line ${t.line}: role '${val}' is not recognised`); continue; }
      const old = r[f] ?? "";
      if (old === val) continue;
      exp.map[r.id] = { ...exp.map[r.id], [f]: val };
      changes.push(`${r.key} (line ${r.line}) ${f}: "${old}" → "${val}"`);
    }
  }
  exp.template = { ...meta, wells: [...new Set(tpl.entries.map(e => e.key))] };
  return { changes, issues };
}
export function mapTemplateCsv(rows) {
  const pair = rows.some(r => r.pair), f2 = rows.some(r => r.factor2); // these columns only when the label is in use
  return toCsv([["well", "sample", "target", "group", "role", "bio_unit", "quantity", ...(pair ? ["pair"] : []), ...(f2 ? ["factor2"] : [])],
    ...rows.filter(r => r.key).map(r => [r.key, r.sample, r.target, r.group, r.role, r.bioSource?.startsWith("default") ? "" : r.bio_unit, r.quantity, ...(pair ? [r.pair] : []), ...(f2 ? [r.factor2] : [])])]);
}
export function toCsv(rows) {
  return rows.map(r => r.map(c => { const s = String(c ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(",")).join("\n") + "\n";
}

// ---------------------------------------------------------------- experiments
export function newId() {
  const b = new Uint8Array(4); crypto.getRandomValues(b);
  return `AL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${[...b].map(x => x.toString(16).padStart(2, "0")).join("")}`;
}
export function logAudit(exp, actor, action, detail) {
  const at = new Date().toISOString();
  exp.audit.push({ at, actor: actor || "local user", action, detail });
  exp.updated = at;
}
export function newExperiment(fields = {}, actor) {
  const now = new Date().toISOString();
  const exp = normalizeExperiment({ schema: 1, id: newId(), title: fields.title || "Untitled qPCR run", assay: "qPCR",
    date: fields.date || now.slice(0, 10), project: fields.project || "", operator: fields.operator || "",
    created: now, updated: now });
  logAudit(exp, actor, "experiment.create", `Created experiment ${exp.id} (app ${APP_VERSION})`);
  return exp;
}
// Checks every field of a saved or imported experiment and repairs what it can, so damaged storage or a
// hand-edited run file cannot crash the app later. Throws a ParseError only when nothing usable is left.
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const asStr = (v, d = "") => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : d);
function cleanFile(f, kind) {
  if (!isObj(f) || typeof f.text !== "string" || !f.text) return null;
  const out = { name: asStr(f.name) || "file", sha256: asStr(f.sha256), text: f.text, importedAt: asStr(f.importedAt) || new Date().toISOString(),
    importedBy: asStr(f.importedBy) || "unknown", parserVersion: asStr(f.parserVersion) || PARSER_VERSION };
  if (kind === "source") { out.format = asStr(f.format) in FORMATS ? f.format : "generic-ct-csv"; out.plateSize = [96, 384].includes(f.plateSize) ? f.plateSize : null; }
  if (kind === "melt") out.valueType = f.valueType === "fluorescence" ? "fluorescence" : "derivative";
  if (isObj(f.workbook) && asStr(f.workbook.name)) out.workbook = { name: asStr(f.workbook.name), sheet: asStr(f.workbook.sheet), sha256: asStr(f.workbook.sha256) };
  return out;
}
function cleanValues(v) {
  const out = { ...DEFAULT_PROFILE.values };
  if (isObj(v)) for (const f of RULESET_FIELDS) {
    if (f.type === "bool" && typeof v[f.key] === "boolean") out[f.key] = v[f.key];
    if (f.type === "number" && typeof v[f.key] === "number" && Number.isFinite(v[f.key]) && v[f.key] >= 0) out[f.key] = v[f.key];
  }
  return out;
}
// Analysis module settings (see web/analysis.js and docs/analysis.md). null means the analysis was never switched on.
// Statistical tests offered in the Analysis step (web/analysis.js); "welch" is the default.
export const ANALYSIS_TESTS = ["welch", "student", "paired", "wilcoxon", "tukey", "gameshowell", "dunnett", "mannwhitney", "kruskal"];
export function cleanAnalysisSettings(a) {
  if (!isObj(a)) return null;
  const names = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && x.trim()).map(x => x.slice(0, 200)))].slice(0, 100) : []);
  const shift = a.refMaxShift;
  return { on: a.on === true, refs: names(a.refs), control: asStr(a.control).slice(0, 200), efficiency: a.efficiency === true,
    error: ["sem", "ci"].includes(a.error) ? a.error : "sd", correction: a.correction === "bonferroni" ? "bonferroni" : "bh", skipOmitted: a.skipOmitted !== false,
    excluded: names(a.excluded), scale: a.scale === "linear" ? "linear" : "log2", test: ANALYSIS_TESTS.includes(a.test) ? a.test : "welch",
    refMaxShift: typeof shift === "number" && Number.isFinite(shift) && shift > 0 && shift <= 10 ? shift : 0.5,
    twoWay: ["factor2", "plate"].includes(a.twoWay) ? a.twoWay : "", // second factor for a two-way ANOVA; "" = none
    gsea: cleanGsea(a.gsea) }; // [gsea] gene set enrichment settings (web/gsea.js)
}
// [gsea] Settings of the gene set enrichment card. source "" means none chosen, so nothing is worked out by default.
// GMT files are kept only as the sets that touch the panel (genes on the panel, plus each set's full size).
function cleanGsea(g) {
  if (!isObj(g)) g = {};
  const int = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const gene = x => typeof x === "string" && x.trim() && x.length <= 60;
  const sets = (v, max) => (Array.isArray(v) ? v : []).filter(s => isObj(s) && asStr(s.name).trim() && Array.isArray(s.genes)).slice(0, max)
    .map(s => ({ name: asStr(s.name).trim().slice(0, 200), genes: [...new Set(s.genes.filter(gene).map(x => x.trim()))].slice(0, 2000), ...(Number.isInteger(s.total) && s.total > 0 ? { total: s.total } : {}) }))
    .filter(s => s.genes.length);
  const gmt = isObj(g.gmt) ? { name: asStr(g.gmt.name).slice(0, 200), sets: sets(g.gmt.sets, 5000), read: int(g.gmt.read, 0, 1e6, 0), offPanel: int(g.gmt.offPanel, 0, 1e7, 0) } : null;
  return { source: ["gmt", "go", "custom"].includes(g.source) ? g.source : "", method: ["rank", "gsea"].includes(g.method) ? g.method : "auto",
    group: asStr(g.group).slice(0, 200), stat: g.stat === "t" ? "t" : "logp", minSize: int(g.minSize, 2, 1000, 3), maxSize: int(g.maxSize, 0, 1000, 0),
    nperm: int(g.nperm, 100, 10000, 1000), seed: int(g.seed, 1, 2 ** 31 - 1, 1), goTerms: g.goTerms === true,
    gmt: gmt && gmt.sets.length ? gmt : null, custom: sets(g.custom, 200), plotSet: asStr(g.plotSet).slice(0, 200) };
}
export function normalizeExperiment(exp) {
  if (!isObj(exp)) throw new ParseError("This saved run is damaged and can't be opened.");
  const now = new Date().toISOString();
  exp.schema = 1; exp.assay = "qPCR";
  exp.id = asStr(exp.id) || newId();
  exp.title = asStr(exp.title).slice(0, 300) || "Untitled qPCR run";
  exp.date = /^\d{4}-\d{2}-\d{2}/.test(asStr(exp.date)) ? asStr(exp.date).slice(0, 10) : now.slice(0, 10);
  exp.project = asStr(exp.project); exp.operator = asStr(exp.operator);
  exp.created = asStr(exp.created) || now; exp.updated = asStr(exp.updated) || now;
  exp.source = cleanFile(exp.source, "source"); exp.amp = cleanFile(exp.amp, "amp"); exp.melt = cleanFile(exp.melt, "melt");
  exp.template = isObj(exp.template) && Array.isArray(exp.template.wells)
    ? { name: asStr(exp.template.name) || "plate map", sha256: asStr(exp.template.sha256), importedAt: asStr(exp.template.importedAt) || now, importedBy: asStr(exp.template.importedBy), wells: exp.template.wells.filter(w => typeof w === "string") } : null;
  exp.feedback = isObj(exp.feedback) && typeof exp.feedback.value === "string" ? { value: exp.feedback.value, by: asStr(exp.feedback.by), at: asStr(exp.feedback.at) || now } : null;
  const map = {};
  if (isObj(exp.map)) for (const [id, m] of Object.entries(exp.map)) {
    if (!isObj(m)) continue;
    const e = {};
    for (const k of ["sample", "target", "group", "bio_unit", "quantity", "pair", "factor2"]) if (typeof m[k] === "string") e[k] = m[k];
    if (ROLES.includes(m.role)) e.role = m.role;
    if (Object.keys(e).length) map[id] = e;
  }
  exp.map = map;
  exp.context = isObj(exp.context) ? Object.fromEntries(Object.entries(exp.context).filter(([, v]) => typeof v === "string")) : {};
  exp.controlNA = isObj(exp.controlNA) ? Object.fromEntries(Object.entries(exp.controlNA).filter(([, v]) => isObj(v) && asStr(v.reason))
    .map(([k, v]) => [k, { reason: asStr(v.reason), by: asStr(v.by) || "unknown", at: asStr(v.at) || now }])) : {};
  const reviews = {};
  if (isObj(exp.reviews)) for (const [id, r] of Object.entries(exp.reviews)) {
    if (!isObj(r)) continue;
    reviews[id] = { ...(DISPOSITIONS.includes(r.disposition) ? { disposition: r.disposition } : {}), ...(typeof r.note === "string" ? { note: r.note } : {}),
      by: asStr(r.by) || "unknown", at: asStr(r.at) || now, rule: asStr(r.rule), rule_version: asStr(r.rule_version), title: asStr(r.title), description: asStr(r.description) };
  }
  exp.reviews = reviews;
  exp.targets = cleanTargets(exp.targets); // genes and RNA types per target (web/genes.js)
  exp.audit = Array.isArray(exp.audit) ? exp.audit.filter(isObj).map(a => ({ at: asStr(a.at) || now, actor: asStr(a.actor) || "unknown", action: asStr(a.action) || "note", detail: asStr(a.detail) })) : [];
  const rs = isObj(exp.ruleset) ? exp.ruleset : {}, pr = isObj(rs.profile) ? rs.profile : {};
  exp.ruleset = { profile: { id: asStr(pr.id) || DEFAULT_PROFILE.id, name: asStr(pr.name) || DEFAULT_PROFILE.name, version: Number.isFinite(pr.version) ? pr.version : 1 },
    values: cleanValues(rs.values), base: cleanValues(rs.base) };
  exp.analysis = cleanAnalysisSettings(exp.analysis); // analysis module settings
  return exp;
}
export function fileRecord({ name, text, sha, actor, ...extra }) {
  return { name, sha256: sha, text, importedAt: new Date().toISOString(), importedBy: actor || "local user", parserVersion: PARSER_VERSION, ...extra };
}

// Rows with plate-map edits applied. File values are kept alongside, never overwritten.
export function effectiveRows(exp, parsed) {
  return parsed.rows.map(r => {
    const m = exp.map?.[r.id] || {};
    const take = f => (f in m ? [m[f] === "" ? null : m[f], "user"] : r[f] != null ? [r[f], "file"] : [null, null]);
    const [sample, sampleSource] = take("sample"), [target, targetSource] = take("target");
    const [group] = take("group"), [quantity] = take("quantity"), [pair] = take("pair"), [factor2] = take("factor2");
    let role, roleSource;
    if (ROLES.includes(m.role)) [role, roleSource] = [m.role, "user"];
    else if (sample && NTC_NAME_RE.test(sample.trim()) && (!r.role || r.role === "sample"))
      [role, roleSource] = ["ntc", r.role ? `inferred from sample name (file task '${r.roleRaw}')` : "inferred from sample name"];
    else if (sample && NRT_NAME_RE.test(sample.trim()) && (!r.role || r.role === "sample"))
      [role, roleSource] = ["nrt", r.role ? `inferred from sample name (file task '${r.roleRaw}')` : "inferred from sample name"];
    else if (r.role) [role, roleSource] = [r.role, "file"];
    else [role, roleSource] = ["sample", r.roleRaw ? `default (file role '${r.roleRaw}' not recognised)` : "default"];
    let [bio_unit, bioSource] = take("bio_unit");
    if (!bio_unit && bioSource !== "user") { bio_unit = sample; bioSource = sample ? "default (sample name)" : null; }
    return { id: r.id, line: r.line, well: r.well, key: r.key, ct: r.ct, dc: r.dc, fluor: r.fluor,
      sample, sampleSource, target, targetSource, group, quantity, pair, factor2, role, roleSource, roleRaw: r.roleRaw,
      fileRoleUnmapped: !!(r.roleRaw && !r.role), bio_unit, bioSource, omit: r.omit,
      file: { sample: r.sample, target: r.target, group: r.group, role: r.role ?? r.roleRaw, bio_unit: r.bio_unit, quantity: r.quantity, pair: r.pair, factor2: r.factor2 } };
  });
}

// ---------------------------------------------------------------- analysis
export function summarize(findings, reviews = {}, hasData = true) {
  const real = findings.filter(f => f.severity !== "info");
  const isOpen = f => !CLOSED.has(reviews[f.id]?.disposition);
  const open = real.filter(isOpen);
  const status = !hasData ? "no_data" : open.some(f => f.severity === "high" || f.severity === "medium") ? "review_needed"
    : real.length ? "findings_present" : "no_flags";
  const count = (list, key) => Object.fromEntries([...groupBy(list, f => f[key])].map(([k, v]) => [k, v.length]));
  return { status, label: STATUS_LABEL[status] + (status === "findings_present" && !open.length ? " (all reviewed)" : ""),
    total: real.length, open: open.length, reviewed: real.filter(f => reviews[f.id]?.disposition && reviews[f.id].disposition !== "unreviewed").length,
    bySeverity: count(findings, "severity"), byCategory: count(findings, "category") };
}

const SEV_RANK = { high: 0, medium: 1, low: 2, info: 3 };
export function analyze(exp) {
  const v = exp.ruleset.values;
  const res = { findings: [], notAssessed: [], checksRun: [], replicateGroups: [], bioSummary: [], controls: [], stdCurves: [],
    amp: null, melt: null, parsed: null, rows: [], ruleset: { id: rulesetId(exp.ruleset), ...exp.ruleset }, appVersion: APP_VERSION };
  const add = (rule, key, o) => {
    const r = RULES[rule];
    res.findings.push({ id: `${rule}:${key}`, rule, rule_version: r.version, category: r.category, severity: r.severity,
      title: r.title, why: r.why, wells: [], lines: [], target: null, sample: null, uncertain: false, ...o });
  };
  if (!exp.source) {
    res.notAssessed.push("All checks: no results file has been imported yet.");
    res.summary = summarize([], exp.reviews, false);
    return res;
  }
  const parsed = res.parsed = parseResults(exp.source.text, { plateSize: exp.source.plateSize });
  const rows = res.rows = effectiveRows(exp, parsed);
  const active = rows.filter(r => r.role !== "empty");
  const wl = rs => rs.map(r => r.key || r.well), ln = rs => rs.map(r => r.line);
  const at = r => ({ wells: [r.key || r.well], lines: [r.line], target: r.target, sample: r.sample });
  const name = r => r.key || `'${r.well}'`;

  // Structure (FR-8)
  res.checksRun.push("Structure: row parsing, well coordinates, duplicate wells, labels and roles, Ct/Cq values" +
    (exp.template ? ", plate-map template coverage" : "") + ", biological unit grouping");
  for (const m of parsed.malformed)
    add("malformed_row", m.line, { description: `Source line ${m.line} was not parsed: ${m.reason}.`, lines: [m.line],
      evidence: `raw fields: ${m.raw}`, next_check: "Open the original file at this line and check for missing, extra or unquoted delimiters." });
  for (const r of rows) if (!r.key)
    add("invalid_well_coordinate", r.line, { ...at(r), description: `Well '${r.well}' is not a valid plate position.`,
      evidence: `source line ${r.line}: well '${r.well}', raw Ct ${fmtRaw(r.ct)}`, next_check: "Check the export for a column shift or typo." });
  for (const [k, rs] of groupBy(rows, r => `${r.key || r.well.toUpperCase()}|${r.target ?? ""}`)) if (rs.length > 1)
    add("duplicate_well_assignment", k, { wells: [rs[0].key || rs[0].well], lines: ln(rs), target: rs[0].target,
      description: `Well ${name(rs[0])} has ${rs.length} results for target '${rs[0].target ?? "(none)"}'.`,
      evidence: `source lines ${ln(rs).join(", ")}; raw Ct ${rs.map(r => fmtRaw(r.ct)).join(", ")}`,
      next_check: "Confirm the plate map; one well should hold one reaction per target. Neither value was dropped." });
  for (const r of rows) if (r.fileRoleUnmapped && r.roleSource !== "user")
    add("unmapped_role", r.line, { ...at(r), description: `Well ${name(r)} has role '${r.roleRaw}' in the file, which PlateCheck does not map automatically.`,
      evidence: `source line ${r.line}; currently treated as '${r.role}'`, next_check: "Assign the intended role (for example NTC or no-RT) in the plate map." });
  for (const r of rows.filter(r => r.omit))
    add("instrument_omit", r.line, { ...at(r), description: `Well ${name(r)}${r.target ? ` (${r.sample ? `${r.sample} / ` : ""}${r.target})` : ""} is marked Omit in the instrument export.`,
      evidence: `source line ${r.line}; raw Ct ${fmtRaw(r.ct)}`, next_check: "Record why it was omitted. PlateCheck still includes it in every check; set the role to Empty if it should be left out of replicate and control checks." });
  for (const r of active) {
    const needsSample = ["sample", "positive", "nrt"].includes(r.role);
    if (!r.target || (needsSample && !r.sample))
      add("unmapped_well", r.line, { ...at(r), description: `Well ${name(r)} has no ${!r.target ? "target" : "sample"} label.`,
        evidence: `source line ${r.line}; role ${r.role}`, next_check: "Add the label in the plate map, or mark the well empty." });
  }
  for (const r of rows) {
    if (r.role === "empty") {
      if (ctNum(r.ct, r.dc) !== null) add("empty_well_signal", r.line, { ...at(r), description: `Well ${name(r)} is marked empty but reports Ct ${r.ct}.`,
        evidence: `source line ${r.line}`, next_check: "Check the plate map against the physical plate." });
      continue;
    }
    if (isNonNumeric(r.ct, r.dc))
      add("non_numeric_ct", r.line, { ...at(r), description: `Well ${name(r)} has a non-numeric Ct/Cq ${fmtRaw(r.ct)}.`,
        evidence: `source line ${r.line}`, next_check: "Inspect the raw export. The value was left unchanged and excluded from statistics." });
    else if (isNoAmp(r.ct) && (r.role === "sample" || r.role === "standard"))
      add("missing_ct", r.line, { ...at(r), description: `Well ${name(r)} (${r.sample ?? "no sample"} / ${r.target ?? "no target"}) has no Ct/Cq value.`,
        evidence: `source line ${r.line}; raw value ${fmtRaw(r.ct)}`, next_check: "Check whether non-amplification is expected for this sample, and inspect the curve if available." });
  }
  if (exp.template) {
    const dataKeys = new Set(rows.map(r => r.key).filter(Boolean)), tKeys = new Set(exp.template.wells);
    const notInData = [...tKeys].filter(k => !dataKeys.has(k)).sort((a, b) => wellOrder(a) - wellOrder(b));
    const notInMap = [...dataKeys].filter(k => !tKeys.has(k)).sort((a, b) => wellOrder(a) - wellOrder(b));
    if (notInData.length) add("map_wells_not_in_data", "all", { wells: notInData,
      description: `${notInData.length} well(s) in the plate-map template have no result in the data file.`,
      evidence: `template ${exp.template.name}: ${notInData.join(", ")}`, next_check: "Confirm you imported the right results file and plate orientation." });
    if (notInMap.length) add("data_wells_not_in_map", "all", { wells: notInMap,
      description: `${notInMap.length} well(s) with results are not in the plate-map template.`,
      evidence: `not in ${exp.template.name}: ${notInMap.join(", ")}`, next_check: "Add these wells to the template or confirm the labels from the file are correct." });
  }
  const unitGroups = groupBy(active.filter(r => r.role === "sample" && r.group && r.bio_unit), r => r.bio_unit);
  for (const [u, rs] of unitGroups) {
    const gs = [...new Set(rs.map(r => r.group))];
    if (gs.length > 1) add("bio_unit_in_multiple_groups", u, { wells: wl(rs), lines: ln(rs), sample: u,
      description: `Biological unit '${u}' appears in groups ${gs.map(g => `'${g}'`).join(" and ")}.`,
      evidence: gs.map(g => `${g}: ${wl(rs.filter(r => r.group === g)).join(", ")}`).join("; "),
      next_check: "Correct the group or biological unit labels in the plate map." });
  }

  // Replicates (FR-5, FR-10)
  res.checksRun.push(`Technical replicates: sample SD of Ct/Cq within each biological unit × target (threshold ${v.sdThreshold} cycles` +
    (v.sdCtDependent ? `, or ${v.sdPoissonK} × the Poisson sampling SD expected at the group's mean Ct when that is larger)` : ")"));
  const repRows = active.filter(r => ["sample", "positive", "standard"].includes(r.role) && r.target);
  for (const [k, rs] of groupBy(repRows, r => `${r.role === "standard" ? `standard @ ${r.quantity ?? "?"}` : r.bio_unit ?? ""}\u0000${r.target}`)) {
    const unit = k.split("\u0000")[0];
    if (!unit) continue;
    const vals = rs.map(r => ctNum(r.ct, r.dc)).filter(x => x !== null), s = stats(vals);
    const g = { unit, target: rs[0].target, group: rs[0].group, role: rs[0].role, wells: wl(rs), lines: ln(rs), raw_ct: rs.map(r => r.ct),
      n: rs.length, n_numeric: vals.length, mean: s.mean, sd: s.sd, threshold: sdLimit(v, s.mean) };
    g.over = s.sd !== null && s.sd > g.threshold;
    res.replicateGroups.push(g);
    const raw = g.raw_ct.map(fmtRaw).join(", ");
    if (g.over) add("replicate_dispersion", k, { wells: g.wells, lines: g.lines, target: g.target, sample: unit,
      description: `Technical replicates for ${unit} / ${g.target} have SD ${g.sd.toFixed(3)} cycles.`,
      evidence: `raw Ct ${raw}; mean ${g.mean.toFixed(2)}; sample SD ${g.sd.toFixed(3)} > threshold ${g.threshold > v.sdThreshold ? `${g.threshold.toFixed(3)} (${v.sdPoissonK} × the Poisson sampling SD expected at this mean Ct; fixed threshold ${v.sdThreshold})` : v.sdThreshold}`,
      next_check: "Inspect the individual wells and their curves. No value was removed or down-weighted." });
  }
  const single = res.replicateGroups.filter(g => g.sd === null && g.role === "sample");
  if (single.length > 5) add("insufficient_replicates", "all", { wells: single.flatMap(g => g.wells), lines: single.flatMap(g => g.lines),
    description: `${single.length} sample/target groups have fewer than two numeric Ct/Cq values, so their spread was not assessed.`,
    evidence: single.slice(0, 12).map(g => `${g.unit} / ${g.target}: ${g.raw_ct.map(fmtRaw).join(", ")}`).join("; ") + (single.length > 12 ? `; … ${single.length - 12} more` : ""),
    next_check: "If technical replicates were run, check the sample and biological unit labels in the plate map; otherwise this is expected." });
  else for (const g of single) add("insufficient_replicates", `${g.unit}\u0000${g.target}`, { wells: g.wells, lines: g.lines, target: g.target, sample: g.unit,
    description: `${g.unit} / ${g.target} has ${g.n_numeric} numeric Ct/Cq value(s) in ${g.n} well(s); spread was not assessed.`,
    evidence: `raw Ct ${g.raw_ct.map(fmtRaw).join(", ")}`, next_check: "Confirm whether technical replicates were planned for this sample and target." });
  // Late Ct: one note per target, listing the sample groups past the setting.
  if (v.lateCtThreshold > 0) {
    res.checksRun.push(`Late Ct: sample groups with a mean Ct/Cq above ${v.lateCtThreshold} are noted as low copy number`);
    const sampleGroups = res.replicateGroups.filter(g => g.role === "sample" && g.mean !== null);
    for (const [t, gs] of groupBy(sampleGroups.filter(g => g.mean > v.lateCtThreshold), g => g.target)) {
      const one = g => `${g.unit}: mean Ct ${g.mean.toFixed(2)}${g.sd !== null ? ` (SD ${g.sd.toFixed(2)}, n = ${g.n_numeric})` : ` (n = ${g.n_numeric})`}`;
      add("late_ct", t, { wells: gs.flatMap(g => g.wells), lines: gs.flatMap(g => g.lines), target: t, sample: gs.length === 1 ? gs[0].unit : null,
        description: `${gs.length} of ${sampleGroups.filter(g => g.target === t).length} sample group(s) for '${t}' have a mean Ct above ${v.lateCtThreshold}.`,
        evidence: gs.slice(0, 12).map(one).join("; ") + (gs.length > 12 ? `; … ${gs.length - 12} more` : "") + ". About 10 copies per well reach Ct 35 at 90–100% efficiency",
        next_check: "Read these as detected or not detected rather than as exact quantities, or run more replicates or more template. If you have measured this assay's limit of quantification, set that Ct under Context & rules." });
    }
  } else res.notAssessed.push("Late Ct: the late-Ct note is switched off in the rule set.");
  for (const [, rs] of groupBy(active.filter(r => r.role === "sample" && r.target && r.bio_unit), r => `${r.group ?? ""}\u0000${r.target}`)) {
    const units = [...new Set(rs.map(r => r.bio_unit))];
    res.bioSummary.push({ group: rs[0].group, target: rs[0].target, units, wells: rs.length });
  }
  if (active.length && !rows.some(r => r.bioSource === "file" || r.bioSource === "user"))
    add("replicate_structure_inferred", "all", { description: "No biological units were labelled, so each sample name was treated as one biological unit.",
      evidence: "no biological unit column in the file and no plate-map edits", next_check: "Label biological units in the plate map if sample names do not identify independent samples." });

  // Controls (FR-9)
  const targets = [...new Set(active.map(r => r.target).filter(Boolean))];
  const CTRL = [["ntc", "expectNtc", "No-template control (NTC)"], ["positive", "expectPositive", "Positive control"], ["nrt", "expectNrt", "No-RT control"]];
  const expected = CTRL.filter(c => v[c[1]]).map(c => c[2]);
  res.checksRun.push(`Controls: expected for every target: ${expected.join(", ") || "none"}; behaviour of all NTC, positive and no-RT wells present (NTC rated high below Ct ${v.ntcCtThreshold}` + (v.nrtMargin > 0 ? `; an amplifying no-RT should trail its samples by ${v.nrtMargin} cycles)` : ")"));
  for (const c of CTRL) if (!v[c[1]]) res.notAssessed.push(`${c[2]}s: not expected by the selected rule set, so their absence is not flagged. Any that are present are still checked.`);
  for (const t of targets) for (const [role, flag, label] of CTRL) {
    const ws = active.filter(r => r.target === t && r.role === role), na = exp.controlNA?.[`${role}|${t}`];
    res.controls.push({ target: t, role, label, expected: !!v[flag], wells: wl(ws), na: na ? na.reason : null,
      amplified: ws.filter(r => ctNum(r.ct, r.dc) !== null).map(r => `${name(r)} (Ct ${r.ct})`) });
    if (v[flag] && !ws.length) {
      if (na) add("control_not_applicable", `${role}|${t}`, { target: t, description: `${label} for '${t}' marked not applicable.`,
        evidence: `reason: ${na.reason} (${na.by}, ${na.at.slice(0, 10)})`, next_check: "None." });
      else add("missing_control", `${role}|${t}`, { target: t, description: `No ${label.toLowerCase()} was found for target '${t}'.`,
        evidence: `expectation from rule set ${rulesetId(exp.ruleset)}; no well for '${t}' has role '${role}'`,
        next_check: "Assign the control's role in the plate map, or mark it not applicable with a reason on the Context tab." });
    }
    for (const r of ws) {
      const c = ctNum(r.ct, r.dc);
      if (role === "ntc" && c !== null) add("ntc_amplification", r.line, { ...at(r), uncertain: true, severity: c < v.ntcCtThreshold ? "high" : "medium",
        description: `NTC well ${name(r)} for '${t}' amplified (Ct ${r.ct}).`,
        evidence: `source line ${r.line}; Ct ${r.ct} ${c < v.ntcCtThreshold ? "<" : "≥"} threshold ${v.ntcCtThreshold}`,
        next_check: "Review the amplification and melt curves for this well. Compare its Tm with the product; consider repeating with fresh reagents." });
      if (role === "positive" && isNoAmp(r.ct)) add("positive_control_failed", r.line, { ...at(r),
        description: `Positive control ${name(r)} for '${t}' did not amplify.`, evidence: `source line ${r.line}; raw Ct ${fmtRaw(r.ct)}`,
        next_check: "Check the positive control template and the reaction setup before interpreting negatives for this target." });
      if (role === "nrt" && c !== null) {
        const sc = active.filter(x => x.target === t && x.role === "sample").map(x => ctNum(x.ct, x.dc)).filter(x => x !== null);
        const minS = sc.length ? Math.min(...sc) : null;
        add("nrt_amplification", r.line, { ...at(r), uncertain: true, description: `No-RT control ${name(r)} for '${t}' amplified (Ct ${r.ct}).`,
          evidence: `source line ${r.line}` + (minS !== null ? `; ${(c - minS).toFixed(1)} cycles after the earliest sample well (Ct ${minS})` : ""),
          next_check: "Assess possible genomic DNA contribution, for example DNase treatment or intron-spanning primers." });
        // Margin to the samples this no-RT controls: the sample it was made from if the names say so, otherwise the whole target.
        const samples = active.filter(x => x.target === t && x.role === "sample" && ctNum(x.ct, x.dc) !== null);
        const names = new Set([nrtBaseName(r.sample), (r.bioSource === "file" || r.bioSource === "user") && r.bio_unit ? String(r.bio_unit).toLowerCase() : ""].filter(Boolean));
        const own = samples.filter(x => names.has(String(x.sample ?? "").toLowerCase()) || names.has(String(x.bio_unit ?? "").toLowerCase()));
        const used = own.length ? own : samples;
        if (v.nrtMargin > 0 && used.length) {
          const mean = stats(used.map(x => ctNum(x.ct, x.dc))).mean, margin = c - mean;
          const share = margin > 0 ? `about ${(100 / 2 ** margin).toFixed(margin < 3.3 ? 0 : 1)}% of the sample signal at 100% efficiency` : "as early as the samples, or earlier";
          if (margin < v.nrtMargin) add("nrt_margin", r.line, { ...at(r), wells: [r.key || r.well, ...(own.length ? wl(own) : [])], lines: [r.line, ...(own.length ? ln(own) : [])], uncertain: true,
            description: `No-RT control ${name(r)} for '${t}' (Ct ${r.ct}) is ${margin.toFixed(1)} cycles after ${own.length ? `its sample ${own[0].sample ?? own[0].bio_unit}` : "the samples"} (mean Ct ${mean.toFixed(2)}); at least ${v.nrtMargin} are expected.`,
            evidence: `source line ${r.line}; ${own.length ? `matched by name to ${wl(own).join(", ")}` : `no sample name matches '${r.sample ?? ""}', so compared with all ${used.length} sample well(s) of '${t}'`}; margin ${margin.toFixed(2)} < ${v.nrtMargin} cycles; ${share}`,
            next_check: "Treat the Ct of these samples as partly genomic DNA. DNase-treat the RNA and repeat, use primers that span an exon junction, or measure and subtract the genomic signal." });
        }
      }
    }
  }
  if (active.length && !active.some(r => ["ntc", "positive", "nrt", "standard"].includes(r.role)))
    add("no_control_roles", "all", { description: "No well has an NTC, positive, no-RT or standard role.",
      evidence: "all used wells are samples", next_check: "Assign control roles in the plate map if the plate contains controls." });

  // RNA type (exp.targets, web/genes.js): the type set in the Genes step, otherwise the guess from the name.
  // Low-severity notes only, and each target is reported by at most one of the two miRNA notes.
  const tt = new Map(targetTable(exp, active).map(x => [x.name, x]));
  const typeOf = t => tt.get(t)?.type, typed = ts => ts.map(t => `${t} (${typeOf(t)}, ${tt.get(t)?.saved?.type ? "set in Genes" : "guessed from the name"})`).join(", ");
  const sampleTargets = [...new Set(active.filter(r => r.role === "sample" && r.target).map(r => r.target))];
  const sampleWells = ts => active.filter(r => r.role === "sample" && ts.includes(r.target));
  const aRefs = exp.analysis?.on ? (exp.analysis.refs || []).filter(t => tt.has(t)) : [];
  const SMALL = ["miRNA", "sncRNA"];
  const mirs = sampleTargets.filter(t => typeOf(t) === "miRNA" && !aRefs.includes(t));
  res.checksRun.push("RNA type: miRNA and mRNA targets against the type of reference chosen in Analysis, miRNA targets against small-RNA references on the plate, lncRNA targets against no-RT controls");
  const mismatched = [];
  if (aRefs.length) {
    if (aRefs.some(r => typeOf(r) === "mRNA")) mismatched.push(...mirs);
    if (aRefs.some(r => SMALL.includes(typeOf(r)))) mismatched.push(...sampleTargets.filter(t => typeOf(t) === "mRNA" && !aRefs.includes(t)));
    if (mismatched.length) { const ws = sampleWells(mismatched);
      add("rna_type_reference_mismatch", "analysis", { wells: wl(ws), lines: ln(ws), target: mismatched.length === 1 ? mismatched[0] : null,
        description: `${mismatched.length} target(s) are normalised in the Analysis step to a reference of a different RNA type.`,
        evidence: `targets: ${typed(mismatched)}; reference(s): ${typed(aRefs)}`,
        next_check: "Normalise miRNAs to small-RNA references (U6, RNU44, RNU48, a stable miRNA or a spike-in) and mRNAs to mRNA reference genes, or correct the RNA type in the Genes step if it is wrong." }); }
  }
  const smallOnPlate = aRefs.some(r => SMALL.includes(typeOf(r))) || [...tt.values()].some(x => x.type === "sncRNA");
  const lonelyMirs = mirs.filter(t => !mismatched.includes(t));
  if (lonelyMirs.length && !smallOnPlate) { const ws = sampleWells(lonelyMirs);
    add("mirna_no_small_rna_reference", "plate", { wells: wl(ws), lines: ln(ws), target: lonelyMirs.length === 1 ? lonelyMirs[0] : null,
      description: `${lonelyMirs.length} miRNA target(s) and no small-RNA reference on this plate.`,
      evidence: `miRNA targets: ${typed(lonelyMirs)}; no target is a snoRNA or snRNA, and no miRNA or small RNA is chosen as reference in Analysis`,
      next_check: "If the reference is on another plate, or you normalise to a stable miRNA or a spike-in such as cel-miR-39, choose it as reference in the Analysis step. Otherwise add a small-RNA reference that goes through the same RT." }); }
  if (!v.expectNrt) { // with no-RT expected for every target, missing_control already reports this
    const lnc = sampleTargets.filter(t => typeOf(t) === "lncRNA" && !exp.controlNA?.[`nrt|${t}`] && !active.some(r => r.role === "nrt" && r.target === t));
    if (lnc.length) { const ws = sampleWells(lnc);
      add("lncrna_no_nrt", "plate", { wells: wl(ws), lines: ln(ws), target: lnc.length === 1 ? lnc[0] : null,
        description: `${lnc.length} lncRNA target(s) have no no-RT control on this plate.`,
        evidence: `lncRNA targets without a no-RT well: ${typed(lnc)}`,
        next_check: "Add a no-RT control for these assays, or, if the RNA was DNase-treated and the primers span an exon junction, mark the no-RT control not applicable for the target." }); }
  }

  // Standard curves (FR-12)
  const stdRows = active.filter(r => r.role === "standard");
  if (!stdRows.length) res.notAssessed.push("Standard curve: no wells have the Standard role, so efficiency and linearity were not assessed.");
  else res.checksRun.push(`Standard curve: efficiency ${v.effMin}–${v.effMax}%, R² ≥ ${v.r2Min}, at least ${v.minStdLevels} dilution levels` + (v.minStdRange > 0 ? `, range of at least ${v.minStdRange} log10 units` : ""));
  for (const [t, rs] of groupBy(stdRows.filter(r => r.target), r => r.target)) {
    const bad = rs.filter(r => !(toNum(r.quantity, r.dc) > 0));
    if (bad.length) add("std_curve_missing_quantity", t, { wells: wl(bad), lines: ln(bad), target: t,
      description: `${bad.length} standard well(s) for '${t}' have no positive numeric quantity.`,
      evidence: bad.map(r => `${name(r)}: ${fmtRaw(r.quantity)}`).join("; "), next_check: "Enter the quantity for each standard in the plate map." });
    const pts = rs.filter(r => toNum(r.quantity, r.dc) > 0 && ctNum(r.ct, r.dc) !== null)
      .map(r => ({ x: Math.log10(toNum(r.quantity, r.dc)), y: ctNum(r.ct, r.dc), well: r.key || r.well, q: r.quantity }));
    const levels = new Set(pts.map(p => p.x)).size;
    if (levels < v.minStdLevels) {
      add("std_curve_insufficient", t, { wells: wl(rs), target: t, description: `Standard curve for '${t}' has ${levels} usable level(s); at least ${v.minStdLevels} are needed.`,
        evidence: `${pts.length} standard well(s) with quantity and numeric Ct`, next_check: "Check standard quantities and Ct values." });
      continue;
    }
    const fit = linfit(pts);
    if (!fit) continue;
    const eff = (Math.pow(10, -1 / fit.slope) - 1) * 100;
    const lo = pts.reduce((a, p) => (p.x < a.x ? p : a)), hi = pts.reduce((a, p) => (p.x > a.x ? p : a)), range = hi.x - lo.x;
    res.stdCurves.push({ target: t, ...fit, efficiency: eff, levels, range, points: pts });
    const ev = `slope ${fit.slope.toFixed(3)}, intercept ${fit.intercept.toFixed(2)}, R² ${fit.r2.toFixed(4)}, efficiency ${eff.toFixed(1)}%, ${levels} levels, ${pts.length} wells`;
    add("std_curve_summary", t, { wells: pts.map(p => p.well), target: t, description: `Standard curve for '${t}': efficiency ${eff.toFixed(1)}%, R² ${fit.r2.toFixed(4)}.`, evidence: ev, next_check: "None." });
    if (!(eff >= v.effMin && eff <= v.effMax)) add("std_curve_efficiency", t, { wells: pts.map(p => p.well), target: t,
      description: `Efficiency for '${t}' is ${eff.toFixed(1)}%, outside ${v.effMin}–${v.effMax}%.`, evidence: ev,
      next_check: "Check dilution accuracy, inhibition at high concentrations and outlying standard wells." });
    if (fit.r2 < v.r2Min) add("std_curve_r2", t, { wells: pts.map(p => p.well), target: t,
      description: `Standard curve R² for '${t}' is ${fit.r2.toFixed(4)}, below ${v.r2Min}.`, evidence: ev,
      next_check: "Inspect individual standards for outliers or pipetting errors." });
    if (v.minStdRange > 0 && range < v.minStdRange - 1e-9) add("std_curve_range", t, { wells: pts.map(p => p.well), target: t,
      description: `Standard curve for '${t}' spans ${range.toFixed(1)} log10 units; at least ${v.minStdRange} are recommended.`,
      evidence: `lowest quantity ${lo.q}, highest ${hi.q}; ${ev}`,
      next_check: "Treat the efficiency and R² as rough. Extend the dilution series if the target allows it, and keep the samples inside the range the standards cover." });
  }

  // Amplification curves (FR-11)
  if (!exp.amp) res.notAssessed.push("Amplification curves: no amplification data was provided, so curve checks were not run.");
  else {
    const ap = parseCurves(exp.amp.text, "amp"), cs = {};
    for (const [k, pts] of Object.entries(ap.series)) cs[k] = curveStats(pts);
    const gmax = Math.max(0, ...Object.values(cs).map(s => s.delta));
    for (const s of Object.values(cs)) s.rises = s.delta > 0 && s.delta > Math.max(10 * s.sd, 0.05 * gmax);
    const T = 0.1 * (median(Object.values(cs).filter(s => s.rises).map(s => s.delta)) ?? 0);
    for (const [k, s] of Object.entries(cs)) s.est = s.rises && T > 0 ? crossing(ap.series[k], s.mean, T) : null;
    res.amp = { series: ap.series, stats: cs, threshold: T, layout: ap.layout, yName: ap.yName };
    res.checksRun.push(`Amplification curves (${Object.keys(ap.series).length} curves): rise above baseline vs reported Ct/Cq; Ct/Cq vs a common threshold crossing (tolerance ${v.ctTolerance} cycles around the plate median offset)`);
    const byWell = groupBy(Object.keys(ap.series), k => k.split("|")[0]);
    const tw = groupBy(active.filter(r => r.key), r => r.key);
    const missing = [], ambiguous = [], diffs = [];
    for (const r of active) {
      if (!r.key) continue;
      const exact = `${r.key}|${r.target ?? ""}`;
      let k = ap.series[exact] ? exact : null;
      if (!k) {
        const ks = byWell.get(r.key) || [], nt = new Set(tw.get(r.key).map(x => x.target)).size;
        if (ks.length === 1 && nt === 1) k = ks[0];
        else if (ks.length) { ambiguous.push(r); continue; }
      }
      if (!k) { missing.push(r); continue; }
      r.ampKey = k;
      const s = cs[k], c = ctNum(r.ct, r.dc);
      const curve = `baseline mean ${s.mean.toFixed(3)} (SD ${s.sd.toFixed(3)}), maximum rise ${s.delta.toFixed(3)}`;
      if (c !== null && !s.rises) add("amp_ct_without_rise", r.line, { ...at(r), description: `Well ${name(r)} reports Ct ${r.ct} but its curve does not rise above baseline noise.`,
        evidence: `${curve}; rise needs > ${Math.max(10 * s.sd, 0.05 * gmax).toFixed(3)} (10 × baseline SD or 5% of the largest rise on the plate)`,
        next_check: "Inspect the raw curve and the instrument's baseline and threshold settings for this well." });
      else if (isNoAmp(r.ct) && s.rises) add("amp_rise_without_ct", r.line, { ...at(r), description: `Well ${name(r)} has no Ct/Cq (${fmtRaw(r.ct)}) but its curve rises.`,
        evidence: `${curve}; curve crosses PlateCheck's threshold at cycle ${f2(s.est)}`, next_check: "Check the instrument's threshold and baseline for this well and target." });
      else if (c !== null && s.est !== null) diffs.push([r, c - s.est, s.est]);
    }
    if (missing.length) add("amp_curve_missing", "all", { wells: wl(missing), lines: ln(missing),
      description: `${missing.length} used well(s) have no amplification curve; curve checks were not run for them.`,
      evidence: `missing in ${exp.amp.name}: ${wl(missing).join(", ")}`, next_check: "Confirm the curve export includes all wells." });
    if (ambiguous.length) add("amp_curve_ambiguous", "all", { wells: wl(ambiguous), lines: ln(ambiguous),
      description: `${ambiguous.length} well/target combination(s) could not be matched to a single curve.`,
      evidence: `wells ${wl(ambiguous).join(", ")}`, next_check: "Export curves with a target column for multiplexed wells." });
    const med = median(diffs.map(d => d[1]));
    for (const [r, d, est] of diffs) if (Math.abs(d - med) > v.ctTolerance)
      add("amp_ct_inconsistent", r.line, { ...at(r), uncertain: true, description: `Reported Ct for ${name(r)} is ${Math.abs(d - med).toFixed(1)} cycles from where its curve suggests.`,
        evidence: `reported Ct ${r.ct}; curve crosses ${T.toFixed(3)} above baseline at cycle ${est.toFixed(2)}; offset ${d.toFixed(2)} vs plate median offset ${med.toFixed(2)}`,
        next_check: "Compare this well's curve with its replicates, and check for per-well baseline settings." });
  }

  // Melt curves (FR-12): only when configured for the assay
  if (!exp.melt) res.notAssessed.push("Melt curves: no melt data was provided.");
  else if (!v.meltChecks) res.notAssessed.push("Melt curves: data was provided, but melt-curve checks are not enabled for this assay (Context & rules). PlateCheck does not assume melt analysis applies.");
  else {
    const mp = parseCurves(exp.melt.text, "melt"), isDer = exp.melt.valueType !== "fluorescence", ms = {};
    for (const [k, pts] of Object.entries(mp.series)) ms[k] = meltStats(pts, isDer);
    res.melt = { stats: ms, valueType: isDer ? "derivative" : "fluorescence" };
    res.checksRun.push(`Melt curves (${isDer ? "derivative values" : "derivative computed from fluorescence"}): melt peak present, Tm within ±${v.meltTmTolerance} °C of the target median, secondary peaks ≥ ${v.meltSecondaryRatio} × main peak, NTC peaks`);
    const byWell = groupBy(Object.keys(mp.series), k => k.split("|")[0]);
    const tw = groupBy(active.filter(r => r.key), r => r.key);
    const find = r => {
      const e = `${r.key}|${r.target ?? ""}`;
      if (mp.series[e]) return e;
      const ks = byWell.get(r.key) || [];
      return ks.length === 1 && new Set(tw.get(r.key).map(x => x.target)).size === 1 ? ks[0] : null;
    };
    for (const [t, rs] of groupBy(active.filter(r => r.key && r.target), r => r.target)) {
      const prod = rs.filter(r => ["sample", "positive", "standard"].includes(r.role) && ctNum(r.ct, r.dc) !== null)
        .map(r => { const k = find(r); r.meltKey = k; return [r, k ? ms[k] : null]; }).filter(([, s]) => s?.main);
      if (!prod.length) continue;
      const medH = median(prod.map(([, s]) => s.main.h));
      const medTm = median(prod.filter(([, s]) => s.main.h >= 0.2 * medH).map(([, s]) => s.main.t));
      for (const [r, s] of prod) {
        if (s.main.h < 0.2 * medH) {
          add("melt_no_peak", r.line, { ...at(r), description: `Well ${name(r)} has Ct ${r.ct} but no clear melt peak.`,
            evidence: `largest peak height ${s.main.h.toFixed(3)} vs target median ${medH.toFixed(3)} (needs ≥ 20%)`, next_check: "Inspect the amplification and melt curves together." });
          continue;
        }
        const sec = s.peaks.filter(p => p !== s.main && Math.abs(p.t - s.main.t) >= 2 && p.h >= v.meltSecondaryRatio * s.main.h);
        if (sec.length) add("melt_multiple_peaks", r.line, { ...at(r), uncertain: true, description: `Well ${name(r)} has ${sec.length + 1} melt peaks.`,
          evidence: `main peak ${s.main.t.toFixed(1)} °C (height ${s.main.h.toFixed(3)}); secondary ${sec.map(p => `${p.t.toFixed(1)} °C (${(p.h / s.main.h * 100).toFixed(0)}%)`).join(", ")}`,
          next_check: "Check for non-specific products or primer-dimer, for example on a gel or with a primer redesign." });
        if (Math.abs(s.main.t - medTm) > v.meltTmTolerance) add("melt_tm_deviation", r.line, { ...at(r),
          description: `Melt Tm for ${name(r)} is ${s.main.t.toFixed(1)} °C; the median for '${t}' is ${medTm.toFixed(1)} °C.`,
          evidence: `difference ${(s.main.t - medTm).toFixed(1)} °C; tolerance ±${v.meltTmTolerance} °C`, next_check: "Compare with replicates; check whether a different product amplified in this well." });
      }
      for (const r of rs.filter(r => r.role === "ntc")) {
        const k = find(r), s = k ? ms[k] : null; r.meltKey = k;
        if (s?.main && s.main.h >= 0.2 * medH) add("ntc_melt_peak", r.line, { ...at(r), uncertain: true,
          description: `NTC well ${name(r)} for '${t}' has a melt peak at ${s.main.t.toFixed(1)} °C.`,
          evidence: `peak height ${s.main.h.toFixed(3)} (${(s.main.h / medH * 100).toFixed(0)}% of the product median); product median Tm ${medTm.toFixed(1)} °C (difference ${(s.main.t - medTm).toFixed(1)} °C)`,
          next_check: "A Tm close to the product suggests contamination; a clearly lower Tm is often primer-dimer. Confirm before deciding." });
      }
    }
  }

  // Method metadata (FR-13): "not provided" is reported separately from failed checks.
  const meta = exp.context || {};
  const fileInstrument = Object.entries(parsed.metadata).find(([k]) => /instrument/i.test(k));
  res.checksRun.push("Method metadata: protocol, assay details, efficiency evidence, analysis method, instrument and optional context");
  for (const f of CONTEXT_FIELDS) {
    if (!f.severity || String(meta[f.key] ?? "").trim()) continue;
    if (f.key === "efficiency_evidence" && res.stdCurves.length) continue;
    if (f.key === "instrument" && fileInstrument) continue;
    add("missing_metadata", f.key, { severity: f.severity, title: `Not provided: ${f.label}`,
      description: `${f.label} was not provided.${f.severity === "info" ? " This is optional context." : ""}`,
      evidence: "the context field is empty" + (f.key === "efficiency_evidence" ? " and there is no standard curve in this run" : ""),
      next_check: "Add it on the Context tab, or note why it does not apply." });
  }

  res.findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || wellOrder(a.wells[0]) - wellOrder(b.wells[0]) || a.id.localeCompare(b.id));
  res.summary = summarize(res.findings, exp.reviews, true);
  return res;
}

// ---------------------------------------------------------------- run comparison (FR-7)
export function compareRuns(a, ra, b, rb) {
  const get = [["Title", e => e.title], ["Run date", e => e.date], ["Operator", e => e.operator], ["Project", e => e.project],
    ["Results file", e => e.source?.name], ["Results checksum", e => e.source?.sha256], ["Results format", e => FORMATS[e.source?.format]],
    ["Amplification data", e => e.amp?.name], ["Melt data", e => e.melt?.name], ["Rule profile", e => rulesetId(e.ruleset)],
    ...CONTEXT_FIELDS.map(f => [f.label, e => e.context?.[f.key]]),
    ...RULESET_FIELDS.map(f => [`Rule: ${f.label}`, e => e.ruleset.values[f.key]])];
  const fields = get.map(([label, fn]) => { const x = String(fn(a) ?? ""), y = String(fn(b) ?? ""); return { label, a: x, b: y, same: x === y }; });
  const gm = r => new Map((r?.replicateGroups || []).map(g => [`${g.unit}\u0000${g.target}`, g]));
  const ga = gm(ra), gb = gm(rb);
  const groups = [...new Set([...ga.keys(), ...gb.keys()])].map(k => {
    const x = ga.get(k), y = gb.get(k), [unit, target] = k.split("\u0000");
    return { unit, target, a: x?.mean ?? null, b: y?.mean ?? null, sdA: x?.sd ?? null, sdB: y?.sd ?? null,
      delta: x?.mean != null && y?.mean != null ? y.mean - x.mean : null };
  }).sort((p, q) => p.target.localeCompare(q.target) || p.unit.localeCompare(q.unit));
  const cm = r => new Map((r?.controls || []).filter(c => c.wells.length || c.expected).map(c => [`${c.target}|${c.role}`, c]));
  const ca = cm(ra), cb = cm(rb);
  const desc = c => !c ? "—" : c.wells.length ? `${c.wells.length} well(s); ${c.amplified.length ? "amplified: " + c.amplified.join(", ") : "no amplification"}`
    : c.na ? `not applicable: ${c.na}` : "missing";
  const controls = [...new Set([...ca.keys(), ...cb.keys()])].sort().map(k => {
    const x = ca.get(k), y = cb.get(k), c = x || y;
    return { target: c.target, label: c.label, a: desc(x), b: desc(y) };
  });
  return { fields, groups, controls, counts: { a: ra?.summary?.bySeverity || {}, b: rb?.summary?.bySeverity || {} } };
}

// ---------------------------------------------------------------- packets (FR-21)
export async function verifyPacket(obj) {
  if (obj === null || typeof obj !== "object" || obj.format !== "assaylint-packet" || obj.experiment === null || typeof obj.experiment !== "object") throw new ParseError("This file is not a saved PlateCheck run.");
  if (obj.packet_version > PACKET_VERSION) throw new ParseError(`Packet version ${obj.packet_version} is newer than this app supports (${PACKET_VERSION}).`);
  const exp = normalizeExperiment(structuredClone(obj.experiment));
  for (const k of ["source", "amp", "melt"]) if (exp[k]) {
    if ((await sha256(exp[k].text)) !== exp[k].sha256) throw new ParseError(`Checksum mismatch for embedded file ${exp[k].name}; the packet was altered.`);
  }
  if (exp.source) parseResults(exp.source.text, { plateSize: exp.source.plateSize });
  return exp;
}

// ---------------------------------------------------------------- quick start helpers
// Works out what a dropped file is: a results table, amplification curves or melt curves.
export function detectFileKind(text) {
  try { return { kind: "results", parsed: parseResults(text) }; } catch (e) {
    if (e.details?.needsPlateSize) return { kind: "results", needsPlateSize: true, error: e };
    for (const kind of ["amp", "melt"]) { try { return { kind, parsed: parseCurves(text, kind) }; } catch { /* try the next kind */ } }
    return { kind: null, error: e };
  }
}

// The short "what's next" list shown at the top of an experiment. Built only from existing findings.
export function nextSteps(exp, res) {
  if (!exp.source || !res?.rows?.length) return [{ id: "upload", tab: "data", done: false, text: "Upload the results file from your instrument" }];
  const open = f => !CLOSED.has(exp.reviews?.[f.id]?.disposition);
  const openOf = (...rules) => res.findings.filter(f => rules.includes(f.rule) && open(f));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const unlabelled = [...new Set(openOf("unmapped_well", "unmapped_role").flatMap(f => f.wells))];
  const noControls = openOf("no_control_roles").length > 0, missingCtrl = openOf("missing_control");
  const serious = res.findings.filter(f => (f.severity === "high" || f.severity === "medium") && open(f) && f.category !== "missing_context");
  const meta = openOf("missing_metadata").filter(f => f.severity === "medium");
  const reported = exp.audit.some(a => a.action === "export" && /^Report/.test(a.detail));
  return [
    { id: "upload", tab: "data", done: true, text: `Uploaded ${exp.source.name}` },
    { id: "labels", tab: "map", done: !unlabelled.length, text: unlabelled.length ? `Label ${plural(unlabelled.length, "well")} that ${unlabelled.length === 1 ? "has" : "have"} no sample or target (${unlabelled.slice(0, 4).join(", ")}${unlabelled.length > 4 ? "…" : ""})` : "Every well has a sample and target" },
    { id: "controls", tab: "map", done: !noControls && !missingCtrl.length, text: noControls ? "Show which wells are controls" : missingCtrl.length ? `${plural(missingCtrl.length, "expected control")} not found; mark them on the plate or say why not` : "Controls are marked" },
    { id: "flags", tab: "findings", done: !serious.length, text: serious.length ? `Look at ${plural(serious.length, "flag")} that need${serious.length === 1 ? "s" : ""} attention` : "No flags left that need attention" },
    { id: "details", tab: "context", done: !meta.length, optional: true, text: meta.length ? `Add ${meta.map(f => f.title.replace(/^Not provided: /, "").split(" (")[0].toLowerCase()).join(" and ")} for the report` : "Method details are filled in" },
    { id: "report", tab: "report", done: reported, text: reported ? "Report downloaded" : "Download your report" },
  ];
}

// ---------------------------------------------------------------- reading file bytes
// Instrument PCs often save UTF-16 ("Unicode text") or Windows-1252 text, and people sometimes drop the
// Excel workbook or the instrument's project file instead of the export. Work out which it is.
export function decodeBytes(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dec = (enc, from = 0) => new TextDecoder(enc).decode(b.subarray(from));
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4) return { binary: "zip" };      // .xlsx, .eds, .pcrd and other zipped project files
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return { binary: "ole" }; // old .xls
  if (b[0] === 0xff && b[1] === 0xfe) return { text: dec("utf-16le", 2), encoding: "UTF-16" };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: dec("utf-16be", 2), encoding: "UTF-16" };
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { text: dec("utf-8", 3), encoding: "UTF-8" };
  const n = Math.min(b.length, 4000); let odd = 0, even = 0, nul = 0;
  for (let i = 0; i < n; i++) if (b[i] === 0) { nul++; (i % 2 ? odd++ : even++); }
  if (n >= 8 && odd > n / 4) return { text: dec("utf-16le"), encoding: "UTF-16" };
  if (n >= 8 && even > n / 4) return { text: dec("utf-16be"), encoding: "UTF-16" };
  if (nul > 0) return { binary: "unknown" };
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(b), encoding: "UTF-8" }; }
  catch { return { text: dec("windows-1252"), encoding: "Windows-1252" }; }
}
export const BINARY_MESSAGE = "This looks like an instrument project file (such as .eds or .pcrd), not an export, so I can't read it. In your instrument software, export the results as Excel, CSV or text and drop that instead.";
