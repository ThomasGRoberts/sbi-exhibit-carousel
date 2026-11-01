import * as THREE from "three";
import { makeEarth, circleTexture } from "./globe-geometry.js";
import { EARTH_RADIUS_KM as R, MU_EARTH_KM3_S2 as MU,
  EARTH_ROTATION_RATE_RAD_PER_SEC as OMEGA } from "./sbi-style.js";

const TAU=2*Math.PI, RAD=Math.PI/180;
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};
const ordinary={a:R+700,inc:50*RAD,phase:Math.PI,
  period:TAU*Math.sqrt((R+700)**3/MU)};
const sidereal=TAU/OMEGA;
const repeating={a:Math.cbrt(MU*(sidereal/(3*TAU))**2),inc:50*RAD,
  period:sidereal/3};
const targetViews=[
  {left:1,wraps:1,half:1.85,origin:-180},
  {left:.44,wraps:1,half:1.75,origin:-180},
  {left:.46,wraps:1,half:4.35,origin:-180},
  {left:.44,wraps:1,half:4.35,origin:-180},
  {left:.045,wraps:2,half:3.25,origin:-90},
  {left:.045,wraps:3,half:3.25,origin:-90},
  {left:.045,wraps:3,half:3.25,origin:-90}
];

function eciAt(model,time) {
  const u=TAU*time/model.period+(model.phase||0);
  const r=model.a/R;
  return new THREE.Vector3(r*Math.cos(u),r*Math.sin(u)*Math.sin(model.inc),
    -r*Math.sin(u)*Math.cos(model.inc));
}
function groundAt(model,time) {
  const position=eciAt(model,time);
  const latitude=Math.asin(position.y/(model.a/R))/RAD;
  const inertialLongitude=Math.atan2(-position.z,position.x);
  let longitude=(inertialLongitude-OMEGA*time)/RAD;
  longitude=((longitude+180)%360+360)%360-180;
  return {latitude,longitude,position};
}
function makeTrack(model) {
  const points=[];
  const count=1600,step=model.period/400;
  let previous=0;
  for(let i=0;i<=count;i++) {
    const time=i*step,ground=groundAt(model,time);
    const delta=i?((ground.longitude-previous+540)%360)-180:0;
    const unwrapped=i?points[i-1].unwrapped+delta:ground.longitude;
    points.push({...ground,time,unwrapped});
    previous=ground.longitude;
  }
  return points;
}
export async function createAnimation(host,{onStateChange=()=>{}}={}) {
  const response=await fetch(new URL("../assets/countries.geo.json",import.meta.url));
  if(!response.ok)throw new Error("Ground-track geography could not load");
  const geography=await response.json();
  const tracks=[makeTrack(ordinary),makeTrack(repeating)];
  const target=tracks[1][64]; // A 40° N point on the actual repeating ground track.
  const footprintAngle=Math.acos(Math.cos(10*RAD)/(ordinary.a/R))-10*RAD;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
  const earth=makeEarth(geography);scene.add(earth);
  const orbitGeometry=new THREE.BufferGeometry();
  const orbit=new THREE.LineLoop(orbitGeometry,new THREE.LineBasicMaterial({
    color:0x929292,transparent:true,opacity:.72}));scene.add(orbit);
  const satellite=new THREE.Points(new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute([0,0,0],3)),new THREE.PointsMaterial({
    map:circleTexture("#969696","#3e3e3e",15),size:13,sizeAttenuation:false,
    transparent:true,depthTest:true,depthWrite:false,alphaTest:.04}));
  satellite.frustumCulled=false;satellite.renderOrder=8;scene.add(satellite);
  const camera=new THREE.OrthographicCamera(-2,2,2,-2,.01,100);
  camera.position.set(5,3.2,7);camera.lookAt(0,0,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.domElement.className="ground-track-three";host.append(renderer.domElement);
  const canvas=document.createElement("canvas");canvas.className="ground-track-overlay";
  host.append(canvas);const ctx=canvas.getContext("2d");
  const world=new Image();
  world.src=new URL("../assets/ground-track-land.png",import.meta.url).href;
  await world.decode();
  let width=1,height=1,ratio=1,stage=0,elapsed=0,ordinaryTime=0,repeatTime=0;
  let view={...targetViews[0]},from={...view},transition=1;
  let paused=true,destroyed=false,raf=0,last=0;
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  host.dataset.repeatRevolutions="3";
  host.dataset.repeatEarthRotations="1";
  host.dataset.repeatPeriodSeconds=repeating.period.toFixed(5);
  host.dataset.repeatAltitudeKm=(repeating.a-R).toFixed(3);
  host.dataset.repeatInclinationDeg="50";
  host.dataset.ordinaryAltitudeKm="700";
  host.dataset.targetLatitude=target.latitude.toFixed(6);
  host.dataset.targetLongitude=target.longitude.toFixed(6);
  host.dataset.footprintAngularRadiusDeg=(footprintAngle/RAD).toFixed(4);
  host.dataset.longitudeAtRepeat=tracks[1][1200].unwrapped.toFixed(6);
  host.dataset.repeatClosureDeg=Math.hypot(
    tracks[1][1200].latitude-tracks[1][0].latitude,
    tracks[1][1200].longitude-tracks[1][0].longitude).toExponential(3);

  function updateOrbit(model) {
    const values=[];
    for(let i=0;i<360;i++)values.push(...eciAt(model,i*model.period/360).toArray());
    orbit.geometry.dispose();
    orbit.geometry=new THREE.BufferGeometry().setAttribute("position",
      new THREE.Float32BufferAttribute(values,3));
  }
  updateOrbit(ordinary);
  function drawMap() {
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    if(stage===0)return;
    const x0=view.left*width,margin=width*.016,plotX=x0+margin;
    const plotW=width-plotX-margin,plotY=height*.22,plotH=height*.53;
    const wraps=view.wraps,domainMax=view.origin+360*wraps;
    const xFor=lon=>plotX+(lon-view.origin)/(360*wraps)*plotW;
    const yFor=lat=>plotY+(90-lat)/180*plotH;
    ctx.fillStyle="#fff";ctx.fillRect(x0,0,width-x0,height);
    ctx.save();ctx.beginPath();ctx.rect(plotX,plotY,plotW,plotH);ctx.clip();
    ctx.fillStyle="#fafafa";ctx.fillRect(plotX,plotY,plotW,plotH);
    const backgroundAlpha=stage>=5?.38:stage>=4?.68:1;
    ctx.globalAlpha=backgroundAlpha;
    for(let copy=-1;copy<=Math.ceil(wraps);copy++)
      ctx.drawImage(world,xFor(-180+copy*360),plotY,plotW/wraps,plotH);
    ctx.globalAlpha=1;
    ctx.strokeStyle="#e2e2e2";ctx.lineWidth=1;
    for(const lat of [-60,-30,0,30,60]){
      ctx.beginPath();ctx.moveTo(plotX,yFor(lat));ctx.lineTo(plotX+plotW,yFor(lat));ctx.stroke();
    }
    for(let copy=0;copy<=Math.ceil(wraps);copy++){
      const x=xFor(-180+copy*360);
      if(x<=plotX||x>=plotX+plotW)continue;
      ctx.setLineDash([5,6]);ctx.strokeStyle="#aaa";ctx.beginPath();
      ctx.moveTo(x,plotY);ctx.lineTo(x,plotY+plotH);ctx.stroke();ctx.setLineDash([]);
    }
    const source=stage<2?tracks[0]:tracks[1];
    const time=stage<2?ordinaryTime:repeatTime;
    const index=Math.min(source.length-1,Math.floor(time/(stage<2?ordinary.period:repeating.period)*400));
    ctx.beginPath();
    let priorX=NaN;
    for(let i=0;i<=index;i++){
      const p=source[i],lon=stage>=4?p.unwrapped:p.longitude;
      const x=xFor(lon),y=yFor(p.latitude);
      if(!Number.isFinite(priorX)||stage<4&&Math.abs(x-priorX)>plotW*.5)
        ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
      priorX=x;
    }
    ctx.strokeStyle="rgba(70,70,70,.68)";ctx.lineWidth=1.25;
    ctx.lineJoin="round";ctx.stroke();
    const current=groundAt(stage<2?ordinary:repeating,time);
    if(stage===1){
      const lat1=current.latitude*RAD,lon1=current.longitude*RAD;
      ctx.beginPath();
      for(let i=0;i<=128;i++){
        const bearing=i*TAU/128;
        const lat2=Math.asin(Math.sin(lat1)*Math.cos(footprintAngle)+
          Math.cos(lat1)*Math.sin(footprintAngle)*Math.cos(bearing));
        const lon2=lon1+Math.atan2(Math.sin(bearing)*Math.sin(footprintAngle)*Math.cos(lat1),
          Math.cos(footprintAngle)-Math.sin(lat1)*Math.sin(lat2));
        const x=xFor(lon2/RAD),y=yFor(lat2/RAD);
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.closePath();ctx.fillStyle="rgba(234,170,0,.11)";ctx.fill();
      ctx.save();ctx.clip();
      ctx.fillStyle="rgba(234,170,0,.18)";
      const cell=Math.max(5,plotW/65);
      for(let y=plotY;y<plotY+plotH;y+=cell)
        for(let x=plotX;x<plotX+plotW;x+=cell)ctx.fillRect(x+1,y+1,cell-2,cell-2);
      ctx.restore();
      ctx.setLineDash([4,4]);ctx.strokeStyle="rgba(184,139,19,.7)";
      ctx.lineWidth=1.4;ctx.stroke();ctx.setLineDash([]);
    }
    if(stage===1){
      ctx.textAlign="center";ctx.font="600 11px Roboto,Arial,sans-serif";
      ctx.fillStyle="#8b6a1c";
      ctx.fillText("Satellite coverage footprint · 10° minimum elevation",
        plotX+plotW/2,plotY-17);
    }
    const nearest=source[Math.min(index,source.length-1)];
    const dotLon=stage>=4?nearest.unwrapped:current.longitude;
    const dotX=xFor(dotLon),dotY=yFor(current.latitude);
    if(dotX>=plotX&&dotX<=plotX+plotW){
      ctx.fillStyle="#969696";ctx.strokeStyle="#3e3e3e";ctx.lineWidth=1;
      ctx.beginPath();ctx.arc(dotX,dotY,4.4,0,TAU);ctx.fill();ctx.stroke();
    }
    if(stage>=3){
      for(const lon of [target.longitude,target.longitude+720]){
        const x=xFor(lon),y=yFor(target.latitude);
        if(x<plotX||x>plotX+plotW)continue;
        ctx.fillStyle="#b88b13";ctx.beginPath();ctx.arc(x,y,4.8,0,TAU);ctx.fill();
        if(stage===3&&elapsed<1.4){
          ctx.strokeStyle=`rgba(184,139,19,${.7*(1-elapsed/1.4)})`;
          ctx.lineWidth=1.7;ctx.beginPath();ctx.arc(x,y,7+17*ease(elapsed/1.4),0,TAU);
          ctx.stroke();
        }
      }
      const nearReturn=stage===6&&Math.abs(time-3.16*repeating.period)<repeating.period*.035;
      if(nearReturn){
        const x=xFor(target.longitude+720),y=yFor(target.latitude);
        ctx.strokeStyle="#b88b13";ctx.lineWidth=2;
        ctx.beginPath();ctx.arc(x,y,10,0,TAU);ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle="#d4d4d4";ctx.lineWidth=1;
    ctx.strokeRect(plotX,plotY,plotW,plotH);
    ctx.fillStyle="#777";ctx.font="10px Roboto,Arial,sans-serif";
    const conventional=stage<=3&&wraps<1.15;
    for(let lon=-180;lon<=domainMax+.001;lon+=conventional?90:180){
      const x=xFor(lon);
      if(x<plotX-1||x>plotX+plotW+1)continue;
      ctx.strokeStyle="#aaa";ctx.beginPath();ctx.moveTo(x,plotY+plotH);
      ctx.lineTo(x,plotY+plotH+5);ctx.stroke();
      const label=conventional?(lon<0?`${Math.abs(lon)}°W`:lon>0?`${lon}°E`:"0°"):
        `${lon>0?"+":""}${lon}°`;
      ctx.textAlign="center";ctx.fillText(label,x,plotY+plotH+19);
    }
    ctx.font="600 11px Roboto,Arial,sans-serif";
    ctx.fillText("Longitude",plotX+plotW/2,plotY+plotH+39);
    if(stage===4) {
      const annotate=(start,end,y,label)=>{
        const x1=xFor(start),x2=xFor(end);
        ctx.strokeStyle="#8f8f8f";ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x1,y+5);ctx.lineTo(x1,y);
        ctx.lineTo(x2,y);ctx.lineTo(x2,y+5);ctx.stroke();
        ctx.textAlign="center";ctx.fillStyle="#666";
        ctx.font="10.5px Roboto,Arial,sans-serif";
        ctx.fillText(label,(x1+x2)/2,y-6);
      };
      annotate(0,120,plotY-13,"½ orbital period");
      annotate(0,240,plotY-42,"1 orbital period");
    }
    ctx.textAlign="left";
    host.dataset.mapWraps=wraps.toFixed(3);
    host.dataset.groundLongitude=current.longitude.toFixed(5);
    host.dataset.groundLatitude=current.latitude.toFixed(5);
    host.dataset.groundUnwrapped=nearest.unwrapped.toFixed(5);
  }
  function render() {
    if(destroyed)return;
    if(transition<1){
      const t=ease(transition);
      view={left:from.left+(targetViews[stage].left-from.left)*t,
        wraps:from.wraps+(targetViews[stage].wraps-from.wraps)*t,
        half:from.half+(targetViews[stage].half-from.half)*t,
        origin:from.origin+(targetViews[stage].origin-from.origin)*t};
    }else view={...targetViews[stage]};
    const model=stage<2?ordinary:repeating;
    const time=stage<2?ordinaryTime:repeatTime;
    earth.rotation.y=OMEGA*time;
    const position=eciAt(model,time);
    satellite.geometry.attributes.position.setXYZ(0,position.x,position.y,position.z);
    satellite.geometry.attributes.position.needsUpdate=true;
    const leftWidth=Math.max(1,Math.round(view.left*width));
    renderer.domElement.style.opacity=String(stage<=3?1:
      clamp((view.left-.045)/(.36-.045)));
    camera.left=-view.half*leftWidth/height;camera.right=-camera.left;
    camera.top=view.half;camera.bottom=-view.half;camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setViewport(0,0,leftWidth,height);renderer.setScissor(0,0,leftWidth,height);
    renderer.render(scene,camera);renderer.setScissorTest(false);
    drawMap();
    host.dataset.stage=String(stage+1);
    host.dataset.eciX=position.x.toFixed(7);
    host.dataset.eciY=position.y.toFixed(7);
    host.dataset.eciZ=position.z.toFixed(7);
    host.dataset.earthRotationRad=(OMEGA*time).toFixed(7);
    host.dataset.simulationSeconds=time.toFixed(3);
  }
  function frame(now){
    if(paused||destroyed)return;
    const delta=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
    elapsed+=delta;
    if(transition<1)transition=Math.min(1,transition+delta/(reduced?.01:1.4));
    if(stage<2)ordinaryTime=Math.min(ordinary.period*(stage===0?.84:3.9),
      ordinaryTime+1100*delta);
    else repeatTime=Math.min(repeating.period*(stage===2?1:stage===3||stage===4?2:
      stage===6?3.16:3),
      repeatTime+7200*delta);
    render();raf=requestAnimationFrame(frame);
  }
  function goToState(index){
    if(destroyed||index<0||index>=7||index===stage)return false;
    const previous=stage;
    from={...view};stage=index;transition=0;elapsed=0;
    if(previous<2&&stage>=2){repeatTime=0;updateOrbit(repeating);}
    if(previous>=2&&stage<2){ordinaryTime=0;updateOrbit(ordinary);}
    if(stage===6)repeatTime=Math.max(2*repeating.period,
      Math.min(3*repeating.period,repeatTime));
    onStateChange(index,7);render();return true;
  }
  function jumpToState(index){
    if(index<0||index>=7)return;
    stage=index;view={...targetViews[index]};from={...view};transition=1;
    ordinaryTime=index===0?0:ordinary.period*.8;
    repeatTime=index<2?0:index===6?2*repeating.period:index===2?0:
      repeating.period*(index===3?.8:index===4?1.8:2.5);
    updateOrbit(index<2?ordinary:repeating);
    onStateChange(index,7);render();
  }
  function resize(){
    if(destroyed)return;
    width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);
    ratio=Math.min(devicePixelRatio||1,2);
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
    canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    canvas.style.width=width+"px";canvas.style.height=height+"px";
    render();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  onStateChange(0,7);resize();
  return {stateCount:7,getStateIndex:()=>stage,next:()=>goToState(stage+1),
    previous:()=>goToState(stage-1),goToState,jumpToState,
    start(){if(destroyed||document.hidden)return;paused=false;last=performance.now();
      if(!raf)raf=requestAnimationFrame(frame);},
    pause(){paused=true;cancelAnimationFrame(raf);raf=0;},resize,
    destroy(){destroyed=true;paused=true;cancelAnimationFrame(raf);observer.disconnect();
      scene.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
      satellite.material.map?.dispose();
      renderer.dispose();host.replaceChildren();}
  };
}
