# AssayLint

**Trust your experiment before trusting your result.** AssayLint reviews a qPCR run before you rely on it. It reads an instrument export and plate map, runs transparent checks on structure, controls, replicates, curves and method metadata, and links every flag to the evidence and the versioned rule that produced it.

It is a static web app: it runs entirely in the browser, stores data only on your device, and can be hosted on GitHub Pages. Requirements are in [docs/prd.md](docs/prd.md); what is covered and what is not is in [docs/prd-coverage.md](docs/prd-coverage.md).

> AssayLint supports human review. It does not certify an experiment, judge a biological conclusion, or guarantee reproducibility. Default thresholds are placeholders that have **not** been reviewed by a qPCR domain expert.

## What it does

1. **Setup**: experiment with a stable ID, title, date, operator and project.
2. **Data**: import a results file (Thermo QuantStudio text or CSV, Applied Biosystems SDS 7500/7900HT, Bio-Rad CFX “Quantification Cq Results”, LightCycler 480 text, or a generic Ct/Cq table), plus optional amplification and melt curves. You see a parse preview before anything is analysed; unparseable input stops with an explanation and an import template.
3. **Plate map**: edit sample, target, group, role (sample, NTC, positive, no-RT, standard, empty), biological unit and quantity per well, in bulk or per row, or import a plate-map template. Edits change labels only; file values stay visible.
4. **Context & rules**: method context (protocol, assay details, efficiency evidence, analysis method, instrument, run settings, lots, deviations); configurable, versioned rule profiles; expected controls per target, with “not applicable” plus a reason.
5. **Findings**: summary status (not a score), a 3D plate (three.js, 2D fallback), amplification, melt and standard-curve plots, replicate and biological-unit tables, and findings sortable by severity, well, sample, target, category or rule. Each finding says what was checked, what AssayLint saw, why it might matter and what to check next, and can be marked accepted, not applicable, resolved or unresolved with a note.
6. **Report & export**: HTML report (or print to PDF), well-level CSV, findings CSV, structured JSON, and a re-importable experiment packet with checksum verification.
7. **Compare runs**: differences in recorded context and settings, mean Ct per biological unit and target, controls and finding counts.

Every change is autosaved and recorded in an audit history (who, when, what changed). The rule catalog is in [docs/rules.md](docs/rules.md); file formats are in [docs/formats.md](docs/formats.md); data handling is in [PRIVACY.md](PRIVACY.md).

## Try it

```bash
python -m http.server 8123 --directory web
```

Open http://localhost:8123 and click **Try demo** (synthetic data with deliberate issues).

Command line, using the same engine (Node 20+):

```bash
node cli.mjs examples/demo_results.csv --amp examples/demo_amplification.csv --melt examples/demo_melt_derivative.csv --expect ntc,positive,nrt --report report.html
```

Tests (public instrument files are downloaded first; their tests are skipped if absent):

```bash
node testdata/fetch-public.mjs
node --test tests/*.test.mjs
```

## Deploy to GitHub Pages

Push to a repository's `main` branch, then in **Settings → Pages** set **Source** to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` runs the tests and publishes `web/`. three.js r187 is vendored in `web/vendor/` (MIT), so no CDN is used.

## Layout

| Path | Contents |
|---|---|
| `web/core.js` | Parsers, rule catalog, analysis, comparison, packet verification (no DOM) |
| `web/report.js` | HTML report and CSV/JSON exports |
| `web/app.js`, `index.html`, `style.css` | The UI |
| `web/store.js` | Browser storage |
| `web/plate3d.js`, `web/charts.js` | 3D plate and curve plots |
| `web/demo.js` | Deterministic synthetic demo run |
| `cli.mjs` | Command line |
| `tests/` | Node tests |

## Known limits

- Parsers are tested on 12 public real exports (QuantStudio, Bio-Rad CFX, ABI 7500/7900HT) and 7 realistic fixtures ([testdata/README.md](testdata/README.md)). Other vendors and real curve exports are not yet covered.
- Excel and binary run files (`.xlsx`, `.eds`, `.pcrd`) are not read; export CSV or text.
- Storage is per browser and not encrypted by AssayLint; there are no accounts or shared lab workspaces. Share by exporting a packet.
- Rules and thresholds still need expert review (PRD §12).
