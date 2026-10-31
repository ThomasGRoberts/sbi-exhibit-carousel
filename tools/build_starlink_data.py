"""Package a timestamped CelesTrak STARLINK OMM JSON download for offline display.

Usage: PYTHONPATH=/path/to/sgp4 python3 tools/build_starlink_data.py omm.json
Source: https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=JSON
The STARLINK group is cataloged orbiting objects, not verified operational craft.
"""
import datetime as dt
import json
import math
import pathlib
import sys

import numpy as np
from sgp4.api import Satrec, jday
from sgp4 import omm

MU = 398600.4418
reference = dt.datetime(2026, 10, 31, 12, tzinfo=dt.timezone.utc)
julian, fraction = jday(2026, 10, 31, 12, 0, 0)

def osculating_elements(position, velocity):
    r = np.asarray(position, dtype=float)
    v = np.asarray(velocity, dtype=float)
    rmag = np.linalg.norm(r)
    h = np.cross(r, v)
    hmag = np.linalg.norm(h)
    node = np.cross([0., 0., 1.], h)
    nmag = np.linalg.norm(node)
    evec = np.cross(v, h) / MU - r / rmag
    e = np.linalg.norm(evec)
    a = 1 / (2 / rmag - np.dot(v, v) / MU)
    inclination = math.acos(np.clip(h[2] / hmag, -1, 1))
    raan = math.atan2(node[1], node[0])
    if e > 1e-8 and nmag > 1e-8:
        arg = math.atan2(np.dot(np.cross(node, evec), h) / (nmag * e * hmag),
                         np.dot(node, evec) / (nmag * e))
        nu = math.atan2(np.dot(np.cross(evec, r), h) / (e * rmag * hmag),
                        np.dot(evec, r) / (e * rmag))
    else:
        arg = 0.
        nu = math.atan2(np.dot(np.cross(node, r), h) / (nmag * rmag * hmag),
                        np.dot(node, r) / (nmag * rmag))
    E = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2),
                       math.sqrt(1 + e) * math.cos(nu / 2))
    mean_anomaly = E - e * math.sin(E)
    mean_motion = math.sqrt(MU / a ** 3) * 86400 / (2 * math.pi)
    return [mean_motion, e, math.degrees(inclination), math.degrees(raan) % 360,
            math.degrees(arg) % 360, math.degrees(mean_anomaly) % 360]

source = pathlib.Path(sys.argv[1])
records = json.loads(source.read_text())
rows = []
reference_rows = []
errors = []
epochs = []
for item in records:
    if not item['OBJECT_NAME'].startswith('STARLINK'):
        continue
    sat = Satrec()
    omm.initialize(sat, item)
    code, position, velocity = sat.sgp4(julian, fraction)
    if code:
        errors.append([item['NORAD_CAT_ID'], code])
        continue
    epoch = dt.datetime.fromisoformat(item['EPOCH']).replace(tzinfo=dt.timezone.utc)
    epochs.append(epoch)
    rows.append([
        item['NORAD_CAT_ID'], round((epoch - reference).total_seconds(), 3),
        item['MEAN_MOTION'], item['ECCENTRICITY'], item['INCLINATION'],
        item['RA_OF_ASC_NODE'], item['ARG_OF_PERICENTER'], item['MEAN_ANOMALY']
    ])
    reference_rows.append([item['NORAD_CAT_ID'], *osculating_elements(position, velocity)])
rows.sort(key=lambda x: x[0])
reference_rows.sort(key=lambda x: x[0])
assert len({row[0] for row in rows}) == len(rows)
assert [row[0] for row in rows] == [row[0] for row in reference_rows]
output = {
    'source': 'CelesTrak Current GP STARLINK group, OMM JSON',
    'sourceUrl': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=STARLINK&FORMAT=JSON',
    'retrievedUtc': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
    'referenceUtc': reference.isoformat(),
    'sourceEpochRangeUtc': [min(epochs).isoformat(), max(epochs).isoformat()],
    'criteria': 'Unique STARLINK group records with successful SGP4 state at reference epoch; operating status is not verified.',
    'count': len(rows),
    'excludedSgp4Errors': errors,
    'fields': ['NORAD_CAT_ID','epochOffsetSeconds','meanMotionRevolutionsPerDay','eccentricity','inclinationDegrees','raanDegrees','argumentOfPerigeeDegrees','meanAnomalyDegrees'],
    'rows': rows,
    'referenceStateMethod': 'SGP4 position and velocity at reference UTC converted to osculating Kepler elements; browser advances with two-body motion and secular J2.',
    'referenceFields': ['NORAD_CAT_ID','meanMotionRevolutionsPerDay','eccentricity','inclinationDegrees','raanDegrees','argumentOfPerigeeDegrees','meanAnomalyDegrees'],
    'referenceStateRows': reference_rows
}
path = pathlib.Path(__file__).resolve().parents[1] / 'assets' / 'starlink-omm-2026-10-31.json'
path.write_text(json.dumps(output, separators=(',', ':')))
print(path, len(rows), path.stat().st_size, 'SGP4 errors', len(errors))
