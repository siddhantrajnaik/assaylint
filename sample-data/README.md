# Sample data to try PlateCheck

These files are made up but laid out exactly like real instrument exports. Each one has a few problems planted in it so you can see what PlateCheck catches.

Open https://siddhantrajnaik.github.io/platecheck/ and drop the files for one run onto the home page, all at once. It works out which file is which and takes you straight to the review.

## 1. Bio-Rad CFX96, SYBR Green (start here)

Drop all three `1 CFX96 SYBR` files together. Melt checks switch on by themselves because a melt file is included.

What's planted:
- The IL6 NTC (H02) amplifies, and its melt peak is low, which looks like primer-dimer
- B05 has a second melt peak
- H03 is labelled "Neg Ctrl", which is ambiguous: on the Plate page, click H03 and choose No-RT
- One set of replicates spreads too much

## 2. QuantStudio 5, 384-well TaqMan duplex

Drop both `2 QuantStudio 384 TaqMan` files together.

What's planted:
- A well marked Omit in the instrument software
- One NTC comes up late (Ct 36.8)
- A VIC signal failed in one well
- A 6-point standard curve (efficiency around 100%)

## 3. Simple hand-made CSV

Drop `3 Simple hand-made CSV - results.csv` on its own.

What's planted:
- A typo in a well name (A1O instead of A04)
- A missing Ct ("N/A")
- A blank line and an "Average" row, which PlateCheck handles without losing data
