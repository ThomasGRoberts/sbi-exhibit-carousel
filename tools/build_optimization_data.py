"""Bundle the exact principal Iran run without changing the research source."""
from __future__ import annotations

import csv
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SOURCE = HERE.parent / "sbi-constellation-viz/data/principal_runs/runs"
RUN = "PREp-s002-d45-v4-g10-b170-k0-i1-261011a-a891"


def incumbent_history(log: str):
    history = []
    for line in log.splitlines():
        first = re.search(r"Found heuristic solution: objective ([0-9.]+)", line)
        improved = re.match(r"H\s+\d+\s+\d+\s+([0-9.]+)\s+", line)
        if not (first or improved):
            continue
        objective = float((first or improved).group(1))
        time = re.search(r"(\d+)s\s*$", line)
        if not history or objective < history[-1][1]:
            history.append([int(time.group(1)) if time else 0, objective])
    return history


def main():
    config = json.loads((SOURCE / f"{RUN}_config.json").read_text())
    result = json.loads((SOURCE / f"{RUN}_result.json").read_text())
    log = (SOURCE / f"{RUN}_gurobi.log").read_text()
    with (SOURCE / f"{RUN}_result.csv").open(newline="") as stream:
        reader = csv.DictReader(stream)
        fields = reader.fieldnames
        rows = [[int(row[field]) if field in ("slot_index", "seed_index")
                 else row[field] if field == "family" else float(row[field])
                 for field in fields] for row in reader]
    run = result["run_config"]
    if len(rows) != result["result"]["n_satellites"]:
        raise ValueError("Selected CSV row count differs from result sidecar")
    if not (config["label"] == "IR_Principal" and config["salvo_size"] == 2
            and config["detection_time_s"] == 45
            and config["burnout_velocity_km_s"] == 4
            and config["n_interceptors_per_sat"] == 1):
        raise ValueError("Iran principal run does not match the requested settings")
    bundle = {
        "runName": RUN,
        "jobName": config["job_name"],
        "sourceDirectory": "../sbi-constellation-viz/data/principal_runs/runs",
        "sourceCommit": result["provenance"]["git_commit"],
        "recordedAtUtc": result["timestamp_utc"],
        "inputs": {key: config[key] for key in (
            "label", "target_points", "salvo_size", "n_interceptors_per_sat",
            "burnout_velocity_km_s", "max_accel_g", "detection_time_s",
            "decision_time_s", "target_missile_burnout_time_s", "intercept_alt_km",
            "min_elev_deg", "nd_repeat", "altitude_min_km", "raan_step_deg",
            "dt_target_s", "margin_multiplier", "trim_margin_multiplier")},
        "coverage": result["cov"],
        "simulation": result["sim"],
        "architecture": {
            "selectedSatellites": result["result"]["n_satellites"],
            "status": result["result"]["status"],
            "bestBound": result["result"]["obj_bound"],
            "mipGap": result["result"]["mip_gap_achieved"],
            "family": run["anchor_ratio"],
            "altitudeKm": run["anchor_alt_km"],
            "inclinationDeg": run["anchor_inc_deg"],
            "seed": run["seeds_kept"][0],
            "candidateSlots": run["seed_filter"]["n_candidate_satellites"],
            "seedsSimulated": run["seed_filter"]["n_seeds_simulated"],
            "seedsKept": run["seed_filter"]["n_seeds_kept"],
            "raanOffsets": run["families"][0]["n_raan_offsets"],
            "requiredPerTarget": run["r_required"],
            "horizonSamples": run["L"],
        },
        "solverIncumbents": incumbent_history(log),
        "satelliteFields": fields,
        "selectedSatellites": rows,
        "interpretation": "Seed and candidate counts are recorded summaries. The solver incumbent "
                          "sequence is recorded in the Gurobi log. Individual unselected candidate "
                          "orbital elements and the full feasibility matrix are not exported; any "
                          "candidate-orbit graphic must be identified as explanatory reconstruction."
    }
    destination = HERE / "assets/iran-optimization.json"
    destination.write_text(json.dumps(bundle, separators=(",", ":")) + "\n")
    print(f"{RUN}: {len(rows)} selected satellites, "
          f"{len(bundle['solverIncumbents'])} incumbent changes, {destination}")


if __name__ == "__main__":
    main()
