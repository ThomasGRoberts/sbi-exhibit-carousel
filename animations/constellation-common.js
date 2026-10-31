import * as THREE from "three";
import { makeEarth, circleTexture } from "./globe-geometry.js";
import { EARTH_RADIUS_KM, MU_EARTH_KM3_S2, EARTH_ROTATION_RATE_RAD_PER_SEC } from "./sbi-style.js";

export const R=EARTH_RADIUS_KM, MU=MU_EARTH_KM3_S2;
const RAD=Math.PI/180, TWO_PI=2*Math.PI, J2=1.08262668e-3;
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export function gmstRadians(iso) {
  const jd=Date.parse(iso)/86400000+2440587.5;
  const t=(jd-2451545)/36525;
  return ((280.46061837+360.98564736629*(jd-2451545)+.000387933*t*t-t*t*t/38710000)%360)*RAD;
}
export function orbitalElements({id,epochOffset=0,meanMotion,e=0,inclination,raan,argPerigee=0,meanAnomaly=0}) {
  const n=meanMotion*TWO_PI/86400, a=Math.cbrt(MU/(n*n)), inc=inclination*RAD;
  const p=a*(1-e*e),factor=J2*n*(R/p)**2;
  return {id,epochOffset,n,a,e,inc,cosI:Math.cos(inc),sinI:Math.sin(inc),
    raan:raan*RAD,argPerigee:argPerigee*RAD,meanAnomaly:meanAnomaly*RAD,
    raanRate:-1.5*factor*Math.cos(inc),argRate:.75*factor*(5*Math.cos(inc)**2-1)};
}
export function orbitalPosition(el,time,spin=0,out=null,offset=0) {
  const dt=time-el.epochOffset;
  const m=el.meanAnomaly+el.n*dt;
  // These catalog orbits have eccentricity < 0.004. This second-order
  // expansion avoids iterative Kepler solves for every rendered marker.
  const sinM=Math.sin(m),cosM=Math.cos(m),sin2M=2*sinM*cosM;
  const nu=m+2*el.e*sinM+1.25*el.e*el.e*sin2M;
  const radius=el.a*(1-el.e*cosM+el.e*el.e*sinM*sinM)/R;
  const u=el.argPerigee+el.argRate*dt+nu;
  const node=el.raan+el.raanRate*dt-spin;
  const cu=Math.cos(u),su=Math.sin(u),co=Math.cos(node),so=Math.sin(node);
  const x=radius*(co*cu-so*su*el.cosI);
  const y=radius*su*el.sinI;
  const z=-radius*(so*cu+co*su*el.cosI);
  if(out){out[offset]=x;out[offset+1]=y;out[offset+2]=z;return out;}
  return [x,y,z];
}
function orbitGeometry(elements) {
  const values=[];
  for(const el of elements) {
    const radius=el.a/R,co=Math.cos(el.raan),so=Math.sin(el.raan);
    for(let j=0;j<144;j++) {
      for(const angle of [j*TWO_PI/144,(j+1)*TWO_PI/144]) {
        const x=radius*(co*Math.cos(angle)-so*Math.sin(angle)*el.cosI);
        const y=radius*Math.sin(angle)*el.sinI;
        const z=-radius*(so*Math.cos(angle)+co*Math.sin(angle)*el.cosI);
        values.push(x,y,z);
      }
    }
  }
  return new THREE.BufferGeometry().setAttribute("position",new THREE.Float32BufferAttribute(values,3));
}
const palette=[[238,238,238],[255,253,241],[255,244,184],[255,224,102],[234,170,0],[184,121,0]];
function colorFor(count,max) {
  if(!count)return palette[0];
  const x=clamp(count/max,0,1)*4,segment=Math.min(3,Math.floor(x)),f=x-segment;
  return [0,1,2].map(i=>Math.round(palette[segment+1][i]*(1-f)+palette[segment+2][i]*f));
}
function computeCoverage(positions,count,columns=180,rows=90,elevationDeg=10) {
  const values=new Uint16Array(columns*rows);
  const sinLat=new Float64Array(rows),cosLat=new Float64Array(rows);
  for(let y=0;y<rows;y++) {
    const lat=(90-(y+.5)*180/rows)*RAD;
    sinLat[y]=Math.sin(lat);cosLat[y]=Math.cos(lat);
  }
  const elevation=elevationDeg*RAD;
  for(let i=0;i<count;i++) {
    const x=positions[i*3],y=positions[i*3+1],z=positions[i*3+2];
    const radius=Math.hypot(x,y,z);
    if(radius<=1)continue;
    const lat=Math.asin(y/radius),lon=Math.atan2(-z,x);
    const psi=Math.acos(clamp(Math.cos(elevation)/radius,-1,1))-elevation;
    const minY=clamp(Math.floor((90-(lat+psi)/RAD)*rows/180),0,rows-1);
    const maxY=clamp(Math.ceil((90-(lat-psi)/RAD)*rows/180),0,rows-1);
    const sinSub=Math.sin(lat),cosSub=Math.cos(lat),threshold=Math.cos(psi);
    for(let row=minY;row<=maxY;row++) {
      const denom=cosLat[row]*cosSub;
      const value=denom<1e-10 ? (sinLat[row]*sinSub>=threshold?-1:1) :
        (threshold-sinLat[row]*sinSub)/denom;
      if(value>1)continue;
      const extent=value<=-1?Math.PI:Math.acos(value);
      if(extent>=Math.PI-1e-10) {
        for(let col=0;col<columns;col++)values[row*columns+col]++;
        continue;
      }
      const center=(lon+Math.PI)*columns/TWO_PI-.5;
      const half=extent*columns/TWO_PI;
      for(let col=Math.ceil(center-half);col<=Math.floor(center+half);col++)
        values[row*columns+((col%columns)+columns)%columns]++;
    }
  }
  return values;
}
function mollweidePoint(lon,lat) {
  const phi=lat*RAD,lambda=lon*RAD;
  let theta=phi;
  for(let i=0;i<7;i++) {
    const denominator=2+2*Math.cos(2*theta);
    if(Math.abs(denominator)<1e-9)break;
    theta-=(2*theta+Math.sin(2*theta)-Math.PI*Math.sin(phi))/denominator;
  }
  return [(1+lambda/Math.PI*Math.cos(theta))/2,(1-Math.sin(theta))/2];
}
function mollweideLookup(columns=720,rows=360) {
  const lookup=new Uint16Array(columns*rows);lookup.fill(65535);
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++) {
    const yy=1-2*(y+.5)/rows,theta=Math.asin(clamp(yy,-1,1));
    const cosine=Math.cos(theta);
    if(cosine<1e-9)continue;
    const longitude=(2*(x+.5)/columns-1)*Math.PI/cosine;
    if(Math.abs(longitude)>Math.PI)continue;
    const latitude=Math.asin(clamp((2*theta+Math.sin(2*theta))/Math.PI,-1,1));
    const col=clamp(Math.floor((longitude+Math.PI)/TWO_PI*180),0,179);
    const row=clamp(Math.floor((Math.PI/2-latitude)/Math.PI*90),0,89);
    lookup[y*columns+x]=row*180+col;
  }
  return lookup;
}
function coastlines(ctx,features,left,top,width,height) {
  ctx.beginPath();
  const ring=coordinates=>{
    let prior=null;
    for(const [lon,lat] of coordinates){
      const projected=mollweidePoint(lon,lat);
      const x=left+projected[0]*width,y=top+projected[1]*height;
      if(prior===null||Math.abs(x-prior)>width/2)ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
      prior=x;
    }
  };
  for(const feature of features) {
    const shape=feature.geometry;
    if(shape?.type==="Polygon")shape.coordinates.forEach(ring);
    else if(shape?.type==="MultiPolygon")shape.coordinates.forEach(poly=>poly.forEach(ring));
  }
  ctx.strokeStyle="rgba(67,67,67,.42)";ctx.lineWidth=.8;ctx.stroke();
}
export async function createConstellationExhibit(host,config,{onStateChange=()=>{}}={}) {
  const response=await fetch(new URL("../assets/countries.geo.json",import.meta.url));
  if(!response.ok)throw new Error("Globe coastlines could not load");
  const geojson=await response.json();
  const scene=new THREE.Scene();scene.background=new THREE.Color(0xffffff);
  const earth=makeEarth(geojson);scene.add(earth);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,100);
  const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
  host.append(renderer.domElement);
  const overlay=document.createElement("canvas");overlay.className="constellation-coverage";
  host.append(overlay);const ctx=overlay.getContext("2d");
  const mapLookup=mollweideLookup();
  const mapScene=new THREE.Scene();mapScene.background=new THREE.Color(0xffffff);
  const mapCamera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10);
  mapCamera.position.z=2;
  let mapTextureA=new THREE.DataTexture(new Uint8Array(720*360*4),720,360,THREE.RGBAFormat);
  let mapTextureB=new THREE.DataTexture(new Uint8Array(720*360*4),720,360,THREE.RGBAFormat);
  for(const texture of [mapTextureA,mapTextureB]){
    texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearFilter;
    texture.generateMipmaps=false;
  }
  const mapMaterial=new THREE.ShaderMaterial({
    uniforms:{frameA:{value:mapTextureA},frameB:{value:mapTextureB},blend:{value:0}},
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform sampler2D frameA;uniform sampler2D frameB;
      uniform float blend;varying vec2 vUv;void main(){
      vec2 uv=vec2(vUv.x,1.0-vUv.y);
      gl_FragColor=mix(texture2D(frameA,uv),texture2D(frameB,uv),blend);}`
  });
  const mapQuad=new THREE.Mesh(new THREE.PlaneGeometry(1,1),mapMaterial);
  mapScene.add(mapQuad);
  const pointGeometry=new THREE.BufferGeometry();
  const positionValues=new Float32Array(config.elements.length*3);
  const coveragePositions=new Float32Array(config.elements.length*3);
  pointGeometry.setAttribute("position",new THREE.BufferAttribute(positionValues,3));
  let colorValues=null;
  if(config.kind==="gps") {
    colorValues=new Float32Array(config.elements.length*3);
    colorValues.fill(.68);
    pointGeometry.setAttribute("color",new THREE.BufferAttribute(colorValues,3));
  }
  let markerMaterial;
  if(config.gpuPropagation) {
    const orbitA=new Float32Array(config.elements.length*4);
    const orbitB=new Float32Array(config.elements.length*4);
    const orbitC=new Float32Array(config.elements.length*3);
    const shellRanks=new Float32Array(config.elements.length);
    config.elements.forEach((el,i)=>{
      orbitA.set([el.a/R,el.e,el.cosI,el.sinI],i*4);
      orbitB.set([el.raan,el.argPerigee,el.meanAnomaly,el.n],i*4);
      orbitC.set([el.raanRate,el.argRate,el.epochOffset],i*3);
      shellRanks[i]=config.shellRanks?.[i]??0;
    });
    pointGeometry.setAttribute("orbitA",new THREE.BufferAttribute(orbitA,4));
    pointGeometry.setAttribute("orbitB",new THREE.BufferAttribute(orbitB,4));
    pointGeometry.setAttribute("orbitC",new THREE.BufferAttribute(orbitC,3));
    pointGeometry.setAttribute("shellRank",new THREE.BufferAttribute(shellRanks,1));
    markerMaterial=new THREE.ShaderMaterial({
      uniforms:{simulationSeconds:{value:0},earthSpin:{value:0},
        pointSize:{value:config.markerSize},pixelRatio:{value:1},
        opacity:{value:config.markerOpacity??.9},maxShellRank:{value:4}},
      transparent:true,depthTest:true,depthWrite:false,
      vertexShader:`
        attribute vec4 orbitA; attribute vec4 orbitB; attribute vec3 orbitC;
        attribute float shellRank; varying float vShellRank;
        uniform float simulationSeconds; uniform float earthSpin;
        uniform float pointSize; uniform float pixelRatio;
        void main(){
          vShellRank=shellRank;
          float dt=simulationSeconds-orbitC.z;
          float m=orbitB.z+orbitB.w*dt;
          float sm=sin(m),cm=cos(m);
          float nu=m+2.0*orbitA.y*sm+1.25*orbitA.y*orbitA.y*2.0*sm*cm;
          float r=orbitA.x*(1.0-orbitA.y*cm+orbitA.y*orbitA.y*sm*sm);
          float u=orbitB.y+orbitC.y*dt+nu;
          float node=orbitB.x+orbitC.x*dt-earthSpin;
          float cu=cos(u),su=sin(u),co=cos(node),so=sin(node);
          vec3 p=vec3(r*(co*cu-so*su*orbitA.z),r*su*orbitA.w,
            -r*(so*cu+co*su*orbitA.z));
          gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
          gl_PointSize=pointSize*pixelRatio;
        }`,
      fragmentShader:`
        uniform float opacity; uniform float maxShellRank;
        varying float vShellRank;
        void main(){
          if(vShellRank>maxShellRank)discard;
          float radius=length(gl_PointCoord-vec2(.5));
          float alpha=(1.0-smoothstep(.40,.49,radius))*opacity;
          if(alpha<.02)discard;
          vec3 color=radius>.34?vec3(.24):vec3(.53);
          gl_FragColor=vec4(color,alpha);
        }`
    });
  } else markerMaterial=new THREE.PointsMaterial({
    map:circleTexture("#fff","#222",8),color:config.markerColor,
    size:config.markerSize,sizeAttenuation:false,transparent:true,
    opacity:config.markerOpacity??.9,depthTest:true,depthWrite:false,
    vertexColors:config.kind==="gps",alphaTest:.04
  });
  const satellites=new THREE.Points(pointGeometry,markerMaterial);
  satellites.frustumCulled=false;satellites.renderOrder=8;scene.add(satellites);
  const orbitGroup=new THREE.Group();
  const orbitLines=new THREE.LineSegments(orbitGeometry(config.orbitElements),
    new THREE.LineBasicMaterial({color:0x8b8b8b,transparent:true,opacity:config.orbitOpacity,
      depthTest:true,depthWrite:false}));
  orbitGroup.add(orbitLines);scene.add(orbitGroup);
  const receiverLat=46.2044,receiverLon=6.1432;
  const receiverNormal=new THREE.Vector3(
    Math.cos(receiverLat*RAD)*Math.cos(receiverLon*RAD),Math.sin(receiverLat*RAD),
    -Math.cos(receiverLat*RAD)*Math.sin(receiverLon*RAD));
  host.dataset.receiverLatDeg=String(receiverLat);
  host.dataset.receiverLonDeg=String(receiverLon);
  const receiver=new THREE.Points(new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute([0,0,0],3)),new THREE.PointsMaterial({
    map:circleTexture("#b88b13"),size:17,sizeAttenuation:false,
    transparent:true,depthTest:false,alphaTest:.04}));
  receiver.frustumCulled=false;receiver.renderOrder=10;scene.add(receiver);
  const losGeometry=new THREE.BufferGeometry().setAttribute("position",
    new THREE.BufferAttribute(new Float32Array(24*2*3),3));
  const sightLines=new THREE.LineSegments(losGeometry,new THREE.LineBasicMaterial({
    color:0xb88b13,transparent:true,opacity:.38,depthTest:false}));
  sightLines.frustumCulled=false;scene.add(sightLines);
  const note=document.createElement("div");note.className="constellation-note";
  const noteTitle=document.createElement("strong"),noteDetail=document.createElement("span");
  noteTitle.textContent=config.noteTitle||"";
  noteDetail.textContent=config.noteDetail||"";
  note.append(noteTitle,noteDetail);host.append(note);
  const spinAt=time=>config.gmst+EARTH_ROTATION_RATE_RAD_PER_SEC*time;
  const stateCount=config.stateCount??6;
  const receiverStage=config.receiverStage??4;
  let stateIndex=0,clock=0,elapsed=0,paused=true,destroyed=false,raf=0,last=0;
  let currentHalf=config.introHalfHeight??config.halfHeight*.9;
  let halfFrom=currentHalf,halfTo=currentHalf,zoomElapsed=2;
  let width=1,height=1,ratio=1,coverageValues=null;
  let coverageNext=null,coverageStart=0,coverageEnd=0,coverageColors=[];
  let displayMax=1;
  let positionsTime=NaN;
  const isMap=()=>config.mapStates.includes(stateIndex);
  function updatePositions(forceCpu=false) {
    const spin=spinAt(clock);
    earth.rotation.y=spin;
    orbitGroup.rotation.y=0;
    host.dataset.referenceFrame="ECI";
    host.dataset.earthRotationRad=spin.toFixed(6);
    host.dataset.orbitPlaneRotationRad=orbitGroup.rotation.y.toFixed(6);
    if(config.gpuPropagation) {
      markerMaterial.uniforms.simulationSeconds.value=clock;
      markerMaterial.uniforms.earthSpin.value=0;
      if(!forceCpu)return;
    }
    if(positionsTime===clock)return;
    positionsTime=clock;
    for(let i=0;i<config.elements.length;i++)
      orbitalPosition(config.elements[i],clock,0,positionValues,i*3);
    if(!config.gpuPropagation)pointGeometry.attributes.position.needsUpdate=true;
    host.dataset.simulationSeconds=clock.toFixed(2);
  }
  function sampleCoverage(sampleClock) {
    const spin=spinAt(sampleClock);
    for(let i=0;i<config.elements.length;i++)
      orbitalPosition(config.elements[i],sampleClock,spin,coveragePositions,i*3);
    return computeCoverage(coveragePositions,config.elements.length);
  }
  function refreshCoveragePair() {
    const begin=performance.now();
    const step=config.playbackRate*config.coverageIntervalMs/1000;
    if(!coverageValues){
      coverageStart=clock;coverageEnd=clock+step;
      coverageValues=sampleCoverage(coverageStart);
      coverageNext=sampleCoverage(coverageEnd);
      displayMax=Math.max(1,...coverageValues,...coverageNext);
      coverageColors=Array.from({length:displayMax+1},(_,count)=>colorFor(count,displayMax));
      paintCoverage(coverageValues,mapTextureA);
      paintCoverage(coverageNext,mapTextureB);
      drawMap();
    } else while(clock>=coverageEnd){
      [mapTextureA,mapTextureB]=[mapTextureB,mapTextureA];
      mapMaterial.uniforms.frameA.value=mapTextureA;
      mapMaterial.uniforms.frameB.value=mapTextureB;
      coverageValues=coverageNext;
      coverageStart=coverageEnd;coverageEnd+=step;
      coverageNext=sampleCoverage(coverageEnd);
      const max=Math.max(...coverageNext);
      if(max>displayMax){
        displayMax=max;
        coverageColors=Array.from({length:displayMax+1},(_,count)=>colorFor(count,displayMax));
        paintCoverage(coverageValues,mapTextureA);drawMap();
      }
      paintCoverage(coverageNext,mapTextureB);
    }
    const maxCell=coverageValues.indexOf(Math.max(...coverageValues));
    host.dataset.coverageMin=String(Math.min(...coverageValues,...coverageNext));
    host.dataset.coverageMax=String(displayMax);
    host.dataset.coverageMaxCellLatLon=`${90-(Math.floor(maxCell/180)+.5)*2},${-180+(maxCell%180+.5)*2}`;
    host.dataset.coverageClockSeconds=coverageStart.toFixed(3);
    host.dataset.coverageNextClockSeconds=coverageEnd.toFixed(3);
    host.dataset.coverageSampleStepSeconds=step.toFixed(3);
    host.dataset.coverageElevationDeg="10";
    host.dataset.coverageProjection="Mollweide";
    host.dataset.coverageInterpolated="true";
    host.dataset.coverageComputeMs=(performance.now()-begin).toFixed(1);
  }
  function paintCoverage(values,texture) {
    const pixels=texture.image.data;
    for(let i=0;i<mapLookup.length;i++) {
      const cell=mapLookup[i];
      const offset=i*4;
      if(cell===65535){
        pixels[offset]=pixels[offset+1]=pixels[offset+2]=255;
      } else {
        const color=coverageColors[values[cell]];
        pixels[offset]=color[0];
        pixels[offset+1]=color[1];
        pixels[offset+2]=color[2];
      }
      pixels[offset+3]=255;
    }
    texture.needsUpdate=true;
  }
  function drawMap() {
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    const mapWidth=Math.min(width*.9,height*1.72),mapHeight=mapWidth/2;
    const left=(width-mapWidth)/2,top=(height-mapHeight)/2+12;
    coastlines(ctx,geojson.features,left,top,mapWidth,mapHeight);
    ctx.strokeStyle="#bdbdbd";ctx.lineWidth=1;ctx.beginPath();
    ctx.ellipse(left+mapWidth/2,top+mapHeight/2,mapWidth/2,mapHeight/2,0,0,TWO_PI);
    ctx.stroke();
    const legendX=left+8,legendY=top+mapHeight+10,legendWidth=Math.min(250,mapWidth*.38);
    ctx.fillStyle="#eee";ctx.fillRect(legendX,legendY,78,10);
    ctx.strokeStyle="#4a4a4a";ctx.lineWidth=1.5;ctx.strokeRect(legendX,legendY,78,10);
    const gradient=ctx.createLinearGradient(legendX+90,0,legendX+legendWidth,0);
    for(const [stop,color] of [[0,"#fffdf1"],[.18,"#fff4b8"],[.4,"#ffe066"],
      [.66,"#eaaa00"],[1,"#b87900"]])gradient.addColorStop(stop,color);
    ctx.fillStyle=gradient;ctx.fillRect(legendX+90,legendY,legendWidth-90,10);
    ctx.strokeStyle="#ddd";ctx.lineWidth=1;ctx.strokeRect(legendX+90,legendY,legendWidth-90,10);
    ctx.fillStyle="#666";ctx.font="10.5px Roboto,Arial,sans-serif";
    ctx.fillText("No coverage",legendX,legendY+23);
    ctx.fillText("1",legendX+90,legendY+23);
    ctx.fillText("satellites within range",legendX+113,legendY+23);
    ctx.textAlign="right";ctx.fillText(String(displayMax),
      legendX+legendWidth,legendY+23);ctx.textAlign="left";
  }
  function updateReceiver() {
    const active=config.kind==="gps"&&stateIndex===receiverStage;
    receiver.visible=active;sightLines.visible=active;
    if(!config.kind||config.kind!=="gps")return;
    const position=receiverNormal.clone().applyAxisAngle(new THREE.Vector3(0,1,0),spinAt(clock));
    const surface=position.clone().multiplyScalar(1.004);
    receiver.geometry.attributes.position.setXYZ(0,surface.x,surface.y,surface.z);
    receiver.geometry.attributes.position.needsUpdate=true;
    const lines=losGeometry.attributes.position;
    let visible=0;
    for(let i=0;i<config.elements.length;i++) {
      const sat=new THREE.Vector3(positionValues[i*3],positionValues[i*3+1],
        positionValues[i*3+2]);
      const sight=sat.clone().sub(position);
      const qualifies=sight.dot(position)/sight.length()>=Math.sin(10*RAD);
      colorValues.set(qualifies&&active?[.75,.57,.08]:[.68,.68,.68],i*3);
      if(qualifies&&active) {
        lines.setXYZ(visible*2,surface.x,surface.y,surface.z);
        lines.setXYZ(visible*2+1,sat.x,sat.y,sat.z);visible++;
      }
    }
    pointGeometry.attributes.color.needsUpdate=true;
    lines.needsUpdate=true;losGeometry.setDrawRange(0,visible*2);
    host.dataset.visibleFromReceiver=String(visible);
    host.dataset.receiverElevationDeg="10";
    noteDetail.textContent=active?`Geneva · ${visible} visible · 10° mask`:
      (config.noteDetail||"");
  }
  function render(now=performance.now()) {
    if(destroyed)return;
    host.dataset.stage=String(stateIndex+1);
    host.dataset.satelliteCount=String(config.elements.length);
    host.dataset.orbitPlaneCount=String(config.planeCount);
    host.dataset.simulationSeconds=clock.toFixed(2);
    overlay.style.display=isMap()?"block":"none";
    note.style.display=!isMap()&&config.noteStates?.includes(stateIndex)?"block":"none";
    if(isMap()) {
      if(!coverageValues||clock>=coverageEnd)refreshCoveragePair();
      mapMaterial.uniforms.blend.value=clamp((clock-coverageStart)/
        (coverageEnd-coverageStart),0,1);
      renderer.render(mapScene,mapCamera);
      return;
    }
    updatePositions();
    currentHalf=halfFrom+(halfTo-halfFrom)*Math.min(1,zoomElapsed/1.8);
    const half=currentHalf;
    camera.left=-half*width/height;camera.right=half*width/height;
    camera.top=half;camera.bottom=-half;
    camera.position.set(...config.cameraPosition);camera.lookAt(0,0,0);
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
    updateReceiver();
    orbitLines.visible=config.orbitVisible(stateIndex);
    if(orbitLines.visible) {
      const reveal=stateIndex===1?Math.min(1,elapsed/(config.kind==="starlink"?4.2:1.8)):1;
      const lineCount=config.kind==="starlink"&&stateIndex===1&&config.orbitGroupEnds?
        (config.orbitGroupEnds[Math.min(3,Math.floor(elapsed/1.05))]||0):
        Math.ceil(config.orbitElements.length*reveal);
      orbitLines.geometry.setDrawRange(0,Math.floor(lineCount*144*2));
      orbitLines.material.opacity=stateIndex===4&&config.kind==="starlink" ? .09 : config.orbitOpacity;
    }
    satellites.visible=stateIndex>=1;
    if(satellites.visible) {
      if(config.gpuPropagation) {
        satellites.geometry.setDrawRange(0,config.elements.length);
        markerMaterial.uniforms.maxShellRank.value=stateIndex===1?
          Math.min(3,Math.floor(elapsed/1.05)):4;
        host.dataset.visibleShells=stateIndex===1?
          String(Math.min(4,Math.floor(elapsed/1.05)+1)):"all";
      } else {
        const planesShown=stateIndex===1?
          Math.min(config.planeCount,Math.ceil(config.planeCount*elapsed/1.8)):
          config.planeCount;
        satellites.geometry.setDrawRange(0,planesShown*config.elements.length/config.planeCount);
      }
    }
    renderer.render(scene,camera);
  }
  function frame(now) {
    if(paused||destroyed)return;
    const delta=Math.min(.1,Math.max(0,(now-last)/1000));last=now;
    elapsed+=delta;
    clock+=delta*(stateIndex>=receiverStage?config.playbackRate:
      (config.introPlaybackRate??400));
    zoomElapsed=Math.min(1.8,zoomElapsed+delta);
    render(now);
    raf=requestAnimationFrame(frame);
  }
  function goToState(index) {
    if(destroyed||index<0||index>=stateCount||index===stateIndex)return false;
    stateIndex=index;elapsed=0;coverageValues=null;coverageNext=null;
    halfFrom=currentHalf;halfTo=index===0?
      (config.introHalfHeight??config.halfHeight*.9):config.halfHeight;
    zoomElapsed=0;
    onStateChange(index,stateCount);render();return true;
  }
  function jumpToState(index) {
    if(index<0||index>=stateCount)return;
    stateIndex=index;elapsed=3;coverageValues=null;coverageNext=null;
    halfFrom=halfTo=index===0?
      (config.introHalfHeight??config.halfHeight*.9):config.halfHeight;
    currentHalf=halfTo;zoomElapsed=1.8;
    onStateChange(index,stateCount);render();
  }
  function resize() {
    if(destroyed)return;
    width=Math.max(1,host.clientWidth);height=Math.max(1,host.clientHeight);
    ratio=Math.min(devicePixelRatio||1,2);
    overlay.width=Math.round(width*ratio);overlay.height=Math.round(height*ratio);
    overlay.style.width=width+"px";overlay.style.height=height+"px";
    const mapWidth=Math.min(width*.9,height*1.72),mapHeight=mapWidth/2;
    mapCamera.left=-width/2;mapCamera.right=width/2;
    mapCamera.top=height/2;mapCamera.bottom=-height/2;mapCamera.updateProjectionMatrix();
    mapQuad.scale.set(mapWidth,mapHeight,1);mapQuad.position.y=-12;
    renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);
    if(config.gpuPropagation)markerMaterial.uniforms.pixelRatio.value=ratio;
    coverageValues=null;coverageNext=null;render();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  onStateChange(0,stateCount);resize();
  return {stateCount,getStateIndex:()=>stateIndex,next:()=>goToState(stateIndex+1),
    previous:()=>goToState(stateIndex-1),goToState,jumpToState,
    start(){if(destroyed||document.hidden)return;paused=false;last=performance.now();
      if(!raf)raf=requestAnimationFrame(frame);},
    pause(){paused=true;cancelAnimationFrame(raf);raf=0;},
    resize,destroy(){destroyed=true;paused=true;cancelAnimationFrame(raf);observer.disconnect();
      scene.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
      mapQuad.geometry.dispose();mapMaterial.dispose();mapTextureA.dispose();mapTextureB.dispose();
      renderer.dispose();host.replaceChildren();}
  };
}
