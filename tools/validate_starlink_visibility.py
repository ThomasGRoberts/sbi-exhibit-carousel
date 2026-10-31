"""Independent direct line-of-sight spot checks for the bundled Starlink map.

The browser map uses spherical caps on a grid. This script instead computes
each satellite-to-receiver ray and its elevation, including Earth obstruction.
"""
import json,math,datetime,numpy as np
from pathlib import Path
x=json.loads((Path(__file__).resolve().parents[1]/'assets/starlink-omm-2026-10-31.json').read_text())
a=np.array(x['referenceStateRows'],dtype=float)
ids=a[:,0].astype(int);n=a[:,1]*2*math.pi/86400;e=a[:,2];inc=np.deg2rad(a[:,3]);raan=np.deg2rad(a[:,4]);arg=np.deg2rad(a[:,5]);mean=np.deg2rad(a[:,6]);R=6378.137;MU=398600.4418;J2=1.08262668e-3;OMEGA=7.292115e-5
radii=np.cbrt(MU/n**2);p=radii*(1-e*e);factor=J2*n*(R/p)**2
rraan=-1.5*factor*np.cos(inc);rarg=.75*factor*(5*np.cos(inc)**2-1)
date=datetime.datetime.fromisoformat(x['referenceUtc'].replace('Z','+00:00'));jd=date.timestamp()/86400+2440587.5;T=(jd-2451545)/36525
gmst=math.radians((280.46061837+360.98564736629*(jd-2451545)+.000387933*T*T-T**3/38710000)%360)

def vector(t):
 m=mean+n*t;sm=np.sin(m);cm=np.cos(m)
 nu=m+2*e*sm+1.25*e*e*2*sm*cm
 rr=radii/R*(1-e*cm+e*e*sm*sm)
 u=arg+rarg*t+nu;node=raan+rraan*t-gmst-OMEGA*t
 cu=np.cos(u);su=np.sin(u);co=np.cos(node);so=np.sin(node)
 return np.stack([rr*(co*cu-so*su*np.cos(inc)),rr*su*np.sin(inc),-rr*(so*cu+co*su*np.cos(inc))],axis=1)

def count(position,lat,lon):
 lat,lon=np.deg2rad([lat,lon]);g=np.array([np.cos(lat)*np.cos(lon),np.sin(lat),-np.cos(lat)*np.sin(lon)])
 ray=position-g
 sine=ray@g/np.linalg.norm(ray,axis=1)
 return int(np.count_nonzero(sine>=math.sin(math.radians(10))))
assert len(np.unique(ids))==len(ids)==x['count']==11157
print('unique IDs',len(np.unique(ids)),'records',len(ids))
for t in [0,2642.415,3600]:
 position=vector(t)
 print('time',t,[(name,count(position,lat,lon)) for name,lat,lon in [('Geneva',46.2044,6.1432),('Tehran',35.6892,51.389),('Equator',0,0),('South Indian',-43,107),('High Arctic',75,0)]])
assert count(vector(2642.415),-43,107)==281
