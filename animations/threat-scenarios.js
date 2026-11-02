import * as THREE from "three";
import { makeEarth, makeRegion } from "./globe-geometry.js";
import { createAnimation as createSalvoAnimation } from "./missile-salvo.js";

const ORDER=["north-korea","iran","china","russia"];
const NAMES={"north-korea":"North Korea",iran:"Iran",china:"China",russia:"Russia"};
const SVG_NS="http://www.w3.org/2000/svg";
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
export async function createAnimation(host,{onStateChange=()=>{}}={}) {
  const responses=await Promise.all([
    fetch(new URL("../assets/scenario-tiles.json",import.meta.url)),
    fetch(new URL("../assets/countries.geo.json",import.meta.url)),
    fetch(new URL("../assets/salvo-scenarios.json",import.meta.url))
  ]);
  if(responses.some(response=>!response.ok))
    throw new Error("Scenario geography could not be loaded");
  const [tiles,geography,salvos]=await Promise.all(responses.map(response=>response.json()));
  const iranFrame=salvos.scenarios.find(item=>item.id==="iran")?.cameraFrames[0];
  if(!iranFrame)throw new Error("Iran camera frame missing");
  const iranFocus=new THREE.Vector3(...iranFrame.slice(0,3)).normalize();
  const byRegion=new Map(tiles.map(item=>[item.region,item.svg]));
  const stage=document.createElement("div");
  stage.className="threat-stage";
  const grid=document.createElement("div");
  grid.className="threat-grid";
  const cards=new Map();
  for(const region of ORDER) {
    const card=document.createElement("div");
    card.className="scenarioCard";
    card.dataset.region=region;
    card.dataset.selected="false";
    card.dataset.hovered="false";
    card.innerHTML=byRegion.get(region);
    const name=document.createElement("span");
    name.className="scenarioCardName";
    name.textContent=NAMES[region];
    const arrow=document.createElement("span");
    arrow.className="scenarioCardArrow";
    arrow.setAttribute("aria-hidden","true");
    arrow.textContent=" →";
    name.append(arrow);
    card.append(name);grid.append(card);cards.set(region,card);
  }
  stage.append(grid);host.append(stage);
  let stateIndex=0,overlay=null,expansionStarted=0,destroyed=false,paused=true;
  let expansionFrame=0,globeFrame=0,globeRenderer=null,globeObserver=null;
  let globeScene=null,globeCanvas=null;
  let salvoHost=null,salvoAnimation=null,salvoLoad=null;
  function hideOverlay(){
    cancelAnimationFrame(expansionFrame);
    cancelAnimationFrame(globeFrame);globeFrame=0;
    globeObserver?.disconnect();globeObserver=null;
    globeScene?.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
    globeRenderer?.dispose();globeRenderer=null;globeScene=null;
    overlay?.remove();overlay=null;
    stage.classList.remove("has-zoom");
  }
  function startGlobe(card){
    globeCanvas=document.createElement("canvas");
    globeCanvas.className="iran-globe";card.append(globeCanvas);
    globeRenderer=new THREE.WebGLRenderer({canvas:globeCanvas,antialias:true,alpha:true});
    globeScene=new THREE.Scene();globeScene.background=new THREE.Color(0xffffff);
    globeScene.add(makeEarth(geography));
    const iran=geography.features.find(feature=>feature.properties?.name==="Iran");
    if(iran?.geometry?.type==="Polygon"){
      const region=makeRegion(iran.geometry.coordinates[0].map(([lon,lat])=>[lat,lon]));
      region.fill.material.opacity=.82;region.outline.visible=false;
      globeScene.add(region.group);
    }
    const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
    const resizeGlobe=()=>{
      if(!globeRenderer||!overlay)return;
      // The tile changes size for two seconds. Keep one WebGL drawing buffer
      // throughout that CSS transition; reallocating it each frame flashes.
      const width=Math.max(1,stage.clientWidth),height=Math.max(1,stage.clientHeight);
      globeRenderer.setPixelRatio(Math.min(devicePixelRatio||1,2));
      globeRenderer.setSize(width,height,false);
      const half=300/iranFrame[3];
      camera.left=-half*width/height;camera.right=-camera.left;
      camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();
    };
    globeObserver=new ResizeObserver(resizeGlobe);
    globeObserver.observe(stage);
    resizeGlobe();
    const draw=now=>{
      if(!overlay||destroyed||!globeRenderer)return;
      // Match the first Iran-salvo frame exactly, including projection scale.
      camera.position.copy(iranFocus).multiplyScalar(3);
      camera.up.set(0,1,0);camera.lookAt(0,0,0);
      globeRenderer.render(globeScene,camera);
      globeFrame=requestAnimationFrame(draw);
    };
    draw(performance.now());
  }
  function makeOverlay(instant=false){
    hideOverlay();
    const source=cards.get("iran");
    const rect=source.getBoundingClientRect(),bounds=stage.getBoundingClientRect();
    overlay=document.createElement("div");
    overlay.className="scenarioCard threat-zoom";
    overlay.dataset.region="iran";
    overlay.dataset.selected="true";
    overlay.style.left=rect.left-bounds.left+"px";
    overlay.style.top=rect.top-bounds.top+"px";
    overlay.style.width=rect.width+"px";
    overlay.style.height=rect.height+"px";
    overlay.innerHTML=byRegion.get("iran");
    const svg=overlay.querySelector("svg");
    stage.append(overlay);
    if(instant){
      overlay.style.transition="none";
      overlay.classList.add("is-expanded");
    }
    expansionStarted=performance.now()-(instant?2050:0);
    startGlobe(overlay);
    svg.style.visibility="hidden";
    if(instant)stage.classList.add("has-zoom");
    else expansionFrame=requestAnimationFrame(()=>{
      stage.classList.add("has-zoom");
      overlay?.classList.add("is-expanded");
    });
  }
  async function showIranSalvo() {
    if(!salvoHost) {
      salvoHost=document.createElement("div");
      salvoHost.className="iran-salvo-panel";
      salvoHost.style.visibility="hidden";
      stage.append(salvoHost);
    }
    if(!salvoAnimation&&!salvoLoad) {
      salvoLoad=createSalvoAnimation(salvoHost,{mode:"iran-salvo"})
        .then(instance=>{
          salvoLoad=null;
          if(destroyed){instance.destroy();return null;}
          salvoAnimation=instance;
          return instance;
        }).catch(error=>{
          salvoLoad=null;
          console.error("Iran salvo could not start.",error);
          return null;
        });
    }
    const instance=salvoAnimation||await salvoLoad;
    if(!instance||destroyed||stateIndex!==8)return;
    instance.jumpToState(0);
    salvoHost.style.visibility="visible";
    stage.classList.add("has-salvo");
    if(!paused)instance.start();
  }
  function render(replay=false,instant=false) {
    if(destroyed)return;
    const selected=stateIndex>=5?"iran":ORDER[stateIndex-1]||null;
    for(const [region,card] of cards) {
      const active=region===selected&&stateIndex<5;
      card.dataset.selected=String(active);
      card.dataset.hovered=String(active);
      card.dataset.pulsing=String(active);
      if(replay&&active) {
        card.dataset.pulsing="false";
        void card.getBoundingClientRect();
        card.dataset.pulsing="true";
      }
    }
    if(stateIndex>=5&&!overlay)makeOverlay(instant);
    if(stateIndex<5&&overlay)hideOverlay();
    if(stateIndex===8)void showIranSalvo();
    else {
      stage.classList.remove("has-salvo");
      if(salvoHost)salvoHost.style.visibility="hidden";
      salvoAnimation?.pause();
    }
    host.dataset.stage=String(stateIndex+1);
    host.dataset.scenario=selected||"none";
    host.dataset.visibleIranSites="0";
  }
  function goToState(index) {
    if(destroyed||index<0||index>=9||index===stateIndex)return false;
    stateIndex=index;render(true);onStateChange(index,9);return true;
  }
  function jumpToState(index){
    if(index<0||index>=9)return;
    stateIndex=index;render(true,true);onStateChange(index,9);
  }
  render();onStateChange(0,9);
  return {
    stateCount:9,getStateIndex:()=>stateIndex,
    next:()=>goToState(stateIndex+1),previous:()=>goToState(stateIndex-1),
    goToState,jumpToState,
    isTransitioning:()=>stateIndex===5&&performance.now()-expansionStarted<2100,
    start(){if(destroyed)return;paused=false;stage.classList.remove("is-paused");
      if(stateIndex===8)salvoAnimation?.start();},
    pause(){paused=true;stage.classList.add("is-paused");salvoAnimation?.pause();},
    restart(){goToState(0);},
    resize(){if(destroyed)return;},
    destroy(){if(destroyed)return;destroyed=true;salvoAnimation?.destroy();
      hideOverlay();host.replaceChildren();}
  };
}

