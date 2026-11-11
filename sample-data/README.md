# Sample data to try AssayLint

These files are made up but laid out exactly like real instrument exports. Each one has a few problems planted in it so you can see what AssayLint catches.

Open https://siddhantrajnaik.github.io/assaylint/, click **New experiment**, go to the **Data** tab and upload them.

## 1. Bio-Rad CFX96, SYBR Green (start here)

Upload in this order:
1. `1 CFX96 SYBR - results.csv` as the results file
2. `1 CFX96 SYBR - amplification curves.csv` as amplification curves
3. `1 CFX96 SYBR - melt curves.csv` as melt curves (choose "Derivative")

Then on **Context & rules**, tick "Run melt-curve checks".

What's planted:
- The IL6 NTC (H02) amplifies, and its melt peak is low, which looks like primer-dimer
- B05 has a second melt peak
- H03 is labelled "Neg Ctrl", which is ambiguous: set it to No-RT control on the Plate map
- One set of replicates spreads too much

## 2. QuantStudio 5, 384-well TaqMan duplex

Upload `2 QuantStudio 384 TaqMan - results.txt`, then `2 QuantStudio 384 TaqMan - amplification curves.csv`.

What's planted:
- A well marked Omit in the instrument software
- One NTC comes up late (Ct 36.8)
- A VIC signal failed in one well
- A 6-point standard curve (efficiency around 100%)

## 3. Simple hand-made CSV

Upload `3 Simple hand-made CSV - results.csv` on its own.

What's planted:
- A typo in a well name (A1O instead of A04)
- A missing Ct ("N/A")
- A blank line and an "Average" row, which AssayLint handles without losing data
