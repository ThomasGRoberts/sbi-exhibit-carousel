"""Extract deterministic salvo geometry and frame schedules from Fernando's Python sources.

The three source scripts are evaluated only through their scenario definitions;
their Pillow rendering and border densification are not executed. The one
SciPy assignment call is replaced with an equivalent Hungarian solver.
"""
import json
from pathlib import Path
from types import SimpleNamespace
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/"source"/"salvo_code"
OUT=ROOT/"assets"/"salvo-scenarios.json"

def hungarian(cost):
    # Rectangular min-cost assignment; these scenarios use a 100x100 matrix.
    a=np.asarray(cost,dtype=float)
    n,m=a.shape
    u=np.zeros(n+1);v=np.zeros(m+1)
    p=np.zeros(m+1,dtype=int);way=np.zeros(m+1,dtype=int)
    for i in range(1,n+1):
        p[0]=i;j0=0
        minv=np.full(m+1,np.inf);used=np.zeros(m+1,dtype=bool)
        while True:
            used[j0]=True;i0=p[j0];delta=np.inf;j1=0
            for j in range(1,m+1):
                if used[j]:continue
                cur=a[i0-1,j-1]-u[i0]-v[j]
                if cur<minv[j]:minv[j]=cur;way[j]=j0
                if minv[j]<delta:delta=minv[j];j1=j
            for j in range(m+1):
                if used[j]:u[p[j]]+=delta;v[j]-=delta
                else:minv[j]-=delta
            j0=j1
            if p[j0]==0:break
        while True:
            j1=way[j0];p[j0]=p[j1];j0=j1
            if j0==0:break
    result=np.empty(n,dtype=int)
    for j in range(1,m+1):result[p[j]-1]=j-1
    return np.arange(n),result

def latlon(vector):
    x,y,z=np.asarray(vector)
    return [float(np.degrees(np.arcsin(np.clip(y,-1,1)))),
            float(np.degrees(np.arctan2(x,z)))]

def run(filename):
    text=(SOURCE/filename).read_text()
    common=text[:text.index("data=json.load")]
    scenario=text.split("# ---------- scenario ----------",1)[1].split("\ndef render",1)[0]
    scenario=scenario.replace("import scipy.optimize as so","")
    namespace={"np":np,"data":json.loads((SOURCE/"ne10.json").read_text()),
               "so":SimpleNamespace(linear_sum_assignment=hungarian)}
    exec(common+"\n"+scenario,namespace)
    source_sites=namespace.get("sites",namespace.get("silo"))
    starts=namespace.get("T0")
    if starts is None:
        starts=[namespace["LAUNCH"]+i*namespace["STAG"] for i in range(namespace.get("NM",2))]
    assignments=namespace.get("ASSIGN",list(range(len(starts))))
    shots=[]
    for i,start in enumerate(starts):
        site_index=assignments[i]
        shots.append({
            "siteIndex":int(site_index),
            "site":[float(x) for x in source_sites[site_index]],
            "target":latlon(namespace["targets"][i]),
            "launchFrame":int(start),
            "durationFrames":int(namespace["DUR"]),
            "peakFactor":float(namespace["PEAK"][i])
        })
    return {
        "id":filename.split("_")[0],
        "source":filename,
        "count":len(shots),
        "siteCount":len(source_sites),
        "totalFrames":int(namespace["F"]),
        "frameDurationMs":70,
        "cameraStart":[float(x) for x in latlon(namespace["cen0"])],
        "cameraInitialPixelsPerEarthRadius":float(namespace["R0"]),
        # Original orthographic follow-camera center and monotone zoom per frame.
        # Source vector axes (x,y,z) map to the carousel's (z,y,-x).
        "cameraFrames":[[round(float(v[2]),9),round(float(v[1]),9),
            round(float(-v[0]),9),round(float(np.exp(log_r)),6)]
            for v,log_r in zip(namespace["CC"],namespace["CR"])],
        "missiles":shots,
        "sourceGroundTrackCrossings":int(namespace["best"][0]) if "best" in namespace else
          (len(namespace["cr"]) if "cr" in namespace else 0),
        "sourceSwapIterations":int(namespace.get("it",0))
    }

def main():
    scenarios=[run(name) for name in
      ("iran_2_icbm.py","nk_10_icbm.py","china_100_icbm.py")]
    OUT.write_text(json.dumps({"earthRadiusKm":6378.137,"scenarios":scenarios},
      separators=(",",":")))
    for s in scenarios:
        print(s["id"],s["count"],"missiles,",s["siteCount"],"sites,",
              s["totalFrames"],"frames,",s["sourceGroundTrackCrossings"],"crossings")
if __name__=="__main__":main()

