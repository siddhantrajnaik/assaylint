// Monkey test: load the real app into a simulated browser and hammer it with random clicks, typing,
// selections and file drops. Any exception, rejected promise, or "undefined"/"NaN" on screen is a failure.
// Usage: node monkey.mjs [actions] [seed]
import { JSDOM, VirtualConsole } from "jsdom";
import { readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", ".."), WEB = join(ROOT, "web");
const ACTIONS = Number(process.argv[2]) || 3000;
let seed = Number(process.argv[3]) || 1;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = a => a[Math.floor(rnd() * a.length)];

const errors = [];
let last = "(start)";
const report = (kind, e) => errors.push({ kind, after: last, msg: String(e?.stack || e?.message || e).split("\n").slice(0, 4).join(" | ") });
const vc = new VirtualConsole();
vc.on("jsdomError", e => { if (!/Not implemented/.test(e.message)) report("page error", e.detail || e); });
const html = readFileSync(join(WEB, "index.html"), "utf8").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<link[^>]*>/g, "");
const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true, virtualConsole: vc });
const w = dom.window;
const ctx = new Proxy({}, { get: (_, k) => (k === "canvas" ? {} : () => ({ width: 0 })), set: () => true });
w.HTMLCanvasElement.prototype.getContext = () => ctx;
w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
w.HTMLAnchorElement.prototype.click = () => {};
w.print = () => {};
for (const k of ["window", "document", "localStorage", "location", "Node", "Event", "File", "Blob"]) if (w[k]) globalThis[k] = w[k];
globalThis.URL.createObjectURL = () => "blob:x";
globalThis.URL.revokeObjectURL = () => {};
Object.assign(globalThis, { scrollTo: () => {}, scrollBy: () => {}, scrollY: 0, addEventListener: w.addEventListener.bind(w), devicePixelRatio: 1,
  confirm: () => rnd() < 0.8, prompt: () => pick(["Lab profile", "", null, "x".repeat(40)]) });
// No real network: "Look up genes" gets a random fake answer (found, not found, server error or offline).
const fetchLog = [];
globalThis.fetch = w.fetch = async url => {
  fetchLog.push(String(url));
  if (!/^https:\/\/(mygene\.info|rest\.genenames\.org)\//.test(String(url))) report("unexpected request", url);
  await new Promise(r => setTimeout(r, 1));
  const r = rnd(), sym = decodeURIComponent(/(?:symbol:|alias:|\/)([A-Za-z0-9.-]+)(?:&|$)/.exec(String(url))?.[1] || "X");
  if (r < 0.2) throw new TypeError("Failed to fetch");
  if (r < 0.3) return new Response("oops", { status: 503 });
  if (r < 0.5) return Response.json({ hits: [], response: { docs: [] } });
  return Response.json({ hits: [{ symbol: sym, name: pick(["fake gene", "", "x".repeat(400)]), entrezgene: 123, ensembl: pick([{ gene: "ENSG00000000001" }, [{ gene: "ENSG00000000002" }], undefined]),
    HGNC: "5", type_of_gene: pick(["protein-coding", "ncRNA", "snoRNA", "weird", null]), summary: pick(["A gene. More text.", null, "<b>x</b>"]) }],
    response: { docs: [{ symbol: sym, name: "fake", hgnc_id: "HGNC:5", locus_type: "RNA, micro" }] } });
};
process.on("unhandledRejection", e => report("rejected promise", e));
process.on("uncaughtException", e => report("uncaught", e));

// Optional: start with damaged saved data (node monkey.mjs 500 1 corrupt-start), as after a browser crash or a hand edit.
if (process.argv[4] === "corrupt-start") {
  const junk = ["x", "null", "[]", "{}", "5", "[null,7,{\"id\":\"AL-zz\",\"title\":5},{\"id\":\"AL-ok\"}]", "{\"actor\":{\"a\":1},\"allSteps\":\"yes\"}", "[{\"id\":\"p\",\"name\":\"n\",\"versions\":[null]}]"];
  for (const k of ["index", "settings", "profiles", "exp.AL-zz", "exp.AL-ok"]) localStorage.setItem("assaylint.v1." + k, pick(junk));
  localStorage.setItem("assaylint.v1.index", "[null,7,{\"id\":\"AL-zz\",\"title\":5},{\"id\":\"AL-ok\"}]");
}
// If the app itself fails to load (a syntax error, a missing file), fail loudly instead of "passing" with nothing tested.
try { await import(pathToFileURL(join(WEB, "app.js")).href); }
catch (e) { console.error("FAILED: app.js did not load.", e); process.exit(1); }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
await tick(20);
// Self-test: a handler that throws and a promise that rejects must both be caught by this harness.
{
  const b = document.createElement("button"); b.addEventListener("click", () => { throw new Error("planted crash"); }); document.body.append(b);
  b.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); Promise.reject(new Error("planted rejection")); await tick(5); b.remove();
  const caught = errors.map(e => e.msg).join(" ");
  if (!/planted crash/.test(caught) || !/planted rejection/.test(caught)) { console.log("HARNESS BROKEN: planted errors were not caught:", caught); process.exit(2); }
  errors.length = 0;
}

// Files to drop: real fixtures, sample data, and junk.
const read = p => readFileSync(join(ROOT, p));
const fixtures = [];
for (const dir of ["sample-data", "testdata/realistic", "examples"]) for (const n of readdirSync(join(ROOT, dir))) if (/\.(csv|txt|xlsx)$/.test(n)) fixtures.push([n, read(join(dir, n))]);
try { for (const d of readdirSync(join(ROOT, "testdata/public"))) for (const n of readdirSync(join(ROOT, "testdata/public", d))) fixtures.push([n, read(join("testdata/public", d, n))]); } catch { /* not downloaded */ }
const junk = [["empty.csv", ""], ["notes.txt", "hello world"], ["book.xlsx", new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], ["x.json", "{\"a\":1}"], ["half.csv", "Well,Ct\nA1"],
  ["weird.csv", "Well,Sample,Target,Ct\nA1,<img src=x onerror=1>,T,20\nA1,,,\n,,,\nZZ,s,T,abc\n"]];
const TEXTS = ["", "x", "ctrl-1", "NTC", "1e5", "-5", "0", "999999", "abc", "<b>bold</b>", "  spaced  ", "ünïcode µ", "a".repeat(300), "2026-01-01", "0.3", "1e999"];
const setFiles = (input, files) => { Object.defineProperty(input, "files", { value: files, configurable: true }); input.dispatchEvent(new w.Event("change", { bubbles: true })); };
const mkFile = ([n, c]) => new w.File([c], n);
const $$ = s => [...document.querySelectorAll(s)];
const visible = el => !el.closest("[hidden]") && !el.disabled && !(el.closest("details") && !el.closest("details").open && el.tagName !== "SUMMARY");

const ACT = {
  click() {
    const els = $$("#main button, #side button, #main summary, #main tr.click, #main .pc").filter(visible);
    if (!els.length) return "no buttons";
    const el = pick(els);
    el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    if (el.tagName === "SUMMARY") el.parentElement.open = !el.parentElement.open;
    return `click "${(el.textContent || el.title || el.className).trim().slice(0, 40)}"`;
  },
  type() {
    const els = $$("#main input[type=text], #main input[type=number], #main input[type=search], #main input[type=date], #main textarea, #side input[type=text]").filter(visible);
    if (!els.length) return "no inputs";
    const el = pick(els), v = pick(TEXTS);
    el.value = v; el.dispatchEvent(new w.Event("change", { bubbles: true }));
    return `type "${v.slice(0, 20)}" into ${el.getAttribute("aria-label") || el.type}`;
  },
  select() {
    const els = $$("#main select").filter(visible);
    if (!els.length) return "no selects";
    const el = pick(els), o = pick([...el.options]);
    el.value = o.value; el.dispatchEvent(new w.Event("change", { bubbles: true }));
    return `select "${o.textContent.slice(0, 30)}"`;
  },
  check() {
    const els = $$("#main input[type=checkbox], #side input[type=checkbox]").filter(visible);
    if (!els.length) return "no checkboxes";
    const el = pick(els);
    el.checked = !el.checked; el.dispatchEvent(new w.Event("change", { bubbles: true }));
    return "toggle checkbox";
  },
  drop() {
    const inputs = $$("input[type=file]");
    if (!inputs.length) return "no file inputs";
    const el = pick(inputs), n = el.multiple ? 1 + Math.floor(rnd() * 3) : 1, files = Array.from({ length: n }, () => mkFile(pick(rnd() < 0.75 ? fixtures : junk)));
    setFiles(el, files);
    return `drop ${files.map(f => f.name).join(" + ").slice(0, 80)}`;
  },
  home() { document.querySelector(".brand")?.dispatchEvent(new w.MouseEvent("click", { bubbles: true })); return "home"; },
  corrupt() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith("assaylint."));
    if (!keys.length) return "nothing stored";
    const k = pick(keys);
    localStorage.setItem(k, pick(["", "x", "null", "[]", "{}", "{\"id\":5}", "[null,1,{\"id\":\"zz\"}]", localStorage.getItem(k).slice(0, 50)]));
    return `corrupt ${k.slice(10, 40)}`;
  },
  // The Targets panel sits under More, which random clicks rarely reach: go there and press "Look up genes".
  genes() {
    const tab = $$("#main button").find(b => /^(Method details and thresholds|4Context & rules)$/.test(b.textContent.trim()));
    if (!tab) return "no run open";
    tab.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    const look = $$("#main button").find(b => b.textContent === "Look up genes" && !b.disabled);
    look?.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    return look ? "look up genes" : "targets panel";
  },
};
const WEIGHTS = [["click", 50], ["type", 14], ["select", 8], ["check", 5], ["drop", 14], ["home", 5], ["corrupt", 4], ["genes", 2]];
const total = WEIGHTS.reduce((a, x) => a + x[1], 0);
const counts = {}, seenText = new Set();
for (let i = 0; i < ACTIONS; i++) {
  let r = rnd() * total, name = "click";
  for (const [n, wt] of WEIGHTS) { if ((r -= wt) < 0) { name = n; break; } }
  try { last = `#${i} ${ACT[name]()}`; } catch (e) { last = `#${i} ${name}`; report("exception", e); }
  counts[name] = (counts[name] || 0) + 1;
  await tick(name === "drop" ? 25 : 1);
  const mainEl = document.querySelector("#main"), copy = mainEl.cloneNode(true);
  for (const el of copy.querySelectorAll(".mono, .fd-evidence, .tbl td small, input, textarea, iframe")) el.remove(); // values shown exactly as exported
  const text = copy.textContent;
  if (!mainEl.textContent.trim()) report("blank page", "main area is empty");
  const cleaned = text.replace(/"[^"]{0,400}"|“[^”]{0,400}”|'[^']{0,60}'/g, "").replace(/Undetermined, NaN/g, "");
  const m = /(?<![\w.])(undefined|NaN|\[object Object\]|Infinity|null)(?![\w])/.exec(cleaned);
  if (m) {
    const key = m[0] + cleaned.slice(Math.max(0, m.index - 40), m.index);
    if (!seenText.has(key)) { seenText.add(key); report("bad text on screen", `"${cleaned.slice(Math.max(0, m.index - 70), m.index + 30).replace(/\s+/g, " ")}"`); }
  }
  if (errors.length >= 25) break;
}
await tick(50);
console.log(`${ACTIONS} actions (seed ${process.argv[3] || 1}):`, JSON.stringify(counts), `| ${fixtures.length} real files in the pool | ${fetchLog.length} fake gene lookups`);
const uniq = new Map();
for (const e of errors) { const k = e.kind + e.msg.slice(0, 110); if (!uniq.has(k)) uniq.set(k, { ...e, n: 0 }); uniq.get(k).n++; }
if (!uniq.size) console.log("No errors.");
for (const e of uniq.values()) console.log(`\n[${e.kind}] x${e.n}, first after ${e.after}\n   ${e.msg.slice(0, 420)}`);
process.exit(uniq.size ? 1 : 0);
