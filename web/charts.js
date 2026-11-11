// Minimal canvas line/scatter plots for curves and standard curves.
const extent = xs => [Math.min(...xs), Math.max(...xs)];
const tick = v => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

export function plot(cv, { series = [], points = [], line = null, hline = null, xLabel = "", yLabel = "", empty = "No data" }) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const w = cv.clientWidth || 400, h = cv.clientHeight || 220;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  g.font = "11px system-ui, sans-serif";
  const all = [...series.flatMap(s => s.pts), ...points.map(p => [p.x, p.y])];
  if (!all.length) { g.fillStyle = "#5d6470"; g.fillText(empty, 12, 22); return; }
  let [x0, x1] = extent(all.map(p => p[0])), [y0, y1] = extent(all.map(p => p[1]));
  if (hline != null) { y0 = Math.min(y0, hline); y1 = Math.max(y1, hline); }
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const py = (y1 - y0) * 0.06; y0 -= py; y1 += py;
  const L = 50, R = 12, T = 10, B = 36;
  const X = x => L + ((x - x0) / (x1 - x0)) * (w - L - R), Y = y => h - B - ((y - y0) / (y1 - y0)) * (h - T - B);
  g.strokeStyle = "rgba(0,0,0,.12)"; g.fillStyle = "#5d6470"; g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + ((y1 - y0) * i) / 4, xv = x0 + ((x1 - x0) * i) / 4;
    g.beginPath(); g.moveTo(L, Y(yv)); g.lineTo(w - R, Y(yv)); g.stroke();
    g.textAlign = "right"; g.fillText(tick(yv), L - 6, Y(yv) + 4);
    g.textAlign = "center"; g.fillText(tick(xv), X(xv), h - B + 14);
  }
  g.fillText(xLabel, (L + w - R) / 2, h - 6);
  g.save(); g.translate(12, (T + h - B) / 2); g.rotate(-Math.PI / 2); g.fillText(yLabel, 0, 0); g.restore();
  for (const s of series) {
    g.globalAlpha = s.alpha ?? 1; g.strokeStyle = s.color || "#0a84ff"; g.lineWidth = s.width ?? 1.5;
    g.beginPath(); s.pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke();
  }
  g.globalAlpha = 1;
  if (hline != null) { g.setLineDash([5, 4]); g.strokeStyle = "#e5484d"; g.beginPath(); g.moveTo(L, Y(hline)); g.lineTo(w - R, Y(hline)); g.stroke(); g.setLineDash([]); }
  if (line) { g.strokeStyle = "#14161a"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(X(x0), Y(line.intercept + line.slope * x0)); g.lineTo(X(x1), Y(line.intercept + line.slope * x1)); g.stroke(); }
  for (const p of points) { g.fillStyle = p.color || "#0a84ff"; g.beginPath(); g.arc(X(p.x), Y(p.y), 4, 0, Math.PI * 2); g.fill(); }
}
