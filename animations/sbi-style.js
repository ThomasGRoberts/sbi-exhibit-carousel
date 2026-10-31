import * as THREE from "three";

// Values and colors follow sbi-constellation-viz/app.js.
export const EARTH_RADIUS_KM = 6378.137;
export const MU_EARTH_KM3_S2 = 398600.4418;
export const EARTH_ROTATION_RATE_RAD_PER_SEC = 7.2921150e-5;
export const SBI_GOLD = 0xb88b13;
export const SBI_DARK = 0x4a4a4a;
export const SBI_GOLD_CSS = "#b88b13";
export const MISSILE_BLACK_CSS = "#111111";
export const SITE_DOT_RADIUS_PX = 5.7;
export const MISSILE_DOT_RADIUS_PX = 4.3;
export function blackTrailGradient(context,from,to) {
  const gradient=context.createLinearGradient(from[0],from[1],
    to[0]+(from[0]===to[0] ? .01 : 0),
    to[1]+(from[1]===to[1] ? .01 : 0));
  gradient.addColorStop(0,"rgba(10,10,10,0)");
  gradient.addColorStop(.42,"rgba(10,10,10,.39)");
  gradient.addColorStop(1,"rgba(10,10,10,.96)");
  return gradient;
}
export const MODEL_REACH_KM = 836.451;
export const INTERCEPT_ALTITUDE_KM = 200;
export const ORBIT_ALTITUDE_KM = 400;

export function makeSiteMarkers(positions, phases, markerSize = 64) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("phase", new THREE.Float32BufferAttribute(phases, 1));
  const uniforms = {
    time: { value: 0 }, opacity: { value: 0 }, pixelRatio: { value: 1 },
    size: { value: markerSize }, pulseStrength: { value: 1 }, goldFraction: { value: 1 },
    goldRadius: { value: 5.7 }, darkRadius: { value: 2.0 },
    pulseMode: { value: 0 }, sweepSeconds: { value: 4.5 },
    revealByWave: { value: 0 }, revealTime: { value: 0 },
    revealDuration: { value: 2.0 }, ringScale: { value: 1 },
    goldRingWidth: { value: 1.8 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthTest: true, depthWrite: false,
    vertexShader: `
      attribute float phase;
      uniform float pixelRatio;
      uniform float size;
      varying float pointPhase;
      void main() {
        pointPhase = phase;
        gl_PointSize = size * pixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform float time;
      uniform float opacity;
      uniform float pulseStrength;
      uniform float goldFraction;
      uniform float size;
      uniform float goldRadius;
      uniform float darkRadius;
      uniform float pulseMode;
      uniform float sweepSeconds;
      uniform float revealByWave;
      uniform float revealTime;
      uniform float revealDuration;
      uniform float ringScale;
      uniform float goldRingWidth;
      varying float pointPhase;
      void main() {
        float radius = length(gl_PointCoord - vec2(.5)) * size;
        float coreRadius = mix(darkRadius, goldRadius, goldFraction);
        float core = 1.0 - smoothstep(coreRadius - 1.0, coreRadius + 1.0, radius);
        float localTime = time - pointPhase * sweepSeconds;
        float duration = pulseMode > 1.5 ? 2.6 : 1.15;
        float cycle = clamp(localTime / duration, 0.0, 1.0);
        float pulseWindow = step(0.0, localTime) * (1.0 - step(duration, localTime));
        float eased = 1.0 - pow(1.0 - cycle, 3.0);
        float ringRadius = pulseMode > 1.5 ? 6.2 + 12.0 * eased :
          (8.0 + 23.0 * eased) * ringScale;
        float halfWidth = pulseMode > 1.5 ? 1.0 : goldRingWidth;
        float ring = 1.0 - smoothstep(0.0, halfWidth, abs(radius - ringRadius));
        float pulse = ring * (pulseMode > 1.5 ? .5 : .74) *
          (pulseMode > 1.5 ? pow(1.0-cycle, 2.0) : 1.0-pow(cycle, 4.0)) *
          pulseStrength * pulseWindow * step(.5, pulseMode);
        float revealed = revealByWave > .5 ?
          smoothstep(-.2, .22, revealTime - pointPhase * revealDuration) : 1.0;
        float alpha = opacity * max(core * revealed, pulse);
        if (alpha < .015) discard;
        vec3 color = mix(vec3(.2902), vec3(.72157, .54510, .07451), goldFraction);
        vec3 ringColor = pulseMode > 1.5 ? vec3(.2902) : vec3(.72157, .54510, .07451);
        gl_FragColor = vec4(mix(color, ringColor, step(core * revealed, pulse)), alpha);
      }`
  });
  const markers = new THREE.Points(geometry, material);
  markers.frustumCulled = false;
  markers.renderOrder = 10;
  return { markers, uniforms };
}
