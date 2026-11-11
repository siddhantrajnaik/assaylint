// Browser storage (localStorage). Nothing leaves the device; see PRIVACY.md.
import { normalizeExperiment } from "./core.js";

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
export function usageBytes() {
  let n = 0;
  for (let i = 0; i < ls().length; i++) { const k = ls().key(i); if (k.startsWith(P)) n += k.length + (ls().getItem(k)?.length || 0); }
  return n * 2;
}
