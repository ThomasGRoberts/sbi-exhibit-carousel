import { buildPresentationSteps, titlePaneId } from "./presentation-sequence.js";

function node(tag, className, text) {
  const value = document.createElement(tag);
  value.className = className;
  if (text) value.textContent = text;
  return value;
}

export function buildTitleEditor(exhibits, selection, config, onChange, onPreview) {
  const panel = node("section", "title-editor");
  const heading = node("h2", "", "Presentation Titles");
  const intro = node("p", "editor-intro",
    "Edit title slides here. Changes affect the carousel immediately and are saved in this browser.");
  const controls = node("div", "editor-controls");
  const add = node("button", "editor-button", "Add title slide");
  add.type = "button";
  add.addEventListener("click", () => {
    config.slides.push({ id:"custom-"+Date.now().toString(36), type:"title",
      title:"New Title", subtitle:"", agenda:[], highlight:0,
      before:exhibits[0].id, enabled:true });
    changed();
  });
  const exportButton = node("button", "editor-button", "Export Title Configuration");
  exportButton.type = "button";
  exportButton.addEventListener("click", () => {
    const data = { version:2,
      instructions:"In presentation-sequence.js, replace defaultTitleConfiguration with this configuration. The opening slide always precedes enabled exhibits. Other slides' before fields place them immediately before their exhibits. action: model uses the SBI model shortcut. Individual enabled fields control playback; the launch mode chooses whether supplementary slides are included.",
      ...config,
      slides:config.slides.map(slide => ({
        ...slide, paneId:titlePaneId(slide,exhibits),
        associatedExhibit:slide.before
      })) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)+"\n"],
      {type:"application/json"}));
    const link = node("a", "");
    link.href = url; link.download = "geneva-carousel-title-configuration.json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  controls.append(add, exportButton);
  const cards = node("div", "editor-cards");
  const previewTitle = node("h3", "", "Presentation sequence preview");
  const preview = node("ol", "sequence-preview");
  function changed() {
    config.slides.sort((a,b) => exhibits.findIndex(item => item.id === a.before) -
      exhibits.findIndex(item => item.id === b.before));
    onChange(config);
    draw();
  }
  function field(label, value, change, multiline = false) {
    const wrapper = node("label", "editor-field");
    wrapper.append(node("span", "", label));
    const input = node(multiline ? "textarea" : "input", "");
    if (!multiline) input.type = "text";
    input.value = value;
    input.addEventListener("input", () => { change(input.value); onChange(config); drawPreview(); });
    wrapper.append(input);
    return wrapper;
  }
  function drawPreview() {
    preview.replaceChildren();
    for (const step of buildPresentationSteps(exhibits, selection, config)) {
      const item = node("li", "", step.kind === "title" ?
        step.paneId+" · Title · "+step.slide.title+(step.slide.type === "agenda" ?
          " — "+(step.slide.agenda[step.slide.highlight] || "") : "") :
        "Exhibit "+String(step.exhibit.number).padStart(2,"0")+" · "+
          step.panes.map(index => String(step.exhibit.number).padStart(2,"0")+"."+
            String(index+1).padStart(2,"0")).join("–"));
      const button = node("button", "preview-step", "Preview");
      button.type = "button"; button.addEventListener("click", () => onPreview(step));
      item.append(button); preview.append(item);
    }
  }
  function draw() {
    cards.replaceChildren();
    config.slides.forEach((slide, index) => {
      const card = node("article", "editor-card");
      const bar = node("div", "editor-card-bar");
      const enabled = node("label", "editor-toggle");
      const check = node("input", "");
      check.type = "checkbox"; check.checked = slide.enabled;
      check.addEventListener("change", () => { slide.enabled = check.checked; changed(); });
      enabled.append(check, node("span", "", "Slide "+(index+1)));
      const moveUp = node("button", "editor-small-button", "↑");
      moveUp.type = "button"; moveUp.title = "Move earlier";
      moveUp.disabled = index === 0 || config.slides[index-1]?.id === "opening";
      moveUp.addEventListener("click", () => {
        [config.slides[index-1].before,config.slides[index].before] =
          [config.slides[index].before,config.slides[index-1].before];
        [config.slides[index-1], config.slides[index]] =
          [config.slides[index], config.slides[index-1]]; changed();
      });
      const moveDown = node("button", "editor-small-button", "↓");
      moveDown.type = "button"; moveDown.title = "Move later";
      moveDown.disabled = index === config.slides.length-1 || slide.id === "opening";
      moveDown.addEventListener("click", () => {
        [config.slides[index+1].before,config.slides[index].before] =
          [config.slides[index].before,config.slides[index+1].before];
        [config.slides[index+1], config.slides[index]] =
          [config.slides[index], config.slides[index+1]]; changed();
      });
      const remove = node("button", "editor-small-button", "Remove");
      remove.type = "button";
      remove.disabled = slide.id === "opening";
      remove.addEventListener("click", () => { config.slides.splice(index,1); changed(); });
      bar.append(enabled,moveUp,moveDown,remove);
      const type = node("select", "editor-select");
      for (const kind of slide.id === "results" ? ["visual"] : ["title","agenda"]) {
        const option = node("option", "", kind === "title" ? "Title" :
          kind === "agenda" ? "Agenda" : "Visual model invitation");
        option.value = kind; type.append(option);
      }
      type.value = slide.type;
      type.addEventListener("change", () => { slide.type = type.value; changed(); });
      const position = node("select", "editor-select");
      for (const exhibit of exhibits) {
        const option = node("option", "", "Before Exhibit "+String(exhibit.number).padStart(2,"0"));
        option.value = exhibit.id; position.append(option);
      }
      position.value = slide.before;
      position.hidden = slide.id === "opening";
      position.addEventListener("change", () => { slide.before = position.value; changed(); });
      const agenda = field("Agenda items (one per line)", (slide.agenda||[]).join("\n"),
        value => { slide.agenda = value.split("\n").map(item => item.trim()).filter(Boolean); }, true);
      agenda.querySelector("textarea").addEventListener("blur", draw);
      agenda.hidden = slide.type !== "agenda";
      const highlight = node("select", "editor-select");
      (slide.agenda||[]).forEach((item, itemIndex) => {
        const option = node("option", "", "Highlight: "+item);
        option.value = String(itemIndex); highlight.append(option);
      });
      highlight.value = String(slide.highlight||0);
      highlight.hidden = slide.type !== "agenda";
      highlight.addEventListener("change", () => { slide.highlight = Number(highlight.value); changed(); });
      const actionLabel = node("label", "editor-toggle");
      const action = node("input", ""); action.type = "checkbox"; action.checked = slide.action === "model";
      action.addEventListener("change", () => { slide.action = action.checked ? "model" : undefined; changed(); });
      actionLabel.append(action,node("span", "", "Show SBI model shortcut"));
      actionLabel.hidden = slide.id !== "results";
      card.append(bar, field("Title",slide.title,value => { slide.title=value; }),
        field("Subtitle",slide.subtitle||"",value => { slide.subtitle=value; }),
        ...(slide.id === "opening" ? [field("Presenters and date",slide.support||"",
          value => { slide.support=value; })] : []),
        type,position,agenda,highlight,actionLabel);
      cards.append(card);
    });
    drawPreview();
  }
  panel.append(heading,intro,controls,cards,previewTitle,preview);
  draw();
  panel.refresh = drawPreview;
  panel.exportConfiguration = () => exportButton.click();
  return panel;
}
