// Downloads the public instrument exports listed in sources.json into testdata/public/.
// They are kept out of git because several source repositories state no license.
// Usage: node testdata/fetch-public.mjs
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";

const root = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
for (const s of JSON.parse(readFileSync(join(root, "sources.json"), "utf8"))) {
  const dir = join(root, "public", s.repo.replace("/", "__"));
  mkdirSync(dir, { recursive: true });
  const url = `https://raw.githubusercontent.com/${s.repo}/HEAD/${s.path.split("/").map(encodeURIComponent).join("/")}`;
  const r = await fetch(url);
  if (!r.ok) { console.log(`✖ ${s.repo}/${s.path}: HTTP ${r.status}`); continue; }
  const text = await r.text();
  if (text.length > 5e6) { console.log(`✖ ${s.repo}/${s.path}: larger than 5 MB, skipped`); continue; }
  writeFileSync(join(dir, basename(s.path)), text);
  console.log(`✔ ${s.repo}/${s.path} (${text.length} bytes)`);
}
