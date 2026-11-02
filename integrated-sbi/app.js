import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import * as topojson from "topojson-client";
import { geoCentroid, geoEquirectangular, geoMercator, geoPath, geoProjection } from "d3-geo";
import { geoMollweide } from "d3-geo-projection";
import { Delaunay } from "d3-delaunay";
import {
  createSecretLegendActivation,
  createThreatScenarioDetailController,
  loadThreatScenario
} from "./scenario-detail.js?v=eci-refinement-1";

const EARTH_RADIUS_KM = 6378.137;
const MU_EARTH_KM3_S2 = 398600.4418;
const EARTH_ROTATION_RATE_RAD_PER_SEC = 7.2921150e-5;
const SCALE = 1 / EARTH_RADIUS_KM;

const SECONDS_PER_HOUR = 3600;

let scenarioDurationSeconds = 24 * SECONDS_PER_HOUR;
let scenarioTimeStepSeconds = 120;
let scenarioUseJ2 = false;

// Display-only angular bins. At the Principal Runs' inclinations, a 2.5°
// RAAN span corresponds to roughly 1.5–2° of orbital-plane normal separation.
const PLANE_RAAN_BIN_DEG = 2.5;
const PLANE_INC_BIN_DEG = 0.5;
const TRAJECTORY_SEGMENTS = 180;
const TRAJECTORY_UNIT_CIRCLE = Array.from({ length: TRAJECTORY_SEGMENTS }, (_, index) => {
  const angle = index * 2 * Math.PI / TRAJECTORY_SEGMENTS;
  return [Math.cos(angle), Math.sin(angle)];
});

const COUNTRY_LINE_RADIUS = 0.00045;
const FOCUS_LINE_RADIUS = 0.00125;

const COVERAGE_HISTORY_LIMIT = 30;

function coverageWindowSeconds() {
  return (COVERAGE_HISTORY_LIMIT - 1) * scenarioTimeStepSeconds;
}

const GLOBAL_TESSELLATION_POINT_COUNT = 25000;

const COLOR_MIN = "#222222";
const COLOR_AVG = "#eaaa00";
const COLOR_MAX = "#777777";

const COVERAGE_ZERO_COLOR = "#eeeeee";
const COVERAGE_LOW_COLOR = "#fffdf1";
const COVERAGE_MID_LOW_COLOR = "#fff4b8";
const COVERAGE_MID_COLOR = "#ffe066";
const COVERAGE_HIGH_COLOR = "#eaaa00";
const COVERAGE_TOP_COLOR = "#b87900";
const ZERO_REGION_STROKE = "#4a4a4a";

let manifest = [];
let principalLoadSequence = 0;
let principalLoadPromise = Promise.resolve();
let activePrincipalRun = null;
let playbackBeforePrincipalLoad = null;
let configurationPending = false;
let configurationRunName = null;
let satObjects = [];
let satellitePointCloud = null;
let satelliteOrbitCache = [];
let satelliteMarkerTexture = null;
let trajectoryObjects = [];
let planeModels = [];
let planeSatelliteCounts = [];
let planeSatelliteIndices = [];
let planeAnimationOrder = [];
let planeIndexByReference = new Map();

let targetPositions = [];
let targetLatLon = [];
let targetCoverageCounts = [];

let globalCellLatLon = [];
let globalCellPositions = [];
let globalCoverageCounts = [];
let globalCellSpatialIndex = null;

let coverageHistory = [];
let coverageCurrentMetrics = null;
let lastCoverageSampleSeconds = null;
let deferredMapDrawTimer = null;
let killRadiusKm = null;
let interceptAltitudeKm = 200;
let minElevationDeg = 0;
// Point the first frame at the default threat while the run files load.
let focusLatDeg = 40.03;
let focusLonDeg = 125.93;

let worldFeatures = [];
let detailedWorldFeatures = [];
let worldGeoJson = null;

let simulationSeconds = 0;
let earthPresentationTimeSeconds = 0;
let lastFrameTime = performance.now();
let isPlaying = true;
let playbackMultiplier = 1.0;
let currentPlaybackMultiplier = 1.0;
let isHorizonView = false;
let idleActive = false;
let idleSession = null;
let idleTimer = null;
let idleCarouselTimer = null;
let idleGeneration = 0;
let idleScenarioIndex = 0;
let idleHasPresentedScenario = false;
let idleEntryAligned = false;
let presentationTiltDeg = 0;
let restoringPresentation = false;
const SATELLITE_MARKER_SIZE_PX = 12;
const CAROUSEL_SATELLITE_MARKER_SIZE_PX = 16;
function markerSizeForCurrentRun(carousel = false) {
  const count = satObjects.length;
  if (count >= 15000) return carousel ? 10 : 8;
  if (count >= 8000) return carousel ? 13 : 10;
  return carousel ? CAROUSEL_SATELLITE_MARKER_SIZE_PX : SATELLITE_MARKER_SIZE_PX;
}
const CAROUSEL_STAMP_ANGULAR_RADIUS = .0033;
const TRAJECTORY_COLOR = 0x777777;
const CAROUSEL_TRAJECTORY_OPACITY = .14;
const CAROUSEL_PLAYBACK_MULTIPLIER = .32;
const SITE_PULSE_TIMING = Object.freeze({ goldMs: 1150, darkMs: 2600 });
document.documentElement.style.setProperty("--site-pulse-gold-duration", `${SITE_PULSE_TIMING.goldMs}ms`);
document.documentElement.style.setProperty("--site-pulse-dark-duration", `${SITE_PULSE_TIMING.darkMs}ms`);
const GEOGRAPHIC_TRANSITION_DISTANCE = 3.8;
let hasCompletedInitialRun = false;
const GEOGRAPHIC_INTRO_TIMING = Object.freeze({
  globeZoomInMs: 1750,
  globeOutlineMs: 850,
  globeFillMs: 520,
  globeSiteStepMinMs: 75,
  globeSiteStepMaxMs: 500,
  globeSiteHoldMs: 1600,
  globeZoomOutMs: 1350,
  globeOrbitRevealMs: 2400,
  mapOutlineMs: 650,
  mapFillMs: 600,
  mapSitesMinMs: 900,
  mapSitesMaxMs: 2100,
  mapSiteHoldMs: 650,
  mapCoverageMs: 1350
});
const CAROUSEL_TIMING = Object.freeze({
  entryCameraMs: 3400,
  initialRotationMs: 1700,
  rotationMs: 2800,
  outlineTraceMs: 1450,
  countryFillMs: 650,
  siteStaggerMs: 210,
  sitePulseMs: SITE_PULSE_TIMING.goldMs,
  siteRevealMaxMs: 5000,
  siteSettleMs: 720,
  satelliteRevealMs: 2100,
  dwellMs: 16000,
  satelliteDepartureMs: 1500,
  siteDepartureMs: 700,
  fillDepartureMs: 600,
  outlineDepartureMs: 1100,
  manualMovementGraceMs: 4500
});
const SUPPLIED_CAROUSEL_VIEWS = {
  "north-korea": { yawRad: -0.51293686007167, tiltDeg: 1.7710937499999995,
    offsetX: -100, offsetY: 25, zoom: 1.1788079886701086 },
  iran: { yawRad: 0.7356549393553429, tiltDeg: -4.04375,
    offsetX: -100, offsetY: 25, zoom: 1.17 },
  china: { yawRad: -0.002578124999999778, tiltDeg: -0.7125,
    offsetX: -100, offsetY: 25, zoom: 1.047078336246972 },
  russia: { yawRad: 0.08347882610171374, tiltDeg: 24.98984375,
    offsetX: -100, offsetY: 25, zoom: 0.9386778690442104 }
};
const carouselFraming = {
  offsetX: -100,
  offsetY: 25,
  zoom: SUPPLIED_CAROUSEL_VIEWS.russia.zoom
};
const carouselViews = SUPPLIED_CAROUSEL_VIEWS;
let geographicIntroGeneration = 0;
let geographicIntroActive = false;
let geographicIntroSiteCount = 0;
let geographicIntroFade = 1;

let visualizationMode = "3d";
let mapGeographicView = "regional";
let suppressScenarioCameraReframe = false;
let hideNewScenarioVisuals = false;
let threatScenarioTransitionPromise = null;
let mapCells = [];
let mapProjection = null;
let mapPath = null;
let mapMaxCoverage = 1;
let mapColorScaleMax = 1;
let mapNeedsGeometryRebuild = true;

let mapZoom = 1;
let mapPanX = 0;
let mapPanY = 0;
let isMapDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;

let pinchStartDistance = 0;
let pinchStartZoom = 1;
let pinchStartPanX = 0;
let pinchStartPanY = 0;
let pinchCenterX = 0;
let pinchCenterY = 0;

const BASE_PLAYBACK_SIM_HOURS_PER_REAL_SECOND = 0.02;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffffff);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.sortObjects = true;

document.getElementById("canvas-wrap").appendChild(renderer.domElement);

const mapCanvas = document.getElementById("map2dCanvas");
const mapCtx = mapCanvas ? mapCanvas.getContext("2d") : null;
const mapTransitionCanvas = document.getElementById("mapTransitionCanvas");
const mapIntroCanvas = document.getElementById("mapIntroCanvas");
const mapSiteLayer = document.getElementById("mapSiteLayer");
const siteTooltip = document.getElementById("siteTooltip");
const siteTooltipName = document.getElementById("siteTooltipName");
const siteTooltipLearnMore = document.getElementById("siteTooltipLearnMore");
let siteTooltipHideTimer = null;
let activeTooltipSite = null;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const earthGroup = new THREE.Group();
const focusCountryFillGroup = new THREE.Group();
const siteMarkerGroup = new THREE.Group();
siteMarkerGroup.visible = false;
let launchSitesActivated = false;
const globeSiteEntries = [];
const carouselSiteGroup = new THREE.Group();
const carouselSiteEntries = [];
let carouselSiteStaggerMs = CAROUSEL_TIMING.siteStaggerMs;
let carouselPulseStartMs = null;
let carouselSiteOpacity = 1;
let carouselSiteSettledFraction = 0;
let carouselSiteSettledAtMs = 0;
carouselSiteGroup.visible = false;
const sitePickMeshes = [];
const siteRaycaster = new THREE.Raycaster();
const countryLineGroup = new THREE.Group();
const focusCountryLineGroup = new THREE.Group();
const trajectoryGroup = new THREE.Group();
const constellationGroup = new THREE.Group();
const presentationTiltRoot = new THREE.Group();
const presentationRoot = new THREE.Group();
const carouselInertialRoot = new THREE.Group();
scene.add(carouselInertialRoot);
scene.add(presentationTiltRoot);
presentationTiltRoot.add(presentationRoot);
presentationRoot.add(earthGroup);
presentationRoot.add(focusCountryFillGroup);
presentationRoot.add(siteMarkerGroup);
presentationRoot.add(carouselSiteGroup);
presentationRoot.add(countryLineGroup);
presentationRoot.add(focusCountryLineGroup);
presentationRoot.add(trajectoryGroup);
presentationRoot.add(constellationGroup);
let carouselInertialAttached = false;

const statusEl = document.getElementById("status");

const playBtn = document.getElementById("playBtn");
const speedDownBtn = document.getElementById("speedDownBtn");
const speedUpBtn = document.getElementById("speedUpBtn");
const timelineSlider = document.getElementById("timelineSlider");
const timelineTime = document.getElementById("timelineTime");

const zoomInBtn = document.getElementById("zoomInBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const viewToggleBtn = document.getElementById("viewToggleBtn");

const cameraControls = document.getElementById("cameraControls");
const panelToggleBtn = document.getElementById("panelToggleBtn");
panelToggleBtn.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("uiCollapsed");
  panelToggleBtn.setAttribute("aria-expanded", String(!collapsed));
  panelToggleBtn.setAttribute("aria-label", collapsed ? "Show control panel" : "Hide control panel");
  panelToggleBtn.querySelectorAll(".panelToggleFace").forEach(face => {
    face.textContent = collapsed ? "›" : "‹";
  });
  const resumePlayback = isPlaying;
  isPlaying = false;
  updatePlaybackButton();
  if (visualizationMode === "2d") {
    mapNeedsGeometryRebuild = true;
    draw2DMap();
  }
  const transitionStart = performance.now();
  const animateLayoutTransition = now => {
    if (now - transitionStart < 340) {
      if (visualizationMode === "3d") apply3DViewOffset();
      else { mapNeedsGeometryRebuild = true; draw2DMap(); }
      requestAnimationFrame(animateLayoutTransition);
    } else if (visualizationMode === "3d") {
      apply3DViewOffset();
    } else {
      mapNeedsGeometryRebuild = true;
      draw2DMap();
    }
    isPlaying = resumePlayback;
    updatePlaybackButton();
  };
  requestAnimationFrame(animateLayoutTransition);
});
const legend3D = document.getElementById("legend3D");
const legend2D = document.getElementById("legend2D");
const legendSiteRow = document.getElementById("legendSiteRow");
const coverageMaxLabel = document.getElementById("coverageMaxLabel");

const countrySelect = document.getElementById("countrySelect");
const interceptorSelect = document.getElementById("interceptorSelect");
const salvoSelect = document.getElementById("salvoSelect");

const satelliteStat = document.getElementById("satelliteStat");
const planeStat = document.getElementById("planeStat");

const coverageChart = document.getElementById("coverageChart");
const coverageChartCtx = coverageChart ? coverageChart.getContext("2d") : null;

const threatScenarioDetail = createThreatScenarioDetailController({
  panel: document.getElementById("ui"),
  flipper: document.getElementById("panelFlipper"),
  front: document.getElementById("panelFront"),
  back: document.getElementById("panelBack"),
  backButton: document.getElementById("scenarioBackBtn"),
  scenarioNavigator: document.getElementById("scenarioNavigator"),
  mapSvg: document.getElementById("scenarioDetailMap"),
  locationDetail: document.getElementById("scenarioLocationDetail"),
  locationIndicators: document.getElementById("scenarioLocationIndicators"),
  locationPrevious: document.getElementById("scenarioLocationPrevious"),
  locationNext: document.getElementById("scenarioLocationNext"),
  narrative: document.getElementById("scenarioNarrative"),
  narrativeHeading: document.getElementById("scenarioNarrativeHeading"),
  launchHeading: document.getElementById("scenarioMapHeading"),
  loading: document.getElementById("scenarioLoading"),
  empty: document.getElementById("scenarioEmpty"),
  error: document.getElementById("scenarioError"),
  content: document.getElementById("scenarioDetailContent"),
  // The selected tile changes before its Principal Run finishes loading.
  getThreatRegion: () => document.querySelector('.scenarioCard[data-selected="true"]')?.dataset.region || countrySelect.value,
  setThreatRegion: threatRegion => {
    document.dispatchEvent(new CustomEvent("principal-panel:request-region", { detail: { region: threatRegion } }));
    return principalLoadPromise;
  },
  getWorldFeatures: detail => (
    detail === "detailed" && detailedWorldFeatures.length > 0
      ? detailedWorldFeatures
      : worldFeatures
  ),
  onLayoutChange: () => animateScenarioPanelLayout()
});

document.addEventListener("principal-panel:learn-more", () => threatScenarioDetail.open());
document.addEventListener("principal-panel:resize", () => threatScenarioDetail.syncHeight());
document.addEventListener("principal-panel:run-selected", event => {
  const run = event.detail?.run;
  if (!run?.csvPath || !run?.jsonPath) return;
  if (playbackBeforePrincipalLoad === null) playbackBeforePrincipalLoad = isPlaying;
  configurationPending = true;
  configurationRunName = run.name;
  isPlaying = false;
  playBtn.disabled = true;
  if (timelineSlider) timelineSlider.disabled = true;
  document.querySelector(".coverageChartSection")?.setAttribute("aria-busy", "true");
  document.querySelector(".coverageChartSection")?.setAttribute("data-waiting", "true");
  updatePlaybackButton();
  principalLoadPromise = loadPrincipalRun(run).catch(error => {
    console.error(error);
    setStatus(error.message);
    document.dispatchEvent(new CustomEvent("principal-panel:run-load-error", { detail: { name: run.name } }));
  });
});

function finishConfiguration(name) {
  if (!configurationPending || name !== configurationRunName) return;
  configurationPending = false;
  configurationRunName = null;
  playBtn.disabled = false;
  if (timelineSlider) timelineSlider.disabled = false;
  document.querySelector(".coverageChartSection")?.removeAttribute("aria-busy");
  document.querySelector(".coverageChartSection")?.removeAttribute("data-waiting");
  isPlaying = playbackBeforePrincipalLoad ?? true;
  playbackBeforePrincipalLoad = null;
  fillCoverageHistoryToTime(simulationSeconds);
  updateSceneForTime(false, false);
  updatePlaybackButton();
}

document.addEventListener("principal-panel:run-loaded", event => {
  if (!event.detail?.awaitingPopulation) finishConfiguration(event.detail?.run?.name);
});
document.addEventListener("principal-panel:population-complete", event => {
  finishConfiguration(event.detail?.name);
});
document.addEventListener("principal-panel:run-load-error", event => {
  if (event.detail?.name !== configurationRunName) return;
  configurationPending = false;
  configurationRunName = null;
  playBtn.disabled = false;
  if (timelineSlider) timelineSlider.disabled = false;
  document.querySelector(".coverageChartSection")?.removeAttribute("aria-busy");
  document.querySelector(".coverageChartSection")?.removeAttribute("data-waiting");
  playbackBeforePrincipalLoad = null;
  updatePlaybackButton();
});

createSecretLegendActivation({
  yellowDot: document.querySelector(".legendDotActive"),
  grayDot: document.querySelector(".legendDotInactive"),
  onActivate: () => void enterIdleMode(true)
});

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function setStats(nSatellites = null, nPlanes = null) {
  satelliteStat.textContent = nSatellites === null
    ? "—"
    : Number(nSatellites).toLocaleString();

  planeStat.textContent = nPlanes === null
    ? "—"
    : Number(nPlanes).toLocaleString();
}

function formatCoverageValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }

  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 1
  });
}

function updateCoverageLegendMax() {
  if (!coverageMaxLabel) return;
  coverageMaxLabel.textContent = String(Math.max(1, Math.round(mapColorScaleMax)));
}

function formatTimeHHMM(seconds) {
  const loopSeconds = scenarioDurationSeconds;
  const wrapped = Math.abs(seconds - loopSeconds) < .01
    ? loopSeconds : ((seconds % loopSeconds) + loopSeconds) % loopSeconds;
  const totalMinutes = Math.floor(wrapped / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function resetCoverageHistory() {
  coverageHistory = [];
  coverageCurrentMetrics = null;
  lastCoverageSampleSeconds = null;
  document.body.dataset.chartSampleCount = "0";
  drawCoverageChart();
}

function satelliteCoversPoint(satPos, pointPos, killRadiusSceneSq) {
  if (satPos.distanceToSquared(pointPos) > killRadiusSceneSq) {
    return false;
  }

  const lineOfSight = satPos.clone().sub(pointPos);
  const lineOfSightLength = lineOfSight.length();

  if (lineOfSightLength <= 0) {
    return false;
  }

  const localUp = pointPos.clone().normalize();
  const sinElevation = lineOfSight.dot(localUp) / lineOfSightLength;
  const minSinElevation = Math.sin(degToRad(minElevationDeg));

  return sinElevation >= minSinElevation;
}

function buildGlobalCellSpatialIndex() {
  if (!killRadiusKm || !globalCellPositions.length) return null;
  const cellSize = Math.max(0.02, killRadiusKm / EARTH_RADIUS_KM);
  const offset = Math.ceil(2 / cellSize) + 4;
  const width = offset * 2 + 1;
  const plane = width * width;
  const buckets = new Map();
  globalCellPositions.forEach((point, idx) => {
    const key = (Math.floor(point.x / cellSize) + offset) * plane +
      (Math.floor(point.y / cellSize) + offset) * width +
      Math.floor(point.z / cellSize) + offset;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(idx);
  });
  return { buckets, cellSize, offset, width, plane,
    targetRadiusSq: globalCellPositions[0].lengthSq() };
}

function updateSatellitePointColors(activeSatellites) {
  if (!satellitePointCloud) return;
  const attribute = satellitePointCloud.geometry.getAttribute("color");
  const values = attribute.array;
  for (let idx = 0; idx < satObjects.length; idx += 1) {
    const offset = idx * 3;
    const active = activeSatellites.has(idx);
    values[offset] = active ? 1 : 0.68;
    values[offset + 1] = active ? 0.84 : 0.68;
    values[offset + 2] = active ? 0.02 : 0.68;
  }
  attribute.needsUpdate = true;
}

// Color the visible 3D dots against the visible Earth. Coverage and the chart
// continue to use the ungrouped solver orbits and their analytical samples.
function updateDisplayedSatelliteColors() {
  if (!satellitePointCloud || !killRadiusKm || !targetPositions.length) return;
  carouselInertialRoot.updateWorldMatrix(true, false);
  presentationRoot.updateWorldMatrix(true, false);
  const earthFromDisplay = presentationRoot.matrixWorld.clone().invert()
    .multiply(carouselInertialRoot.matrixWorld);
  const positions = satellitePointCloud.geometry.getAttribute("position").array;
  const colors = satellitePointCloud.geometry.getAttribute("color");
  const values = colors.array;
  const killRadiusSq = (killRadiusKm / EARTH_RADIUS_KM) ** 2;
  const minSinElevation = Math.sin(degToRad(minElevationDeg));
  const point = new THREE.Vector3();
  const targets = targetPositions.map(target => [target.x, target.y, target.z, target.lengthSq()]);
  let activeCount = 0;
  for (let index = 0; index < satObjects.length; index += 1) {
    const offset = index * 3;
    point.set(positions[offset], positions[offset + 1], positions[offset + 2])
      .applyMatrix4(earthFromDisplay);
    let active = false;
    for (const [tx, ty, tz, targetLengthSq] of targets) {
      const dx = point.x - tx, dy = point.y - ty, dz = point.z - tz;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      if (distanceSq > killRadiusSq || distanceSq <= 0) continue;
      const sinElevation = (dx * tx + dy * ty + dz * tz) /
        Math.sqrt(distanceSq * targetLengthSq);
      if (sinElevation >= minSinElevation) { active = true; break; }
    }
    if (active) activeCount += 1;
    values[offset] = active ? 1 : .68;
    values[offset + 1] = active ? .84 : .68;
    values[offset + 2] = active ? .02 : .68;
  }
  colors.needsUpdate = true;
  document.body.dataset.displayHighlightedSatellites = String(activeCount);
}

function computeCountsForPositions(positions, timeSeconds = simulationSeconds, positionResolver = analyticalOrbitalPosition) {
  const counts = positions.map(() => 0);

  if (!killRadiusKm || positions.length === 0 || satObjects.length === 0) {
    return counts;
  }

  const killRadiusScene = killRadiusKm / EARTH_RADIUS_KM;
  const killRadiusSceneSq = killRadiusScene * killRadiusScene;

  if (positions === globalCellPositions && globalCellSpatialIndex) {
    const { buckets, cellSize, offset, width, plane, targetRadiusSq } = globalCellSpatialIndex;
    const minSinElevation = Math.sin(degToRad(minElevationDeg));
    const minSinElevationSq = minSinElevation * minSinElevation;
    satObjects.forEach(obj => {
      const satPos = positionResolver(obj.row, timeSeconds);
      const sx = satPos.x, sy = satPos.y, sz = satPos.z;
      const bx = Math.floor(satPos.x / cellSize);
      const by = Math.floor(satPos.y / cellSize);
      const bz = Math.floor(satPos.z / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const key = (bx + dx + offset) * plane +
              (by + dy + offset) * width + bz + dz + offset;
            const candidates = buckets.get(key);
            if (!candidates) continue;
            for (const idx of candidates) {
              const point = positions[idx];
              const rx = sx - point.x, ry = sy - point.y, rz = sz - point.z;
              const distanceSq = rx * rx + ry * ry + rz * rz;
              if (distanceSq > killRadiusSceneSq || distanceSq <= 0) continue;
              const rise = rx * point.x + ry * point.y + rz * point.z;
              if (minSinElevation >= 0) {
                if (rise >= 0 && rise * rise >= minSinElevationSq * distanceSq * targetRadiusSq)
                  counts[idx] += 1;
              } else if (rise >= 0 || rise * rise <= minSinElevationSq * distanceSq * targetRadiusSq) {
                counts[idx] += 1;
              }
            }
          }
        }
      }
    });
  } else {
    satObjects.forEach(obj => {
      const satPos = positionResolver(obj.row, timeSeconds);
      positions.forEach((pointPos, idx) => {
        if (satelliteCoversPoint(satPos, pointPos, killRadiusSceneSq)) counts[idx] += 1;
      });
    });
  }

  return counts;
}

function updateMapColorScaleMax(currentMax) {
  mapMaxCoverage = Math.max(1, currentMax);
  mapColorScaleMax = Math.max(mapColorScaleMax, mapMaxCoverage);
  updateCoverageLegendMax();
}

function computeCoverageMetrics(updateMaterials = false, timeSeconds = simulationSeconds, positionResolver = analyticalOrbitalPosition) {
  if (!killRadiusKm || targetPositions.length === 0 || satObjects.length === 0) {
    targetCoverageCounts = targetPositions.map(() => 0);

    if (updateMaterials) updateSatellitePointColors(new Set());

    return null;
  }

  const countsByTarget = targetPositions.map(() => 0);
  const activeSatellites = new Set();
  const killRadiusScene = killRadiusKm / EARTH_RADIUS_KM;
  const killRadiusSceneSq = killRadiusScene * killRadiusScene;

  satObjects.forEach((obj, satIdx) => {
    const satPos = positionResolver(obj.row, timeSeconds);

    targetPositions.forEach((targetPos, targetIdx) => {
      if (satelliteCoversPoint(satPos, targetPos, killRadiusSceneSq)) {
        countsByTarget[targetIdx] += 1;
        activeSatellites.add(satIdx);
      }
    });
  });

  targetCoverageCounts = countsByTarget;

  if (visualizationMode === "2d" && updateMaterials) {
    globalCoverageCounts = computeCountsForPositions(globalCellPositions, timeSeconds, positionResolver);
    updateMapColorScaleMax(Math.max(1, ...globalCoverageCounts));
  }

  if (updateMaterials) updateSatellitePointColors(activeSatellites);

  const min = Math.min(...countsByTarget);
  const max = Math.max(...countsByTarget);
  const avg = countsByTarget.reduce((sum, value) => sum + value, 0) / countsByTarget.length;

  return {
    min,
    avg,
    max,
    activeSatellites: activeSatellites.size
  };
}

function addCoverageSampleAtTime(timeSeconds, metrics) {
  if (!metrics) return;

  coverageHistory.push({
    timeSeconds,
    min: metrics.min,
    avg: metrics.avg,
    max: metrics.max
  });

  while (coverageHistory.length > COVERAGE_HISTORY_LIMIT) {
    coverageHistory.shift();
  }

  lastCoverageSampleSeconds = timeSeconds;
  document.body.dataset.chartLastSampleSeconds = timeSeconds.toFixed(6);
  document.body.dataset.chartLatestMin = String(metrics.min);
  document.body.dataset.chartSampleCount = String(coverageHistory.length);
}

function sampleCoverageAtTime(timeSeconds) {
  return computeCoverageMetrics(false, timeSeconds);
}

function diagnoseCoverageTimeSamples() {
  if (satObjects.length === 0 || targetPositions.length === 0) return;

  const firstRow = satObjects[0].row;
  const pos0 = analyticalOrbitalPosition(firstRow, 0);
  const posStep = analyticalOrbitalPosition(firstRow, scenarioTimeStepSeconds);
  const metrics0 = computeCoverageMetrics(false, 0);
  const metricsStep = computeCoverageMetrics(false, scenarioTimeStepSeconds);

  console.info("[SBI coverage diagnostic]", {
    stepSeconds: scenarioTimeStepSeconds,
    firstSatelliteDeltaScene: pos0.distanceTo(posStep),
    firstSatelliteEarthFixedPositionAt0: pos0.toArray(),
    firstSatelliteEarthFixedPositionAtStep: posStep.toArray(),
    metricsAt0: metrics0,
    metricsAtStep: metricsStep
  });
}


function addCoverageSample(metrics, force = false) {
  if (!metrics) return;
  const currentStep = Math.floor(simulationSeconds / scenarioTimeStepSeconds + 1e-9);
  const lastStep = lastCoverageSampleSeconds === null
    ? -1 : Math.round(lastCoverageSampleSeconds / scenarioTimeStepSeconds);
  if (force && lastStep === currentStep) {
    coverageHistory.pop();
    lastCoverageSampleSeconds = coverageHistory.at(-1)?.timeSeconds ?? null;
  }
  const nextStep = lastCoverageSampleSeconds === null
    ? 0 : Math.round(lastCoverageSampleSeconds / scenarioTimeStepSeconds) + 1;
  // Fill every missed JSON sample after a slow frame, while keeping at most
  // the chart's 30-sample window if a tab has been asleep for a long time.
  for (let step = Math.max(nextStep, currentStep - COVERAGE_HISTORY_LIMIT + 1);
      step <= currentStep; step += 1) {
    const sampleTime = step * scenarioTimeStepSeconds;
    addCoverageSampleAtTime(sampleTime, sampleCoverageAtTime(sampleTime));
  }

  drawCoverageChart();
}

function fillCoverageHistoryToTime(targetSeconds) {
  if (satObjects.length === 0 || targetPositions.length === 0 || !killRadiusKm) {
    return;
  }

  const loopSeconds = scenarioDurationSeconds;
  const target = Math.max(0, Math.min(loopSeconds, targetSeconds));
  const epsilon = 0.0001;

  const shouldRebuild =
    lastCoverageSampleSeconds === null ||
    target + epsilon < lastCoverageSampleSeconds ||
    target - lastCoverageSampleSeconds > coverageWindowSeconds();

  if (shouldRebuild) {
    coverageHistory = [];
    lastCoverageSampleSeconds = null;

    const lastStep = Math.floor((target + epsilon) / scenarioTimeStepSeconds);
    const firstStep = Math.max(0, lastStep - COVERAGE_HISTORY_LIMIT + 1);
    for (let step = firstStep; step <= lastStep; step += 1) {
      const sampleTime = step * scenarioTimeStepSeconds;
      addCoverageSampleAtTime(sampleTime, sampleCoverageAtTime(sampleTime));
    }

    drawCoverageChart();
    return;
  }

  let nextSampleTime =
    lastCoverageSampleSeconds + scenarioTimeStepSeconds;

  while (nextSampleTime <= target + epsilon) {
    const metrics = sampleCoverageAtTime(nextSampleTime);
    addCoverageSampleAtTime(nextSampleTime, metrics);
    nextSampleTime += scenarioTimeStepSeconds;
  }

  drawCoverageChart();
}

function drawStepLine(ctx, points, strokeStyle, lineWidth) {
  if (!points || points.length === 0) return;

  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";

  ctx.beginPath();

  if (points.length === 1) {
    ctx.moveTo(points[0].x - 1, points[0].y);
    ctx.lineTo(points[0].x + 1, points[0].y);
    ctx.stroke();
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];

    ctx.lineTo(curr.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
  }

  ctx.stroke();
}

let previousCoverageLabelOrder = ["Max", "Avg", "Min"];

function drawRightSideValueLabel(ctx, label, value, y, color, chartRight, cssWidth) {
  const x = chartRight + 5;
  const text = `${label} ${formatCoverageValue(value)}`;

  ctx.font = "bold 10.5px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const measured = ctx.measureText(text);
  const boxWidth = Math.min(cssWidth - x - 2, measured.width + 7);
  const boxHeight = 15;

  ctx.fillStyle = "rgba(255,255,255,.86)";
  ctx.fillRect(x - 3, y - boxHeight / 2, boxWidth, boxHeight);

  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawCoverageChart() {
  if (!coverageChart || !coverageChartCtx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = coverageChart.clientWidth || 280;
  const cssHeight = coverageChart.clientHeight || 142;

  const nextWidth = Math.round(cssWidth * dpr);
  const nextHeight = Math.round(cssHeight * dpr);

  if (coverageChart.width !== nextWidth || coverageChart.height !== nextHeight) {
    coverageChart.width = nextWidth;
    coverageChart.height = nextHeight;
  }

  const ctx = coverageChartCtx;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const chartLeft = 34;
  const chartRight = cssWidth - 62;
  const chartTop = 13;
  const chartBottom = cssHeight - 28;
  const chartWidth = chartRight - chartLeft;
  const chartHeight = chartBottom - chartTop;

  ctx.strokeStyle = "#e7e7e7";
  ctx.lineWidth = 1;

  for (let i = 0; i <= 3; i += 1) {
    const y = chartTop + chartHeight * (i / 3);
    ctx.beginPath();
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#cfcfcf";
  ctx.beginPath();
  ctx.moveTo(chartLeft, chartTop);
  ctx.lineTo(chartLeft, chartBottom);
  ctx.lineTo(chartRight, chartBottom);
  ctx.stroke();

  ctx.save();
  ctx.translate(10, chartTop + chartHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#555555";
  ctx.font = "10.5px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Satellites", 0, -6);
  ctx.fillText("within range", 0, 6);
  ctx.restore();

  if (coverageHistory.length === 0) {
    ctx.fillStyle = "#999999";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("", chartLeft, cssHeight / 2 + 4);
    ctx.restore();
    return;
  }

  const allValues = [];

  coverageHistory.forEach(sample => {
    allValues.push(sample.min, sample.avg, sample.max);
  });

  const maxValue = Math.max(1, ...allValues);

  function makePoints(series) {
    const visibleWindowSeconds = coverageWindowSeconds();
    const visibleEndSeconds = simulationSeconds;

    return series
      .map((value, idx) => {
        const sample = coverageHistory[idx];
        const sampleTime = sample.timeSeconds;

        const ageSeconds = visibleEndSeconds - sampleTime;
        const fracFromRight = visibleWindowSeconds <= 0
          ? 0
          : ageSeconds / visibleWindowSeconds;

        const x = chartRight - (fracFromRight * chartWidth);
        const normalized = Math.min(1, Math.max(0, value / maxValue));
        const y = chartBottom - normalized * chartHeight;

        return { x, y, value };
      })
      .filter(point => point.x >= chartLeft - 2 && point.x <= chartRight + 2);
  }

  const minPoints = makePoints(coverageHistory.map(sample => sample.min));
  const avgPoints = makePoints(coverageHistory.map(sample => sample.avg));
  const maxPoints = makePoints(coverageHistory.map(sample => sample.max));

  drawStepLine(ctx, maxPoints, COLOR_MAX, 1.8);
  drawStepLine(ctx, avgPoints, COLOR_AVG, 2.2);
  drawStepLine(ctx, minPoints, COLOR_MIN, 2.0);

  const latest = coverageHistory[coverageHistory.length - 1];
  const latestMaxPoint = maxPoints[maxPoints.length - 1];
  const latestAvgPoint = avgPoints[avgPoints.length - 1];
  const latestMinPoint = minPoints[minPoints.length - 1];

  ctx.fillStyle = "#555555";
  ctx.font = "10px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText("0", chartLeft - 5, chartBottom);
  ctx.fillText(formatCoverageValue(maxValue), chartLeft - 5, chartTop);

  const tickCount = 4;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#666666";

  const visibleWindowSeconds = coverageWindowSeconds();
  const tickIntervalSeconds = visibleWindowSeconds / tickCount;
  const newestTickTimeSeconds =
    Math.floor(simulationSeconds / tickIntervalSeconds) * tickIntervalSeconds;

  for (let i = 0; i <= tickCount; i += 1) {
    const tickTimeSeconds = newestTickTimeSeconds - ((tickCount - i) * tickIntervalSeconds);

    if (tickTimeSeconds < 0) {
      continue;
    }

    const ageSeconds = simulationSeconds - tickTimeSeconds;
    const fracFromRight = visibleWindowSeconds <= 0
      ? 0
      : ageSeconds / visibleWindowSeconds;

    const x = chartRight - (fracFromRight * chartWidth);

    if (x < chartLeft || x > chartRight) {
      continue;
    }

    const label = formatTimeHHMM(tickTimeSeconds);

    ctx.strokeStyle = "#dddddd";
    ctx.beginPath();
    ctx.moveTo(x, chartBottom);
    ctx.lineTo(x, chartBottom + 3);
    ctx.stroke();

    ctx.fillText(label, x, chartBottom + 6);
  }

  const labels = [
    { name: "Max", value: latest.max, y: latestMaxPoint?.y, color: COLOR_MAX },
    { name: "Avg", value: latest.avg, y: latestAvgPoint?.y, color: COLOR_AVG },
    { name: "Min", value: latest.min, y: latestMinPoint?.y, color: COLOR_MIN }
  ].filter(item => item.y !== undefined);

  labels.sort((a, b) => {
    const aOrder = previousCoverageLabelOrder.indexOf(a.name);
    const bOrder = previousCoverageLabelOrder.indexOf(b.name);
    return a.y - b.y || aOrder - bOrder;
  });

  const minimumGap = 13;
  let groupStart = 0;
  while (groupStart < labels.length) {
    let groupEnd = groupStart;
    while (
      groupEnd + 1 < labels.length &&
      labels[groupEnd + 1].y - labels[groupEnd].y < minimumGap
    ) {
      groupEnd += 1;
    }

    if (groupEnd > groupStart) {
      const anchor = labels
        .slice(groupStart, groupEnd + 1)
        .reduce((sum, item) => sum + item.y, 0) / (groupEnd - groupStart + 1);
      const center = (groupEnd - groupStart) / 2;
      for (let i = groupStart; i <= groupEnd; i += 1) {
        labels[i].y = anchor + (i - groupStart - center) * minimumGap;
      }
    }

    groupStart = groupEnd + 1;
  }

  labels.forEach(item => {
    drawRightSideValueLabel(
      ctx,
      item.name,
      item.value,
      Math.max(8, item.y),
      item.color,
      chartRight,
      cssWidth
    );
  });
  previousCoverageLabelOrder = labels.map(item => item.name);

  ctx.restore();
}

function parseHexColor(hex) {
  const clean = hex.replace("#", "");

  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

function interpolateHexColor(a, b, t) {
  const ca = parseHexColor(a);
  const cb = parseHexColor(b);
  const clamped = Math.max(0, Math.min(1, t));

  const r = Math.round(ca.r + (cb.r - ca.r) * clamped);
  const g = Math.round(ca.g + (cb.g - ca.g) * clamped);
  const bValue = Math.round(ca.b + (cb.b - ca.b) * clamped);

  return `rgb(${r},${g},${bValue})`;
}

function coverageColor(count, maxCount) {
  if (!count || count <= 0) return COVERAGE_ZERO_COLOR;

  const t = Math.max(0, Math.min(1, count / Math.max(1, maxCount)));

  if (t < 0.25) {
    return interpolateHexColor(COVERAGE_LOW_COLOR, COVERAGE_MID_LOW_COLOR, t / 0.25);
  }

  if (t < 0.5) {
    return interpolateHexColor(COVERAGE_MID_LOW_COLOR, COVERAGE_MID_COLOR, (t - 0.25) / 0.25);
  }

  if (t < 0.75) {
    return interpolateHexColor(COVERAGE_MID_COLOR, COVERAGE_HIGH_COLOR, (t - 0.5) / 0.25);
  }

  return interpolateHexColor(COVERAGE_HIGH_COLOR, COVERAGE_TOP_COLOR, (t - 0.75) / 0.25);
}

function generateGlobalFibonacciCells(count = window.innerWidth <= 600
  ? 15000 : GLOBAL_TESSELLATION_POINT_COUNT) {
  const cells = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;

    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;

    const lat = radToDeg(Math.asin(y));
    const lon = normalizeLonDeg(radToDeg(Math.atan2(z, x)));

    cells.push({ lat, lon });
  }

  return cells;
}

function normalizeLonDeg(lon) {
  let normalized = ((lon + 180) % 360 + 360) % 360 - 180;

  if (normalized === -180) normalized = 180;

  return normalized;
}

function resizeMapCanvas() {
  if (!mapCanvas || !mapCtx) return;

  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  const nextWidth = Math.round(width * dpr);
  const nextHeight = Math.round(height * dpr);

  if (mapCanvas.width !== nextWidth || mapCanvas.height !== nextHeight) {
    mapCanvas.width = nextWidth;
    mapCanvas.height = nextHeight;
    mapNeedsGeometryRebuild = true;
  }

  mapCanvas.style.width = `${width}px`;
  mapCanvas.style.height = `${height}px`;
}

function getUiBounds() {
  const ui = document.getElementById("ui");

  if (!ui) {
    return {
      left: 18,
      right: 370,
      top: 18,
      bottom: window.innerHeight - 18
    };
  }

  return ui.getBoundingClientRect();
}

function getAvailableMapExtent() {
  const ui = getUiBounds();
  const margin = 22;

  if (window.innerWidth <= 600) {
    const bottom = document.body.classList.contains("uiCollapsed")
      ? window.innerHeight - 122 : ui.top - 12;
    return {
      left: 14, top: 70, right: window.innerWidth - 14, bottom,
      width: window.innerWidth - 28, height: Math.max(120, bottom - 70)
    };
  }

  return {
    left: ui.right + margin,
    top: margin,
    right: window.innerWidth - margin,
    bottom: window.innerHeight - margin,
    width: Math.max(100, window.innerWidth - ui.right - margin * 2),
    height: Math.max(100, window.innerHeight - margin * 2)
  };
}

function getFullMapExtent() {
  const margin = 18;
  if (!document.body.classList.contains("uiCollapsed") && !idleActive) return getAvailableMapExtent();
  return {
    left: margin,
    top: margin,
    right: window.innerWidth - margin,
    bottom: window.innerHeight - margin
  };
}

let scenarioLayoutAnimationId = 0;

function animateScenarioPanelLayout(durationMs = 900) {
  const animationId = ++scenarioLayoutAnimationId;
  const startedAt = performance.now();

  const updateLayout = now => {
    if (animationId !== scenarioLayoutAnimationId) return;

    if (visualizationMode === "3d") {
      apply3DViewOffset();
    } else {
      mapNeedsGeometryRebuild = true;
      draw2DMap();
    }

    if (now - startedAt < durationMs) requestAnimationFrame(updateLayout);
  };

  requestAnimationFrame(updateLayout);
}

function resetMapView() {
  mapZoom = 1;
  mapPanX = 0;
  mapPanY = 0;
  mapNeedsGeometryRebuild = true;
}

function makeMapProjection() {
  const extent = mapGeographicView === "regional" ? getAvailableMapExtent() : getFullMapExtent();
  let projection;
  if (mapGeographicView === "regional") {
    const regionalBounds = {
      "north-korea": [116, 29, 139, 51],
      iran: [36, 20, 72, 46],
      china: [70, 14, 139, 58],
      russia: [25, 40, 180, 78]
    };
    const [west, south, east, north] = regionalBounds[countrySelect.value] || regionalBounds["north-korea"];
    projection = geoMercator();
    projection.fitExtent(
      [[extent.left, extent.top], [extent.right, extent.bottom]],
      { type: "MultiPoint", coordinates: [[west, south], [east, south], [east, north], [west, north]] }
    );
  } else {
    projection = geoMollweide();
    projection.fitExtent(
      [[extent.left, extent.top], [extent.right, extent.bottom]],
      { type: "Sphere" }
    );
  }

  const translate = projection.translate();
  const scale = projection.scale();

  projection
    .scale(scale * mapZoom)
    .translate([
      translate[0] + mapPanX,
      translate[1] + mapPanY
    ]);

  return projection;
}

function projectMapPoint(target) {
  const projected = mapProjection([target.lon, target.lat]);

  if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
    return null;
  }

  return projected;
}

function rebuildMapGeometry() {
  if (!mapCanvas || !mapCtx || globalCellLatLon.length === 0) {
    mapCells = [];
    return;
  }

  resizeMapCanvas();

  const width = window.innerWidth;
  const height = window.innerHeight;

  mapProjection = makeMapProjection();
  mapPath = geoPath(mapProjection, mapCtx);

  const projectedPoints = globalCellLatLon
    .map((target, idx) => {
      const projected = projectMapPoint(target);

      if (!projected) return null;

      return {
        idx,
        x: projected[0],
        y: projected[1]
      };
    })
    .filter(point => point && (mapGeographicView !== "regional" ||
      (point.x >= -260 && point.x <= width + 260 && point.y >= -260 && point.y <= height + 260)));

  if (projectedPoints.length < 3) {
    mapCells = [];
    return;
  }

  const visibleBuffer = 260 * mapZoom;

  const delaunay = Delaunay.from(
    projectedPoints,
    point => point.x,
    point => point.y
  );

  const voronoi = delaunay.voronoi([
    -visibleBuffer,
    -visibleBuffer,
    width + visibleBuffer,
    height + visibleBuffer
  ]);

  mapCells = projectedPoints.map((point, localIdx) => {
    const polygon = voronoi.cellPolygon(localIdx);
    const path = new Path2D();
    const vertices = [];

    if (polygon && polygon.length > 0) {
      polygon.forEach(([x, y], vertexIdx) => {
        vertices.push([x, y]);

        if (vertexIdx === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      });

      path.closePath();
    }

    return {
      targetIdx: point.idx,
      path,
      vertices
    };
  });

  mapNeedsGeometryRebuild = false;
}

function drawMapBoundaries() {
  if (!mapCtx || !mapPath || !worldGeoJson) return;

  mapCtx.save();

  const selectedCountry = countrySelect.value;
  const focusFeatures = worldFeatures.filter(feature =>
    countryMatches(feature.properties?.name || "", selectedCountry)
  );

  mapCtx.strokeStyle = "rgba(85,85,85,.82)";
  mapCtx.lineWidth = .7;

  mapCtx.beginPath();
  mapPath(worldGeoJson);
  mapCtx.stroke();

  if (focusFeatures.length > 0) {
    mapCtx.strokeStyle = "#404040";
    mapCtx.lineWidth = 1.4;

    focusFeatures.forEach(feature => {
      mapCtx.beginPath();
      mapPath(feature);
      mapCtx.stroke();
    });
  }

  mapCtx.restore();
}

function drawThreatSiteMarkers() {
  if (!mapSiteLayer || !mapProjection) return;
  if (mapSiteLayer.children.length !== targetLatLon.length ||
      [...mapSiteLayer.children].some((marker, index) => marker.dataset.siteName !== targetLatLon[index]?.name)) {
    const markers = targetLatLon.map(target => {
      const marker = document.createElement("button");
      marker.type = "button";
      marker.className = "siteMarker2d";
      marker.dataset.siteName = target.name;
      marker.dataset.region = countrySelect.value;
      marker.setAttribute("aria-label", target.name);
      marker.addEventListener("pointerenter", () => showMarkerLabel(target.name, marker));
      marker.addEventListener("pointerleave", scheduleSiteTooltipHide);
      marker.addEventListener("click", () => showMarkerLabel(target.name, marker));
      marker.addEventListener("focus", () => {
        showMarkerLabel(target.name, marker);
      });
      marker.addEventListener("blur", scheduleSiteTooltipHide);
      return marker;
    });
    mapSiteLayer.replaceChildren(...markers);
  }
  targetLatLon.forEach((target, index) => {
    const marker = mapSiteLayer.children[index];
    marker.dataset.region = countrySelect.value;
    const point = mapProjection([target.lon, target.lat]);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      marker.hidden = true;
      return;
    }
    const [x, y] = point;
    marker.hidden = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight;
    marker.style.left = `${x}px`;
    marker.style.top = `${y}px`;
  });
}

function showSiteTooltip(name, x, y) {
  if (!siteTooltip || !name) return;
  window.clearTimeout(siteTooltipHideTimer);
  siteTooltipHideTimer = null;
  activeTooltipSite = targetLatLon.find(target => target.name === name) || { name };
  siteTooltipName.textContent = name;
  siteTooltipLearnMore.setAttribute("aria-label", `Learn more about ${name}`);
  siteTooltip.hidden = false;
  const placeRight = x + siteTooltip.offsetWidth + 14 <= window.innerWidth;
  siteTooltip.style.left = `${Math.max(8, Math.min(window.innerWidth - siteTooltip.offsetWidth - 8,
    placeRight ? x + 12 : x - siteTooltip.offsetWidth - 12))}px`;
  siteTooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - siteTooltip.offsetHeight - 8,
    y - siteTooltip.offsetHeight / 2))}px`;
}

function showMarkerLabel(name, marker) {
  const rect = marker.getBoundingClientRect();
  showSiteTooltip(name, rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function hideSiteTooltip() {
  window.clearTimeout(siteTooltipHideTimer);
  siteTooltipHideTimer = null;
  if (siteTooltip) siteTooltip.hidden = true;
}

function scheduleSiteTooltipHide() {
  if (siteTooltipHideTimer !== null) return;
  siteTooltipHideTimer = window.setTimeout(() => {
    siteTooltipHideTimer = null;
    if (!siteTooltip.matches(":hover") && !siteTooltip.contains(document.activeElement))
      hideSiteTooltip();
  }, 260);
}

siteTooltip?.addEventListener("pointerenter", () => {
  window.clearTimeout(siteTooltipHideTimer);
  siteTooltipHideTimer = null;
});
siteTooltip?.addEventListener("pointerleave", scheduleSiteTooltipHide);
siteTooltip?.addEventListener("focusout", scheduleSiteTooltipHide);
siteTooltipLearnMore?.addEventListener("click", () => {
  if (!activeTooltipSite) return;
  const site = { ...activeTooltipSite };
  hideSiteTooltip();
  void threatScenarioDetail.openAtLaunchSite(site);
});

let regionalIntroGeneration = 0;
let regionalIntroActive = false;
let regionalIntroFocusPaths = [];

function stopRegionalMapIntro() {
  if (!regionalIntroActive) return;
  regionalIntroGeneration += 1;
  regionalIntroActive = false;
  regionalIntroFocusPaths = [];
  document.body.classList.remove("mapIntro", "mapIntroSettling");
  delete document.body.dataset.mapIntroStage;
  mapCanvas.style.opacity = "1";
  mapIntroCanvas.style.display = "none";
  mapIntroCanvas.style.opacity = "1";
  mapSiteLayer.style.opacity = "1";
  mapSiteLayer.style.removeProperty("--map-site-tone-color");
  mapSiteLayer.style.removeProperty("--map-site-pulse-duration");
  [...mapSiteLayer.children].forEach(marker => {
    marker.style.opacity = "";
    marker.style.pointerEvents = "";
    marker.dataset.darkBlip = "true";
    window.setTimeout(() => { delete marker.dataset.darkBlip; }, SITE_PULSE_TIMING.darkMs);
  });
}

function drawRegionalIntroOutline(outlineProgress, fillProgress = 0) {
  if (!mapIntroCanvas || !mapProjection) return;
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth, height = window.innerHeight;
  if (mapIntroCanvas.width !== Math.round(width * dpr) || mapIntroCanvas.height !== Math.round(height * dpr)) {
    mapIntroCanvas.width = Math.round(width * dpr);
    mapIntroCanvas.height = Math.round(height * dpr);
  }
  const ctx = mapIntroCanvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (!worldGeoJson) return;
  const path = geoPath(mapProjection, ctx);
  if (mapGeographicView === "global") {
    ctx.beginPath(); path({ type: "Sphere" });
    ctx.strokeStyle = "#d0d0d0";
    ctx.lineWidth = .8;
    ctx.stroke();
  }
  const focusFeatures = worldFeatures.filter(feature =>
    countryMatches(feature.properties?.name || "", countrySelect.value));
  ctx.save();
  ctx.globalAlpha = fillProgress;
  ctx.fillStyle = "#e3e3e3";
  focusFeatures.forEach(feature => { ctx.beginPath(); path(feature); ctx.fill("evenodd"); });
  ctx.restore();
  ctx.strokeStyle = "#777777";
  ctx.lineWidth = .7;
  ctx.beginPath(); path(worldGeoJson); ctx.stroke();
  ctx.save();
  ctx.strokeStyle = "#292929";
  ctx.lineWidth = 1.8;
  regionalIntroFocusPaths.forEach(({ path: outline, length }) => {
    ctx.setLineDash([length, length]);
    ctx.lineDashOffset = length * (1 - outlineProgress);
    ctx.stroke(outline);
  });
  ctx.restore();
}

async function runScenarioMapIntro() {
  if (visualizationMode !== "2d" || !targetLatLon.length) return;
  stopRegionalMapIntro();
  const generation = ++regionalIntroGeneration;
  regionalIntroActive = true;
  document.body.classList.add("mapIntro");
  document.body.classList.remove("mapIntroSettling");
  [...mapSiteLayer.children].forEach(marker => { delete marker.dataset.darkBlip; });
  mapCanvas.style.opacity = "0";
  mapIntroCanvas.style.opacity = "1";
  mapIntroCanvas.style.display = "block";
  mapSiteLayer.style.opacity = "1";
  mapSiteLayer.style.removeProperty("--map-site-tone-color");
  mapSiteLayer.style.removeProperty("--map-site-pulse-duration");
  drawThreatSiteMarkers();
  const outlinePath = geoPath(mapProjection);
  regionalIntroFocusPaths = worldFeatures
    .filter(feature => countryMatches(feature.properties?.name || "", countrySelect.value))
    .map(feature => {
      const pathData = outlinePath(feature);
      if (!pathData) return null;
      const measure = document.createElementNS("http://www.w3.org/2000/svg", "path");
      measure.setAttribute("d", pathData);
      return { path: new Path2D(pathData), length: Math.max(1, measure.getTotalLength()) };
    }).filter(Boolean);
  const markers = [...mapSiteLayer.children];
  markers.forEach(marker => { marker.style.opacity = "0"; marker.style.pointerEvents = "none"; });
  drawRegionalIntroOutline(0);
  const active = () => generation === regionalIntroGeneration && visualizationMode === "2d";
  document.body.dataset.mapIntroStage = "outline";
  await animateValue(GEOGRAPHIC_INTRO_TIMING.mapOutlineMs, progress => {
    if (active()) drawRegionalIntroOutline(progress);
  });
  if (!active()) return;
  document.body.dataset.mapIntroStage = "fill";
  await animateValue(GEOGRAPHIC_INTRO_TIMING.mapFillMs, progress => {
    if (active()) drawRegionalIntroOutline(1, progress);
  });
  if (!active()) return;
  if (mapGeographicView === "regional") {
    document.body.dataset.mapIntroStage = "sites";
    await animateValue(Math.min(GEOGRAPHIC_INTRO_TIMING.mapSitesMaxMs,
      Math.max(GEOGRAPHIC_INTRO_TIMING.mapSitesMinMs, markers.length * 110)), progress => {
      if (!active()) return;
      const shown = Math.ceil(progress * markers.length);
      markers.forEach((marker, index) => {
        marker.style.opacity = index < shown ? "1" : "0";
        marker.style.pointerEvents = index < shown ? "auto" : "none";
      });
    });
    if (!active()) return;
    document.body.dataset.mapIntroStage = "pulse";
    await animateValue(GEOGRAPHIC_INTRO_TIMING.mapSiteHoldMs, () => {});
    if (!active()) return;
  }
  document.body.dataset.mapIntroStage = "coverage";
  mapSiteLayer.style.setProperty("--map-site-tone-color", "rgb(189 139 8)");
  mapSiteLayer.style.setProperty("--map-site-pulse-duration", `${SITE_PULSE_TIMING.goldMs}ms`);
  document.body.classList.add("mapIntroSettling");
  await animateValue(GEOGRAPHIC_INTRO_TIMING.mapCoverageMs, progress => {
    if (!active()) return;
    mapCanvas.style.opacity = String(progress);
    mapIntroCanvas.style.opacity = String(1 - progress);
    const channel = (gold, gray) => Math.round(gold + (gray - gold) * progress);
    mapSiteLayer.style.setProperty("--map-site-tone-color",
      `rgb(${channel(189, 74)} ${channel(139, 74)} ${channel(8, 74)})`);
    mapSiteLayer.style.setProperty("--map-site-pulse-duration",
      `${SITE_PULSE_TIMING.goldMs + (SITE_PULSE_TIMING.darkMs - SITE_PULSE_TIMING.goldMs) * progress}ms`);
  });
  if (active()) stopRegionalMapIntro();
}

function drawBare2DMap() {
  if (visualizationMode !== "2d" || !mapProjection || !worldGeoJson) return;
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth, height = window.innerHeight;
  mapCtx.save();
  mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mapCtx.fillStyle = "#ffffff";
  mapCtx.fillRect(0, 0, width, height);
  const path = geoPath(mapProjection, mapCtx);
  if (mapGeographicView === "global") {
    mapCtx.beginPath(); path({ type: "Sphere" });
    mapCtx.strokeStyle = "#d0d0d0";
    mapCtx.lineWidth = .8;
    mapCtx.stroke();
  }
  mapCtx.beginPath(); path(worldGeoJson);
  mapCtx.strokeStyle = "#555555";
  mapCtx.lineWidth = .8;
  mapCtx.stroke();
  mapCtx.restore();
}

async function depart2DScenario(requestId) {
  stopRegionalMapIntro();
  const snapshot = captureMapTransition(false);
  if (!snapshot) return;
  drawBare2DMap();
  mapCanvas.style.opacity = "1";
  mapSiteLayer.style.transition = "none";
  mapSiteLayer.style.opacity = "1";
  document.body.dataset.mapTransitionStage = "departure";
  await animateValue(620, progress => {
    if (requestId !== principalLoadSequence || visualizationMode !== "2d") return;
    mapTransitionCanvas.style.opacity = String(1 - progress);
    mapSiteLayer.style.opacity = String(1 - progress);
  });
  if (requestId !== principalLoadSequence) return;
  mapTransitionCanvas.style.display = "none";
  mapSiteLayer.style.opacity = "0";
  delete document.body.dataset.mapTransitionStage;
}

function rebuildGlobeSiteMarkers() {
  clearGroup(siteMarkerGroup);
  globeSiteEntries.length = 0;
  sitePickMeshes.length = 0;
  hideSiteTooltip();
  targetLatLon.forEach((target, index) => {
    const normal = latLonToVector3(target.lat, target.lon).normalize();
    const tangentA = new THREE.Vector3(0, Math.abs(normal.y) > .95 ? 0 : 1, 0);
    if (tangentA.lengthSq() === 0) tangentA.set(1, 0, 0);
    tangentA.cross(normal).normalize();
    const tangentB = normal.clone().cross(tangentA).normalize();
    const core = new THREE.Mesh(
      makeSurfaceStampGeometry(normal, tangentA, tangentB, .0038),
      new THREE.MeshBasicMaterial({ color: 0xb88b13, side: THREE.DoubleSide,
        transparent: true, opacity: .95, depthTest: true, depthWrite: true })
    );
    core.position.copy(normal).multiplyScalar(1.002);
    core.userData.siteName = target.name;
    core.userData.siteIndex = index;
    siteMarkerGroup.add(core);
    sitePickMeshes.push(core);
    const pulse = makeSurfacePulseRing(0xb88b13);
    pulse.frustumCulled = false;
    siteMarkerGroup.add(pulse);
    globeSiteEntries.push({ normal, tangentA, tangentB, dot: core, ring: pulse,
      revealedAtMs: performance.now() - index * 180, darkPulseStartedAtMs: null });
  });
  updateGlobeSiteDetail();
}

async function refreshLaunchSiteNamesFromSheet(region, requestId) {
  try {
    const scenario = await loadThreatScenario(region);
    if (requestId !== principalLoadSequence || activePrincipalRun?.region !== region) return;
    for (const target of targetLatLon) {
      const location = scenario.locations.find(site =>
        Math.abs(Number(site.latitude) - target.lat) < .025 &&
        Math.abs(Number(site.longitude) - target.lon) < .025);
      if (location?.title) target.name = location.title.trim();
    }
    globeSiteEntries.forEach((entry, index) => {
      entry.dot.userData.siteName = targetLatLon[index]?.name;
    });
    carouselSiteEntries.forEach((entry, index) => {
      entry.dot.userData.siteName = targetLatLon[index]?.name;
    });
    hideSiteTooltip();
    document.body.dataset.launchSiteNames = targetLatLon.map(target => target.name).join("|");
    if (visualizationMode === "2d") drawThreatSiteMarkers();
  } catch (error) {
    console.warn("Live launch-site names could not be loaded; using result names.", error);
  }
}

function updateGlobeSiteDetail() {
  document.body.dataset.geographicIntroSites = String(geographicIntroActive ? geographicIntroSiteCount : 0);
  globeSiteEntries.forEach((entry, index) => {
    const visible = launchSitesActivated && (!geographicIntroActive || index < geographicIntroSiteCount);
    if (visible && entry.revealedAtMs === null) {
      entry.revealedAtMs = performance.now();
      entry.darkPulseStartedAtMs = null;
    }
    entry.dot.visible = visible;
    entry.ring.visible = visible;
  });
}

function rebuildCarouselSiteMarkers() {
  clearGroup(carouselSiteGroup);
  carouselSiteEntries.length = 0;
  carouselPulseStartMs = null;
  carouselSiteSettledFraction = 0;
  carouselSiteStaggerMs = targetLatLon.length > 1
    ? Math.min(CAROUSEL_TIMING.siteStaggerMs,
      (CAROUSEL_TIMING.siteRevealMaxMs - CAROUSEL_TIMING.sitePulseMs) / (targetLatLon.length - 1))
    : CAROUSEL_TIMING.siteStaggerMs;
  targetLatLon.forEach(target => {
    const normal = latLonToVector3(target.lat, target.lon).normalize();
    const tangentA = new THREE.Vector3(0, Math.abs(normal.y) > .95 ? 0 : 1, 0);
    if (tangentA.lengthSq() === 0) tangentA.set(1, 0, 0);
    tangentA.cross(normal).normalize();
    const tangentB = normal.clone().cross(tangentA).normalize();
    const dot = new THREE.Mesh(
      makeSurfaceStampGeometry(normal, tangentA, tangentB, CAROUSEL_STAMP_ANGULAR_RADIUS),
      new THREE.MeshBasicMaterial({ color: 0xb88b13, side: THREE.DoubleSide,
        transparent: true, opacity: .9, depthTest: true, depthWrite: true })
    );
    dot.position.copy(normal).multiplyScalar(1.002);
    dot.userData.siteName = target.name;
    carouselSiteGroup.add(dot);
    const ring = makeSurfacePulseRing(0xb88b13);
    ring.frustumCulled = false;
    ring.visible = false;
    carouselSiteGroup.add(ring);
    carouselSiteEntries.push({ normal, tangentA, tangentB, dot, ring });
  });
  updateCarouselSiteEffects(performance.now());
}

// A geodesic cap centered on the launch coordinate. Its vertices sit on a
// sphere, so perspective foreshortens it and the globe depth buffer occludes it.
function makeSurfaceStampGeometry(normal, tangentA, tangentB, angularRadius) {
  const radialSegments = 6, angularSegments = 96, radius = 1.002;
  const positions = [], indices = [];
  for (let ring = 0; ring <= radialSegments; ring += 1) {
    const theta = angularRadius * ring / radialSegments;
    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const azimuth = segment * Math.PI * 2 / angularSegments;
      const radial = tangentA.clone().multiplyScalar(Math.cos(azimuth))
        .addScaledVector(tangentB, Math.sin(azimuth));
      const point = normal.clone().multiplyScalar(Math.cos(theta))
        .addScaledVector(radial, Math.sin(theta)).multiplyScalar(radius)
        .addScaledVector(normal, -radius);
      positions.push(point.x, point.y, point.z);
      if (ring < radialSegments && segment < angularSegments) {
        const a = ring * (angularSegments + 1) + segment;
        const b = a + angularSegments + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function surfaceAngularRadiusForPixels(entry, pixelRadius) {
  entry.dot.updateWorldMatrix(true, false);
  const center = new THREE.Vector3().setFromMatrixPosition(entry.dot.matrixWorld);
  const distance = Math.max(.05, camera.position.distanceTo(center));
  const worldPerPixel = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) /
    (Math.max(1, window.innerHeight) * camera.zoom);
  return Math.min(.065, Math.max(.0015, pixelRadius * worldPerPixel / 1.002));
}

function resizeSurfaceStamp(entry, angularRadius) {
  if (Math.abs((entry.stampRadius ?? 0) - angularRadius) < .00012) return;
  entry.stampRadius = angularRadius;
  const geometry = entry.dot.geometry;
  const positions = geometry.attributes.position.array;
  const segments = 96;
  for (let ring = 0; ring <= 6; ring += 1) {
    const theta = angularRadius * ring / 6;
    const center = Math.cos(theta), spread = Math.sin(theta);
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = segment * Math.PI * 2 / segments;
      const x = Math.cos(angle) * spread, y = Math.sin(angle) * spread;
      const offset = (ring * (segments + 1) + segment) * 3;
      positions[offset] = 1.002 * (entry.normal.x * (center - 1) + entry.tangentA.x * x + entry.tangentB.x * y);
      positions[offset + 1] = 1.002 * (entry.normal.y * (center - 1) + entry.tangentA.y * x + entry.tangentB.y * y);
      positions[offset + 2] = 1.002 * (entry.normal.z * (center - 1) + entry.tangentA.z * x + entry.tangentB.z * y);
    }
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

function makeSurfacePulseRing(color) {
  const segments = 96;
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(segments * 2 * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  const indices = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    indices.push(index * 2, next * 2, index * 2 + 1,
      index * 2 + 1, next * 2, next * 2 + 1);
  }
  geometry.setIndex(indices);
  const ring = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color, side: THREE.DoubleSide, transparent: true, opacity: 0,
    depthTest: true, depthWrite: false
  }));
  ring.frustumCulled = false;
  ring.renderOrder = 11;
  return ring;
}

function writeSurfacePulseRing(entry, angularRadius) {
  const positions = entry.ring.geometry.attributes.position.array;
  const segments = positions.length / 6;
  const halfWidth = surfaceAngularRadiusForPixels(entry, entry.pulseHalfWidthPx ?? .7);
  for (let index = 0; index < segments; index += 1) {
    const angle = index * Math.PI * 2 / segments;
    for (let edge = 0; edge < 2; edge += 1) {
      const radius = Math.max(.001, angularRadius + (edge ? halfWidth : -halfWidth));
      const center = Math.cos(radius), spread = Math.sin(radius);
      const x = Math.cos(angle) * spread, y = Math.sin(angle) * spread;
      const offset = (index * 2 + edge) * 3;
      positions[offset] = 1.003 * (entry.normal.x * center + entry.tangentA.x * x + entry.tangentB.x * y);
      positions[offset + 1] = 1.003 * (entry.normal.y * center + entry.tangentA.y * x + entry.tangentB.y * y);
      positions[offset + 2] = 1.003 * (entry.normal.z * center + entry.tangentA.z * x + entry.tangentB.z * y);
    }
  }
  entry.ring.geometry.attributes.position.needsUpdate = true;
}

const globeSiteGold = new THREE.Color(0xb88b13);
const globeSiteDark = new THREE.Color(0x4a4a4a);
function updateGlobeSiteEffects(now) {
  if (!siteMarkerGroup.visible) return;
  const goldFraction = geographicIntroActive ? geographicIntroFade : 0;
  const reducedMotion = prefersReducedMotion();
  globeSiteEntries.forEach(entry => {
    if (!entry.dot.visible) return;
    const pulseStartedAt = goldFraction > 0
      ? entry.revealedAtMs : (entry.darkPulseStartedAtMs ?? entry.revealedAtMs);
    const elapsed = Math.max(0, now - (pulseStartedAt ?? now));
    const pulseDuration = SITE_PULSE_TIMING.darkMs +
      (SITE_PULSE_TIMING.goldMs - SITE_PULSE_TIMING.darkMs) * goldFraction;
    const cycle = reducedMotion ? 1 : Math.min(1, elapsed / pulseDuration);
    const eased = 1 - (1 - cycle) ** 2;
    entry.dot.material.color.copy(globeSiteDark).lerp(globeSiteGold, goldFraction);
    const dotRadiusPx = (countrySelect.value === "north-korea" ? 2.8 : 3.5) + 2.2 * goldFraction;
    resizeSurfaceStamp(entry, surfaceAngularRadiusForPixels(entry,
      dotRadiusPx));
    entry.dot.scale.setScalar(1);
    entry.ring.material.color.copy(globeSiteDark).lerp(globeSiteGold, goldFraction);
    entry.pulseHalfWidthPx = dotRadiusPx * (.19 + .03 * goldFraction);
    writeSurfacePulseRing(entry, surfaceAngularRadiusForPixels(entry,
      dotRadiusPx * (1.5 + (2.9 + 1.1 * goldFraction) * eased)));
    entry.ring.material.opacity = (.48 + .25 * goldFraction) * (1 - cycle) ** 2;
    entry.ring.visible = cycle < 1;
  });
}

function startCarouselSitePulse() {
  carouselPulseStartMs = performance.now();
  updateCarouselSiteEffects(carouselPulseStartMs);
}

function updateCarouselSiteEffects(now) {
  const presenting = idleActive && visualizationMode === "3d";
  carouselSiteGroup.visible = presenting && carouselPulseStartMs !== null && carouselSiteOpacity > 0;
  if (!carouselSiteGroup.visible) return;
  const elapsed = now - carouselPulseStartMs;
  const settled = carouselSiteSettledFraction >= .5;
  document.body.dataset.carouselSiteTone = settled ? "dark-gray" : "gold";
  carouselSiteEntries.forEach((entry, index) => {
    const local = elapsed - index * carouselSiteStaggerMs;
    entry.dot.visible = local >= 0;
    const arrival = .25 + .75 * Math.max(0, Math.min(1, local / 160));
    resizeSurfaceStamp(entry, surfaceAngularRadiusForPixels(entry,
      (settled ? 4.1 : 5.7) * arrival));
    entry.dot.scale.setScalar(1);
    entry.dot.material.color.setHex(settled ? 0x4a4a4a : 0xb88b13);
    entry.dot.material.opacity = .9 * carouselSiteOpacity;
    entry.ring.material.color.setHex(settled ? 0x4a4a4a : 0xb88b13);
    entry.pulseHalfWidthPx = settled ? .78 : 1.2;
    if (local < 0) {
      entry.ring.visible = false;
      return;
    }
    if (settled) {
      const cycle = Math.min(1, Math.max(0,
        (now - carouselSiteSettledAtMs - index * 90) / SITE_PULSE_TIMING.darkMs));
      writeSurfacePulseRing(entry, surfaceAngularRadiusForPixels(entry, 6.2 + 12 * cycle));
      entry.ring.material.opacity = .5 * (1 - cycle) ** 2 * carouselSiteOpacity;
      entry.ring.visible = cycle < 1;
    } else {
      const progress = Math.min(1, local / SITE_PULSE_TIMING.goldMs);
      const eased = 1 - (1 - progress) ** 3;
      writeSurfacePulseRing(entry, surfaceAngularRadiusForPixels(entry, 8 + 23 * eased));
      entry.ring.material.opacity = .74 * (1 - progress ** 4) * carouselSiteOpacity;
      entry.ring.visible = progress < 1;
    }
  });
}

function updateLaunchSiteLegend() {
  if (!legendSiteRow) return;
  const visible = idleActive
    ? carouselSiteGroup.visible
    : siteMarkerGroup.visible && globeSiteEntries.some(entry => entry.dot.visible);
  legendSiteRow.hidden = !visible;
  if (!visible) {
    document.body.dataset.launchSiteTone = "hidden";
    return;
  }
  const tone = idleActive
    ? (carouselSiteSettledFraction >= .5 ? "dark-gray" : "gold")
    : (geographicIntroActive && geographicIntroFade > .5 ? "gold" : "dark-gray");
  legendSiteRow.dataset.tone = tone;
  const duration = idleActive
    ? (tone === "gold" ? SITE_PULSE_TIMING.goldMs : SITE_PULSE_TIMING.darkMs)
    : SITE_PULSE_TIMING.darkMs +
      (SITE_PULSE_TIMING.goldMs - SITE_PULSE_TIMING.darkMs) *
      (geographicIntroActive ? geographicIntroFade : 0);
  legendSiteRow.style.setProperty("--site-pulse-duration", `${duration}ms`);
  document.body.dataset.launchSiteTone = tone;
}

function edgeKey(a, b) {
  const ar = `${Math.round(a[0] * 10) / 10},${Math.round(a[1] * 10) / 10}`;
  const br = `${Math.round(b[0] * 10) / 10},${Math.round(b[1] * 10) / 10}`;

  return ar < br ? `${ar}|${br}` : `${br}|${ar}`;
}

function drawZeroCoverageOutlines() {
  if (!mapCtx || mapCells.length === 0) return;

  const edgeMap = new Map();

  mapCells.forEach(cell => {
    const count = globalCoverageCounts[cell.targetIdx] || 0;
    if (count > 0 || !cell.vertices || cell.vertices.length < 3) return;

    for (let i = 0; i < cell.vertices.length; i += 1) {
      const a = cell.vertices[i];
      const b = cell.vertices[(i + 1) % cell.vertices.length];
      const length = Math.hypot(a[0] - b[0], a[1] - b[1]);

      if (length < 1.5) continue;

      const key = edgeKey(a, b);

      if (edgeMap.has(key)) {
        edgeMap.delete(key);
      } else {
        edgeMap.set(key, [a, b]);
      }
    }
  });

  mapCtx.save();
  mapCtx.strokeStyle = ZERO_REGION_STROKE;
  mapCtx.lineWidth = 1.05;
  mapCtx.lineCap = "butt";
  mapCtx.lineJoin = "round";

  edgeMap.forEach(([a, b]) => {
    mapCtx.beginPath();
    mapCtx.moveTo(a[0], a[1]);
    mapCtx.lineTo(b[0], b[1]);
    mapCtx.stroke();
  });

  mapCtx.restore();
}

function scheduleDeferredMapDraw(delayMs = 80) {
  if (deferredMapDrawTimer !== null) {
    clearTimeout(deferredMapDrawTimer);
  }

  deferredMapDrawTimer = setTimeout(() => {
    deferredMapDrawTimer = null;
    draw2DMap();
  }, delayMs);
}

function draw2DMap() {
  if (visualizationMode !== "2d" || !mapCanvas || !mapCtx) return;

  resizeMapCanvas();

  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (mapNeedsGeometryRebuild) {
    rebuildMapGeometry();
  }

  mapCtx.save();
  mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  mapCtx.clearRect(0, 0, width, height);

  const background = mapCtx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#f7f7f7");
  background.addColorStop(1, "#ffffff");
  mapCtx.fillStyle = background;
  mapCtx.fillRect(0, 0, width, height);

  if (!mapPath) {
    mapCtx.restore();
    return;
  }

  mapCtx.save();
  mapCtx.beginPath();
  if (mapGeographicView === "regional") {
    mapCtx.rect(0, 0, width, height);
  } else {
    mapPath({ type: "Sphere" });
  }
  mapCtx.clip();

  const colors = new Map();
  mapCells.forEach(cell => {
    const count = globalCoverageCounts[cell.targetIdx] || 0;
    if (!colors.has(count)) colors.set(count, coverageColor(count, mapColorScaleMax));
    mapCtx.fillStyle = colors.get(count);
    mapCtx.fill(cell.path);
  });

  drawZeroCoverageOutlines();

  mapCtx.restore();

  mapCtx.save();
  mapCtx.beginPath();
  if (mapGeographicView === "regional") {
    mapCtx.rect(0, 0, width, height);
  } else {
    mapPath({ type: "Sphere" });
    mapCtx.strokeStyle = "#d0d0d0";
    mapCtx.lineWidth = 0.8;
    mapCtx.stroke();
  }
  mapCtx.clip();
  drawMapBoundaries();
  drawThreatSiteMarkers();
  mapCtx.restore();

  mapCtx.restore();
}

let mapTransitionTimer = null;
let mapMorphFrame = 0;
let mapProjectionMorphActive = false;
function captureMapTransition(animateFade = true) {
  if (visualizationMode !== "2d" || !mapTransitionCanvas || !mapCanvas || prefersReducedMotion()) return null;
  cancelAnimationFrame(mapMorphFrame);
  mapProjectionMorphActive = false;
  clearTimeout(mapTransitionTimer);
  const snapshot = document.createElement("canvas");
  snapshot.width = mapCanvas.width;
  snapshot.height = mapCanvas.height;
  snapshot.getContext("2d").drawImage(mapCanvas, 0, 0);
  mapTransitionCanvas.width = snapshot.width;
  mapTransitionCanvas.height = snapshot.height;
  mapTransitionCanvas.style.transition = "none";
  mapTransitionCanvas.style.transform = "none";
  mapTransitionCanvas.style.display = "block";
  mapTransitionCanvas.style.opacity = "1";
  mapTransitionCanvas.getContext("2d").drawImage(snapshot, 0, 0);
  if (animateFade) {
    mapTransitionTimer = setTimeout(() => { mapTransitionCanvas.style.display = "none"; }, 520);
    requestAnimationFrame(() => {
      mapTransitionCanvas.style.transition = "opacity .5s ease";
      mapTransitionCanvas.style.opacity = "0";
    });
  }
  return snapshot;
}

function startProjectionMorph(snapshot, sourceProjection, destinationProjection, oldMarkers, onComplete = null) {
  if (!snapshot || !sourceProjection || !destinationProjection) {
    onComplete?.();
    return;
  }
  clearTimeout(mapTransitionTimer);
  mapProjectionMorphActive = true;
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth, height = window.innerHeight;
  const morphStride = Math.max(2, Math.ceil(globalCellLatLon.length / 8000));
  const cells = globalCellLatLon.map((cell, index) => ({
    source: sourceProjection([cell.lon, cell.lat]),
    destination: destinationProjection([cell.lon, cell.lat]),
    color: coverageColor(globalCoverageCounts[index] || 0, mapColorScaleMax)
  })).filter((cell, index) => index % morphStride === 0 &&
    cell.source?.every(Number.isFinite) && cell.destination?.every(Number.isFinite));
  const colorGroups = new Map();
  cells.forEach(cell => {
    if (!colorGroups.has(cell.color)) colorGroups.set(cell.color, []);
    colorGroups.get(cell.color).push(cell);
  });
  const markerDestinations = [...mapSiteLayer.children].map(marker => [parseFloat(marker.style.left), parseFloat(marker.style.top)]);
  [...mapSiteLayer.children].forEach((marker, index) => {
    const start = oldMarkers[index];
    if (!start || start.some(value => !Number.isFinite(value))) return;
    marker.style.left = `${start[0]}px`;
    marker.style.top = `${start[1]}px`;
  });
  const ctx = mapTransitionCanvas.getContext("2d");
  const started = performance.now();
  const frame = now => {
    const linear = Math.min(1, (now - started) / 1150);
    const t = linear * linear * (3 - 2 * linear);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, "#f7f7f7");
    background.addColorStop(1, "#ffffff");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    const cellSize = Math.max(4, Math.min(28,
      (sourceProjection.scale() * (1 - t) + destinationProjection.scale() * t) * .04));
    colorGroups.forEach((group, color) => {
      ctx.fillStyle = color;
      group.forEach(cell => {
        const x = cell.source[0] + (cell.destination[0] - cell.source[0]) * t;
        const y = cell.source[1] + (cell.destination[1] - cell.source[1]) * t;
        if (x < -cellSize || x > width + cellSize || y < -cellSize || y > height + cellSize) return;
        ctx.fillRect(x - cellSize / 2, y - cellSize / 2, cellSize, cellSize);
      });
    });
    const originA = sourceProjection([0, 0]), originB = destinationProjection([0, 0]);
    const origin = [originA[0] + (originB[0] - originA[0]) * t,
      originA[1] + (originB[1] - originA[1]) * t];
    const projection = geoProjection((longitudeRad, latitudeRad) => {
      const coordinate = [THREE.MathUtils.radToDeg(longitudeRad), THREE.MathUtils.radToDeg(latitudeRad)];
      const a = sourceProjection(coordinate), b = destinationProjection(coordinate);
      if (!a || !b || !a.every(Number.isFinite) || !b.every(Number.isFinite)) return [0, 0];
      return [a[0] + (b[0] - a[0]) * t - origin[0],
        -(a[1] + (b[1] - a[1]) * t - origin[1])];
    }).scale(1).translate(origin).precision(4);
    const path = geoPath(projection, ctx);
    if (worldGeoJson) {
      ctx.strokeStyle = "rgba(150,150,150,.7)";
      ctx.lineWidth = .7;
      ctx.beginPath(); path(worldGeoJson); ctx.stroke();
      ctx.strokeStyle = "#666666";
      ctx.lineWidth = 1.3;
      worldFeatures.filter(feature => countryMatches(feature.properties?.name || "", countrySelect.value))
        .forEach(feature => { ctx.beginPath(); path(feature); ctx.stroke(); });
    }
    [...mapSiteLayer.children].forEach((marker, index) => {
      const start = oldMarkers[index], end = markerDestinations[index];
      if (!start || !end || start.some(value => !Number.isFinite(value)) || end.some(value => !Number.isFinite(value))) return;
      marker.style.left = `${start[0] + (end[0] - start[0]) * t}px`;
      marker.style.top = `${start[1] + (end[1] - start[1]) * t}px`;
    });
    if (linear < 1) mapMorphFrame = requestAnimationFrame(frame);
    else {
      mapProjectionMorphActive = false;
      mapTransitionCanvas.style.transition = "opacity .18s ease";
      mapTransitionCanvas.style.opacity = "0";
      window.setTimeout(() => {
        if (!mapProjectionMorphActive) mapTransitionCanvas.style.display = "none";
      }, 200);
      drawThreatSiteMarkers();
      onComplete?.();
    }
  };
  mapTransitionCanvas.style.transition = "none";
  mapTransitionCanvas.style.opacity = "1";
  mapMorphFrame = requestAnimationFrame(frame);
}

function updateMapControlLabels() {
  const in2D = visualizationMode === "2d";
  viewToggleBtn.innerHTML = in2D
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c-2.5 2-3.5 4.7-3.5 8s1 6 3.5 8M12 4c2.5 2 3.5 4.7 3.5 8s-1 6-3.5 8"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/></svg>';
  viewToggleBtn.title = in2D ? "Switch to 3D Globe" : "Switch to 2D Map";
  viewToggleBtn.setAttribute("aria-label", in2D ? "Switch to 3D Globe" : "Switch to 2D Map");
  zoomInBtn.title = in2D ? "Regional View — focus on selected threat region" : "Zoom in";
  zoomOutBtn.title = in2D ? "Global View — show full Earth" : "Zoom out";
  zoomInBtn.setAttribute("aria-label", zoomInBtn.title);
  zoomOutBtn.setAttribute("aria-label", zoomOutBtn.title);
  zoomInBtn.setAttribute("aria-pressed", in2D ? String(mapGeographicView === "regional") : "false");
  zoomOutBtn.setAttribute("aria-pressed", in2D ? String(mapGeographicView === "global") : "false");
}

function setMapGeographicView(view) {
  if (view === mapGeographicView) return;
  stopRegionalMapIntro();
  const sourceProjection = mapProjection;
  const oldMarkers = [...mapSiteLayer.children].map(marker => [parseFloat(marker.style.left), parseFloat(marker.style.top)]);
  const snapshot = captureMapTransition(false);
  mapGeographicView = view;
  mapSiteLayer.style.display = visualizationMode === "2d" && view === "regional" ? "block" : "none";
  if (view === "global") hideSiteTooltip();
  resetMapView();
  updateMapControlLabels();
  draw2DMap();
  startProjectionMorph(snapshot, sourceProjection, mapProjection, oldMarkers,
    view === "regional" ? () => {
      [...mapSiteLayer.children].forEach(marker => { marker.dataset.darkBlip = "true"; });
    } : null);
}

function setVisualizationMode(mode) {
  if (mode !== "3d") stopGeographicIntro();
  if (mode !== "2d") {
    stopRegionalMapIntro();
    cancelAnimationFrame(mapMorphFrame);
    mapProjectionMorphActive = false;
    mapTransitionCanvas.style.display = "none";
  }
  const previousMode = visualizationMode;
  visualizationMode = mode;
  document.body.classList.toggle("mapMode2D", mode === "2d");
  if (mapSiteLayer) mapSiteLayer.style.display = mode === "2d" && mapGeographicView === "regional" ? "block" : "none";
  hideSiteTooltip();

  if (mode === "2d") {
    if (previousMode !== "2d") mapGeographicView = "global";
    mapSiteLayer.style.display = mapGeographicView === "regional" ? "block" : "none";
    clear3DViewOffset();

    renderer.domElement.style.display = "none";
    if (mapCanvas) mapCanvas.style.display = "block";
    if (cameraControls) cameraControls.style.display = "flex";
    if (legend3D) legend3D.style.display = "none";
    if (legend2D) legend2D.style.display = "block";

    resetMapView();
    globalCoverageCounts = computeCountsForPositions(globalCellPositions);
    updateMapColorScaleMax(Math.max(1, ...globalCoverageCounts));
    mapNeedsGeometryRebuild = true;
    if (previousMode !== "2d" && mapGeographicView === "regional" &&
        !restoringPresentation && !idleActive && targetLatLon.length)
      mapCanvas.style.opacity = "0";
    draw2DMap();
    if (previousMode !== "2d" && mapGeographicView === "regional" &&
        !restoringPresentation && !idleActive) void runScenarioMapIntro();
  } else {
    attachCarouselInertialFrame();
    if (previousMode === "2d") {
      alignCarouselInertialFrame();
      updateTrajectoryLines();
      updateSatellitePositions();
    }
    renderer.domElement.style.display = "block";
    if (mapCanvas) mapCanvas.style.display = "none";
    if (cameraControls) cameraControls.style.display = "flex";
    if (legend3D) legend3D.style.display = "grid";
    if (legend2D) legend2D.style.display = "none";

    if (idleActive && previousMode === "3d") {
      // Keep the live camera pose for the automatic carousel entry animation.
    } else if (previousMode === "2d") {
      camera.fov = 38;
      camera.zoom = 1;
      setFullEarthView();
    } else if (!isHorizonView) {
      setFullEarthView();
    } else {
      setHorizonView();
    }

    renderer.render(scene, camera);
  }
  updateMapControlLabels();
  threatScenarioDetail.syncHeight();
}

function zoom2DMap(factor, centerX = window.innerWidth / 2, centerY = window.innerHeight / 2) {
  const previousZoom = mapZoom;
  const nextZoom = Math.max(1, Math.min(8, mapZoom * factor));

  if (nextZoom === previousZoom) return;

  mapPanX = centerX - ((centerX - mapPanX) * nextZoom / previousZoom);
  mapPanY = centerY - ((centerY - mapPanY) * nextZoom / previousZoom);
  mapZoom = nextZoom;

  if (mapZoom <= 1.0001) {
    mapPanX = 0;
    mapPanY = 0;
  }

  mapNeedsGeometryRebuild = true;
  draw2DMap();
}

function updatePlaybackButton() {
  if (isPlaying) {
    playBtn.innerHTML = `
      <span class="pauseIcon"></span>
    `;
  } else {
    playBtn.innerHTML = `
      <span class="playIcon"></span>
    `;
  }
}

function setPlaybackMultiplier(multiplier) {
  playbackMultiplier = Math.max(0.25, Math.min(4.0, multiplier));
  if (!idleActive) currentPlaybackMultiplier = playbackMultiplier;
}

function degToRad(d) {
  return d * Math.PI / 180;
}

function radToDeg(r) {
  return r * 180 / Math.PI;
}

function normalizeDeg(d) {
  return ((d % 360) + 360) % 360;
}

function formatThreatRegionName(name) {
  const normalized = String(name || "")
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .trim()
    .toLowerCase();

  if (normalized === "china") return "China";
  if (normalized === "iran") return "Iran";
  if (normalized === "russia") return "Russia";
  if (normalized === "north korea") return "North Korea";

  return normalized.replace(/\b\w/g, char => char.toUpperCase());
}

function normalizeCountryName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .trim();
}

function countryMatches(featureName, selectedName) {
  const a = normalizeCountryName(featureName);
  const b = normalizeCountryName(selectedName);

  if (a === b) return true;

  if (b === "north korea" && a.includes("korea")) {
    return a.includes("north") || a.includes("dem");
  }

  if (b === "russia" && a.includes("russia")) return true;
  if (b === "iran" && a.includes("iran")) return true;
  if (b === "china" && a === "china") return true;

  return false;
}

function meanAngleDeg(values) {
  let sx = 0;
  let sy = 0;

  values.forEach(v => {
    const r = degToRad(v);
    sx += Math.cos(r);
    sy += Math.sin(r);
  });

  return normalizeDeg(radToDeg(Math.atan2(sy, sx)));
}

function latLonToVector3(latDeg, lonDeg, radius = 1) {
  const lat = degToRad(latDeg);
  const lon = degToRad(lonDeg);

  return new THREE.Vector3(
    radius * Math.cos(lat) * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * Math.cos(lat) * Math.sin(lon)
  );
}

// Coverage/chart path: retain the original analytical convention and never
// read the display-only row.assignedPlane reference.
function rotateAnalyticalVectorToEarthFixed(position, tSeconds) {
  return position
    .clone()
    .applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -EARTH_ROTATION_RATE_RAD_PER_SEC * tSeconds
    );
}

function makeSatelliteSpriteTexture(fillColor, strokeColor, strokeWidth = 18) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 128, 128);

  ctx.beginPath();
  ctx.arc(64, 64, 37, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();

  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = strokeColor;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;

  return texture;
}

function makeFallbackEarth() {
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 160, 160),
    new THREE.MeshBasicMaterial({
      color: 0xf7f7f7,
      depthTest: true,
      depthWrite: true
    })
  );

  earth.renderOrder = 0;
  earthGroup.add(earth);
}

async function loadWorldBoundaries() {
  const standardUrl = "assets/countries-110m.json";
  const standardResponse = await fetch(standardUrl);
  const standardTopology = await standardResponse.json();
  const countries = topojson.feature(standardTopology, standardTopology.objects.countries);

  worldFeatures = countries.features;
  worldGeoJson = countries;

  redrawCountryBoundaries();
  mapNeedsGeometryRebuild = true;
  draw2DMap();
  threatScenarioDetail.refreshMap();

  try {
    const detailedUrl = "assets/countries-50m.json";
    const detailedResponse = await fetch(detailedUrl);
    const detailedTopology = await detailedResponse.json();
    detailedWorldFeatures = topojson.feature(
      detailedTopology,
      detailedTopology.objects.countries
    ).features;
    redrawCountryBoundaries();
    threatScenarioDetail.refreshMap();
  } catch (detailError) {
    console.warn("Detailed inset boundaries could not be loaded; using standard boundaries.", detailError);
  }
}

let focusCountryFillTexture = null;
function redrawCountryBoundaries() {
  clearGroup(countryLineGroup);
  clearGroup(focusCountryLineGroup);
  clearGroup(focusCountryFillGroup);
  if (focusCountryFillTexture) focusCountryFillTexture.dispose();
  focusCountryFillTexture = null;

  const selectedCountry = countrySelect.value;
  const globeFeatures = detailedWorldFeatures.length ? detailedWorldFeatures : worldFeatures;
  const focusFeatures = globeFeatures.filter(feature =>
    countryMatches(feature.properties?.name || "", selectedCountry));

  if (focusFeatures.length) {
    const canvas = document.createElement("canvas");
    canvas.width = 2048;
    canvas.height = 1024;
    const context = canvas.getContext("2d");
    const projection = geoEquirectangular()
      .scale(canvas.width / (2 * Math.PI))
      .translate([canvas.width / 2, canvas.height / 2]);
    const path = geoPath(projection, context);
    context.fillStyle = "#e3e3e3";
    focusFeatures.forEach(feature => {
      context.beginPath();
      path(feature);
      context.fill("evenodd");
    });
    focusCountryFillTexture = new THREE.CanvasTexture(canvas);
    focusCountryFillTexture.colorSpace = THREE.SRGBColorSpace;
    const fill = new THREE.Mesh(
      new THREE.SphereGeometry(1.0007, 128, 64),
      new THREE.MeshBasicMaterial({ map: focusCountryFillTexture, transparent: true, depthTest: true, depthWrite: false })
    );
    fill.renderOrder = 2;
    focusCountryFillGroup.add(fill);
  }

  globeFeatures.forEach(feature => {
    const name = feature.properties?.name || "";
    const isFocus = countryMatches(name, selectedCountry);
    addCountryBoundary(feature.geometry, false);
    if (isFocus) addCountryBoundary(feature.geometry, true);
  });

  if (hideNewScenarioVisuals) {
    setGroupOpacityFactor(focusCountryLineGroup, 0);
  }

  draw2DMap();
}

function addCountryBoundary(geometry, isFocus) {
  if (!geometry) return;

  if (geometry.type === "Polygon") {
    geometry.coordinates.forEach(ring => addBoundaryTube(ring, isFocus));
  }

  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach(poly => {
      poly.forEach(ring => addBoundaryTube(ring, isFocus));
    });
  }
}

function addBoundaryTube(ring, isFocus) {
  if (!ring || ring.length < 3) return;

  const radius = isFocus ? 1.002 : 1.0017;
  const positions = [];
  // Follow the source vertices without spline overshoot. Long source jumps
  // are discontinuities, not borders to loop across the globe.
  for (let index = 1; index < ring.length; index += 1) {
    const from = latLonToVector3(ring[index - 1][1], ring[index - 1][0]);
    const to = latLonToVector3(ring[index][1], ring[index][0]);
    const angle = from.angleTo(to);
    if (angle > THREE.MathUtils.degToRad(25)) continue;
    const steps = Math.max(1, Math.ceil(angle / THREE.MathUtils.degToRad(1)));
    let last = from;
    for (let step = 1; step <= steps; step += 1) {
      const next = from.clone().lerp(to, step / steps).normalize();
      positions.push(last.x * radius, last.y * radius, last.z * radius,
        next.x * radius, next.y * radius, next.z * radius);
      last = next;
    }
  }
  if (!positions.length) return;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(Array.from({ length: positions.length / 3 }, (_, index) => index));
  const mat = new THREE.LineBasicMaterial({
    color: isFocus ? 0x454545 : 0x626262,
    transparent: true,
    opacity: isFocus ? 1 : .85,
    depthTest: true,
    depthWrite: false
  });

  const line = new THREE.LineSegments(geom, mat);
  line.renderOrder = isFocus ? 8 : 3;

  if (isFocus) {
    focusCountryLineGroup.add(line);
  } else {
    countryLineGroup.add(line);
  }
}

function orbitalRatesRadPerSec(aKm, e, iRad) {
  const n = Math.sqrt(MU_EARTH_KM3_S2 / Math.pow(aKm, 3));
  if (!scenarioUseJ2) return { raan: 0, argumentOfLatitude: n };

  const J2 = 1.08262668e-3;
  const p = aKm * (1 - e * e);
  const j2Factor = J2 * Math.pow(EARTH_RADIUS_KM / p, 2);
  const sinI = Math.sin(iRad);
  const nBar = n * (1 + .75 * j2Factor * Math.sqrt(1 - e * e) * (2 - 3 * sinI * sinI));
  const perigeeRate = .75 * j2Factor * nBar * (4 - 5 * sinI * sinI);
  return {
    raan: -1.5 * j2Factor * nBar * Math.cos(iRad),
    argumentOfLatitude: nBar + perigeeRate
  };
}

function raanAtTimeRad(raan0Rad, aKm, e, iRad, tSeconds) {
  return raan0Rad + orbitalRatesRadPerSec(aKm, e, iRad).raan * tSeconds;
}

function propagationForRow(row) {
  if (row.orbitalPropagation?.useJ2 === scenarioUseJ2) return row.orbitalPropagation;
  const a = Number(row.a_km);
  const inclination = degToRad(Number(row.i_deg));
  const rates = orbitalRatesRadPerSec(a, Number(row.e) || 0, inclination);
  row.orbitalPropagation = {
    useJ2: scenarioUseJ2,
    radius: a * SCALE,
    inclinationCos: Math.cos(inclination),
    inclinationSin: Math.sin(inclination),
    raan: degToRad(Number(row.raan_deg)),
    argumentOfLatitude: degToRad(Number(row.arg_lat_deg || 0)),
    raanRate: rates.raan,
    argumentRate: rates.argumentOfLatitude
  };
  return row.orbitalPropagation;
}

function analyticalOrbitalPosition(row, tSeconds) {
  const orbit = propagationForRow(row);
  const raan = orbit.raan + orbit.raanRate * tSeconds;
  const argLat = orbit.argumentOfLatitude + orbit.argumentRate * tSeconds;

  const xOrb = orbit.radius * Math.cos(argLat);
  const yOrb = orbit.radius * Math.sin(argLat);

  const cosO = Math.cos(raan);
  const sinO = Math.sin(raan);
  const cosI = orbit.inclinationCos;
  const sinI = orbit.inclinationSin;

  const x = xOrb * cosO - yOrb * sinO * cosI;
  const y = xOrb * sinO + yOrb * cosO * cosI;
  const z = yOrb * sinI;

  const inertialPosition = new THREE.Vector3(x, z, -y);

  return rotateAnalyticalVectorToEarthFixed(inertialPosition, tSeconds);
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).filter(Boolean).map(line => {
    const values = line.split(",").map(v => v.trim());
    const row = {};

    headers.forEach((h, idx) => {
      row[h] = values[idx];
    });

    return row;
  });
}

function clearGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);

    if (child.geometry) child.geometry.dispose();

    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => mat.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
}

function clearConstellation() {
  clearGroup(constellationGroup);
  clearGroup(trajectoryGroup);
  clearGroup(siteMarkerGroup);
  sitePickMeshes.length = 0;
  if (mapSiteLayer) mapSiteLayer.replaceChildren();
  hideSiteTooltip();

  satObjects = [];
  satellitePointCloud = null;
  satelliteOrbitCache = [];
  trajectoryObjects = [];
  planeModels = [];
  planeSatelliteCounts = [];
  planeSatelliteIndices = [];
  planeAnimationOrder = [];
  planeIndexByReference = new Map();
  targetPositions = [];
  targetLatLon = [];
  targetCoverageCounts = [];
  globalCoverageCounts = [];
  globalCellSpatialIndex = null;
  mapCells = [];
  mapNeedsGeometryRebuild = true;
  mapMaxCoverage = 1;
  mapColorScaleMax = 1;
  killRadiusKm = null;
  interceptAltitudeKm = 200;
  minElevationDeg = 0;
  scenarioUseJ2 = false;
  simulationSeconds = 0;
  earthPresentationTimeSeconds = 0;
  isPlaying = true;

  updateCoverageLegendMax();
  updatePlaybackButton();
  setStats(null, null);
  resetCoverageHistory();

  if (timelineSlider) {
    timelineSlider.value = 0;
  }

  draw2DMap();
  renderer.render(scene, camera);
}

function clusterOrbitalPlanes(rows) {
  const bins = new Map();

  rows.forEach(row => {
    const iDeg = Number(row.i_deg);
    const raanDeg = normalizeDeg(Number(row.raan_deg));

    const iBin = Math.round(iDeg / PLANE_INC_BIN_DEG) * PLANE_INC_BIN_DEG;
    const raanBin = Math.round(raanDeg / PLANE_RAAN_BIN_DEG) * PLANE_RAAN_BIN_DEG;
    const key = `${iBin}_${normalizeDeg(raanBin)}`;

    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(row);
  });

  const planes = [];

  bins.forEach(groupRows => {
    const aMean = groupRows.reduce((s, r) => s + Number(r.a_km), 0) / groupRows.length;
    const iMean = groupRows.reduce((s, r) => s + Number(r.i_deg), 0) / groupRows.length;
    const raanMean = meanAngleDeg(groupRows.map(r => Number(r.raan_deg)));

    const plane = {
      a_km: aMean,
      i_deg: iMean,
      raan_deg: raanMean,
      count: groupRows.length
    };

    groupRows.forEach(row => {
      row.assignedPlane = plane;
    });

    planes.push(plane);
  });

  return planes;
}

function countActualOrbitalPlanes(rows) {
  return new Set(rows.map(row =>
    `${Number(row.i_deg)}|${normalizeDeg(Number(row.raan_deg))}`)).size;
}

function makeTrajectoryTube(plane) {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.BufferAttribute(new Float32Array(TRAJECTORY_SEGMENTS * 3), 3);
  positions.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positions);
  const mat = new THREE.LineBasicMaterial({
    color: TRAJECTORY_COLOR,
    transparent: true,
    opacity: 0.24,
    linewidth: 1,
    depthTest: true,
    depthWrite: true
  });
  const line = new THREE.LineLoop(geometry, mat);
  line.frustumCulled = false;
  trajectoryObjects.push({ mesh: line, plane });
  trajectoryGroup.add(line);
  updateSingleTrajectoryLine({ mesh: line, plane });
}

function updateSingleTrajectoryLine({ mesh, plane }) {
  const positions = mesh.geometry.attributes.position.array;
  const radius = plane.a_km * SCALE;
  const inclination = degToRad(plane.i_deg);
  const raan0 = degToRad(plane.raan_deg);
  const raan = raanAtTimeRad(raan0, plane.a_km, 0, inclination, simulationSeconds);
  const raanCos = Math.cos(raan), raanSin = Math.sin(raan);
  const inclinationCos = Math.cos(inclination), inclinationSin = Math.sin(inclination);
  const earthAngle = carouselInertialAttached ? 0 : -EARTH_ROTATION_RATE_RAD_PER_SEC * simulationSeconds;
  const earthCos = Math.cos(earthAngle), earthSin = Math.sin(earthAngle);
  for (let index = 0; index < TRAJECTORY_SEGMENTS; index += 1) {
    const [unitX, unitY] = TRAJECTORY_UNIT_CIRCLE[index];
    const xOrb = radius * unitX, yOrb = radius * unitY;
    const inertialX = xOrb * raanCos - yOrb * raanSin * inclinationCos;
    const inertialY = xOrb * raanSin + yOrb * raanCos * inclinationCos;
    const offset = index * 3;
    positions[offset] = inertialX * earthCos - inertialY * earthSin;
    positions[offset + 1] = yOrb * inclinationSin;
    positions[offset + 2] = -inertialX * earthSin - inertialY * earthCos;
  }
  mesh.geometry.attributes.position.needsUpdate = true;
}

function updateTrajectoryLines() {
  document.body.dataset.trajectoryGeometryUpdates = String(
    Number(document.body.dataset.trajectoryGeometryUpdates || 0) + 1);
  trajectoryObjects.forEach(updateSingleTrajectoryLine);
}

function updateSatellitePositions() {
  if (!satellitePointCloud) return;
  const attribute = satellitePointCloud.geometry.getAttribute("position");
  const values = attribute.array;
  const earthAngle = carouselInertialAttached ? 0 : -EARTH_ROTATION_RATE_RAD_PER_SEC * simulationSeconds;
  const earthCos = Math.cos(earthAngle), earthSin = Math.sin(earthAngle);
  for (let idx = 0; idx < satelliteOrbitCache.length; idx += 1) {
    const orbit = satelliteOrbitCache[idx];
    const argument = orbit.argumentOfLatitude + orbit.rawMeanMotion * simulationSeconds;
    const rawRaan = orbit.rawRaan + orbit.rawRaanRate * simulationSeconds;
    const raan = orbit.displayRaan + orbit.displayRaanRate * simulationSeconds;
    // Project the analytical position onto the assigned representative plane.
    // This is the closest point on its displayed circular trajectory; the
    // original row still drives all coverage and chart calculations.
    const raanDifference = rawRaan - raan;
    const deltaCos = Math.cos(raanDifference), deltaSin = Math.sin(raanDifference);
    const argumentCos = Math.cos(argument), argumentSin = Math.sin(argument);
    const alongNode = argumentCos * deltaCos -
      argumentSin * orbit.rawInclinationCos * deltaSin;
    const alongTrack = argumentCos * orbit.displayInclinationCos * deltaSin +
      argumentSin * (orbit.rawInclinationCos * orbit.displayInclinationCos * deltaCos +
        orbit.rawInclinationSin * orbit.displayInclinationSin);
    const projectedLength = Math.hypot(alongNode, alongTrack) || 1;
    const xOrb = orbit.radius * alongNode / projectedLength;
    const yOrb = orbit.radius * alongTrack / projectedLength;
    const raanCos = Math.cos(raan), raanSin = Math.sin(raan);
    const inertialX = xOrb * raanCos - yOrb * raanSin * orbit.displayInclinationCos;
    const inertialY = xOrb * raanSin + yOrb * raanCos * orbit.displayInclinationCos;
    const inertialZ = yOrb * orbit.displayInclinationSin;
    const offset = idx * 3;
    values[offset] = inertialX * earthCos - inertialY * earthSin;
    values[offset + 1] = inertialZ;
    values[offset + 2] = -inertialX * earthSin - inertialY * earthCos;
  }
  attribute.needsUpdate = true;
}

function updateCoverageColors(forceCoverageSample = false, recordCoverageSample = true, deferMapDraw = false) {
  // Coverage, chart history, and 2D colors all use the full Principal Run.
  // Grouping only controls how many representative 3D lines are drawn.
  const metrics = computeCoverageMetrics(visualizationMode === "2d", simulationSeconds,
    analyticalOrbitalPosition);

  coverageCurrentMetrics = metrics;

  if (metrics !== null) {
    satObjects.activeCount = metrics.activeSatellites;

    if (recordCoverageSample) {
      addCoverageSample(metrics, forceCoverageSample);
    } else {
      drawCoverageChart();
    }
  } else {
    satObjects.activeCount = 0;
    drawCoverageChart();
  }

  draw2DMap();
}

function updateTimelineSlider() {
  if (!timelineSlider) return;

  const hours = simulationSeconds / SECONDS_PER_HOUR;
  timelineSlider.value = hours.toFixed(2);
  if (timelineTime) timelineTime.textContent = formatTimeHHMM(simulationSeconds);
  const max = Number(timelineSlider.max) || 24;
  const progress = Math.max(0, Math.min(100, (hours / max) * 100));
  timelineSlider.style.setProperty("--timeline-progress", `${progress}%`);
}

let lastTrajectoryUpdateAt = 0;
function updateSceneForTime(forceCoverageSample = false, recordCoverageSample = true,
    deferMapDraw = false, updateDisplayPositions = true) {
  if (updateDisplayPositions) updateSatellitePositions();
  const now = performance.now();
  if (visualizationMode === "3d" && (scenarioUseJ2 || !carouselInertialAttached) &&
      (forceCoverageSample || !isPlaying || now - lastTrajectoryUpdateAt > 180)) {
    updateTrajectoryLines();
    lastTrajectoryUpdateAt = now;
  }
  updateCoverageColors(forceCoverageSample, recordCoverageSample, deferMapDraw);
  updateTimelineSlider();
}

function updateFocusFromTargets(targets) {
  if (!targets || targets.length === 0) return;

  let latSum = 0;
  let lonSum = 0;

  targets.forEach(t => {
    latSum += Number(t.lat_deg);
    lonSum += Number(t.lon_deg);
  });

  focusLatDeg = latSum / targets.length;
  focusLonDeg = lonSum / targets.length;
}

async function loadScenarioJson(csvPath, preloadedData = null) {
  const jsonPath = csvPath.replace(/\.csv$/i, ".json");
  const response = preloadedData ? null : await fetch(jsonPath);

  if (!preloadedData && !response.ok) {
    targetPositions = [];
    targetLatLon = [];
    targetCoverageCounts = [];
    killRadiusKm = null;

    return {
      loaded: false,
      message: `No scenario JSON found at ${jsonPath}`
    };
  }

  const data = preloadedData || await response.json();

  scenarioDurationSeconds = Math.min(12 * SECONDS_PER_HOUR,
    Number(data.sim?.horizon_s) || 12 * SECONDS_PER_HOUR);

  scenarioTimeStepSeconds =
    Number(data.sim?.dt_s) || 120;
  document.body.dataset.analysisTimeStepSeconds = String(scenarioTimeStepSeconds);

  scenarioUseJ2 = data.sim?.use_j2 === true;

  if (timelineSlider) {
    timelineSlider.max = (
      scenarioDurationSeconds / SECONDS_PER_HOUR
    ).toFixed(2);
  }

  const runConfig = data.run_config || {};

  interceptAltitudeKm = Number(
    runConfig.intercept_alt_km ??
    data.cov?.intercept_alt_km ??
    200
  );

  killRadiusKm = Number(
    runConfig.r_max_km ??
    data.r_max_km ??
    null
  );

  minElevationDeg = Number(
    runConfig.min_elev_deg ??
    runConfig.min_elevation_deg ??
    data.cov?.min_elev_deg ??
    data.cov?.min_elevation_deg ??
    0
  );

  const targetRadius = (EARTH_RADIUS_KM + interceptAltitudeKm) / EARTH_RADIUS_KM;
  const targets = data.targets || [];

  updateFocusFromTargets(targets);

  targetLatLon = targets.map(t => ({
    name: String(t.name || "Launch site"),
    lat: Number(t.lat_deg),
    lon: Number(t.lon_deg)
  }));
  rebuildGlobeSiteMarkers();
  rebuildCarouselSiteMarkers();

  targetCoverageCounts = targets.map(() => 0);

  targetPositions = targets.map(t =>
    latLonToVector3(Number(t.lat_deg), Number(t.lon_deg), targetRadius)
  );

  if (globalCellLatLon.length === 0) {
    globalCellLatLon = generateGlobalFibonacciCells();
  }
  document.body.dataset.mapCellCount = String(globalCellLatLon.length);

  globalCellPositions = globalCellLatLon.map(cell =>
    latLonToVector3(cell.lat, cell.lon, targetRadius)
  );
  globalCellSpatialIndex = buildGlobalCellSpatialIndex();

  globalCoverageCounts = globalCellLatLon.map(() => 0);
  mapMaxCoverage = 1;
  mapColorScaleMax = 1;
  updateCoverageLegendMax();
  mapNeedsGeometryRebuild = true;

  return {
    loaded: true,
    nTargets: targetPositions.length,
    killRadiusKm,
    interceptAltitudeKm
  };
}

function renderConstellation(rows, scenarioInfo = null) {
  // Display geometry lives in an inertial frame in both 3D presentation modes.
  attachCarouselInertialFrame();
  clearGroup(constellationGroup);
  clearGroup(trajectoryGroup);

  satObjects = [];
  satellitePointCloud = null;
  trajectoryObjects = [];
  planeModels = [];

  simulationSeconds = 0;
  earthPresentationTimeSeconds = 0;
  alignCarouselInertialFrame();
  isPlaying = !configurationPending;
  updatePlaybackButton();

  if (timelineSlider) timelineSlider.value = 0;
  resetCoverageHistory();

  planeModels = clusterOrbitalPlanes(rows);
  planeIndexByReference = new Map(planeModels.map((plane, index) => [plane, index]));
  const indicesByPlane = planeModels.map(() => []);
  rows.forEach((row, index) => {
    const planeIndex = planeIndexByReference.get(row.assignedPlane);
    if (planeIndex !== undefined) indicesByPlane[planeIndex].push(index);
  });
  planeSatelliteCounts = indicesByPlane.map(indices => indices.length);
  planeSatelliteIndices = indicesByPlane;
  planeAnimationOrder = indicesByPlane.map((_, index) => index);
  setStats(rows.length, planeModels.length);

  satObjects = rows.map(row => ({ row }));
  satelliteOrbitCache = rows.map(row => {
    // Snap only the visible sprite to its representative plane. The row used by
    // coverage and chart calculations retains its original orbital elements.
    const displayPlane = row.assignedPlane;
    const rawOrbit = propagationForRow(row);
    const displayAKm = Number(displayPlane.a_km);
    const displayInclination = degToRad(Number(displayPlane.i_deg));
    return {
      radius: displayAKm * SCALE,
      rawMeanMotion: rawOrbit.argumentRate,
      rawInclinationCos: rawOrbit.inclinationCos,
      rawInclinationSin: rawOrbit.inclinationSin,
      rawRaan: rawOrbit.raan,
      rawRaanRate: rawOrbit.raanRate,
      displayInclinationCos: Math.cos(displayInclination),
      displayInclinationSin: Math.sin(displayInclination),
      displayRaan: degToRad(Number(displayPlane.raan_deg)),
      displayRaanRate: orbitalRatesRadPerSec(displayAKm, 0, displayInclination).raan,
      argumentOfLatitude: rawOrbit.argumentOfLatitude
    };
  });
  if (!satelliteMarkerTexture) satelliteMarkerTexture = makeSatelliteSpriteTexture("#ffffff", "#111111", 14);
  const positions = new Float32Array(rows.length * 3);
  const colors = new Float32Array(rows.length * 3);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  colorAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", colorAttribute);
  geometry.setIndex(indicesByPlane.flat());
  const material = new THREE.PointsMaterial({
    map: satelliteMarkerTexture,
    size: markerSizeForCurrentRun(idleActive),
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: true,
    alphaTest: 0.02
  });
  // A tiny clip-space bias keeps a point sprite above its own tube while
  // preserving the globe's depth test and real orbital coordinates.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\n  gl_Position.z -= 0.000016 * gl_Position.w;");
  };
  satellitePointCloud = new THREE.Points(geometry, material);
  document.body.dataset.satelliteMarkerSizePx = String(material.size);
  satellitePointCloud.frustumCulled = false;
  satellitePointCloud.renderOrder = 12;
  constellationGroup.add(satellitePointCloud);
  updateSatellitePointColors(new Set());

  planeModels.forEach(plane => makeTrajectoryTube(plane));
  if (hideNewScenarioVisuals) {
    setGroupOpacityFactor(constellationGroup, 0);
    setGroupOpacityFactor(trajectoryGroup, 0);
  }
  if (!configurationPending) fillCoverageHistoryToTime(0);
  updateSceneForTime(false, false);

  setStatus(
    `Loaded Scenario. Satellites: ${rows.length}. Orbital planes: ${planeModels.length}.`
  );
}

async function loadCSV(path) {
  setStatus(`Loading ${path}...`);
  clearConstellation();

  const response = await fetch(path);
  if (!response.ok) throw new Error(`Could not load ${path}`);

  const text = await response.text();
  const rows = parseCSV(text);

  const scenarioInfo = await loadScenarioJson(path);
  renderConstellation(rows, scenarioInfo);
  diagnoseCoverageTimeSamples();

  redrawCountryBoundaries();

  if (!suppressScenarioCameraReframe) {
    if (isHorizonView) {
      setHorizonView();
    } else {
      setFullEarthView();
    }
  }

  draw2DMap();
}

async function loadPrincipalRun(run) {
  const requestId = ++principalLoadSequence;
  if (geographicIntroActive) stopGeographicIntro();
  geographicIntroGeneration += 1;
  geographicIntroActive = false;
  const regionChanged = activePrincipalRun?.region !== run.region;
  const geographicSwitch = !ambientPresentation && hasCompletedInitialRun && regionChanged &&
    visualizationMode === "3d" && !idleActive && !restoringPresentation;
  const initialSequence = !ambientPresentation && !hasCompletedInitialRun && visualizationMode === "3d" &&
    !idleActive && !restoringPresentation;
  const transitionFarDistance = GEOGRAPHIC_TRANSITION_DISTANCE;
  if (playbackBeforePrincipalLoad === null) playbackBeforePrincipalLoad = isPlaying;
  isPlaying = false;
  updatePlaybackButton();
  setStatus(`Loading Principal Run ${run.name}...`);
  try {
    const [csvResponse, jsonResponse] = await Promise.all([
    fetch(run.csvPath, { cache: "no-store" }),
    fetch(run.jsonPath, { cache: "no-store" })
    ]);
    if (!csvResponse.ok || !jsonResponse.ok) throw new Error(`Principal Run files unavailable: ${run.name}`);
    const [csvText, resultData] = await Promise.all([csvResponse.text(), jsonResponse.json()]);
    if (requestId !== principalLoadSequence) return;
    if (!["Optimal", "Time limit"].includes(run.resultStatus) ||
        resultData.result?.status !== run.resultStatus || resultData.run_name !== run.name) {
      throw new Error(`Principal Run metadata mismatch: ${run.name}`);
    }
    if (!(Number(resultData.sim?.horizon_s) > 0) ||
        !(Number(resultData.sim?.dt_s) > 0) ||
        Number(resultData.sim.dt_s) > Number(resultData.sim.horizon_s)) {
      throw new Error(`Principal Run simulation timing is invalid: ${run.name}`);
    }
    const rows = parseCSV(csvText);
    if (rows.length !== run.satellites) throw new Error(`Satellite count mismatch: ${run.name}`);
    const actualPlaneCount = countActualOrbitalPlanes(rows);
    if (actualPlaneCount !== run.actualPlanes) {
      throw new Error(`Principal Run orbital-plane count mismatch: ${run.name}`);
    }

    if (geographicSwitch) {
      document.body.dataset.geographicTransitionStage = "depart-constellation";
      setPlaneAnimationOrder(`geographic-departure:${run.region}`);
      await animateValue(850, progress => {
        if (requestId === principalLoadSequence) setCarouselSatelliteProgress(1 - progress);
      });
      if (requestId !== principalLoadSequence) return;
      document.body.dataset.geographicTransitionStage = "depart-sites";
      siteMarkerGroup.visible = false;
      hideSiteTooltip();
      await animateValue(160, () => {});
      if (requestId !== principalLoadSequence) return;
      document.body.dataset.geographicTransitionStage = "depart-fill";
      await animateValue(350, progress => {
        if (requestId === principalLoadSequence) setGroupOpacityFactor(focusCountryFillGroup, 1 - progress);
      });
      if (requestId !== principalLoadSequence) return;
      document.body.dataset.geographicTransitionStage = "depart-outline";
      await animateValue(530, progress => {
        if (requestId === principalLoadSequence) setCarouselOutlineProgress(1 - progress);
      });
      if (requestId !== principalLoadSequence) return;
      launchSitesActivated = true;
    }

    if (regionChanged && visualizationMode === "2d" && !restoringPresentation) {
      await depart2DScenario(requestId);
      if (requestId !== principalLoadSequence) return;
    }
    if (regionChanged) {
      stopRegionalMapIntro();
      cancelAnimationFrame(mapMorphFrame);
      mapProjectionMorphActive = false;
      mapTransitionCanvas.style.display = "none";
    }
    countrySelect.value = run.region;
    resetMapView();
    clearConstellation();
    // A denser map is crisp for normal constellations. Large solutions
    // already require much more satellite analysis per playback tick, so use
    // the original density to keep their 2D view responsive.
    const desiredMapCells = window.innerWidth <= 600 || rows.length > 10000
      ? 15000 : GLOBAL_TESSELLATION_POINT_COUNT;
    if (globalCellLatLon.length !== desiredMapCells) {
      globalCellLatLon = generateGlobalFibonacciCells(desiredMapCells);
    }
    await loadScenarioJson(run.csvPath, resultData);
    renderConstellation(rows);
    const displayedPlaneCount = trajectoryGroup.children.filter(child => child.visible).length;
    document.body.dataset.renderedTrajectoryCount = String(displayedPlaneCount);
    if (displayedPlaneCount !== planeModels.length) {
      throw new Error(`Rendered orbital-plane count mismatch: ${run.name}`);
    }
    activePrincipalRun = run;
    void refreshLaunchSiteNamesFromSheet(run.region, requestId);
    if (geographicSwitch) setPlaneAnimationOrder(`geographic-arrival:${run.region}`);
    if (regionChanged && visualizationMode === "2d" &&
        !restoringPresentation) mapCanvas.style.opacity = "0";
    redrawCountryBoundaries();
    if (visualizationMode === "3d" && !idleActive && !restoringPresentation &&
        !geographicSwitch && (!hasCompletedInitialRun || regionChanged)) setFullEarthView();
    draw2DMap();
    setStatus(`Loaded Principal Run ${run.name}. ${rows.length} satellites, ${displayedPlaneCount} displayed planes.`);
    document.dispatchEvent(new CustomEvent("principal-panel:run-loaded", {
      detail: { run, actualPlanes: actualPlaneCount, displayPlanes: displayedPlaneCount,
        awaitingPopulation: geographicSwitch || initialSequence }
    }));
    if (geographicSwitch) {
      document.body.dataset.geographicTransitionStage = "rotate-globe";
      geographicIntroActive = true;
      geographicIntroSiteCount = 0;
      globeSiteEntries.forEach(entry => { entry.revealedAtMs = null; });
      updateGlobeSiteDetail();
      setGroupOpacityFactor(constellationGroup, 0);
      setGroupOpacityFactor(trajectoryGroup, 0);
      setGroupOpacityFactor(focusCountryLineGroup, 0);
      setGroupOpacityFactor(focusCountryFillGroup, 0);
      await animateCameraToCurrentThreat(950, transitionFarDistance);
      if (requestId !== principalLoadSequence) return;
      alignCarouselInertialFrame();
      geographicIntroActive = false;
      siteMarkerGroup.visible = true;
      document.body.dataset.geographicTransitionStage = "geographic-intro";
      void runGeographicIntro(true);
    }
    else if (initialSequence) {
      launchSitesActivated = true;
      siteMarkerGroup.visible = true;
      void runGeographicIntro(false);
    }
    else if (regionChanged && visualizationMode === "2d" && !restoringPresentation) void runScenarioMapIntro();
    else updateGlobeSiteDetail();
    hasCompletedInitialRun = true;
  } finally {
    if (requestId === principalLoadSequence && !configurationPending &&
        playbackBeforePrincipalLoad !== null) {
      isPlaying = playbackBeforePrincipalLoad;
      playbackBeforePrincipalLoad = null;
      updatePlaybackButton();
    }
  }
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);

    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;

    return String(a).localeCompare(String(b));
  });
}

function fillSelect(select, values, formatter = value => value) {
  select.innerHTML = "";

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = formatter(v);
    select.appendChild(opt);
  });
}

function getSelectedScenario() {
  return manifest.find(r =>
    r.country === countrySelect.value &&
    r.interceptors === interceptorSelect.value &&
    r.salvo === salvoSelect.value
  );
}

async function loadSelectedScenario() {
  const row = getSelectedScenario();

  if (!row) {
    clearConstellation();
    setStatus("No matching scenario found.");
    return;
  }

  try {
    await loadCSV(row.path);
  } catch (err) {
    console.error(err);
    clearConstellation();
    setStatus(err.message);
  }
}

function refreshDropdowns(triggerLoad = true, resetLowerDropdowns = false) {
  const currentCountry = countrySelect.value;
  const currentInt = resetLowerDropdowns ? null : interceptorSelect.value;
  const currentSalvo = resetLowerDropdowns ? null : salvoSelect.value;

  fillSelect(
    countrySelect,
    uniqueSorted(manifest.map(r => r.country)),
    formatThreatRegionName
  );
  threatScenarioDetail.setScenarioOrder([...countrySelect.options].map(option => option.value));

  if (currentCountry) countrySelect.value = currentCountry;

  const countryRows = manifest.filter(r => r.country === countrySelect.value);

  const interceptorValues = uniqueSorted(countryRows.map(r => r.interceptors));
  fillSelect(interceptorSelect, interceptorValues);

  if (currentInt && interceptorValues.includes(currentInt)) {
    interceptorSelect.value = currentInt;
  } else if (interceptorValues.length > 0) {
    interceptorSelect.value = interceptorValues[0];
  }

  const intRows = countryRows.filter(r => r.interceptors === interceptorSelect.value);
  const salvoValues = uniqueSorted(intRows.map(r => r.salvo));

  fillSelect(salvoSelect, salvoValues);

  if (currentSalvo && salvoValues.includes(currentSalvo)) {
    salvoSelect.value = currentSalvo;
  } else if (salvoValues.length > 0) {
    salvoSelect.value = salvoValues[0];
  }

  redrawCountryBoundaries();

  if (triggerLoad) loadSelectedScenario();
}

async function loadManifest() {
  const res = await fetch(`manifest.json?refresh=${Date.now()}`, { cache: "no-store" });
  manifest = await res.json();

  refreshDropdowns(false, true);
  const previewParameters = new URLSearchParams(window.location.search);
  const requestedThreat = previewParameters.get("scenario") || "north-korea";
  if ([...countrySelect.options].some(option => option.value === requestedThreat)) {
    countrySelect.value = requestedThreat;
    refreshDropdowns(false, true);
  }
  document.dispatchEvent(new CustomEvent("legacy-scenario-selected", { detail: { region: countrySelect.value } }));
  setStatus(`Loaded manifest with ${manifest.length} CSV files.`);
  loadSelectedScenario();
  threatScenarioDetail.syncHeight();
  if (previewParameters.get("pane") === "scenario") threatScenarioDetail.open();
}

function getFocusVector(radius = 1) {
  return latLonToVector3(focusLatDeg, focusLonDeg, radius);
}

function getPresentedFocusVector(radius = 1) {
  presentationRoot.updateWorldMatrix(true, false);
  const orientation = presentationRoot.getWorldQuaternion(new THREE.Quaternion());
  return getFocusVector(radius).applyQuaternion(orientation);
}

function apply3DViewOffset() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  if (idleActive) {
    camera.zoom = PREFERRED_HORIZON_CONFIG.camera.zoom * carouselFraming.zoom;
    camera.setViewOffset(width, height, carouselFraming.offsetX, carouselFraming.offsetY, width, height);
    camera.updateProjectionMatrix();
    return;
  }

  if (width <= 600) {
    camera.zoom = 1;
    camera.setViewOffset(width, height, 0, Math.round(height * .15), width, height);
    camera.updateProjectionMatrix();
    return;
  }

  const ui = getUiBounds();

  const openAreaLeft = (idleActive || document.body.classList.contains("uiCollapsed")) ? 0 : Math.max(0, ui.right);
  const openAreaRight = width;
  const openAreaCenter = openAreaLeft + ((openAreaRight - openAreaLeft) / 2);
  const canvasCenter = width / 2;
  const shiftPixels = openAreaCenter - canvasCenter;

  camera.setViewOffset(
    width,
    height,
    -shiftPixels,
    0,
    width,
    height
  );

  camera.updateProjectionMatrix();
}

function clear3DViewOffset() {
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

function setFullEarthView() {
  const focus = getPresentedFocusVector(1);

  if (window.innerWidth <= 600) {
    camera.position.copy(focus.clone().multiplyScalar(4.8));
    camera.position.y += .4;
    camera.up.set(0, 1, 0);
    controls.target.set(0, -.08, 0);
    controls.update();
    apply3DViewOffset();
    isHorizonView = false;
    return;
  }

  // Slightly enlarge the initial globe and bias the framing upward so the
  // open visualization area has more visual presence beneath the controls.
  camera.position.copy(focus.clone().multiplyScalar(3.8));
  camera.up.set(0, 1, 0);

  controls.target.set(0, -0.06, 0);
  controls.update();

  apply3DViewOffset();

  isHorizonView = false;
}

function setHorizonView() {
  applyCameraConfiguration(PREFERRED_HORIZON_CONFIG, true);
}

// Approved China pose anchors the fixed carousel camera; normal Horizon View can align it to a selected region.
const PREFERRED_HORIZON_CONFIG = Object.freeze({
  version: 1,
  cameraMode: "horizon",
  scenario: "china",
  principalRun: "PREp-s100-d15-v6-g10-b170-k0-i4-261011a-87a5",
  focusVector: [-0.11899713357139566, 0.6547804331866927, -0.7463928365931967],
  camera: {
    position: [-0.2847663164633116, 0.5700104690972995, -2.1337076299843027],
    quaternion: [-0.18696114818164006, 0.9801262700857433, -0.04892885681557334, -0.04476595502312538],
    up: [-0.20524275374354584, 0.7192766046925371, 0.6637142291511777],
    target: [-0.16325533072647905, 0.7670884687146997, -0.39965357267804424],
    fov: 38, zoom: 1, near: 0.01, far: 1000,
    viewOffset: { enabled: true, fullWidth: 1094, fullHeight: 730,
      offsetX: -180, offsetY: 0, width: 1094, height: 730 }
  }
});

// The outer group tips geographic north toward (+) or away from (-) the fixed horizon camera.
// The inner group continues to spin around the Earth's own north-south axis.
const CAROUSEL_TILT_AXIS = new THREE.Vector3(0, 1, 0).cross(
  new THREE.Vector3().fromArray(PREFERRED_HORIZON_CONFIG.camera.position)
    .sub(new THREE.Vector3().fromArray(PREFERRED_HORIZON_CONFIG.camera.target)).normalize()
).normalize();

function applyEarthTilt(degrees) {
  presentationTiltDeg = degrees;
  presentationTiltRoot.quaternion.setFromAxisAngle(CAROUSEL_TILT_AXIS, THREE.MathUtils.degToRad(degrees));
}

function captureCameraConfiguration() {
  return {
    version: 1,
    cameraMode: isHorizonView ? "horizon" : "full-earth",
    focusVector: getFocusVector(1).toArray(),
    camera: {
      position: camera.position.toArray(),
      quaternion: camera.quaternion.toArray(),
      up: camera.up.toArray(),
      target: controls.target.toArray(),
      fov: camera.fov,
      zoom: camera.zoom,
      near: camera.near,
      far: camera.far
    }
  };
}

function applyCameraConfiguration(configuration, alignToCurrentScenario = false) {
  const source = configuration.camera;
  const position = new THREE.Vector3().fromArray(source.position);
  const target = new THREE.Vector3().fromArray(source.target);
  const up = new THREE.Vector3().fromArray(source.up);
  if (alignToCurrentScenario && configuration.focusVector) {
    const rotation = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3().fromArray(configuration.focusVector).normalize(),
      getFocusVector(1).normalize()
    );
    position.applyQuaternion(rotation);
    target.applyQuaternion(rotation);
    up.applyQuaternion(rotation);
  }
  camera.position.copy(position);
  camera.up.copy(up);
  controls.target.copy(target);
  camera.fov = Number(source.fov);
  camera.zoom = Number(source.zoom);
  camera.near = Number(source.near);
  camera.far = Number(source.far);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  controls.update();
  apply3DViewOffset();
  isHorizonView = configuration.cameraMode === "horizon";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function animateValue(durationMs, update) {
  const duration = prefersReducedMotion() ? 0 : durationMs;

  if (duration === 0) {
    update(1);
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const startedAt = performance.now();
    const frame = now => {
      const linear = Math.min(1, (now - startedAt) / duration);
      const eased = linear < 0.5
        ? 4 * linear * linear * linear
        : 1 - Math.pow(-2 * linear + 2, 3) / 2;
      update(eased);
      if (linear < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

function setGroupOpacityFactor(group, factor) {
  const clamped = Math.max(0, Math.min(1, factor));
  const materials = new Set();

  group.traverse(child => {
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    childMaterials.filter(Boolean).forEach(material => materials.add(material));
  });

  materials.forEach(material => {
    if (!Number.isFinite(material.userData.scenarioBaseOpacity)) {
      material.userData.scenarioBaseOpacity = material.opacity;
      material.userData.scenarioBaseDepthWrite = material.depthWrite;
    }
    material.transparent = true;
    material.opacity = material.userData.scenarioBaseOpacity * clamped;
    material.depthWrite = material.userData.scenarioBaseDepthWrite && material.opacity > .001;
    material.needsUpdate = true;
  });

  group.userData.scenarioOpacityFactor = clamped;
}

function fadeGroupTo(group, targetFactor, durationMs) {
  const startFactor = Number.isFinite(group.userData.scenarioOpacityFactor)
    ? group.userData.scenarioOpacityFactor
    : 1;

  return animateValue(durationMs, progress => {
    setGroupOpacityFactor(group, startFactor + (targetFactor - startFactor) * progress);
  });
}

function animateCameraToCurrentThreat(durationMs = 520, endDistance = 3.8) {
  const startTarget = controls.target.clone();
  const endTarget = new THREE.Vector3(0, -0.06, 0);
  const startOffset = camera.position.clone().sub(startTarget);
  const startDirection = startOffset.clone().normalize();
  const endDirection = getPresentedFocusVector(1).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(startDirection, endDirection);
  const identity = new THREE.Quaternion();
  const startDistance = startOffset.length();
  const startUp = camera.up.clone();
  const endUp = new THREE.Vector3(0, 1, 0);

  return animateValue(durationMs, progress => {
    const partialRotation = identity.clone().slerp(rotation, progress);
    const direction = startDirection.clone().applyQuaternion(partialRotation).normalize();
    const target = startTarget.clone().lerp(endTarget, progress);
    const distance = startDistance + (endDistance - startDistance) * progress;

    camera.position.copy(target).add(direction.multiplyScalar(distance));
    controls.target.copy(target);
    camera.up.copy(startUp).lerp(endUp, progress).normalize();
    camera.lookAt(target);
    apply3DViewOffset();
  });
}

function countryIntroCameraPosition(region = countrySelect.value) {
  const features = worldFeatures.filter(feature =>
    countryMatches(feature.properties?.name || "", region));
  if (!features.length) return getPresentedFocusVector(1.8);
  const [longitude, latitude] = geoCentroid({ type: "FeatureCollection", features });
  const center = latLonToVector3(latitude, longitude).normalize();
  let widestAngle = 0;
  features.forEach(feature => {
    const polygons = feature.geometry?.type === "MultiPolygon"
      ? feature.geometry.coordinates : [feature.geometry?.coordinates];
    polygons.filter(Boolean).forEach(polygon => polygon.forEach(ring => ring.forEach(([lon, lat]) => {
      const point = latLonToVector3(lat, lon).normalize();
      widestAngle = Math.max(widestAngle, Math.acos(THREE.MathUtils.clamp(center.dot(point), -1, 1)));
    })));
  });
  const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect * .68);
  const framingAngle = Math.min(halfVertical, halfHorizontal) * .78;
  const fitDistance = Math.cos(widestAngle) + Math.sin(widestAngle) / Math.tan(framingAngle);
  const horizonDistance = 1 / Math.cos(Math.min(widestAngle + THREE.MathUtils.degToRad(3),
    THREE.MathUtils.degToRad(82)));
  presentationRoot.updateWorldMatrix(true, false);
  return center.applyQuaternion(presentationRoot.getWorldQuaternion(new THREE.Quaternion()))
    .multiplyScalar(Math.min(8, Math.max(1.8, fitDistance, horizonDistance)));
}

async function runGeographicIntro(returnToNormalView = false) {
  if (visualizationMode !== "3d") return;
  const generation = ++geographicIntroGeneration;
  geographicIntroActive = true;
  geographicIntroSiteCount = 0;
  geographicIntroFade = 1;
  globeSiteEntries.forEach(entry => { entry.revealedAtMs = null; });
  updateGlobeSiteDetail();
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startUp = camera.up.clone();
  const endPosition = returnToNormalView ? getPresentedFocusVector(3.8) : startPosition.clone();
  const endTarget = returnToNormalView ? new THREE.Vector3(0, -0.06, 0) : startTarget.clone();
  const endUp = returnToNormalView ? new THREE.Vector3(0, 1, 0) : startUp.clone();
  setGroupOpacityFactor(constellationGroup, 0);
  setGroupOpacityFactor(trajectoryGroup, 0);
  setGroupOpacityFactor(focusCountryLineGroup, 1);
  setCarouselOutlineProgress(0);
  setGroupOpacityFactor(focusCountryFillGroup, 0);
  const closePosition = countryIntroCameraPosition();
  const origin = new THREE.Vector3();
  const upward = new THREE.Vector3(0, 1, 0);
  const move = (fromPosition, toPosition, fromTarget, toTarget, fromUp, toUp, duration, onProgress = null) => {
    const fromDirection = fromPosition.clone().normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(fromDirection, toPosition.clone().normalize());
    const identity = new THREE.Quaternion();
    const startDistance = fromPosition.length(), endDistance = toPosition.length();
    return animateValue(duration, progress => {
      if (generation !== geographicIntroGeneration) return;
      camera.position.copy(fromDirection).applyQuaternion(identity.clone().slerp(rotation, progress))
        .multiplyScalar(startDistance + (endDistance - startDistance) * progress);
      controls.target.copy(fromTarget).lerp(toTarget, progress);
      camera.up.copy(fromUp).lerp(toUp, progress).normalize();
      camera.lookAt(controls.target);
      apply3DViewOffset();
      onProgress?.(progress);
      updateGlobeSiteDetail();
    });
  };
  const active = () => generation === geographicIntroGeneration && visualizationMode === "3d";
  await move(startPosition, closePosition, startTarget, origin, startUp, upward,
    GEOGRAPHIC_INTRO_TIMING.globeZoomInMs);
  if (!active()) return;
  await animateValue(GEOGRAPHIC_INTRO_TIMING.globeOutlineMs, progress => {
    if (active()) setCarouselOutlineProgress(progress);
  });
  if (!active()) return;
  await animateValue(GEOGRAPHIC_INTRO_TIMING.globeFillMs, progress => {
    if (active()) setGroupOpacityFactor(focusCountryFillGroup, progress);
  });
  if (!active()) return;
  const siteStepMs = Math.max(GEOGRAPHIC_INTRO_TIMING.globeSiteStepMinMs,
    Math.min(GEOGRAPHIC_INTRO_TIMING.globeSiteStepMaxMs,
      2200 / Math.max(1, targetLatLon.length)));
  for (let index = 0; index < targetLatLon.length; index += 1) {
    if (!active()) return;
    geographicIntroSiteCount = index + 1;
    updateGlobeSiteDetail();
    await animateValue(siteStepMs, () => {});
  }
  if (!active()) return;
  await animateValue(GEOGRAPHIC_INTRO_TIMING.globeSiteHoldMs, () => {});
  if (!active()) return;
  await move(closePosition, endPosition, origin, endTarget, upward, endUp,
    GEOGRAPHIC_INTRO_TIMING.globeZoomOutMs,
    progress => { geographicIntroFade = 1 - progress; });
  if (!active()) return;
  setGroupOpacityFactor(constellationGroup, 1);
  setCarouselSatelliteProgress(0);
  alignCarouselInertialFrame();
  updateTrajectoryLines();
  updateSatellitePositions();
  document.body.dataset.geographicTransitionStage = "orbit-reveal";
  await animateValue(GEOGRAPHIC_INTRO_TIMING.globeOrbitRevealMs, progress => {
    if (active()) setCarouselSatelliteProgress(progress);
  });
  if (!active()) return;
  geographicIntroActive = false;
  geographicIntroSiteCount = 0;
  geographicIntroFade = 1;
  globeSiteEntries.forEach(entry => { entry.darkPulseStartedAtMs = performance.now(); });
  updateGlobeSiteDetail();
  delete document.body.dataset.geographicTransitionStage;
  document.dispatchEvent(new CustomEvent("principal-panel:population-complete", {
    detail: { name: activePrincipalRun?.name }
  }));
}

function stopGeographicIntro() {
  if (!geographicIntroActive) return;
  geographicIntroGeneration += 1;
  geographicIntroActive = false;
  geographicIntroSiteCount = 0;
  geographicIntroFade = 1;
  globeSiteEntries.forEach(entry => { entry.darkPulseStartedAtMs = performance.now(); });
  setGroupOpacityFactor(constellationGroup, 1);
  setGroupOpacityFactor(trajectoryGroup, 1);
  setCarouselSatelliteProgress(1);
  setGroupOpacityFactor(focusCountryLineGroup, 1);
  setCarouselOutlineProgress(1);
  setGroupOpacityFactor(focusCountryFillGroup, 1);
  updateGlobeSiteDetail();
  delete document.body.dataset.geographicTransitionStage;
  document.dispatchEvent(new CustomEvent("principal-panel:population-complete", {
    detail: { name: activePrincipalRun?.name }
  }));
}

function markThreatTransitionStage(audit, name) {
  audit.stages.push({ name, atMs: Math.round(performance.now() - audit.startedAt) });
}

async function runThreatScenarioTransition(threatRegion) {
  if (!threatRegion || countrySelect.value === threatRegion) return;

  const audit = {
    from: countrySelect.value,
    to: threatRegion,
    startedAt: performance.now(),
    stages: []
  };
  window.__scenarioTransitionAudit = audit;
  const resumePlayback = isPlaying;
  const controlsWereEnabled = controls.enabled;
  isPlaying = false;
  controls.enabled = false;
  updatePlaybackButton();

  if (visualizationMode === "2d") {
    if (mapGeographicView === "regional") captureMapTransition();
    countrySelect.value = threatRegion;
    document.dispatchEvent(new CustomEvent("legacy-scenario-selected", { detail: { region: threatRegion } }));
    refreshDropdowns(false, true);
    clearConstellation();
    resetMapView();
    draw2DMap();
    await loadSelectedScenario();
    controls.enabled = controlsWereEnabled;
    isPlaying = resumePlayback;
    updatePlaybackButton();
    audit.completedAtMs = Math.round(performance.now() - audit.startedAt);
    return;
  }

  markThreatTransitionStage(audit, "old-constellation-fade-start");
  await Promise.all([
    fadeGroupTo(constellationGroup, 0, 240),
    fadeGroupTo(trajectoryGroup, 0, 240)
  ]);
  markThreatTransitionStage(audit, "old-constellation-hidden");
  await fadeGroupTo(focusCountryLineGroup, 0, 180);
  markThreatTransitionStage(audit, "old-country-hidden");

  hideNewScenarioVisuals = true;
  suppressScenarioCameraReframe = true;
  countrySelect.value = threatRegion;
  document.dispatchEvent(new CustomEvent("legacy-scenario-selected", { detail: { region: threatRegion } }));
  refreshDropdowns(false, true);
  clearConstellation();
  await loadSelectedScenario();
  isPlaying = false;
  setGroupOpacityFactor(constellationGroup, 0);
  setGroupOpacityFactor(trajectoryGroup, 0);
  setGroupOpacityFactor(focusCountryLineGroup, 0);
  markThreatTransitionStage(audit, "new-scenario-loaded-hidden");

  await animateCameraToCurrentThreat(540);
  isHorizonView = false;
  markThreatTransitionStage(audit, "globe-rotation-complete");

  hideNewScenarioVisuals = false;
  await fadeGroupTo(focusCountryLineGroup, 1, 220);
  markThreatTransitionStage(audit, "country-highlight-visible");
  await Promise.all([
    fadeGroupTo(constellationGroup, 1, 320),
    fadeGroupTo(trajectoryGroup, 1, 320)
  ]);
  markThreatTransitionStage(audit, "constellation-visible");

  suppressScenarioCameraReframe = false;
  controls.enabled = controlsWereEnabled;
  isPlaying = resumePlayback;
  updatePlaybackButton();
  audit.completedAtMs = Math.round(performance.now() - audit.startedAt);
}

function transitionThreatScenario(threatRegion) {
  if (threatScenarioTransitionPromise) return threatScenarioTransitionPromise;
  const resumePlayback = isPlaying;
  const controlsWereEnabled = controls.enabled;
  threatScenarioTransitionPromise = runThreatScenarioTransition(threatRegion)
    .catch(error => {
      console.error(error);
      hideNewScenarioVisuals = false;
      suppressScenarioCameraReframe = false;
      controls.enabled = controlsWereEnabled;
      isPlaying = resumePlayback;
      updatePlaybackButton();
      setGroupOpacityFactor(focusCountryLineGroup, 1);
      setGroupOpacityFactor(constellationGroup, 1);
      setGroupOpacityFactor(trajectoryGroup, 1);
    })
    .finally(() => {
      threatScenarioTransitionPromise = null;
    });
  return threatScenarioTransitionPromise;
}

function toggleView() {
  if (isHorizonView) {
    setFullEarthView();
  } else {
    setHorizonView();
  }
}

function zoomCamera(factor) {
  if (visualizationMode === "2d") {
    zoom2DMap(1 / factor);
    return;
  }

  const direction = camera.position.clone().sub(controls.target);
  direction.multiplyScalar(factor);
  camera.position.copy(controls.target.clone().add(direction));
  controls.update();
}

countrySelect.addEventListener("change", () => {
  if (visualizationMode === "2d" && mapGeographicView === "regional") captureMapTransition();
  clearConstellation();
  refreshDropdowns(true, true);
  if (visualizationMode === "2d" && mapGeographicView === "regional") {
    resetMapView();
    draw2DMap();
  }
});

interceptorSelect.addEventListener("change", () => {
  clearConstellation();
  loadSelectedScenario();
});

salvoSelect.addEventListener("change", () => {
  clearConstellation();
  loadSelectedScenario();
});

zoomInBtn.addEventListener("click", () => visualizationMode === "2d" ? setMapGeographicView("regional") : zoomCamera(0.82));
zoomOutBtn.addEventListener("click", () => visualizationMode === "2d" ? setMapGeographicView("global") : zoomCamera(1.22));
viewToggleBtn.addEventListener("click", () => setVisualizationMode(visualizationMode === "3d" ? "2d" : "3d"));

playBtn.addEventListener("click", () => {
  isPlaying = !isPlaying;
  updatePlaybackButton();
});

speedDownBtn.addEventListener("click", () => setPlaybackMultiplier(Math.max(0.25, playbackMultiplier - 0.5)));
speedUpBtn.addEventListener("click", () => setPlaybackMultiplier(Math.min(4.0, playbackMultiplier + 0.5)));

if (timelineSlider) {
  timelineSlider.addEventListener("input", () => {
    isPlaying = false;
    updatePlaybackButton();

    const targetSeconds = Number(timelineSlider.value) * SECONDS_PER_HOUR;

    simulationSeconds = targetSeconds;
    advanceEarthPresentationToSimulationTime();
    updateSceneForTime(false, false, visualizationMode === "2d");

    fillCoverageHistoryToTime(targetSeconds);
  });
}

if (mapCanvas) {
  mapCanvas.addEventListener("wheel", event => {
    if (visualizationMode !== "2d") return;

    event.preventDefault();

    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoom2DMap(factor, event.clientX, event.clientY);
  }, { passive: false });

  mapCanvas.addEventListener("pointerdown", event => {
    if (visualizationMode !== "2d") return;

    mapCanvas.setPointerCapture(event.pointerId);
    mapCanvas.classList.add("dragging");

    isMapDragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragStartPanX = mapPanX;
    dragStartPanY = mapPanY;
  });

  mapCanvas.addEventListener("pointermove", event => {
    if (visualizationMode !== "2d" || !isMapDragging) return;

    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;

    if (mapZoom <= 1.0001) return;

    mapPanX = dragStartPanX + dx;
    mapPanY = dragStartPanY + dy;

    mapNeedsGeometryRebuild = true;
    draw2DMap();
  });

  mapCanvas.addEventListener("pointerup", event => {
    if (mapCanvas.hasPointerCapture(event.pointerId)) {
      mapCanvas.releasePointerCapture(event.pointerId);
    }

    isMapDragging = false;
    mapCanvas.classList.remove("dragging");
  });

  mapCanvas.addEventListener("pointercancel", event => {
    if (mapCanvas.hasPointerCapture(event.pointerId)) {
      mapCanvas.releasePointerCapture(event.pointerId);
    }

    isMapDragging = false;
    mapCanvas.classList.remove("dragging");
  });

  mapCanvas.addEventListener("touchstart", event => {
    if (visualizationMode !== "2d" || event.touches.length !== 2) return;

    const [a, b] = event.touches;
    pinchStartDistance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchStartZoom = mapZoom;
    pinchStartPanX = mapPanX;
    pinchStartPanY = mapPanY;
    pinchCenterX = (a.clientX + b.clientX) / 2;
    pinchCenterY = (a.clientY + b.clientY) / 2;
  }, { passive: true });

  mapCanvas.addEventListener("touchmove", event => {
    if (visualizationMode !== "2d" || event.touches.length !== 2 || pinchStartDistance <= 0) {
      return;
    }

    event.preventDefault();

    const [a, b] = event.touches;
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const factor = distance / pinchStartDistance;
    const previousZoom = mapZoom;
    const nextZoom = Math.max(1, Math.min(8, pinchStartZoom * factor));

    mapPanX = pinchCenterX - ((pinchCenterX - pinchStartPanX) * nextZoom / pinchStartZoom);
    mapPanY = pinchCenterY - ((pinchCenterY - pinchStartPanY) * nextZoom / pinchStartZoom);
    mapZoom = nextZoom;

    if (mapZoom <= 1.0001) {
      mapPanX = 0;
      mapPanY = 0;
    }

    if (previousZoom !== mapZoom) {
      mapNeedsGeometryRebuild = true;
      draw2DMap();
    }
  }, { passive: false });
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (!isHorizonView && visualizationMode === "3d") {
    setFullEarthView();
  } else {
    camera.updateProjectionMatrix();
  }

  resetMapView();
  mapNeedsGeometryRebuild = true;
  drawCoverageChart();
  draw2DMap();
});

setStats(null, null);
resetCoverageHistory();
setPlaybackMultiplier(1.0);
updatePlaybackButton();
updateCoverageLegendMax();

makeFallbackEarth();
loadWorldBoundaries();
setFullEarthView();
setVisualizationMode("3d");
fillSelect(countrySelect, ["north-korea", "iran", "china", "russia"], formatThreatRegionName);
countrySelect.value = new URLSearchParams(location.search).get("scenario") || "north-korea";
threatScenarioDetail.setScenarioOrder([...countrySelect.options].map(option => option.value));
threatScenarioDetail.syncHeight();
if (new URLSearchParams(location.search).get("pane") === "scenario") threatScenarioDetail.open();

const IDLE_DELAY_MS = 45000;
const ambientPresentation = new URLSearchParams(location.search).get("ambient") === "carousel";
if (ambientPresentation) {
  document.body.classList.add("ambientPresentation");
  document.addEventListener("principal-panel:run-loaded", () => {
    requestAnimationFrame(() => void enterIdleMode(true));
  }, { once: true });
}
const IDLE_SCENARIOS = ["north-korea", "iran", "china", "russia"];
let pointerHeld = false;

function capturePresentationState() {
  return {
    runName: activePrincipalRun.name,
    viewMode: visualizationMode,
    geographicView: mapGeographicView,
    mapZoom, mapPanX, mapPanY,
    camera: captureCameraConfiguration(),
    rootRotation: presentationRoot.rotation.y,
    rootTiltDeg: presentationTiltDeg,
    controlsEnabled: controls.enabled,
    dampingEnabled: controls.enableDamping,
    playing: isPlaying
  };
}

async function restorePresentationState(prior) {
  if (!prior) return;
  restoringPresentation = true;
  try {
    await principalLoadPromise;
    if (activePrincipalRun?.name !== prior.runName) {
      document.dispatchEvent(new CustomEvent("principal-panel:request-run", { detail: { name: prior.runName } }));
      await principalLoadPromise;
    }
    presentationRoot.rotation.y = prior.rootRotation;
    applyEarthTilt(prior.rootTiltDeg ?? 0);
    siteMarkerGroup.visible = launchSitesActivated;
    setVisualizationMode(prior.viewMode);
    if (prior.viewMode === "2d") {
      mapGeographicView = prior.geographicView;
      mapZoom = prior.mapZoom;
      mapPanX = prior.mapPanX;
      mapPanY = prior.mapPanY;
      mapNeedsGeometryRebuild = true;
      updateMapControlLabels();
      draw2DMap();
    } else {
      applyCameraConfiguration(prior.camera);
      updateGlobeSiteDetail();
    }
    controls.enabled = prior.controlsEnabled;
    controls.enableDamping = prior.dampingEnabled;
    isPlaying = prior.playing;
    updatePlaybackButton();
  } finally {
    restoringPresentation = false;
  }
}

function applyCarouselCamera() {
  controls.enabled = false;
  controls.enableDamping = false;
  applyCameraConfiguration(PREFERRED_HORIZON_CONFIG, false);
  if (satellitePointCloud) {
    satellitePointCloud.material.size = markerSizeForCurrentRun(true);
    document.body.dataset.satelliteMarkerSizePx = String(satellitePointCloud.material.size);
  }
  siteMarkerGroup.visible = false;
  hideSiteTooltip();
}

function alignCarouselInertialFrame() {
  presentationRoot.updateWorldMatrix(true, false);
  presentationRoot.getWorldQuaternion(carouselInertialRoot.quaternion);
  // Reanchor after deliberate camera/globe reframing while preserving the
  // Earth-fixed phase used by the raw coverage calculation at this instant.
  carouselInertialRoot.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), -EARTH_ROTATION_RATE_RAD_PER_SEC * simulationSeconds));
  earthPresentationTimeSeconds = simulationSeconds;
}

function advanceEarthPresentationToSimulationTime() {
  // Equal and opposite to rotateAnalyticalVectorToEarthFixed: active colors,
  // launch sites, and the displayed constellation now share one timebase.
  const elapsedSimulationSeconds = simulationSeconds - earthPresentationTimeSeconds;
  earthPresentationTimeSeconds = simulationSeconds;
  document.body.dataset.simulationSeconds = simulationSeconds.toFixed(3);
  const stage = document.body.dataset.carouselStage;
  const geographicStage = document.body.dataset.geographicTransitionStage;
  const orientationTransition = (geographicIntroActive && geographicStage !== "orbit-reveal") ||
    (Boolean(geographicStage) && geographicStage !== "orbit-reveal") ||
    ["enter-camera", "rotate"].includes(stage);
  const carouselEarthCanSpin = !idleActive || ["reveal-satellites", "dwell",
    "depart-satellites", "depart-sites", "depart-fill", "depart-outline"].includes(stage);
  if (visualizationMode !== "3d" || !carouselInertialAttached ||
      orientationTransition || !carouselEarthCanSpin || !elapsedSimulationSeconds) return;
  const populationReveal = geographicStage === "orbit-reveal";
  const followThreat = !idleActive && (!geographicIntroActive || populationReveal) &&
    (!geographicStage || populationReveal) &&
    !restoringPresentation && !suppressScenarioCameraReframe;
  let before = null;
  if (followThreat) {
    presentationRoot.updateWorldMatrix(true, false);
    before = presentationRoot.getWorldQuaternion(new THREE.Quaternion());
  }
  presentationRoot.rotation.y += EARTH_ROTATION_RATE_RAD_PER_SEC * elapsedSimulationSeconds;
  if (before) {
    presentationRoot.updateWorldMatrix(true, false);
    const cameraTurn = presentationRoot.getWorldQuaternion(new THREE.Quaternion())
      .multiply(before.invert());
    camera.position.applyQuaternion(cameraTurn);
    controls.target.applyQuaternion(cameraTurn);
    camera.up.applyQuaternion(cameraTurn);
    camera.lookAt(controls.target);
  }
  document.body.dataset.earthSpinYaw = presentationRoot.rotation.y.toFixed(6);
}

function attachCarouselInertialFrame() {
  if (carouselInertialAttached) return;
  alignCarouselInertialFrame();
  carouselInertialRoot.add(trajectoryGroup, constellationGroup);
  carouselInertialAttached = true;
  document.body.dataset.orbitFrame = "eci";
}

function detachCarouselInertialFrame() {
  if (!carouselInertialAttached) return;
  presentationRoot.add(trajectoryGroup, constellationGroup);
  carouselInertialRoot.quaternion.identity();
  carouselInertialAttached = false;
  document.body.dataset.orbitFrame = "earth-fixed";
}

async function transitionToCarouselCamera(view, stillActive) {
  const source = PREFERRED_HORIZON_CONFIG.camera;
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startUp = camera.up.clone();
  const endPosition = new THREE.Vector3().fromArray(source.position);
  const endTarget = new THREE.Vector3().fromArray(source.target);
  const endUp = new THREE.Vector3().fromArray(source.up);
  const startFov = camera.fov, startZoom = camera.zoom;
  const startOffsetX = camera.view?.enabled ? camera.view.offsetX : 0;
  const startOffsetY = camera.view?.enabled ? camera.view.offsetY : 0;
  const startYaw = presentationRoot.rotation.y;
  const yawDelta = Math.atan2(Math.sin(view.yawRad - startYaw),
    Math.cos(view.yawRad - startYaw));
  const startTilt = presentationTiltDeg;
  const startPlaybackMultiplier = currentPlaybackMultiplier;
  controls.enabled = false;
  controls.enableDamping = false;
  hideSiteTooltip();
  await animateValue(CAROUSEL_TIMING.entryCameraMs, progress => {
    if (!stillActive()) return;
    currentPlaybackMultiplier = startPlaybackMultiplier +
      (CAROUSEL_PLAYBACK_MULTIPLIER - startPlaybackMultiplier) * progress;
    camera.position.copy(startPosition).lerp(endPosition, progress);
    controls.target.copy(startTarget).lerp(endTarget, progress);
    camera.up.copy(startUp).lerp(endUp, progress).normalize();
    camera.fov = startFov + (source.fov - startFov) * progress;
    camera.zoom = startZoom + (source.zoom * view.zoom - startZoom) * progress;
    presentationRoot.rotation.y = startYaw + yawDelta * progress;
    applyEarthTilt(startTilt + (view.tiltDeg - startTilt) * progress);
    alignCarouselInertialFrame();
    camera.setViewOffset(window.innerWidth, window.innerHeight,
      startOffsetX + (view.offsetX - startOffsetX) * progress,
      startOffsetY + (view.offsetY - startOffsetY) * progress,
      window.innerWidth, window.innerHeight);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (satellitePointCloud) {
      satellitePointCloud.material.size = markerSizeForCurrentRun() +
        (markerSizeForCurrentRun(true) - markerSizeForCurrentRun()) * progress;
      document.body.dataset.satelliteMarkerSizePx = satellitePointCloud.material.size.toFixed(2);
    }
    trajectoryObjects.forEach(({ mesh }) => {
      mesh.material.opacity = .24 + (CAROUSEL_TRAJECTORY_OPACITY - .24) * progress;
    });
  });
  if (!stillActive()) return;
  carouselFraming.offsetX = view.offsetX;
  carouselFraming.offsetY = view.offsetY;
  carouselFraming.zoom = view.zoom;
  isHorizonView = true;
}

async function returnFromCarouselCamera() {
  const startPosition = camera.position.clone();
  const startTarget = controls.target.clone();
  const startUp = camera.up.clone();
  const endPosition = getPresentedFocusVector(3.8);
  const endTarget = new THREE.Vector3(0, -0.06, 0);
  const endUp = new THREE.Vector3(0, 1, 0);
  const startFov = camera.fov, startZoom = camera.zoom;
  const startOffsetX = camera.view?.enabled ? camera.view.offsetX : 0;
  const startOffsetY = camera.view?.enabled ? camera.view.offsetY : 0;
  const uiPanel = document.getElementById("ui");
  const endOffsetX = -Math.max(0, uiPanel.offsetLeft + uiPanel.offsetWidth) / 2;
  const startPlaybackMultiplier = currentPlaybackMultiplier;
  const initialSatellites = Math.min(satObjects.length,
    satellitePointCloud?.geometry.drawRange.count ?? satObjects.length);
  const startSatelliteProgress = satObjects.length ? initialSatellites / satObjects.length : 1;
  const fillStart = focusCountryFillGroup.userData.scenarioOpacityFactor ?? 1;
  const outlineOpacityStart = focusCountryLineGroup.userData.scenarioOpacityFactor ?? 1;
  const constellationOpacityStart = constellationGroup.userData.scenarioOpacityFactor ?? 1;
  const outlines = focusCountryLineGroup.children.filter(child => child.geometry);
  const totalOutlineIndices = outlines.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? 0), 0);
  const shownOutlineIndices = outlines.reduce((sum, mesh) => sum + Math.min(
    mesh.geometry.drawRange.count, mesh.geometry.index?.count ?? 0), 0);
  const outlineStart = totalOutlineIndices ? shownOutlineIndices / totalOutlineIndices : 1;
  setCarouselStage("exit-camera");
  await animateValue(CAROUSEL_TIMING.entryCameraMs, progress => {
    currentPlaybackMultiplier = startPlaybackMultiplier +
      (playbackMultiplier - startPlaybackMultiplier) * progress;
    camera.position.copy(startPosition).lerp(endPosition, progress);
    controls.target.copy(startTarget).lerp(endTarget, progress);
    camera.up.copy(startUp).lerp(endUp, progress).normalize();
    camera.fov = startFov + (38 - startFov) * progress;
    camera.zoom = startZoom + (1 - startZoom) * progress;
    camera.setViewOffset(window.innerWidth, window.innerHeight,
      startOffsetX + (endOffsetX - startOffsetX) * progress,
      startOffsetY * (1 - progress), window.innerWidth, window.innerHeight);
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    if (satellitePointCloud) {
      satellitePointCloud.material.size = markerSizeForCurrentRun(true) +
        (markerSizeForCurrentRun() - markerSizeForCurrentRun(true)) * progress;
      document.body.dataset.satelliteMarkerSizePx = satellitePointCloud.material.size.toFixed(2);
    }
    setCarouselSatelliteProgress(startSatelliteProgress + (1 - startSatelliteProgress) * progress);
    setCarouselOutlineProgress(outlineStart + (1 - outlineStart) * progress);
    setGroupOpacityFactor(focusCountryLineGroup, outlineOpacityStart + (1 - outlineOpacityStart) * progress);
    setGroupOpacityFactor(focusCountryFillGroup, fillStart + (1 - fillStart) * progress);
    setGroupOpacityFactor(constellationGroup, constellationOpacityStart + (1 - constellationOpacityStart) * progress);
    trajectoryObjects.forEach(({ mesh }) => {
      mesh.material.opacity = (mesh.material.userData.scenarioBaseOpacity ?? .24) *
        (CAROUSEL_TRAJECTORY_OPACITY + (.24 - CAROUSEL_TRAJECTORY_OPACITY) * progress) / .24;
    });
  });
  isHorizonView = false;
}

function setCarouselFrame(view) {
  carouselFraming.offsetX = view.offsetX;
  carouselFraming.offsetY = view.offsetY;
  carouselFraming.zoom = view.zoom;
  apply3DViewOffset();
}

function targetCarouselYaw() {
  const [x, , z] = PREFERRED_HORIZON_CONFIG.focusVector;
  const baseLongitude = Math.atan2(-z, x);
  return baseLongitude - THREE.MathUtils.degToRad(focusLonDeg);
}

async function rotateCarouselToCurrentRegion(durationMs, stillActive) {
  const target = carouselViews[countrySelect.value];
  const startYaw = presentationRoot.rotation.y;
  const requestedYaw = target.yawRad ?? targetCarouselYaw();
  const delta = Math.atan2(Math.sin(requestedYaw - startYaw), Math.cos(requestedYaw - startYaw));
  const startTilt = presentationTiltDeg;
  const startFrame = { ...carouselFraming };
  await animateValue(durationMs, progress => {
    if (!stillActive()) return;
    presentationRoot.rotation.y = startYaw + delta * progress;
    applyEarthTilt(startTilt + (target.tiltDeg - startTilt) * progress);
    carouselFraming.offsetX = startFrame.offsetX + (target.offsetX - startFrame.offsetX) * progress;
    carouselFraming.offsetY = startFrame.offsetY + (target.offsetY - startFrame.offsetY) * progress;
    carouselFraming.zoom = startFrame.zoom + (target.zoom - startFrame.zoom) * progress;
    apply3DViewOffset();
  });
}

function setCarouselOutlineProgress(progress) {
  const meshes = focusCountryLineGroup.children.filter(child => child.geometry);
  const counts = meshes.map(mesh => mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0);
  let remaining = Math.floor(counts.reduce((sum, count) => sum + count, 0) * Math.max(0, Math.min(1, progress)) / 2) * 2;
  meshes.forEach((mesh, index) => {
    const count = Math.floor(Math.max(0, Math.min(counts[index], remaining)) / 2) * 2;
    mesh.geometry.setDrawRange(0, count);
    remaining -= count;
  });
}

function setPlaneAnimationOrder(phase) {
  const count = planeSatelliteIndices.length;
  if (!count || !satellitePointCloud) return;
  const order = Array.from({ length: count }, (_, index) => index);
  const key = `${activePrincipalRun?.name || "scenario"}:${phase}`;
  let state = 2166136261;
  for (const character of key) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
  for (let index = count - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  planeAnimationOrder = order;
  satellitePointCloud.geometry.setIndex(order.flatMap(index => planeSatelliteIndices[index]));
  satellitePointCloud.geometry.setDrawRange(0, satObjects.length);
  document.body.dataset.planeAnimationOrder = order.slice(0, 12).join(",");
}

function setCarouselSatelliteProgress(progress) {
  const planeProgress = Math.max(0, Math.min(1, progress)) * trajectoryObjects.length;
  let visibleSatellites = 0;
  const order = planeAnimationOrder.length === trajectoryObjects.length
    ? planeAnimationOrder : trajectoryObjects.map((_, index) => index);
  order.forEach((planeIndex, revealIndex) => {
    const mesh = trajectoryObjects[planeIndex].mesh;
    const fraction = Math.max(0, Math.min(1, planeProgress - revealIndex));
    mesh.visible = fraction > 0;
    const baseOpacity = idleActive && document.body.dataset.carouselStage !== "enter-camera"
      ? CAROUSEL_TRAJECTORY_OPACITY : (mesh.material.userData.scenarioBaseOpacity ?? .24);
    mesh.material.opacity = baseOpacity * fraction;
    mesh.material.depthWrite = fraction > .02;
    visibleSatellites += Math.floor((planeSatelliteCounts[planeIndex] || 0) * fraction);
  });
  if (satellitePointCloud) satellitePointCloud.geometry.setDrawRange(0, visibleSatellites);
  document.body.dataset.carouselVisiblePlanes = String(trajectoryObjects.filter(({ mesh }) => mesh.visible).length);
  document.body.dataset.carouselVisibleSatellites = String(visibleSatellites);
}

function prepareCarouselScene() {
  setGroupOpacityFactor(constellationGroup, 1);
  setCarouselSatelliteProgress(0);
  setCarouselOutlineProgress(0);
  setGroupOpacityFactor(focusCountryFillGroup, 0);
  carouselPulseStartMs = null;
  carouselSiteOpacity = 0;
  updateCarouselSiteEffects(performance.now());
}

function restoreCarouselScene() {
  setGroupOpacityFactor(constellationGroup, 1);
  setCarouselSatelliteProgress(1);
  setCarouselOutlineProgress(1);
  setGroupOpacityFactor(focusCountryFillGroup, 1);
  setGroupOpacityFactor(focusCountryLineGroup, 1);
  carouselPulseStartMs = null;
  carouselSiteOpacity = 1;
  updateCarouselSiteEffects(performance.now());
}

function setCarouselStage(stage) {
  document.body.dataset.carouselStage = stage;
}

async function showNextIdleScenario(generation) {
  if (!idleActive || generation !== idleGeneration) return;
  const active = () => idleActive && generation === idleGeneration;
  const firstScenario = !idleHasPresentedScenario;
  if (!firstScenario) {
    setCarouselStage("depart-satellites");
    setPlaneAnimationOrder(`carousel-departure:${countrySelect.value}`);
    await animateValue(CAROUSEL_TIMING.satelliteDepartureMs, progress => { if (active()) setCarouselSatelliteProgress(1 - progress); });
    if (!active()) return;
    setCarouselStage("depart-sites");
    await animateValue(CAROUSEL_TIMING.siteDepartureMs, progress => {
      if (!active()) return;
      carouselSiteOpacity = 1 - progress;
      updateCarouselSiteEffects(performance.now());
    });
    if (!active()) return;
    carouselPulseStartMs = null;
    updateCarouselSiteEffects(performance.now());
    setCarouselStage("depart-fill");
    await animateValue(CAROUSEL_TIMING.fillDepartureMs, progress => { if (active()) setGroupOpacityFactor(focusCountryFillGroup, 1 - progress); });
    if (!active()) return;
    setCarouselStage("depart-outline");
    await animateValue(CAROUSEL_TIMING.outlineDepartureMs, progress => { if (active()) setCarouselOutlineProgress(1 - progress); });
    if (!active()) return;
  }
  const region = IDLE_SCENARIOS[idleScenarioIndex % IDLE_SCENARIOS.length];
  idleScenarioIndex += 1;
  idleHasPresentedScenario = true;
  setCarouselStage("load");
  hideNewScenarioVisuals = true;
  suppressScenarioCameraReframe = true;
  document.dispatchEvent(new CustomEvent("principal-panel:request-region", { detail: { region, forceDefault: true } }));
  await principalLoadPromise;
  hideNewScenarioVisuals = false;
  if (!active()) return;
  if (activePrincipalRun?.region !== region) {
    setCarouselStage("load-error");
    idleCarouselTimer = window.setTimeout(() => showNextIdleScenario(generation), 1200);
    return;
  }
  launchSitesActivated = true;
  setPlaneAnimationOrder(`carousel-arrival:${region}`);
  prepareCarouselScene();
  setCarouselStage("rotate");
  await rotateCarouselToCurrentRegion(firstScenario
    ? (idleEntryAligned ? 0 : CAROUSEL_TIMING.initialRotationMs)
    : CAROUSEL_TIMING.rotationMs, active);
  if (!active()) return;
  alignCarouselInertialFrame();
  setCarouselStage("trace-outline");
  setGroupOpacityFactor(focusCountryLineGroup, 1);
  await animateValue(CAROUSEL_TIMING.outlineTraceMs, progress => { if (active()) setCarouselOutlineProgress(progress); });
  if (!active()) return;
  setCarouselStage("fill-country");
  await animateValue(CAROUSEL_TIMING.countryFillMs, progress => { if (active()) setGroupOpacityFactor(focusCountryFillGroup, progress); });
  if (!active()) return;
  setCarouselStage("stamp-sites");
  carouselSiteOpacity = 1;
  carouselSiteSettledFraction = 0;
  startCarouselSitePulse();
  const siteRevealDuration = ambientPresentation ? 0 : Math.max(CAROUSEL_TIMING.sitePulseMs,
    (carouselSiteEntries.length - 1) * carouselSiteStaggerMs + CAROUSEL_TIMING.sitePulseMs);
  await animateValue(siteRevealDuration, () => {});
  if (prefersReducedMotion()) {
    carouselPulseStartMs = performance.now() - siteRevealDuration;
    updateCarouselSiteEffects(performance.now());
  }
  if (!active()) return;
  setCarouselStage("settle-sites");
  carouselSiteSettledAtMs = performance.now();
  await animateValue(ambientPresentation ? 0 : CAROUSEL_TIMING.siteSettleMs, progress => {
    if (!active()) return;
    carouselSiteSettledFraction = progress;
    updateCarouselSiteEffects(performance.now());
  });
  if (!active()) return;
  setCarouselStage("reveal-satellites");
  alignCarouselInertialFrame();
  updateTrajectoryLines();
  updateSatellitePositions();
  await animateValue(CAROUSEL_TIMING.satelliteRevealMs, progress => { if (active()) setCarouselSatelliteProgress(progress); });
  if (!active()) return;
  setCarouselStage("dwell");
  idleCarouselTimer = window.setTimeout(() => showNextIdleScenario(generation), CAROUSEL_TIMING.dwellMs);
}

let manualIdleGraceUntil = 0;
async function enterIdleMode(manual = false) {
  if (idleActive || pointerHeld || !activePrincipalRun || (!manual && document.hidden)) {
    scheduleIdleMode();
    return;
  }
  stopGeographicIntro();
  stopRegionalMapIntro();
  idleSession = capturePresentationState();
  isPlaying = true;
  updatePlaybackButton();
  const smoothEntry = idleSession.viewMode === "3d";
  const startRegion = smoothEntry && IDLE_SCENARIOS.includes(activePrincipalRun.region)
    ? activePrincipalRun.region : IDLE_SCENARIOS[0];
  idleActive = true;
  manualIdleGraceUntil = manual ? performance.now() + CAROUSEL_TIMING.manualMovementGraceMs : 0;
  const generation = ++idleGeneration;
  document.body.classList.add("idleMode");
  document.getElementById("ui").setAttribute("aria-hidden", "true");
  setVisualizationMode("3d");
  idleScenarioIndex = IDLE_SCENARIOS.indexOf(startRegion);
  idleHasPresentedScenario = false;
  idleEntryAligned = smoothEntry;
  if (smoothEntry) {
    setCarouselStage("enter-camera");
    await transitionToCarouselCamera(carouselViews[startRegion],
      () => idleActive && generation === idleGeneration);
    if (!idleActive || generation !== idleGeneration) return;
  } else {
    currentPlaybackMultiplier = CAROUSEL_PLAYBACK_MULTIPLIER;
    setCarouselFrame(carouselViews[startRegion]);
    applyCarouselCamera();
  }
  attachCarouselInertialFrame();
  updateTrajectoryLines();
  updateSatellitePositions();
  if (smoothEntry) {
    siteMarkerGroup.visible = false;
    carouselPulseStartMs = launchSitesActivated ? performance.now() - 10000 : null;
    carouselSiteSettledFraction = 1;
    carouselSiteSettledAtMs = performance.now();
    carouselSiteOpacity = 1;
    updateCarouselSiteEffects(performance.now());
    setCarouselSatelliteProgress(1);
    setCarouselStage("dwell");
    idleHasPresentedScenario = true;
    idleScenarioIndex = (idleScenarioIndex + 1) % IDLE_SCENARIOS.length;
    idleCarouselTimer = window.setTimeout(() => showNextIdleScenario(generation), CAROUSEL_TIMING.dwellMs);
  } else {
    prepareCarouselScene();
    if (generation === idleGeneration) void showNextIdleScenario(generation);
  }
}

async function exitIdleMode() {
  if (!idleActive) return;
  idleActive = false;
  isPlaying = true;
  manualIdleGraceUntil = 0;
  idleGeneration += 1;
  window.clearTimeout(idleCarouselTimer);
  const prior = idleSession;
  restoringPresentation = true;
  await principalLoadPromise;
  hideNewScenarioVisuals = false;
  suppressScenarioCameraReframe = false;
  idleSession = null;
  if (prior?.viewMode === "3d") {
    // Keep the constellation playing while the camera returns; Earth and
    // displayed satellites continue on the same inertial timebase.
    isPlaying = true;
    siteMarkerGroup.visible = launchSitesActivated;
    globeSiteEntries.forEach(entry => { entry.darkPulseStartedAtMs = performance.now(); });
    carouselPulseStartMs = null;
    updateCarouselSiteEffects(performance.now());
    await returnFromCarouselCamera();
    restoreCarouselScene();
    controls.enabled = prior.controlsEnabled;
    controls.enableDamping = prior.dampingEnabled;
    currentPlaybackMultiplier = playbackMultiplier;
    updatePlaybackButton();
  } else {
    detachCarouselInertialFrame();
    restoreCarouselScene();
    restoringPresentation = false;
    await restorePresentationState(prior);
  }
  delete document.body.dataset.carouselStage;
  document.body.classList.remove("idleMode");
  document.getElementById("ui").removeAttribute("aria-hidden");
  restoringPresentation = false;
  isPlaying = true;
  currentPlaybackMultiplier = playbackMultiplier;
  updatePlaybackButton();
  updateSceneForTime(false, false);
  scheduleIdleMode();
}

function scheduleIdleMode() {
  window.clearTimeout(idleTimer);
  if (!idleActive && !document.hidden) idleTimer = window.setTimeout(enterIdleMode, IDLE_DELAY_MS);
}

function noteUserActivity(event) {
  if (!event.isTrusted) return;
  if (idleActive && (event.type === "pointermove" || event.type === "touchmove") &&
      performance.now() < manualIdleGraceUntil) return;
  if (geographicIntroActive && !idleActive &&
      ["pointerdown", "wheel", "keydown", "touchstart"].includes(event.type)) stopGeographicIntro();
  if (event.type === "pointerdown" || event.type === "touchstart") pointerHeld = true;
  if (["pointerup", "pointercancel", "touchend", "touchcancel"].includes(event.type)) pointerHeld = false;
  if (idleActive) void exitIdleMode();
  scheduleIdleMode();
}

["pointermove", "pointerdown", "pointerup", "pointercancel", "click", "wheel", "keydown", "touchstart", "touchmove", "touchend", "touchcancel", "scroll"].forEach(type => {
  window.addEventListener(type, noteUserActivity, { passive: true, capture: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) window.clearTimeout(idleTimer);
  else scheduleIdleMode();
});
scheduleIdleMode();

let lastSceneFrameAt = 0;
function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if ((isPlaying || idleActive) && satObjects.length > 0) {
    simulationSeconds += (
      dt *
      BASE_PLAYBACK_SIM_HOURS_PER_REAL_SECOND *
      currentPlaybackMultiplier *
      SECONDS_PER_HOUR
    );

    const loopSeconds = scenarioDurationSeconds;

    if (simulationSeconds > loopSeconds) {
      simulationSeconds = 0;
      resetCoverageHistory();
    }

    // Position buffers are cheap to update and must remain smooth. Coverage
    // metrics and chart samples are evaluated separately on their own cadence.
    if (visualizationMode === "3d") {
      updateSatellitePositions();
    }
    const analysisInterval = visualizationMode === "2d"
      ? (satObjects.length > 3000 ? 420 : 200)
      : (satObjects.length > 15000 ? 450 : satObjects.length > 3000 ? 260 : 150);
    if (!mapProjectionMorphActive && now - lastSceneFrameAt >= analysisInterval) {
      updateSceneForTime(false, true, false, false);
      document.body.dataset.playbackSpeedFactor = currentPlaybackMultiplier.toFixed(3);
      lastSceneFrameAt = now;
    }
  }

  advanceEarthPresentationToSimulationTime();

  if (visualizationMode === "3d") updateDisplayedSatelliteColors();

  controls.update();
  if (visualizationMode === "3d" && countrySelect.value === "north-korea" && !geographicIntroActive) updateGlobeSiteDetail();

  if (visualizationMode === "3d") {
    updateGlobeSiteEffects(now);
    updateCarouselSiteEffects(now);
    updateLaunchSiteLegend();
    if (ambientPresentation) {
      siteMarkerGroup.visible = false;
      carouselSiteGroup.visible = false;
    }
  }

  if (visualizationMode === "3d") {
    renderer.render(scene, camera);
  }
}

animate();

renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute("aria-label", "3D globe. Use left and right arrow keys to inspect visible launch sites.");
let keyboardSiteIndex = -1;
renderer.domElement.addEventListener("keydown", event => {
  if (visualizationMode !== "3d" || idleActive || !siteMarkerGroup.visible) return;
  if (event.key === "Enter" && !siteTooltip.hidden) {
    event.preventDefault();
    siteTooltipLearnMore.focus();
    return;
  }
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  const sites = sitePickMeshes.filter(mesh => mesh.visible);
  if (!sites.length) return;
  event.preventDefault();
  keyboardSiteIndex = (keyboardSiteIndex + (event.key === "ArrowRight" ? 1 : -1) + sites.length) % sites.length;
  const marker = sites[keyboardSiteIndex];
  marker.updateWorldMatrix(true, false);
  const point = new THREE.Vector3().setFromMatrixPosition(marker.matrixWorld).project(camera);
  showSiteTooltip(marker.userData.siteName,
    (point.x + 1) * window.innerWidth / 2,
    (1 - point.y) * window.innerHeight / 2);
});

renderer.domElement.addEventListener("pointermove", event => {
  if (visualizationMode !== "3d" || idleActive || !sitePickMeshes.length) return;
  const pointer = new THREE.Vector2(
    event.clientX / window.innerWidth * 2 - 1,
    -(event.clientY / window.innerHeight * 2 - 1)
  );
  siteRaycaster.setFromCamera(pointer, camera);
  const hits = siteRaycaster.intersectObjects([...sitePickMeshes.filter(mesh => mesh.visible), ...earthGroup.children], false);
  const first = hits[0];
  if (first && sitePickMeshes.includes(first.object)) {
    first.object.updateWorldMatrix(true, false);
    const projected = new THREE.Vector3().setFromMatrixPosition(first.object.matrixWorld).project(camera);
    showSiteTooltip(first.object.userData.siteName,
      (projected.x + 1) * window.innerWidth / 2,
      (1 - projected.y) * window.innerHeight / 2);
    renderer.domElement.style.cursor = "pointer";
  } else {
    scheduleSiteTooltipHide();
    renderer.domElement.style.cursor = "";
  }
});

renderer.domElement.addEventListener("pointerdown", event => {
  if (event.pointerType !== "touch" || visualizationMode !== "3d" || idleActive) return;
  const pointer = new THREE.Vector2(
    event.clientX / window.innerWidth * 2 - 1,
    -(event.clientY / window.innerHeight * 2 - 1)
  );
  siteRaycaster.setFromCamera(pointer, camera);
  const hit = siteRaycaster.intersectObjects([...sitePickMeshes.filter(mesh => mesh.visible), ...earthGroup.children], false)[0];
  if (hit && sitePickMeshes.includes(hit.object))
    showSiteTooltip(hit.object.userData.siteName, event.clientX, event.clientY);
});

renderer.domElement.addEventListener("click", event => {
  if (visualizationMode !== "3d" || countrySelect.value !== "north-korea") return;
  const pointer = new THREE.Vector2(
    event.clientX / window.innerWidth * 2 - 1,
    -(event.clientY / window.innerHeight * 2 - 1)
  );
  siteRaycaster.setFromCamera(pointer, camera);
  const hit = siteRaycaster.intersectObjects(sitePickMeshes.filter(mesh => mesh.visible), false)[0];
  if (!hit?.object.userData.isAggregate) return;
  const direction = hit.object.position.clone().normalize();
  const from = camera.position.clone();
  const to = direction.multiplyScalar(2.25);
  void animateValue(520, progress => {
    camera.position.copy(from).lerp(to, progress);
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    apply3DViewOffset();
    updateGlobeSiteDetail();
  });
});
renderer.domElement.addEventListener("pointerleave", () => {
  scheduleSiteTooltipHide();
  renderer.domElement.style.cursor = "";
});
