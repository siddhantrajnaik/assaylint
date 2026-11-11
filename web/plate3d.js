// 3D plate view (three.js, vendored in ./vendor). Matches the 2D plate map: a matte plate with the A1 corner cut,
// wells that hold data sit in their openings, and only flagged wells carry colour.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const COLORS = { high: 0xd14b3f, medium: 0xe09a3a, low: 0xe3cb62, ok: 0xbfc9c4 };
const TILT = (60 * Math.PI) / 180, VFOV = 26;

function label(text) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"); g.fillStyle = "#5b6762"; g.font = '500 30px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  s.scale.set(0.55, 0.55, 1); return s;
}
function plateShape(w, d, cut) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + cut, -d / 2); s.lineTo(w / 2, -d / 2); s.lineTo(w / 2, d / 2); s.lineTo(-w / 2, d / 2); s.lineTo(-w / 2, -d / 2 + cut); s.closePath();
  return s;
}

export function createPlate(container, onPick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(VFOV, 1.6, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = Math.PI / 2.3; controls.minDistance = 5; controls.maxDistance = 70;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2bd, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(-5, 12, 6); scene.add(key);

  let group = new THREE.Group(); scene.add(group);
  let wells = new Map(), rings = new Map(), plateW = 13, selected = new Set(), hovered = null, need = true;
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();

  // Fit the whole plate across the width of the panel.
  function frame() {
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(VFOV / 2)) * camera.aspect);
    const dist = ((plateW / 2) * 1.32) / Math.tan(hfov / 2);
    camera.position.set(0, Math.sin(TILT) * dist, Math.cos(TILT) * dist); controls.target.set(0, 0, 0.3); controls.update();
  }
  function resize() {
    const { clientWidth: w, clientHeight: h } = container; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); frame(); need = true;
  }
  new ResizeObserver(resize).observe(container);

  function setData({ rows, cols, flags, present }) {
    scene.remove(group); group.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
    group = new THREE.Group(); scene.add(group); wells = new Map(); rings = new Map();
    plateW = cols + 1.4;
    const depth = rows + 1.4, body = new THREE.ExtrudeGeometry(plateShape(plateW, depth, 1), { depth: 0.45, bevelEnabled: false });
    body.rotateX(Math.PI / 2); body.translate(0, 0, 0);
    const slab = new THREE.Mesh(body, new THREE.MeshStandardMaterial({ color: 0xe6ebe8, roughness: 0.9 }));
    group.add(slab);
    const hole = new THREE.CircleGeometry(0.42, 40).rotateX(-Math.PI / 2);
    const holeMat = new THREE.MeshStandardMaterial({ color: 0xd3dad6, roughness: 1 });
    const cyl = new THREE.CylinderGeometry(0.38, 0.38, 0.18, 40);
    const ringGeo = new THREE.RingGeometry(0.47, 0.55, 48).rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0b6b5c });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const k = String.fromCharCode(65 + r) + (c + 1), x = c - (cols - 1) / 2, z = r - (rows - 1) / 2;
      const opening = new THREE.Mesh(hole, holeMat); opening.position.set(x, 0.002, z); group.add(opening);
      if (!present.has(k)) continue;
      const m = new THREE.Mesh(cyl, new THREE.MeshStandardMaterial({ color: COLORS[flags.get(k) || "ok"], roughness: 0.7 }));
      m.position.set(x, 0.09, z); m.userData = { key: k, baseY: 0.09 }; group.add(m); wells.set(k, m);
      const ring = new THREE.Mesh(ringGeo, ringMat); ring.position.set(x, 0.004, z); ring.visible = false; group.add(ring); rings.set(k, ring);
    }
    for (let c = 0; c < cols; c++) { const s = label(String(c + 1)); s.position.set(c - (cols - 1) / 2, 0.05, -depth / 2 + 0.25); group.add(s); }
    for (let r = 0; r < rows; r++) { const s = label(String.fromCharCode(65 + r)); s.position.set(-plateW / 2 + 0.3, 0.05, r - (rows - 1) / 2); group.add(s); }
    resize(); frame(); select([...selected]);
  }

  function select(keys) {
    selected = new Set(keys);
    for (const [k, ring] of rings) ring.visible = selected.has(k);
    need = true;
  }

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    return ray.intersectObjects([...wells.values()], false)[0]?.object || null;
  }
  const el = renderer.domElement; let down = null;
  el.addEventListener("pointerdown", e => (down = [e.clientX, e.clientY]));
  el.addEventListener("pointerup", e => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const m = pick(e); if (m) onPick(m.userData.key); }
    down = null;
  });
  el.addEventListener("pointermove", e => { const m = pick(e); if (m !== hovered) { hovered = m; el.style.cursor = m ? "pointer" : "grab"; need = true; } });
  controls.addEventListener("change", () => (need = true));

  renderer.setAnimationLoop(() => {
    controls.update();
    for (const m of wells.values()) {
      const up = selected.has(m.userData.key) ? 0.28 : m === hovered ? 0.12 : 0;
      const dy = m.userData.baseY + up - m.position.y;
      if (Math.abs(dy) > 0.002) { m.position.y += dy * 0.3; need = true; }
    }
    if (need) { renderer.render(scene, camera); need = false; }
  });

  return { setData, select, dispose() { renderer.setAnimationLoop(null); renderer.dispose(); } };
}
