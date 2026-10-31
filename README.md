# Geneva Briefings Carousel Animations

Eight presenter-controlled ESPL exhibits: four for Fernando and four for Nathan O'Brien. The agenda names both presenters beside their photos. The sibling research projects were used as read-only design, model, and data references.

## Preview and controls

From this directory run `python3 -m http.server 8878`, then open [the local preview](http://localhost:8878/) in Chrome or the VS Code browser. The directory is a compact, non-scrolling agenda slide with the principal SBI visualization's approved gray ESPL logo at 320 px and 23% opacity. Rows shrink as exhibits are added. The logo also sits inside each 16:9 presentation pane.

Space, Right Arrow, or a click inside a pane advances immediately, even during animation. Left Arrow goes back. Back returns to the directory. Full Screen hides development controls. In the development header, click the exhibit title to choose any exhibit. The fixed-position **Pane ID 02.04** control copies only `02.04` on click for column C of the [Comment Log](https://docs.google.com/spreadsheets/d/1X7T9abmO9xWdtuP31w-Ovz2D5K5y-PY4jn4uxDlkjQ4/edit?gid=0#gid=0). The log uses the ESPL external-link icon and hover motion. Direct links work, for example `http://localhost:8878/#/exhibit/geographic-input/02.04`.

Pane IDs and internal names live in `manifest.js`. Shared palette and launch-site gold come from `animations/sbi-style.js`. All exhibits remain drafts. This is a static site with no build step; GitHub Pages can serve the repository root when the owner enables it.

## Exhibits 01–04 — Fernando

**01 · Basics of Space-Based Interception.** The opening view frames the Northern Hemisphere. Both launch marks and their pulses are surface meshes that foreshorten naturally, with the source gold proportions. The thin, dotted black planned trajectory starts exactly at the marker. The camera visits the terminal-defense site before widening to the whole concept. The planned dotted path disappears when flight begins. The missile starts at the launch site and follows its solid fading trail; missile and interceptor dots meet at one contact point. The small collision glow has no extra gold ring. The missile rises before a separate interceptor departs the still-orbiting satellite. Satellite sizes and depth handling preserve Earth occlusion; the final trails and contact dots fade together. This is a conceptual engagement illustration, not an optimized intercept: the ballistic and terminal segments omit staging, drag, Earth rotation, and variable gravity.

**02 · Geography to SBI Constellation.** In both geography transitions, the boundary redraw begins while sampling dots remain, then the dots fade and the gray fill appears before zoom-out. The 02.04 camera and geographic motion are coordinated, and the one-shot launch-site pulse sweep is faster.

**03 · Missile Salvo.** Iran retains its gray country introduction, gold launch sites, and salvo paths. North Korean gold dots and pulses now scale with the camera: legible up close and separated in the global view. Geographic sites and their count are unchanged.

**04 · Geographic Threat Scenarios.** The North Korea, Iran, China, Russia cards still lead into the Iran globe and two sites. The Iran tile expansion and globe camera motion now overlap as one continuous transition. The canvas retains a stable buffer, avoiding the earlier 04.06 strobe.

## Exhibit 05 — GPS Constellation

This is an idealized 24-slot reference: six fixed ECI planes, four satellites each, 55° inclination, 20,200 km circular altitude, and illustrative Walker Delta `24/6/1` phasing. It is not operational ephemeris. J2 is omitted here; Earth rotates beneath the inertial planes. Sources: [GPS.gov space segment](https://www.gps.gov/space-segment) and [U.S. Coast Guard Navigation Center](https://navcen.uscg.gov/global-positioning-system-overview).

The six-pane GPS sequence is now four panes. Each plane appears with its four satellites in 05.02, and their propagation continues without a separate hold pane. Orbital paths remain visible through the receiver demonstration. Pane 05.03 uses Geneva at approximately **46.2044° N, 6.1432° E**. Yellow satellites have calculated line of sight above a 10° elevation mask; no fixed number is chosen. The lower-left note identifies the constellation and, in receiver view, the computed visible count.

Pane 05.04 shows instantaneous visible-satellite counts on a 180×90 grid, using the principal SBI Mollweide projection and white-to-gold palette. Exact coverage frames are sampled every **120 ms of presentation time** and blended on the GPU. The source-style legend grows from actual computed maxima; counts are not clamped to 12.

## Exhibit 06 — Starlink Constellation

`assets/starlink-omm-2026-10-31.json` contains **11,157 unique Starlink-group catalog IDs** from [CelesTrak Current GP OMM JSON](https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=JSON), retrieved **2026-10-31 14:10:38 UTC**. These are catalog objects, not independently verified active service satellites. The lower-left note gives the exact October source count.

Pane 06.02 introduces inclination families with their satellites: approximately 53° (5,077), 43° (3,608), 97°–98° (1,521), and 70° (951). Each object's own elements remain intact. Offline SGP4 established a common state at 2026-10-31 12:00 UTC. Browser propagation uses two-body motion with secular J2 node/perigee rates and a small-eccentricity Kepler expansion. A 1,015-object comparison against SGP4 over one hour had a 31.7 km median and 60.1 km 95th-percentile position difference.

The coverage map counts **distinct catalog objects geometrically above a 10° elevation mask** at each grid cell and instant. It does not represent service, throughput, or capacity. Every ID appears once; each frame is computed afresh, with Earth obstruction and correct orbital radius units. An independent satellite-to-ground vector calculation at **2,642.415 s** counted **281** at the displayed peak cell (43° S, 107° E), matching the browser map's **281**. It counted **212 Geneva, 191 Tehran, 118 equator, and 70 high Arctic** at that instant. At time 0, those four and the South Indian Ocean cell yielded **197/156/112/76/249**; at 3,600 s, **203/193/114/67/263**. Thus a value approaching 300 is plausible for the entire catalog snapshot, though it does not mean 300 usable links.

Pane 06.06 uses the same SBI Mollweide styling as GPS. Exact coverage frames are sampled every **250 ms of presentation time** and GPU blended. The legend maximum comes from computed frames; interpolation smooths display without changing the underlying counts.

## Exhibit 07 — Repeating Ground Track Orbits

Pane 07.01 starts with only a compact 3D Earth and ECI satellite. Pane 07.02 shifts the globe left and adds a synchronized 2D map. A consistent orbital phase starts the trace near 180° W. The map uses simplified land and coastlines without borders, a lighter ground track, a gray moving subpoint matching the depth-tested 3D satellite, and a gold target by 07.04. The entire repeating orbit fits in the 07.03 panel, and simulated time never rewinds during 07.03–07.04. The target repeats at 0°, 360°, and 720° as the longitude axis extends from −180°…+180° to −180°…+540° and finally −180°…+900°.

The circular 50° example at **13,892.283 km altitude** has period **28,721.367 s**: three revolutions per sidereal Earth rotation under an unperturbed two-body model. ECI propagation and Earth rotation produce every ground-track point; J2, drag, and stationkeeping are omitted. The expanded-longitude idea was motivated by Figure 2.1 of [Hang Woon Lee's Georgia Tech dissertation](https://repository.gatech.edu/server/api/core/bitstreams/c7f7a9b9-2310-4037-904b-7af632f18086/content), without copying its nine-satellite arrangement.

## Exhibit 08 — SBI Constellation Optimization

The recorded Iran run is **`PREp-s002-d45-v4-g10-b170-k0-i1-261011a-a891`**, source commit **`059f92436212d472a30234e0a276e9c0bc2d23e2`**. Source files in sibling `sbi-constellation-viz/data/principal_runs/runs/` are the run's `_config.json`, `_result.json`, selected-orbit CSV, and `gurobi.log`. `tools/build_optimization_data.py` packs recorded information into `assets/iran-optimization.json`. The run label is `IR_Principal`. Its targets are **Imam Khomeini Spaceport** (35.23878672° N, 53.94957116° E) and **Shahroud Missile Test Site** (36.20108979° N, 55.33387388° E).

Inputs include salvo **2**, detection time **45 s**, interceptor burnout speed **4.0 km/s**, one interceptor per satellite, maximum acceleration **10 g**, missile burnout **170 s**, zero decision delay, intercept altitude **200 km**, zero minimum elevation, and minimum orbital altitude **200 km**. The model's reach bound is **418.423 km**, or **3.55198°** central angle.

The recorded retained seed is family **47:3**, altitude **282.162406 km**, inclination **36.20108979°**, RAAN **6.5°**. The log summary records **31 seeds simulated, one kept, and 2,114 candidate slots**. The source evaluates two-fold target availability over **2,114 samples**, about **119.9797 s** apart, across **253,517.158 s**, with J2 propagation and interceptor feasibility. Gurobi's recorded incumbents improve **721 → 613**. The selected constellation has **613 satellites**. Gurobi reports “Optimal” at a **0.9788% MIP gap**, bound **607**: 613 is the feasible incumbent, not a proven exact minimum.

The exhibit now has **three panes**. Pane 08.01 follows the principal SBI scenario-loading sequence in one animation: swivel toward Iran, draw its boundary, add gray fill, reveal and pulse the two sites, pull back, darken the sites, and populate all **613 exported selected orbital rows**. Pane 08.02 introduces the symmetric Walker baseline on the right. Pane 08.03 waits for both fleets to finish appearing, then shows restrained headings with **613** and **848 satellites** beneath them. The viewing frame tracks Iran on both Earths while the orbit states continue propagating; playback is reduced from 400 to **160 simulation seconds per real second**. The full unselected candidate-element list and feasibility matrix were not exported. Recorded Gurobi incumbents remain in the bundled data but are intentionally not animated in this concise presentation.

`tools/build_walker_baseline.py` implements a restricted symmetric Walker Delta `T/P/1` sweep based on the [standard Walker definition summarized by NASA](https://ntrs.nasa.gov/api/citations/20180008672/downloads/20180008672.pdf). It tests **508 architectures**, starting at one satellite per plane for each of the plane counts **8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64**, phase **F=1**, at the same altitude and inclination. Each architecture uses the run's **3.55198° reach cap**, two simultaneous satellites at both sites, the same 2,114 sample times, and secular J2 rates. The smallest tested passing design is **848 = 8 planes × 106 satellites**, phase 1. Both sites have minimum count two; a separate **60 s half-step** check also has minima two. Output is `assets/iran-walker-baseline.json`.

This is a **geometric baseline**, not a fully matched missile-defense optimization. It omits the interceptor timing/feasibility matrix and does not search all phases, plane counts, altitudes, or inclinations. Thus **613 versus 848**, a difference of **235 or 27.7% relative to 848**, compares the recorded RGT solution to this restricted Walker geometry test. It does not establish the advantage over an optimized Walker architecture under identical defense constraints. The final pane retains a small caveat about geometric reach and interceptor timing, with no large reduction statistic. A full comparison requires the source interceptor feasibility evaluator and a broader Walker design search.

## Reproduce validation

Run from this directory:

```sh
python3 tools/validate_science.py
python3 tools/validate_constellations.py
python3 tools/validate_ground_track.py
python3 tools/validate_starlink_visibility.py
python3 tools/build_optimization_data.py
python3 tools/build_walker_baseline.py
```

The last two scripts read the sibling source run but write only into this carousel. The Starlink snapshot can be deliberately rebuilt with `tools/build_starlink_data.py` from a new CelesTrak OMM JSON download. The static website needs neither Python nor a live orbit API.
