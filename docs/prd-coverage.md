# PRD coverage (AssayLint 0.3.0)

Status of each requirement in [prd.md](prd.md). “Built” means implemented and exercised by tests or a browser check; it does not mean scientifically validated.

| Req | Priority | Status | Where |
|---|---|---|---|
| FR-1 Create and name an experiment | P0 | Built | Setup tab; `newExperiment` |
| FR-2 Import a qPCR file, keep original unchanged | P0 | Built | Data tab; original text and SHA-256 stored; “Download original” |
| FR-3 Show parser results before analysis | P0 | Built | Import preview with column mapping, counts, roles, warnings; explicit confirm |
| FR-4 Define or confirm the plate map | P0 | Built | Plate map tab: grid selection, bulk edit, per-row edit, template import/export |
| FR-5 Replicate hierarchy | P0 | Built | Biological unit vs technical group; units default to sample name and this is flagged |
| FR-6 Protocol and run context | P0 | Built | Context tab; missing optional context reported as “not provided” |
| FR-7 Compare runs | P1 | Built | Compare runs tab; `compareRuns` |
| FR-8 Structural checks | P0 | Built | 11 structure rules incl. malformed rows, duplicates, unmapped wells, template coverage |
| FR-9 Expected controls, mark not applicable | P0 | Built | NTC / positive / no-RT expectations per rule set; N/A with reason |
| FR-10 Technical replicate behaviour | P0 | Built | SD per group, configurable threshold, nothing removed |
| FR-11 Amplification checks where available | P0 | Built | Rise vs Ct, Ct vs common-threshold crossing; “not assessed” without data |
| FR-12 Melt / standard curve where applicable | P0 | Built | Melt only when enabled; standard curve only for wells with the Standard role |
| FR-13 Missing metadata separate from data findings | P0 | Built | `missing_metadata` category “Missing context” |
| FR-14 Explain every finding | P0 | Built | Severity, description, wells, evidence, rule and version, next check, uncertainty |
| FR-15 Human review | P0 | Built | Disposition + note; original finding kept; audit entry |
| FR-16 Rule-set profiles | P1 | Built | Saved profiles with versions; experiments keep a snapshot |
| FR-17 Experiment summary | P0 | Built | Status labels, counts by severity and category; no score |
| FR-18 Link findings to data | P0 | Built | Selecting a finding highlights wells on the plate and their curves |
| FR-19 Export a report | P0 | Built | HTML report; print to PDF |
| FR-20 Export structured results | P0 | Built | Wells CSV, findings CSV, results JSON |
| FR-21 Experiment packet | P1 | Built | JSON packet with original files; checksum-verified import |
| FR-22 Protect experiment data | P0 | Partial | Local-only processing and storage, documented in PRIVACY.md. No encryption at rest or collaborator access control. |
| FR-23 Delete and export data | P0 | Built | Delete experiment; all exports |
| FR-24 Provenance and audit history | P0 | Built | Every change, import, review and export logged with actor and time |
| FR-25 No secondary use | P0 | Built | No network calls for data; no telemetry |
| FR-26 Safe failure | P0 | Built | Parse errors stop analysis; partial rows excluded and reported |
| FR-27 Idempotent analysis | P0 | Built | Deterministic; tested |
| FR-28 Autosave, warn before leaving | P1 | Built | Autosave on every change; leave warning if a save failed |

## Not done (needs people, data or decisions, not code)

- **Real-file validation (§12, release acceptance 1): partly done.** 12 public exports (QuantStudio, Bio-Rad CFX, ABI 7500/7900HT) and 7 realistic vendor-layout fixtures now parse and are regression-tested; see [testdata/README.md](../testdata/README.md). Still needed: exports from the pilot labs' own instruments, real curve exports, and other vendors (Roche LC96, Qiagen, Agilent).
- **Expert review of rules (§12, acceptance 8):** every rule is marked “not yet reviewed”; thresholds are placeholders.
- **Discovery interviews and usability tests (§12):** not started.
- **Open decisions (§16):** this build assumes local-only processing, individual use (no lab workspaces), Ct tables plus optional curves, and gene-expression-style controls. Each is reversible.
- **Success metrics (§11):** the app records a usefulness answer per experiment locally but sends no analytics, so metrics would come from pilot interviews or opt-in exports.
