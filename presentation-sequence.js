// The presentation order, title insertions, and logical pane groups live here.
export const TITLE_STORAGE_KEY = "sbi-carousel-presentation-titles-v1";
export const defaultTitleConfiguration = {
  enabled: true,
  slides: [
    { id:"threat-region", type:"agenda", title:"How Do We Characterize a Threat?",
      subtitle:"", agenda:["Geographic Region","Salvo Size"], highlight:0,
      before:"geographic-input", enabled:true },
    { id:"threat-salvo", type:"agenda", title:"How Do We Characterize a Threat?",
      subtitle:"", agenda:["Geographic Region","Salvo Size"], highlight:1,
      before:"missile-salvo", enabled:true },
    { id:"developing-scenarios", type:"title", title:"Developing Missile Threat Scenarios",
      subtitle:"", agenda:[], highlight:0, before:"threat-scenarios", enabled:true },
    { id:"results", type:"title", title:"Let's See Some Results",
      subtitle:"", agenda:[], highlight:0, before:"gps-constellation",
      action:"model", enabled:true },
    { id:"established-approach", type:"title",
      title:"The Established Approach",
      subtitle:"To Satellite Constellation Optimization",
      agenda:[], highlight:0, before:"gps-constellation", enabled:true },
    { id:"our-approach", type:"title", title:"Our Approach",
      subtitle:"To Space-Based Interceptor Constellation Optimization",
      agenda:[], highlight:0, before:"ground-track", enabled:true },
    { id:"under-the-hood", type:"title", title:"What's Happening Under the Hood?",
      subtitle:"", agenda:[], highlight:0, before:"sbi-optimization", enabled:true }
  ]
};

export const paneGroups = {
  "geographic-input": [[0],[1],[2],[3,4,5]],
  "missile-salvo": [[0,1,2]],
  "threat-scenarios": [[0],[1],[2],[3],[4],[5,6,7],[8]],
  "gps-constellation": [[0,1]],
  "ground-track": [[0],[1],[2,3,4,5,6]]
};

// Milliseconds spent showing each internal phase before the next phase starts.
export const phaseDurations = {
  "geographic-input": {3:2550,4:3000},
  "gps-constellation": {0:1150},
  "missile-salvo": {0:850,1:1800},
  "threat-scenarios": {5:2100,6:1500},
  "ground-track": {2:2250,3:2250,4:2250,5:2250}
};

export function titlePaneId(slide, exhibits) {
  const number = exhibits.find(item => item.id === slide.before)?.number ?? 0;
  return String(number).padStart(2,"0")+".00-"+slide.id;
}

export function loadTitleConfiguration() {
  try {
    const saved = JSON.parse(localStorage.getItem(TITLE_STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.slides)) {
      // Preserve browser edits while updating the unchanged prior default.
      const established = saved.slides.find(slide => slide.id === "established-approach");
      if (established?.title === "The Established Approach to Constellation Optimization" &&
          !established.subtitle) {
        established.title = "The Established Approach";
        established.subtitle = "To Satellite Constellation Optimization";
      }
      return saved;
    }
  } catch (error) { console.warn("Presentation titles could not be restored.", error); }
  return structuredClone(defaultTitleConfiguration);
}

export function buildPresentationSteps(exhibits, selection, config) {
  const steps = [];
  for (const exhibit of exhibits) {
    if (!selection.has(exhibit.id)) continue;
    if (config.enabled) for (const slide of config.slides) {
      if (slide.enabled && slide.before === exhibit.id)
        steps.push({ id:"title-"+slide.id, kind:"title", slide,
          paneId:titlePaneId(slide,exhibits),
          action:slide.id==="results"&&slide.action==="model"?"model":null });
    }
    const groups = paneGroups[exhibit.id] ||
      exhibit.states.map((_, index) => [index]);
    for (const panes of groups) steps.push({
      id:exhibit.id+"-"+panes[0], kind:"exhibit", exhibit, panes,
      start:panes[0], end:panes.at(-1)
    });
  }
  return steps;
}
