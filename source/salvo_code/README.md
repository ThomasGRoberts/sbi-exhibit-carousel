# ICBM salvo animations

Python source for the animated globes (transparent GIF + animated PNG).
This is Python (NumPy + Pillow), not JavaScript/HTML/CSS.

## Setup
    pip install -r requirements.txt
    sh get_data.sh          # downloads ne10.json (Natural Earth borders)

## Run
    python iran_2_icbm.py all       # 2 ICBMs, Iran
    python nk_10_icbm.py all        # 10 ICBMs, North Korea
    python china_100_icbm.py all    # 100 ICBMs, China silo fields
    python <script> 0 100 200       # quick test frames only
Output goes to ./output/ (GIF + APNG). Single-core render takes ~3-5 minutes.

## How it works
- Orthographic globe: lat/lon -> unit vectors -> rotation (view centre) -> screen x,y; hidden points (z<0) are clipped.
- Borders: Natural Earth 10m polygons densified along great circles, filled light gray; focus countries get a dark outline.
- Missiles: great-circle path (slerp) lifted by an altitude profile (apogee ~1,000 km), drawn as fading gold trails.
- Camera: re-centred each frame on the launch area + missile heads, zoom set so every head stays in frame,
  zoom only ever decreases, then Gaussian-smoothed.
- Launch-to-target assignment: Iran/NK checked/searched for zero crossing; China uses minimum-distance matching
  (scipy linear_sum_assignment) plus swap repair. Target points are generic US locations, not cities.
- Styling constants (GOLD_D, GOLD_L, LAND, BORDER_HL...) are at the top of each script.
