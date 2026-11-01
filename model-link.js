import * as THREE from "three";

// The ESPL SBI project page uses this same gold icosahedron, orbit reveal,
// timing, and label unfurl to lead visitors into the live model.
export function createModelLink(container) {
  const link = document.createElement("a");
  link.className = "model-link";
  link.href = "https://espl.ae.gatech.edu/research/models/sbi/";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "Explore the interactive SBI model");
  link.innerHTML = '<span class="model-link-icon" aria-hidden="true"><canvas class="model-link-canvas" width="116" height="116"></canvas></span><span class="model-link-label">Explore the interactive model&nbsp; →</span>';
  link.addEventListener("click", event => event.stopPropagation());
  container.append(link);

  const canvas = link.querySelector("canvas");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .1, 20);
  camera.position.z = 4.3;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (error) {
    console.warn("Model-link WebGL unavailable.", error);
    link.classList.add("is-arrived", "is-open");
    return () => link.remove();
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(44, 44, false);
  renderer.setClearColor(0, 0);
  scene.add(new THREE.AmbientLight(0xffffff, .75));
  const key = new THREE.DirectionalLight(0xffffff, 1.3);
  key.position.set(1.35, 1.65, 2.4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe7a3, .2);
  fill.position.set(-1.35, -.7, 1.35);
  scene.add(fill);
  const globe = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ color: 0xf4ba20, emissive: 0xeaaa00,
      emissiveIntensity: .18, flatShading: true, roughness: .76, metalness: .08 }));
  globe.rotation.set(.45, .65, 0);
  scene.add(globe);
  const orbitRoot = new THREE.Group();
  orbitRoot.rotation.set(THREE.MathUtils.degToRad(29), THREE.MathUtils.degToRad(15),
    THREE.MathUtils.degToRad(14));
  scene.add(orbitRoot);
  const orbitPoints = [];
  for (let index = 0; index <= 360; index += 1) {
    const angle = index / 360 * Math.PI * 2;
    const point = new THREE.Vector3(Math.cos(angle) * 1.12, Math.sin(angle) * 1.12, 0);
    point.applyAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(64));
    point.applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(22));
    orbitPoints.push(point);
  }
  const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(orbitPoints),
    360, .024, 6, false);
  const orbit = new THREE.Mesh(geometry,
    new THREE.MeshBasicMaterial({ color: 0, depthWrite: false }));
  orbitRoot.add(orbit);
  const rest = globe.rotation.y;
  const ease = value => value * value * (3 - 2 * value);
  let progress = 0, frame = 0, open = false, destroyed = false;
  const timers = new Set();
  const later = (callback, delay) => {
    const timer = setTimeout(() => { timers.delete(timer); if (!destroyed) callback(); }, delay);
    timers.add(timer);
  };
  function draw(value) {
    progress = Math.max(0, Math.min(1, value));
    geometry.setDrawRange(0, Math.floor(progress * 360) * 36);
    renderer.render(scene, camera);
  }
  function motion(close = false) {
    cancelAnimationFrame(frame);
    if (reduced.matches) {
      globe.rotation.y = rest + (close ? 0 : 1.05);
      draw(close ? 0 : 1);
      return;
    }
    const from = globe.rotation.y, fromProgress = progress;
    const started = performance.now(), duration = close ? 700 : 950;
    const tick = now => {
      if (destroyed) return;
      const amount = ease(Math.min(1, (now - started) / duration));
      globe.rotation.y = from + (rest + (close ? 0 : 1.05) - from) * amount;
      draw(fromProgress + ((close ? 0 : 1) - fromProgress) * amount);
      if (now - started < duration) frame = requestAnimationFrame(tick);
      else frame = 0;
    };
    frame = requestAnimationFrame(tick);
  }
  function reveal() {
    if (open || destroyed) return;
    open = true;
    link.classList.add("is-open");
    motion();
  }
  function retract() {
    if (!open || link.matches(":hover") || document.activeElement === link) return;
    open = false;
    link.classList.remove("is-open");
    motion(true);
  }
  draw(0);
  link.addEventListener("mouseenter", reveal);
  link.addEventListener("focusin", reveal);
  link.addEventListener("mouseleave", retract);
  link.addEventListener("focusout", retract);
  later(() => link.classList.add("is-arrived"), 1100);
  return () => {
    destroyed = true;
    cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
    geometry.dispose(); orbit.material.dispose();
    globe.geometry.dispose(); globe.material.dispose();
    renderer.dispose(); link.remove();
  };
}
