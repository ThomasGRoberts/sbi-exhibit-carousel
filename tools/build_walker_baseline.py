"""Reproducible, restricted Walker-Delta geometric baseline for the Iran run.

This is deliberately not the SBI optimizer: it tests the recorded geographic
reach cap and two simultaneous target requirements on symmetric Walker shells.
It does not establish interceptor timing or launch feasibility.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parents[1]
SOURCE = HERE.parent / "sbi-constellation-viz/data/principal_runs/runs"
RUN = "PREp-s002-d45-v4-g10-b170-k0-i1-261011a-a891"
RESULT = json.loads((SOURCE / f"{RUN}_result.json").read_text())
R = 6378.137
MU = 398600.4418
J2 = 1.08262668e-3
OMEGA = 7.2921150e-5


def setup():
    run = RESULT["run_config"]
    family = run["families"][0]
    altitude = family["alt_km"]
    inclination = math.radians(family["inc_deg"])
    radius = R + altitude
    mean_motion = math.sqrt(MU / radius**3)
    factor = J2 * mean_motion * (R / radius) ** 2
    raan_rate = -1.5 * factor * math.cos(inclination)
    arg_rate = 0.75 * factor * (5 * math.cos(inclination) ** 2 - 1)
    times = np.arange(run["L"], dtype=np.float64) * run["dt_s"]
    targets = [(math.radians(p["lat_deg"]), math.radians(p["lon_deg"]))
               for p in RESULT["targets"]]
    return run, family, inclination, mean_motion, raan_rate, arg_rate, times, targets


def counts(planes, per_plane, phasing, parameters):
    run, family, inc, n, raan_rate, arg_rate, times, targets = parameters
    out = np.zeros((len(targets), len(times)), dtype=np.uint16)
    threshold = math.cos(math.radians(family["reach_deg"]))
    slot_phase = 2 * math.pi * np.arange(per_plane) / per_plane
    advance = (n + arg_rate) * times[:, None]
    for plane in range(planes):
        node = 2 * math.pi * plane / planes + (raan_rate - OMEGA) * times
        phase = slot_phase + 2 * math.pi * phasing * plane / (planes * per_plane)
        cos_u = np.cos(advance + phase)
        sin_u = np.sin(advance + phase)
        for index, (lat, lon) in enumerate(targets):
            cosine = math.cos(lat) * np.cos(lon - node)
            sine = (math.cos(lat) * math.cos(inc) * np.sin(lon - node)
                    + math.sin(lat) * math.sin(inc))
            dot = cosine[:, None] * cos_u + sine[:, None] * sin_u
            out[index] += np.count_nonzero(dot >= threshold, axis=1).astype(np.uint16)
    return out


def main():
    parameters = setup()
    run, family, inc, n, raan_rate, arg_rate, times, targets = parameters
    threshold = run["r_required"]
    plane_choices = [8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64]
    tested = 0
    viable = []
    for planes in plane_choices:
        first = 1
        last = math.ceil(2500 / planes)
        for per_plane in range(first, last + 1):
            result = counts(planes, per_plane, 1, parameters)
            tested += 1
            if np.all(result >= threshold):
                viable.append((planes * per_plane, planes, per_plane, 1, result))
                break
    if not viable:
        raise RuntimeError("No feasible restricted Walker baseline below 2,500 satellites")
    satellites, planes, per_plane, phasing, result = min(viable, key=lambda item: item[0])
    half_step_parameters = list(parameters)
    half_step_parameters[6] = np.arange(0, times[-1] + 60, 60.0)
    half_step = counts(planes, per_plane, phasing, half_step_parameters)
    if np.any(half_step < threshold):
        raise RuntimeError("Chosen Walker baseline fails 60-second spot validation")
    reduction = (satellites - RESULT["result"]["n_satellites"]) / satellites
    output = {
        "method": "Restricted Walker Delta T/P/1 sweep; sampled geometric reach only",
        "sourceRun": RUN,
        "sourceCommit": RESULT["provenance"]["git_commit"],
        "planesTested": plane_choices,
        "architecturesTested": tested,
        "chosen": {"satellites": satellites, "planes": planes,
                   "satellitesPerPlane": per_plane, "phasing": phasing,
                   "inclinationDeg": family["inc_deg"],
                   "altitudeKm": family["alt_km"],
                   "raanRateRadS": raan_rate, "argRateRadS": arg_rate,
                   "meanMotionRadS": n},
        "criterion": {"targetNames": [p["name"] for p in RESULT["targets"]],
                      "reachDeg": family["reach_deg"],
                      "requiredSimultaneousSatellites": threshold,
                      "sampleIntervalSeconds": run["dt_s"],
                      "sampleCount": len(times),
                      "horizonSeconds": RESULT["sim"]["horizon_s"],
                      "usesJ2SecularRates": True},
        "checks": [{"name": p["name"], "minimum": int(row.min()),
                    "mean": float(row.mean()), "maximum": int(row.max()),
                    "failingSamples": int(np.count_nonzero(row < threshold))}
                   for p, row in zip(RESULT["targets"], result)],
        "halfStepValidation": {"intervalSeconds": 60,
                               "sampleCount": len(half_step_parameters[6]),
                               "minimumByTarget": [int(row.min()) for row in half_step]},
        "rgtSatellites": RESULT["result"]["n_satellites"],
        "difference": satellites - RESULT["result"]["n_satellites"],
        "rgtReductionRelativeToBaselinePercent": 100 * reduction,
        "limitation": "The Walker test uses the recorded reach angle and two-fold target count, "
                      "but does not rerun the optimizer's interceptor timing/feasibility matrix. "
                      "The result is the best of this restricted T/P/1 sweep, not a globally "
                      "optimized Walker constellation or a fully matched defense result."
    }
    destination = HERE / "assets/iran-walker-baseline.json"
    destination.write_text(json.dumps(output, indent=2) + "\n")
    print(f"{satellites} = {planes} planes × {per_plane} satellites, F=1; "
          f"minima {[int(row.min()) for row in result]}; "
          f"tested {tested}; {destination}")


if __name__ == "__main__":
    main()
