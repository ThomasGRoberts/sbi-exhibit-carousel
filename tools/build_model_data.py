"""Package the two invitation solver runs as static carousel assets.

The target locations are exact selected cells of Blob Drawer's 15,000-point
Fibonacci shell. This script checks that identity before writing assets.
"""

import csv
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[1] / "assets" / "model-runs.json"
N = 15000
GOLDEN_ANGLE_DEG = 360 / ((1 + math.sqrt(5)) / 2)


def wrapped(lon):
    return (lon + 180) % 360 - 180


def cell(index):
    lat = math.degrees(math.asin(1 - (2 * index + 1) / N))
    lon = wrapped(index * GOLDEN_ANGLE_DEG)
    return lat, lon


manifest = json.loads((ROOT / "invitation-viz" / "manifest.json").read_text())
runs = {}
for item in manifest:
    csv_path = ROOT / "invitation-viz" / item["path"]
    data = json.loads(csv_path.with_suffix(".json").read_text())
    with csv_path.open(newline="") as file:
        rows = list(csv.DictReader(file))
    if len(rows) != data["n_satellites"]:
        raise ValueError(f"{item['key']}: satellite count mismatch")
    indices = []
    for target in data["targets"]:
        lat, lon = float(target["lat_deg"]), float(target["lon_deg"])
        index = round((N * (1 - math.sin(math.radians(lat))) - 1) / 2)
        expected_lat, expected_lon = cell(index)
        if abs(lat - expected_lat) > 1e-8 or abs(wrapped(lon - expected_lon)) > 1e-8:
            raise ValueError(f"{item['key']}: target {target['name']} is not on the source Fibonacci shell")
        indices.append(index)
    if len(indices) != len(set(indices)):
        raise ValueError(f"{item['key']}: duplicate target cell")
    runs[item["key"]] = {
        "sourceCsv": item["path"],
        "targetIndices": indices,
        "satellites": [{key: float(row[key]) for key in
                        ("a_km", "e", "i_deg", "raan_deg", "argp_deg", "arg_lat_deg")}
                       for row in rows],
        "solver": {
            "status": data["status_str"],
            "mipGap": data["mip_gap"],
            "objective": data["obj_val"],
            "useJ2": data["sim"].get("use_j2", False),
            "earthRadiusKm": 6378.137
        },
        "coverage": {
            "interceptAltitudeKm": float(data["run_config"]["intercept_alt_km"]),
            "rMaxKm": float(data["run_config"]["r_max_km"]),
            "minElevationDeg": float(data["run_config"]["min_elev_deg"])
        },
        "simulation": {
            "horizonSeconds": float(data["sim"]["horizon_s"]),
            "useJ2": data["sim"].get("use_j2", False)
        }
    }
OUT.write_text(json.dumps(runs, separators=(",", ":")))
for key, run in runs.items():
    print(f"{key}: {len(run['targetIndices'])} targets, {len(run['satellites'])} satellites")
print(f"Wrote {OUT}")
