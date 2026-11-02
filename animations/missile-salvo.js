import * as THREE from "three";
import { makeEarth, makeRegion, latLonVector } from "./globe-geometry.js";
import { MISSILE_BLACK_CSS, MISSILE_DOT_RADIUS_PX, blackTrailGradient } from "./sbi-style.js";
const NORTH_KOREA_PANES=[4,5,6];
const IRAN_SALVO_PANES=[2];
const DARK="#4a4a4a";
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
const PLAYBACK_RATE=1.8;
function slerp(a,b,t) {
  const angle=Math.acos(clamp(a.dot(b),-1,1));
  if(angle<1e-9)return a.clone();
  return a.clone().multiplyScalar(Math.sin((1-t)*angle)/Math.sin(angle))
    .addScaledVector(b,Math.sin(t*angle)/Math.sin(angle));
}
function positionAt(shot,u) {
  const arc=slerp(shot.start,shot.end,u);
  return arc.multiplyScalar(1+shot.peakFactor*Math.sin(Math.PI*u)**.8);
}
function makeScenario(raw) {
  return {
    ...raw,
    shots:raw.missiles.map(shot=>({
      ...shot,
      start:latLonVector(...shot.site),
      end:latLonVector(...shot.target),
      path:Array.from({length:121},(_,i)=>positionAt({
        start:latLonVector(...shot.site),
        end:latLonVector(...shot.target),
        peakFactor:shot.peakFactor
      },i/120))
    }))
  };
}
export async function createAnimation(host,{onStateChange=()=>{},mode="north-korea"}={}) {
  const paneStates=mode==="iran-salvo"?IRAN_SALVO_PANES:NORTH_KOREA_PANES;
  const [data,geojson]=await Promise.all([
    fetch(new URL("../assets/salvo-scenarios.json",import.meta.url)).then(response=>response.json()),
    fetch(new URL("../assets/countries.geo.json",import.meta.url)).then(response=>response.json())
  ]);
  const scenarios=data.scenarios.filter(item=>["iran","nk"].includes(item.id))
    .map(makeScenario);
  scenarios.forEach(item=>{
    const lastArrival=Math.max(...item.shots.map(shot=>
      shot.launchFrame+shot.durationFrames));
    item.lastArrivalFrame=lastArrival;
    item.stopFrame=Math.min(item.cameraFrames.length-1,lastArrival+45);
  });
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
  const earth=makeEarth(geojson);scene.add(earth);
  const regions=scenarios.map(scenario=>{
    const name=scenario.id==="iran"?"Iran":"North Korea";
    const feature=geojson.features.find(item=>item.properties?.name===name);
    if(!feature||feature.geometry.type!=="Polygon")
      throw new Error("Country boundary missing: "+name);
    const boundary=feature.geometry.coordinates[0].map(([lon,lat])=>[lat,lon]);
    const region=makeRegion(boundary);
    region.fill.material.opacity=.82;
    region.outline.visible=false;
    const outlinePoints=[];
    for(let i=0;i<boundary.length-1;i++){
      const first=boundary[i],second=boundary[i+1];
      const steps=Math.max(1,Math.ceil(Math.hypot(second[0]-first[0],
        second[1]-first[1])/.3));
      for(let j=0;j<steps;j++){
        const t=j/steps;
        outlinePoints.push(latLonVector(first[0]+(second[0]-first[0])*t,
          first[1]+(second[1]-first[1])*t,1.002));
      }
    }
    const outline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outlinePoints),
      new THREE.LineBasicMaterial({color:0x777777,transparent:true,opacity:.86,
        depthTest:true,depthWrite:false}));
    outline.renderOrder=9;region.group.add(outline);
    scene.add(region.group);
    return region;
  });
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  host.append(renderer.domElement);
  const overlay=document.createElement("canvas");
  overlay.className="salvo-overlay";host.append(overlay);
  const context=overlay.getContext("2d");
  let width=1,height=1,ratio=1,stateIndex=paneStates[0],paneIndex=0;
  let elapsed=0,paused=true,destroyed=false;
  let raf=0,lastFrame=0;
  const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  function frameNumber(scenario) {
    const stage=stateIndex%4;
    if(stage<2)return 0;
    if(stage===3)return scenario.stopFrame;
    const revealDelay=mode==="north-korea"?2.2:0;
    return clamp(Math.max(0,elapsed-revealDelay)*1000*PLAYBACK_RATE/
      scenario.frameDurationMs,0,scenario.stopFrame);
  }
  function cameraAt(scenario,frame) {
    const a=Math.floor(frame),b=Math.min(a+1,scenario.cameraFrames.length-1),f=frame-a;
    const first=scenario.cameraFrames[a],second=scenario.cameraFrames[b];
    const focus=new THREE.Vector3(
      first[0]+(second[0]-first[0])*f,
      first[1]+(second[1]-first[1])*f,
      first[2]+(second[2]-first[2])*f).normalize();
    const radiusPixels=first[3]+(second[3]-first[3])*f;
    const halfHeight=300/radiusPixels;
    camera.left=-halfHeight*width/height;camera.right=halfHeight*width/height;
    camera.top=halfHeight;camera.bottom=-halfHeight;
    camera.position.copy(focus).multiplyScalar(3);
    camera.up.set(0,1,0);
    // Source's orthographic view uses north as its screen-up direction.
    camera.lookAt(0,0,0);
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
    return {focus,radiusPixels:height/(2*halfHeight)};
  }
  function project(v,view) {
    const p=v.clone().project(camera);
    const x=(p.x*.5+.5)*width,y=(-p.y*.5+.5)*height;
    const radial=Math.hypot(x-width/2,y-height/2);
    return {x,y,visible:v.dot(view.focus)>0||radial>view.radiusPixels};
  }
  function circle(x,y,r,color,alpha=1) {
    context.globalAlpha=alpha;context.beginPath();context.arc(x,y,r,0,Math.PI*2);
    context.fillStyle=color;context.fill();
  }
  function drawRoutes(scenario,view,frame) {
    for(const shot of scenario.shots) {
      const u=clamp((frame-shot.launchFrame)/shot.durationFrames);
      if(u<=0)continue;
      const count=Math.floor(u*120);
      const start=project(shot.start,view),head=project(positionAt(shot,u),view);
      const gradient=blackTrailGradient(context,[start.x,start.y],[head.x,head.y]);
      context.lineWidth=3.1;
      context.strokeStyle=gradient;
      context.lineCap="round";context.lineJoin="round";
      const impactAge=frame-shot.launchFrame-shot.durationFrames;
      context.globalAlpha=impactAge>=0?1-ease(clamp(impactAge/32)):1;
      context.beginPath();
      let drawing=false;
      for(let i=0;i<=count;i++) {
        const p=project(shot.path[i],view);
        if(!p.visible){drawing=false;continue;}
        if(!drawing){context.moveTo(p.x,p.y);drawing=true;}
        else context.lineTo(p.x,p.y);
      }
      if(head.visible){
        if(!drawing)context.moveTo(head.x,head.y);
        else context.lineTo(head.x,head.y);
      }
      context.stroke();
      if(head.visible&&impactAge<0)
        circle(head.x,head.y,MISSILE_DOT_RADIUS_PX,MISSILE_BLACK_CSS,1);
      if(head.visible&&impactAge>=0&&impactAge<30) {
        const pulse=clamp(impactAge/30);
        context.beginPath();
        context.arc(head.x,head.y,4+22*ease(pulse),0,Math.PI*2);
        context.strokeStyle=`rgba(40,40,40,${.85*(1-pulse)})`;
        context.lineWidth=2.1;
        context.globalAlpha=1;
        context.stroke();
        circle(head.x,head.y,5*(1-pulse),MISSILE_BLACK_CSS,1-pulse);
      }
    }
  }
  function render() {
    if(destroyed)return;
    const scenarioIndex=Math.floor(stateIndex/4),scenario=scenarios[scenarioIndex];
    const frame=frameNumber(scenario),view=cameraAt(scenario,frame);
    regions.forEach((region,index)=>{region.group.visible=index===scenarioIndex;});
    renderer.render(scene,camera);
    context.setTransform(ratio,0,0,ratio,0,0);
    context.clearRect(0,0,width,height);
    if(stateIndex%4>=2)drawRoutes(scenario,view,frame);
    context.globalAlpha=1;
    host.dataset.stage=String(paneIndex+1);
    host.dataset.sourceStage=String(stateIndex+1);
    host.dataset.scenario=scenario.id;
    host.dataset.missileCount=String(scenario.count);
    host.dataset.frame=frame.toFixed(2);
    host.dataset.launchFrames=scenario.shots.map(shot=>shot.launchFrame).join(",");
    host.dataset.stopFrame=scenario.stopFrame.toFixed(2);
    host.dataset.lastArrivalFrame=scenario.lastArrivalFrame.toFixed(2);
    host.dataset.impactCount=String(scenario.shots.filter(shot=>
      frame>=shot.launchFrame+shot.durationFrames).length);
    host.dataset.visibleSiteCount="0";
  }
  function tick(now) {
    if(paused||destroyed)return;
    const delta=Math.min(100,Math.max(0,now-lastFrame));lastFrame=now;
    if(stateIndex%4===2)elapsed+=delta/1000;
    render();raf=requestAnimationFrame(tick);
  }
  function schedule(){
    if(paused||destroyed||raf)return;
    lastFrame=performance.now();raf=requestAnimationFrame(tick);
  }
  function goToState(index) {
    if(destroyed||index<0||index>=paneStates.length||index===paneIndex)return false;
    paneIndex=index;stateIndex=paneStates[index];
    elapsed=reducedMotion&&stateIndex%4===2?
      scenarios[Math.floor(stateIndex/4)].stopFrame*.07/PLAYBACK_RATE:0;
    onStateChange(index,paneStates.length);render();schedule();return true;
  }
  function jumpToState(index){
    if(index<0||index>=paneStates.length)return;
    paneIndex=index;stateIndex=paneStates[index];
    elapsed=0;
    onStateChange(index,paneStates.length);render();
  }
  function resize(){
    if(destroyed)return;
    width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);
    ratio=Math.min(devicePixelRatio||1,2,4096/width,2304/height);
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
    overlay.width=Math.round(width*ratio);overlay.height=Math.round(height*ratio);
    overlay.style.width=width+"px";overlay.style.height=height+"px";
    render();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  onStateChange(0,paneStates.length);resize();
  return {
    stateCount:paneStates.length,getStateIndex:()=>paneIndex,
    next:()=>goToState(paneIndex+1),previous:()=>goToState(paneIndex-1),
    goToState,jumpToState,isTransitioning:()=>false,
    start(){if(!destroyed&&!document.hidden){paused=false;schedule();}},
    pause(){paused=true;cancelAnimationFrame(raf);raf=0;},
    restart(){jumpToState(0);},
    resize,
    destroy(){
      if(destroyed)return;destroyed=true;paused=true;cancelAnimationFrame(raf);
      observer.disconnect();scene.traverse(object=>{
        object.geometry?.dispose();
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(material=>material?.dispose());
      });
      renderer.dispose();host.replaceChildren();
    }
  };
}

