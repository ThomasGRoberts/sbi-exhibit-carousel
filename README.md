# Geneva Briefings Carousel Animations

Six presenter-controlled ESPL exhibits: three for Fernando and three for Nathan O'Brien. The agenda names both presenters beside their photos. A copy of the principal SBI tool is served from `integrated-sbi/` under this carousel's GitHub Pages URL. The independently hosted tool remains separate and unchanged.

## Preview and controls

From this directory run `python3 -m http.server 8878`, then open [the local preview](http://localhost:8878/) in Chrome. Select **Full Presentation** or **Exhibits Only** on the landing page, then **Launch Carousel** to enter fullscreen. Full Presentation begins with *Exploring SBI Architectures* and includes the optional title and agenda steps; Exhibits Only plays the enabled scientific animations. **Comment on Carousel** opens the in-app preview. Its toolbar contains the title editor, presentation configuration, and JSON export; the editable feedback sheet is linked as **Comment Log** within that view. Exhibit 01 was permanently removed; numbering begins at Exhibit 02. Exhibit selection and title edits persist in the browser.

The opening and Results slides show a decorative, noninteractive frame of the copied principal tool in its authentic Horizon View. The frame is removed when leaving those slides, so only one background WebGL scene runs at a time. Presentation backgrounds suppress launch-site markers; the interactive tool retains its original controls and scene behavior.

Space, Right Arrow, or a click inside a pane advances one logical presentation step. Left Arrow returns to the previous step, including across exhibit boundaries. Combined sequences play their internal panes automatically. The opening slide is followed by a three-speaker portrait slide using the supplied gold-background headshots, and a matching closing slide follows the final exhibit. **Edit text** opens live fields for titles, subtitles, speaker names and roles; the closing slide mirrors edits to the opening slide. These edits appear in the configuration export. The opening slide's presenter byline, date, and institution use separate editable lines. In the preview header, click the exhibit title to choose any included exhibit. Direct links work, for example `http://localhost:8878/#/exhibit/geographic-input/02.04`. The pane ID stays hidden until **I** reveals it.

The bottom-left model invitation appears from the speaker slide onward and opens the full local copy of the principal SBI tool inside the presentation viewport. The tool uses its normal interactions and 45-second idle carousel. The copied app includes the 768 current principal-run CSV/JSON pairs and 734 legacy manifest pairs; runtime Three.js and geographic utility modules load from the CDNs listed in its import map. In this explicit embedded context only, its upper-right polyhedron says **Back to Presentation**; that action resumes at the next logical slide. The carousel stores the launching step, return step, title mode, exhibit selection, and fullscreen state for the session. If browser restrictions end fullscreen while the tool is open, a **Restore full screen** control appears on return.

Pane IDs and internal names live in `manifest.js`. Logical steps, title slides, and phase timings live in `presentation-sequence.js`. Shared palette and exhibit colors come from `animations/sbi-style.js`. All exhibits remain drafts. This is a static site with no build step; GitHub Pages can serve the repository root when the owner enables it.

## Exhibits 02–04 — Fernando

**02 · Geography to SBI Constellation.** The small and large geographic regions each advance directly from the outlined region to the orbiting constellation. The old gold sampling phases (02.02 and 02.05) remain internal IDs but are skipped in presentation navigation. Gold launch-site markers stay hidden throughout Exhibit 02, including the larger-region sequence 02.04–02.06; other exhibits retain their own site markers. The small region's orbit paths draw over a lighter fill for legibility. Titles identify the two region sizes. The larger region's count, 789 satellites, appears only after the 02.06 population animation finishes; no comparison to the smaller region is shown.

**03 · Missile Salvo.** North Korea and its neighboring countries use consistent Natural Earth 50m borders in all three close-up panes. Gold launch-site dots appear on 03.01, pulse in sequence on 03.02, and remain visible during the missile routes and impacts on 03.03. Regenerate `assets/countries-50m.geo.json` from the bundled topology with `python3 tools/build_high_resolution_geography.py`.

**04 · Geographic Threat Scenarios.** The four geography tiles remain smaller. No launch sites appear on 04.01; gold dots pulse as each region is selected in subsequent panes. The expanded Iran globe and salvo use the same detailed 50m geography, and the salvo's site dots shrink smoothly during the zoom-out.

## Exhibit 05 — GPS Constellation

This is an idealized 24-slot reference: six fixed ECI planes, four satellites each, 55° inclination, 20,200 km circular altitude, and illustrative Walker Delta `24/6/1` phasing. It is not operational ephemeris. J2 is omitted here; Earth rotates beneath the inertial planes. Sources: [GPS.gov space segment](https://www.gps.gov/space-segment) and [U.S. Coast Guard Navigation Center](https://navcen.uscg.gov/global-positioning-system-overview).

The GPS sequence now has two internal panes that play as one logical step. After the Established Approach title, the Walker Delta planes and satellites populate automatically through 05.02. The former Geneva receiver and overhead sky panes (05.03–05.04) are removed from the presentation.

## Exhibit 06 — Repeating Ground Track Orbits

Pane 06.01 starts with a compact 3D Earth and ECI satellite. Pane 06.02 shifts the globe left and adds a synchronized 2D map. A translucent gold cap on the 3D Earth shows the satellite's moving ground footprint at a 10° minimum elevation; the camera follows it gently so the footprint stays visible. The 2D map uses simplified land and coastlines without borders, a lighter ground track, and a gray moving subpoint matching the 3D satellite. Pane 06.02 runs continuously until advancement and retains a bounded six-orbit trace. A gold target near 40° N is taken directly from the calculated repeating track and appears on each copy of the world map, with a nearby Target label and recurring pulse. Panes 06.03–06.07 play as one logical step. The actual target overflight recurs after three orbits; 06.07 continues until the trace exits the visible map.

The circular 50° example at **13,892.283 km altitude** has period **28,721.367 s**: three revolutions per sidereal Earth rotation under an unperturbed two-body model. ECI propagation and Earth rotation produce every ground-track point; J2, drag, and stationkeeping are omitted. The expanded-longitude idea was motivated by Figure 2.1 of [Hang Woon Lee's Georgia Tech dissertation](https://repository.gatech.edu/server/api/core/bitstreams/c7f7a9b9-2310-4037-904b-7af632f18086/content), without copying its nine-satellite arrangement.

## Exhibit 07 — SBI Constellation Optimization

The recorded Iran run is **`PREp-s002-d45-v4-g10-b170-k0-i1-261011a-a891`**, source commit **`059f92436212d472a30234e0a276e9c0bc2d23e2`**. Source files in sibling `sbi-constellation-viz/data/principal_runs/runs/` are the run's `_config.json`, `_result.json`, selected-orbit CSV, and `gurobi.log`. `tools/build_optimization_data.py` packs recorded information into `assets/iran-optimization.json`. The run label is `IR_Principal`. Its targets are **Imam Khomeini Spaceport** (35.23878672° N, 53.94957116° E) and **Shahroud Missile Test Site** (36.20108979° N, 55.33387388° E).

Inputs include salvo **2**, detection time **45 s**, interceptor burnout speed **4.0 km/s**, one interceptor per satellite, maximum acceleration **10 g**, missile burnout **170 s**, zero decision delay, intercept altitude **200 km**, zero minimum elevation, and minimum orbital altitude **200 km**. The model's reach bound is **418.423 km**, or **3.55198°** central angle.

The recorded retained seed is family **47:3**, altitude **282.162406 km**, inclination **36.20108979°**, RAAN **6.5°**. The log summary records **31 seeds simulated, one kept, and 2,114 candidate slots**. The source evaluates two-fold target availability over **2,114 samples**, about **119.9797 s** apart, across **253,517.158 s**, with J2 propagation and interceptor feasibility. Gurobi's recorded incumbents improve **721 → 613**. The selected constellation has **613 satellites**. Gurobi reports “Optimal” at a **0.9788% MIP gap**, bound **607**: 613 is the feasible incumbent, not a proven exact minimum.

The exhibit has **three panes**. Pane 07.01 follows the principal SBI scenario-loading sequence in one animation: swivel toward Iran, draw its boundary, add gray fill, pull back and populate all **613 exported selected orbital rows**. Pane 07.02 introduces the symmetric Walker baseline on the right. The paired globes are closer together, with each heading centered over its globe. Pane 07.03 waits for both fleets to finish appearing, then shows restrained headings with **613** and **848 satellites** beneath them. The viewing frame tracks Iran on both Earths while the orbit states continue propagating; playback is reduced from 400 to **160 simulation seconds per real second**. The full unselected candidate-element list and feasibility matrix were not exported. Recorded Gurobi incumbents remain in the bundled data but are intentionally not animated in this concise presentation.

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
