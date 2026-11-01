import * as THREE from "three";
import {
  makeEarth, makeRegion, circleTexture, fibonacciShell,
  makeSampling, selectCellsWithinBoundary, latLonVector
} from "./globe-geometry.js";
import { makeConstellation } from "./model-geometry.js";
import { CAROUSEL_PLAYBACK_MULTIPLIER } from "../config.js";

const PANE_STATES = [0, 1, 2, 4, 5, 6];
const STATE_COUNT = PANE_STATES.length;
const RAD = Math.PI / 180;
const SIM_SECONDS_PER_REAL_SECOND = .02 * CAROUSEL_PLAYBACK_MULTIPLIER * 3600;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const NORTH_ATLANTIC_HORIZON = Object.freeze({
  position:[0.0954321555980837,0.3002116215319042,1.351302531288166],
  target:[-1.9526047445594939e-16,0.5590864658669382,0.835133117343826],
  up:[-0.09086682484455491,0.8833477510292626,0.45982602241958126],
  quaternion:[0.2330019143273624,0.06893329363672107,
    0.06353134978223922,0.9679473521545605],
  globeRotation:-0.5336423425920703,zoom:1.12
});
const ease = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value-a)/(b-a)));
  return t*t*(3-2*t);
};
const settle = value => 1 - (1 - Math.max(0, Math.min(1, value))) ** 4;
const mix = (a,b,t) => a + (b-a)*t;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));

async function loadJson(path) {
  const response = await fetch(new URL(path, import.meta.url));
  if (!response.ok) throw new Error("Could not load " + path);
  return response.json();
}
function copyVisual(value) {
  return {
    rotation:value.rotation, pitch:value.pitch, distance:value.distance,
    horizon:value.horizon, global:value.global,
    fill:[...value.fill], line:[...value.line], draw:[...value.draw],
    target:[...value.target], gold:[...value.gold], orbit:[...value.orbit],
    satellite:[...value.satellite]
  };
}
function interpolate(from,to,t) {
  const result={};
  for (const key of ["rotation","pitch","distance","horizon","global"])
    result[key]=mix(from[key],to[key],t);
  for (const key of ["fill","line","draw","target","gold","orbit","satellite"])
    result[key]=from[key].map((v,i)=>mix(v,to[key][i],t));
  return result;
}
function fitDistance(boundary, rotation, pitch) {
  const camera=new THREE.PerspectiveCamera(38,16/9,.01,1000);
  const points=boundary.map(([lat,lon])=>latLonVector(lat,lon,1.015).applyAxisAngle(Y_AXIS,rotation));
  function fits(distance) {
    camera.position.set(0,distance*Math.sin(pitch),distance*Math.cos(pitch));
    camera.lookAt(0,0,0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    return points.every(point=>{
      const p=point.clone().project(camera);
      return Math.abs(p.x)<=.92 && Math.abs(p.y)<=.90 && p.z>-1 && p.z<1;
    });
  }
  let low=1.08,high=8;
  for(let i=0;i<28;i++) { const mid=(low+high)/2; if(fits(mid)) high=mid; else low=mid; }
  return Math.max(1.22,high);
}
function projectedMedianSpacing(cells, ids, view, width, height) {
  const camera=new THREE.PerspectiveCamera(38,width/height,.01,1000);
  camera.position.set(0,view.samplingDistance*Math.sin(view.pitch),
    view.samplingDistance*Math.cos(view.pitch));
  camera.lookAt(0,0,0); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const screen=ids.map(id=>{
    const p=cells[id].position.clone().applyAxisAngle(Y_AXIS,view.rotation).project(camera);
    return [p.x*width/2,p.y*height/2];
  });
  const nearest=screen.map(([x,y],i)=>{
    let best=Infinity;
    for(let j=0;j<screen.length;j++) if(j!==i) {
      const d=Math.hypot(x-screen[j][0],y-screen[j][1]);
      if(d<best) best=d;
    }
    return best;
  }).sort((a,b)=>a-b);
  return nearest[Math.floor(nearest.length/2)] || 24;
}

export async function createAnimation(host,{onStateChange=()=>{}}={}) {
  const [regionsData,modelData,geojson]=await Promise.all([
    loadJson("../assets/regions.json"),loadJson("../assets/model-runs.json"),
    loadJson("../assets/countries.geo.json")
  ]);
  const scene=new THREE.Scene(); scene.background=new THREE.Color(0xffffff);
  const camera=new THREE.PerspectiveCamera(38,16/9,.01,1000);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.sortObjects=true; host.append(renderer.domElement);
  const root=new THREE.Group(); scene.add(root); root.add(makeEarth(geojson));
  const cells=fibonacciShell(15000);
  const globalTexture=circleTexture("#8c8c8c");
  const satelliteTexture=circleTexture("#ffffff","#111111",14);
  const keys=["small","large"];
  const regions=[],samplings=[],constellations=[],views=[],selectedSets=[];
  for(const [index,key] of keys.entries()) {
    const boundary=regionsData[key].boundary;
    const ids=selectCellsWithinBoundary(cells,boundary);
    const sourceIds=[...modelData[key].targetIndices].sort((a,b)=>a-b);
    if(ids.length!==sourceIds.length || ids.some((id,i)=>id!==sourceIds[i]))
      throw new Error(key+" boundary does not select the exact source cells");
    const region=makeRegion(boundary);
    const sampling=makeSampling(cells,ids,globalTexture,64);
    for(const uniform of ["opacity","goldFraction","size","goldRadius",
      "darkRadius","ringScale","goldRingWidth","pulseMode","pulseStrength",
      "sweepSeconds","revealByWave","revealTime","revealDuration","time","pixelRatio"])
      if(!sampling.uniforms[uniform])
        throw new Error(`Sampling shader is missing the ${uniform} uniform`);
    const constellation=makeConstellation(modelData[key].satellites,
      ids.map(id=>cells[id]),modelData[key].coverage,
      modelData[key].simulation.useJ2,satelliteTexture,key);
    root.add(region.group,sampling.global,sampling.selected,constellation.group);
    regions.push(region); samplings.push(sampling); constellations.push(constellation);
    selectedSets.push(ids);
    const center=regionsData[key].center;
    const rotation=(-90-center[1])*RAD, pitch=center[0]*RAD;
    const samplingDistance=fitDistance(boundary,rotation,pitch);
    views.push({center,rotation,pitch,samplingDistance,
      introDistance:Math.max(3.85,samplingDistance+.85),
      orbitDistance:Math.max(4.0,samplingDistance+1.5)});
  }
  function state(view,values) {
    return {rotation:view.rotation,pitch:view.pitch,distance:values.distance,
      horizon:values.horizon??0,global:0,
      fill:values.fill,line:values.line,draw:values.draw,
      target:values.target,gold:values.gold,
      orbit:values.orbit,satellite:values.satellite};
  }
  const [first,second]=views;
  const states=[
    state(first,{distance:first.introDistance,fill:[1,0],line:[1,0],draw:[1,0],target:[0,0],gold:[1,1],orbit:[0,0],satellite:[0,0]}),
    state(first,{distance:first.samplingDistance,fill:[0,0],line:[0,0],draw:[0,0],target:[1,0],gold:[1,1],orbit:[0,0],satellite:[0,0]}),
    state(first,{distance:first.orbitDistance,horizon:1,fill:[1,0],line:[.66,0],draw:[1,0],target:[0,0],gold:[1,1],orbit:[1,0],satellite:[1,0]}),
    state(first,{distance:first.orbitDistance,horizon:1,fill:[1,0],line:[.66,0],draw:[1,0],target:[0,0],gold:[1,1],orbit:[1,0],satellite:[1,0]}),
    state(second,{distance:second.introDistance,fill:[0,1],line:[0,1],draw:[0,1],target:[0,0],gold:[1,1],orbit:[0,0],satellite:[0,0]}),
    state(second,{distance:second.samplingDistance,fill:[0,0],line:[0,0],draw:[0,0],target:[0,1],gold:[1,1],orbit:[0,0],satellite:[0,0]}),
    state(second,{distance:second.orbitDistance,fill:[0,1],line:[0,.66],draw:[0,1],target:[0,0],gold:[1,1],orbit:[0,1],satellite:[0,1]})
  ];
  let current=copyVisual(states[0]);
  current.rotation-=.42; current.pitch-=.07; current.distance+=.38;
  current.fill=[0,0]; current.line=[0,0]; current.draw=[0,0];
  let stateIndex=0,paneIndex=0;
  let transition={from:copyVisual(current),to:copyVisual(states[0]),
    fromIndex:-1,toIndex:0,elapsed:0,duration:2750};
  let paused=true,destroyed=false,raf=0,lastFrame=0,waveSeconds=0,lastCoverageAt=0;
  let currentLookTarget=new THREE.Vector3();
  const simulationSeconds=[0,0];
  const goldRadii=[5.7,5.7],goldSizes=[64,64],sweepSeconds=[2.0,2.3];
  const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(reducedMotion) transition.duration=1;

  function draw() {
    if(destroyed) return;
    root.rotation.y=current.rotation;
    const globalPosition=new THREE.Vector3(0,current.distance*Math.sin(current.pitch),
      current.distance*Math.cos(current.pitch));
    const h=clamp(current.horizon,0,1);
    const targetPosition=new THREE.Vector3(...NORTH_ATLANTIC_HORIZON.position);
    const targetQuaternion=new THREE.Quaternion(...NORTH_ATLANTIC_HORIZON.quaternion);
    const globalCamera=new THREE.PerspectiveCamera(38,camera.aspect,.01,1000);
    globalCamera.position.copy(globalPosition);globalCamera.up.set(0,1,0);
    globalCamera.lookAt(0,0,0);
    camera.position.copy(globalPosition).lerp(targetPosition,h);
    camera.quaternion.copy(globalCamera.quaternion).slerp(targetQuaternion,h);
    camera.up.set(0,1,0).applyQuaternion(camera.quaternion);
    if(h>=1-1e-8)camera.up.set(...NORTH_ATLANTIC_HORIZON.up);
    camera.zoom=mix(1,NORTH_ATLANTIC_HORIZON.zoom,h);
    currentLookTarget=new THREE.Vector3(...NORTH_ATLANTIC_HORIZON.target);
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
    regions.forEach((region,index)=>{
      const fill=current.fill[index],line=current.line[index];
      region.group.visible=fill>.001||line>.001;
      region.fill.material.opacity=.82*fill;
      region.outline.material.opacity=line;
      region.outline.geometry.setDrawRange(0,
        Math.floor(region.outlineIndexCount*current.draw[index]/3)*3);
    });
    samplings.forEach((sampling,index)=>{
      sampling.global.visible=current.global>.005 && index===(stateIndex<4?0:1);
      sampling.global.material.opacity=.18*current.global;
      sampling.selected.visible=current.target[index]>.005;
      const uniforms=sampling.uniforms;
      uniforms.opacity.value=current.target[index];
      uniforms.goldFraction.value=current.gold[index];
      uniforms.size.value=mix(40,goldSizes[index],current.gold[index]);
      uniforms.goldRadius.value=goldRadii[index];
      uniforms.darkRadius.value=1.3;
      uniforms.ringScale.value=index===0?1:.78;
      uniforms.goldRingWidth.value=index===0?2.7:2.5;
      const goldWave=(stateIndex===1&&index===0)||(stateIndex===5&&index===1);
      uniforms.pulseMode.value=goldWave?1:0;
      uniforms.pulseStrength.value=reducedMotion ? 0 : goldWave ?
        (index===0?1:.52) : 0;
      uniforms.sweepSeconds.value=sweepSeconds[index];
      uniforms.revealByWave.value=goldWave?1:0;
      uniforms.revealTime.value=waveSeconds;
      uniforms.revealDuration.value=index===0?2.0:2.35;
      uniforms.time.value=waveSeconds-(index===0?2.25:2.6);
    });
    constellations.forEach((constellation,index)=>{
      const orbit=current.orbit[index],satellite=current.satellite[index];
      constellation.group.visible=orbit>.001||satellite>.001;
      constellation.orbits.material.opacity=.14*Math.min(1,orbit*3);
      const progress=clamp(orbit,0,1);
      const whole=Math.floor(progress*constellation.planeCount);
      const fraction=progress*constellation.planeCount-whole;
      constellation.orbits.geometry.setDrawRange(0,Math.min(constellation.totalOrbitVertices,
        whole*constellation.orbitVerticesPerPlane+
        Math.floor(fraction*constellation.orbitVerticesPerPlane/2)*2));
      constellation.satellites.material.opacity=Math.min(1,satellite*3);
      constellation.satellites.material.size=index===0&&h>.01?
        mix(Math.min(16,Math.max(9,host.clientWidth/75)),
          Math.min(22,Math.max(15,host.clientWidth/56)),h):
        Math.min(16,Math.max(9,host.clientWidth/75));
      const satProgress=clamp(satellite,0,1);
      const plane=Math.floor(satProgress*constellation.planeCount);
      const prior=plane?constellation.planeSatelliteEnds[plane-1]:0;
      const next=plane<constellation.planeCount?
        constellation.planeSatelliteEnds[plane]:constellation.satelliteCount;
      constellation.satellites.geometry.setDrawRange(0,
        Math.min(constellation.satelliteCount,prior+
          Math.floor((satProgress*constellation.planeCount-plane)*(next-prior))));
    });
    host.dataset.view=h>.98?"horizon":"globe";
    host.dataset.cameraPosition=camera.position.toArray().map(v=>v.toFixed(9)).join(",");
    host.dataset.cameraQuaternion=camera.quaternion.toArray().map(v=>v.toFixed(9)).join(",");
    host.dataset.globeRotation=root.rotation.y.toFixed(9);
    renderer.render(scene,camera);
  }
  function visualDuringTransition(spec,progress) {
    const result=interpolate(spec.from,spec.to,ease(0,1,progress));
    const from=spec.fromIndex,to=spec.toIndex;
    if(from===-1&&to===0) {
      const turn=settle(ease(0,.53,progress));
      result.rotation=mix(spec.from.rotation,spec.to.rotation,turn);
      result.pitch=mix(spec.from.pitch,spec.to.pitch,turn);
      result.distance=mix(spec.from.distance,spec.to.distance,turn);
      result.line[0]=ease(.50,.60,progress);
      result.draw[0]=ease(.52,.92,progress);
      result.fill[0]=ease(.79,1,progress);
    } else if(from===2&&to===3) {
      result.horizon=ease(0,.92,progress);
      result.distance=mix(spec.from.distance,spec.to.distance,
        ease(0,.85,progress));
    } else if((from===3||from===2)&&to===4) {
      for(const key of ["fill","line","draw","target","gold","orbit","satellite"])
        result[key][0]=spec.from[key][0]*(1-ease(0,.28,progress));
      result.horizon=1-ease(0,.32,progress);
      result.rotation=mix(spec.from.rotation,spec.to.rotation,settle(ease(.25,.72,progress)));
      result.pitch=mix(spec.from.pitch,spec.to.pitch,settle(ease(.25,.72,progress)));
      result.distance=progress<.5?mix(spec.from.distance,5.3,ease(0,.5,progress)):
        mix(5.3,spec.to.distance,ease(.5,1,progress));
      result.line[1]=ease(.62,.7,progress);
      result.draw[1]=ease(.64,.95,progress);
      result.fill[1]=ease(.82,1,progress);
    } else if((from===0&&to===1)||(from===4&&to===5)) {
      const index=to<4?0:1;
      result.distance=mix(spec.from.distance,spec.to.distance,ease(0,.68,progress));
      result.global=.35*Math.sin(Math.PI*progress);
      result.target[index]=ease(.85,1,progress);
      result.line[index]=1-ease(.75,1,progress);
      result.fill[index]=1-ease(.75,1,progress);
      result.draw[index]=1;
    } else if((from===1&&to===2)||(from===5&&to===6)) {
      const index=to<4?0:1;
      result.distance=mix(spec.from.distance,spec.to.distance,
        ease(.68,1,progress));
      result.line[index]=.66*ease(.05,.34,progress);
      result.draw[index]=ease(.06,.48,progress);
      result.target[index]=1-ease(.46,.73,progress);
      result.fill[index]=ease(.46,.72,progress);
      result.orbit[index]=ease(.65,.92,progress);
      result.satellite[index]=ease(.72,1,progress);
    } else if((from===2&&to===1)||(from===6&&to===5)) {
      const index=from<4?0:1;
      result.orbit[index]=spec.from.orbit[index]*(1-ease(0,.62,progress));
      result.satellite[index]=spec.from.satellite[index]*(1-ease(0,.48,progress));
      result.target[index]=ease(.42,.88,progress);
    }
    return result;
  }
  function waveActive() {
    const index=stateIndex<4?0:1;
    const gold=stateIndex===1||stateIndex===5;
    return gold&&waveSeconds<sweepSeconds[index]+1.4;
  }
  function needsFrames() {
    return Boolean(transition)||[2,3,6].includes(stateIndex)||waveActive();
  }
  function frame(now) {
    if(paused||destroyed) return;
    const delta=Math.min(100,Math.max(0,now-lastFrame));
    lastFrame=now;
    if(transition) {
      transition.elapsed+=delta;
      const progress=Math.min(1,transition.elapsed/transition.duration);
      current=visualDuringTransition(transition,progress);
      if(progress>=1) { current=copyVisual(transition.to); transition=null; }
    }
    if((stateIndex===1||stateIndex===5)&&!transition&&waveActive())
      waveSeconds+=delta/1000;
    if([2,3,6].includes(stateIndex)) {
      const index=stateIndex<4?0:1;
      simulationSeconds[index]+=delta/1000*SIM_SECONDS_PER_REAL_SECOND;
      const sampleCoverage=now-lastCoverageAt>=150;
      constellations[index].update(simulationSeconds[index],sampleCoverage);
      if(sampleCoverage) lastCoverageAt=now;
      host.dataset.activeSatelliteCount=String(constellations[index].activeCount);
      host.dataset.simulationSeconds=simulationSeconds[index].toFixed(3);
    }
    draw();
    raf=needsFrames()?requestAnimationFrame(frame):0;
  }
  function schedule() {
    if(paused||destroyed||raf||!needsFrames()) return;
    lastFrame=performance.now();
    raf=requestAnimationFrame(frame);
  }
  function goToState(index) {
    if(destroyed||index<0||index>=STATE_COUNT||index===paneIndex) return false;
    const previous=stateIndex;
    paneIndex=index;stateIndex=PANE_STATES[index];
    if([1,2,5,6].includes(stateIndex)) waveSeconds=0;
    if((stateIndex===2&&previous!==3)||(stateIndex===6&&previous!==5)) {
      const scenario=stateIndex<4?0:1;
      simulationSeconds[scenario]=0;
      constellations[scenario].update(0,true);
    }
    const duration=(previous===3||previous===2)&&stateIndex===4?1700:
      [1,5].includes(stateIndex)?1200:
      [2,6].includes(stateIndex)?2100:1600;
    transition={from:copyVisual(current),to:copyVisual(states[stateIndex]),
      fromIndex:previous,toIndex:stateIndex,elapsed:0,duration:reducedMotion?1:duration};
    host.dataset.stage=String(index+1);
    host.dataset.targetCount=String(stateIndex<4?modelData.small.targetIndices.length:
      modelData.large.targetIndices.length);
    host.dataset.satelliteCount=String(stateIndex<4?constellations[0].satelliteCount:
      constellations[1].satelliteCount);
    if(![2,3,6].includes(stateIndex)) {
      delete host.dataset.activeSatelliteCount;
      delete host.dataset.simulationSeconds;
    }
    onStateChange(index,STATE_COUNT);
    cancelAnimationFrame(raf); raf=0; schedule();
    return true;
  }
  function jumpToState(index) {
    if(index<0||index>=STATE_COUNT) return;
    paneIndex=index;stateIndex=PANE_STATES[index];
    current=copyVisual(states[stateIndex]); transition=null;
    waveSeconds=1000000;
    if([2,3,6].includes(stateIndex)) {
      const scenario=stateIndex<4?0:1;
      constellations[scenario].update(simulationSeconds[scenario],true);
    }
    host.dataset.stage=String(index+1);
    host.dataset.targetCount=String(stateIndex<4?modelData.small.targetIndices.length:
      modelData.large.targetIndices.length);
    host.dataset.satelliteCount=String(stateIndex<4?constellations[0].satelliteCount:
      constellations[1].satelliteCount);
    onStateChange(index,STATE_COUNT);
    draw();
  }
  function resize() {
    if(destroyed) return;
    const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
    camera.aspect=width/height; camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2,4096/width,2304/height));
    renderer.setSize(width,height,false);
    samplings.forEach((sampling,index)=>{
      sampling.uniforms.pixelRatio.value=renderer.getPixelRatio();
      const projected=new THREE.PerspectiveCamera(38,width/height,.01,1000);
      const view=views[index];
      projected.position.set(0,view.samplingDistance*Math.sin(view.pitch),
        view.samplingDistance*Math.cos(view.pitch));
      projected.lookAt(0,0,0);projected.updateProjectionMatrix();projected.updateMatrixWorld();
      const phase=sampling.selected.geometry.attributes.phase;
      const xs=selectedSets[index].map(id=>cells[id].position.clone()
        .applyAxisAngle(Y_AXIS,view.rotation).project(projected).x);
      const minX=Math.min(...xs),maxX=Math.max(...xs);
      xs.forEach((x,j)=>phase.setX(j,(x-minX)/Math.max(.0001,maxX-minX)));
      phase.needsUpdate=true;
      const spacing=projectedMedianSpacing(cells,selectedSets[index],views[index],width,height);
      goldRadii[index]=clamp(spacing*.24,4.3,6.9);
      goldSizes[index]=Math.max(64,goldRadii[index]*10.5);
      host.dataset[`${keys[index]}MedianSpacingPx`]=spacing.toFixed(2);
      host.dataset[`${keys[index]}GoldRadiusPx`]=goldRadii[index].toFixed(2);
    });
    constellations.forEach(constellation=>{
      constellation.satellites.material.size=Math.min(16,Math.max(9,width/75));
      if(constellation===constellations[0]&&stateIndex===3)
        constellation.satellites.material.size=Math.min(22,Math.max(15,width/56));
    });
    draw();
  }
  const observer=new ResizeObserver(resize);
  observer.observe(host);
  host.dataset.stage="1";
  host.dataset.targetCount=String(modelData.small.targetIndices.length);
  host.dataset.satelliteCount=String(constellations[0].satelliteCount);
  onStateChange(0,STATE_COUNT);
  resize();
  return {
    stateCount:STATE_COUNT,
    getStateIndex:()=>paneIndex,
    goToState,jumpToState,
    isTransitioning:()=>Boolean(transition),
    next:()=>goToState(paneIndex+1),
    previous:()=>goToState(paneIndex-1),
    start(){if(destroyed||document.hidden)return;paused=false;schedule();},
    pause(){paused=true;cancelAnimationFrame(raf);raf=0;},
    restart(){
      if(paneIndex!==0){goToState(0);return;}
      current=copyVisual(states[0]);
      current.rotation-=.42;current.pitch-=.07;current.distance+=.38;
      current.fill=[0,0];current.line=[0,0];current.draw=[0,0];
      transition={from:copyVisual(current),to:copyVisual(states[0]),
        fromIndex:-1,toIndex:0,elapsed:0,duration:reducedMotion?1:2750};
      cancelAnimationFrame(raf);raf=0;schedule();
    },
    resize,
    destroy(){
      if(destroyed)return;
      destroyed=true;paused=true;cancelAnimationFrame(raf);observer.disconnect();
      scene.traverse(object=>{
        object.geometry?.dispose();
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(material=>material?.dispose());
      });
      globalTexture.dispose();satelliteTexture.dispose();renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
