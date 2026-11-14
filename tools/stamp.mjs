// Copies web/ to an output folder with "?v=<version>" added to every local script, module import and stylesheet,
// so browsers fetch the new files after each deploy instead of showing a cached old copy.
// Usage: node tools/stamp.mjs <out-dir> <version>
import { cpSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const [out, version] = process.argv.slice(2);
if (!out || !version || !/^[\w.-]+$/.test(version)) { console.error("Usage: node tools/stamp.mjs <out-dir> <version>"); process.exit(2); }
const WEB = join(import.meta.dirname, "..", "web");
rmSync(out, { recursive: true, force: true });
cpSync(WEB, out, { recursive: true, filter: src => !/[\\/](package(-lock)?\.json|_tmp)$/.test(src) });

const v = `?v=${version}`;
const stampJs = s => s.replace(/((?:\bfrom|\bimport\s*\()\s*)(["'])(\.{1,2}\/[^"'?]+?\.m?js)\2/g, (_, a, q, p) => `${a}${q}${p}${v}${q}`);
const stampHtml = s => s
  .replace(/\b(href|src)="((?!https?:|\/\/|data:|#|mailto:)[^"?]+?\.(?:css|js|mjs))"/g, (_, a, p) => `${a}="${p}${v}"`)
  .replace(/(<script type="importmap">)([\s\S]*?)(<\/script>)/, (_, o, body, c) => o + body.replace(/("\.\/[^"?]+?\.m?js)"/g, `$1${v}"`) + c)
  .replace(/(<script type="module">)([\s\S]*?)(<\/script>)/g, (_, o, body, c) => o + stampJs(body) + c);

// Write the build id into core.js so reports and the home page name the exact code.
{ const core = join(out, "core.js"), src = readFileSync(core, "utf8");
  if (!src.includes('export const BUILD = "dev";')) { console.error("core.js has no BUILD line to stamp"); process.exit(1); }
  writeFileSync(core, src.replace('export const BUILD = "dev";', `export const BUILD = "${version}";`)); }
let n = 0;
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const ext = extname(name);
    if (![".js", ".mjs", ".html"].includes(ext)) continue;
    const before = readFileSync(p, "utf8"), after = ext === ".html" ? stampHtml(before) : stampJs(before);
    if (after !== before) { writeFileSync(p, after); n++; }
  }
};
walk(out);
console.log(`Stamped ${n} files in ${out} with ${v}`);
