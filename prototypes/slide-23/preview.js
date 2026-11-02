import { createUnderHoodDiagram } from "../../animations/under-the-hood.js?threat-characterization-1";

const slide=document.getElementById("slide");
const diagram=createUnderHoodDiagram(slide);
const beat=document.getElementById("beat");
const next=document.getElementById("next");
const replay=document.getElementById("replay");
const fullscreen=document.getElementById("fullscreen");
let revealTimer=0;

function setBeat(index) {
  clearTimeout(revealTimer);
  slide.dataset.beat=String(index);
  if(index)diagram.reveal();
  else diagram.reset();
  beat.textContent=index?"After click · 2 of 2":"Before click · 1 of 2";
  next.disabled=Boolean(index);
}

function play() {
  setBeat(0);
  revealTimer=setTimeout(()=>setBeat(1),1700);
}

next.addEventListener("click",()=>setBeat(1));
replay.addEventListener("click",play);
slide.addEventListener("click",event=>{
  if(event.target.closest("button,a"))return;
  if(slide.dataset.beat==="0")setBeat(1);
});
fullscreen.addEventListener("click",()=>slide.requestFullscreen());
document.addEventListener("keydown",event=>{
  if(event.target instanceof HTMLElement&&event.target.closest("button,a,input,textarea"))return;
  if(["Space","ArrowRight"].includes(event.code)){
    event.preventDefault();setBeat(1);
  } else if(event.code==="ArrowLeft"){
    event.preventDefault();setBeat(0);
  } else if(event.code==="KeyR"){
    event.preventDefault();play();
  }
});
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
if(new URLSearchParams(location.search).get("autoplay")==="0")setBeat(0);
else play();
