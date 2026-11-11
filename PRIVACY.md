# Data handling (PRD FR-22 to FR-25)

AssayLint is a static web app. This describes the hosted GitHub Pages build and local copies alike.

| Topic | Behaviour |
|---|---|
| Processing | All parsing and checks run in the browser tab. Files are never uploaded. There is no server-side code, account system, analytics or telemetry. |
| Storage location | The browser's `localStorage` for this site, on this device. Keys start with `assaylint.v1.`. Each experiment stores the original imported files verbatim, the plate-map edits, context, rule set, reviews and audit history. |
| Encryption | AssayLint does not encrypt stored data. Protection relies on the device account and disk encryption. Pages traffic uses HTTPS, but only the app itself is downloaded. |
| Access | Anyone who can use this browser profile can open the data. There are no collaborator accounts; share by exporting a packet or report through a channel you trust. |
| Retention | Data stays until you delete the experiment or clear the site's data. Browsers limit storage per site (typically about 5 MB); AssayLint warns if a save fails. |
| Backup | None. Export the experiment packet to keep a copy. |
| Export | Report (HTML/PDF), well CSV, findings CSV, structured JSON and a full experiment packet, from the Report & export tab or the CLI. |
| Deletion | “Delete experiment” removes the experiment, its files, plate map, notes, reports and audit history from this browser. Clearing site data removes everything, including rule profiles and settings. Exported files are outside AssayLint's control. |
| Secondary use | None. Data is never used for model training, benchmarking or sharing, so there is nothing to opt into. |

The GitHub Pages host (GitHub) receives normal web-server request logs for the page and its static files; it never receives experiment data.
