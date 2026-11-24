"""Numerical helpers for ROI lighting experiments, independent of production."""
import numpy as np

def sample(a,p,lo,hi):
    n=np.array(a.shape[:3][::-1],np.float32)
    u=np.clip((p-lo)/(hi-lo)*n-.5,0,n-1)
    idx=np.floor(u).astype(np.int32);t=u-idx;out=np.zeros(p.shape[:-1],np.float32)
    for z in (0,1):
        for y in (0,1):
            for x in (0,1):
                k=np.minimum(idx+np.array([x,y,z]),n.astype(np.int32)-1)
                out+=a[k[...,2],k[...,1],k[...,0]]*(t[...,0] if x else 1-t[...,0])*(t[...,1] if y else 1-t[...,1])*(t[...,2] if z else 1-t[...,2])
    return out

def weight(p,lo,hi,feather=.025):
    t=np.clip(np.minimum(p-lo,hi-p)/feather,0,1)
    return np.prod(t*t*(3-2*t),axis=-1)

def sigma_at(base,fine,p,lo,hi,enabled=True):
    a=sample(base,p,np.full(3,-1.3),np.full(3,1.3))
    if enabled:
        w=weight(p,lo,hi);a=a*(1-w)+sample(fine,p,lo,hi)*w
    return a

def trace(base,fine,points,light,lo,hi,steps=128,enabled=True):
    d=np.asarray(light,np.float32)-points;distance=np.linalg.norm(d,axis=-1);tau=np.zeros(distance.shape,np.float32)
    for j in range(steps):
        tau+=sigma_at(base,fine,points+d*((j+.5)/steps),lo,hi,enabled)*distance/steps
    return tau

def transfer_factor(sigma,ds):
    # Stable Beer-Lambert source integral, including faint nonzero extinction.
    return np.where(sigma>1e-6,-np.expm1(-sigma*ds)/np.maximum(sigma,1e-6),ds)

def normalize(v):
    norm=np.linalg.norm(v,axis=-1,keepdims=True)
    return np.where(norm>1e-9,v/np.maximum(norm,1e-9),np.array([0,0,1],np.float32))
