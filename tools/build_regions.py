"""Reconstruct each source lasso from its exact 15,000-cell selection.

The original freehand lasso vertices were not retained in the solver sidecars.
Triangulating the source Fibonacci shell with selected cells marked 1 and all
other cells marked 0 gives a boundary midway between them. A periodic cubic
B-spline rounds that boundary. The generated polygon must reproduce the exact
selected/unselected classification before it is accepted for presentation.
"""

import json
import math
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.path import Path as PolygonPath


PROJECT = Path(__file__).resolve().parents[1]
SOURCE = Path(__file__).resolve().parents[2] / "invitation-viz"
OUT = PROJECT / "assets" / "regions.json"
N_CELLS = 15000
PHI = (1 + math.sqrt(5)) / 2


def fibonacci_cells():
    indices = np.arange(N_CELLS)
    latitudes = np.degrees(np.arcsin(1 - (2 * indices + 1) / N_CELLS))
    longitudes = (indices * 360 / PHI + 180) % 360 - 180
    return latitudes, longitudes


def cell_index(latitude):
    return round((N_CELLS * (1 - math.sin(math.radians(latitude))) - 1) / 2)


def smooth_closed_ring(ring, samples_per_edge=4):
    result = []
    for index in range(len(ring)):
        controls = [ring[(index + shift) % len(ring)] for shift in (-1, 0, 1, 2)]
        for step in range(samples_per_edge):
            t = step / samples_per_edge
            weights = ((1-t)**3 / 6,
                       (3*t**3 - 6*t*t + 4) / 6,
                       (-3*t**3 + 3*t*t + 3*t + 1) / 6,
                       t**3 / 6)
            result.append(sum(weight * point for weight, point in zip(weights, controls)))
    return np.array(result)


def make_region(data, latitudes, longitudes):
    target_ids = [cell_index(float(target["lat_deg"])) for target in data["targets"]]
    selected = np.zeros(N_CELLS, dtype=bool)
    selected[target_ids] = True
    target_lat = latitudes[target_ids]
    target_lon = longitudes[target_ids]
    if any(abs(a - float(t["lat_deg"])) > 1e-8 or
           abs((b - float(t["lon_deg"]) + 180) % 360 - 180) > 1e-8
           for a, b, t in zip(target_lat, target_lon, data["targets"])):
        raise ValueError("Source target is not on the Blob Drawer Fibonacci shell")

    # Both stored runs are away from the longitude seam. Retain surrounding
    # unselected cells so the isoline closes on all sides.
    margin = 6
    local = ((latitudes >= min(target_lat) - margin) &
             (latitudes <= max(target_lat) + margin) &
             (longitudes >= min(target_lon) - margin) &
             (longitudes <= max(target_lon) + margin))
    longitude_scale = math.cos(math.radians(float(np.mean(target_lat))))
    x = longitudes[local] * longitude_scale
    y = latitudes[local]
    fig, axes = plt.subplots()
    contour = axes.tricontour(x, y, selected[local].astype(float), levels=[0.5])
    rings = [ring for ring in contour.allsegs[0] if len(ring) >= 4]
    plt.close(fig)
    if len(rings) != 1:
        raise ValueError(f"Expected one geographic lasso, found {len(rings)}")
    raw_ring = rings[0][:-1]
    longitude_latitude = np.column_stack((longitudes * longitude_scale, latitudes))
    # Smooth the contour progressively, accepting only a version that still
    # selects exactly the source cells. This removes the contour's straight
    # triangular facets without inventing a new sampling region.
    best = None
    for passes in range(11):
        controls = raw_ring.copy()
        for _ in range(passes):
            controls = (np.roll(controls, 1, axis=0) + 2 * controls +
                        np.roll(controls, -1, axis=0)) / 4
        ring = smooth_closed_ring(controls)
        polygon = [[round(float(point[1]), 6),
                    round(float(point[0] / longitude_scale), 6)] for point in ring]
        serialized = np.array([[lon * longitude_scale, lat] for lat, lon in polygon])
        actual = PolygonPath(serialized).contains_points(longitude_latitude)
        if np.array_equal(actual, selected):
            best = polygon, passes
    if best is None:
        raise ValueError("No smooth boundary reproduces the source cell selection")
    polygon, passes = best
    return {
        "center": [round(float(np.mean(target_lat)), 6),
                   round(float(np.mean(target_lon)), 6)],
        "boundary": polygon,
        "targetCount": len(target_ids),
        "smoothingPasses": passes,
        "selectionMethod": "0.5 contour of the exact Blob Drawer Fibonacci selection"
    }


latitudes, longitudes = fibonacci_cells()
manifest = json.loads((SOURCE / "manifest.json").read_text())
regions = {}
for item in manifest:
    data = json.loads((SOURCE / item["path"]).with_suffix(".json").read_text())
    regions[item["key"]] = make_region(data, latitudes, longitudes)
OUT.write_text(json.dumps(regions, separators=(",", ":")))
for key, region in regions.items():
    print(f"{key}: {region['targetCount']} exact cells, {len(region['boundary'])} boundary vertices, "
          f"{region['smoothingPasses']} smoothing passes")
