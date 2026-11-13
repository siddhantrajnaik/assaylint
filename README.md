# PlateCheck

**Check your qPCR run before you trust the numbers.**

Live: https://siddhantrajnaik.github.io/platecheck/

I made PlateCheck to catch the boring mistakes in a qPCR run before you analyse it: a mislabelled well, an NTC that came up, replicates that don't agree, a missing control, a standard curve that's off. You upload the export from your instrument and it shows you what looks off, with the exact values behind each flag.

It runs in your browser. Your files never get uploaded anywhere, and there's no account to make.

It won't tell you your experiment is right. It points out things worth a second look, and you decide what to do about each one.

## How to use it

1. Open the site and drop your instrument export on the home page. Add the amplification and melt curve files at the same time if you have them.
2. It takes you straight to **Review**: each flag shows what was found and the values behind it. Click "Looks fine", "Doesn't apply", "I'll fix it" or "Fixed", and it moves to the next one.
3. The bar at the top tells you what's left, for example labelling a well that has no sample, or marking which wells are controls. "Take me there" opens the right place.
4. On **Plate**, click wells (or a whole row or column) and pick what they are: sample, NTC, positive control, no-RT, standard or not used.
5. Download the report from **Report**.

Method details, thresholds, comparing two runs and renaming or deleting a run are under **More**. Tick "Show all steps" in the sidebar if you prefer the full step-by-step view.

It reads exports from QuantStudio, Bio-Rad CFX, ABI 7500/7900HT and LightCycler 480, saved as Excel (.xlsx, .xls), CSV or text, or any sheet with well and Ct/Cq columns. Besides the report, you can download the well data and flags as CSV, everything as JSON, or the whole run as one file you can open again later.

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
- Excel files open directly. PlateCheck reads every sheet and picks the results, amplification and melt sheets itself; numbers are read as stored, not as rounded on screen. Raw run files (`.eds`, `.pcrd`) don't open, so export Excel, CSV or text from your instrument software.
- The default thresholds are common rules of thumb, not reviewed standards. Change them to match your lab.
- Data is saved in your browser only. Download the experiment packet if you want a backup. More in [PRIVACY.md](PRIVACY.md).

More detail: [docs/formats.md](docs/formats.md) (file formats), [docs/rules.md](docs/rules.md) (every check), [docs/assays.md](docs/assays.md) (ChIP, MSRE, 3C and other assay calculations), [docs/prd.md](docs/prd.md) (the original spec) and [docs/prd-coverage.md](docs/prd-coverage.md) (what's built).

## Who made this

**Siddhant Raj Naik**, PhD, KSBS, IIT Delhi.

Questions, bugs, or a file it can't read: **siddhantrajnaik2001@gmail.com**

LinkedIn: [siddhant-raj-naik](https://www.linkedin.com/in/siddhant-raj-naik-22065b205)

With guidance from **Sanket Mukherjee**, PhD, KSBS, IIT Delhi (smukherjee109@gmail.com).

PlateCheck is released under the MIT License ([LICENSE](LICENSE)). It is built with three.js (MIT), SheetJS for reading Excel files (Apache-2.0, `web/vendor/xlsx-LICENSE`) and IBM Plex fonts (SIL OFL).
