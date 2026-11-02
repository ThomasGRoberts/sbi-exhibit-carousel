import { geoMercator, geoPath } from "d3-geo";
import * as topojson from "topojson-client";

const REGIONS = {
  "north-korea": { name: "North Korea", defaultSalvo: 10, centerLongitude: 126 },
  china: { name: "China", defaultSalvo: 100, centerLongitude: 103 },
  russia: { name: "Russia", defaultSalvo: 46, centerLongitude: 100 },
  iran: { name: "Iran", defaultSalvo: 2, centerLongitude: 53 }
};

const PREFERRED_ADVANCED = Object.freeze({
  detectionTime: 15, burnoutVelocity: 4, interceptorsPerSatellite: 1
});

const cards = [...document.querySelectorAll(".scenarioCard")];
const salvoOptions = document.getElementById("salvoOptions");
const advanced = document.getElementById("advancedOptions");
const threatDetails = document.getElementById("threatDetails");
const threatCompactSummary = document.getElementById("threatCompactSummary");
const detectionOptions = document.getElementById("detectionOptions");
const velocityOptions = document.getElementById("velocityOptions");
const capacityOptions = document.getElementById("capacityOptions");
const satelliteStat = document.getElementById("principalSatelliteStat");
const resultIntro = document.getElementById("principalResultIntro");
const resultStatus = document.getElementById("principalResultStatus");
const planeStat = document.getElementById("principalPlaneStat");
const resultMain = document.querySelector(".resultMain");
const resultHeading = document.getElementById("resultHeading");
const advancedCompactSummary = document.getElementById("advancedCompactSummary");
const panelError = document.getElementById("panelError");

let data = null;
let selectedRun = null;
let region = "north-korea";
const displayedPlanesByRun = new Map();

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function runsFor(regionName, salvo = null) {
  return data.runs.filter(run => run.region === regionName && (salvo === null || run.salvo === salvo));
}

function score(run, reference) {
  return (
    5 * Number(run.detectionTime !== reference.detectionTime) +
    5 * Number(run.burnoutVelocity !== reference.burnoutVelocity) +
    3 * Number(run.interceptorsPerSatellite !== reference.interceptorsPerSatellite) +
    Math.abs(run.detectionTime - reference.detectionTime) / 15 +
    Math.abs(run.burnoutVelocity - reference.burnoutVelocity) / 2 +
    Math.abs(run.interceptorsPerSatellite - reference.interceptorsPerSatellite) / 6
  );
}

function nearestRun(candidates, reference) {
  return [...candidates].sort((a, b) => score(a, reference) - score(b, reference) || a.name.localeCompare(b.name))[0];
}

function preferredRegionRun(nextRegion) {
  const defaultSalvo = REGIONS[nextRegion].defaultSalvo;
  const regionRuns = runsFor(nextRegion);
  if (!regionRuns.length) return null;
  const closestSalvo = regionRuns.reduce((best, run) => {
    const gap = Math.abs(run.salvo - defaultSalvo);
    const bestGap = Math.abs(best - defaultSalvo);
    return gap < bestGap || (gap === bestGap && run.salvo < best) ? run.salvo : best;
  }, regionRuns[0].salvo);
  const candidates = runsFor(nextRegion, closestSalvo);
  const preferredKeys = Object.keys(PREFERRED_ADVANCED);
  const mismatches = run => preferredKeys.reduce((count, key) =>
    count + Number(run[key] !== PREFERRED_ADVANCED[key]), 0);
  return [...candidates].sort((a, b) =>
    Number(a.resultStatus !== "Optimal") - Number(b.resultStatus !== "Optimal") ||
    mismatches(a) - mismatches(b) ||
    score(a, PREFERRED_ADVANCED) - score(b, PREFERRED_ADVANCED) ||
    a.name.localeCompare(b.name))[0];
}

function publishSelectedRun() {
  panelError.hidden = true;
  document.dispatchEvent(new CustomEvent("principal-panel:run-selected", { detail: { run: selectedRun } }));
}

function requestHeightSync() {
  requestAnimationFrame(() => document.dispatchEvent(new Event("principal-panel:resize")));
}

function showConfigurationCue() {
  resultMain.dataset.state = "configuring";
  resultMain.setAttribute("aria-busy", "true");
  satelliteStat.replaceChildren(...Array.from({ length: 3 }, () => {
    const dot = document.createElement("span");
    dot.className = "configSatelliteDot";
    dot.setAttribute("aria-hidden", "true");
    return dot;
  }));
  satelliteStat.setAttribute("aria-label", "Configuring satellite constellation");
  resultHeading.textContent = "configuring satellites";
  planeStat.textContent = "—";
}

function revealConstellationCount(name) {
  if (!selectedRun || name !== selectedRun.name) return;
  resultMain.removeAttribute("aria-busy");
  satelliteStat.textContent = selectedRun.satellites.toLocaleString();
  planeStat.textContent = Number(displayedPlanesByRun.get(name) ?? selectedRun.displayPlanes).toLocaleString();
  satelliteStat.removeAttribute("aria-label");
  resultHeading.textContent = "satellites";
  delete resultMain.dataset.state;
}

function renderChoices(container, values, selectedValue, unit, onChoose) {
  container.style.gridTemplateColumns = `repeat(${values.length}, minmax(0, 1fr))`;
  const buttons = [];
  values.forEach(value => {
    const button = document.createElement("button");
    button.type = "button";
    const choiceText = document.createElement("span");
    choiceText.className = "choiceText";
    const valueSpan = document.createElement("span");
    valueSpan.className = "choiceValue";
    valueSpan.textContent = String(value);
    choiceText.append(valueSpan);
    const unitText = typeof unit === "function" ? unit(value) : unit;
    if (unitText) {
      const unitSpan = document.createElement("span");
      unitSpan.className = "choiceUnit";
      unitSpan.textContent = unitText;
      choiceText.append(unitSpan);
    }
    button.append(choiceText);
    button.setAttribute("aria-label", `${value}${unitText ? ` ${unitText}` : ""}`);
    button.setAttribute("aria-pressed", String(value === selectedValue));
    button.addEventListener("click", () => onChoose(value));
    buttons.push(button);
  });
  container.replaceChildren(...buttons);
}

function render() {
  const allRegionRuns = runsFor(region);
  const salvos = uniqueSorted(allRegionRuns.map(run => run.salvo));
  const selectedSalvo = selectedRun.salvo;
  const salvoRuns = runsFor(region, selectedSalvo);

  cards.forEach(card => {
    const isSelected = card.dataset.region === region;
    card.dataset.selected = String(isSelected);
    const button = card.querySelector(".scenarioCardSelect");
    button.setAttribute("aria-pressed", String(isSelected));
    button.setAttribute("aria-label", `${isSelected ? "Open" : "Select"} ${REGIONS[card.dataset.region].name}${isSelected ? " scenario details" : ""}`);
  });

  renderChoices(salvoOptions, salvos, selectedSalvo, "", changeSalvo);

  renderChoices(detectionOptions, uniqueSorted(salvoRuns.map(run => run.detectionTime)), selectedRun.detectionTime,
    "s", value => changeAdvanced("detectionTime", value));
  renderChoices(velocityOptions, uniqueSorted(salvoRuns.map(run => run.burnoutVelocity)), selectedRun.burnoutVelocity,
    "km/s", value => changeAdvanced("burnoutVelocity", value));
  renderChoices(capacityOptions, uniqueSorted(salvoRuns.map(run => run.interceptorsPerSatellite)), selectedRun.interceptorsPerSatellite,
    "", value => changeAdvanced("interceptorsPerSatellite", value));

  const isOptimal = selectedRun.resultStatus === "Optimal";
  resultIntro.textContent = isOptimal
    ? "To defend against this threat, a constellation of boost-phase interceptors needs:"
    : "A feasible boost-phase interceptor constellation for this threat uses:";
  resultStatus.hidden = isOptimal;
  if (!isOptimal) {
    const gapPercent = 100 * Number(selectedRun.mipGapAchieved);
    resultStatus.textContent = `Solver time limit · ${Number.isFinite(gapPercent) ? gapPercent.toFixed(1) : "unknown"}% optimality gap. Minimum not proven.`;
  }
  showConfigurationCue();
  satelliteStat.dataset.runName = selectedRun.name;
  planeStat.title = "Orbital planes represented by the trajectories shown on the globe.";
  threatCompactSummary.textContent = `${selectedRun.salvo} ${selectedRun.salvo === 1 ? "missile" : "missiles"} from ${REGIONS[region].name}`;
  advancedCompactSummary.textContent = `${selectedRun.detectionTime} s detection · ${selectedRun.burnoutVelocity} km/s burnout · ${selectedRun.interceptorsPerSatellite} interceptors/satellite`;
  requestHeightSync();
}

function chooseRegion(nextRegion) {
  if (!data || !REGIONS[nextRegion]) return;
  const preferred = preferredRegionRun(nextRegion);
  if (!preferred) return;
  region = nextRegion;
  selectedRun = preferred;
  render();
  publishSelectedRun();
}

function changeSalvo(requested) {
  const candidates = runsFor(region, requested);
  if (!candidates.length) return;
  const previous = selectedRun;
  selectedRun = nearestRun(candidates, previous);
  render();
  publishSelectedRun();
}

function changeAdvanced(key, requested) {
  const previous = selectedRun;
  const candidates = runsFor(region, selectedRun.salvo).filter(run =>
    run[key] === requested);
  if (!candidates.length) return;
  selectedRun = nearestRun(candidates, previous);
  render();
  publishSelectedRun();
}

function featureMatches(feature, selectedRegion) {
  const name = String(feature.properties?.name || "").toLowerCase();
  if (selectedRegion === "north-korea") return name.includes("korea") && (name.includes("north") || name.includes("dem"));
  return name.includes(selectedRegion);
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function simplifyRing(ring, tolerance) {
  if (tolerance <= 0 || ring.length < 6) return ring;
  const points = ring.slice(0, -1);
  const keep = new Set([0, points.length - 1]);
  const thresholdSq = tolerance * tolerance;
  const visit = (first, last) => {
    const a = points[first];
    const b = points[last];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    let farthest = -1;
    let farthestDistance = thresholdSq;
    for (let index = first + 1; index < last; index += 1) {
      const p = points[index];
      const t = lengthSq ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq)) : 0;
      const distanceSq = (p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2;
      if (distanceSq > farthestDistance) {
        farthestDistance = distanceSq;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep.add(farthest);
      visit(first, farthest);
      visit(farthest, last);
    }
  };
  visit(0, points.length - 1);
  const simplified = [...keep].sort((a, b) => a - b).map(index => points[index]);
  return simplified.length >= 3 ? [...simplified, simplified[0]] : ring;
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area) / 2;
}

function simplifyFeature(feature, tolerance, minimumIslandArea) {
  if (tolerance <= 0 && minimumIslandArea <= 0) return feature;
  const polygons = feature.geometry.type === "MultiPolygon"
    ? feature.geometry.coordinates
    : feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : [];
  const simplified = polygons
    .filter(polygon => polygon.length && ringArea(polygon[0]) >= minimumIslandArea)
    .map(polygon => polygon.map(ring => simplifyRing(ring, tolerance)));
  if (!simplified.length) return null;
  return {
    ...feature,
    geometry: {
      type: "MultiPolygon",
      coordinates: simplified
    }
  };
}

function renderMiniMap(card, features) {
  const selectedRegion = card.dataset.region;
  const svg = card.querySelector("svg");
  const focus = features.filter(feature => featureMatches(feature, selectedRegion));
  if (!focus.length) return;
  const projection = geoMercator().rotate([-REGIONS[selectedRegion].centerLongitude, 0]);
  projection.fitExtent([[12, 7], [132, 65]], { type: "FeatureCollection", features: focus });
  if (selectedRegion === "china" || selectedRegion === "iran") {
    const [x, y] = projection.translate();
    projection.translate([x, y + 4]);
  }
  const path = geoPath(projection).digits(1);
  const background = svgElement("g");
  const foreground = svgElement("g");
  const focusTolerance = selectedRegion === "russia" ? .85 : selectedRegion === "china" ? .45 : 0;
  const minimumIslandArea = selectedRegion === "russia" ? .4 : selectedRegion === "china" ? .08 : 0;
  for (const feature of features) {
    const isFocus = focus.includes(feature);
    const simplified = simplifyFeature(feature, isFocus ? focusTolerance : .8, isFocus ? minimumIslandArea : .2);
    if (!simplified) continue;
    if (!isFocus) {
      const [[x0, y0], [x1, y1]] = path.bounds(simplified);
      if (x1 < 0 || y1 < 0 || x0 > 144 || y0 > 87) continue;
    }
    const outline = path(simplified);
    if (!outline) continue;
    const shape = svgElement("path", { d: outline, class: isFocus ? "scenarioCardFocus" : "scenarioCardLand" });
    (isFocus ? foreground : background).append(shape);
  }
  svg.replaceChildren(svgElement("rect", { x: 0, y: 0, width: 144, height: 87, class: "scenarioCardBackdrop" }), background, foreground);
  for (const target of data.targets[selectedRegion] || []) {
    const point = projection([target.lon_deg, target.lat_deg]);
    if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    if (point[0] < 0 || point[0] > 144 || point[1] < 0 || point[1] > 87) continue;
    svg.append(svgElement("circle", { cx: point[0], cy: point[1], r: 4.5, class: "scenarioCardSiteHalo" }));
    svg.append(svgElement("circle", { cx: point[0], cy: point[1], r: 2.8, class: "scenarioCardSite" }));
  }
}

async function loadMiniMaps() {
  try {
    const [standardResponse, detailedResponse] = await Promise.all([
      fetch("assets/countries-110m.json"),
      fetch("assets/countries-50m.json")
    ]);
    if (!standardResponse.ok || !detailedResponse.ok) throw new Error("Card map data could not be loaded.");
    const [standardTopology, detailedTopology] = await Promise.all([standardResponse.json(), detailedResponse.json()]);
    const standardFeatures = topojson.feature(standardTopology, standardTopology.objects.countries).features;
    const detailedFeatures = topojson.feature(detailedTopology, detailedTopology.objects.countries).features;
    cards.forEach(card => renderMiniMap(card, card.dataset.region === "north-korea" ? detailedFeatures : standardFeatures));
  } catch (error) {
    console.error("Scenario card maps could not be loaded.", error);
  }
}

cards.forEach(card => {
  card.querySelector(".scenarioCardSelect").addEventListener("click", () => {
    if (card.dataset.selected === "true") document.dispatchEvent(new Event("principal-panel:learn-more"));
    else chooseRegion(card.dataset.region);
  });
});
advanced.addEventListener("toggle", requestHeightSync);
threatDetails.addEventListener("toggle", requestHeightSync);
document.addEventListener("principal-panel:request-region", event => {
  if (event.detail?.region !== region || event.detail?.forceDefault) chooseRegion(event.detail.region);
});
document.addEventListener("principal-panel:request-run", event => {
  const run = data?.runs.find(item => item.name === event.detail?.name);
  if (!run) return;
  region = run.region;
  selectedRun = run;
  render();
  publishSelectedRun();
});
document.addEventListener("principal-panel:run-load-error", event => {
  if (event.detail?.name !== selectedRun?.name) return;
  satelliteStat.textContent = "—";
  satelliteStat.removeAttribute("aria-label");
  resultHeading.textContent = "satellites";
  delete resultMain.dataset.state;
  resultMain.removeAttribute("aria-busy");
  panelError.textContent = "This simulation could not be loaded.";
  panelError.hidden = false;
});
document.addEventListener("principal-panel:run-loaded", event => {
  displayedPlanesByRun.set(event.detail.run.name, Number(event.detail.displayPlanes));
  if (event.detail?.run?.name !== selectedRun?.name) return;
  planeStat.title = "Orbital planes represented by the trajectories shown on the globe.";
  if (!event.detail.awaitingPopulation) revealConstellationCount(event.detail.run.name);
});
document.addEventListener("principal-panel:population-complete", event => {
  revealConstellationCount(event.detail?.name);
});

async function initialize() {
  try {
    const response = await fetch("principal-panel-data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Principal run data returned ${response.status}`);
    data = await response.json();
    if (!data.runs?.length) throw new Error("No feasible principal runs were found.");
    const requested = new URLSearchParams(location.search).get("scenario");
    chooseRegion(REGIONS[requested] ? requested : "north-korea");
    await loadMiniMaps();
  } catch (error) {
    console.error(error);
    satelliteStat.textContent = "—";
    panelError.textContent = "Results could not be loaded.";
    panelError.hidden = false;
  }
}

initialize();
