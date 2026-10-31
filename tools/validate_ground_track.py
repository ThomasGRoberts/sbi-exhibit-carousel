"""Check the two-body repeating-ground-track example used in Exhibit 07."""
import math

MU = 398600.4418
R = 6378.137
OMEGA = 7.2921150e-5
SIDEREAL = 2 * math.pi / OMEGA
PERIOD = SIDEREAL / 3
A = (MU * (PERIOD / (2 * math.pi)) ** 2) ** (1 / 3)
INCLINATION = math.radians(50)


def state(time):
    u = 2 * math.pi * time / PERIOD
    x = A * math.cos(u)
    y = A * math.sin(u) * math.sin(INCLINATION)
    z = -A * math.sin(u) * math.cos(INCLINATION)
    latitude = math.degrees(math.asin(y / A))
    longitude = math.degrees(math.atan2(-z, x) - OMEGA * time)
    return (x, y, z), latitude, longitude


p0, lat0, lon0 = state(0)
p3, lat3, lon3 = state(3 * PERIOD)
assert math.dist(p0, p3) < 1e-9
assert abs(lat3 - lat0) < 1e-11
assert abs((lon3 - lon0) + 360) < 1e-11
assert abs(3 * PERIOD - SIDEREAL) < 1e-9
assert abs(A - R - 13892.2831) < .001

# The ordinary 700-km comparison does not close after three revolutions.
ordinary_period = 2 * math.pi * math.sqrt((R + 700) ** 3 / MU)
ordinary_shift = math.degrees(OMEGA * 3 * ordinary_period) % 360
assert 1 < ordinary_shift < 359

# The plotted continuous eastward longitude gains 720° over the repeat day:
# 1080° of inertial orbital motion minus 360° of terrestrial rotation.
unwrapped_repeat = 3 * 360 - 360
assert unwrapped_repeat == 720
print(f"Exhibit 07: 3/1 repeat, altitude {A-R:.3f} km, period {PERIOD:.3f} s, "
      f"inclination 50°, closure <1e-11°, unwrapped longitude +720°.")
print(f"Ordinary 700-km comparison: 3-orbit Earth-rotation shift {ordinary_shift:.3f}°.")
