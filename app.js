import { APP_MODE } from "./config.js";
import { presenters, exhibits, stateId } from "./manifest.js?integrated-model-1";
import { createModelLink } from "./model-link.js?persistent-invitation=1";
import { createUnderHoodDiagram } from "./animations/under-the-hood.js?threat-characterization-1";
import { buildPresentationSteps, loadTitleConfiguration, phaseDurations,
  TITLE_STORAGE_KEY } from "./presentation-sequence.js?slide23-1";
import { buildTitleEditor } from "./title-editor.js?slide23-1";

const app = document.getElementById("app");
let activeExhibit = null;
let activeContent = null;
let persistentModelLink = null;
let activeStep = null;
let phaseTimer = 0;
let phaseToken = 0;
let transitionLayer = null;
let routeVersion = 0;
let displayMode = APP_MODE === "presentation" ? "presentation" : "preview";
let launchMode = "full";
let lastFullscreenExit = -Infinity;
const moduleSession = Date.now().toString(36);
const selectionKey = "sbi-exhibit-carousel-selection-v2";
const modelSessionKey = "sbi-carousel-live-model-session-v1";
const liveModelUrl = new URL("./integrated-sbi/", import.meta.url).href;
const commentLogUrl = "https://docs.google.com/spreadsheets/d/1X7T9abmO9xWdtuP31w-Ovz2D5K5y-PY4jn4uxDlkjQ4/edit?gid=0#gid=0";
let modelContext = null;
try {
  const stored = JSON.parse(sessionStorage.getItem(modelSessionKey) || "null");
  if (stored && typeof stored.token === "string" &&
      typeof stored.launchStepId === "string" &&
      typeof stored.nextStepId === "string" &&
      Array.isArray(stored.selectedExhibitIds) &&
      Array.isArray(stored.titleConfiguration?.slides)) modelContext = stored;
}
catch (error) { console.warn("Model return position could not be restored.", error); }
let modelLoadTimer = 0;
let paneToastTimer = 0;
let pendingFullscreenRestore = false;
let modelReturnInFlight = false;
let pendingContentBeat = 0;
let titleConfiguration = loadTitleConfiguration();
titleConfiguration.enabled = true;
const steps = () => buildPresentationSteps(exhibits, selectedExhibitIds,
  { ...titleConfiguration, enabled:launchMode === "full" });
let selectedExhibitIds = new Set(exhibits.map(exhibit => exhibit.id));
try {
  const saved = JSON.parse(localStorage.getItem(selectionKey) || "null");
  if (Array.isArray(saved)) selectedExhibitIds = new Set(saved.filter(id =>
    exhibits.some(exhibit => exhibit.id === id)));
} catch (error) {
  console.warn("Exhibit selection could not be restored.", error);
}
function saveSelection() {
  try { localStorage.setItem(selectionKey, JSON.stringify([...selectedExhibitIds])); }
  catch (error) { console.warn("Exhibit selection could not be saved.", error); }
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
function renderOpeningSupport(container, value) {
  container.replaceChildren();
  const lines = String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  lines.forEach((text, index) => {
    const line = element("span", "title-support-line");
    const names = index === 0 ? text.match(/^(.+?) and (.+)$/) : null;
    if (names) {
      line.append(element("strong", "title-support-name", names[1]),
        element("span", "title-support-and", " and "),
        element("strong", "title-support-name", names[2]));
    } else line.textContent = text;
    container.append(line);
  });
  container.hidden = lines.length === 0;
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "model" && modelContext) return {page:"model"};
  if (parts[0] === "end") {
    const closing=steps().find(step=>step.id==="title-closing");
    return closing?{page:"title",step:closing}:{page:"end"};
  }
  if (parts[0] === "configurations") return {page:"index", showConfig:true};
  if (parts[0] === "present") {
    const step = steps().find(item => item.id === decodeURIComponent(parts[1] || ""));
    if (step?.kind === "title") return {page:"title", step};
    if (step?.kind === "content") return {page:"content", step, exhibit:step.exhibit};
    if (step) return {page:"exhibit", exhibit:step.exhibit,
      requestedState:step.start, startAtEnd:false, step};
  }
  const id = parts[0] === "exhibit" ? parts[1] :
    parts[0] === "catalog" ? parts[3] :
    presenters.some(p => p.id === parts[0]) ? parts[1] : null;
  const exhibit = exhibits.find(item => item.id === id);
  const match = parts[2]?.match(/^(\d{2})\.(\d{2})$/);
  const requestedState = match && exhibit && Number(match[1]) === exhibit.number ?
    Number(match[2]) - 1 : null;
  return { page: exhibit ? "exhibit" : "index", exhibit,
    startAtEnd: parts.at(-1) === "last", requestedState,
    step: exhibit ? steps().find(item => item.kind === "exhibit" &&
      item.exhibit.id === exhibit.id &&
      item.panes.includes(requestedState ?? (parts.at(-1) === "last" ?
        exhibit.states.length-1 : 0))) : null };
}

function stepHref(step) { return "#/present/" + encodeURIComponent(step.id); }
function logicalPaneId(step) {
  if (!step) return "";
  if (step.kind === "title" || step.kind === "content") return step.paneId;
  const first = stateId(step.exhibit, step.start);
  return step.start === step.end ? first : first + "–" + stateId(step.exhibit, step.end);
}
function hidePaneId() {
  clearTimeout(paneToastTimer);
  app.querySelector(".pane-id-toast")?.classList.remove("is-visible");
  const control = app.querySelector(".pane-control");
  if (control) control.hidden = true;
}
function showPaneToast(step) {
  clearTimeout(paneToastTimer);
  const toast = app.querySelector(".pane-id-toast");
  if (!toast || !step) return;
  const control = app.querySelector(".pane-control");
  if (control) control.hidden = false;
  toast.textContent = logicalPaneId(step);
  toast.classList.remove("is-visible");
  requestAnimationFrame(() => toast.classList.add("is-visible"));
  paneToastTimer = setTimeout(hidePaneId, 3500);
}
function updateViewportAspect() {
  const width = document.fullscreenElement === app ? app.clientWidth : window.innerWidth;
  const height = document.fullscreenElement === app ? app.clientHeight : window.innerHeight;
  if (width > 0 && height > 0) {
    app.style.setProperty("--screen-aspect", `${width} / ${height}`);
    app.style.setProperty("--screen-aspect-number", String(width / height));
    activeExhibit?.resize?.();
  }
}
function replaceView(main) {
  app.replaceChildren(main, ...(transitionLayer ? [transitionLayer] : []));
}
function showTransition() {
  if (transitionLayer) return;
  transitionLayer = element("div", "presentation-transition");
  app.append(transitionLayer);
}
function clearTransition() {
  const layer = transitionLayer;
  if (!layer) return;
  transitionLayer = null;
  layer.classList.add("is-leaving");
  setTimeout(() => layer.remove(), 240);
}
function cancelPhases() {
  phaseToken++;
  clearTimeout(phaseTimer);
  phaseTimer = 0;
}
function startStepPhases(step, initialIndex = step.start) {
  cancelPhases();
  if (!step || step.kind !== "exhibit" || !activeExhibit) return;
  const token = phaseToken;
  const position = step.panes.indexOf(initialIndex);
  if (position < 0 || position >= step.panes.length-1) return;
  const duration = phaseDurations[step.exhibit.id]?.[initialIndex] ?? 1800;
  phaseTimer = setTimeout(() => {
    if (token !== phaseToken || activeStep?.id !== step.id || !activeExhibit) return;
    const nextIndex = step.panes[position+1];
    activeExhibit.goToState?.(nextIndex);
    startStepPhases(step, nextIndex);
  }, duration);
}

function exhibitHref(exhibit, atEnd = false) {
  return "#/exhibit/" + exhibit.id + (atEnd ? "/last" : "");
}

function makeBackLink(href) {
  const link = element("a", "back-link");
  link.href = href;
  link.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"></path></svg>';
  link.append(element("span", "", "Back"));
  return link;
}

function exhibitRow(exhibit) {
  const presenter = presenters.find(item => item.id === exhibit.presenterId);
  const row = element("div", "sequence-row");
  row.dataset.included = String(selectedExhibitIds.has(exhibit.id));
  const link = element("a", "sequence-row-link");
  link.href = exhibitHref(exhibit);
  link.setAttribute("aria-label", "Open Exhibit " + String(exhibit.number).padStart(2, "0") +
    ": " + exhibit.title);
  const checkbox = element("input", "sequence-checkbox");
  checkbox.type = "checkbox";
  checkbox.checked = selectedExhibitIds.has(exhibit.id);
  checkbox.setAttribute("aria-label", "Include Exhibit " + String(exhibit.number).padStart(2, "0") +
    " in carousel");
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) selectedExhibitIds.add(exhibit.id);
    else selectedExhibitIds.delete(exhibit.id);
    row.dataset.included = String(checkbox.checked);
    saveSelection();
    const summary = document.querySelector(".selection-summary");
    if (summary) summary.textContent = `${selectedExhibitIds.size} of ${exhibits.length} exhibits in carousel`;
    const launch = document.querySelector(".landing-action-primary");
    if (launch) launch.disabled = selectedExhibitIds.size === 0;
    document.querySelector(".title-editor")?.refresh?.();
  });
  row.append(checkbox, link);
  const portrait = element("img", "sequence-avatar");
  portrait.src = presenter.photo;
  portrait.alt = "";
  portrait.width = portrait.height = 46;
  row.append(element("span", "sequence-number", "Exhibit " +
    String(exhibit.number).padStart(2, "0")));
  row.append(element("span", "sequence-title", exhibit.title));
  row.append(portrait);
  row.append(element("span", "sequence-presenter", presenter.name));
  row.append(element("span", "status", exhibit.status === "draft" ? "Draft" : exhibit.status));
  row.append(element("span", "sequence-arrow", "→"));
  return row;
}

function exhibitIndex(current) {
  const main = element("main", "dashboard");
  main.style.setProperty("--exhibit-count", String(Math.max(1, exhibits.length)));
  const content = element("div", "dashboard-content");
  const list = element("div", "sequence-list");
  const summary = element("p", "selection-summary",
    `${selectedExhibitIds.size} of ${exhibits.length} exhibits in carousel`);
  if (exhibits.length === 0) {
    list.append(element("p", "empty-state", "No exhibits yet."));
  } else {
    exhibits.forEach(exhibit => list.append(exhibitRow(exhibit)));
  }
  const modeChoice = element("fieldset", "launch-mode-choice");
  modeChoice.append(element("legend", "", "Presentation mode"));
  for (const [value,label,description] of [
    ["full","Full Presentation","Titles, agenda, and exhibits"],
    ["exhibits","Exhibits Only","Scientific animations only"]]) {
    const option = element("label", "launch-mode-option");
    const input = element("input");
    input.type = "radio"; input.name = "launch-mode"; input.value = value;
    input.checked = launchMode === value;
    input.addEventListener("change", () => { if (input.checked) launchMode = value; });
    option.append(input,element("strong", "", label),element("span", "", description));
    modeChoice.append(option);
  }
  const actions = element("div", "landing-actions");
  const launch = element("button", "landing-action landing-action-primary", "Launch Carousel");
  launch.type = "button";
  launch.disabled = selectedExhibitIds.size === 0;
  launch.addEventListener("click", () => {
    const first = steps()[0];
    if (!first) return;
    displayMode = "presentation";
    // Fullscreen must be requested in the click's user-activation task.
    if (app.requestFullscreen) app.requestFullscreen().catch(error =>
      console.warn("Browser full screen unavailable; using presentation layout.", error));
    location.hash = stepHref(first);
  });
  const comment = element("button", "landing-action landing-action-secondary", "Comment on Carousel");
  comment.type = "button";
  comment.addEventListener("click", () => {
    launchMode = "full";
    displayMode = "preview";
    const first = steps()[0];
    if (first) location.hash = stepHref(first);
  });
  actions.append(launch, comment);
  content.append(modeChoice, summary, list, actions);
  main.append(content);
  const mark = element("img", "directory-logo");
  mark.src = "assets/ESPL.png"; mark.alt = ""; mark.setAttribute("aria-hidden", "true");
  main.append(mark);
  replaceView(main);
  if (current?.showConfig) comment.click();
}

function enterLiveModel() {
  const current = route();
  const sequence = steps();
  const position = sequence.findIndex(step => step.id === current.step?.id);
  const next = sequence[position + 1];
  if (position < 0) return;
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
    byte.toString(16).padStart(2, "0")).join("");
  modelContext = {
    token, launchStepId:current.step.id, nextStepId:next?.id || "end",
    launchMode, selectedExhibitIds:[...selectedExhibitIds],
    titleConfiguration:structuredClone(titleConfiguration),
    displayMode, fullscreen:document.fullscreenElement === app
  };
  try { sessionStorage.setItem(modelSessionKey, JSON.stringify(modelContext)); }
  catch (error) { console.warn("Model return position could not be saved.", error); }
  modelReturnInFlight = false;
  location.hash = "#/model";
}

function returnFromLiveModel() {
  if (modelReturnInFlight || !modelContext || route().page !== "model") return;
  modelReturnInFlight = true;
  const context = modelContext;
  launchMode = context.launchMode === "exhibits" ? "exhibits" : "full";
  selectedExhibitIds = new Set(context.selectedExhibitIds.filter(id =>
    exhibits.some(exhibit => exhibit.id === id)));
  titleConfiguration = context.titleConfiguration;
  displayMode = document.fullscreenElement === app ? "presentation" : context.displayMode;
  pendingFullscreenRestore = Boolean(context.fullscreen && document.fullscreenElement !== app);
  const sequence = steps();
  const next = (context.nextStepId === "end" ? null : sequence.find(step => step.id === context.nextStepId)) ||
    sequence[sequence.findIndex(step => step.id === context.launchStepId) + 1];
  modelContext = null;
  try { sessionStorage.removeItem(modelSessionKey); } catch { /* in-memory return still works */ }
  if (next) location.hash = stepHref(next);
  else location.hash = "#/end";
}

function liveModelView() {
  const main = element("main", "live-model-view");
  main.setAttribute("aria-label", "Interactive SBI constellation model");
  const frame = element("iframe", "live-model-frame");
  frame.title = "Interactive SBI constellation model";
  frame.allow = "fullscreen";
  frame.setAttribute("allowfullscreen", "");
  frame.referrerPolicy = "origin";
  const url = new URL(liveModelUrl);
  url.searchParams.set("presentation", "carousel");
  url.searchParams.set("returnOrigin", location.origin);
  url.searchParams.set("presentationToken", modelContext.token);
  frame.src = url.href;
  const status = element("div", "live-model-status", "Loading the interactive model…");
  status.setAttribute("role", "status");
  frame.addEventListener("load", clearTransition);
  function scheduleLoadTimeout() {
    clearTimeout(modelLoadTimer);
    modelLoadTimer = setTimeout(() => {
      if (route().page !== "model" || !main.isConnected || status.hidden) return;
      status.textContent = "The interactive model is taking longer to load.";
      const retry = element("button", "live-model-retry", "Retry");
      retry.type = "button";
      retry.addEventListener("click", () => {
        status.textContent = "Loading the interactive model…";
        frame.src = url.href + "&retry=" + Date.now();
        scheduleLoadTimeout();
      });
      const back = element("button", "live-model-retry", "Return to presentation");
      back.type = "button";
      back.addEventListener("click", returnFromLiveModel);
      status.append(retry, back);
      clearTransition();
    }, 20000);
  }
  scheduleLoadTimeout();
  main.append(frame, status);
  replaceView(main);
}

async function toggleFullscreen(main) {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (displayMode === "presentation") {
    displayMode = "preview";
    main.showDisplayMode();
    return;
  }
  if (app.requestFullscreen) {
    try {
      await app.requestFullscreen();
      return;
    } catch (error) {
      console.warn("Browser full screen unavailable; using presentation layout.", error);
    }
  }
  displayMode = "presentation";
  main.showDisplayMode();
}

async function deck(current, version) {
  const isTitle = current.page === "title";
  const isContent = current.page === "content";
  const slide = isTitle ? current.step.slide : null;
  const isClosing = isTitle && current.step.id === "title-closing";
  const isSpeakers = isTitle && slide.id === "speakers";
  const exhibit = isTitle ?
    (isClosing ? exhibits.filter(item => selectedExhibitIds.has(item.id)).at(-1) :
      slide.id === "opening" ? exhibits.find(item => selectedExhibitIds.has(item.id)) :
      exhibits.find(item => item.id === slide.before)) || exhibits[0] : current.exhibit;
  const { startAtEnd, requestedState } = current;
  const main = element("main", "deck");
  main.dataset.stepId = current.step?.id || "";
  main.setAttribute("aria-label", isTitle ? "Presentation title: " + slide.title :
    isContent ? "Process diagram: SBI constellation optimization" :
    "Exhibit " + String(exhibit.number).padStart(2, "0") + ": " + exhibit.title);
  const toolbar = element("div", "preview-toolbar");
  const back = makeBackLink("#/");
  const fullButton = element("button", "fullscreen-button");
  fullButton.type = "button";
  fullButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5m0 8v5h-5M8 21H3v-5"></path></svg>';
  const configButton = element("button", "configuration-button", "Configure");
  configButton.type = "button";
  const configPanel = buildTitleEditor(exhibits, selectedExhibitIds,
    titleConfiguration, updated => {
      titleConfiguration = updated;
      try { localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(updated)); }
      catch (error) { console.warn("Presentation titles could not be saved.", error); }
    }, step => { location.hash = stepHref(step); });
  configPanel.hidden = true;
  configButton.addEventListener("click", () => {
    configPanel.hidden = !configPanel.hidden;
    if (!configPanel.hidden) configPanel.refresh();
  });
  const exportToolbarButton = element("button", "configuration-button", "Export");
  exportToolbarButton.type = "button";
  exportToolbarButton.setAttribute("aria-label", "Export presentation configuration");
  exportToolbarButton.addEventListener("click", () => configPanel.exportConfiguration());
  const toolbarRight = element("div", "toolbar-right");
  const editTextButton = isTitle && slide.id !== "results" ?
    element("button", "title-edit-button", "Edit text") : null;
  if (editTextButton) { editTextButton.type = "button"; toolbarRight.append(editTextButton); }
  toolbarRight.append(configButton, exportToolbarButton, fullButton);
  toolbar.append(back, toolbarRight);
  const stage = element("div", "preview-stage");
  const switcher = element("div", "exhibit-switcher");
  const switcherCue = element("span", "exhibit-switcher-cue",
    isClosing ? "Closing slide" : isSpeakers ? "Speaker introduction" :
    isContent ? "Process diagram · before Exhibit 07" :
    isTitle ? "Presentation title · before Exhibit " +
      String(exhibit.number).padStart(2,"0") : "Click to choose exhibit");
  const heading = element("h1", "exhibit-heading");
  const exhibitSelect = element("select", "exhibit-select");
  exhibitSelect.setAttribute("aria-label", "Jump to exhibit");
  for (const item of exhibits.filter(item =>
    selectedExhibitIds.has(item.id) || item.id === exhibit.id)) {
    const option = element("option", "", "Exhibit " +
      String(item.number).padStart(2, "0") + ": " + item.title);
    option.value = item.id;
    exhibitSelect.append(option);
  }
  exhibitSelect.value = exhibit.id;
  exhibitSelect.addEventListener("change", () => {
    const selected = exhibits.find(item => item.id === exhibitSelect.value);
    if (selected && selected.id !== exhibit.id) location.hash = exhibitHref(selected);
  });
  heading.append(exhibitSelect);
  heading.insertAdjacentHTML("beforeend",
    '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>');
  switcher.append(switcherCue, heading);
  const feedback = element("div", "feedback-controls");
  const paneControl = element("div", "pane-control");
  paneControl.hidden = true;
  const stateLabel = element("button", "pane-id");
  stateLabel.type = "button";
  stateLabel.setAttribute("aria-label", "Copy Pane ID");
  const paneCue = element("span", "pane-id-cue", "Click to copy");
  const panePrefix = element("span", "pane-id-prefix", "Pane ID ");
  const paneValue = element("span", "pane-id-value");
  stateLabel.append(panePrefix, paneValue);
  paneControl.append(paneCue, stateLabel);
  const copied = element("span", "pane-copied", "Copied");
  copied.setAttribute("aria-hidden", "true");
  paneControl.append(copied);
  const commentLog = element("a", "comment-log-link external-metadata-link");
  commentLog.append(element("span", "", "Comment Log"));
  commentLog.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false" class="external-link-icon"><path class="external-link-icon__box" d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"></path><g class="external-link-icon__arrow"><path d="M9.25 2.75h6v6"></path><path d="m8 10 7.25-7.25"></path></g></svg>');
  commentLog.href = commentLogUrl;
  commentLog.target = "_blank";
  commentLog.rel = "noopener noreferrer";
  let copyTimer;
  const previewMeta = element("div", "preview-meta");
  feedback.append(paneControl, commentLog);
  previewMeta.append(switcher, feedback);
  stage.append(previewMeta);
  function showState(index) {
    if (isTitle || isContent) {
      paneValue.textContent = current.step.paneId;
      stateLabel.title = "Copy " + current.step.paneId + " · " +
        (isContent ? current.step.title : slide.title);
      copied.classList.remove("is-visible");
      return;
    }
    const name = exhibit.states[index];
    if (name) {
      paneValue.textContent = stateId(exhibit, index);
      stateLabel.title = "Copy " + stateId(exhibit, index) + " · " + name;
      copied.classList.remove("is-visible");
    }
  }
  stateLabel.addEventListener("click", async () => {
    const id = paneValue.textContent;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      const temporary = document.createElement("textarea");
      temporary.value = id;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.append(temporary);
      temporary.select();
      const success = document.execCommand("copy");
      temporary.remove();
      if (!success) return;
    }
    clearTimeout(copyTimer);
    copied.classList.add("is-visible");
    copyTimer = setTimeout(() => copied.classList.remove("is-visible"), 1200);
  });
  showState(0);
  const pane = element("section", "visualization-pane");
  pane.setAttribute("aria-label", isTitle ? "Presentation title" :
    isContent ? "SBI optimization process diagram" : "Exhibit visualization");
  const host = element("div", "animation-host");
  const logo = element("img", "presentation-logo");
  logo.src = "assets/ESPL.png";
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  const paneToast = element("div", "pane-id-toast");
  paneToast.setAttribute("aria-live", "polite");
  paneToast.setAttribute("aria-atomic", "true");
  pane.append(host, logo, paneToast);
  if (pendingFullscreenRestore) {
    const restore = element("button", "restore-fullscreen", "Restore full screen");
    restore.type = "button";
    restore.addEventListener("click", async event => {
      event.stopPropagation();
      try {
        await app.requestFullscreen();
        pendingFullscreenRestore = false;
        restore.remove();
      } catch (error) {
        restore.textContent = "Full screen unavailable — press F to retry";
        console.warn("Full screen could not be restored automatically.", error);
      }
    });
    pane.append(restore);
  }
  if (isTitle) {
    pane.classList.add("title-visualization");
    if (slide.id === "results") pane.classList.add("visual-invitation");
    host.classList.add("title-stage");
    if (slide.id === "opening") host.classList.add("is-opening");
    if (isSpeakers) host.classList.add("is-speakers");
    const block = element("div", "title-block");
    const title = element("h1");
    const titleText = element("span", "", slide.title);
    title.append(titleText);
    const subtitle = element("p", "title-subtitle", slide.subtitle || "");
    subtitle.hidden = !slide.subtitle;
    block.append(title, subtitle);
    const agendaRows = [];
    if (slide.type === "agenda") {
      const list = element("ol", "title-agenda");
      (slide.agenda || []).forEach((item, index) => {
        const row = element("li", index === slide.highlight ? "is-highlighted" : "", item);
        agendaRows.push(row);
        list.append(row);
      });
      block.append(list);
    }
    if (!isSpeakers) host.append(block);
    const speakerCards=[];
    if (isSpeakers) {
      const grid=element("div","speaker-grid");
      (slide.speakers || []).forEach(person => {
        const card=element("article","speaker-card");
        const photo=element("img","speaker-photo");
        photo.src=person.photo || "";
        photo.alt=person.name;
        photo.decoding="async";
        const name=element("h2","speaker-name",person.name);
        const role=element("p","speaker-role",person.role);
        card.append(photo,name,role);grid.append(card);
        speakerCards.push({photo,name,role});
      });
      host.append(grid);
    }
    if (slide.id === "opening") {
      const support = element("p", "title-support");
      renderOpeningSupport(support, slide.support);
      block.append(support);
      main.updateSupport = value => renderOpeningSupport(support, value);
    }
    if (editTextButton) {
    const editor = element("div", "title-inline-editor");
    editor.hidden = true;
    editor.append(element("h2", "", "Edit title slide"));
    function saveSlide() {
      try { localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(titleConfiguration)); }
      catch (error) { console.warn("Presentation titles could not be saved.", error); }
      stateLabel.title = "Copy " + current.step.paneId + " · " + slide.title;
    }
    function addField(label, value, update, multiline = false) {
      const wrapper = element("label", "title-edit-field");
      wrapper.append(element("span", "", label));
      const input = element(multiline ? "textarea" : "input");
      if (!multiline) input.type = "text";
      input.value = value;
      input.addEventListener("input", () => { update(input.value); saveSlide(); });
      wrapper.append(input);
      editor.append(wrapper);
    }
    if (!isSpeakers) {
      addField("Main title", slide.title, value => {
        slide.title = value; titleText.textContent = value;
        main.setAttribute("aria-label", "Presentation title: " + value);
      });
      addField("Subtitle", slide.subtitle || "", value => {
        slide.subtitle = value; subtitle.textContent = value; subtitle.hidden = !value;
      });
    }
    if (slide.id === "opening") addField("Presenters, date, and institution (one line each)",
      slide.support || "", value => { slide.support = value; main.updateSupport(value); }, true);
    if (isSpeakers) (slide.speakers || []).forEach((person,index) => {
      addField(`Speaker ${index+1} name`,person.name,value => {
        person.name=value;speakerCards[index].name.textContent=value;
        speakerCards[index].photo.alt=value;
      });
      addField(`Speaker ${index+1} role`,person.role,value => {
        person.role=value;speakerCards[index].role.textContent=value;
      });
    });
    agendaRows.forEach((row, index) => addField("Agenda item " + (index+1),
      slide.agenda[index], value => { slide.agenda[index] = value; row.textContent = value; }));
    const done = element("button", "editor-button", "Done");
    done.type = "button";
    done.addEventListener("click", () => { editor.hidden = true; editTextButton.focus(); });
    editor.append(done);
    stage.append(editor);
    editTextButton.addEventListener("click", () => {
      editor.hidden = !editor.hidden;
      if (!editor.hidden) editor.querySelector("input")?.focus();
    });
    }
  }
  if (slide?.id !== "opening" || isClosing) {
    if (!persistentModelLink)
      persistentModelLink=createModelLink(host,{variant:"small",onActivate:enterLiveModel});
    else persistentModelLink.attach(host);
  }
  stage.append(pane);
  const navigationHint = element("div", "navigation-hint");
  navigationHint.innerHTML = '<span><kbd>Space</kbd> or click <span class="hint-action">next</span></span><span><kbd>←</kbd> previous</span><span><kbd>→</kbd> next</span>';
  stage.append(navigationHint);
  const error = element("p", "preview-error");
  error.hidden = true;
  main.append(toolbar, configPanel, stage, error);
  replaceView(main);

  function applyDisplayMode() {
    main.classList.toggle("is-presenting", displayMode === "presentation");
    const label = displayMode === "presentation" ? "Exit full screen" : "Enter full screen";
    fullButton.setAttribute("aria-label", label);
    fullButton.title = label;
    requestAnimationFrame(updateViewportAspect);
  }
  main.showDisplayMode = applyDisplayMode;
  fullButton.addEventListener("click", () => toggleFullscreen(main));
  pane.addEventListener("click", event => {
    if (event.button !== 0 || event.detail > 1) return;
    navigateExhibit(1);
  });
  applyDisplayMode();

  if (isContent) {
    activeStep = current.step;
    activeContent = createUnderHoodDiagram(host);
    main.showContentBeat = beat => {
      if (beat) activeContent.reveal();
      else activeContent.reset();
      navigationHint.querySelector(".hint-action").textContent = beat ? "next" : "reveal";
    };
    main.showContentBeat(pendingContentBeat);
    pendingContentBeat = 0;
    pane.classList.add("is-ready");
    requestAnimationFrame(() => requestAnimationFrame(clearTransition));
    return;
  }

  if (isTitle) {
    activeStep = current.step;
    showState(0);
    pane.classList.add("is-ready");
    if (["opening","results"].includes(slide.id)) {
      const ambient = element("iframe", "authentic-horizon-frame");
      ambient.title = "Decorative SBI Horizon View";
      ambient.tabIndex = -1;
      ambient.setAttribute("aria-hidden", "true");
      ambient.src = new URL("./integrated-sbi/?ambient=carousel", import.meta.url).href;
      host.prepend(ambient);
      const revealHorizon = setInterval(() => {
        if (!ambient.isConnected) { clearInterval(revealHorizon); return; }
        try {
          const body = ambient.contentDocument?.body;
          if (body?.classList.contains("idleMode") &&
              ["trace-outline", "fill-country", "stamp-sites", "settle-sites",
                "reveal-satellites", "dwell"].includes(body.dataset.carouselStage)) {
            ambient.classList.add("is-ready");
            clearInterval(revealHorizon);
          }
        } catch { /* The local frame is still loading. */ }
      }, 180);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTransition();
    }));
    return;
  }

  try {
    // A route opened in a long-lived development tab must load the current
    // exhibit module after local edits, not an earlier module-map instance.
    const module = await import(exhibit.module + "?session=" + moduleSession);
    if (version !== routeVersion) return;
    const instance = await module.createAnimation(host, { onStateChange: showState });
    if (version !== routeVersion) {
      instance.destroy();
      return;
    }
    activeExhibit = instance;
    if (instance.stateCount !== exhibit.states.length)
      throw new Error("Manifest state count differs from exhibit module");
    if (startAtEnd) instance.jumpToState?.(instance.stateCount - 1);
    else if (requestedState !== null && requestedState >= 0 && requestedState < instance.stateCount)
      instance.jumpToState?.(requestedState);
    instance.start();
    activeStep = current.step;
    if (current.step) startStepPhases(current.step,
      startAtEnd ? current.step.end :
        current.step.panes.includes(requestedState) ? requestedState : current.step.start);
    pane.classList.add("is-ready");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      clearTransition();
    }));
  } catch (problem) {
    if (version !== routeVersion) return;
    console.error(problem);
    error.hidden = false;
    error.textContent = "Exhibit could not start: " + problem.message;
    clearTransition();
  }
}

function render() {
  routeVersion += 1;
  cancelPhases();
  clearTimeout(modelLoadTimer);
  clearTimeout(paneToastTimer);
  const current = route();
  if (current.page !== "index" && app.firstElementChild) showTransition();
  activeExhibit?.destroy();
  activeExhibit = null;
  activeContent?.destroy();
  activeContent = null;
  if (current.page === "model") {
    activeStep = null;
    liveModelView();
  } else if (current.page === "end") {
    const end = element("main", "presentation-end");
    end.append(element("h1", "", "Presentation complete"));
    const restart = element("a", "landing-action landing-action-primary", "Return to beginning");
    restart.href = stepHref(steps()[0]);
    end.append(restart);
    replaceView(end);
    clearTransition();
  } else if (current.page === "exhibit" || current.page === "content") {
    deck(current, routeVersion);
  } else if (current.page === "title") {
    activeStep = current.step;
    deck(current, routeVersion);
  } else {
    activeStep = null;
    persistentModelLink?.dispose();
    persistentModelLink = null;
    if (document.fullscreenElement === app) document.exitFullscreen().catch(console.warn);
    displayMode = APP_MODE === "presentation" ? "presentation" : "preview";
    launchMode = "full";
    exhibitIndex(current);
    clearTransition();
  }
}

function navigateExhibit(direction) {
  const current = route();
  if (!["exhibit","title","content"].includes(current.page)) return;
  if (current.page === "content" && activeContent) {
    if (direction > 0 && !activeContent.isRevealed()) {
      app.querySelector(".deck")?.showContentBeat(1);
      return;
    }
    if (direction < 0 && activeContent.isRevealed()) {
      app.querySelector(".deck")?.showContentBeat(0);
      return;
    }
  }
  const sequence = steps();
  const position = sequence.findIndex(item => item.id === current.step?.id);
  if (position < 0) return;
  const next = sequence[position + direction];
  if (!next) return;
  cancelPhases();
  if (next.kind === "exhibit" && current.page === "exhibit" &&
      next.exhibit.id === current.exhibit.id && activeExhibit) {
    activeStep = next;
    app.querySelector(".deck").dataset.stepId = next.id;
    if (direction < 0) activeExhibit.jumpToState?.(next.end);
    else activeExhibit.goToState?.(next.start);
    history.replaceState(null, "", stepHref(next));
    hidePaneId();
    if (direction > 0) startStepPhases(next);
  } else {
    pendingContentBeat = next.kind === "content" && direction < 0 ? 1 : 0;
    location.hash = stepHref(next);
  }
}

window.addEventListener("hashchange", render);
window.addEventListener("message", event => {
  if (route().page !== "model" || !modelContext ||
      event.origin !== new URL(liveModelUrl).origin ||
      event.source !== app.querySelector(".live-model-frame")?.contentWindow ||
      event.data?.token !== modelContext.token) return;
  if (event.data.type === "sbi-carousel:ready") {
    clearTimeout(modelLoadTimer);
    const status = app.querySelector(".live-model-status");
    if (status) status.hidden = true;
    clearTransition();
  } else if (event.data.type === "sbi-carousel:return") returnFromLiveModel();
});
document.addEventListener("fullscreenchange", () => {
  displayMode = document.fullscreenElement === app ? "presentation" : "preview";
  if (displayMode === "preview") lastFullscreenExit = performance.now();
  app.querySelector(".deck")?.showDisplayMode();
  if (document.fullscreenElement === app) {
    pendingFullscreenRestore = false;
    app.querySelector(".restore-fullscreen")?.remove();
  }
  requestAnimationFrame(updateViewportAspect);
});
window.addEventListener("resize", updateViewportAspect);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) activeExhibit?.pause();
  else activeExhibit?.start();
});
window.addEventListener("keydown", event => {
  if (event.target.closest?.("input, textarea, select")) return;
  const current = route();
  if (!["exhibit","title","content"].includes(current.page) ||
    !["Space", "ArrowRight", "ArrowLeft", "Escape", "KeyF", "KeyI"].includes(event.code)) return;
  event.preventDefault();
  if (event.code === "KeyI") {
    showPaneToast(activeStep || current.step);
    return;
  }
  if (event.code === "Escape") {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (performance.now() - lastFullscreenExit < 250) return;
    else if (displayMode === "presentation") {
      displayMode = "preview";
      app.querySelector(".deck")?.showDisplayMode();
    } else location.hash = "#/";
    return;
  }
  if (event.code === "KeyF") {
    const main = app.querySelector(".deck");
    if (main) toggleFullscreen(main);
    return;
  }
  navigateExhibit(event.code === "ArrowLeft" ? -1 : 1);
});
updateViewportAspect();
render();
