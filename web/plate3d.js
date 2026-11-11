// 3D plate view (three.js, vendored in ./vendor). Wells are glossy cylinders coloured by worst finding.
import * as THREE from "three";
import { OrbitControls } from "./vendor/OrbitControls.js";

const COLORS = { high: 0xe5484d, medium: 0xf0a02a, low: 0xe9d84a, ok: 0x7fcf9b, empty: 0x9aa0aa };

function label(text) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"); g.fillStyle = "#4a505a"; g.font = "bold 34px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 32, 34);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  s.scale.set(0.6, 0.6, 1); return s;
}

export function createPlate(container, onPick) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  container.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1.6, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = Math.PI / 2.2; controls.minDistance = 6; controls.maxDistance = 60;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-6, 14, 8); scene.add(sun);

  let group = new THREE.Group(); scene.add(group);
  let wells = new Map(); // key -> mesh
  let selected = new Set(), hovered = null, need = true;
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();

  function resize() {
    const { clientWidth: w, clientHeight: h } = container; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); need = true;
  }
  new ResizeObserver(resize).observe(container);

  function setData({ rows, cols, flags, present }) {
    scene.remove(group); group.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
    group = new THREE.Group(); scene.add(group); wells = new Map(); selected.clear();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(cols + 1, 0.5, rows + 1),
      new THREE.MeshPhysicalMaterial({ color: 0xf4f5f8, roughness: 0.35, clearcoat: 0.8, transparent: true, opacity: 0.95 }));
    slab.position.y = -0.25; group.add(slab);
    const geo = new THREE.CylinderGeometry(0.4, 0.34, 0.5, 32);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const key = String.fromCharCode(65 + r) + (c + 1), has = present.has(key);
      const state = has ? flags.get(key) || "ok" : "empty";
      const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: COLORS[state], roughness: 0.25, clearcoat: 1, metalness: 0 }));
      m.position.set(c - (cols - 1) / 2, has ? 0.05 : -0.1, r - (rows - 1) / 2);
      m.userData = { key, has, baseY: m.position.y };
      group.add(m); wells.set(key, m);
    }
    for (let c = 0; c < cols; c++) { const s = label(String(c + 1)); s.position.set(c - (cols - 1) / 2, 0.1, -(rows + 1) / 2 - 0.2); group.add(s); }
    for (let r = 0; r < rows; r++) { const s = label(String.fromCharCode(65 + r)); s.position.set(-(cols + 1) / 2 - 0.2, 0.1, r - (rows - 1) / 2); group.add(s); }
    const d = cols * 1.25 + 4;
    camera.position.set(0, d * 0.75, d * 0.7); controls.target.set(0, 0, 0); controls.update(); resize(); need = true;
  }

  function select(keys) { selected = new Set(keys); need = true; }

  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects([...wells.values()], false)[0];
    return hit && hit.object.userData.has ? hit.object : null;
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
      const up = selected.has(m.userData.key) ? 0.35 : m === hovered ? 0.18 : 0;
      const target = m.userData.baseY + up, dy = target - m.position.y;
      if (Math.abs(dy) > 0.002) { m.position.y += dy * 0.25; need = true; }
    }
    if (need) { renderer.render(scene, camera); need = false; }
  });

  return { setData, select, dispose() { renderer.setAnimationLoop(null); renderer.dispose(); } };
}
