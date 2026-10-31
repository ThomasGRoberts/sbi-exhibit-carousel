import * as THREE from "three";
// Version the shader dependency when its uniform contract changes. The local
// development browser can otherwise retain an older ES module in the same tab.
import { makeSiteMarkers } from "./sbi-style.js?site-uniforms=2";

const EARTH_COLOR = 0xf7f7f7;
const COUNTRY_COLOR = 0xa8a8a8;
const REGION_FILL = 0xe3e3e3;
const REGION_LINE = 0x777777;
const RAD = Math.PI / 180;

export function latLonVector(lat, lon, radius = 1) {
  const latitude = lat * RAD;
  const longitude = lon * RAD;
  return new THREE.Vector3(
    radius * Math.cos(latitude) * Math.cos(longitude),
    radius * Math.sin(latitude),
    -radius * Math.cos(latitude) * Math.sin(longitude)
  );
}

export function makeEarth(geojson) {
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 160),
    new THREE.MeshBasicMaterial({ color: EARTH_COLOR, depthTest: true, depthWrite: true })
  );
  sphere.renderOrder = 0;
  group.add(sphere);

  const positions = [];
  function addRing(ring) {
    if (!ring || ring.length < 3) return;
    for (let index = 1; index < ring.length; index += 1) {
      const [lonA, latA] = ring[index - 1];
      const [lonB, latB] = ring[index];
      if (Math.abs(lonB - lonA) > 180) continue;
      const start = latLonVector(latA, lonA);
      const end = latLonVector(latB, lonB);
      const segments = Math.max(1, Math.ceil(start.angleTo(end) / (0.8 * RAD)));
      let previous = start;
      for (let step = 1; step <= segments; step += 1) {
        const next = start.clone().lerp(end, step / segments).normalize().multiplyScalar(1.001);
        positions.push(...previous.clone().multiplyScalar(1.001).toArray(), ...next.toArray());
        previous = next.clone().normalize();
      }
    }
  }
  for (const feature of geojson.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach(addRing);
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach(polygon => polygon.forEach(addRing));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const borders = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: COUNTRY_COLOR, transparent: true, opacity: 0.62,
      depthTest: true, depthWrite: false
    })
  );
  borders.renderOrder = 3;
  group.add(borders);
  return group;
}

function addSphericalTriangle(output, a, b, c, depth = 0) {
  const length = (p, q) => Math.hypot(
    (p[0] - q[0]) * Math.cos((p[1] + q[1]) * RAD / 2),
    p[1] - q[1]
  );
  if (depth >= 6 || Math.max(length(a, b), length(b, c), length(c, a)) < 3) {
    for (const [lon, lat] of [a, b, c]) {
      output.push(...latLonVector(lat, lon, 1.0008).toArray());
    }
    return;
  }
  const midpoint = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
  addSphericalTriangle(output, a, ab, ca, depth + 1);
  addSphericalTriangle(output, ab, b, bc, depth + 1);
  addSphericalTriangle(output, ca, bc, c, depth + 1);
  addSphericalTriangle(output, ab, bc, ca, depth + 1);
}

export function makeRegion(boundary) {
  const planar = boundary.map(([lat, lon]) => new THREE.Vector2(lon, lat));
  const triangles = THREE.ShapeUtils.triangulateShape(planar, []);
  const positions = [];
  triangles.forEach(([a, b, c]) => {
    const toPair = point => [point.x, point.y];
    addSphericalTriangle(positions,
      toPair(planar[a]), toPair(planar[b]), toPair(planar[c]));
  });
  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const fill = new THREE.Mesh(fillGeometry,
    new THREE.MeshBasicMaterial({
      color: REGION_FILL, side: THREE.DoubleSide, transparent: true, opacity: 0,
      depthTest: true, depthWrite: false
    }));
  fill.renderOrder = 2;

  const points = boundary.map(([lat, lon]) => latLonVector(lat, lon, 1.0015));
  const curve = new THREE.CatmullRomCurve3(points, true, "centripetal");
  const outline = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(180, points.length * 2), 0.0018, 5, true),
    new THREE.MeshBasicMaterial({
      color: REGION_LINE, transparent: true, opacity: 0,
      depthTest: true, depthWrite: false
    })
  );
  outline.renderOrder = 8;
  const outlineIndexCount = outline.geometry.index.count;
  outline.geometry.setDrawRange(0, 0);
  const group = new THREE.Group();
  group.add(fill, outline);
  return { group, fill, outline, outlineIndexCount };
}

export function circleTexture(fill, stroke = null, strokeWidth = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  context.beginPath();
  context.arc(64, 64, 37, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.lineWidth = strokeWidth;
    context.strokeStyle = stroke;
    context.stroke();
  }
  return new THREE.CanvasTexture(canvas);
}

export function fibonacciShell(count = 15000) {
  const cells = [];
  const phi = (1 + Math.sqrt(5)) / 2;
  const goldenAngle = 360 / phi;
  for (let index = 0; index < count; index += 1) {
    const lat = Math.asin(1 - (2 * index + 1) / count) / RAD;
    const lon = ((index * goldenAngle + 180) % 360 + 360) % 360 - 180;
    cells.push({ lat, lon, position: latLonVector(lat, lon, 1.003) });
  }
  return cells;
}

export function selectCellsWithinBoundary(cells, boundary) {
  const latitudes = boundary.map(point => point[0]);
  const longitudes = boundary.map(point => point[1]);
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
  const selected = [];
  cells.forEach((cell, index) => {
    if (cell.lat < minLat || cell.lat > maxLat || cell.lon < minLon || cell.lon > maxLon) return;
    let inside = false;
    for (let edge = 0, previous = boundary.length - 1;
      edge < boundary.length; previous = edge, edge += 1) {
      const [latA, lonA] = boundary[edge];
      const [latB, lonB] = boundary[previous];
      if ((latA > cell.lat) !== (latB > cell.lat) &&
        cell.lon < (lonB - lonA) * (cell.lat - latA) / (latB - latA) + lonA) {
        inside = !inside;
      }
    }
    if (inside) selected.push(index);
  });
  return selected;
}

export function makeSampling(cells, targetIndices, globalTexture, markerSize) {
  const globalPositions = new Float32Array(cells.length * 3);
  cells.forEach((cell, index) => cell.position.toArray(globalPositions, index * 3));
  const globalGeometry = new THREE.BufferGeometry();
  globalGeometry.setAttribute("position", new THREE.BufferAttribute(globalPositions, 3));
  const global = new THREE.Points(globalGeometry, new THREE.PointsMaterial({
    map: globalTexture, size: 2.3, sizeAttenuation: false,
    transparent: true, opacity: 0, depthTest: true, depthWrite: false,
    alphaTest: 0.02
  }));
  global.frustumCulled = false;

  const selectedPositions = new Float32Array(targetIndices.length * 3);
  const phases = new Float32Array(targetIndices.length);
  const longitudes = targetIndices.map(index => cells[index].lon);
  const latitudes = targetIndices.map(index => cells[index].lat);
  const minLon = Math.min(...longitudes), maxLon = Math.max(...longitudes);
  const minLat = Math.min(...latitudes), maxLat = Math.max(...latitudes);
  targetIndices.forEach((index, position) => {
    cells[index].position.toArray(selectedPositions, position * 3);
    // A shallow diagonal wave keeps densely sampled longitudes from flashing together.
    phases[position] = .77 * (cells[index].lon - minLon) / Math.max(1, maxLon - minLon) +
      .23 * (cells[index].lat - minLat) / Math.max(1, maxLat - minLat);
  });
  const { markers: selected, uniforms } = makeSiteMarkers(selectedPositions, phases, markerSize);
  return { global, selected, uniforms };
}
