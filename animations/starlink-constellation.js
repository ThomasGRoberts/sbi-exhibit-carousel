import { createConstellationExhibit, orbitalElements, gmstRadians } from "./constellation-common.js";
export async function createAnimation(host,options) {
  const response=await fetch(new URL("../assets/starlink-omm-2026-10-31.json",import.meta.url));
  if(!response.ok)throw new Error("Bundled Starlink catalog could not load");
  const data=await response.json();
  if(data.count!==data.rows.length||data.count!==data.referenceStateRows.length)
    throw new Error("Starlink catalog count differs from rows");
  const elements=data.referenceStateRows.map(row=>orbitalElements({id:row[0],
    meanMotion:row[1],e:row[2],inclination:row[3],raan:row[4],
    argPerigee:row[5],meanAnomaly:row[6]}));
  // Real orbital elements supply every marker. A small, deterministic set of
  // representative planes is enough to show shell density without a gray wall.
  const byInclination=new Map();
  for(const element of elements) {
    const inclination=Math.round(element.inc*180/Math.PI);
    if(!byInclination.has(inclination))byInclination.set(inclination,[]);
    byInclination.get(inclination).push(element);
  }
  const principalInclinations=[...byInclination.entries()]
    .sort((a,b)=>b[1].length-a[1].length).slice(0,4);
  const shellCenters=principalInclinations.map(([inclination])=>inclination);
  const shellRanks=elements.map(element=>{
    const inclination=element.inc*180/Math.PI;
    return shellCenters.reduce((best,center,index)=>
      Math.abs(inclination-center)<Math.abs(inclination-shellCenters[best])?index:best,0);
  });
  const orbitElements=[];
  const orbitGroupEnds=[];
  for(const [,group] of principalInclinations) {
    const seen=new Set();
    for(const element of group) {
      const node=Math.floor(((element.raan*180/Math.PI)%360+360)%360/15);
      if(seen.has(node))continue;
      seen.add(node);orbitElements.push(element);
      if(seen.size>=18)break;
    }
    orbitGroupEnds.push(orbitElements.length);
  }
  host.dataset.principalInclinations=principalInclinations
    .map(([inclination,group])=>inclination+":"+group.length).join(",");
  host.dataset.shellPopulation=shellCenters.map((center,index)=>
    center+":"+shellRanks.filter(rank=>rank===index).length).join(",");
  host.dataset.catalogSource=data.source;
  host.dataset.catalogRetrievedUtc=data.retrievedUtc;
  host.dataset.catalogCriteria=data.criteria;
  host.dataset.catalogCount=String(data.count);
  host.dataset.propagation=data.referenceStateMethod;
  return createConstellationExhibit(host,{
    kind:"starlink",elements,orbitElements,orbitGroupEnds,shellRanks,
    planeCount:orbitElements.length,
    gpuPropagation:true,
    gmst:gmstRadians(data.referenceUtc),halfHeight:1.75,introHalfHeight:1.12,
    cameraPosition:[3.5,2.2,4.3],markerColor:0x777777,
    markerSize:5.0,markerOpacity:.68,
    noteTitle:"Starlink",
    noteDetail:`${data.count.toLocaleString()} catalog objects · 31 Oct 2026`,
    noteStates:[1,2,3,4],
    orbitOpacity:.17,playbackRate:150,introPlaybackRate:200,
    mapStates:[5],coverageIntervalMs:250,
    orbitVisible:index=>index===1||index===2||index===3||index===4
  },options);
}
