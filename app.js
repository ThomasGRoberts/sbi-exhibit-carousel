import { APP_MODE } from "./config.js";
import { presenters, exhibits, stateId } from "./manifest.js";

const app = document.getElementById("app");
let activeExhibit = null;
let routeVersion = 0;
let displayMode = APP_MODE === "presentation" ? "presentation" : "preview";
let lastFullscreenExit = -Infinity;
const moduleSession = Date.now().toString(36);

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const id = parts[0] === "exhibit" ? parts[1] :
    parts[0] === "catalog" ? parts[3] :
    presenters.some(p => p.id === parts[0]) ? parts[1] : null;
  const exhibit = exhibits.find(item => item.id === id);
  const match = parts[2]?.match(/^(\d{2})\.(\d{2})$/);
  const requestedState = match && exhibit && Number(match[1]) === exhibit.number ?
    Number(match[2]) - 1 : null;
  return { page: exhibit ? "exhibit" : "index", exhibit,
    startAtEnd: parts.at(-1) === "last", requestedState };
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
  const row = element("a", "sequence-row");
  row.href = exhibitHref(exhibit);
  row.setAttribute("aria-label", "Open Exhibit " + String(exhibit.number).padStart(2, "0") +
    ": " + exhibit.title);
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

function exhibitIndex() {
  const main = element("main", "dashboard");
  main.style.setProperty("--exhibit-count", String(Math.max(1, exhibits.length)));
  const content = element("div", "dashboard-content");
  const list = element("div", "sequence-list");
  if (exhibits.length === 0) {
    list.append(element("p", "empty-state", "No exhibits yet."));
  } else {
    exhibits.forEach(exhibit => list.append(exhibitRow(exhibit)));
  }
  content.append(list);
  main.append(content);
  const mark = element("img", "directory-logo");
  mark.src = "assets/ESPL.png"; mark.alt = ""; mark.setAttribute("aria-hidden", "true");
  main.append(mark);
  app.replaceChildren(main);
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
  const { exhibit, startAtEnd, requestedState } = current;
  const main = element("main", "deck");
  main.setAttribute("aria-label", "Exhibit " + String(exhibit.number).padStart(2, "0") +
    ": " + exhibit.title);
  const toolbar = element("div", "preview-toolbar");
  const back = makeBackLink("#/");
  const fullButton = element("button", "fullscreen-button");
  fullButton.type = "button";
  fullButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5m0 8v5h-5M8 21H3v-5"></path></svg>';
  toolbar.append(back, fullButton);
  const stage = element("div", "preview-stage");
  const switcher = element("div", "exhibit-switcher");
  const switcherCue = element("span", "exhibit-switcher-cue", "Click to choose exhibit");
  const heading = element("h1", "exhibit-heading");
  const exhibitSelect = element("select", "exhibit-select");
  exhibitSelect.setAttribute("aria-label", "Jump to exhibit");
  for (const item of exhibits) {
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
  commentLog.href = "https://docs.google.com/spreadsheets/d/1X7T9abmO9xWdtuP31w-Ovz2D5K5y-PY4jn4uxDlkjQ4/edit?gid=0#gid=0";
  commentLog.target = "_blank";
  commentLog.rel = "noopener noreferrer";
  let copyTimer;
  const previewMeta = element("div", "preview-meta");
  feedback.append(paneControl, commentLog);
  previewMeta.append(switcher, feedback);
  stage.append(previewMeta);
  function showState(index) {
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
  pane.setAttribute("aria-label", "Exhibit visualization");
  const host = element("div", "animation-host");
  const logo = element("img", "presentation-logo");
  logo.src = "assets/ESPL.png";
  logo.alt = "";
  logo.setAttribute("aria-hidden", "true");
  pane.append(host, logo);
  stage.append(pane);
  const navigationHint = element("div", "navigation-hint");
  navigationHint.innerHTML = '<span><kbd>Space</kbd> or click <span class="hint-action">next</span></span><span><kbd>←</kbd> previous</span><span><kbd>→</kbd> next</span>';
  stage.append(navigationHint);
  const error = element("p", "preview-error");
  error.hidden = true;
  main.append(toolbar, stage, error);
  app.replaceChildren(main);

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
    pane.classList.add("is-ready");
  } catch (problem) {
    if (version !== routeVersion) return;
    console.error(problem);
    error.hidden = false;
    error.textContent = "Exhibit could not start: " + problem.message;
  }
}

function render() {
  routeVersion += 1;
  activeExhibit?.destroy();
  activeExhibit = null;
  const current = route();
  if (current.page === "exhibit") {
    deck(current, routeVersion);
  } else {
    displayMode = APP_MODE === "presentation" ? "presentation" : "preview";
    exhibitIndex(current);
  }
}

function navigateExhibit(direction) {
  const current = route();
  if (current.page !== "exhibit" || !activeExhibit) return;
  const handled = direction > 0 ? activeExhibit.next?.() : activeExhibit.previous?.();
  if (handled) return;
  const position = exhibits.findIndex(item => item.id === current.exhibit.id);
  const next = exhibits[position + direction];
  if (next) location.hash = exhibitHref(next, direction < 0);
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
  if (current.page !== "exhibit" ||
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
