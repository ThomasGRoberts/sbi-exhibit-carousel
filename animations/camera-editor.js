// Preview-only camera editor for the two geographic constellation views.
const RAD=Math.PI/180, DEG=180/Math.PI;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const copy=value=>JSON.parse(JSON.stringify(value));
function field(label,key,step="0.1") {
  const wrapper=document.createElement("label");
  wrapper.textContent=label;
  const input=document.createElement("input");
  input.type="number";input.step=step;input.dataset.key=key;
  wrapper.append(input);
  return wrapper;
}
export function createCameraEditor({host,camera,root,renderer,draw,jumpToState,regionNormals}) {
  const deck=host.closest(".deck"),toolbar=deck.querySelector(".preview-toolbar");
  const toggle=document.createElement("button");
  toggle.type="button";toggle.className="camera-editor-toggle";toggle.textContent="Camera editor";
  toggle.setAttribute("aria-label","Open development camera editor");
  toolbar.insertBefore(toggle,toolbar.lastElementChild);
  const panel=document.createElement("aside");
  panel.className="camera-editor";panel.hidden=true;
  panel.innerHTML='<div class="camera-editor-head"><strong>Development camera editor</strong><button type="button" data-action="close" aria-label="Close camera editor">×</button></div><p>Drag to orbit · Shift-drag to pan · scroll to zoom</p><label>Geography<select data-action="scenario"><option value="small">Small region</option><option value="large">Large region</option></select></label><div class="camera-editor-grid"></div><div class="camera-editor-actions"><button type="button" data-action="export">Export Camera Configuration</button><button type="button" data-action="copy">Copy JSON</button><button type="button" data-action="download">Download JSON</button><button type="button" data-action="import">Import / Apply JSON</button></div><textarea data-action="json" spellcheck="false" aria-label="Camera configuration JSON"></textarea><span class="camera-editor-feedback" role="status"></span>';
  deck.append(panel);
  const grid=panel.querySelector(".camera-editor-grid");
  const specs=[
    ["Azimuth °","azimuth","0.1"],["Elevation °","elevation","0.1"],
    ["Distance","distance","0.001"],["Roll °","roll","0.1"],
    ["Target X","targetX","0.001"],["Target Y","targetY","0.001"],
    ["Target Z","targetZ","0.001"],["Globe Y °","globeRotation","0.1"],
    ["Field of view °","fov","0.1"],["Zoom","zoom","0.001"]
  ];
  specs.forEach(args=>grid.append(field(...args)));
  const inputs=Object.fromEntries([...grid.querySelectorAll("input")].map(input=>[input.dataset.key,input]));
  const select=panel.querySelector('select[data-action="scenario"]');
  const textarea=panel.querySelector('textarea[data-action="json"]');
  const feedback=panel.querySelector(".camera-editor-feedback");
  const presets={small:null,large:null};
  let active=false,scenario="small",pose=null,pointer=null;
  function frameFor(key,globeDegrees) {
    const normal=new camera.position.constructor(...regionNormals[key])
      .applyAxisAngle(new camera.position.constructor(0,1,0),globeDegrees*RAD).normalize();
    const north=new camera.position.constructor(0,1,0)
      .addScaledVector(normal,-normal.y).normalize();
    const east=north.clone().cross(normal).normalize();
    return {normal,north,east};
  }
  function defaultPose(key) {
    if(key==="small")return {
      azimuth:10.75812499999999,elevation:29.130156249999985,
      distance:0.5852814239690409,roll:0,
      targetX:-1.9526047445594939e-16,
      targetY:0.5590864658669382,targetZ:0.835133117343826,
      globeRotation:-0.5336423425920703*DEG,fov:38,zoom:1.12
    };
    const rotation=-2.7771284089724046;
    const normal=frameFor(key,rotation*DEG).normal;
    return {azimuth:0,elevation:18,distance:1.05,roll:0,
      targetX:normal.x*1.005,targetY:normal.y*1.005,targetZ:normal.z*1.005,
      globeRotation:rotation*DEG,fov:38,zoom:.9};
  }
  function updateFields() {
    if(!pose)return;
    for(const [key,input] of Object.entries(inputs))input.value=Number(pose[key]).toFixed(
      ["distance","targetX","targetY","targetZ","zoom"].includes(key)?5:2);
    select.value=scenario;
  }
  function apply() {
    if(!active||!pose)return;
    pose.distance=Math.max(.05,pose.distance);
    pose.elevation=clamp(pose.elevation,-85,85);
    const az=pose.azimuth*RAD,el=pose.elevation*RAD;
    const target=new camera.position.constructor(pose.targetX,pose.targetY,pose.targetZ);
    const {normal,north,east}=frameFor(scenario,pose.globeRotation);
    const offset=north.clone().multiplyScalar(-Math.cos(el)*Math.cos(az))
      .addScaledVector(east,Math.cos(el)*Math.sin(az))
      .addScaledVector(normal,Math.sin(el)).multiplyScalar(pose.distance);
    camera.position.copy(target).add(offset);
    const look=target.clone().sub(camera.position).normalize();
    camera.up.copy(normal).addScaledVector(look,-normal.dot(look)).normalize()
      .applyAxisAngle(look,pose.roll*RAD);
    camera.fov=clamp(pose.fov,10,110);camera.zoom=clamp(pose.zoom,.1,20);
    camera.lookAt(target);camera.updateProjectionMatrix();camera.updateMatrixWorld();
    root.rotation.y=pose.globeRotation*RAD;
  }
  function redraw(){draw();}
  function setScenario(key) {
    if(active&&pose)presets[scenario]=copy(pose);
    active=false;scenario=key;
    jumpToState(key==="small"?3:6);
    pose=presets[key]?copy(presets[key]):defaultPose(key);
    active=true;apply();updateFields();redraw();
  }
  function open() {
    if(deck.classList.contains("is-presenting"))return;
    panel.hidden=false;toggle.setAttribute("aria-expanded","true");
    setScenario([4,5,6].includes(Number(host.dataset.stage)-1)?"large":"small");
  }
  function close(){
    if(!active&&panel.hidden)return;
    if(pose)presets[scenario]=copy(pose);
    active=false;panel.hidden=true;toggle.setAttribute("aria-expanded","false");
    redraw();
  }
  toggle.addEventListener("click",()=>active?close():open());
  panel.addEventListener("click",event=>{
    const action=event.target.dataset.action;
    if(action==="close"){close();return;}
    if(action==="export"||action==="copy"||action==="download") {
      const data=exportConfiguration();
      textarea.value=JSON.stringify(data,null,2);
      if(action==="copy") {
        navigator.clipboard?.writeText(textarea.value).then(
          ()=>feedback.textContent="Copied camera JSON.",
          ()=>{textarea.select();document.execCommand("copy");feedback.textContent="Copied camera JSON.";}
        );
      } else if(action==="download") {
        const url=URL.createObjectURL(new Blob([textarea.value],{type:"application/json"}));
        const a=document.createElement("a");a.href=url;
        a.download="exhibit-02-"+scenario+"-camera.json";a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
        feedback.textContent="Downloaded camera JSON.";
      } else feedback.textContent="Current camera values exported.";
    }
    if(action==="import") {
      try {
        const data=JSON.parse(textarea.value);
        if(data.exhibitId!=="geographic-input"||!["small","large"].includes(data.scenario))
          throw new Error("Expected an Exhibit 02 small or large configuration.");
        const target=data.camera?.target,position=data.camera?.position;
        if(!Array.isArray(target)||!Array.isArray(position)||target.length!==3||position.length!==3)
          throw new Error("Position and target must each have three values.");
        const controls=data.controls||{};
        const dx=position[0]-target[0],dy=position[1]-target[1],dz=position[2]-target[2];
        const distance=Math.hypot(dx,dy,dz);
        if(!distance||!Number.isFinite(distance))throw new Error("Invalid camera distance.");
        const globeRotation=(data.globe?.rotationYRadians??0)*DEG;
        const {normal,north,east}=frameFor(data.scenario,globeRotation);
        const offset=new camera.position.constructor(dx,dy,dz).divideScalar(distance);
        const southComponent=-offset.dot(north),eastComponent=offset.dot(east);
        const azimuth=Math.atan2(eastComponent,southComponent)*DEG;
        const elevation=Math.asin(clamp(offset.dot(normal),-1,1))*DEG;
        const look=offset.clone().negate();
        const baseUp=normal.clone().addScaledVector(look,-normal.dot(look)).normalize();
        const suppliedUp=new camera.position.constructor(...(data.camera.up||[0,1,0]))
          .addScaledVector(look,-new camera.position.constructor(...(data.camera.up||[0,1,0])).dot(look)).normalize();
        const roll=Math.atan2(look.dot(baseUp.clone().cross(suppliedUp)),
          baseUp.dot(suppliedUp))*DEG;
        const imported={
          azimuth:controls.coordinateFrame==="geographic-surface"?
            controls.azimuthDegrees:azimuth,
          elevation:controls.coordinateFrame==="geographic-surface"?
            controls.elevationDegrees:elevation,
          distance:controls.distance??distance,
          roll:controls.coordinateFrame==="geographic-surface"?
            controls.rollDegrees:roll,
          targetX:target[0],targetY:target[1],targetZ:target[2],
          globeRotation,
          fov:data.camera.fovDegrees??38,zoom:data.camera.zoom??1
        };
        if(Object.values(imported).some(value=>!Number.isFinite(value)))
          throw new Error("Camera values must be finite numbers.");
        active=false;
        presets[data.scenario]=copy(imported);
        setScenario(data.scenario);
        feedback.textContent="Camera configuration applied.";
      } catch(error){feedback.textContent=error.message;}
    }
  });
  select.addEventListener("change",()=>setScenario(select.value));
  grid.addEventListener("input",event=>{
    const key=event.target.dataset.key,value=Number(event.target.value);
    if(!active||!key||!Number.isFinite(value))return;
    pose[key]=value;apply();redraw();
  });
  const canvas=renderer.domElement;
  canvas.addEventListener("pointerdown",event=>{
    if(!active||event.button>2)return;
    pointer={x:event.clientX,y:event.clientY,button:event.button,pan:event.shiftKey||event.button===2,moved:false};
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove",event=>{
    if(!active||!pointer)return;
    const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    pointer.x=event.clientX;pointer.y=event.clientY;
    if(Math.abs(dx)+Math.abs(dy)>1)pointer.moved=true;
    if(pointer.pan) {
      const scale=pose.distance*.0015;
      const right=new camera.position.constructor().setFromMatrixColumn(camera.matrixWorld,0);
      const up=new camera.position.constructor().setFromMatrixColumn(camera.matrixWorld,1);
      const shift=right.multiplyScalar(-dx*scale).addScaledVector(up,dy*scale);
      pose.targetX+=shift.x;pose.targetY+=shift.y;pose.targetZ+=shift.z;
    } else {
      pose.azimuth-=dx*.28;pose.elevation=clamp(pose.elevation+dy*.28,-85,85);
    }
    apply();updateFields();redraw();event.preventDefault();
  });
  canvas.addEventListener("pointerup",event=>{
    if(pointer?.moved) {
      const suppress=clickEvent=>{clickEvent.stopPropagation();canvas.removeEventListener("click",suppress,true);};
      canvas.addEventListener("click",suppress,true);
    }
    pointer=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("contextmenu",event=>{if(active)event.preventDefault();});
  canvas.addEventListener("wheel",event=>{
    if(!active)return;
    pose.distance*=Math.exp(event.deltaY*.001);pose.distance=clamp(pose.distance,.1,100);
    apply();updateFields();redraw();event.preventDefault();
  },{passive:false});
  function exportConfiguration() {
    apply();
    return {
      exhibitId:"geographic-input",scenario,
      projection:"perspective",
      camera:{
        position:camera.position.toArray(),target:[pose.targetX,pose.targetY,pose.targetZ],
        up:camera.up.toArray(),quaternion:camera.quaternion.toArray(),
        fovDegrees:camera.fov,zoom:camera.zoom,aspect:camera.aspect,
        near:camera.near,far:camera.far
      },
      globe:{rotationYRadians:root.rotation.y},
      controls:{
        coordinateFrame:"geographic-surface",
        azimuthDegrees:pose.azimuth,elevationDegrees:pose.elevation,
        distance:pose.distance,rollDegrees:pose.roll
      },
      simulationSeconds:Number(host.dataset.simulationSeconds||0)
    };
  }
  const fullscreen=()=>{if(document.fullscreenElement||deck.classList.contains("is-presenting"))close();};
  document.addEventListener("fullscreenchange",fullscreen);
  return {
    get active(){return active;},
    apply,close,
    destroy(){document.removeEventListener("fullscreenchange",fullscreen);panel.remove();toggle.remove();}
  };
}

