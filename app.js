import { APP_MODE } from "./config.js";
import { presenters, exhibits, stateId } from "./manifest.js";
import { createModelLink } from "./model-link.js";
import { buildPresentationSteps, loadTitleConfiguration, phaseDurations,
  TITLE_STORAGE_KEY } from "./presentation-sequence.js";
import { buildTitleEditor } from "./title-editor.js";

const app = document.getElementById("app");
let activeExhibit = null;
let activeStep = null;
let phaseTimer = 0;
let phaseToken = 0;
let transitionLayer = null;
let routeVersion = 0;
let displayMode = APP_MODE === "presentation" ? "presentation" : "preview";
let lastFullscreenExit = -Infinity;
const moduleSession = Date.now().toString(36);
const selectionKey = "sbi-exhibit-carousel-selection-v1";
const commentLogUrl = "https://docs.google.com/spreadsheets/d/1X7T9abmO9xWdtuP31w-Ovz2D5K5y-PY4jn4uxDlkjQ4/edit?gid=0#gid=0";
let titleConfiguration = loadTitleConfiguration();
const steps = () => buildPresentationSteps(exhibits, selectedExhibitIds, titleConfiguration);
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

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "configurations") return {page:"index", showConfig:true};
  if (parts[0] === "present") {
    const step = steps().find(item => item.id === decodeURIComponent(parts[1] || ""));
    if (step?.kind === "title") return {page:"title", step};
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
  const tabs = element("nav", "dashboard-tabs");
  const exhibitsTab = element("button", "dashboard-tab is-active", "Exhibits");
  const configTab = element("button", "dashboard-tab", "Configurations");
  exhibitsTab.type = configTab.type = "button";
  const editor = buildTitleEditor(exhibits, selectedExhibitIds, titleConfiguration, updated => {
    titleConfiguration = updated;
    try { localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(updated)); }
    catch (error) { console.warn("Presentation titles could not be saved.", error); }
  }, step => { location.hash = stepHref(step); });
  editor.hidden = true;
  exhibitsTab.addEventListener("click", () => {
    list.hidden = summary.hidden = false; editor.hidden = true;
    exhibitsTab.classList.add("is-active"); configTab.classList.remove("is-active");
  });
  configTab.addEventListener("click", () => {
    list.hidden = summary.hidden = true; editor.hidden = false;
    configTab.classList.add("is-active"); exhibitsTab.classList.remove("is-active");
    editor.refresh();
  });
  tabs.append(exhibitsTab, configTab);
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
  const comment = element("a", "landing-action landing-action-secondary", "Comment on Carousel");
  comment.href = commentLogUrl; comment.target = "_blank"; comment.rel = "noopener noreferrer";
  actions.append(launch, comment);
  content.append(tabs, summary, list, editor, actions);
  main.append(content);
  const mark = element("img", "directory-logo");
  mark.src = "assets/ESPL.png"; mark.alt = ""; mark.setAttribute("aria-hidden", "true");
  main.append(mark);
  replaceView(main);
  if (current?.showConfig) configTab.click();
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
  const slide = isTitle ? current.step.slide : null;
  const exhibit = isTitle ?
    exhibits.find(item => item.id === slide.before) || exhibits[0] : current.exhibit;
  const { startAtEnd, requestedState } = current;
  const main = element("main", "deck");
  main.dataset.stepId = current.step?.id || "";
  main.setAttribute("aria-label", isTitle ? "Presentation title: " + slide.title :
    "Exhibit " + String(exhibit.number).padStart(2, "0") + ": " + exhibit.title);
  const toolbar = element("div", "preview-toolbar");
  const back = makeBackLink("#/");
  const fullButton = element("button", "fullscreen-button");
  fullButton.type = "button";
  fullButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5m0 8v5h-5M8 21H3v-5"></path></svg>';
  const configButton = element("button", "configuration-button", "Configure");
  configButton.type = "button";
  configButton.addEventListener("click", () => { location.hash = "#/configurations"; });
  const toolbarRight = element("div", "toolbar-right");
  toolbarRight.append(configButton, fullButton);
  toolbar.append(back, toolbarRight);
  const stage = element("div", "preview-stage");
  const switcher = element("div", "exhibit-switcher");
  const switcherCue = element("span", "exhibit-switcher-cue",
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
  const editTextButton = isTitle ? element("button", "title-edit-button", "Edit text") : null;
  if (editTextButton) editTextButton.type = "button";
  feedback.append(paneControl, ...(editTextButton ? [editTextButton] : []), commentLog);
  previewMeta.append(switcher, feedback);
  stage.append(previewMeta);
  function showState(index) {
    if (isTitle) {
      paneValue.textContent = current.step.paneId;
      stateLabel.title = "Copy " + current.step.paneId + " · " + slide.title;
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
  pane.setAttribute("aria-label", isTitle ? "Presentation title" : "Exhibit visualization");
  const host = element("div", "animation-host");
  const logo = element("img", "presentation-logo");
  logo.src = "assets/ESPL.png";
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  pane.append(host, logo);
  if (isTitle) {
    pane.classList.add("title-visualization");
    host.classList.add("title-stage");
    const banner = element("div", "title-banner");
    const block = element("div", "title-block");
    const title = element("h1", "", slide.title);
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
    host.append(banner, block);
    if (current.step.action === "model") {
      main.disposeModelLink = createModelLink(host, {
        variant:"transition", onActivate:() => navigateExhibit(1)
      });
    }
    const editor = element("div", "title-inline-editor");
    editor.hidden = true;
    editor.append(element("h2", "", "Edit title slide"));
    function saveSlide() {
      try { localStorage.setItem(TITLE_STORAGE_KEY, JSON.stringify(titleConfiguration)); }
      catch (error) { console.warn("Presentation titles could not be saved.", error); }
      stateLabel.title = "Copy " + current.step.paneId + " · " + slide.title;
    }
    function addField(label, value, update) {
      const wrapper = element("label", "title-edit-field");
      wrapper.append(element("span", "", label));
      const input = element("input");
      input.type = "text";
      input.value = value;
      input.addEventListener("input", () => { update(input.value); saveSlide(); });
      wrapper.append(input);
      editor.append(wrapper);
    }
    addField("Main title", slide.title, value => {
      slide.title = value; title.textContent = value;
      main.setAttribute("aria-label", "Presentation title: " + value);
    });
    addField("Subtitle", slide.subtitle || "", value => {
      slide.subtitle = value; subtitle.textContent = value; subtitle.hidden = !value;
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
  stage.append(pane);
  const navigationHint = element("div", "navigation-hint");
  navigationHint.innerHTML = '<span><kbd>Space</kbd> or click <span class="hint-action">next</span></span><span><kbd>←</kbd> previous</span><span><kbd>→</kbd> next</span>';
  stage.append(navigationHint);
  const error = element("p", "preview-error");
  error.hidden = true;
  main.append(toolbar, stage, error);
  replaceView(main);

  function applyDisplayMode() {
    main.classList.toggle("is-presenting", displayMode === "presentation");
    const label = displayMode === "presentation" ? "Exit full screen" : "Enter full screen";
    fullButton.setAttribute("aria-label", label);
    fullButton.title = label;
    activeExhibit?.resize();
  }
  main.showDisplayMode = applyDisplayMode;
  fullButton.addEventListener("click", () => toggleFullscreen(main));
  pane.addEventListener("click", event => {
    if (event.button !== 0 || event.detail > 1) return;
    navigateExhibit(1);
  });
  applyDisplayMode();

  if (isTitle) {
    activeStep = current.step;
    showState(0);
    pane.classList.add("is-ready");
    requestAnimationFrame(() => requestAnimationFrame(clearTransition));
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
    requestAnimationFrame(() => requestAnimationFrame(clearTransition));
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
  const current = route();
  if (current.page !== "index" && app.firstElementChild) showTransition();
  app.querySelector(".deck")?.disposeModelLink?.();
  activeExhibit?.destroy();
  activeExhibit = null;
  if (current.page === "exhibit") {
    deck(current, routeVersion);
  } else if (current.page === "title") {
    activeStep = current.step;
    deck(current, routeVersion);
  } else {
    activeStep = null;
    if (document.fullscreenElement === app) document.exitFullscreen().catch(console.warn);
    displayMode = APP_MODE === "presentation" ? "presentation" : "preview";
    exhibitIndex(current);
    clearTransition();
  }
}

function navigateExhibit(direction) {
  const current = route();
  if (!["exhibit","title"].includes(current.page)) return;
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
    if (direction > 0) startStepPhases(next);
  } else location.hash = stepHref(next);
}

window.addEventListener("hashchange", render);
document.addEventListener("fullscreenchange", () => {
  displayMode = document.fullscreenElement === app ? "presentation" : "preview";
  if (displayMode === "preview") lastFullscreenExit = performance.now();
  app.querySelector(".deck")?.showDisplayMode();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) activeExhibit?.pause();
  else activeExhibit?.start();
});
window.addEventListener("keydown", event => {
  if (event.target.closest?.("input, textarea, select")) return;
  const current = route();
  if (!["exhibit","title"].includes(current.page) ||
    !["Space", "ArrowRight", "ArrowLeft", "Escape", "KeyF"].includes(event.code)) return;
  event.preventDefault();
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
render();
