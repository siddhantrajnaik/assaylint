// Browser storage (localStorage). Nothing leaves the device; see PRIVACY.md.
import { normalizeExperiment, cleanAnalysisSettings, newId } from "./core.js";

const P = "assaylint.v1.";
const ls = () => globalThis.localStorage;
const read = (k, d) => { try { const s = ls().getItem(P + k); return s ? JSON.parse(s) : d; } catch { return d; } };
const write = (k, v) => ls().setItem(P + k, JSON.stringify(v)); // throws when storage is full or disabled

// The list of runs, ignoring anything that isn't a proper entry (storage can be damaged or edited by hand).
export function index() {
  const v = read("index", []);
  return (Array.isArray(v) ? v : []).filter(e => e && typeof e === "object" && typeof e.id === "string" && e.id)
    .map(e => ({ id: e.id, title: typeof e.title === "string" && e.title ? e.title : "Untitled run", date: typeof e.date === "string" ? e.date : "",
      updated: typeof e.updated === "string" ? e.updated : "", status: typeof e.status === "string" ? e.status : "no_data", label: typeof e.label === "string" ? e.label : "" }));
}
export function load(id) {
  try { const e = read("exp." + id, null); return e ? normalizeExperiment(e) : null; } catch { return null; }
}
export function save(exp, summary) {
  write("exp." + exp.id, exp);
  const idx = index().filter(e => e.id !== exp.id);
  idx.unshift({ id: exp.id, title: exp.title, date: exp.date, updated: exp.updated, status: summary?.status || "no_data", label: summary?.label || "No data imported" });
  write("index", idx);
}
export function remove(id) {
  ls().removeItem(P + "exp." + id);
  write("index", index().filter(e => e.id !== id));
}
export function profiles() {
  const v = read("profiles", []);
  return (Array.isArray(v) ? v : []).filter(p => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.versions) && p.versions.length
    && p.versions.every(x => x && typeof x === "object" && x.values && typeof x.values === "object"));
}
export const saveProfiles = list => write("profiles", list);
export const getSetting = k => { const v = read("settings", {}); return v && typeof v === "object" ? v[k] : undefined; };
export const setSetting = (k, v) => { const cur = read("settings", {}); write("settings", { ...(cur && typeof cur === "object" && !Array.isArray(cur) ? cur : {}), [k]: v }); };
// Studies: several saved runs analysed together (web/analysis.js). Stored like runs: an index plus one entry each.
const strList = v => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === "string" && x))].slice(0, 200) : []);
export function normalizeStudy(s) {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const now = new Date().toISOString(), str = v => (typeof v === "string" ? v : "");
  const ex = s.excluded && typeof s.excluded === "object" && !Array.isArray(s.excluded) ? s.excluded : {};
  return { id: str(s.id) || newId().replace(/^AL-/, "ST-"), title: str(s.title).slice(0, 300) || "Untitled study", runs: strList(s.runs),
    settings: cleanAnalysisSettings(s.settings) || cleanAnalysisSettings({ on: true }), mode: ["calibrator", "centre", "none"].includes(s.mode) ? s.mode : "calibrator",
    calibrators: strList(s.calibrators), excluded: Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, strList(v)]).filter(([, v]) => v.length)),
    created: str(s.created) || now, updated: str(s.updated) || now };
}
export function studies() {
  const v = read("studies", []);
  return (Array.isArray(v) ? v : []).filter(e => e && typeof e === "object" && typeof e.id === "string" && e.id)
    .map(e => ({ id: e.id, title: typeof e.title === "string" && e.title ? e.title : "Untitled study", updated: typeof e.updated === "string" ? e.updated : "",
      runs: Number.isInteger(e.runs) && e.runs >= 0 ? e.runs : 0 }));
}
export function loadStudy(id) {
  try { return normalizeStudy(read("study." + id, null)); } catch { return null; }
}
export function saveStudy(study) {
  const s = normalizeStudy(study);
  if (!s) return null;
  s.updated = new Date().toISOString();
  write("study." + s.id, s);
  write("studies", [{ id: s.id, title: s.title, updated: s.updated, runs: s.runs.length }, ...studies().filter(e => e.id !== s.id)]);
  return s;
}
export function removeStudy(id) {
  ls().removeItem(P + "study." + id);
  write("studies", studies().filter(e => e.id !== id));
}
export function usageBytes() {
  let n = 0;
  for (let i = 0; i < ls().length; i++) { const k = ls().key(i); if (k.startsWith(P)) n += k.length + (ls().getItem(k)?.length || 0); }
  return n * 2;
}
