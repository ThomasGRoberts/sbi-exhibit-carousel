// One source of truth for exhibit order, presenter, and presenter-controlled moments.
export const presenters = [
  { id: "fernando", name: "Fernando Miranda España", photo: "assets/fernando.jpg" },
  { id: "nathan", name: "Nathan O'Brien", photo: "assets/nathan.png" }
];

export const exhibits = [
  {
    id: "basics", number: 1, title: "Basics of Space-Based Interception",
    presenterId: "fernando", status: "draft", module: "./animations/interception-basics.js",
    states: ["Launch Site on Earth", "Ballistic Perspective Transition",
      "Planned Ballistic Trajectory", "Terminal Defense Site",
      "Terminal Interception", "Orbiting Satellites",
      "Space-Based Interception", "Space Contact"]
  },
  {
    id: "geographic-input", number: 2, title: "Geography to SBI Constellation",
    presenterId: "fernando", status: "draft", module: "./animations/geographic-input.js",
    states: ["North Atlantic Region", "North Atlantic Sample Wave", "North Atlantic Constellation",
      "Larger Region", "Larger Region Sample Wave",
      "Larger Region Constellation"]
  },
  {
    id: "missile-salvo", number: 3, title: "Missile Salvo",
    presenterId: "fernando", status: "draft", module: "./animations/missile-salvo.js",
    states: ["North Korea Geography", "North Korea Launch Sites",
      "North Korea Salvo"]
  },
  {
    id: "threat-scenarios", number: 4, title: "Geographic Threat Scenarios",
    presenterId: "fernando", status: "draft", module: "./animations/threat-scenarios.js",
    states: ["Four Geographic Options", "North Korea Selected", "Iran Selected",
      "China Selected", "Russia Selected", "Iran Map Expansion",
      "Imam Khomeini Site", "Shahroud Site", "Iran Salvo"]
  },
  {
    id: "gps-constellation", number: 5, title: "GPS Constellation",
    presenterId: "nathan", status: "draft", module: "./animations/gps-constellation.js",
    states: ["Earth and MEO", "Populated GPS Planes"]
  },
  {
    id: "ground-track", number: 6, title: "Repeating Ground Track Orbits",
    presenterId: "nathan", status: "draft", module: "./animations/ground-track.js",
    states: ["ECI Orbit Introduction", "Synchronized Ground Track",
      "Three-to-One Repeat Orbit", "Repeating Pattern on One Earth",
      "Second Longitude Wrap", "Third Longitude Wrap", "Recurring Target Overflight"]
  },
  {
    id: "sbi-optimization", number: 7, title: "SBI Constellation Optimization",
    presenterId: "nathan", status: "draft", module: "./animations/sbi-optimization.js",
    states: ["Iran Scenario and Recorded RGT Constellation",
      "Symmetric Walker Baseline Reveal", "Architecture Comparison"]
  }
];
export function stateId(exhibit, index) {
  return String(exhibit.number).padStart(2, "0") + "." +
    String(index + 1).padStart(2, "0");
}
