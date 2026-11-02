const nathanPhoto=new URL("../assets/speakers/nathan.png",import.meta.url).href;
const fernandoPhoto=new URL("../assets/speakers/fernando.jpg",import.meta.url).href;

// The source slide has one click effect: all elements in this group appear together.
export function createUnderHoodDiagram(host) {
  const diagram=document.createElement("div");
  diagram.className="under-hood";
  diagram.dataset.beat="0";
  diagram.setAttribute("role","group");
  diagram.setAttribute("aria-label","SBI constellation optimization process");
  diagram.innerHTML=`
    <svg class="arrows" viewBox="0 0 1440 810" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <marker id="under-hood-arrowhead" viewBox="0 0 10 10" refX="9" refY="5"
          markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10Z" fill="#545859"/>
        </marker>
      </defs>
      <path d="M252 251 V408 H302" marker-end="url(#under-hood-arrowhead)"/>
      <path d="M1123 461 V522 H778 V583" marker-end="url(#under-hood-arrowhead)"/>
      <path class="reveal" d="M561 408 H648" marker-end="url(#under-hood-arrowhead)"/>
      <path class="reveal" d="M907 408 H994" marker-end="url(#under-hood-arrowhead)"/>
      <path class="reveal" d="M778 251 V356" marker-end="url(#under-hood-arrowhead)"/>
    </svg>
    <div class="node input input-policy">Interceptor<br>Capabilities</div>
    <img class="portrait portrait-policy" src="${nathanPhoto}" alt="Nathan O’Brien" decoding="async">
    <div class="node input input-technical reveal" aria-hidden="true">Threat<br>Characterization</div>
    <img class="portrait portrait-technical reveal" src="${fernandoPhoto}"
      alt="Fernando Miranda España" decoding="async" aria-hidden="true">
    <div class="node process kill-radius">Interceptor<br>Kill Radius</div>
    <div class="node process candidate-orbits reveal" aria-hidden="true">Candidate RGT<br>Orbits</div>
    <div class="node process integer-program">Binary Integer<br>Linear Program</div>
    <div class="node output">Output<br>Constellation</div>`;
  host.append(diagram);

  function setBeat(beat) {
    diagram.dataset.beat=beat?"1":"0";
    diagram.querySelectorAll(".reveal:not(path)").forEach(item=>
      item.setAttribute("aria-hidden",String(!beat)));
  }
  return {
    element:diagram,
    isRevealed:()=>diagram.dataset.beat==="1",
    reveal:()=>setBeat(1),
    reset:()=>setBeat(0),
    destroy:()=>diagram.remove()
  };
}
