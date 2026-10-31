"""Rasterize the bundled country polygons as borderless land and coastlines."""
from __future__ import annotations

import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 1440, 720


def unwrapped(ring):
    points = []
    prior = None
    for lon, lat in ring:
        if prior is not None:
            while lon - prior > 180:
                lon -= 360
            while lon - prior < -180:
                lon += 360
        points.append((lon, lat))
        prior = lon
    return points


def main():
    data = json.loads((ROOT / "assets/countries.geo.json").read_text())
    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    draw = ImageDraw.Draw(mask)
    for feature in data["features"]:
        geometry = feature.get("geometry") or {}
        polygons = ([geometry["coordinates"]] if geometry.get("type") == "Polygon"
                    else geometry.get("coordinates", []) if geometry.get("type") == "MultiPolygon"
                    else [])
        for polygon in polygons:
            for ring_index, ring in enumerate(polygon):
                points = unwrapped(ring)
                for shift in (-360, 0, 360):
                    projected = [((lon + shift + 180) / 360 * WIDTH,
                                  (90 - lat) / 180 * HEIGHT) for lon, lat in points]
                    draw.polygon(projected, fill=255 if ring_index == 0 else 0)
    edge = mask.filter(ImageFilter.MaxFilter(3))
    land = Image.new("RGB", (WIDTH, HEIGHT), "#fafafa")
    land.paste("#eeeeee", mask=mask)
    # Only the narrow outside rim survives after subtracting land pixels.
    from PIL import ImageChops
    coastline = ImageChops.subtract(edge, mask)
    land.paste("#bdbdbd", mask=coastline)
    output = ROOT / "assets/ground-track-land.png"
    land.resize((720, 360), Image.Resampling.LANCZOS).save(output, optimize=True)
    print(output)


if __name__ == "__main__":
    main()
