# Geneva Briefings Carousel Animations

Seven presenter-controlled ESPL exhibits: four for Fernando and three for Nathan O'Brien. The agenda names both presenters beside their photos. The sibling research projects were used as read-only design, model, and data references.

## Preview and controls

From this directory run `python3 -m http.server 8878`, then open [the local preview](http://localhost:8878/) in Chrome. **Launch Carousel** enters fullscreen and starts the presentation with one click; **Comment on Carousel** opens the editable feedback sheet. All seven exhibits are checked by default. The Configurations tab has a Presentation Titles editor, a global on/off toggle, a sequence preview, and a JSON export. Edits and exhibit selection persist in this browser.

Space, Right Arrow, or a click inside a pane advances one logical presentation step. Left Arrow returns to the previous step, including across exhibit boundaries. Combined sequences play their internal panes automatically. Title slides use the same deck controls as exhibits, including copyable stable pane IDs, the Comment Log, and Configure. Edit text opens separate live fields for each title, subtitle, and agenda item; those edits persist locally and appear in the title-configuration export. In the preview header, click the exhibit title to choose any included exhibit. Direct links work, for example `http://localhost:8878/#/exhibit/geographic-input/02.04`. The centered polyhedron appears only on the “Let's See Some Results” title slide; clicking it opens the live SBI model in a new tab and advances the carousel to “The Established Approach.”

Pane IDs and internal names live in `manifest.js`. Logical steps, title slides, and phase timings live in `presentation-sequence.js`. Shared palette and launch-site gold come from `animations/sbi-style.js`. All exhibits remain drafts. This is a static site with no build step; GitHub Pages can serve the repository root when the owner enables it.

## Exhibits 01–04 — Fernando

**01 · Basics of Space-Based Interception.** The opening view frames the Northern Hemisphere. The planned trajectory starts at the launch marker and carries curved boost, midcourse, and terminal labels. The terminal-defense view keeps the full arc visible from a higher camera angle, with an unlabeled surface launch dot left of the missile's destination. The full planned arc remains visible while the missile flies and meets the terminal interceptor. In the orbital sequence, satellites appear one at a time, and the guided interceptor path visibly begins at its satellite. The camera stays fixed between 01.06 and 01.07. Contact dots remain during the collision pulse. This is a conceptual engagement illustration, not an optimized intercept: the ballistic and terminal segments omit staging, drag, Earth rotation, and variable gravity. The former 01.06 and 01.07 panes were removed; the sequence now has eight panes.

Deferred Exhibit 01 feedback: pane 01.03 begins with an unexplained line segment from the launch site; the gold launch marker should eventually become a surface-attached patch. This revision leaves Exhibit 01's scene design unchanged.

**02 · Geography to SBI Constellation.** In both geography transitions, the boundary redraw begins while sampling dots remain, then the dots fade and the gray fill appears before zoom-out. The old 02.04 hold pane was removed; later panes are renumbered, leaving six panes. The one-shot launch-site pulse sweep is faster.

**03 · Missile Salvo.** This exhibit contains the three North Korea panes. The original 03.01, 03.02, 03.04, and 03.08 panes were removed. One missile targets Hawaii, another Guam, and eight target the continental United States. Each travels to its target and produces an impact pulse; playback holds after the final arrival. The Iran salvo moved to 04.09, after the two Iran launch-site panes.

**04 · Geographic Threat Scenarios.** The North Korea, Iran, China, Russia cards lead into the Iran globe and two sites. The Iran tile expansion is the sole close-up transition, showing one globe image during expansion. The globe uses the Iran salvo's opening camera pose and scale, so 04.08 and 04.09 align. Pane 04.09 runs the Iran salvo through impact.

## Exhibit 05 — GPS Constellation

This is an idealized 24-slot reference: six fixed ECI planes, four satellites each, 55° inclination, 20,200 km circular altitude, and illustrative Walker Delta `24/6/1` phasing. It is not operational ephemeris. J2 is omitted here; Earth rotates beneath the inertial planes. Sources: [GPS.gov space segment](https://www.gps.gov/space-segment) and [U.S. Coast Guard Navigation Center](https://navcen.uscg.gov/global-positioning-system-overview).

The GPS sequence now has two internal panes that play as one logical step. After the Established Approach title, the Walker Delta planes and satellites populate automatically through 05.02. The former Geneva receiver and overhead sky panes (05.03–05.04) are removed from the presentation.

## Exhibit 06 — Repeating Ground Track Orbits

Pane 06.01 starts with a compact 3D Earth and ECI satellite. Pane 06.02 shifts the globe left and adds a synchronized 2D map. A translucent gold cap on the 3D Earth shows the satellite's moving ground footprint at a 10° minimum elevation; the camera follows it gently so the footprint stays visible. The visible footprint text is removed. The 2D map uses simplified land and coastlines without borders, a lighter ground track, and a gray moving subpoint matching the 3D satellite. A gold target near 40° N is taken directly from the calculated repeating track and appears on each copy of the world map, with a nearby Target label and recurring pulse. Panes 06.03–06.07 play as one logical step. The actual target overflight recurs after three orbits, and the last pane runs far enough to show it.

The circular 50° example at **13,892.283 km altitude** has period **28,721.367 s**: three revolutions per sidereal Earth rotation under an unperturbed two-body model. ECI propagation and Earth rotation produce every ground-track point; J2, drag, and stationkeeping are omitted. The expanded-longitude idea was motivated by Figure 2.1 of [Hang Woon Lee's Georgia Tech dissertation](https://repository.gatech.edu/server/api/core/bitstreams/c7f7a9b9-2310-4037-904b-7af632f18086/content), without copying its nine-satellite arrangement.

## Exhibit 07 — SBI Constellation Optimization

The recorded Iran run is **`PREp-s002-d45-v4-g10-b170-k0-i1-261011a-a891`**, source commit **`059f92436212d472a30234e0a276e9c0bc2d23e2`**. Source files in sibling `sbi-constellation-viz/data/principal_runs/runs/` are the run's `_config.json`, `_result.json`, selected-orbit CSV, and `gurobi.log`. `tools/build_optimization_data.py` packs recorded information into `assets/iran-optimization.json`. The run label is `IR_Principal`. Its targets are **Imam Khomeini Spaceport** (35.23878672° N, 53.94957116° E) and **Shahroud Missile Test Site** (36.20108979° N, 55.33387388° E).

Inputs include salvo **2**, detection time **45 s**, interceptor burnout speed **4.0 km/s**, one interceptor per satellite, maximum acceleration **10 g**, missile burnout **170 s**, zero decision delay, intercept altitude **200 km**, zero minimum elevation, and minimum orbital altitude **200 km**. The model's reach bound is **418.423 km**, or **3.55198°** central angle.

The recorded retained seed is family **47:3**, altitude **282.162406 km**, inclination **36.20108979°**, RAAN **6.5°**. The log summary records **31 seeds simulated, one kept, and 2,114 candidate slots**. The source evaluates two-fold target availability over **2,114 samples**, about **119.9797 s** apart, across **253,517.158 s**, with J2 propagation and interceptor feasibility. Gurobi's recorded incumbents improve **721 → 613**. The selected constellation has **613 satellites**. Gurobi reports “Optimal” at a **0.9788% MIP gap**, bound **607**: 613 is the feasible incumbent, not a proven exact minimum.

The exhibit has **three panes**. Pane 07.01 follows the principal SBI scenario-loading sequence in one animation: swivel toward Iran, draw its boundary, add gray fill, reveal and pulse the two sites, pull back, darken the sites, and populate all **613 exported selected orbital rows**. Pane 07.02 introduces the symmetric Walker baseline on the right. Pane 07.03 waits for both fleets to finish appearing, then shows restrained headings with **613** and **848 satellites** beneath them. The viewing frame tracks Iran on both Earths while the orbit states continue propagating; playback is reduced from 400 to **160 simulation seconds per real second**. The full unselected candidate-element list and feasibility matrix were not exported. Recorded Gurobi incumbents remain in the bundled data but are intentionally not animated in this concise presentation.

`tools/build_walker_baseline.py` implements a restricted symmetric Walker Delta `T/P/1` sweep based on the [standard Walker definition summarized by NASA](https://ntrs.nasa.gov/api/citations/20180008672/downloads/20180008672.pdf). It tests **508 architectures**, starting at one satellite per plane for each of the plane counts **8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64**, phase **F=1**, at the same altitude and inclination. Each architecture uses the run's **3.55198° reach cap**, two simultaneous satellites at both sites, the same 2,114 sample times, and secular J2 rates. The smallest tested passing design is **848 = 8 planes × 106 satellites**, phase 1. Both sites have minimum count two; a separate **60 s half-step** check also has minima two. Output is `assets/iran-walker-baseline.json`.

This is a **geometric baseline**, not a fully matched missile-defense optimization. It omits the interceptor timing/feasibility matrix and does not search all phases, plane counts, altitudes, or inclinations. Thus **613 versus 848**, a difference of **235 or 27.7% relative to 848**, compares the recorded RGT solution to this restricted Walker geometry test. It does not establish the advantage over an optimized Walker architecture under identical defense constraints. The final pane retains a small caveat about geometric reach and interceptor timing, with no large reduction statistic. A full comparison requires the source interceptor feasibility evaluator and a broader Walker design search.

## Reproduce validation

Run from this directory:

```sh
python3 tools/validate_science.py
python3 tools/validate_constellations.py
python3 tools/validate_ground_track.py
python3 tools/build_optimization_data.py
python3 tools/build_walker_baseline.py
```

The last two scripts read the sibling source run but write only into this carousel. The static website needs neither Python nor a live orbit API.
