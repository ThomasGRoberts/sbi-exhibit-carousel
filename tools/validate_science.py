"""Audit the packaged blob scenarios against the source SBI run sidecars."""

import csv
import json
import math
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT.parent / "invitation-viz"
RUNS = json.loads((PROJECT / "assets/model-runs.json").read_text())
REGIONS = json.loads((PROJECT / "assets/regions.json").read_text())
N = 15000
PHI = (1 + math.sqrt(5)) / 2
EARTH_RADIUS = 6378.137
MU = 398600.4418
OMEGA = 7.2921150e-5


def shell_point(index):
    lat = math.degrees(math.asin(1 - (2 * index + 1) / N))
    lon = (index * 360 / PHI + 180) % 360 - 180
    return lat, lon


def inside(lat, lon, boundary):
    included = False
    previous = boundary[-1]
    for current in boundary:
        a_lat, a_lon = current
        b_lat, b_lon = previous
        if (a_lat > lat) != (b_lat > lat) and lon < (b_lon - a_lon) * (
            lat - a_lat) / (b_lat - a_lat) + a_lon:
            included = not included
        previous = current
    return included


def vector(lat, lon, radius):
    lat, lon = math.radians(lat), math.radians(lon)
    return (radius * math.cos(lat) * math.cos(lon),
            radius * math.sin(lat),
            -radius * math.cos(lat) * math.sin(lon))


def analytical_earth_fixed(row, t):
    a = row["a_km"]
    n = math.sqrt(MU / a**3)
    argument = math.radians(row["arg_lat_deg"]) + n * t
    raan = math.radians(row["raan_deg"])
    inc = math.radians(row["i_deg"])
    x_orbit = a / EARTH_RADIUS * math.cos(argument)
    y_orbit = a / EARTH_RADIUS * math.sin(argument)
    x = x_orbit * math.cos(raan) - y_orbit * math.sin(raan) * math.cos(inc)
    y = x_orbit * math.sin(raan) + y_orbit * math.cos(raan) * math.cos(inc)
    z = y_orbit * math.sin(inc)
    earth_angle = -OMEGA * t
    return (x * math.cos(earth_angle) - y * math.sin(earth_angle),
            z,
            -x * math.sin(earth_angle) - y * math.cos(earth_angle))


def active_satellites(run, t):
    radius = (EARTH_RADIUS + run["coverage"]["interceptAltitudeKm"]) / EARTH_RADIUS
    targets = [vector(*shell_point(index), radius) for index in run["targetIndices"]]
    range_sq = (run["coverage"]["rMaxKm"] / EARTH_RADIUS) ** 2
    elevation = math.sin(math.radians(run["coverage"]["minElevationDeg"]))
    active = 0
    for row in run["satellites"]:
        satellite = analytical_earth_fixed(row, t)
        for target in targets:
            delta = tuple(s - p for s, p in zip(satellite, target))
            distance_sq = sum(value * value for value in delta)
            if distance_sq > range_sq or distance_sq <= 0:
                continue
            upward = sum(d * p for d, p in zip(delta, target)) / (
                math.sqrt(distance_sq) * math.sqrt(sum(p * p for p in target)))
            if upward >= elevation:
                active += 1
                break
    return active


def projected_extents(points, center, distance):
    center_lat, center_lon = center
    pitch = math.radians(center_lat)
    rotation = math.radians(-90 - center_lon)
    max_x = max_y = 0
    for lat, lon in points:
        lat = math.radians(lat)
        longitude = math.radians(lon) + rotation
        x = 1.015 * math.cos(lat) * math.cos(longitude)
        y = 1.015 * math.sin(lat)
        z = -1.015 * math.cos(lat) * math.sin(longitude)
        depth = distance - y * math.sin(pitch) - z * math.cos(pitch)
        upward = y * math.cos(pitch) - z * math.sin(pitch)
        assert depth > 0
        max_x = max(max_x, abs(x / (depth * math.tan(math.radians(19)) * 16 / 9)))
        max_y = max(max_y, abs(upward / (depth * math.tan(math.radians(19)))))
    return max_x, max_y


def audit(key, run):
    source_csv = SOURCE / run["sourceCsv"]
    source_sidecar = json.loads(source_csv.with_suffix(".json").read_text())
    with source_csv.open(newline="") as file:
        source_rows = list(csv.DictReader(file))
    assert len(source_rows) == len(run["satellites"]) == source_sidecar["n_satellites"]
    fields = ("a_km", "e", "i_deg", "raan_deg", "argp_deg", "arg_lat_deg")
    for source, packaged in zip(source_rows, run["satellites"]):
        assert all(float(source[field]) == packaged[field] for field in fields)
    assert len({tuple(row[field] for field in fields) for row in run["satellites"]}) == len(source_rows)
    assert run["simulation"]["useJ2"] is False
    assert all(row["e"] == 0 for row in run["satellites"])
    assert source_sidecar["status_str"] == run["solver"]["status"]
    assert source_sidecar["mip_gap"] == run["solver"]["mipGap"]

    boundary = REGIONS[key]["boundary"]
    min_lat, max_lat = min(p[0] for p in boundary), max(p[0] for p in boundary)
    min_lon, max_lon = min(p[1] for p in boundary), max(p[1] for p in boundary)
    selected = [index for index in range(N)
                if min_lat <= (lat := shell_point(index)[0]) <= max_lat
                and min_lon <= (lon := shell_point(index)[1]) <= max_lon
                and inside(lat, lon, boundary)]
    assert selected == sorted(run["targetIndices"]), (key, "region does not match source cells")
    assert len(selected) == REGIONS[key]["targetCount"]
    low, high = 1.08, 8.0
    for _ in range(28):
        midpoint = (low + high) / 2
        x, y = projected_extents(boundary, REGIONS[key]["center"], midpoint)
        if x <= .92 and y <= .90:
            high = midpoint
        else:
            low = midpoint
    sample_distance = max(1.22, high)
    site_x, site_y = projected_extents(
        [shell_point(index) for index in selected], REGIONS[key]["center"], sample_distance)
    assert site_x <= .92 and site_y <= .90, "Launch sites are clipped in the zoom"
    assert all(math.hypot(*analytical_earth_fixed(row, 300)) > 1
               for row in run["satellites"])
    period = 2 * math.pi / math.sqrt(MU / run["satellites"][0]["a_km"]**3)
    active0 = active_satellites(run, 0)
    active300 = active_satellites(run, 300)
    print(f"{key}: {len(selected)} cells, {len(source_rows)} unique orbital rows, "
          f"{active0}/{active300} active at 0/300 s, period {period/60:.2f} min")
    print(f"  target bounds lat {min(shell_point(i)[0] for i in selected):.3f}.."
          f"{max(shell_point(i)[0] for i in selected):.3f}, "
          f"lon {min(shell_point(i)[1] for i in selected):.3f}.."
          f"{max(shell_point(i)[1] for i in selected):.3f}")
    print(f"  region bounds lat {min_lat:.3f}..{max_lat:.3f}, "
          f"lon {min_lon:.3f}..{max_lon:.3f}")
    print(f"  sampling camera distance {sample_distance:.3f} Earth radii; "
          f"site frame extents {site_x:.3f} × {site_y:.3f} NDC")


for key, run in RUNS.items():
    audit(key, run)
configurations = []
for run in RUNS.values():
    data = json.loads((SOURCE / run["sourceCsv"]).with_suffix(".json").read_text())
    cfg = data["run_config"]
    keys = ("dt_s", "t_window_s", "v_bo_km_s", "a_g", "intercept_alt_km",
            "min_elev_deg", "r_max_km", "altitude_override_km", "actual_alt_km",
            "salvo_size", "n_interceptors_per_sat", "r_required", "mip_gap_target",
            "time_limit_s", "n_seeds_for_milp", "inclination_sweep_bounds_deg",
            "inclination_screen_step_deg", "n_raan_offsets")
    configurations.append({key: cfg[key] for key in keys})
assert configurations[0] == configurations[1], "The two model configurations differ"
print("Both scenarios use identical model parameters apart from their target geography.")
