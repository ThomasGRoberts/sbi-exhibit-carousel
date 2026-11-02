// The presentation order, title insertions, and logical pane groups live here.
export const TITLE_STORAGE_KEY = "sbi-carousel-presentation-titles-v1";
export const defaultTitleConfiguration = {
  schemaVersion: 2,
  enabled: true,
  slides: [
    { id:"opening", type:"title", title:"Exploring SBI Architectures",
      subtitle:"Space-Based Interceptors & Strategic Stability",
      support:"Fernando Miranda España · Nathan O'Brien · November 2, 2026",
      agenda:[], highlight:0, before:"geographic-input", enabled:true },
    { id:"threat-region", type:"agenda", title:"How Do We Characterize a Threat?",
      subtitle:"", agenda:["Geographic Region","Salvo Size"], highlight:0,
      before:"geographic-input", enabled:true },
    { id:"threat-salvo", type:"agenda", title:"How Do We Characterize a Threat?",
      subtitle:"", agenda:["Geographic Region","Salvo Size"], highlight:1,
      before:"missile-salvo", enabled:true },
    { id:"developing-scenarios", type:"title", title:"Developing Missile Threat Scenarios",
      subtitle:"", agenda:[], highlight:0, before:"threat-scenarios", enabled:true },
    { id:"results", type:"visual", title:"Explore the Interactive Model",
      subtitle:"", agenda:[], highlight:0, before:"gps-constellation",
      action:"model", enabled:true },
    { id:"established-approach", type:"title",
      title:"Established Approach",
      subtitle:"to satellite constellation optimization",
      agenda:[], highlight:0, before:"gps-constellation", enabled:true },
    { id:"our-approach", type:"title", title:"Our Approach",
      subtitle:"to space-based interceptor constellation optimization",
      agenda:[], highlight:0, before:"ground-track", enabled:true },
    { id:"under-the-hood", type:"title", title:"What's Happening Under the Hood?",
      subtitle:"", agenda:[], highlight:0, before:"sbi-optimization", enabled:true }
  ]
};

export const paneGroups = {
  "geographic-input": [[0,2],[3,5]],
  "missile-salvo": [[0,1,2]],
  "threat-scenarios": [[0],[1],[2],[3],[4],[5,6,7],[8]],
  "gps-constellation": [[0,1]],
  "ground-track": [[0],[1],[2,3,4,5,6]]
};

// Milliseconds spent showing each internal phase before the next phase starts.
export const phaseDurations = {
  "geographic-input": {0:2850,3:2550},
  "gps-constellation": {0:1150},
  "missile-salvo": {0:850,1:1800},
  "threat-scenarios": {5:2100,6:1500},
  "ground-track": {2:2250,3:2250,4:2250,5:2250}
};

export function titlePaneId(slide, exhibits) {
  if (slide.id === "opening") return "00.00-opening";
  const number = exhibits.find(item => item.id === slide.before)?.number ?? 0;
  return String(number).padStart(2,"0")+".00-"+slide.id;
}

export function loadTitleConfiguration() {
  try {
    const saved = JSON.parse(localStorage.getItem(TITLE_STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.slides)) {
      if (saved.schemaVersion !== 2) {
        const opening = defaultTitleConfiguration.slides[0];
        if (!saved.slides.some(item => item.id === "opening"))
          saved.slides.unshift(structuredClone(opening));
        saved.schemaVersion = 2;
      }
      const openingIndex = saved.slides.findIndex(slide => slide.id === "opening");
      if (openingIndex > 0) saved.slides.unshift(saved.slides.splice(openingIndex, 1)[0]);
      const results = saved.slides.find(slide => slide.id === "results");
      if (results) {
        if (results.title === "Let's See Some Results")
          results.title = "Explore the Interactive Model";
        results.type = "visual";
      }
      // Preserve browser edits while updating the unchanged prior default.
      const established = saved.slides.find(slide => slide.id === "established-approach");
      if (established?.title === "The Established Approach to Constellation Optimization" &&
          !established.subtitle) {
        established.title = "The Established Approach";
        established.subtitle = "To Satellite Constellation Optimization";
      }
      if (established?.title === "The Established Approach")
        established.title = "Established Approach";
      if (established?.subtitle === "To Satellite Constellation Optimization")
        established.subtitle = "to satellite constellation optimization";
      const ourApproach = saved.slides.find(slide => slide.id === "our-approach");
      if (ourApproach?.subtitle === "To Space-Based Interceptor Constellation Optimization")
        ourApproach.subtitle = "to space-based interceptor constellation optimization";
      return saved;
    }
  } catch (error) { console.warn("Presentation titles could not be restored.", error); }
  return structuredClone(defaultTitleConfiguration);
}

export function buildPresentationSteps(exhibits, selection, config) {
  const steps = [];
  const opening = config.enabled && config.slides.find(slide =>
    slide.id === "opening" && slide.enabled);
  if (opening) steps.push({ id:"title-opening", kind:"title", slide:opening,
    paneId:titlePaneId(opening,exhibits), action:null });
  for (const exhibit of exhibits) {
    if (!selection.has(exhibit.id)) continue;
    if (config.enabled) for (const slide of config.slides) {
      if (slide.id !== "opening" && slide.enabled && slide.before === exhibit.id)
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
