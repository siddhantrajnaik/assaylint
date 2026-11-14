# Data handling (PRD FR-22 to FR-25)

PlateCheck is a static web app. This describes the hosted GitHub Pages build and local copies alike.

| Topic | Behaviour |
|---|---|
| Processing | All parsing and checks run in the browser tab. Files are never uploaded. There is no server-side code, account system, analytics or telemetry. |
| Storage location | The browser's `localStorage` for this site, on this device. Keys start with `assaylint.v1.`. Each experiment stores the original imported files verbatim, the plate-map edits, context, rule set, reviews and audit history. |
| Encryption | PlateCheck does not encrypt stored data. Protection relies on the device account and disk encryption. Pages traffic uses HTTPS, but only the app itself is downloaded. |
| Access | Anyone who can use this browser profile can open the data. There are no collaborator accounts; share by exporting a packet or report through a channel you trust. |
| Retention | Data stays until you delete the experiment or clear the site's data. Browsers limit storage per site (typically about 5 MB); PlateCheck warns if a save fails. |
| Backup | None. Export the experiment packet to keep a copy. |
| Export | Report (HTML/PDF), well CSV, findings CSV, structured JSON and a full experiment packet, from the Report & export tab or the CLI. |
| Deletion | “Delete experiment” removes the experiment, its files, plate map, notes, reports and audit history from this browser. Clearing site data removes everything, including rule profiles and settings. Exported files are outside PlateCheck's control. |
| Gene lookup | Off unless you press “Look up genes” in the Targets panel. Then the browser sends only the gene symbols of your targets (for example `ACTB`, `MIR21`) and the species (a name such as `human`, or an NCBI taxonomy ID such as `7955`) to MyGene.info (mygene.info), or, for human genes only, to HGNC (rest.genenames.org) if MyGene.info can't be reached. No sample names, Ct values, well data or file contents are sent, and no cookies. Those services see the symbols and your IP address like any web request. The answers (IDs, gene name, a one-line description, source and date) are saved with the run. If you tick “Use GO terms for gene sets”, the same request also asks for each gene's Gene Ontology biological-process terms, which are saved with the run too; what is sent doesn't change. A GMT file you upload for gene set enrichment is read in your browser and only the sets that touch your panel are kept. Details in [docs/genes.md](docs/genes.md). |
| Secondary use | None. Data is never used for model training, benchmarking or sharing, so there is nothing to opt into. |

The GitHub Pages host (GitHub) receives normal web-server request logs for the page and its static files; it never receives experiment data.
