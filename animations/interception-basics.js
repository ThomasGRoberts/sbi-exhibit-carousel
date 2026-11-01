import * as THREE from "three";
import { circleTexture } from "./globe-geometry.js";
import { EARTH_RADIUS_KM, MU_EARTH_KM3_S2, EARTH_ROTATION_RATE_RAD_PER_SEC,
  MODEL_REACH_KM, INTERCEPT_ALTITUDE_KM, ORBIT_ALTITUDE_KM, SBI_GOLD,
  MISSILE_BLACK_CSS, SITE_DOT_RADIUS_PX, blackTrailGradient } from "./sbi-style.js";

const R=EARTH_RADIUS_KM, BOOST_SECONDS=170, MODEL_ACCEL=.0980665;
const MODEL_SPEED=6, MODEL_WINDOW=170, SATELLITE_COUNT=36;
const ORBIT_R=1+ORBIT_ALTITUDE_KM/R;
const ORBIT_RATE=Math.sqrt(MU_EARTH_KM3_S2/(R+ORBIT_ALTITUDE_KM)**3);
const RETRO_RATE=ORBIT_RATE+EARTH_ROTATION_RATE_RAD_PER_SEC;
const ORBIT_PHASE=.08, ORBIT_INTRO_SECONDS=72, RELEASE_SECONDS=30;
const ORBIT_RELEASE_EPOCH=ORBIT_INTRO_SECONDS+RELEASE_SECONDS;
const ORBIT_MOVIE_SECONDS=12.2, TERMINAL_MOVIE_SECONDS=7;
const SURFACE_SITE_RADIUS_PX=4.1;
const TERMINAL_DEFENSE_FLIGHT_SECONDS=80;
const G_LOCAL=MU_EARTH_KM3_S2/(R+INTERCEPT_ALTITUDE_KM)**2;
const HORIZONTAL_ACCEL=.017;
const VERTICAL_NET_ACCEL=2*INTERCEPT_ALTITUDE_KM/BOOST_SECONDS**2;
const BURNOUT_VX=HORIZONTAL_ACCEL*BOOST_SECONDS;
const BURNOUT_VY=VERTICAL_NET_ACCEL*BOOST_SECONDS;
const BURNOUT_X=.5*HORIZONTAL_ACCEL*BOOST_SECONDS**2;
const COAST_SECONDS=(BURNOUT_VY+Math.sqrt(BURNOUT_VY**2+
  2*G_LOCAL*INTERCEPT_ALTITUDE_KM))/G_LOCAL;
const TOTAL_SECONDS=BOOST_SECONDS+COAST_SECONDS;
const GROUND_RANGE_KM=BURNOUT_X+BURNOUT_VX*COAST_SECONDS;
const START_ANGLE=-GROUND_RANGE_KM/(2*R);
const TERMINAL_COAST_SECONDS=(BURNOUT_VY+
  Math.sqrt(BURNOUT_VY**2+2*G_LOCAL*100))/G_LOCAL;
const TERMINAL_CONTACT_SECONDS=BOOST_SECONDS+TERMINAL_COAST_SECONDS;
const TERMINAL_MOVIE_START=600;
const TERMINAL_DEFENSE_START=TERMINAL_CONTACT_SECONDS-TERMINAL_DEFENSE_FLIGHT_SECONDS;
const PANE_STATES=[0,0,1,2,3,6,7,8];
const EARTH_CENTER=new THREE.Vector3(0,-1,0);
const Y_AXIS=new THREE.Vector3(0,1,0);
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const ease=x=>{x=clamp(x);return x*x*(3-2*x);};

function radialPoint(radius,angle) {
  return new THREE.Vector3(radius*Math.sin(angle),radius*Math.cos(angle)-1,0);
}
function trackAt(seconds) {
  const t=clamp(seconds,0,TOTAL_SECONDS),coast=Math.max(0,t-BOOST_SECONDS);
  const along=t<=BOOST_SECONDS ? .5*HORIZONTAL_ACCEL*t*t :
    BURNOUT_X+BURNOUT_VX*coast;
  const altitude=t<=BOOST_SECONDS ? .5*VERTICAL_NET_ACCEL*t*t :
    INTERCEPT_ALTITUDE_KM+BURNOUT_VY*coast-.5*G_LOCAL*coast*coast;
  return radialPoint(1+Math.max(0,altitude)/R,START_ANGLE+along/R);
}
function reachKm(seconds) {
  const t=clamp(seconds,0,MODEL_WINDOW),cap=MODEL_SPEED/MODEL_ACCEL;
  return t<=cap ? .5*MODEL_ACCEL*t*t : MODEL_SPEED*(t-cap/2);
}
function orbitalAngle(index,seconds) {
  return -Math.PI+index*2*Math.PI/SATELLITE_COUNT+ORBIT_PHASE-RETRO_RATE*seconds;
}
function orbitalPosition(index,seconds) {
  return radialPoint(ORBIT_R,orbitalAngle(index,seconds));
}
function orbitalVelocity(index,seconds) {
  const a=orbitalAngle(index,seconds);
  return new THREE.Vector3(-ORBIT_R*RETRO_RATE*Math.cos(a),
    ORBIT_R*RETRO_RATE*Math.sin(a),0);
}
function eligible(satellite,target) {
  const delta=satellite.clone().sub(target);
  const radial=target.clone().sub(EARTH_CENTER).normalize();
  return delta.length()*R<=MODEL_REACH_KM&&delta.dot(radial)>=0;
}
function line(points,color,opacity=1,dashed=false) {
  const material=dashed?new THREE.LineDashedMaterial({color,opacity,transparent:true,
    dashSize:.0016,gapSize:.0024,depthTest:false,depthWrite:false}):
    new THREE.LineBasicMaterial({color,opacity,transparent:true,
      depthTest:false,depthWrite:false});
  const object=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),material);
  if(dashed)object.computeLineDistances();
  object.frustumCulled=false;object.renderOrder=8;
  return object;
}
function drawThrough(object,count) {
  object.geometry.setDrawRange(0,Math.min(object.geometry.attributes.position.count,
    Math.max(0,Math.floor(count))));
}
function point(texture,color,size) {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute([0,0,.005],3));
  const object=new THREE.Points(geometry,new THREE.PointsMaterial({
    map:texture,color,size,sizeAttenuation:false,transparent:true,
    depthTest:false,depthWrite:false,alphaTest:.02
  }));
  object.frustumCulled=false;object.renderOrder=17;return object;
}
function movePoint(object,p) {
  object.geometry.attributes.position.setXYZ(0,p.x,p.y,p.z);
  object.geometry.attributes.position.needsUpdate=true;
}
function makeGraticule() {
  const group=new THREE.Group();
  const material=new THREE.LineBasicMaterial({color:0xc9c9c9,transparent:true,
    opacity:.38,depthTest:true,depthWrite:false});
  function unit(lat,lon) {
    return new THREE.Vector3(Math.cos(lat)*Math.sin(lon),
      Math.sin(lat),Math.cos(lat)*Math.cos(lon)).multiplyScalar(1.0012);
  }
  for(let degrees=-60;degrees<=60;degrees+=20) {
    const lat=degrees*Math.PI/180;
    const points=Array.from({length:241},(_,i)=>
      unit(lat,-Math.PI+2*Math.PI*i/240));
    const curve=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      material.clone());
    group.add(curve);
  }
  for(let degrees=-180;degrees<180;degrees+=30) {
    const lon=degrees*Math.PI/180;
    const points=Array.from({length:151},(_,i)=>
      unit(-Math.PI/2+Math.PI*i/150,lon));
    const curve=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      material.clone());
    group.add(curve);
  }
  material.dispose();
  group.position.y=-1;
  group.rotation.x=-Math.PI/3;
  return group;
}
function surfaceGeometry(anchor,normal,tangent,across,inner,outer) {
  const segments=96,positions=[],indices=[];
  if(inner===0) {
    // This first mesh vertex is the exact authoritative trajectory/site point.
    const center=normal.clone().multiplyScalar(1.002);
    positions.push(center.x,center.y,center.z);
    for(let i=0;i<=segments;i++) {
      const az=i*2*Math.PI/segments;
      const p=normal.clone().multiplyScalar(Math.cos(outer))
        .addScaledVector(tangent,Math.sin(outer)*Math.cos(az))
        .addScaledVector(across,Math.sin(outer)*Math.sin(az))
        .multiplyScalar(1.002);
      positions.push(...p.toArray());
      if(i<segments)indices.push(0,i+1,i+2);
    }
  } else {
    for(let i=0;i<=segments;i++) {
      const az=i*2*Math.PI/segments;
      for(const radius of [inner,outer]) {
        const p=normal.clone().multiplyScalar(Math.cos(radius))
          .addScaledVector(tangent,Math.sin(radius)*Math.cos(az))
          .addScaledVector(across,Math.sin(radius)*Math.sin(az))
          .multiplyScalar(1.003);
        positions.push(...p.toArray());
      }
      if(i<segments) {
        const k=2*i;indices.push(k,k+1,k+2,k+1,k+3,k+2);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);geometry.translate(0,-1,0);
  return geometry;
}
function makeSurfaceSite(anchor) {
  const normal=anchor.clone().sub(EARTH_CENTER).normalize();
  const tangent=new THREE.Vector3(normal.y,-normal.x,0).normalize();
  const across=new THREE.Vector3(0,0,1);
  const core=new THREE.Mesh(surfaceGeometry(anchor,normal,tangent,across,0,.01),
    new THREE.MeshBasicMaterial({color:SBI_GOLD,side:THREE.DoubleSide,
      transparent:true,opacity:.95,depthTest:true,depthWrite:false}));
  core.frustumCulled=false;
  const pulse=new THREE.Mesh(surfaceGeometry(anchor,normal,tangent,across,.004,.0046),
    new THREE.MeshBasicMaterial({color:SBI_GOLD,side:THREE.DoubleSide,
      transparent:true,opacity:0,depthTest:true,depthWrite:false,
      polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
  core.renderOrder=12;pulse.renderOrder=13;
  const group=new THREE.Group();group.add(core,pulse);
  return {anchor,normal,tangent,across,core,pulse,group,coreRadius:0};
}
function updateSiteCore(site,worldPerPixel,radiusPixels=SURFACE_SITE_RADIUS_PX) {
  const radius=radiusPixels*worldPerPixel;
  if(Math.abs(radius-site.coreRadius)<.00012)return;
  site.coreRadius=radius;
  site.core.geometry.dispose();
  site.core.geometry=surfaceGeometry(site.anchor,site.normal,site.tangent,
    site.across,0,radius);
}
function updatePulse(site,seconds,worldPerPixel,dotRadiusPixels=SURFACE_SITE_RADIUS_PX) {
  site.pulse.visible=seconds>=0&&seconds<1.4;
  if(!site.pulse.visible)return;
  const fraction=clamp(seconds/1.4),radius=dotRadiusPixels*
    (1.4+4.1*(1-(1-fraction)**3))*worldPerPixel;
  site.pulse.geometry.dispose();
  site.pulse.geometry=surfaceGeometry(site.anchor,site.normal,site.tangent,site.across,
    Math.max(.0001,radius-.21*dotRadiusPixels*worldPerPixel),
    radius+.21*dotRadiusPixels*worldPerPixel);
  site.pulse.material.opacity=.8*(1-fraction**3);
}
function hermite(p0,v0,p1,v1,duration,u) {
  const s=clamp(u),s2=s*s,s3=s2*s;
  return p0.clone().multiplyScalar(2*s3-3*s2+1)
    .addScaledVector(v0,(s3-2*s2+s)*duration)
    .addScaledVector(p1,-2*s3+3*s2)
    .addScaledVector(v1,(s3-s2)*duration);
}
function hermiteAcceleration(p0,v0,p1,v1,duration,u) {
  const s=clamp(u);
  return p0.clone().multiplyScalar(12*s-6)
    .addScaledVector(v0,(6*s-4)*duration)
    .addScaledVector(p1,-12*s+6)
    .addScaledVector(v1,(6*s-2)*duration)
    .divideScalar(duration*duration);
}
function makeGlowTexture() {
  const canvas=document.createElement("canvas");canvas.width=canvas.height=128;
  const context=canvas.getContext("2d");
  const gradient=context.createRadialGradient(64,64,0,64,64,63);
  gradient.addColorStop(0,"rgba(255,255,246,1)");
  gradient.addColorStop(.18,"rgba(255,231,154,.96)");
  gradient.addColorStop(.52,"rgba(226,174,30,.34)");
  gradient.addColorStop(1,"rgba(226,174,30,0)");
  context.fillStyle=gradient;context.fillRect(0,0,128,128);
  return new THREE.CanvasTexture(canvas);
}
function createFlash() {
  const group=new THREE.Group();
  const texture=makeGlowTexture();
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({
    map:texture,transparent:true,opacity:0,depthTest:false,depthWrite:false}));
  const core=new THREE.Mesh(new THREE.SphereGeometry(1,32,24),
    new THREE.MeshBasicMaterial({color:0xfffbe0,transparent:true,opacity:0,
      depthTest:false,depthWrite:false}));
  // Keep the two black contact dots above the collision light.
  glow.renderOrder=15;core.renderOrder=16;
  group.add(glow,core);
  function update(point,age) {
    const visible=age>=0&&age<1.05;
    group.visible=visible;
    if(!visible)return;
    const p=clamp(age/1.05),envelope=Math.sin(Math.PI*p);
    group.position.copy(point);group.position.z=.012;
    glow.scale.setScalar(.019+.018*envelope);
    glow.material.opacity=(1-p)**.6;
    core.scale.setScalar(.0028+.0048*envelope);
    core.material.opacity=(1-p)**.7;
  }
  return {group,texture,update};
}

export async function createAnimation(host,{onStateChange=()=>{}}={}) {
  const samples=Array.from({length:Math.ceil(TOTAL_SECONDS)+1},(_,i)=>
    trackAt(Math.min(i,TOTAL_SECONDS)));
  const launch=samples[0],spaceContact=trackAt(BOOST_SECONDS);
  const terminalContact=trackAt(TERMINAL_CONTACT_SECONDS);
  const terminalAngle=START_ANGLE+GROUND_RANGE_KM/R;
  const defenseAnchor=radialPoint(1,terminalAngle-.05);
  const originalSite=makeSurfaceSite(launch);
  const defenseSite=makeSurfaceSite(defenseAnchor);
  const visibleLaunch=originalSite.normal.clone().multiplyScalar(1.002).add(EARTH_CENTER);
  const alignmentKm=launch.distanceTo(originalSite.anchor)*R;
  if(alignmentKm!==0||samples[0].distanceTo(launch)!==0)
    throw new Error("Ballistic trajectory does not start at the marker center");

  const defenderNormal=defenseAnchor.clone().sub(EARTH_CENTER).normalize();
  const gravity=defenderNormal.clone().multiplyScalar(-MU_EARTH_KM3_S2/(R*R*R));
  const defenderVelocity=terminalContact.clone().sub(defenseAnchor)
    .divideScalar(TERMINAL_DEFENSE_FLIGHT_SECONDS)
    .addScaledVector(gravity,-.5*TERMINAL_DEFENSE_FLIGHT_SECONDS);
  function defenseAt(seconds) {
    const t=clamp(seconds,0,TERMINAL_DEFENSE_FLIGHT_SECONDS);
    return defenseAnchor.clone().addScaledVector(defenderVelocity,t)
      .addScaledVector(gravity,.5*t*t);
  }
  const defenseSamples=Array.from({length:161},(_,i)=>
    defenseAt(i*TERMINAL_DEFENSE_FLIGHT_SECONDS/160));
  if(defenseSamples.at(-1).distanceTo(terminalContact)*R>1e-6)
    throw new Error("Terminal defender does not meet the ballistic missile");

  const guidanceDuration=MODEL_WINDOW-RELEASE_SECONDS;
  function guidanceAtEpoch(releaseEpoch) {
    const candidates=Array.from({length:SATELLITE_COUNT},(_,i)=>i)
      .filter(i=>eligible(orbitalPosition(i,releaseEpoch),spaceContact)&&
        orbitalPosition(i,releaseEpoch).x>spaceContact.x)
      .sort((a,b)=>orbitalPosition(a,releaseEpoch).distanceTo(spaceContact)-
        orbitalPosition(b,releaseEpoch).distanceTo(spaceContact));
    for(const index of candidates) {
      const start=orbitalPosition(index,releaseEpoch);
      const initialVelocity=orbitalVelocity(index,releaseEpoch);
      const endVelocity=new THREE.Vector3(-1/R,-2/R,0);
      const at=u=>hermite(start,initialVelocity,spaceContact,endVelocity,guidanceDuration,u);
      const points=Array.from({length:201},(_,j)=>at(j/200));
      const pathKm=points.reduce((sum,p,j)=>
        j?sum+p.distanceTo(points[j-1])*R:0,0);
      if(pathKm>reachKm(guidanceDuration))continue;
      let peakThrust=0,minAltitude=Infinity;
      for(let j=0;j<=200;j++) {
        const u=j/200,p=points[j],radial=p.clone().sub(EARTH_CENTER);
        const radiusKm=radial.length()*R;
        minAltitude=Math.min(minAltitude,radiusKm-R);
        const acceleration=hermiteAcceleration(start,initialVelocity,
          spaceContact,endVelocity,guidanceDuration,u).multiplyScalar(R);
        const gravitational=radial.normalize()
          .multiplyScalar(-MU_EARTH_KM3_S2/(radiusKm*radiusKm));
        peakThrust=Math.max(peakThrust,acceleration.sub(gravitational).length());
      }
      if(peakThrust<=MODEL_ACCEL&&minAltitude>=INTERCEPT_ALTITUDE_KM-.01) {
        const result={index,start,initialVelocity,endVelocity,points,pathKm,
          peakThrust,minAltitude,at,releaseEpoch};
        if(result.at(1).distanceTo(spaceContact)*R>1e-6)
          throw new Error("Orbital interceptor does not reach missile at contact");
        return result;
      }
    }
    return null;
  }
  function nextGuidance(minReleaseEpoch) {
    for(let offset=0;offset<=2400;offset+=2) {
      const result=guidanceAtEpoch(minReleaseEpoch+offset);
      if(result)return result;
    }
    throw new Error("No future retrograde satellite meets the model bounds");
  }
  let guidance=nextGuidance(ORBIT_RELEASE_EPOCH);
  const initialGuidance=guidance;
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
  const camera=new THREE.OrthographicCamera(-.22,.22,.124,-.124,.01,10);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  host.append(renderer.domElement);
  const overlay=document.createElement("canvas");overlay.className="intercept-overlay";
  host.append(overlay);const context=overlay.getContext("2d");
  let overlayRatio=1;
  const earth=new THREE.Mesh(new THREE.SphereGeometry(1,160,160),
    new THREE.MeshBasicMaterial({color:0xf7f7f7,depthTest:true,depthWrite:true}));
  earth.position.copy(EARTH_CENTER);scene.add(earth,makeGraticule());
  scene.add(originalSite.group,defenseSite.group);
  const ballistic=line(samples,0x222222,.38,true);
  ballistic.material.depthTest=true;
  const trajectoryVertex=ballistic.geometry.attributes.position;
  if([0,1,2].some(axis=>Math.abs(trajectoryVertex.array[axis]-
    new Float32Array(launch.toArray())[axis])>1e-8))
    throw new Error("Ballistic path does not start at the launch-site anchor");
  const terminalGhost=line(samples.slice(Math.floor(TERMINAL_CONTACT_SECONDS)),
    0x9b9b9b,.47,true);
  const spaceGhost=line(samples.slice(BOOST_SECONDS),0x9b9b9b,.47,true);
  const defenderLine=line(defenseSamples,SBI_GOLD,.94);
  const orbit=line(Array.from({length:321},(_,i)=>
    radialPoint(ORBIT_R,-.43+.86*i/320)),0x777777,.56);
  const guidedLine=line(guidance.points,SBI_GOLD,.88);
  scene.add(ballistic,terminalGhost,spaceGhost,defenderLine,orbit,guidedLine);
  const blackTexture=circleTexture("#111111");
  const goldTexture=circleTexture("#ffffff","#111111",12);
  const missile=point(blackTexture,0x111111,18);
  const defender=point(blackTexture,0x111111,18);
  const interceptor=point(blackTexture,0x111111,18);
  scene.add(missile,defender,interceptor);
  const positions=new Float32Array(SATELLITE_COUNT*3),colors=new Float32Array(SATELLITE_COUNT*3);
  const satelliteGeometry=new THREE.BufferGeometry();
  satelliteGeometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
  satelliteGeometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  const satellites=new THREE.Points(satelliteGeometry,new THREE.PointsMaterial({
    map:goldTexture,vertexColors:true,size:20,sizeAttenuation:false,
    transparent:true,depthTest:true,depthWrite:false,alphaTest:.02
  }));
  satellites.frustumCulled=false;satellites.renderOrder=16;scene.add(satellites);
  const flash=createFlash();scene.add(flash.group);

  const views=[
    {x:0,y:.035,half:.22},{x:0,y:.035,half:.22},
    {x:0,y:.035,half:.22},{x:0,y:.035,half:.22},
    {x:0,y:.035,half:.22},{x:0,y:.035,half:.22},
    {x:0,y:.035,half:.22},{x:0,y:.035,half:.22},
    {x:0,y:.035,half:.22}
  ];
  const reducedMotion=matchMedia("(prefers-reduced-motion: reduce)").matches;
  let stateIndex=0,paneIndex=0,elapsed=0,transition=null,paused=true,destroyed=false;
  let raf=0,lastFrame=0,orbitClock=0,currentView={...views[0]};
  let engagementStartClock=ORBIT_INTRO_SECONDS,aligning=false,savedStage6Clock=0;
  function updateSatellites(seconds,transferSeconds) {
    for(let i=0;i<SATELLITE_COUNT;i++) {
      const p=orbitalPosition(i,seconds);
      positions.set([p.x,p.y,.005],i*3);
      const isGold=(i===guidance.index&&stateIndex>=7)||
        eligible(orbitalPosition(i,seconds),spaceContact);
      colors.set(isGold?[.72,.55,.075]:[.68,.68,.68],i*3);
    }
    satelliteGeometry.attributes.position.needsUpdate=true;
    satelliteGeometry.attributes.color.needsUpdate=true;
    const visibleCount=stateIndex===6?
      Math.min(SATELLITE_COUNT,Math.floor(elapsed/.12)+1):SATELLITE_COUNT;
    satelliteGeometry.setDrawRange(0,visibleCount);
    host.dataset.visibleSatelliteCount=String(visibleCount);
  }
  function drawBallisticOverlay() {
    const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
    context.setTransform(overlayRatio,0,0,overlayRatio,0,0);
    context.clearRect(0,0,width,height);
    if(stateIndex===0)return;
    const screen=point=>{const p=point.clone().project(camera);
      return [(p.x*.5+.5)*width,(-p.y*.5+.5)*height];};
    const launchScreen=screen(visibleLaunch);
    function drawLaunchDot() {
      let join;
      for(const sample of samples){
        const point=screen(sample);
        if(Math.hypot(point[0]-launchScreen[0],point[1]-launchScreen[1])>=12){
          join=point;break;
        }
      }
      if(join){
        context.beginPath();context.moveTo(...launchScreen);context.lineTo(...join);
        context.setLineDash([]);context.strokeStyle="#242424";
        context.lineWidth=1.8;context.globalAlpha=.7;context.stroke();
      }
      context.beginPath();context.arc(...launchScreen,4.2,0,Math.PI*2);
      context.fillStyle="#b88b13";context.globalAlpha=1;context.fill();
    }
    function stroke(points,first,last,{dotted=false,gradient=false,opacity=1,widthPx=3.3,
      terminalPoint=null}={}) {
      first=Math.max(0,Math.floor(first));last=Math.min(points.length-1,Math.floor(last));
      if(last<=first)return;
      context.beginPath();
      for(let i=first;i<=last;i++) {
        const [x,y]=screen(i===0&&points===samples?visibleLaunch:points[i]);
        if(i===first)context.moveTo(x,y);else context.lineTo(x,y);
      }
      if(terminalPoint){const [x,y]=screen(terminalPoint);context.lineTo(x,y);}
      context.lineJoin="round";context.lineCap="round";
      context.lineWidth=dotted?1.8:widthPx;
      context.setLineDash(dotted?[2,6]:[]);
      context.globalAlpha=opacity;
      if(gradient) {
        const from=screen(points[first]),to=screen(terminalPoint||points[last]);
        context.strokeStyle=blackTrailGradient(context,from,to);
      } else context.strokeStyle=dotted?"#242424":MISSILE_BLACK_CSS;
      context.stroke();context.setLineDash([]);context.globalAlpha=1;
    }
    if(stateIndex===1) {
      stroke(samples,0,(samples.length-1)*ease(elapsed/2.3),
        {dotted:true,opacity:.7});
      const curve=samples.map(screen),distances=[0];
      for(let i=1;i<curve.length;i++)distances[i]=distances[i-1]+Math.hypot(
        curve[i][0]-curve[i-1][0],curve[i][1]-curve[i-1][1]);
      const atDistance=value=>{
        let i=1;while(i<distances.length-1&&distances[i]<value)i++;
        const span=Math.max(.001,distances[i]-distances[i-1]);
        const t=clamp((value-distances[i-1])/span);
        return {x:curve[i-1][0]+(curve[i][0]-curve[i-1][0])*t,
          y:curve[i-1][1]+(curve[i][1]-curve[i-1][1])*t,
          angle:Math.atan2(curve[i][1]-curve[i-1][1],curve[i][0]-curve[i-1][0])};
      };
      const reveal=ease(elapsed/2.3);
      context.font="600 12px Roboto, Arial, sans-serif";
      context.textBaseline="middle";
      const phases=[
        {label:"Boost phase",time:BOOST_SECONDS*.55},
        {label:"Midcourse phase",time:(BOOST_SECONDS+TERMINAL_CONTACT_SECONDS)*.5},
        {label:"Terminal phase",time:(TERMINAL_CONTACT_SECONDS+TOTAL_SECONDS)*.5}
      ];
      for(const {label,time} of phases) {
        if(time/TOTAL_SECONDS>reveal+.02)continue;
        const center=distances[Math.min(samples.length-1,Math.round(time))];
        const glyphs=[...label],widths=glyphs.map(glyph=>context.measureText(glyph).width);
        const total=widths.reduce((sum,value)=>sum+value,0);
        let distance=clamp(center,total/2+8,distances.at(-1)-total/2-8)-total/2;
        context.fillStyle="#4d4d4d";
        for(let i=0;i<glyphs.length;i++) {
          const width=widths[i],p=atDistance(distance+width/2);
          context.save();context.translate(p.x,p.y);context.rotate(p.angle);
          context.fillText(glyphs[i],-width/2,-15);context.restore();
          distance+=width;
        }
      }
      drawLaunchDot();
      return;
    }
    if(stateIndex===2){stroke(samples,0,samples.length-1,{dotted:true,opacity:.7});}
    if(stateIndex===5) {
      stroke(samples,0,(samples.length-1)*ease(elapsed/2),
        {dotted:true,opacity:.38});return;
    }
    if(stateIndex===6)return;
    if([3,4,7,8].includes(stateIndex)) {
      const sim=stateIndex===3?TERMINAL_CONTACT_SECONDS*
        clamp(elapsed/TERMINAL_MOVIE_SECONDS):
        stateIndex===4?TERMINAL_CONTACT_SECONDS:
        stateIndex===8?BOOST_SECONDS:BOOST_SECONDS*clamp(elapsed/ORBIT_MOVIE_SECONDS);
      const head=Math.floor(sim);
      const exact=stateIndex===3?trackAt(sim):stateIndex===4?terminalContact:trackAt(sim);
      if(stateIndex===3)stroke(samples,0,samples.length-1,{dotted:true,opacity:.48});
      stroke(samples,0,head,{gradient:true,widthPx:3.4,
        terminalPoint:exact,opacity:stateIndex===8?1-ease((elapsed-.7)/3):1});
    }
    if(stateIndex===3||stateIndex===4) {
      const sim=stateIndex===4?TERMINAL_CONTACT_SECONDS:
        TERMINAL_CONTACT_SECONDS*clamp(elapsed/TERMINAL_MOVIE_SECONDS);
      const defenseTime=sim-TERMINAL_DEFENSE_START;
      const head=Math.floor(defenseSamples.length*
        clamp(defenseTime/TERMINAL_DEFENSE_FLIGHT_SECONDS));
      stroke(defenseSamples,0,head,
        {gradient:true,widthPx:3.3,terminalPoint:defenseAt(defenseTime)});
    }
    if(stateIndex===7||stateIndex===8) {
      const movie=stateIndex===8?BOOST_SECONDS:
        BOOST_SECONDS*clamp(elapsed/ORBIT_MOVIE_SECONDS);
      const head=Math.floor(guidance.points.length*
        clamp((movie-RELEASE_SECONDS)/guidanceDuration));
      stroke(guidance.points,Math.max(0,head-125),head,
        {gradient:true,widthPx:3.3,
          terminalPoint:guidance.at((movie-RELEASE_SECONDS)/guidanceDuration),
          opacity:stateIndex===8?1-ease((elapsed-.7)/3):1});
    }
    if(stateIndex===7) {
      const movie=BOOST_SECONDS*clamp(elapsed/ORBIT_MOVIE_SECONDS);
      const age=(movie-RELEASE_SECONDS)/BOOST_SECONDS*ORBIT_MOVIE_SECONDS;
      if(age>=0&&age<1.2) {
        const [sx,sy]=screen(guidance.start);
        context.beginPath();context.arc(sx,sy,5+9*ease(age/1.2),0,Math.PI*2);
        context.strokeStyle=`rgba(184,139,19,${.7*(1-age/1.2)})`;
        context.lineWidth=1.8;context.stroke();
      }
    }
    if(stateIndex===2||stateIndex===3||stateIndex===4)drawLaunchDot();
  }
  function render() {
    if(destroyed)return;
    const view=views[stateIndex],from=transition?.fromView??view;
    const cameraProgress=transition?ease(transition.elapsed/transition.duration):1;
    let x=from.x+(view.x-from.x)*cameraProgress;
    let y=from.y+(view.y-from.y)*cameraProgress;
    const fly=paneIndex===0?0:paneIndex===1?ease(elapsed/4.1):1;
    const settledHalf=from.half+(view.half-from.half)*cameraProgress;
    let half=.95*(1-fly)+settledHalf*fly;
    // Keep the whole ballistic arc in frame during the terminal engagement.
    currentView={x,y,half};
    const aspect=Math.max(1,host.clientWidth)/Math.max(1,host.clientHeight);
    camera.left=-half;camera.right=half;
    camera.top=half/aspect;camera.bottom=-half/aspect;
    const targetY=-.43*(1-fly)+y*fly;
    const terminalAbove=stateIndex===2||stateIndex===3?1.5:.32;
    camera.position.set(x+.12*Math.sin(elapsed*.22)*(1-fly),
      targetY+(2.35*(1-fly)+terminalAbove*fly),2.2*(1-fly)+3*fly);
    camera.lookAt(x,targetY,0);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    const perPixel=2*half/Math.max(1,host.clientWidth);
    updateSiteCore(originalSite,perPixel,SURFACE_SITE_RADIUS_PX);
    updateSiteCore(defenseSite,perPixel,6);
    originalSite.core.visible=originalSite.normal.dot(
      camera.position.clone().sub(originalSite.anchor))>0;
    defenseSite.core.visible=defenseSite.normal.dot(
      camera.position.clone().sub(defenseSite.anchor))>0;
    updatePulse(originalSite,stateIndex===0?elapsed%8.5:-1,perPixel,SURFACE_SITE_RADIUS_PX);
    defenseSite.group.visible=stateIndex>=2&&stateIndex<=4;
    if(defenseSite.group.visible)updatePulse(defenseSite,-1,perPixel);
    const markerScreen=launch.clone().project(camera);
    const trajectoryScreen=samples[0].clone().project(camera);
    host.dataset.launchProjectionErrorPx=Math.hypot(markerScreen.x-trajectoryScreen.x,
      markerScreen.y-trajectoryScreen.y)*host.clientWidth/2;
    ballistic.visible=stateIndex===6;
    terminalGhost.visible=false;spaceGhost.visible=false;
    terminalGhost.visible=false;spaceGhost.visible=false;
    defenderLine.visible=false;
    if(stateIndex===3) {
      const filmTime=TERMINAL_CONTACT_SECONDS*clamp(elapsed/TERMINAL_MOVIE_SECONDS);
      const defenseTime=filmTime-TERMINAL_DEFENSE_START;
      drawThrough(defenderLine,defenseSamples.length*
        clamp(defenseTime/TERMINAL_DEFENSE_FLIGHT_SECONDS));
      defender.visible=defenseTime>=0;
      if(defender.visible)movePoint(defender,elapsed>=TERMINAL_MOVIE_SECONDS?
        terminalContact:defenseAt(defenseTime));
      missile.visible=true;
      movePoint(missile,elapsed>=TERMINAL_MOVIE_SECONDS?
        terminalContact:trackAt(filmTime));
    } else if(stateIndex===4) {
      drawThrough(defenderLine,defenseSamples.length);
      defender.visible=true;missile.visible=true;
      movePoint(defender,terminalContact);
      movePoint(missile,terminalContact);
    } else {
      defender.visible=false;
      const sim=stateIndex===7?BOOST_SECONDS*clamp(elapsed/ORBIT_MOVIE_SECONDS):0;
      missile.visible=stateIndex===7||stateIndex===8;
      if(missile.visible)movePoint(missile,stateIndex===8||elapsed>=ORBIT_MOVIE_SECONDS?
        spaceContact:trackAt(sim));
    }
    orbit.visible=stateIndex>=6;satellites.visible=stateIndex>=6;
    const movieSeconds=stateIndex===7?BOOST_SECONDS*clamp(elapsed/ORBIT_MOVIE_SECONDS):
      stateIndex===8?BOOST_SECONDS:0;
    const orbitalSeconds=stateIndex>=6?orbitClock:0;
    if(stateIndex>=6)updateSatellites(orbitalSeconds,movieSeconds);
    interceptor.visible=stateIndex===7&&movieSeconds>=RELEASE_SECONDS||stateIndex===8;
    missile.material.opacity=interceptor.material.opacity=stateIndex===8?
      1-ease((elapsed-1.2)/2.5):1;
    if(interceptor.visible)movePoint(interceptor,stateIndex===8||
      elapsed>=ORBIT_MOVIE_SECONDS?spaceContact:
      guidance.at((movieSeconds-RELEASE_SECONDS)/guidanceDuration));
    guidedLine.visible=stateIndex===7||stateIndex===8;
    if(stateIndex===7)
      drawThrough(guidedLine,guidance.points.length*
        clamp((movieSeconds-RELEASE_SECONDS)/guidanceDuration));
    else if(stateIndex===8)drawThrough(guidedLine,guidance.points.length);
    const contactPoint=stateIndex===3||stateIndex===4?terminalContact:spaceContact;
    const age=stateIndex===3?elapsed-TERMINAL_MOVIE_SECONDS:
      stateIndex===4?elapsed:
      stateIndex===7?elapsed-ORBIT_MOVIE_SECONDS:
      stateIndex===8?elapsed:-1;
    flash.update(contactPoint,stateIndex===4?-1:age);
    drawBallisticOverlay();
    host.dataset.stage=String(paneIndex+1);
    host.dataset.launchWorldErrorKm=alignmentKm.toExponential(3);
    host.dataset.terminalContactErrorKm=defenseAt(TERMINAL_DEFENSE_FLIGHT_SECONDS)
      .distanceTo(terminalContact)*R;
    host.dataset.spaceContactErrorKm=guidance.at(1).distanceTo(spaceContact)*R;
    host.dataset.guidedPathKm=guidance.pathKm.toFixed(2);
    host.dataset.guidedPeakThrustKmS2=guidance.peakThrust.toFixed(5);
    host.dataset.guidedMinAltitudeKm=guidance.minAltitude.toFixed(2);
    host.dataset.selectedInterceptor=String(guidance.index);
    host.dataset.guidanceReleaseEpoch=guidance.releaseEpoch.toFixed(2);
    host.dataset.orbitClock=orbitClock.toFixed(2);
    host.dataset.aligning=String(aligning);
    host.dataset.guidanceStartErrorKm=guidance.at(0)
      .distanceTo(orbitalPosition(guidance.index,guidance.releaseEpoch))*R;
    renderer.render(scene,camera);
  }
  function frame(now) {
    if(paused||destroyed)return;
    const delta=Math.min(100,Math.max(0,now-lastFrame));lastFrame=now;
    if(transition){
      transition.elapsed+=delta;
      if(transition.elapsed>=transition.duration)transition=null;
    }
    if(stateIndex===7&&aligning) {
      orbitClock=Math.min(engagementStartClock,orbitClock+120*delta/1000);
      if(orbitClock>=engagementStartClock){aligning=false;elapsed=0;}
    } else {
      elapsed+=delta/1000;
      if(stateIndex===6||stateIndex===8)orbitClock+=24*delta/1000;
      if(stateIndex===7)orbitClock=engagementStartClock+
        BOOST_SECONDS*clamp(elapsed/ORBIT_MOVIE_SECONDS);
    }
    render();raf=requestAnimationFrame(frame);
  }
  function schedule(){
    if(paused||destroyed||raf)return;
    lastFrame=performance.now();raf=requestAnimationFrame(frame);
  }
  function goToState(index){
    if(destroyed||index<0||index>=PANE_STATES.length||index===paneIndex)return false;
    const previous=stateIndex;paneIndex=index;stateIndex=PANE_STATES[index];elapsed=0;
    if(stateIndex===6)orbitClock=previous===7||previous===8?savedStage6Clock:0;
    if(stateIndex===7) {
      if(previous===8) {orbitClock=engagementStartClock;aligning=false;}
      else {
        savedStage6Clock=orbitClock;
        guidance=nextGuidance(orbitClock+RELEASE_SECONDS);
        engagementStartClock=guidance.releaseEpoch-RELEASE_SECONDS;
        aligning=engagementStartClock>orbitClock+1e-6;
        guidedLine.geometry.dispose();
        guidedLine.geometry=new THREE.BufferGeometry().setFromPoints(guidance.points);
      }
    }
    if(stateIndex===8) {aligning=false;orbitClock=engagementStartClock+BOOST_SECONDS;}
    transition={fromView:{...currentView},elapsed:0,duration:reducedMotion?1:
      stateIndex===2?1500:stateIndex===5?1250:900};
    onStateChange(index,PANE_STATES.length);schedule();return true;
  }
  function jumpToState(index){
    if(index<0||index>=PANE_STATES.length)return;
    paneIndex=index;stateIndex=PANE_STATES[index];
    transition=null;elapsed=stateIndex===6?6:0;
    if(stateIndex>=6) {
      guidance=initialGuidance;engagementStartClock=ORBIT_INTRO_SECONDS;
      aligning=false;orbitClock=stateIndex===6?ORBIT_INTRO_SECONDS:
        ORBIT_INTRO_SECONDS+(stateIndex===8?BOOST_SECONDS:0);
    }
    onStateChange(index,PANE_STATES.length);render();
  }
  function resize(){
    if(destroyed)return;
    const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,2,4096/width,2304/height));
    renderer.setSize(width,height,false);
    overlayRatio=renderer.getPixelRatio();
    overlay.width=Math.round(width*overlayRatio);overlay.height=Math.round(height*overlayRatio);
    overlay.style.width=width+"px";overlay.style.height=height+"px";
    render();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  onStateChange(0,PANE_STATES.length);resize();
  return {
    stateCount:PANE_STATES.length,getStateIndex:()=>paneIndex,
    next:()=>goToState(paneIndex+1),previous:()=>goToState(paneIndex-1),
    goToState,jumpToState,
    isTransitioning:()=>Boolean(transition)||
      (stateIndex===0&&elapsed<2.2)||(stateIndex===1&&elapsed<2.3)||
      (stateIndex===3&&elapsed<TERMINAL_MOVIE_SECONDS)||
      (stateIndex===6&&elapsed<4.5)||
      (stateIndex===7&&elapsed<ORBIT_MOVIE_SECONDS),
    start(){if(!destroyed&&!document.hidden){paused=false;schedule();}},
    pause(){paused=true;cancelAnimationFrame(raf);raf=0;},
    restart(){goToState(0);},resize,
    destroy(){
      if(destroyed)return;destroyed=true;paused=true;cancelAnimationFrame(raf);
      observer.disconnect();scene.traverse(object=>{
        object.geometry?.dispose();
        const materials=Array.isArray(object.material)?object.material:[object.material];
        materials.forEach(material=>material?.dispose());
      });
      flash.texture.dispose();blackTexture.dispose();goldTexture.dispose();
      renderer.dispose();host.replaceChildren();
    }
  };
}

