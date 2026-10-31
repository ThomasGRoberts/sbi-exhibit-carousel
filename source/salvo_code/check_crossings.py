"""Checks that no two ICBM trails cross in the camera view (NK 10-ICBM scenario)."""
import numpy as np, importlib
m=importlib.import_module('nk_10_icbm')
def ccw(a,b,c): return (c[1]-a[1])*(b[0]-a[0])-(b[1]-a[1])*(c[0]-a[0])
def seg_int(p,q,r,s): return (ccw(p,r,s)*ccw(q,r,s)<0) and (ccw(p,q,r)*ccw(p,q,s)<0)
bad=0
for f in range(0,m.F,6):
    M=m.view(m.CC[f]); R=np.exp(m.CR[f]); L={}
    for k in range(m.NM):
        u=min(max((f-(m.LAUNCH+k*m.STAG))/m.DUR,0),1)
        if u<=0: continue
        ss=np.linspace(0,u,50); tr=np.array([m.ptraj(m.SV[m.ASSIGN[k]],m.targets[k],s,m.PEAK[k]) for s in ss])@M.T
        L[k]=np.stack([R*tr[:,0],-R*tr[:,1]],1)
    ks=list(L)
    for a in range(len(ks)):
        for b in range(a+1,len(ks)):
            i,j=ks[a],ks[b]
            if m.ASSIGN[i]==m.ASSIGN[j]: continue
            for p in range(49):
                for q in range(49):
                    if seg_int(L[i][p],L[i][p+1],L[j][q],L[j][q+1]): bad+=1; print('cross',f,i,j); break
print('total crossings',bad)
