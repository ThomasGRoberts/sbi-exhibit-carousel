import * as THREE from "three";
import { makeEarth, makeRegion, latLonVector, mainBoundary } from "./globe-geometry.js?50m-boundary=1";
import { SBI_GOLD } from "./sbi-style.js";
import { createAnimation as createSalvoAnimation } from "./missile-salvo.js?site-scale=2";

const ORDER=["north-korea","iran","china","russia"];
const NAMES={"north-korea":"North Korea",iran:"Iran",china:"China",russia:"Russia"};
const SVG_NS="http://www.w3.org/2000/svg";
const GOLD=SBI_GOLD;
const SITE_COORDS=[[35.23878672,53.94957116],[36.20108979,55.33387388]];
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
function surfaceGeometry(normal,inner,outer) {
  const tangent=new THREE.Vector3(0,1,0).cross(normal).normalize();
  const across=normal.clone().cross(tangent).normalize();
  const values=[],indices=[],segments=64;
  if(inner===0)values.push(...normal.clone().multiplyScalar(1.003).toArray());
  for(let i=0;i<=segments;i++) {
    const angle=i*2*Math.PI/segments;
    for(const radius of inner===0?[outer]:[inner,outer]) {
      const point=normal.clone().multiplyScalar(Math.cos(radius))
        .addScaledVector(tangent,Math.sin(radius)*Math.cos(angle))
        .addScaledVector(across,Math.sin(radius)*Math.sin(angle))
        .multiplyScalar(1.003);
      values.push(...point.toArray());
    }
    if(i<segments) {
      if(inner===0)indices.push(0,i+1,i+2);
      else {const k=2*i;indices.push(k,k+1,k+2,k+1,k+3,k+2);}
    }
  }
  return new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute(values,3)).setIndex(indices);
}
function svgNode(name,attributes={}) {
  const element=document.createElementNS(SVG_NS,name);
  for(const [key,value] of Object.entries(attributes))
    element.setAttribute(key,String(value));
  return element;
}
function addIranReveal(svg) {
  const source=[...svg.querySelectorAll(".scenarioCardSite")];
  source.forEach((site,index)=>{
    const cx=Number(site.getAttribute("cx")),cy=Number(site.getAttribute("cy"));
    const group=svgNode("g",{"class":"iran-site-reveal","data-site":index+1});
    const pulse=svgNode("circle",{cx,cy,r:2.4,"class":"iran-site-pulse"});
    const core=svgNode("circle",{cx,cy,r:2.8,"class":"iran-site-core"});
    group.append(pulse,core);svg.append(group);
  });
}
export async function createAnimation(host,{onStateChange=()=>{}}={}) {
  const responses=await Promise.all([
    fetch(new URL("../assets/scenario-tiles.json?launch-sites=restored",import.meta.url)),
    fetch(new URL("../assets/countries-50m.geo.json",import.meta.url)),
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
  let globeScene=null,globeSites=[],globeCanvas=null;
  let salvoHost=null,salvoAnimation=null,salvoLoad=null;
  const siteStarted=[-Infinity,-Infinity];
  function hideOverlay(){
    cancelAnimationFrame(expansionFrame);
    cancelAnimationFrame(globeFrame);globeFrame=0;
    globeObserver?.disconnect();globeObserver=null;
    globeScene?.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
    globeRenderer?.dispose();globeRenderer=null;globeScene=null;globeSites=[];
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
    if(iran?.geometry){
      const region=makeRegion(mainBoundary(iran.geometry));
      region.fill.material.opacity=.82;region.outline.visible=false;
      globeScene.add(region.group);
    }
    const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
    globeSites=SITE_COORDS.map(([lat,lon])=>{
      const normal=latLonVector(lat,lon).normalize();
      const dot=new THREE.Mesh(surfaceGeometry(normal,0,.0036),
        new THREE.MeshBasicMaterial({color:GOLD,side:THREE.DoubleSide,
          transparent:true,depthTest:false,depthWrite:false}));
      const pulse=new THREE.Mesh(surfaceGeometry(normal,.0052,.0068),
        new THREE.MeshBasicMaterial({color:GOLD,side:THREE.DoubleSide,
          transparent:true,opacity:0,depthTest:false,depthWrite:false}));
      dot.renderOrder=10;pulse.renderOrder=11;
      globeScene.add(dot,pulse);return {normal,dot,pulse};
    });
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
      globeSites.forEach((site,index)=>{
        const visible=stateIndex>=index+6;
        site.dot.visible=visible;
        const fraction=(now-siteStarted[index])/1250;
        site.pulse.visible=visible&&fraction>=0&&fraction<1;
        if(site.pulse.visible) {
          const radius=.006+.015*ease(fraction);
          site.pulse.geometry.dispose();
          site.pulse.geometry=surfaceGeometry(site.normal,
            Math.max(.001,radius-.0008),radius+.0008);
          site.pulse.material.opacity=.72*(1-fraction)**2;
        }
      });
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
    addIranReveal(svg);
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
  function updateReveal(replay=false) {
    if(!overlay)return;
    for(const item of overlay.querySelectorAll(".iran-site-reveal")) {
      const required=Number(item.dataset.site)+5;
      item.classList.toggle("is-visible",stateIndex>=required);
      if(replay&&stateIndex===required) {
        item.classList.remove("is-visible");
        void item.getBoundingClientRect();
        item.classList.add("is-visible");
      }
    }
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
    const siteTime=Math.max(performance.now(),expansionStarted+1550);
    if(replay&&(stateIndex===6||stateIndex===7))siteStarted[stateIndex-6]=siteTime;
    if(stateIndex>=6&&siteStarted[0]===-Infinity)siteStarted[0]=siteTime;
    if(stateIndex>=7&&siteStarted[1]===-Infinity)siteStarted[1]=siteTime;
    updateReveal(replay);
    host.dataset.stage=String(stateIndex+1);
    host.dataset.scenario=selected||"none";
    host.dataset.visibleIranSites=String(Math.min(2,Math.max(0,stateIndex-5)));
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

