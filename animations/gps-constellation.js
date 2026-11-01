import { createConstellationExhibit, orbitalElements, R, MU } from "./constellation-common.js";
const altitudeKm=20200, inclination=55, planes=6, slots=4;
const radius=R+altitudeKm;
const n=Math.sqrt(MU/radius**3),meanMotion=n*86400/(2*Math.PI);
// Idealized Walker Delta 24/6/1 phasing: 15° between neighboring planes.
// It illustrates the canonical baseline slots, not live GPS ephemerides.
const elements=[];
for(let plane=0;plane<planes;plane++)for(let slot=0;slot<slots;slot++) {
  const element=orbitalElements({id:plane*slots+slot,meanMotion,inclination,
    raan:plane*60,meanAnomaly:slot*90+plane*15});
  // The teaching scene is two-body ECI: planes are fixed, Earth rotates below.
  element.raanRate=0;element.argRate=0;
  elements.push(element);
}
export function createAnimation(host,options) {
  host.dataset.gpsAltitudeKm=String(altitudeKm);
  host.dataset.gpsInclinationDeg=String(inclination);
  host.dataset.gpsPeriodSeconds=String(2*Math.PI/n);
  host.dataset.gpsPhasing="Walker Delta 24/6/1 (idealized)";
  return createConstellationExhibit(host,{
    kind:"gps",elements,orbitElements:elements.filter((_,i)=>i%slots===0),
    planeCount:planes,gmst:-.45,halfHeight:4.85,introHalfHeight:1.45,
    cameraPosition:[8,5.6,9.5],
    markerColor:0xffffff,markerSize:18,orbitOpacity:.36,playbackRate:900,
    introPlaybackRate:300,
    stateCount:4,receiverStage:2,skyStage:3,mapStates:[],coverageIntervalMs:120,
    orbitVisible:index=>index>=1&&index<=2
  },options);
}
