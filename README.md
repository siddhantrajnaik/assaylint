# AssayLint

**Check your qPCR run before you trust the numbers.**

Live: https://siddhantrajnaik.github.io/assaylint/

I made AssayLint to catch the boring mistakes in a qPCR run before you analyse it: a mislabelled well, an NTC that came up, replicates that don't agree, a missing control, a standard curve that's off. You upload the export from your instrument and it shows you what looks off, with the exact values behind each flag.

It runs in your browser. Your files never get uploaded anywhere, and there's no account to make.

It won't tell you your experiment is right. It points out things worth a second look, and you decide what to do about each one.

## What you can do with it

- **Upload** a results file from QuantStudio, Bio-Rad CFX, ABI 7500/7900HT, LightCycler 480, or a plain CSV with well and Ct/Cq columns. Amplification and melt curve files are optional. You see what was read before anything gets checked.
- **Fix the plate map**: samples, targets, controls (NTC, positive, no-RT, standards) and which wells are the same biological sample.
- **Add method details** and set your own thresholds, or save them as a lab profile.
- **Go through the flags.** Each one tells you what was checked, what it found, why it might matter and what to look at next. Mark each as accepted, not applicable, resolved or unresolved, and add a note.
- **Download** a report (HTML or PDF), the well data and flags as CSV, or the whole experiment as one file you can open again later.
- **Compare** two runs to see what changed.

## Run it yourself

```bash
python -m http.server 8123 --directory web
```

Then open http://localhost:8123 and click **Open demo run**.

There's also a command-line version (needs Node 20+):

```bash
node cli.mjs examples/demo_results.csv --amp examples/demo_amplification.csv --melt examples/demo_melt_derivative.csv --report report.html
```

Tests:

```bash
node testdata/fetch-public.mjs
node --test tests/*.test.mjs
```

## Things to know

- I've tested it on 12 real exports from public datasets plus realistic files I generated ([testdata/README.md](testdata/README.md)). Machines I haven't seen yet may lay files out differently. If yours doesn't open, email it to me and I'll add support.
- Excel files and raw run files (`.eds`, `.pcrd`) don't open. Export CSV or text from your instrument software.
- The default thresholds are common rules of thumb, not reviewed standards. Change them to match your lab.
- Data is saved in your browser only. Download the experiment packet if you want a backup. More in [PRIVACY.md](PRIVACY.md).

More detail: [docs/formats.md](docs/formats.md) (file formats), [docs/rules.md](docs/rules.md) (every check), [docs/prd.md](docs/prd.md) (the original spec) and [docs/prd-coverage.md](docs/prd-coverage.md) (what's built).

## Who made this

**Siddhant Raj Naik**, PhD, KSBS, IIT Delhi.

Questions, bugs, or a file it can't read: **siddhantrajnaik2001@gmail.com**

LinkedIn: [siddhant-raj-naik](https://www.linkedin.com/in/siddhant-raj-naik-22065b205)

GitHub: [@siddhantrajnaik](https://github.com/siddhantrajnaik)

Built with three.js (MIT) and IBM Plex fonts (SIL OFL).
