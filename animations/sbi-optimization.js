import * as THREE from "three";
import {makeEarth, makeRegion, latLonVector, circleTexture} from "./globe-geometry.js";
import {orbitalElements, orbitalPosition, MU} from "./constellation-common.js";
import {EARTH_ROTATION_RATE_RAD_PER_SEC as OMEGA} from "./sbi-style.js";

const RAD=Math.PI/180,TAU=2*Math.PI,STATES=3;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=v=>{v=clamp(v);return v*v*(3-2*v);};
const INTRO_DURATION=8.4,WALKER_REVEAL=3.4,PLAYBACK_RATE=160;
const IRAN_VIEW_YAW=3.77;

function orbitLine(element,opacity=.14) {
  const values=[];
  for(let i=0;i<=180;i++)values.push(...orbitalPosition(element,
    i*TAU/180/element.n));
  return new THREE.Line(new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute(values,3)),new THREE.LineBasicMaterial({
    color:0x777777,transparent:true,opacity,depthTest:true,depthWrite:false}));
}
function fleet(count,texture) {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(count*3),3));
  geometry.setAttribute("color",new THREE.BufferAttribute(new Float32Array(count*3),3));
  const points=new THREE.Points(geometry,new THREE.PointsMaterial({
    map:texture,vertexColors:true,size:6,sizeAttenuation:false,
    transparent:true,depthTest:true,depthWrite:false,alphaTest:.04}));
  points.frustumCulled=false;points.renderOrder=10;return points;
}

export async function createAnimation(host,{onStateChange=()=>{}}={}) {
  const responses=await Promise.all([
    "../assets/iran-optimization.json","../assets/iran-walker-baseline.json",
    "../assets/countries.geo.json"
  ].map(path=>fetch(new URL(path,import.meta.url))));
  if(responses.some(response=>!response.ok))throw new Error("Optimization data could not load");
  const [run,baseline,geography]=await Promise.all(responses.map(response=>response.json()));
  const fields=Object.fromEntries(run.satelliteFields.map((name,index)=>[name,index]));
  const selected=run.selectedSatellites.map(row=>{
    const a=row[fields.a_km],n=Math.sqrt(MU/a**3);
    return orbitalElements({id:row[fields.slot_index],meanMotion:n*86400/TAU,
      e:row[fields.e],inclination:row[fields.i_deg],raan:row[fields.raan_deg],
      argPerigee:row[fields.argp_deg],meanAnomaly:row[fields.arg_lat_deg]});
  });
  const design=baseline.chosen,walker=[];
  for(let plane=0;plane<design.planes;plane++)
    for(let slot=0;slot<design.satellitesPerPlane;slot++)
      walker.push(orbitalElements({id:plane*design.satellitesPerPlane+slot,
        meanMotion:design.meanMotionRadS*86400/TAU,
        inclination:design.inclinationDeg,raan:plane*360/design.planes,
        meanAnomaly:360*(slot/design.satellitesPerPlane+
          design.phasing*plane/design.satellites)}));
  if(selected.length!==run.architecture.selectedSatellites||
    walker.length!==design.satellites)throw new Error("Optimization count mismatch");
  const iran=geography.features.find(feature=>feature.properties?.name==="Iran");
  if(!iran||iran.geometry.type!=="Polygon")throw new Error("Iran geography missing");

  const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
  const markerTexture=circleTexture("#ffffff","#333333",8);
  const siteNormals=run.inputs.target_points.map(([,lat,lon])=>
    latLonVector(lat,lon).normalize());
  function panel(elements,isRgt) {
    const root=new THREE.Group();scene.add(root);
    const earth=makeEarth(geography);
    const region=makeRegion(iran.geometry.coordinates[0].map(([lon,lat])=>[lat,lon]));
    earth.add(region.group);
    root.add(earth);
    const dots=fleet(elements.length,markerTexture);root.add(dots);
    const orbits=new THREE.Group();
    if(isRgt)for(let i=0;i<elements.length;i+=55)
      orbits.add(orbitLine(elements[i],.10));
    else for(let plane=0;plane<design.planes;plane++)
      orbits.add(orbitLine(elements[plane*design.satellitesPerPlane],.14));
    root.add(orbits);
    return {root,earth,region,dots,orbits};
  }
  const left=panel(selected,true),right=panel(walker,false);
  const camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,100);
  camera.position.set(0,2.3,10);camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  host.append(renderer.domElement);
  const overlay=document.createElement("canvas");overlay.className="optimization-overlay";
  host.append(overlay);const ctx=overlay.getContext("2d");
  let width=1,height=1,ratio=1,stage=0,elapsed=0,clock=0,scenarioAge=0;
  let walkerAge=0,layout=0,paused=true,destroyed=false,raf=0,last=0;
  const reachCos=Math.cos(baseline.criterion.reachDeg*RAD);
  const yAxis=new THREE.Vector3(0,1,0);
  host.dataset.optimizationRun=run.runName;
  host.dataset.rgtSatellites=String(selected.length);
  host.dataset.walkerSatellites=String(walker.length);
  host.dataset.walkerCriterion=baseline.method;
  host.dataset.walkerHalfStepMin=baseline.halfStepValidation.minimumByTarget.join(",");
  host.dataset.playbackRate=String(PLAYBACK_RATE);

  function updateFleet(elements,dots,shown) {
    const positions=dots.geometry.attributes.position;
    const colors=dots.geometry.attributes.color;
    const targets=siteNormals.map(normal=>normal.clone().applyAxisAngle(yAxis,OMEGA*clock));
    let nearbyCount=0;
    for(let i=0;i<shown;i++){
      const p=orbitalPosition(elements[i],clock);
      positions.setXYZ(i,p[0],p[1],p[2]);
      const length=Math.hypot(...p);
      const nearby=targets.some(normal=>
        (p[0]*normal.x+p[1]*normal.y+p[2]*normal.z)/length>=reachCos);
      colors.setXYZ(i,...(nearby?[.72,.55,.075]:[.63,.63,.63]));
      if(nearby)nearbyCount++;
    }
    positions.needsUpdate=true;colors.needsUpdate=true;
    dots.geometry.setDrawRange(0,shown);
    return nearbyCount;
  }
  function updateGeography() {
    const outline=ease((scenarioAge-1.0)/1.5);
    left.region.outline.visible=outline>0&&scenarioAge<5.7;
    left.region.outline.material.opacity=outline;
    left.region.outline.geometry.setDrawRange(0,
      Math.floor(left.region.outlineIndexCount*outline/3)*3);
    left.region.fill.material.opacity=.82*ease((scenarioAge-2.1)/.75);
    right.region.fill.material.opacity=.82;
    right.region.outline.visible=false;
  }
  function drawOverlay() {
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    const ready=stage===2&&scenarioAge>=INTRO_DURATION&&
      walkerAge>=WALKER_REVEAL&&layout>=.999;
    if(!ready)return;
    const alpha=ease(elapsed/.65);
    ctx.globalAlpha=alpha;ctx.textAlign="center";
    ctx.fillStyle="#74652f";
    ctx.font="600 17px Roboto,'Helvetica Neue',Arial,sans-serif";
    const centerX = root => {
      const world = root.getWorldPosition(new THREE.Vector3());
      return (world.project(camera).x*.5+.5)*width;
    };
    const leftX=centerX(left.root),rightX=centerX(right.root);
    ctx.fillText("Repeating Ground Track Optimization",leftX,height*.21);
    ctx.fillText("Symmetric Walker Delta",rightX,height*.21);
    ctx.fillStyle="#666";ctx.font="400 12px Roboto,'Helvetica Neue',Arial,sans-serif";
    ctx.fillText(`${selected.length} satellites`,leftX,height*.247);
    ctx.fillText(`${walker.length} satellites`,rightX,height*.247);
    ctx.globalAlpha=1;ctx.textAlign="left";
  }
  function render() {
    if(destroyed)return;
    const yaw=IRAN_VIEW_YAW-.65*(1-ease(scenarioAge/2));
    left.root.rotation.y=yaw-OMEGA*clock;
    right.root.rotation.y=IRAN_VIEW_YAW-OMEGA*clock;
    left.earth.rotation.y=right.earth.rotation.y=OMEGA*clock;
    left.root.position.x=-1.85*layout;
    right.root.position.x=3.8-1.95*layout;
    const comparisonShift=stage===2?ease(elapsed/.65):0;
    left.root.position.y=right.root.position.y=-.32*comparisonShift;
    right.root.visible=stage>=1;
    updateGeography();
    const selectedShown=Math.floor(selected.length*
      ease((scenarioAge-5.25)/3.15));
    const walkerShown=stage>=1?Math.floor(walker.length*
      ease(walkerAge/WALKER_REVEAL)):0;
    const rgtNearby=updateFleet(selected,left.dots,selectedShown);
    const walkerNearby=updateFleet(walker,right.dots,walkerShown);
    left.orbits.visible=scenarioAge>=5.0;
    right.orbits.visible=stage>=1;
    const introHalf=1.54-.25*ease(scenarioAge/2)+.48*ease((scenarioAge-4.5)/1.8);
    const half=introHalf*(1-layout)+2.15*layout;
    camera.left=-half*width/height;camera.right=-camera.left;
    camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.render(scene,camera);
    drawOverlay();
    host.dataset.stage=String(stage+1);
    host.dataset.selectedShown=String(selectedShown);
    host.dataset.walkerShown=String(walkerShown);
    host.dataset.rgtNearby=String(rgtNearby);
    host.dataset.walkerNearby=String(walkerNearby);
    host.dataset.simulationSeconds=clock.toFixed(2);
    host.dataset.scenarioAge=scenarioAge.toFixed(2);
    host.dataset.comparisonTitlesVisible=String(stage===2&&
      scenarioAge>=INTRO_DURATION&&walkerAge>=WALKER_REVEAL&&layout>=.999);
  }
  function frame(now){
    if(paused||destroyed)return;
    const delta=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
    elapsed+=delta;clock+=delta*PLAYBACK_RATE;
    scenarioAge=Math.min(INTRO_DURATION,scenarioAge+
      delta*(stage===0?1:8));
    if(stage>=1)walkerAge=Math.min(WALKER_REVEAL,walkerAge+delta);
    layout+=clamp((stage>=1?1:0)-layout,-delta/1.4,delta/1.4);
    render();raf=requestAnimationFrame(frame);
  }
  function goToState(index){
    if(destroyed||index<0||index>=STATES||index===stage)return false;
    stage=index;elapsed=0;onStateChange(index,STATES);render();return true;
  }
  function jumpToState(index){
    if(index<0||index>=STATES)return;
    stage=index;elapsed=index===2?1:0;
    scenarioAge=index===0?0:INTRO_DURATION;
    walkerAge=index===0?0:WALKER_REVEAL;
    layout=index===0?0:1;
    onStateChange(index,STATES);render();
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
  onStateChange(0,STATES);resize();
  return {stateCount:STATES,getStateIndex:()=>stage,
    next:()=>goToState(stage+1),previous:()=>goToState(stage-1),
    goToState,jumpToState,
    isTransitioning:()=>stage===0?scenarioAge<INTRO_DURATION:
      stage===1?walkerAge<WALKER_REVEAL||layout<.999:
        elapsed<.65,
    start(){if(destroyed||document.hidden)return;paused=false;last=performance.now();
      if(!raf)raf=requestAnimationFrame(frame);},
    pause(){paused=true;cancelAnimationFrame(raf);raf=0;},
    resize,destroy(){
      destroyed=true;paused=true;cancelAnimationFrame(raf);observer.disconnect();
      scene.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
      markerTexture.dispose();renderer.dispose();host.replaceChildren();
    }
  };
}
