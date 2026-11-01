"""
North Korea: 10 ICBMs from 6 launch sites -> mainland US, Hawaii, and Guam

Renders a transparent animated GIF + animated PNG of the salvo on an orthographic globe
(Natural Earth 10m borders in ne10.json). See README.md.

Usage:
  python nk_10_icbm.py all        # render every frame, write output/*.gif and output/*.png
  python nk_10_icbm.py 0 100 200  # render test frames (y<frame>.png) on a blue backdrop
"""
import json, sys, time, os, numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
S=2; W=600*S; C=W/2
GOLD_D=(176,141,46); GOLD_L=(214,190,120); DARK=(80,80,80); TXT=(147,118,50)
LAND=(247,247,247); LAND_HL=(237,237,237); BORDER=(221,221,221); BORDER_HL=(90,90,90)

def ll(lat,lon):
    la,lo=np.radians(lat),np.radians(lon)
    return np.stack([np.cos(la)*np.sin(lo), np.sin(la), np.cos(la)*np.cos(lo)],-1)
def view(v):
    lat=np.arcsin(v[1]); lon=np.arctan2(v[0],v[2]); y=-lon; t=lat
    Ry=np.array([[np.cos(y),0,np.sin(y)],[0,1,0],[-np.sin(y),0,np.cos(y)]])
    Rx=np.array([[1,0,0],[0,np.cos(t),-np.sin(t)],[0,np.sin(t),np.cos(t)]])
    return Rx@Ry
def slerp(a,b,t):
    w=np.arccos(np.clip(a@b,-1,1))
    if w<1e-9: return a
    return (np.sin((1-t)*w)*a+np.sin(t*w)*b)/np.sin(w)
def nrm(v): return v/np.linalg.norm(v)
def densify(P,step=np.radians(1.0)):
    ang=np.arccos(np.clip((P[:-1]*P[1:]).sum(1),-1,1))
    if (ang<=step).all(): return P
    out=[]
    for i in range(len(P)-1):
        if ang[i]<=step: out.append(P[i])
        else:
            n=int(ang[i]/step)+1
            for k in range(n): out.append(slerp(P[i],P[i+1],k/n))
    out.append(P[-1]); return np.array(out)
def sm(x): x=min(max(x,0),1); return x*x*(3-2*x)

data=json.load(open('ne10.json')); rings=[]
for ft in data['features']:
    p=ft['properties']; name=p.get('ADMIN') or p.get('NAME')
    g=ft['geometry']; polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    hl=name in ('North Korea','United States of America')
    for poly in polys:
        r=np.array(poly[0])
        if len(r)<4: continue
        rings.append((hl,densify(ll(r[:,1],r[:,0]))))
ALL=np.concatenate([r[1] for r in rings]); RID=np.concatenate([np.full(len(r[1]),i) for i,r in enumerate(rings)])
POS=np.concatenate([np.arange(len(r[1])) for r in rings]); LEN=np.array([len(r[1]) for r in rings])[RID]
HL=np.array([r[0] for r in rings]); NR=len(rings)
print('points',len(ALL),flush=True)

# ---------- scenario ----------
sites=[(39.66026497,124.7050276),(40.301111,125.268056),(41.369883,126.913631),(40.483324,126.501814),(39.449886,126.259682),(38.91597,125.92161)]
SV=[ll(a,b) for a,b in sites]
targets=[ll(*t) for t in [(21.3069,-157.8583),(13.4443,144.7937),
  (36,-115),(33,-112),(31,-98),(39,-105),(42,-88),(36,-86),(39,-78),(42,-71)]]
NM=10; PEAK=[0.155]*NM
def ptraj(o,tg,s,pk): return slerp(o,tg,s)*(1+pk*np.sin(np.pi*s)**0.8)
def arcs_cross(a1,a2,b1,b2):
    n1=np.cross(a1,a2); n2=np.cross(b1,b2); d=np.cross(n1,n2)
    if np.linalg.norm(d)<1e-9: return False
    d=d/np.linalg.norm(d)
    for p in (d,-d):
        if (np.cross(a1,p)@n1>0) and (np.cross(p,a2)@n1>0) and (np.cross(b1,p)@n2>0) and (np.cross(p,b2)@n2>0): return True
    return False
CT=np.zeros((6,NM,6,NM),bool)
for s1 in range(6):
    for t1 in range(NM):
        for s2 in range(6):
            for t2 in range(NM):
                if s1!=s2: CT[s1,t1,s2,t2]=arcs_cross(SV[s1],targets[t1],SV[s2],targets[t2])
rngA=np.random.default_rng(3); base_ms=[0,1,1,2,2,3,3,4,4,5]; best=None
for _ in range(60000):
    asg=rngA.permutation(base_ms)
    c=sum(CT[asg[i],i,asg[j],j] for i in range(NM) for j in range(i+1,NM))
    if best is None or c<best[0]: best=(c,asg.copy())
    if c==0: break
ASSIGN=[int(x) for x in best[1]]
print('assignment',ASSIGN,'crossings',best[0],flush=True)
LAUNCH=24; STAG=4; DUR=240; F=LAUNCH+STAG*(NM-1)+DUR+60
cen0=ll(40.2,127.0); R0=4200.0

def head(k,f):
    u=min(max((f-(LAUNCH+k*STAG))/DUR,0.0),1.0)
    return ptraj(SV[ASSIGN[k]],targets[k],u,PEAK[k]) if u>0 else SV[ASSIGN[k]]
def smooth(a,sig=8):
    n=int(sig*3); ker=np.exp(-0.5*(np.arange(-n,n+1)/sig)**2); ker/=ker.sum()
    ap=np.concatenate([np.repeat(a[:1],n,0),a,np.repeat(a[-1:],n,0)],0)
    return np.stack([np.convolve(ap[:,j],ker,'valid') for j in range(a.shape[1])],1)
_cr=[];_cc=[]
for f in range(F):
    pts=SV+[head(k,f) for k in range(NM)]
    m=nrm(sum(nrm(p) for p in pts)); sc=nrm(sum(SV))
    D=max(np.arccos(np.clip(nrm(p)@sc,-1,1)) for p in pts)
    w=sm(1-(D-np.radians(0.15))/np.radians(1.5))
    c=nrm(w*cen0+(1-w)*m)
    pm=max(np.linalg.norm(p-(p@c)*c) for p in pts)
    Rr=min(R0,215/max(pm,1e-6))
    _cc.append(c); _cr.append(np.log(Rr))
_cr=np.minimum.accumulate(np.array(_cr))
CR=smooth(_cr[:,None])[:,0]; CC=np.array([nrm(v) for v in smooth(np.array(_cc))])
print('R start/end',np.exp(CR[0]),np.exp(CR[-1]),flush=True)

def render(f):
    R=np.exp(CR[f])*S; cen=CC[f]
    M=view(cen)
    img=Image.new("RGBA",(W,W),(255,255,255,0)); d=ImageDraw.Draw(img)
    if R>0.8*W: d.rectangle([0,0,W,W],fill=(255,255,255,255))
    else: d.ellipse([C-R,C-R,C+R,C+R],fill=(255,255,255,255))
    stride=max(1,int(round(1500*S/R)))
    sel=np.nonzero((POS%stride==0)|(POS==LEN-1))[0]
    P=ALL[sel]@M.T; rid=RID[sel]
    X=C+R*P[:,0]; Y=C-R*P[:,1]; mg=300*S
    ok=(P[:,2]>0)&(X>-mg)&(X<W+mg)&(Y>-mg)&(Y<W+mg)
    st=np.searchsorted(rid,np.arange(NR),'left'); en=np.searchsorted(rid,np.arange(NR),'right')
    zpos=P[:,2]>0
    for i in range(NR):
        a,b=st[i],en[i]
        if b-a<4 or not zpos[a:b].any(): continue
        Q=P[a:b,:2].copy(); h=~zpos[a:b]
        if h.any(): Q[h]=Q[h]/(np.linalg.norm(Q[h],axis=1,keepdims=True)+1e-9)
        xs=C+R*Q[:,0]; ys=C-R*Q[:,1]
        if xs.max()<-mg or xs.min()>W+mg or ys.max()<-mg or ys.min()>W+mg: continue
        pts=np.clip(np.stack([xs,ys],1),-3*W,4*W)
        d.polygon(pts.ravel().tolist(),fill=LAND_HL if HL[i] else LAND)
    brk=np.nonzero((~ok[:-1])|(~ok[1:])|(rid[:-1]!=rid[1:]))[0]+1
    starts=np.concatenate([[0],brk]); ends=np.concatenate([brk,[len(ok)]])
    XY=np.stack([X,Y],1); hl_runs=[]
    for s,e in zip(starts,ends):
        if e-s>1 and ok[s]:
            if HL[rid[s]]: hl_runs.append((s,e))
            else: d.line(XY[s:e].ravel().tolist(),fill=BORDER,width=S)
    for s,e in hl_runs: d.line(XY[s:e].ravel().tolist(),fill=BORDER_HL,width=int(1.5*S))
    if R<0.8*W*1.5: d.ellipse([C-R,C-R,C+R,C+R],outline=(205,210,215,255),width=2*S)

    glow=Image.new("RGBA",(W,W),GOLD_L+(0,)); g=ImageDraw.Draw(glow)
    ov=Image.new("RGBA",(W,W),DARK+(0,)); o=ImageDraw.Draw(ov)
    fl=Image.new("RGBA",(W,W),(255,225,140,0)); fd=ImageDraw.Draw(fl)
    def pj(v):
        q=v@M.T; return C+R*q[0],C-R*q[1],q
    def vis(q): return q[2]>0 or (q[0]**2+q[1]**2)>1
    base=(3+2.5*sm((R/S-500)/1200))*S
    pulse=0.5+0.5*np.sin(f*0.22)
    for k in range(len(sites)):
        x,y,q=pj(SV[k])
        if q[2]<=0: continue
        if f>=LAUNCH:
            rr=base+1.2*S*pulse; g.ellipse([x-rr*2.2,y-rr*2.2,x+rr*2.2,y+rr*2.2],fill=GOLD_L+(110,))
        g.ellipse([x-base*1.8,y-base*1.8,x+base*1.8,y+base*1.8],fill=GOLD_L+(70,))
        o.ellipse([x-base,y-base,x+base,y+base],fill=GOLD_D+(255,))
    for k in range(NM):
        t0=LAUNCH+k*STAG; u=(f-t0)/DUR
        if u<=0: continue
        uu=min(u,1.0)
        ss=np.linspace(0,uu,70); tr=np.array([ptraj(SV[ASSIGN[k]],targets[k],s_,PEAK[k]) for s_ in ss])@M.T
        XYt=np.stack([C+R*tr[:,0],C-R*tr[:,1]],1); vv=(tr[:,2]>0)|((tr[:,0]**2+tr[:,1]**2)>1)
        for m in range(len(tr)-1):
            if vv[m] and vv[m+1]:
                g.line([tuple(XYt[m]),tuple(XYt[m+1])],fill=GOLD_D+(int(50+205*m/len(tr)),),width=int(2.4*S))
        if uu<1 and vv[-1]:
            x,y=XYt[-1]; r=3*S; g.ellipse([x-r*2,y-r*2,x+r*2,y+r*2],fill=GOLD_L+(170,)); o.ellipse([x-r*.8,y-r*.8,x+r*.8,y+r*.8],fill=GOLD_D+(255,))
        if uu>=1:
            e=(f-(t0+DUR))/24; pt=targets[k]@M.T
            if pt[2]>0:
                x,y=C+R*pt[0],C-R*pt[1]
                if e<1.2:
                    rr=(4+30*e)*S; al=int(max(0,255*(1-e/1.2)))
                    fd.ellipse([x-rr,y-rr,x+rr,y+rr],outline=GOLD_D+(al,),width=2*S)
                    r2=rr*0.5; fd.ellipse([x-r2,y-r2,x+r2,y+r2],fill=(255,225,140,al//2))
                r=3.5*S; o.ellipse([x-r,y-r,x+r,y+r],fill=GOLD_D+(235,))
    blur=glow.filter(ImageFilter.GaussianBlur(4*S))
    img=Image.alpha_composite(img,fl.filter(ImageFilter.GaussianBlur(4*S))); img=Image.alpha_composite(img,fl)
    img=Image.alpha_composite(img,blur); img=Image.alpha_composite(img,glow); img=Image.alpha_composite(img,ov)
    # text
    lay=Image.new("RGBA",(W,W),(0,0,0,0)); ld=ImageDraw.Draw(lay)
    img=Image.alpha_composite(img,lay)
    return img.resize((600,600),Image.LANCZOS)

if __name__=="__main__":
    if len(sys.argv)>1 and sys.argv[1]!="all":
        for f in map(int,sys.argv[1:]):
            t=time.time(); im=render(f); bg=Image.new("RGBA",im.size,(200,215,230,255)); bg.alpha_composite(im); bg.convert("RGB").save(f"y{f}.png"); print(f,round(time.time()-t,1),flush=True)
    else:
        os.makedirs("fr6",exist_ok=True); os.makedirs("output",exist_ok=True)
        for f in range(F):
            if not os.path.exists(f"fr6/{f:04d}.png"): render(f).save(f"fr6/{f:04d}.png")
            if f%20==0: print('frame',f,'of',F,flush=True)
        frames=[Image.open(f"fr6/{f:04d}.png").convert("RGBA") for f in range(F)]
        frames[0].save("output/salvo_NK_10_follow2.png",save_all=True,append_images=frames[1:],duration=70,loop=0,disposal=1)
        out=[]
        for fr in frames:
            a=fr.split()[3]; bg=Image.new("RGB",fr.size,(255,255,255)); bg.paste(fr.convert("RGB"),mask=a)
            p=bg.convert("P",palette=Image.ADAPTIVE,colors=255); p.paste(255,a.point(lambda v:255 if v<128 else 0)); out.append(p)
        out[0].save("output/salvo_NK_10_follow2.gif",save_all=True,append_images=out[1:],duration=70,loop=0,transparency=255,disposal=2)
        print('done',F,flush=True)
