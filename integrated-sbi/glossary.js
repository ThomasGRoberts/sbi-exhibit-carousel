/* Project glossary annotations; the published sheet is read on every refresh. */
import { parseCsvTable } from "./scenario-detail.js?v=eci-refinement-1";
const panel = document.getElementById("ui");
const popover = document.createElement("div");
popover.id = "glossaryPopover";
popover.className = "glossaryPopover";
popover.role = "dialog";
popover.setAttribute("aria-label", "Glossary definition");
popover.hidden = true;
document.body.append(popover);

let activeTrigger = null;
let hideTimer = null;
let matchExpression = null;
let matchEntries = new Map();

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[’']/g, "[’']");
}

function closePopover() {
  clearTimeout(hideTimer);
  popover.hidden = true;
  if (activeTrigger) activeTrigger.setAttribute("aria-expanded", "false");
  activeTrigger = null;
}

function scheduleClose() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(closePopover, 180);
}

function showPopover(trigger, entry) {
  clearTimeout(hideTimer);
  if (activeTrigger && activeTrigger !== trigger) activeTrigger.setAttribute("aria-expanded", "false");
  activeTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");
  const heading = document.createElement("strong");
  heading.textContent = entry.acronym
    ? `${entry.term} (${entry.acronym})`
    : entry.term;
  const definition = document.createElement("p");
  definition.textContent = entry.definition;
  const sources = document.createElement("div");
  sources.className = "glossarySources";
  entry.sources.forEach((source, idx) => {
    if (idx) sources.append(document.createTextNode(" · "));
    if (source.url) {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = source.label;
      link.classList.add("espl-news-external");
      link.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path class="espl-news-external__box" d="M7.25 4.25H4.5A1.75 1.75 0 0 0 2.75 6v7.5a1.75 1.75 0 0 0 1.75 1.75H12a1.75 1.75 0 0 0 1.75-1.75v-2.75"></path><g class="espl-news-external__arrow"><path d="M9.25 2.75h6v6"></path><path d="m8 10 7.25-7.25"></path></g></svg>');
      sources.append(link);
    } else {
      sources.append(document.createTextNode(source.label));
    }
  });
  popover.replaceChildren(heading, definition, sources);
  popover.hidden = false;
  const bounds = trigger.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  const left = Math.max(10, Math.min(bounds.left, window.innerWidth - width - 10));
  const above = bounds.bottom + height + 10 > window.innerHeight && bounds.top > height + 10;
  const top = above ? bounds.top - height - 7 : bounds.bottom + 7;
  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(8, top)}px`;
}

function makeTrigger(displayText, entry) {
  const trigger = document.createElement("span");
  trigger.className = "glossaryTrigger";
  trigger.tabIndex = 0;
  trigger.role = "button";
  trigger.setAttribute("aria-label", `Define ${displayText}`);
  trigger.setAttribute("aria-expanded", "false");
  trigger.textContent = displayText;
  trigger.addEventListener("mouseenter", () => showPopover(trigger, entry));
  trigger.addEventListener("mouseleave", scheduleClose);
  trigger.addEventListener("focus", () => showPopover(trigger, entry));
  trigger.addEventListener("blur", event => {
    if (!popover.contains(event.relatedTarget)) scheduleClose();
  });
  trigger.addEventListener("click", event => {
    event.stopPropagation();
    showPopover(trigger, entry);
  });
  trigger.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      trigger.click();
    }
  });
  return trigger;
}

function annotateTextNode(node) {
  const value = node.nodeValue;
  if (!value || !matchExpression) return;
  matchExpression.lastIndex = 0;
  let match;
  let cursor = 0;
  const fragment = document.createDocumentFragment();
  let found = false;
  while ((match = matchExpression.exec(value))) {
    const prefixLength = match[1].length;
    const start = match.index + prefixLength;
    const displayText = match[2];
    const entry = matchEntries.get(displayText.toLocaleLowerCase());
    if (!entry) continue;
    fragment.append(document.createTextNode(value.slice(cursor, start)));
    fragment.append(makeTrigger(displayText, entry));
    cursor = start + displayText.length;
    found = true;
  }
  if (!found) return;
  fragment.append(document.createTextNode(value.slice(cursor)));
  node.replaceWith(fragment);
}

function annotatePanel() {
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".glossaryTrigger, button, a, select, option, script, style, .legacyPanelData, .scenarioLocationCaptionContent h3, .scenarioDetailMap")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(annotateTextNode);
}

function parseLiveGlossary(csvText, project) {
  const [header, ...records] = parseCsvTable(csvText);
  if (!header?.includes("Project") || !header.includes("Term") ||
      !header.includes("Definition")) throw new Error("Glossary sheet columns are missing.");
  const entries = records.map(record => Object.fromEntries(
    header.map((key, index) => [key, String(record[index] || "").trim()])
  )).filter(row => row.Project === project && row.Term && row.Definition)
    .map(row => ({
      term: row.Term,
      acronym: row.Acronym || "",
      definition: row.Definition,
      sources: Array.from({ length: 5 }, (_, index) => {
        const label = row[`Source ${index + 1} display`] || "";
        const url = row[`Source ${index + 1} link`] || "";
        return label || url ? { label: label || url, url: url.startsWith("https://") ? url : "" } : null;
      }).filter(Boolean)
    }));
  if (!entries.length) throw new Error("The live glossary has no project entries.");
  return entries;
}

async function initializeGlossary() {
  const response = await fetch("glossary-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Glossary data could not be loaded.");
  const data = await response.json();
  let entries = data.entries;
  try {
    const live = await fetch(`${data.sourceUrl}&refresh=${Date.now()}`, { cache: "no-store" });
    if (!live.ok) throw new Error(`Live glossary returned ${live.status}.`);
    entries = parseLiveGlossary(await live.text(), data.project);
    document.body.dataset.glossarySource = "live";
  } catch (error) {
    console.warn("Live glossary unavailable; using the published snapshot.", error);
    document.body.dataset.glossarySource = "snapshot";
  }
  document.body.dataset.glossaryEntries = String(entries.length);
  const variants = [];
  matchEntries.clear();
  entries.forEach(entry => {
    const labels = [entry.term, ...entry.acronym.split(";").map(value => value.trim())].filter(Boolean);
    labels.forEach(label => {
      matchEntries.set(label.toLocaleLowerCase(), entry);
      variants.push(label);
    });
  });
  variants.sort((a, b) => b.length - a.length);
  matchExpression = new RegExp(`(^|[^A-Za-z0-9])(${variants.map(escapeRegex).join("|")})(?=$|[^A-Za-z0-9])`, "gi");
  annotatePanel();
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; annotatePanel(); }, 0);
  }).observe(panel, { childList: true, characterData: true, subtree: true });
}

popover.addEventListener("mouseenter", () => clearTimeout(hideTimer));
popover.addEventListener("mouseleave", scheduleClose);
document.addEventListener("click", event => {
  if (!popover.contains(event.target) && !event.target.closest?.(".glossaryTrigger")) closePopover();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closePopover();
});
initializeGlossary().catch(console.error);
