// "Targets" panel on the Method details tab: RNA type, gene symbol and species per target, an optional
// database lookup, and notes for each RNA type in the run. app.js passes in what this needs (see targetsPanel).
import * as G from "./genes.js";

let busy = null; // { id, done, total } while a lookup runs
const lastError = new Map(); // experiment id → message from the last lookup
const memo = new Map(); // "species|taxid|symbol" → result, so one session doesn't ask twice
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const LOOKUP_FIELDS = ["entrez", "ensembl", "hgncId", "locus", "geneName", "description", "dbType", "lookupNote", "source", "checkedAt", "status", "asked"];

// ctx: { h, card, exp, rows, actor, change, flash, rerender, current }
//   change(action, detail, fn) logs, re-analyses, saves and re-renders (app.js change()).
//   rerender() redraws the tab if it's still showing; current() is the run open right now.
export function targetsPanel(ctx) {
  const { h, card, exp } = ctx;
  const rows = G.targetTable(exp, ctx.rows);
  if (!rows.length) return card(h("h2", null, "Targets"), h("p", { class: "muted" }, "Import results to see the targets in this run."));
  const running = busy && busy.id === exp.id, toLook = rows.filter(r => r.lookup);
  const unconfirmed = rows.filter(r => !r.confirmed);
  const types = [...new Set(rows.map(r => r.type))];
  const err = lastError.get(exp.id);

  const symbolIn = r => h("input", { type: "text", value: r.symbol || "", placeholder: "Symbol", "aria-label": `Gene symbol for ${r.name}`, style: "width:9em",
    onchange: ev => setSymbol(ctx, r, ev.target.value) });
  const typeSel = r => h("select", { "aria-label": `RNA type for ${r.name}`, onchange: ev => save(ctx, r, { type: ev.target.value }, `${r.name}: RNA type set to ${G.RNA_TYPE_LABEL[ev.target.value]}`) },
    G.RNA_TYPES.map(([k, l]) => h("option", { value: k, selected: k === r.type }, l)));
  const speciesSel = r => [h("select", { "aria-label": `Species for ${r.name}`, onchange: ev => save(ctx, r, { species: ev.target.value, ...clearLookup() }, `${r.name}: species set to ${G.SPECIES_LABEL[ev.target.value]}`) },
    G.SPECIES.map(([k, l]) => h("option", { value: k, selected: k === r.species }, k === "other" ? "Other (enter taxonomy ID)" : l))),
    // "Other": the NCBI taxonomy ID is what gets sent with the symbol, so it has to be digits.
    r.species === "other" && h("input", { type: "text", inputmode: "numeric", value: r.saved.taxid || "", placeholder: "Taxonomy ID", "aria-label": `NCBI taxonomy ID for ${r.name}`, style: "width:7em;display:block;margin-top:4px",
      onchange: ev => setTaxid(ctx, r, ev.target.value) })];
  const ids = r => G.idList(r.saved, " · ") || "—";
  const status = r => {
    const s = r.saved, bits = [], day = (s.checkedAt || "").slice(0, 10), src = s.source || "the database";
    if (s.status === "found") bits.push(`Found in ${src}${day ? `, ${day}` : ""}.`);
    if (s.status === "alias") bits.push(`“${s.asked || r.name}” is another name for ${s.symbol || r.symbol} (${src}${day ? `, ${day}` : ""}).`);
    if (s.status === "not_found") bits.push(`${s.asked || r.symbol} wasn't found in ${src}.`);
    const dbType = s.dbType && G.typeFromDb(s.dbType, s.symbol || r.symbol);
    if (dbType && dbType !== r.type) bits.push(`The database lists it as ${s.dbType}.`);
    if (s.lookupNote) bits.push(s.lookupNote);
    bits.push(r.confirmed ? `Confirmed by ${s.confirmedBy}.` : "Guessed from the name.");
    return bits.join(" ");
  };
  const notes = r => [...r.guess.notes.filter(n => !/assuming human/.test(n) || !r.saved.species), !r.check.ok && r.symbol ? r.check.reason : null].filter(Boolean);

  return card(
    h("div", { class: "head" }, h("div", null, h("h2", null, "Targets"),
      h("p", { class: "muted", style: "margin:4px 0 0" }, "What each target is. I guess the RNA type and gene symbol from the name in your file; change anything that's wrong, or click OK if it's right. Each species writes symbols its own way: human ACTB, MIR21; mouse and rat Actb, Mir21a; zebrafish actb1, mir21-1; worm act-1; yeast ACT1 or YFL039C; Arabidopsis ACT2 or AT3G18780. A species guessed from a prefix such as dre- or ath- is only a guess, so check it.")),
      h("div", { class: "row" },
        unconfirmed.length > 0 && h("button", { class: "btn", type: "button", onclick: () => confirmAll(ctx, unconfirmed) }, `Confirm all (${unconfirmed.length})`),
        h("button", { class: "btn primary", type: "button", disabled: running || !toLook.length, onclick: () => lookUp(ctx) },
          running ? `Looking up ${busy.done + 1} of ${busy.total}…` : "Look up genes"))),
    h("p", { class: "fine" }, "“Look up genes” sends only the gene symbols below (for example ACTB or MIR21) and their species to MyGene.info, and, for human genes only, to HGNC if MyGene.info can't be reached, to get the Entrez and Ensembl IDs and a one-line description. Nothing else leaves your browser: no sample names, Ct values or file contents. Nothing is sent until you press the button."),
    err && h("p", { class: "error" }, err),
    h("div", { class: "tablewrap" }, h("table", { class: "tbl" },
      h("thead", null, h("tr", null, ["Target in file", "Gene symbol", "Species", "RNA type", "IDs", "Description", "Status", ""].map(x => h("th", null, x)))),
      h("tbody", null, rows.map(r => h("tr", null,
        h("td", null, h("span", { class: "mono" }, r.name), notes(r).map(n => h("small", { style: "display:block;max-width:22em", class: "muted" }, n))),
        h("td", null, symbolIn(r)), h("td", null, speciesSel(r)), h("td", null, typeSel(r)),
        h("td", { class: "mono", style: "font-size:12px" }, ids(r)),
        h("td", { style: "max-width:22em" }, G.describe(r.saved) || "—"),
        h("td", { style: "max-width:16em" }, h("small", null, status(r))),
        h("td", null, !r.confirmed && h("button", { class: "btn small", type: "button", onclick: () => save(ctx, r, {}, `${r.name}: confirmed as ${r.symbol || "no symbol"}, ${G.RNA_TYPE_LABEL[r.type]}`) }, "OK"))))))),
    h("div", { class: "rule-group" }, h("h3", null, "Notes for the RNA types in this run"),
      types.map(t => h("p", null, h("b", null, G.RNA_TYPE_LABEL[t] + ". "), G.TYPE_NOTES[t])),
      rows.some(r => /^MT-/i.test(r.symbol || "")) && h("p", null, h("b", null, "Mitochondrial genes. "), G.MITO_NOTE)));
}

const clearLookup = () => Object.fromEntries(LOOKUP_FIELDS.map(k => [k, undefined]));
function record(ctx, r, patch, confirm = true) {
  const cur = own(ctx.exp.targets, r.name) ? ctx.exp.targets[r.name] : {};
  // Confirming stores what's on screen; a lookup stores only what it found.
  const rec = { symbol: r.symbol, ...(confirm ? { type: r.type } : {}), species: r.species, ...cur, ...patch };
  if (confirm) Object.assign(rec, { confirmedBy: ctx.actor(), confirmedAt: new Date().toISOString() });
  for (const k of Object.keys(rec)) if (rec[k] === undefined || rec[k] === "") delete rec[k];
  return rec;
}
function save(ctx, r, patch, detail) {
  ctx.change("targets.edit", detail, () => G.putTarget(ctx.exp.targets, r.name, record(ctx, r, patch)));
}
function setSymbol(ctx, r, raw) {
  const v = raw.trim();
  if (v === (r.symbol || "")) return;
  if (v && (v.length > 40 || /[^A-Za-z0-9.-]/.test(v))) { ctx.flash(`“${v.slice(0, 40)}” can't be a gene symbol: use only letters, digits and hyphens.`, true); ctx.rerender(); return; }
  save(ctx, r, { symbol: v, ...clearLookup() }, `${r.name}: gene symbol “${r.symbol || ""}” → “${v}”`);
}
function setTaxid(ctx, r, raw) {
  const v = raw.trim();
  if (v === (r.saved.taxid || "")) return;
  if (v && !/^\d{1,9}$/.test(v)) { ctx.flash(`“${v.slice(0, 20)}” isn't an NCBI taxonomy ID; use digits only (for example 4932 for S. cerevisiae).`, true); ctx.rerender(); return; }
  save(ctx, r, { taxid: v, ...clearLookup() }, `${r.name}: taxonomy ID ${v ? `set to ${v}` : "cleared"}`);
}
function confirmAll(ctx, rows) {
  ctx.change("targets.confirm", `Confirmed ${rows.length} target(s): ${rows.map(r => `${r.name} = ${r.symbol || "no symbol"} (${G.RNA_TYPE_LABEL[r.type]})`).join("; ")}`,
    () => { for (const r of rows) G.putTarget(ctx.exp.targets, r.name, record(ctx, r, {})); });
}

// Looks up every target that has a usable symbol and hasn't been looked up with that symbol yet.
async function lookUp(ctx) {
  const exp = ctx.exp, all = G.targetTable(exp, ctx.rows).filter(r => r.lookup);
  const fresh = all.filter(r => !(r.saved.checkedAt && (r.saved.asked === r.symbol || r.saved.symbol === r.symbol)));
  const rows = fresh.length ? fresh : all; // everything already looked up: pressing again refreshes it
  if (!rows.length || busy) return;
  busy = { id: exp.id, done: 0, total: rows.length };
  lastError.delete(exp.id);
  ctx.rerender();
  const results = [];
  let failures = 0, error = "";
  for (const r of rows) {
    const key = `${r.species}|${r.taxid}|${r.symbol}`;
    let res = memo.get(key);
    if (!res || !fresh.length) {
      try { res = await G.lookupGene(r.symbol, { species: r.species, taxid: r.taxid, extra: r.symbol === r.guess.symbol ? r.guess.extra : [] }); }
      catch (e) { res = { status: "error", error: String(e?.message || e) }; }
      if (res.status !== "error") memo.set(key, res);
    }
    if (res.status === "error") { failures++; error = res.error; if (failures >= 2) break; }
    else { failures = 0; results.push([r, res]); }
    busy.done++;
    if (ctx.current()?.id === exp.id && busy.done < busy.total) ctx.rerender();
  }
  busy = null;
  if (ctx.current()?.id !== exp.id) return; // the user opened another run meanwhile; drop the answers
  if (error) lastError.set(exp.id, `Some genes couldn't be looked up: ${error}`);
  if (!results.length) { ctx.rerender(); return; }
  const found = results.filter(([, x]) => x.status !== "not_found"), source = [...new Set(results.map(([, x]) => x.source))].join(" and ");
  ctx.change("targets.lookup", `Looked up ${results.length} gene symbol(s) in ${source}: ${found.length} found${results.length > found.length ? `, not found: ${results.filter(([, x]) => x.status === "not_found").map(([r]) => r.symbol).join(", ")}` : ""}. Only the symbols were sent.`, () => {
    for (const [r, x] of results) {
      const cur = own(exp.targets, r.name) ? exp.targets[r.name] : {};
      const patch = x.status === "not_found"
        ? { ...clearLookup(), status: "not_found", source: x.source, checkedAt: x.checkedAt, asked: x.asked }
        : { ...clearLookup(), symbol: x.symbol, entrez: x.entrez, ensembl: x.ensembl, hgncId: x.hgncId, locus: x.locus, geneName: x.geneName, description: x.description,
          dbType: x.dbType, lookupNote: x.lookupNote, source: x.source, checkedAt: x.checkedAt, status: x.status, asked: x.asked || r.symbol,
          // The user's own choice of type wins; otherwise take the database's.
          type: cur.confirmedBy && cur.type ? cur.type : x.type || r.type };
      G.putTarget(exp.targets, r.name, record({ ...ctx, exp }, r, patch, false));
    }
  });
}
