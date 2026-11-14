# Formats

## Inputs

### Excel workbooks
`.xlsx`, `.xls` (Excel 97 and later) and `.ods` files are read in the browser with SheetJS (`web/vendor/xlsx.mjs`, Apache-2.0), which is loaded only when a workbook is dropped. Each sheet is turned into tab-separated text and then read exactly like a text export, so everything below applies to sheets too.

- Every non-empty sheet is checked. The best sheet for each kind is picked: results (a sheet named like `Results` wins), amplification (`Amplification…`) and melt (`Melt…`). One QuantStudio workbook can therefore give the results and both curve files at once. In the Data tab preview you can switch to another sheet.
- Numbers are taken as stored in the file, with every digit, not as Excel shows them on screen. Date cells keep their displayed form; formula cells use the value Excel saved; errors such as `#DIV/0!` stay as text and are flagged like any other non-numeric Ct.
- The imported file is recorded as `<workbook> [<sheet>]` with the workbook name, sheet name and the SHA-256 of the workbook itself; the checksum stored with the run is of the sheet text that was read. *Download sheet as text* gives back exactly that text.
- Instrument project files (`.eds`, `.pcrd`) are also zip files but are not workbooks, and are refused with a message.

### Results file (required)
Comma, tab or semicolon separated text, or a sheet of an Excel workbook. Column names are matched case-insensitively. The delimiter is taken from the first line that has one; on a tie, tab wins.

| Field | Accepted column names | Required |
|---|---|---|
| Well | `Well Position`, `Well`, `Pos`, `Position` (values such as `A1` or `A01`) | yes |
| Ct/Cq | `Ct`, `Cq`, `CT`, `Cт`, `C_T`, `CRT`, `Cp` | yes |
| Sample | `Sample`, `Sample Name`, `Name` | no |
| Target | `Target`, `Target Name`, `Detector`, `Detector Name`, `Gene`, `Assay` | no |
| Role | `Role`, `Task`, `Content`, `Type` | no |
| Quantity | `Quantity`, `Starting Quantity (SQ)`, `SQ`, `Qty` | no |
| Group | `Group`, `Condition`, `Biological Group`, `Biological Set Name` | no |
| Biological unit | `bio_unit`, `Biological Unit`, `Biological Replicate`, `Bio Rep` | no |

The header row is found anywhere in the first 500 lines (the first row with both a well and a Ct/Cq column). Lines before it are kept as file metadata (`* key = value`, `key,value` and `key: value` lines). The table ends at the next `[Section]` line or a repeated header; blank lines inside it are skipped. A trailing block of rows without well positions (for example Slope / R² or “Analysis Type”) is reported as a footer, not data.

Detected layouts:
- **Thermo QuantStudio**: text export with `* key = value` lines and `[Results]`, or CSV with a key,value preamble (`Block Type`, …). `Omit` flags are kept and reported.
- **Applied Biosystems SDS** (7000/7300/7500/7900HT, SDS 1.x/2.x): text with a preamble and `Detector` / `Detector Name` columns.
- **Bio-Rad CFX “Quantification Cq Results”**: has `Fluor` and `Content` columns; a leading unnamed index column is ignored.
- **Generic**: anything else with a well and a Ct/Cq column, including Roche LightCycler 480 text exports (`Pos`, `Name`, `Cp`).

Numeric wells: if the well column holds numbers (SDS 2.x), they are converted row by row using the plate size stated in the file, 384 if any number exceeds 96, or the size the user chooses in the preview (`--plate-size` in the CLI). The size is never guessed.

Numbers: in semicolon-separated files, decimal commas (`24,31`) are read as decimals. Thousands separators in quantities (`12,963.927`) are accepted. Raw strings are stored unchanged.

Role values: `Unkn…`/`Unknown`/`Sample` → sample, `NTC`/`No template…` → NTC, `Std…`/`Standard` → standard, `Pos…` → positive, `NRT`/`No RT`/`-RT`/`NAC` → no-RT, `Empty`/`Unused` → empty. Other values (such as `Neg Ctrl`) are not mapped and are flagged. Samples named `NTC`, `water`, `H2O`, `blank` or `no template control` are treated as NTC, and samples whose name marks them as a no-RT control (`c1 noRT`, `c1 -RT`, `c1 RT-`, `NRT c1`, `c1 no-RT control`, `c1 minus RT`) are treated as no-RT, when there is no role column or the role is “Unknown”. The Plate page asks you to confirm these guesses; the source of the role is shown in the preview, plate map and report.

No-amplification markers: empty, `Undetermined`, `NaN`, `N/A`, `NA`, `No Ct`, `No Cq`, `-`, `None`, `No Amp`. Any other non-numeric value is kept and flagged.

Safe failure: if the well or Ct/Cq column is missing, the plate size for numeric wells is unknown, or more than half the rows cannot be parsed, nothing is analysed. Otherwise unparseable rows are excluded and reported as findings. A row counts as unparseable when its fields don't line up with the header or it has no well or Ct/Cq cell. A readable row whose Ct/Cq value isn't a number (for example `abc`) is not unparseable: it is kept, flagged as a non-numeric Ct/Cq and left out of calculations, however many such rows there are.

Several candidate columns: if more than one column could be the Ct/Cq column (or the well, sample or target column), the first one is used and the preview shows a warning naming both.

Excel workbooks with several sheets that look like results: a sheet named exactly `Results` (or `Ct Results`, `Cq Results`) is preferred over one that only contains the word, such as `Old results`. When more than one sheet qualifies, the note after import names the others so you can switch.

Import template: `well,sample,target,ct,role,group,bio_unit,quantity` (downloadable from the Data tab).

### Amplification and melt curves (optional)
- The header row can sit below a block of run details (as in QuantStudio Excel exports); the first row with a `Cycle` or `Temperature` column is used.
- **Long layout**: columns for well, optional target, `Cycle` (or `Temperature`), and a value (`Delta Rn`, `ΔRn`, `RFU`, `Fluorescence`, `Rn`, `Value`; for melt also `Derivative`, `-dF/dT`, `-d(RFU)/dT`, `-Rn'`).
- **Wide layout**: a `Cycle` or `Temperature` column plus one column per well (`A1`, `A01`, …), as in CFX amplification and melt exports.
- Melt values can be derivative or raw fluorescence; the user confirms which at import.

### Plate-map template
`well` plus any of `sample, target, group, role, bio_unit, quantity`. Empty cells leave the current value. If a well has several targets, a `target` column selects the row.

## Outputs

| Export | Contents |
|---|---|
| `<id>.report.html` | Human-readable report, readable without PlateCheck. Can be printed to PDF. |
| `<id>.wells.csv` | One row per source data row: source line, raw and normalised well, effective labels, role and its source, raw Ct/Cq, and the file's original label values. |
| `<id>.findings.csv` | One row per finding: ID, rule, rule version, category, severity, description, wells, source lines, evidence, next check, disposition, note, reviewer. |
| `<id>.results.json` | `format: "assaylint-results"`: experiment context, file metadata and checksums, rule set, checks performed and not assessed, summary, findings, replicate groups, controls, standard curves, reviews and wells. |
| `<id>.platecheck.json` | `format: "assaylint-packet"`, `packet_version: 1`: the complete experiment, including original files and audit history, plus the analysis. Importing verifies each embedded file's SHA-256. |

Finding IDs are `<rule>:<key>` and stay stable across re-analysis of the same input, so reviews remain attached. Reviews of findings that no longer appear (for example after a plate-map correction) are kept and listed separately in the report.
