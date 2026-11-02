"""Expand the bundled Natural Earth 50m topology for the close-up salvo globe."""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "integrated-sbi/assets/countries-50m.json"
OUTPUT = ROOT / "assets/countries-50m.geo.json"


def build():
    topology = json.loads(SOURCE.read_text())
    scale = topology["transform"]["scale"]
    translate = topology["transform"]["translate"]
    cache = {}

    def arc(index):
        source_index = index if index >= 0 else ~index
        if source_index not in cache:
            x = y = 0
            points = []
            for dx, dy in topology["arcs"][source_index]:
                x += dx
                y += dy
                points.append([x * scale[0] + translate[0],
                               y * scale[1] + translate[1]])
            cache[source_index] = points
        points = cache[source_index]
        return points if index >= 0 else list(reversed(points))

    def ring(indices):
        result = []
        for index in indices:
            section = arc(index)
            result.extend(section if not result else section[1:])
        if result and result[0] != result[-1]:
            result.append(result[0])
        return result

    features = []
    for item in topology["objects"]["countries"]["geometries"]:
        if item["type"] == "Polygon":
            coordinates = [ring(indices) for indices in item["arcs"]]
        elif item["type"] == "MultiPolygon":
            coordinates = [[ring(indices) for indices in polygon]
                           for polygon in item["arcs"]]
        else:
            continue
        features.append({
            "type": "Feature",
            "id": item.get("id"),
            "properties": item.get("properties", {}),
            "geometry": {"type": item["type"], "coordinates": coordinates},
        })

    OUTPUT.write_text(json.dumps({"type": "FeatureCollection",
                                  "features": features}, separators=(",", ":")))
    print(f"Wrote {len(features)} detailed countries to {OUTPUT}")


if __name__ == "__main__":
    build()
