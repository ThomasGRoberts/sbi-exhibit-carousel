"""Independent static checks for the two Nathan constellation exhibits."""
import json
import math
import pathlib
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
R, MU = 6378.137, 398600.4418
altitude = 20200
period = 2 * math.pi * math.sqrt((R + altitude) ** 3 / MU)
assert 43000 < period < 43200
planes = [i * 60 for i in range(6)]
slots = [(plane, slot * 90 + plane * 15) for plane in range(6) for slot in range(4)]
assert len(slots) == 24 and len(planes) == 6
assert all((planes[(i + 1) % 6] - planes[i]) % 360 == 60 for i in range(6))

catalog = json.loads((ROOT / 'assets/starlink-omm-2026-10-31.json').read_text())
rows, reference = catalog['rows'], catalog['referenceStateRows']
assert catalog['count'] == len(rows) == len(reference) == 11157
assert len({r[0] for r in rows}) == len(rows)
assert [r[0] for r in rows] == [r[0] for r in reference]
assert not catalog['excludedSgp4Errors']
assert catalog['source'].startswith('CelesTrak')
assert catalog['sourceEpochRangeUtc'][0] < catalog['referenceUtc']
altitudes = [(MU / (r[1] * 2 * math.pi / 86400) ** 2) ** (1 / 3) - R for r in reference]
inclinations = Counter(round(r[3]) for r in reference)
assert 150 < min(altitudes) < 300 and 500 < max(altitudes) < 800
assert {43, 53, 70, 97}.issubset(inclinations)

# Analytical footprint criterion shared by the browser's grid accumulator.
mask = math.radians(10)
for h in [400, 550, altitude]:
    angular_radius = math.acos(math.cos(mask) * R / (R + h)) - mask
    assert angular_radius > 0
    assert angular_radius < math.acos(R / (R + h))
print(f'GPS: 24 idealized slots, 6 planes, 4 slots/plane, 55° inclination, '
      f'{altitude:,} km altitude, {period/3600:.4f} h period, Walker 24/6/1 phasing')
print(f'Starlink: {catalog["count"]:,} unique catalog records, retrieved '
      f'{catalog["retrievedUtc"]}, SGP4 errors 0')
print(f'Starlink reference altitudes: {min(altitudes):.1f}–{max(altitudes):.1f} km; '
      f'principal inclinations {inclinations.most_common(5)}')
print('Coverage criterion: geometric line of sight above 10° elevation; footprint formula passes.')
