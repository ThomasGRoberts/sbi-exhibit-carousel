import * as THREE from "three";
import { makeEarth, makeRegion, circleTexture, latLonVector } from "./globe-geometry.js";
import { makeConstellation } from "./model-geometry.js";

// An ambient view of the same Earth, source run, orbit geometry, and J2
// propagation used by the scientific exhibit. It deliberately has no controls.
export async function createDormantCarousel(host) {
  const [geography, run] = await Promise.all([
    fetch(new URL("../assets/countries.geo.json", import.meta.url)).then(r => r.json()),
    fetch(new URL("../assets/iran-optimization.json", import.meta.url)).then(r => r.json())
  ]);
  const scene = new THREE.Scene();
  const earth = makeEarth(geography);
  scene.add(earth);
  const fields = Object.fromEntries(run.satelliteFields.map((name,index) => [name,index]));
  const rows = run.selectedSatellites.map(row => Object.fromEntries(
    ["a_km","e","i_deg","raan_deg","argp_deg","arg_lat_deg"]
      .map(name => [name,row[fields[name]]])));
  const targets = run.inputs.target_points.map(([,lat,lon]) => ({lat,lon}));
  const iran = geography.features.find(feature => feature.properties?.name === "Iran");
  if (!iran || iran.geometry.type !== "Polygon")
    throw new Error("Iran outline is unavailable for the ambient carousel");
  const region = makeRegion(iran.geometry.coordinates[0].map(([lon,lat]) => [lat,lon]));
  region.fill.material.color.setHex(0xd7b254);
  region.fill.material.opacity = .2;
  region.outline.material.color.setHex(0xb88b13);
  region.outline.material.opacity = .7;
  region.outline.geometry.setDrawRange(0,region.outlineIndexCount);
  earth.add(region.group);
  const siteTexture = circleTexture("#d3a11c", "#80621b", 8);
  const sites = new THREE.Points(new THREE.BufferGeometry().setFromPoints(
    targets.map(({lat,lon}) => latLonVector(lat,lon,1.007))),
    new THREE.PointsMaterial({map:siteTexture,size:9,sizeAttenuation:false,
      transparent:true,opacity:.8,depthTest:true,depthWrite:false}));
  sites.renderOrder = 12;
  earth.add(sites);
  const texture = circleTexture("#ffffff", "#777777", 14);
  const constellation = makeConstellation(rows,targets,{
    rMaxKm:run.coverage.max_range_km,
    interceptAltitudeKm:run.coverage.intercept_alt_km,
    minElevationDeg:run.coverage.min_elev_deg
  },run.simulation.use_j2,texture,"dormant-iran");
  scene.add(constellation.group);
  constellation.orbits.geometry.setDrawRange(0,
    Math.min(constellation.totalOrbitVertices, constellation.orbitVerticesPerPlane * 14));
  constellation.orbits.material.opacity = .22;
  constellation.satellites.geometry.setDrawRange(0, rows.length);
  constellation.satellites.material.opacity = .48;
  constellation.satellites.material.size = 5;
  earth.children[1].material.opacity = .45;
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, .01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
  renderer.setClearColor(0xffffff, 0);
  renderer.domElement.className = "dormant-carousel-canvas";
  host.prepend(renderer.domElement);
  let width = 1, height = 1, raf = 0, last = 0, seconds = 0;
  let running = false, destroyed = false, lastCoverage = -Infinity;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function resize() {
    if (destroyed) return;
    width = Math.max(1, host.clientWidth); height = Math.max(1, host.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    draw();
  }
  function draw() {
    const angle = 1.6 + seconds * .000035;
    earth.rotation.y = -angle;
    constellation.group.rotation.y = -angle;
    camera.position.set(2.65, 1.35, 3.3);
    camera.lookAt(-.77, .02, 0);
    constellation.update(seconds, seconds - lastCoverage > 350);
    if (seconds - lastCoverage > 350) lastCoverage = seconds;
    renderer.render(scene, camera);
  }
  function tick(now) {
    if (!running || destroyed) return;
    seconds += Math.min(.1, Math.max(0, (now - last) / 1000)) * (reduced ? 0 : 95);
    last = now; draw(); raf = requestAnimationFrame(tick);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host); resize();
  return {
    start() { if (running || destroyed || document.hidden) return;
      running = true; last = performance.now(); raf = requestAnimationFrame(tick); },
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; },
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true; running = false; cancelAnimationFrame(raf);
      observer.disconnect();
      scene.traverse(object => {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach(material => material?.dispose());
      });
      texture.dispose(); siteTexture.dispose();renderer.dispose();renderer.domElement.remove();
    }
  };
}
