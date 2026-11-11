# Product Requirements Document: AssayLint

**Version:** 1.0  
**Status:** Product definition draft for discovery and implementation planning  
**Date:** 10 November 2026  
**Product:** AssayLint  
**Working positioning:** Trust your experiment before trusting your result.

## 1. Executive summary

AssayLint helps life-science researchers review qPCR experiments before they rely on the result. It accepts a qPCR instrument export and an experiment map, runs transparent checks on data structure, controls, replicate consistency, and method metadata, and returns an explainable report linked to the original run.

The product also creates a compact experiment record that ties together samples, groups, biological and technical replicate labels, protocol version, raw data, analysis settings, deviations, and findings. It is designed to complement a laboratory notebook or ELN, not replace it.

The first release will focus on a narrow, supportable qPCR workflow. It will not claim to determine whether a biological conclusion is true or whether a whole experiment is scientifically valid. The longer-term opportunity is a family of method-specific validators built on a shared experiment and provenance model.

## 2. Problem statement

Researchers often discover after data collection that an experiment has a preventable issue: a control behaved unexpectedly, a sample or well was mapped incorrectly, technical replicates were treated as independent biological samples, or a key protocol or instrument detail was not recorded. When results look wrong, diagnosis can take repeated runs and informal troubleshooting because evidence is spread across instrument files, plate maps, notebooks, spreadsheets, and memory.

Existing method standards define important information and checks, but applying them consistently to each run can require manual work. General-purpose notebooks preserve notes but do not necessarily parse raw assay data or apply assay-specific quality checks.

**AssayLint’s job:** reduce avoidable ambiguity by bringing run data and its experimental context together, performing transparent method-specific checks, and showing what evidence supports each flag.

## 3. Product vision and principles

### Vision

A researcher can check whether an experiment’s data and documentation are internally coherent before analyzing or sharing its results, across multiple biological methods over time.

### Product principles

1. **Evidence before judgment:** every finding links to the input data, metadata, and rule that produced it.
2. **Method-specific rules:** a qPCR rule should not be generalized to microscopy, ELISA, or cell culture.
3. **No silent edits:** preserve the uploaded file; never silently remove wells, samples, or outliers.
4. **Uncertainty is visible:** distinguish a detected issue from a possible cause and from missing information.
5. **Human scientific judgment remains central:** AssayLint supports review; it does not certify an experiment or conclusion.
6. **Low-friction adoption:** work with existing notebooks, spreadsheets, and instrument exports.
7. **Portable records:** users can export their experiment packet and report without being locked into AssayLint.

## 4. Target users

### Primary user: bench scientist running qPCR

Graduate students, research assistants, postdocs, and laboratory scientists who run gene-expression or other qPCR assays. They may be experienced or relatively new to the method, and they commonly handle both instrument files and manual sample/plate maps.

**Needs:** catch mapping and control issues; understand replicate spread; compare runs; preserve enough context to troubleshoot and revisit the result.

### Secondary user: lab lead or assay owner

A principal investigator, staff scientist, or technical lead who reviews runs and supports troubleshooting.

**Needs:** quickly see what was checked, what changed between runs, and whether an apparent failure is a data issue, a missing context issue, or an unresolved scientific question.

### Future users (out of MVP)

Plate-reader/ELISA users, microscopy users, cell-culture assay teams, and other experimental domains. Their workflows require separate discovery and method-specific rules.

## 5. Jobs to be done

- When I finish a qPCR run, help me find data and mapping problems before I calculate or share results.
- When replicates or controls look unusual, show me the exact evidence and likely next checks without pretending to know the cause.
- When I revisit a result months later, help me see which samples, protocol, instrument export, and analysis settings produced it.
- When I review another person’s run, give me a consistent, explainable summary without requiring a full ELN migration.
- When I prepare a report, show which method details are present, missing, or flagged.

## 6. Goals and non-goals

### MVP goals

- Support a defined, validated set of qPCR export formats.
- Let users map samples, targets, conditions, and replicate relationships to wells.
- Detect common structural and QC concerns using explicit, reviewable rules.
- Preserve a traceable link between the raw input, experiment context, rule version, and report.
- Make the outputs useful to both the person who ran the assay and a reviewer.
- Learn whether run auditing plus experiment context is valuable enough to support repeat use.

### MVP non-goals

- Support every qPCR instrument or vendor format at launch.
- Replace an ELN, LIMS, analysis package, or instrument software.
- Automatically select normalization genes, determine biological sample size, or recommend a study design as authoritative.
- Diagnose contamination or identify the root cause of an assay failure from a data file alone.
- Automatically exclude wells, alter raw data, or produce publication-ready claims.
- Provide a universal scientific rigor score, a pass/fail certificate, or a guarantee of reproducibility.
- Validate plate-reader assays, microscopy, sequencing, structural biology, animal studies, or all biological experiments in the first release.
- Make clinical, diagnostic, regulatory, or GLP-compliance claims.

## 7. MVP definition

### MVP product unit

A **qPCR experiment packet** containing:

- Original instrument file (read-only source)
- Parsed well-level results and any available amplification/melt-curve data
- User-provided plate map and sample metadata
- Protocol and analysis context
- QC findings with rule names, rule versions, and evidence
- A human review state and optional notes
- Exportable report and structured data

### Supported workflow

1. User creates an experiment and selects qPCR.
2. User uploads an instrument export from a supported format.
3. AssayLint parses the file and displays detected wells, targets, sample labels, controls, and instrument metadata.
4. User confirms or edits the plate map and labels experimental units and replicate types.
5. AssayLint runs the selected rule set and displays findings.
6. User reviews each finding, marks it reviewed, records an explanation or action if desired, and may compare against an earlier run.
7. User exports a report and experiment packet.

If a file cannot be parsed reliably, AssayLint must stop before running checks, explain what it recognized, and provide an import template or correction path.

## 8. Functional requirements

Priorities: **P0** required for MVP; **P1** valuable follow-up; **Later** future release.

### A. Experiment setup and context

**FR-1 (P0): Create and name an experiment.**  
The user can create an experiment with a stable unique ID, title, assay type, date, optional project, and operator.

**FR-2 (P0): Import a qPCR data file.**  
The user can upload a supported raw or export file. The original file is retained unchanged and associated with the experiment.

**FR-3 (P0): Show parser results before analysis.**  
AssayLint displays the fields and wells it parsed, identifies missing or ambiguous fields, and requires user confirmation when the mapping is not certain.

**FR-4 (P0): Define or confirm the plate map.**  
The user can map each well to sample, target/assay, experimental group, control role, and replicate identity. The user can import a mapping template and edit it in the UI.

**FR-5 (P0): Represent replicate hierarchy.**  
The user can label the biological/experimental unit and technical replicate group. Technical wells must not automatically become independent biological observations.

**FR-6 (P0): Record protocol and run context.**  
The user can link or record a protocol name/version and optional reagent/primer identifiers, lot numbers, instrument, run settings, operator, and deviations. Missing optional context is reported as missing metadata, not a failed assay.

**FR-7 (P1): Compare runs.**  
The user can compare two or more runs for a shared assay, target, sample group, protocol, or control and see which recorded variables differ.

### B. Data quality and validation

**FR-8 (P0): Run structural checks.**  
Detect duplicate well assignments, unmapped wells, duplicate sample identifiers where unexpected, missing required fields, invalid plate coordinates, impossible/unsupported values, and mismatches between plate map and data.

**FR-9 (P0): Check expected controls.**  
Based on the assay setup and selected rule set, identify expected positive/negative controls and flag absent or atypical controls. The UI must show which control expectation was applied and allow a user to mark a control as not applicable with a reason.

**FR-10 (P0): Summarize technical replicate behavior.**  
Report per-group replicate counts and dispersion using the relevant configured method. Flag groups that exceed the selected threshold. Thresholds must be visible, configurable where appropriate, and versioned. Do not remove or down-weight values automatically.

**FR-11 (P0): Review amplification quality where available.**  
For supported formats that include amplification data, provide plots and checks for missing, abnormal, or inconsistent curves. Any rule must identify what curve feature triggered the flag. If raw curves are unavailable, clearly state that the corresponding checks were not run.

**FR-12 (P0): Review melt-curve or standard-curve checks where applicable.**  
Where source data and assay type support these analyses, report the applicable criteria and evidence. Do not infer that melt-curve or standard-curve checks apply to assays for which the user has not configured them.

**FR-13 (P0): Flag missing method metadata separately from data findings.**  
Report whether key information such as assay/primer details, efficiency/validation evidence, control roles, replicate structure, and analysis method is present. Distinguish “not provided” from “failed.”

**FR-14 (P0): Explain every finding.**  
Each finding must include severity, description, affected wells/samples, evidence, rule name/version, and an actionable next check. If root cause is uncertain, say so.

**FR-15 (P0): Support human review.**  
Users can mark findings as reviewed, add a note, and record an action or disposition. Review changes must not modify raw input or erase the original finding.

**FR-16 (P1): Ruleset profiles.**  
A lab or assay owner can save a named rule profile with thresholds, expected controls, and required metadata. Profile changes are versioned and do not retroactively rewrite old reports.

### C. Results and reporting

**FR-17 (P0): Provide an experiment summary.**  
Show high-level status such as “review needed,” “findings present,” or “no configured checks flagged,” along with counts of warnings, data issues, and missing information. Avoid a single unqualified validity score.

**FR-18 (P0): Link findings to data.**  
Selecting a finding highlights affected wells and displays the relevant values or plot.

**FR-19 (P0): Export a report.**  
Export a human-readable report that includes experiment context, input file name/checksum, parser status, checks performed and not performed, ruleset version, findings, reviewed dispositions, and missing metadata.

**FR-20 (P0): Export structured results.**  
Export normalized well-level data and metadata in a documented machine-readable format such as CSV plus JSON. Export must preserve original identifiers and values.

**FR-21 (P1): Export an experiment packet.**  
Bundle the report and structured context so it can be archived alongside the lab notebook or analysis project.

### D. Privacy, access, and data management

**FR-22 (P0): Protect experiment data.**  
Only the user and authorized collaborators can access experiment files and reports. The product must define and disclose storage location, encryption, retention, backup, and deletion behavior before launch.

**FR-23 (P0): Delete and export user data.**  
Users can export and delete an experiment and its associated uploaded files, parsed data, notes, and reports, subject to clearly stated retention rules.

**FR-24 (P0): Preserve provenance.**  
Record creation time, upload, parser version, ruleset version, edits to metadata, finding review, and exports. The audit history should identify what changed and by whom.

**FR-25 (P0): No secondary use by default.**  
Uploaded research data is not used for model training, cross-customer benchmarking, or public sharing without separate, explicit opt-in.

### E. Reliability and recovery

**FR-26 (P0): Safe failure on unsupported or malformed input.**  
Do not produce a QC report from partially parsed or corrupted data unless the report clearly limits the checks to validated portions and marks the rest as unavailable.

**FR-27 (P0): Idempotent analysis.**  
Running the same parser and ruleset on the same input and metadata yields the same findings, aside from non-scientific timestamps.

**FR-28 (P1): Recover user work.**  
Autosave plate-map edits and review notes; warn users before navigating away from unsaved changes.

## 9. Rule behavior and result language

### Finding categories

- **Data issue:** an internal inconsistency or observed QC value violates a stated rule.
- **Review warning:** data may be unusual or a method-dependent condition needs human review.
- **Missing context:** a required or recommended item was not supplied.
- **Informational:** checks performed, settings used, or observations that do not imply a problem.
- **Not assessed:** the input does not contain the data required to run that check.

### Severity

- **High:** likely to prevent a meaningful interpretation of the affected run under the selected method/ruleset; requires review before downstream use.
- **Medium:** meaningful concern or deviation that should be reviewed and documented.
- **Low:** completeness or consistency improvement; may not affect interpretation.
- **Info:** transparent record of checks and context.

Severity must be tied to the rule, not generated from a generic score. The report should say “AssayLint flagged…” and avoid “experiment is invalid” unless the user-defined rule explicitly represents an acceptance criterion.

### Human override

Users can mark a finding as accepted, not applicable, resolved, or unresolved, with an optional note. Overrides change disposition, not data. Reports show both the original finding and the human disposition.

## 10. User experience requirements

- A first-time user should understand what to upload and what context is needed without reading a manual.
- The import flow should preview the parsed data before the user commits it to an experiment.
- The plate map should be easy to inspect and edit using a visual plate layout and a table.
- Every flag should answer: **What was checked? What did AssayLint see? Why might it matter? What could I check next?**
- Findings should be sortable by severity, sample, target, control, and well.
- The report should be readable without an AssayLint account.
- The interface should use plain scientific language, define specialized terms on first use, and avoid implying certainty beyond the data.

## 11. Success metrics

### North-star outcome

**Share of completed qPCR audits that a researcher reviews and can confidently act on**, measured via explicit disposition and a short in-product usefulness prompt. This is a product-use signal, not proof that the assay became scientifically valid.

### MVP metrics

**Activation**
- Percentage of new users who import a supported file and complete a first audit.
- Median time from file upload to first useful finding or completed review.

**Quality**
- Parser success rate by supported format and format version.
- Percentage of findings users mark useful, not applicable, or incorrect.
- False-positive and missed-finding rates from a curated expert-reviewed validation set.
- Percentage of reports with an identifiable source value and rule for every flag.

**Engagement**
- Percentage of users who audit a second run within 30 days.
- Percentage of audits where the experiment packet/report is exported.
- Repeat use by lab, without treating lab-level adoption as an individual performance score.

**Guardrails**
- Zero silent data exclusions or source-value changes.
- Zero claims that an experiment is certified or guaranteed valid.
- Track unsupported-file attempts and abandonments to guide format expansion.
- Monitor user overrides of each rule; a high override rate should trigger rule review.

Numeric targets should be set after baseline usability tests and a representative pilot; do not invent targets before establishing parser coverage and user behavior.

## 12. Validation and acceptance plan

This plan is product validation, not an instruction to add automated tests as part of this document.

### Discovery validation

- Interview 8–12 qPCR users across experience levels and lab types.
- Ask participants to reconstruct one recent questionable or failed run from source file through analysis.
- Observe current plate-map creation, replicate labeling, control review, and troubleshooting.
- Validate which instrument export formats and data fields are available in practice.
- Test prototype findings against user language: useful, understandable, actionable, or distracting.

### Scientific review

- Have qPCR domain experts review each MVP rule, its severity, assumptions, thresholds, and limitations.
- Benchmark rules against curated runs that include known acceptable and problematic cases.
- Include ambiguous cases where reasonable experts may disagree.
- Document supported assays, data fields, assumptions, and checks that are out of scope.
- Version every released rule and keep historical reports reproducible.

### Release acceptance

The MVP is ready for a limited pilot when:

1. Supported formats are explicitly named and tested with representative files from each.
2. A user can map data to wells, groups, controls, and replicate hierarchy and understand ambiguities.
3. Every reported finding is traceable to input data, method assumptions, and a versioned rule.
4. Missing data is shown as not assessed or missing context, never silently treated as passing.
5. Raw values remain unchanged through import, analysis, and export.
6. Users can record review dispositions and export the complete report and experiment packet.
7. Data retention, deletion, access, and privacy behavior are documented.
8. Domain experts have approved the initial rule set and unresolved limitations are visible.

## 13. Dependencies and constraints

- Instrument-export examples and permission to use anonymized files for parser development and evaluation.
- A domain-reviewed qPCR rule catalog and defined assay contexts.
- A supported-format list with parser ownership and compatibility policy.
- Product decisions on local versus hosted processing, identity/access, storage, retention, and collaboration.
- A privacy and security review appropriate for unpublished research data.
- Clear distinction between qPCR fluorescence/raw amplification exports and processed Ct-only exports, since available checks differ.
- A format/versioning plan for experiment packet exports and rulesets.

## 14. Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Overstated scientific authority | Users may treat a clean report as proof that the biological conclusion is correct. | Avoid certification language and generic pass scores; show checks performed, not assessed, and limitations. |
| False positives create alert fatigue | Researchers may ignore all findings if rules flag harmless variation. | Domain review, configurable thresholds, transparent evidence, and monitoring of overrides. |
| False negatives create misplaced trust | Missing an issue may be more harmful than surfacing a warning. | Validate against curated cases; report scope and unavailable checks; avoid guarantee language. |
| Instrument formats vary | Parser errors can corrupt mapping and findings. | Support a small named set first; preview parsed output; fail safely; version parsers. |
| Context remains incomplete | An uploaded file alone often cannot determine controls or biological units. | Require user confirmation of key mappings; show missing context separately; make the experiment packet lightweight. |
| Rules become stale or contested | Standards evolve and method-specific practice differs. | Version rules; cite basis and review date; allow lab-level profiles without changing defaults silently. |
| Researchers resist another data silo | Adoption may fail if AssayLint duplicates ELN work. | Complement existing tools; support export and links; keep required metadata minimal. |
| Research data privacy concerns | Unpublished results may be sensitive to the lab. | Clear data handling disclosures, access control, export/delete options, and no secondary use by default. |

## 15. Roadmap

### Phase 0 — Discovery and specification validation

- Confirm highest-value user segment and top qPCR workflow.
- Identify common supported export formats and inspect representative files.
- Co-design plate-map and finding-review interactions.
- Confirm local/hosted data handling requirement before implementation.

### Phase 1 — qPCR audit MVP

- Experiment packet and qPCR import for a narrow supported format set.
- Plate map and replicate hierarchy.
- Structural, control, replicate, curve, and metadata checks where the input supports them.
- Explainable findings, human review, and portable exports.

### Phase 2 — Harden and pilot

- Add formats based on observed demand.
- Tune rules based on expert-reviewed cases and real user feedback.
- Add run comparison and reusable ruleset profiles.
- Establish parser/rule release and support process.

### Phase 3 — Plate-based assay module

- Validate one constrained plate-reader assay family first (for example, ELISA or a defined colorimetric assay), not generic “plate reader validation.”
- Add plate maps, standards, blanks, controls, dilution/range checks, replicate dispersion, and instrument/read metadata appropriate to that assay.
- Reassess rule governance and export integration.

### Longer-term platform direction

Add new method modules only when there is a clear workflow, accessible data, domain-reviewed validation rules, and a community or standards basis. Candidate discovery areas include microscopy, cell-based assays, western blot, and microbial growth assays. Each requires its own product research and MVP definition.

## 16. Open decisions

These decisions need resolution before implementation commitments:

1. Which two or three qPCR instrument-export formats cover the initial target users?
2. Does initial parsing include raw amplification/melt curves, or start from Ct tables and expand?
3. Which qPCR use cases are in scope first: gene expression, pathogen detection, or another defined assay class?
4. Is processing local, hosted, or a hybrid, given unpublished-data sensitivity?
5. Will the first version support individual accounts only or lab workspaces and collaboration?
6. Which established qPCR guidance/rules will be included in the initial profile, and who owns scientific review?
7. Should users supply their own acceptance criteria, use an expert-reviewed default profile, or both?
8. What is the minimal required context before an audit can be run without making setup burdensome?

## 17. Evidence and rationale

This PRD is grounded in the qualitative [AssayLint opportunity map](/C:/Users/siddhant/Documents/Codex/2026-11-10/referenced-chatgpt-conversation-this-is-an/outputs/assaylint-opportunity-map.md). Public forum examples show repeated confusion around qPCR controls and replicate variability, microscopy acquisition comparability, immunoblot troubleshooting, and the fragmentation of sample and experiment records. The map also distinguishes these recurring patterns from isolated stories such as an incompatible plate type or contaminated dilution water.

Relevant method and research sources include:

- [MIQE 2.0](https://academic.oup.com/clinchem/article/71/6/634/8119148), covering qPCR design, controls, assay validation, replicate handling, analysis, and reporting.
- [Best practices and tools for reporting reproducible fluorescence microscopy methods](https://www.nature.com/articles/s41592-021-01156-w), illustrating why acquisition settings and metadata need method-specific handling.
- [ARRIVE 2.0](https://arriveguidelines.org/arrive-guidelines), which treats study design, sample size, exclusions, randomization, blinding, outcomes, and statistics as essential for animal research.
- [Understanding experiments and research practices for reproducibility](https://peerj.com/articles/11140/), a survey reporting perceived gaps in metadata, methods, instrument settings, and data management.
- [Ten simple rules for managing laboratory information](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011652), on linking protocols, metadata, and data.

**Evidence limitation:** public forum discussions are self-selected and cannot estimate population prevalence. Product scope and priority should be confirmed through researcher interviews and representative data-file review before implementation.

