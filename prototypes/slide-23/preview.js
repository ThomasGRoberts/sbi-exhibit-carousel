import { createUnderHoodDiagram } from "../../animations/under-the-hood.js?all-visible-1";

const slide=document.getElementById("slide");
createUnderHoodDiagram(slide);
const fullscreen=document.getElementById("fullscreen");
fullscreen.addEventListener("click",()=>slide.requestFullscreen());
document.addEventListener("fullscreenchange",()=>{
  const active=document.fullscreenElement===slide;
  fullscreen.setAttribute("aria-label",active?"Exit full screen":"Enter full screen");
  fullscreen.title=active?"Exit full screen":"Enter full screen";
});
function updateAspect() {
  slide.style.setProperty("--screen-aspect",`${window.innerWidth} / ${window.innerHeight}`);
  slide.style.setProperty("--screen-ratio",String(window.innerWidth/window.innerHeight));
}
window.addEventListener("resize",updateAspect);
updateAspect();
