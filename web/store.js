// Browser storage (localStorage). Nothing leaves the device; see PRIVACY.md.
import { normalizeExperiment } from "./core.js";

const P = "assaylint.v1.";
const ls = () => globalThis.localStorage;
const read = (k, d) => { try { const s = ls().getItem(P + k); return s ? JSON.parse(s) : d; } catch { return d; } };
const write = (k, v) => ls().setItem(P + k, JSON.stringify(v)); // throws when storage is full or disabled

export const index = () => read("index", []);
export const load = id => { const e = read("exp." + id, null); return e ? normalizeExperiment(e) : null; };
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
export const profiles = () => read("profiles", []);
export const saveProfiles = list => write("profiles", list);
export const getSetting = k => read("settings", {})[k];
export const setSetting = (k, v) => write("settings", { ...read("settings", {}), [k]: v });
export function usageBytes() {
  let n = 0;
  for (let i = 0; i < ls().length; i++) { const k = ls().key(i); if (k.startsWith(P)) n += k.length + (ls().getItem(k)?.length || 0); }
  return n * 2;
}
