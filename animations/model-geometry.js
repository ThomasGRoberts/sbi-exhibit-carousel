import * as THREE from "three";
import { EARTH_RADIUS_KM, MU_EARTH_KM3_S2, EARTH_ROTATION_RATE_RAD_PER_SEC } from "./sbi-style.js";

// Constants and analytical conventions match sbi-constellation-viz/app.js.
const PLANE_INC_BIN_DEG = 0.5;
const PLANE_RAAN_BIN_DEG = 2.5;
const TRAJECTORY_SEGMENTS = 180;
const RAD = Math.PI / 180;
const GOLD = [1, 0.84, 0.02];
const GRAY = [0.68, 0.68, 0.68];

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function averageAngleDegrees(values) {
  const x = values.reduce((sum, value) => sum + Math.cos(value * RAD), 0);
  const y = values.reduce((sum, value) => sum + Math.sin(value * RAD), 0);
  return Math.atan2(y, x) / RAD;
}

function orbitalRatesRadPerSec(aKm, e, inclination, useJ2) {
  const n = Math.sqrt(MU_EARTH_KM3_S2 / aKm ** 3);
  if (!useJ2) return { raan: 0, argument: n };
  const j2 = 1.08262668e-3;
  const p = aKm * (1 - e * e);
  const factor = j2 * (EARTH_RADIUS_KM / p) ** 2;
  const sinI = Math.sin(inclination);
  const nBar = n * (1 + .75 * factor * Math.sqrt(1 - e * e) * (2 - 3 * sinI * sinI));
  const perigeeRate = .75 * factor * nBar * (4 - 5 * sinI * sinI);
  return {
    raan: -1.5 * factor * nBar * Math.cos(inclination),
    argument: nBar + perigeeRate
  };
}

function clusterPlanes(rows) {
  const bins = new Map();
  rows.forEach((row, index) => {
    const inclination = Math.round(row.i_deg / PLANE_INC_BIN_DEG) * PLANE_INC_BIN_DEG;
    const raan = normalizeDegrees(
      Math.round(normalizeDegrees(row.raan_deg) / PLANE_RAAN_BIN_DEG) * PLANE_RAAN_BIN_DEG);
    const key = inclination + ":" + raan;
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(index);
  });
  return [...bins.values()].map(indices => ({
    indices,
    aKm: indices.reduce((sum, index) => sum + rows[index].a_km, 0) / indices.length,
    inclination: indices.reduce((sum, index) => sum + rows[index].i_deg, 0) /
      indices.length * RAD,
    raan: averageAngleDegrees(indices.map(index => rows[index].raan_deg)) * RAD
  }));
}

function geographicPoint(latitude, longitude, radius) {
  const lat = latitude * RAD, lon = longitude * RAD;
  return [radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat), -radius * Math.cos(lat) * Math.sin(lon)];
}

// Source SBI criterion: a satellite is active if it is within r_max of at
// least one launch-site position on the intercept-altitude shell and meets
// minimum elevation at that position. This is not a missile intercept test.
function coversAnyTarget(sx, sy, sz, targets, rangeSquared, minSinElevation) {
  for (let index = 0; index < targets.length; index += 3) {
    const dx = sx - targets[index];
    const dy = sy - targets[index + 1];
    const dz = sz - targets[index + 2];
    const distanceSquared = dx * dx + dy * dy + dz * dz;
    if (distanceSquared > rangeSquared || distanceSquared <= 0) continue;
    const dot = dx * targets[index] + dy * targets[index + 1] + dz * targets[index + 2];
    const elevationSin = dot /
      (Math.sqrt(distanceSquared) * Math.hypot(targets[index], targets[index + 1], targets[index + 2]));
    if (elevationSin >= minSinElevation) return true;
  }
  return false;
}

export function makeConstellation(rows, targetCells, coverage, useJ2, spriteTexture, scenarioKey = "scenario") {
  if (!rows.length || !targetCells.length || !coverage?.rMaxKm) {
    throw new Error("The stored model run has incomplete constellation or coverage data");
  }
  const planes = clusterPlanes(rows);
  let seed = 2166136261;
  for (const char of scenarioKey + ":carousel-arrival") seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  for (let index = planes.length - 1; index > 0; index -= 1) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    const swap = (seed >>> 0) % (index + 1);
    [planes[index], planes[swap]] = [planes[swap], planes[index]];
  }
  const planeSatelliteEnds = [];
  let runningCount = 0;
  planes.forEach(plane => { runningCount += plane.indices.length; planeSatelliteEnds.push(runningCount); });
  const group = new THREE.Group();
  const radius = (EARTH_RADIUS_KM + coverage.interceptAltitudeKm) / EARTH_RADIUS_KM;
  const targets = new Float64Array(targetCells.length * 3);
  targetCells.forEach((cell, index) => {
    targets.set(geographicPoint(cell.lat, cell.lon, radius), index * 3);
  });
  const rangeSquared = (coverage.rMaxKm / EARTH_RADIUS_KM) ** 2;
  const minSinElevation = Math.sin(coverage.minElevationDeg * RAD);
  const planeByRow = new Array(rows.length);
  planes.forEach(plane => plane.indices.forEach(index => { planeByRow[index] = plane; }));
  const orbitCache = rows.map((row, index) => {
    const inclination = row.i_deg * RAD;
    const rates = orbitalRatesRadPerSec(row.a_km, row.e, inclination, useJ2);
    const plane = planeByRow[index];
    const displayRates = orbitalRatesRadPerSec(plane.aKm, 0, plane.inclination, useJ2);
    return {
      radius: row.a_km / EARTH_RADIUS_KM,
      displayRadius: plane.aKm / EARTH_RADIUS_KM,
      inclinationCos: Math.cos(inclination),
      inclinationSin: Math.sin(inclination),
      raan: row.raan_deg * RAD,
      argument: row.arg_lat_deg * RAD,
      raanRate: rates.raan,
      argumentRate: rates.argument,
      plane,
      displayInclinationCos: Math.cos(plane.inclination),
      displayInclinationSin: Math.sin(plane.inclination),
      displayRaanRate: displayRates.raan
    };
  });

  const orbitPositions = new Float32Array(planes.length * TRAJECTORY_SEGMENTS * 6);
  const orbitGeometry = new THREE.BufferGeometry();
  const orbitAttribute = new THREE.BufferAttribute(orbitPositions, 3);
  orbitAttribute.setUsage(THREE.DynamicDrawUsage);
  orbitGeometry.setAttribute("position", orbitAttribute);
  orbitGeometry.setDrawRange(0, 0);
  const orbits = new THREE.LineSegments(orbitGeometry, new THREE.LineBasicMaterial({
    color: 0x777777, transparent: true, opacity: 0, depthTest: true, depthWrite: false
  }));
  orbits.frustumCulled = false;

  const satellitePositions = new Float32Array(rows.length * 3);
  const colors = new Float32Array(rows.length * 3);
  const spriteGeometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(satellitePositions, 3);
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  spriteGeometry.setAttribute("position", positionAttribute);
  spriteGeometry.setAttribute("color", colorAttribute);
  spriteGeometry.setIndex(planes.flatMap(plane => plane.indices));
  spriteGeometry.setDrawRange(0, 0);
  const satellites = new THREE.Points(spriteGeometry, new THREE.PointsMaterial({
    map: spriteTexture, size: 10, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0, depthTest: true, depthWrite: true,
    alphaTest: 0.02
  }));
  satellites.frustumCulled = false;
  satellites.renderOrder = 12;
  group.add(orbits, satellites);

  let activeCount = 0;
  function update(simulationSeconds, sampleCoverage = true) {
    const earthAngle = -EARTH_ROTATION_RATE_RAD_PER_SEC * simulationSeconds;
    const earthCos = Math.cos(earthAngle), earthSin = Math.sin(earthAngle);
    let active = 0;
    orbitCache.forEach((orbit, index) => {
      const argument = orbit.argument + orbit.argumentRate * simulationSeconds;
      const rawRaan = orbit.raan + orbit.raanRate * simulationSeconds;
      const displayRaan = orbit.plane.raan + orbit.displayRaanRate * simulationSeconds;
      const argumentCos = Math.cos(argument), argumentSin = Math.sin(argument);
      const rawCos = Math.cos(rawRaan), rawSin = Math.sin(rawRaan);
      const xOrb = orbit.radius * argumentCos;
      const yOrb = orbit.radius * argumentSin;
      const rawX = xOrb * rawCos - yOrb * rawSin * orbit.inclinationCos;
      const rawY = xOrb * rawSin + yOrb * rawCos * orbit.inclinationCos;
      const rawZ = yOrb * orbit.inclinationSin;
      const earthX = rawX * earthCos - rawY * earthSin;
      const earthZ = -rawX * earthSin - rawY * earthCos;
      if (sampleCoverage) {
        const covered = coversAnyTarget(earthX, rawZ, earthZ,
          targets, rangeSquared, minSinElevation);
        colors[index * 3] = covered ? GOLD[0] : GRAY[0];
        colors[index * 3 + 1] = covered ? GOLD[1] : GRAY[1];
        colors[index * 3 + 2] = covered ? GOLD[2] : GRAY[2];
        if (covered) active += 1;
      }

      // SBI display convention: render each sprite on the nearest point of
      // its representative plane. The raw row above drives active coloring.
      const difference = rawRaan - displayRaan;
      const differenceCos = Math.cos(difference), differenceSin = Math.sin(difference);
      const alongNode = argumentCos * differenceCos -
        argumentSin * orbit.inclinationCos * differenceSin;
      const alongTrack = argumentCos * orbit.displayInclinationCos * differenceSin +
        argumentSin * (orbit.inclinationCos * orbit.displayInclinationCos * differenceCos +
          orbit.inclinationSin * orbit.displayInclinationSin);
      const projectionLength = Math.hypot(alongNode, alongTrack) || 1;
      const displayXOrb = orbit.displayRadius * alongNode / projectionLength;
      const displayYOrb = orbit.displayRadius * alongTrack / projectionLength;
      const planeCos = Math.cos(displayRaan), planeSin = Math.sin(displayRaan);
      const displayX = displayXOrb * planeCos -
        displayYOrb * planeSin * orbit.displayInclinationCos;
      const displayY = displayXOrb * planeSin +
        displayYOrb * planeCos * orbit.displayInclinationCos;
      const offset = index * 3;
      satellitePositions[offset] = displayX * earthCos - displayY * earthSin;
      satellitePositions[offset + 1] = displayYOrb * orbit.displayInclinationSin;
      satellitePositions[offset + 2] = -displayX * earthSin - displayY * earthCos;
    });
    positionAttribute.needsUpdate = true;
    if (sampleCoverage) {
      activeCount = active;
      colorAttribute.needsUpdate = true;
    }
    if (sampleCoverage) {
      let offset = 0;
      planes.forEach(plane => {
      const inclinationCos = Math.cos(plane.inclination);
      const inclinationSin = Math.sin(plane.inclination);
      const raanRate = orbitalRatesRadPerSec(plane.aKm, 0, plane.inclination, useJ2).raan;
      const raan = plane.raan + raanRate * simulationSeconds;
      const raanCos = Math.cos(raan), raanSin = Math.sin(raan);
      const orbitRadius = plane.aKm / EARTH_RADIUS_KM;
      const point = angle => {
        const xOrb = orbitRadius * Math.cos(angle);
        const yOrb = orbitRadius * Math.sin(angle);
        const x = xOrb * raanCos - yOrb * raanSin * inclinationCos;
        const y = xOrb * raanSin + yOrb * raanCos * inclinationCos;
        return [x * earthCos - y * earthSin,
          yOrb * inclinationSin,
          -x * earthSin - y * earthCos];
      };
      for (let segment = 0; segment < TRAJECTORY_SEGMENTS; segment += 1) {
        const start = segment * Math.PI * 2 / TRAJECTORY_SEGMENTS;
        orbitPositions.set(point(start), offset);
        orbitPositions.set(point(start + Math.PI * 2 / TRAJECTORY_SEGMENTS), offset + 3);
        offset += 6;
      }
      });
      orbitAttribute.needsUpdate = true;
    }
  }
  update(0, true);
  return {
    group, orbits, satellites, update,
    satelliteCount: rows.length,
    planeCount: planes.length,
    planeSatelliteEnds,
    orbitVerticesPerPlane: TRAJECTORY_SEGMENTS * 2,
    get activeCount() { return activeCount; },
    totalOrbitVertices: orbitAttribute.count
  };
}
