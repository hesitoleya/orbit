#!/usr/bin/env python3
"""Original deterministic 3D nebula media; NumPy/Pillow only, no downloaded imagery.

Volume arrays are [z,y,x,channel], x fastest, local [-1.3,1.3]^3.
Hero media256³ with light/shading128³; five other families160³. Per-file dimensions authoritative.
RGB is LINEAR gas emissivity divided by per-profile emissionScale4/8/16, independent from A.
A is extinction divided by sigmaMax12. Light RGB is incident irradiance /4,
NOT already scattered radiance. Hero light A is reserved zero.
The densities, spectra and shape compositions are artistic mathematical originals,
NOT measured/reconstructed target volumes. See manifest and process notes.
"""
from pathlib import Path
import argparse, gzip, hashlib, json, time
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'public/data/cinematic-nebula'
DOMAIN=1.3
N=160
F=np.float32

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

def grid(n,extent=DOMAIN):
    # GPU normalized texture coordinates address texel CENTRES, not endpoints.
    a=((np.arange(n,dtype=F)+.5)/F(n)*F(2*extent)-F(extent))
    z,y,x=np.meshgrid(a,a,a,indexing='ij')
    return x,y,z

def hash3(ix,iy,iz,seed):
    with np.errstate(over='ignore'):
        h=ix.astype(np.uint32)*np.uint32(1597334677)^iy.astype(np.uint32)*np.uint32(3812015801)^iz.astype(np.uint32)*np.uint32(2798796415)^np.uint32(seed)
        h^=h>>np.uint32(16);h*=np.uint32(2246822519);h^=h>>np.uint32(13);h*=np.uint32(3266489917);h^=h>>np.uint32(16)
    return (h.astype(F)/F(4294967295))

def noise(x,y,z,freq,seed):
    # Smooth lattice value field; every sample and octave is truly volumetric.
    x=x*F(freq)+F(43.271);y=y*F(freq)+F(19.113);z=z*F(freq)+F(71.831)
    ix=np.floor(x).astype(np.int32);iy=np.floor(y).astype(np.int32);iz=np.floor(z).astype(np.int32)
    tx=x-ix;ty=y-iy;tz=z-iz
    tx=(tx*tx*tx*(tx*(tx*6-15)+10)).astype(F)
    ty=(ty*ty*ty*(ty*(ty*6-15)+10)).astype(F)
    tz=(tz*tz*tz*(tz*(tz*6-15)+10)).astype(F)
    out=np.zeros(x.shape,dtype=F)
    for dz in (0,1):
        wz=tz if dz else 1-tz
        for dy in (0,1):
            wy=ty if dy else 1-ty
            for dx in (0,1):
                wx=tx if dx else 1-tx
                out+=hash3(ix+dx,iy+dy,iz+dz,seed)*wx*wy*wz
    return out

def fbm(x,y,z,seed,base=1.6,octaves=5):
    out=np.zeros(x.shape,dtype=F);weight=1.;total=0.
    for o in range(octaves):
        out+=F(weight)*(noise(x,y,z,base*2**o,seed+o*101)-.5)
        total+=weight;weight*=.53
    return out/F(total)

def ell(x,y,z,c,s):
    return np.sqrt(((x-c[0])/s[0])**2+((y-c[1])/s[1])**2+((z-c[2])/s[2])**2)

def segment(x,y,z,a,b,r0,r1):
    d=np.array(b,dtype=F)-a
    t=np.clip(((x-a[0])*d[0]+(y-a[1])*d[1]+(z-a[2])*d[2])/np.dot(d,d),0,1)
    r=r0+(r1-r0)*t
    return np.sqrt((x-a[0]-t*d[0])**2+(y-a[1]-t*d[1])**2+(z-a[2]-t*d[2])**2)-r

def triangle_parity(tri,n,extent=DOMAIN):
    """Triangle/ray intersections at XY texel centres, even/odd Z intervals.
    Unlike span hulls, each separate enter/exit pair preserves cavities and gaps.
    Shared-edge coincident hits are deduplicated, never treated as extra surfaces.
    """
    voxel=F(2*extent/n);hits=[];pixels=[]
    for chunk in np.array_split(tri,max(1,len(tri)//16000)):
        a=chunk[:,0];e=chunk[:,1]-a;f=chunk[:,2]-a
        det=e[:,0]*f[:,1]-e[:,1]*f[:,0]
        good=np.abs(det)>1e-12;a=a[good];e=e[good];f=f[good];det=det[good]
        if not len(a):continue
        xyz=np.stack([a,a+e,a+f],axis=1)
        lo=np.ceil((xyz[:,:,:2].min(axis=1)+extent)/voxel-.5).astype(np.int32)
        hi=np.floor((xyz[:,:,:2].max(axis=1)+extent)/voxel-.5).astype(np.int32)
        lo=np.clip(lo,0,n-1);hi=np.clip(hi,-1,n-1)
        widths=np.maximum(0,hi-lo+1);counts=widths[:,0]*widths[:,1]
        total=int(counts.sum())
        if not total:continue
        ids=np.repeat(np.arange(len(a)),counts)
        off=np.arange(total)-np.repeat(np.cumsum(counts)-counts,counts)
        px=lo[ids,0]+off%widths[ids,0];py=lo[ids,1]+off//widths[ids,0]
        dx=(px+.5)*voxel-extent-a[ids,0];dy=(py+.5)*voxel-extent-a[ids,1]
        u=(dx*f[ids,1]-dy*f[ids,0])/det[ids];v=(e[ids,0]*dy-e[ids,1]*dx)/det[ids]
        mask=(u>=-1e-7)&(v>=-1e-7)&(u+v<=1.0000001)
        pixels.append((py[mask]*n+px[mask]).astype(np.int32))
        hits.append((a[ids[mask],2]+u[mask]*e[ids[mask],2]+v[mask]*f[ids[mask],2]).astype(F))
    if not hits:raise ValueError('Mesh has no ray intersections')
    pixel=np.concatenate(pixels);depth=np.concatenate(hits);order=np.lexsort((depth,pixel));pixel=pixel[order];depth=depth[order]
    keep=np.r_[True,(pixel[1:]!=pixel[:-1])|(np.abs(np.diff(depth))>voxel*1e-4)]
    pixel=pixel[keep];depth=depth[keep]
    starts=np.r_[0,np.flatnonzero(np.diff(pixel))+1];ends=np.r_[starts[1:],len(pixel)]
    odd=(ends-starts)%2==1
    # An open/nonmanifold ray is explicitly excluded rather than hull-filled.
    bad=np.repeat(odd,ends-starts);pixel=pixel[~bad];depth=depth[~bad]
    starts=np.r_[0,np.flatnonzero(np.diff(pixel))+1]
    ranks=np.arange(len(pixel))-np.repeat(starts,np.diff(np.r_[starts,len(pixel)]))
    begin=(ranks%2)==0
    p=pixel[begin];z0=depth[begin];z1=depth[~begin]
    iz0=np.clip(np.ceil((z0+extent)/voxel-.5).astype(np.int32),0,n)
    iz1=np.clip(np.ceil((z1+extent)/voxel-.5).astype(np.int32),0,n)
    delta=np.zeros((n+1,n*n),dtype=np.int16)
    np.add.at(delta,(iz0,p),1);np.add.at(delta,(iz1,p),-1)
    inside=(np.cumsum(delta,axis=0)[:-1]>0).reshape(n,n,n)
    return inside,{'intersectionCount':int(len(depth)),'oddRaysExcluded':int(odd.sum()),'raysHit':int(len(ends)),'intervalPairs':int(len(p))}

def distance_to_boundary(inside):
    """Metric 26-neighbour chamfer distance, converged tiled Gauss-Seidel.
    Local physical units, not a smoothed binary-occupancy surrogate. Boundary
    seeds lie half a voxel from a transition. Sweeps propagate whole scanlines.
    """
    n=inside.shape[0];voxel=F(2*DOMAIN/n)
    boundary=np.zeros_like(inside)
    for axis in range(3):
        sl0=[slice(None)]*3;sl1=sl0.copy();sl0[axis]=slice(1,None);sl1[axis]=slice(None,-1)
        change=inside[tuple(sl0)]!=inside[tuple(sl1)];boundary[tuple(sl0)]|=change;boundary[tuple(sl1)]|=change
    d=np.where(boundary,F(.5),F(n*3))
    # Each Z plane update includes all X/Y8 neighbours in adjacent planes, and
    # four directed in-plane sweeps provide monotone metric propagation.
    for iteration in range(3):
        for reverse in (False,True):
            indices=range(n-1,-1,-1) if reverse else range(n);step=1 if reverse else -1
            for k in indices:
                prev=k+step
                if 0<=prev<n:
                    pad=np.pad(d[prev],1,constant_values=n*3)
                    for dy in (-1,0,1):
                        for dx in (-1,0,1):d[k]=np.minimum(d[k],pad[1+dy:1+dy+n,1+dx:1+dx+n]+F(np.sqrt(1+dx*dx+dy*dy)))
                # Exact 1D L1 transforms on rows/columns accelerate long distances.
                for axis in (0,1):
                    a=d[k];index=np.arange(n,dtype=F).reshape((n,1) if axis==0 else (1,n))
                    a=np.minimum.accumulate(a-index,axis=axis)+index
                    a=np.flip(np.minimum.accumulate(np.flip(a+index,axis=axis),axis=axis),axis=axis)-index
                    d[k]=a
    return np.where(inside,-d,d)*voxel

def mesh_seed(path,n=N):
    raw=Path(path).read_bytes();count=int.from_bytes(raw[80:84],'little')
    if len(raw)!=84+50*count:raise ValueError('Only complete binary STL is accepted')
    dtype=np.dtype([('normal','<f4',(3,)),('v','<f4',(3,3)),('attr','<u2')])
    tri=np.frombuffer(raw,offset=84,dtype=dtype,count=count)['v'].copy()
    vertices=tri.reshape(-1,3);lo=vertices.min(axis=0);hi=vertices.max(axis=0)
    tri=(tri-(lo+hi)/2)[:,:,[0,2,1]].copy();tri[:,:,2]*=-1
    tri*=F(2.10/np.max(hi-lo));tri[:,:,1]-=.06
    print('  STL: exact parity intersections',flush=True)
    solid,stats=triangle_parity(tri,n)
    print('  STL: metric surface distance',stats,flush=True)
    if stats['oddRaysExcluded']>max(16,stats['raysHit']*.01):raise ValueError('Open mesh parity excludes >1% rays; inspect source rather than hull fill')
    sdf=distance_to_boundary(solid)
    canvas=Image.new('RGB',(960,344),(7,10,15));draw=ImageDraw.Draw(canvas)
    for i,(axis,label) in enumerate([(0,'XY front +Z'),(1,'XZ'),(2,'YZ')]):
        panel=np.max(solid,axis=axis);im=Image.fromarray(np.flipud(to8(panel)),'L').convert('RGB').resize((320,320),Image.Resampling.NEAREST)
        canvas.paste(im,(i*320,24));draw.text((i*320+8,6),'NASA parity seed '+label,fill=(210,220,230))
    canvas.save(OUT/'pillars-mesh-seed-projections.png')
    return sdf,{'sourceFile':str(Path(path).resolve().relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(raw).hexdigest(),'triangles':count,'transformation':'local=(sourceX,sourceZ,-sourceY), center sourcebounds, uniform2.10/maxextent scale, localYoffset-.06','voxelization':'Triangle-ray intersections at texel centers; deduplicated exact crossing pairs; parity fill, no hull spans; metric26-neighbour surface distance. Surface geometry from source, gas density artistic.',**stats}

MESH_PATH=None
MESH_META=None

def field(profile,n=N,seed=0):
    x,y,z=grid(n)
    print(f'  {profile}: domain warp {n}^3',flush=True)
    warp=[fbm(x,y,z,seed+k*337,base=1.5,octaves=3) for k in range(3)]
    wx=x+.27*warp[0];wy=y+.23*warp[1];wz=z+.23*warp[2]
    broad=fbm(wx,wy,wz,seed+4703,base=2.3,octaves=5)
    # Sheared anisotropic sheets and ridged clustered small-scale structure.
    flow=fbm(wx*.72+wy*.31,wy*1.4,wz*.9-wx*.25,seed+803,base=4,octaves=4)
    fine=noise(wx,wy,wz,48,seed+2909)
    finer=noise(wx,wy,wz,74,seed+3301)
    ridges=np.exp(-np.abs(flow)*17)
    clumps=np.exp(2.8*broad+1.25*(fine-.5)+.65*(finer-.5))
    texture=(.22+.95*ridges)*clumps
    sheetNoise=(noise(wx*.7,wy*1.4,wz*2.2,12,seed+601)-.5)
    radial=np.sqrt(x*x+y*y+z*z)
    boundary=1-smooth(1.12,1.29,np.maximum.reduce([np.abs(x),np.abs(y),np.abs(z)]))
    gas=np.zeros(x.shape,dtype=F);dust=gas.copy();ion=gas.copy()
    if profile=='orion':
        # Folded ionization walls around a lopsided open bowl; not Gaussian balls.
        bowl=-.36+.35*wx+.40*wy*wy+.22*np.sin(2.5*wx+1.1*wy)+.30*broad
        dist=wz-bowl
        # OPEN lopsided blister: a corrugated emitting sheet, never a sphere cut
        # into a closed limb-brightened donut. Irregular bat-wing support is XY.
        spanY=.38+.30*np.exp(-((wx+.26)/.60)**2)+.14*np.sin(2.8*wx)
        spine=-.08+.26*np.sin(2.9*wx-.4)+.21*wx+.20*warp[1]
        support=(1-smooth(spanY*.65,spanY,np.abs(wy-spine)))
        support*=1-smooth(.78,1.2,np.abs(wx+.06))
        wall=np.exp(-(dist/(.045+.035*(broad+.4)))**2)*support
        # Bright open ionization break; strongest at the Trapezium intersection,
        # with two fading, curved wings instead of nested radial cavity walls.
        frontY=.11-.42*wx+.24*np.sin(2.4*wx)+.18*warp[1]
        front=np.exp(-((wy-frontY)/(.050+.020*(fine+.1)))**2)
        front*=np.exp(-((wz+.18-.29*wx-.16*broad)/.115)**2)
        front*=1-smooth(.66,1.12,np.abs(wx+.08))
        core=ell(wx,wy,wz,(-.12,.14,-.12),(.11,.10,.18))
        core=np.exp(-core*core*1.8)
        # A broad tapered veil separated in depth, with flowing jagged wisps.
        veil=np.exp(-((wz+.68-.21*np.sin(3*wx+wy)-.22*broad)/.045)**2)
        veil*=smooth(-.06,.58,wy+.15)*(1-smooth(.62,1.15,np.abs(wx+.18)))
        veil*=1-smooth(.75,1.18,wy-.20*wx)
        # High-resolution intermittent sheets: fine ridges occupy thin strands,
        # rather than a continuous broad low-contrast blanket of glowing fog.
        strandField=fbm(wx*.82+wy*.27,wy*1.75-wz*.19,wz*.63+wx*.21,seed+8411,base=9,octaves=3)
        filament=np.exp(-np.abs(strandField+.24*flow)*42)*smooth(-.12,.19,broad+.18)
        voids=smooth(-.10,.17,flow+.32*broad)
        thinTexture=clumps*(.06+.32*ridges+2.8*filament)*(.12+.88*voids)
        gas=(wall*.68+front*1.45+veil*.29)*thinTexture+core*.95*clumps
        darkLane=np.exp(-((wy+.18-.31*np.sin(2.7*wx)-.22*warp[1])/.065)**2)
        darkLane*=np.exp(-((wz-.08-.29*wx)/.14)**2)
        edgeRidge=np.exp(-((wy-spine+spanY*.65)/.085)**2)*np.exp(-((dist-.07)/.07)**2)
        dust=(edgeRidge*.40+darkLane*.94)*clumps*(.25+1.4*ridges)*support
        ion=smooth(-.12,.19,wy-frontY+.14)+core*.35
        ion=np.clip(ion,0,1)
        warm=np.array([1.0,.20,.036],dtype=F);cool=np.array([.065,.66,1.0],dtype=F)
        rgb=gas[...,None]*(warm[None,None,None,:]*(1-ion[...,None])+cool[None,None,None,:]*ion[...,None])
        rgb+=core[...,None]*np.array([.08,.20,.30],dtype=F)
        sigma=.07*gas+3.6*dust
    elif profile=='pillars':
        # Branching erosion-defined trunks, not three regular cylinders.
        sdf=np.full(x.shape,10,dtype=F)
        branches=[((-.61,-1.08,-.03),(-.43,.30,.03),.26,.13),
          ((-.43,-.1,.03),(-.66,.58,-.04),.15,.095),
          ((-.43,.14,.03),(-.23,.52,.10),.12,.10),
          ((-.07,-1.13,-.13),(.02,.64,-.08),.26,.14),
          ((-.01,.12,-.08),(.24,.39,-.12),.15,.09),
          ((.44,-1.12,.04),(.49,.16,.13),.22,.12),
          ((.47,-.17,.12),(.68,.42,.16),.12,.085),
          ((.48,.04,.13),(.34,.36,.09),.10,.075)]
        for a,b,r0,r1 in branches:
            sdf=np.minimum(sdf,segment(wx+.06*warp[1],wy,wz,a,b,r0,r1))
        global MESH_META
        if MESH_PATH:
            mesh,MESH_META=mesh_seed(MESH_PATH,n)
            # Warped local sampling retains the supplied asymmetric four-pillar
            # silhouette; extinction and eroded gas remain independently original.
            sdf=sample(mesh,x+.035*warp[0],y+.025*warp[1],z+.035*warp[2])
        # Aperiodic erosion, anisotropic fine channels; never horizontal sine ribs.
        channels=fbm(wx*.72+wy*.33,wy*.40-wz*.18,wz*1.8+wx*.21,seed+7187,base=11,octaves=3)
        erosion=.023*flow+.019*(fine-.5)+.012*(finer-.5)+.025*channels
        sdf+=erosion
        # Jagged narrow wisps peel away toward the irradiating upper left.
        peel=np.exp(-((wx+.35*wy+.10*np.sin(8*wy)+.14)/.035)**2)*np.exp(-((wz-.10-.2*warp[0])/.12)**2)
        peel*=smooth(-.55,.35,wy)*(1-smooth(.7,1.05,wy))
        solid=1-smooth(-.022,.018,sdf)
        shell=np.exp(-((sdf-.012)/.016)**2)
        # Finite differencing of warped signed field gives erosion-facing emission.
        gz,gy,gx=np.gradient(sdf,2*DOMAIN/n)
        # Gradient-facing physical illumination, NOT camera-facing shading.
        lx=-.85-wx;ly=1.12-wy;lz=.95-wz
        den=np.sqrt(gx*gx+gy*gy+gz*gz+.01)*np.sqrt(lx*lx+ly*ly+lz*lz+.01)
        lit=np.clip((gx*lx+gy*ly+gz*lz)/den,0,1)
        outer=np.exp(-((sdf-.026)/.020)**2)
        intermittency=smooth(-.16,.13,channels+.32*flow)
        gas=outer*(.18+2.2*lit)*(.15+2.6*ridges)*clumps*(.28+1.3*intermittency)+peel*.7*texture
        skyfront=np.exp(-((wz+.67-.13*np.sin(3*wx+wy)-.10*broad)/.09)**2)
        gas+=skyfront*.18*texture
        dust=solid*(.55+.45*clumps)+shell*.10*clumps
        sigma=5.3*dust+.035*gas
        # Gold ionized rim sits OUTSIDE opaque dust, preserving source at firsthit.
        rgb=gas[...,None]*np.array([1.,.58,.16],dtype=F)
        rgb+=outer[...,None]*lit[...,None]*clumps[...,None]*np.array([.14,.22,.25],dtype=F)
        rgb+=skyfront[...,None]*texture[...,None]*np.array([.05,.17,.30],dtype=F)
    elif profile in ('ring','remnant','bipolar','helix'):
        # Expanding gas families use warped 3D sheet intersections and independent
        # filaments, never sampled photographs or a camera-space radial texture.
        az=np.arctan2(wy,wx);rxy=np.sqrt(wx*wx+wy*wy)
        def ridge_shell(radius,width,shape):
            phase=shape+(.035+.065*ridges)*np.sin(7*wx-5*wy+3*wz)+.14*broad
            return np.exp(-((phase-radius)/width)**2)
        if profile=='ring':
            bend=.065*np.sin(3*az)+.045*np.sin(7*az+.8)+.11*broad
            tube=np.sqrt(((rxy-.60-bend)/1.0)**2+((wz+.07*np.sin(2*az))/.78)**2)
            torus=np.exp(-(tube/(.11+.07*(flow+.3)))**2)
            # An inner ragged skin and several weak lobed expanding veils.
            inner=np.exp(-((tube-.055)/.028)**2)
            halo=ridge_shell(.98,.025,np.sqrt((wx*1.05)**2+(wy*.92)**2+(wz*.72)**2))
            halo*=smooth(-.2,.4,flow+.25)*(.2+.8*ridges)
            angular=.6+.20*np.sin(5*az)+.15*np.sin(9*az+.7)
            gas=(torus*(.5+1.6*ridges)*clumps*angular+halo*.16)
            ion=1-smooth(.49,.69,rxy)
            rgb=gas[...,None]*(ion[...,None]*np.array([.08,.9,1.0],dtype=F)+(1-ion[...,None])*np.array([1.,.18,.13],dtype=F))
            rgb+=inner[...,None]*clumps[...,None]*np.array([.055,.11,.10],dtype=F)
            sigma=torus*.32*clumps+.06*halo
        elif profile=='remnant':
            r=np.sqrt((wx/.91)**2+(wy/1.05)**2+(wz/.86)**2)
            shell=ridge_shell(.77,.055,r)
            # Intersect warped waves: tangled branching thin strands in 3D.
            phase1=np.sin(22*wx+13*wy-9*wz+7*flow)
            phase2=np.sin(17*wy-25*wz+11*wx+9*broad)
            strands=np.exp(-np.abs(phase1)*12)+np.exp(-np.abs(phase2)*15)
            knot=smooth(.47,.83,fine)*smooth(.42,.78,finer)
            broken=smooth(-.24,.08,flow+broad*.55)
            gas=shell*(.045+strands*1.7+knot*1.4)*broken*clumps
            # Inner non-hollow synchrotron haze remains faint and fibrous.
            haze=np.exp(-(r/.64)**4)*(.15+.8*ridges)*(.11+.3*np.maximum(0,broad))
            warm=smooth(-.25,.23,wx+.4*wy+.7*broad)
            rgb=gas[...,None]*(warm[...,None]*np.array([1.,.24,.08],dtype=F)+(1-warm[...,None])*np.array([.10,.70,1.],dtype=F))
            rgb+=haze[...,None]*np.array([.045,.15,.20],dtype=F)
            sigma=.20*gas+.10*haze
        elif profile=='bipolar':
            radial=np.sqrt((wx/.92)**2+(wz/.85)**2)
            width=.22+.36*smooth(.06,.53,np.abs(wy))
            lobes=np.sqrt((radial/width)**2+((np.abs(wy)-.42)/.39)**2)
            shell=ridge_shell(1.,.13,lobes)
            unequal=.65+.25*np.sin(4*wx+3*wy)+.18*np.sin(7*wz-wy)
            holes=1-smooth(.20,.43,noise(wx,wy,wz,6,seed+91))*.7
            waist=np.exp(-(wy/.085)**2)*np.exp(-(radial/.35)**2)
            gas=shell*(.22+1.55*ridges)*clumps*unequal*holes
            # Unequal nested little cells and veil fragments within broad lobes.
            cell=ridge_shell(.48,.045,np.sqrt((wx+.12)**2+(wy-.35)**2+(wz+.08)**2))
            gas+=.22*cell*texture
            ion=1-smooth(.15,.60,radial)
            rgb=gas[...,None]*(ion[...,None]*np.array([.08,.9,.96],dtype=F)+(1-ion[...,None])*np.array([1.,.18,.10],dtype=F))
            sigma=.36*gas+waist*1.1*clumps
        else:
            # Oblique thick helix with offaxis inner skin and cometary knots.
            r=np.sqrt((wx/1.03)**2+(wy/.84)**2+((wz+.16*wx)/.58)**2)
            shell=ridge_shell(.75,.12,r)
            inner=ridge_shell(.52,.045,np.sqrt(((wx+.10)/1.04)**2+((wy-.04)/.85)**2+((wz+.15*wx)/.68)**2))
            radialflow=np.sin(az*34+12*broad+5*wz)
            knots=np.exp(-np.abs(radialflow)*16)*smooth(.2,.72,fine)
            shell*=.50+1.25*ridges+knots*.9
            gas=(shell*.76+inner*.28)*clumps
            ion=1-smooth(.40,.77,rxy)
            rgb=gas[...,None]*(ion[...,None]*np.array([.06,.78,1.0],dtype=F)+(1-ion[...,None])*np.array([1.0,.16,.07],dtype=F))
            sigma=.36*shell*clumps+knots*.45*np.exp(-((r-.64)/.16)**2)
    else:
        # Sculpt a torn dust cliff plus irregular rising neck/head. It is a volume
        # with a broad slab and tangled edges, not a pristine horse-shaped cutout.
        cliffY=-.68+.13*np.sin(3.4*wx)+.16*broad+.08*np.sin(9*wx+2*wz)
        cliff=np.maximum(wy-cliffY,np.abs(wz-.12)-.24)
        neck=segment(wx,wy,wz,(-.30,-.64,.10),(-.10,.34,.11),.27,.15)
        head=ell(wx,wy,wz,(.06,.34,.10),(.29,.21,.24))-1
        head*=.22
        snout=segment(wx,wy,wz,(.10,.32,.13),(.47,.25,.18),.17,.105)
        ear=segment(wx,wy,wz,(-.05,.41,.09),(-.11,.69,.10),.11,.055)
        sdf=np.minimum.reduce([cliff,neck,head,snout,ear])
        # Blunt asymmetry, cross-flow notches and multifractal erosion destroy toy edges.
        sdf+=.075*broad+.052*flow+.028*(fine-.5)+.017*(finer-.5)
        bite=ell(wx,wy,wz,(-.39,.30,.18),(.22,.19,.4))
        sdf=np.maximum(sdf,(1-bite)*.13)
        solid=1-smooth(-.055,.04,sdf)
        fringe=np.exp(-((sdf-.045)/.05)**2)*ridges*clumps
        filament=np.exp(-((wx+.28-.35*wy-.17*np.sin(5*wy))/.055)**2)
        filament*=np.exp(-((wz+.03-.14*warp[2])/.12)**2)*smooth(.22,.7,wy)*(1-smooth(.85,1.19,wy))
        sigma=8.8*solid*(.58+.42*clumps)+1.2*fringe+.65*filament
        # Three nonplanar independently warped hydrogen sheets at separated depths.
        gas=np.zeros(x.shape,dtype=F)
        for k,(dep,amp,freq) in enumerate([(-.44,.49,3.8),(-.70,.26,5.1),(-.91,.17,2.5)]):
            curl=.11*np.sin(freq*wx+1.4*wy)+.095*np.sin(4*wy-2*wx)+.20*warp[k]
            sheet=np.exp(-((wz-dep-curl)/(.045+.025*(broad+.5)))**2)
            sheet*=1-smooth(.87,1.25,np.sqrt((wx*.88)**2+(wy*.83)**2))
            gas+=amp*sheet*(.20+1.9*ridges)*clumps
        gas+=.14*fringe+.13*filament
        rgb=gas[...,None]*np.array([1.0,.070,.038],dtype=F)
        rgb+=fringe[...,None]*np.array([.028,.012,.003],dtype=F)
    rgb*=boundary[...,None];sigma*=boundary
    # Clamp outliers only; fixed sigmaMax avoids per-profile silent density remaps.
    rgb=np.maximum(rgb,0).astype(F);sigma=np.clip(sigma,0,12).astype(F)
    print(f'  {profile}: sigma max {sigma.max():.3f}, p99 {np.percentile(sigma,99):.3f}; emission max {rgb.max():.3f}',flush=True)
    return rgb,sigma

def sample(a,x,y,z,extent=DOMAIN):
    n=a.shape[0]
    u=(x+extent)*F(n/(2*extent))-.5;v=(y+extent)*F(n/(2*extent))-.5;w=(z+extent)*F(n/(2*extent))-.5
    valid=(x>=-extent)&(y>=-extent)&(z>=-extent)&(x<=extent)&(y<=extent)&(z<=extent)
    upper=np.nextafter(F(n-1),F(0))
    u=np.clip(u,0,upper);v=np.clip(v,0,upper);w=np.clip(w,0,upper)
    ix=u.astype(np.int32);iy=v.astype(np.int32);iz=w.astype(np.int32)
    tx=u-ix;ty=v-iy;tz=w-iz
    result=np.zeros(x.shape,dtype=F)
    for dz in (0,1):
        for dy in (0,1):
            for dx in (0,1):
                result+=a[iz+dz,iy+dy,ix+dx]*(tx if dx else 1-tx)*(ty if dy else 1-ty)*(tz if dz else 1-tz)
    return result*valid

LIGHTS={
 'orion':[{'position':[-.12,.18,.10],'color':[.48,.75,1.0],'power':1.8},{'position':[.23,-.10,-.10],'color':[.75,.85,1.0],'power':.65},{'position':[-.27,.28,-.12],'color':[1.,.55,.26],'power':.45}],
 'pillars':[{'position':[-.85,1.12,.95],'color':[1.0,.78,.40],'power':3.8},{'position':[.7,.8,-.4],'color':[1.,.38,.13],'power':.40},{'position':[-.4,-.1,-.9],'color':[.32,.45,1.0],'power':.14}],
 'ring':[{'position':[.04,.02,.08],'color':[.35,.75,1.0],'power':1.2},{'position':[-.3,.3,-.6],'color':[1.,.25,.10],'power':.25},{'position':[.55,-.4,.5],'color':[.65,.75,1.0],'power':.1}],
 'remnant':[{'position':[-.02,.04,.03],'color':[.3,.75,1.0],'power':1.4},{'position':[.55,.35,-.3],'color':[1.,.38,.12],'power':.5},{'position':[-.5,-.4,.2],'color':[1.,.15,.08],'power':.3}],
 'bipolar':[{'position':[0,.0,.0],'color':[.25,.7,1.0],'power':1.5},{'position':[-.3,.7,-.4],'color':[1.,.3,.14],'power':.35},{'position':[.2,-.6,.3],'color':[.5,.9,1.0],'power':.25}],
 'helix':[{'position':[.06,.0,.04],'color':[.25,.75,1.0],'power':1.3},{'position':[-.45,.4,-.5],'color':[1.,.2,.1],'power':.3},{'position':[.6,-.3,.2],'color':[1.,.4,.12],'power':.2}],
 'horsehead':[{'position':[-.75,.85,-.65],'color':[1.,.25,.10],'power':1.8},{'position':[.80,.35,-.85],'color':[1.,.15,.07],'power':.8},{'position':[-.35,1.1,.60],'color':[.45,.65,1.0],'power':.24}]
}

def oct_encode(v):
    v=v/np.maximum(np.sum(np.abs(v),axis=-1,keepdims=True),1e-12)
    xy=v[...,:2].copy();fold=(1-np.abs(xy[...,::-1]))*np.where(xy>=0,1.,-1.)
    xy=np.where((v[...,2]<0)[...,None],fold,xy)
    return to8(xy*.5+.5)

def illumination(sigma,profile):
    hero=profile in ('orion','pillars');resolution=128 if hero else 64;steps=40 if hero else 20
    x,y,z=grid(resolution);light=np.zeros(x.shape+(3,),dtype=F);moment=np.zeros_like(light)
    for li,l in enumerate(LIGHTS[profile]):
        print(f'  {profile}: shadow light {li+1}/3',flush=True)
        dx=l['position'][0]-x;dy=l['position'][1]-y;dz=l['position'][2]-z
        dist=np.sqrt(dx*dx+dy*dy+dz*dz);tau=np.zeros(x.shape,dtype=F)
        for j in range(steps):
            t=F((j+.5)/steps)
            tau+=sample(sigma,x+dx*t,y+dy*t,z+dz*t)*dist/F(steps)
        intensity=l['power']*np.exp(-np.minimum(tau,30))/(.45+dist*dist)
        radiance=intensity[...,None]*np.array(l['color'],dtype=F);light+=radiance
        weight=np.sum(radiance*np.array([.2126,.7152,.0722],dtype=F),axis=-1)
        moment+=np.stack([-dx,-dy,-dz],axis=-1)*((weight/np.maximum(dist,1e-6))[...,None])
    light+=np.array([.035,.042,.055],dtype=F)
    if hero:
        spacing=2*DOMAIN/sigma.shape[0];gz,gy,gx=np.gradient(sigma,spacing)
        normal=-np.stack([sample(gx,x,y,z),sample(gy,x,y,z),sample(gz,x,y,z)],axis=-1)
        valid=np.linalg.norm(normal,axis=-1)>1e-5;normal[~valid]=[0,0,1]
        valid=np.linalg.norm(moment,axis=-1)>1e-9;moment[~valid]=[0,0,1]
        shading=np.concatenate([oct_encode(normal),oct_encode(moment)],axis=-1)
        return np.clip(light,0,4),shading
    X,Y,Z=grid(sigma.shape[0]);full=np.stack([sample(light[...,k],X,Y,Z) for k in range(3)],axis=-1)
    return np.clip(full,0,4),None

def majorant(rgb,sigma,emission_scale=4,sqrt_encoding=False):
    # Both160/192 divisible32. Each block covers5³/6³ voxels, including emission-only gas.
    e=np.clip(np.max(rgb,axis=-1)/emission_scale,0,1)
    if sqrt_encoding:e=np.sqrt(e)
    m=np.maximum(np.clip(sigma/12,0,1),e)
    # Match actual stored UNORM8: infinitesimal analytic tails quantize to zero
    # and should not force every block occupied. Maximum remains conservative.
    m=np.round(m*255)/255
    block=m.shape[0]//32
    m=m.reshape(32,block,32,block,32,block).max(axis=(1,3,5))
    # One macrocell dilation also bounds trilinear samples across block faces.
    result=np.zeros_like(m)
    padded=np.pad(m,1,mode='constant')
    for z in range(3):
        for y in range(3):
            for x in range(3):result=np.maximum(result,padded[z:z+32,y:y+32,x:x+32])
    return result

def pack(name,a,channels,dimensions):
    raw=np.ascontiguousarray(a,dtype=np.uint8).tobytes()
    data=gzip.compress(raw,compresslevel=7,mtime=0)
    filename=f'{name}.bin.gz';(OUT/filename).write_bytes(data)
    return {'file':filename,'dimensions':dimensions,'size':dimensions[0],'channels':channels,'format':('RGBA8' if channels==4 else 'R8'),'compression':'gzip','byteOrder':'z-major y-next x-fastest interleaved-channels','uncompressedBytes':len(raw),'compressedBytes':len(data),'rawBytes':len(raw),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'uncompressedSha256':hashlib.sha256(raw).hexdigest(),'rawSha256':hashlib.sha256(raw).hexdigest()}

def to8(a):
    return np.round(np.clip(a,0,1)*255).astype(np.uint8)

def preview(profile,rgb,sigma,light):
    # Front observer at+Z, looking toward-Z, screen up+Y. Includes incident single
    # scattering only in evidence projection, never pre-added to medium texture.
    n=sigma.shape[0];ds=2*DOMAIN/n;T=np.ones((n,n),dtype=F);C=np.zeros((n,n,3),dtype=F)
    aaxis=(np.arange(n,dtype=F)+.5)*ds-DOMAIN;Y,X=np.meshgrid(aaxis,aaxis,indexing='ij')
    for k in range(n-1,-1,-1):
        a=1-np.exp(-sigma[k]*ds)
        L=light[k] if light.shape[0]==n else np.stack([sample(light[...,c],X,Y,np.full_like(X,aaxis[k])) for c in range(3)],axis=-1)
        # Isotropic fallback preview: albedo*.HG(g=.28,mu=0), not old overly
        # bright RGB .18/.13/.09 scatter, which falsely washed dust into white.
        phase=F((1-.28**2)/(4*np.pi*(1+.28**2)**1.5))
        albedo=np.array([.62,.43,.25] if profile=='pillars' else ([.56,.40,.25] if profile=='orion' else [.55]*3),dtype=F)
        src=rgb[k]+sigma[k,...,None]*L*albedo*phase
        segment=np.divide(a,sigma[k],out=np.full_like(a,ds),where=sigma[k]>1e-7)
        C+=T[...,None]*src*segment[...,None]
        T*=1-a
    C+=T[...,None]*np.array([.0015,.002,.004],dtype=F)
    # Filament visibility in previews uses fixed exposure and filmic rational curve.
    exposure=2.1
    C=1-np.exp(-C*exposure)
    C=np.where(C<=.0031308,C*12.92,1.055*np.power(C,1/2.4)-.055)
    im=Image.fromarray(np.flipud(to8(C)),'RGB').resize((640,640),Image.Resampling.LANCZOS)
    im.save(OUT/f'{profile}-projection.png')
    # Three orthogonal slices show genuine depth, normalized log density only.
    panels=[]
    for sl in [sigma[n//2],sigma[:,n//2,:],sigma[:,:,n//2]]:
        v=np.log1p(sl)/np.log(13)
        panels.append(Image.fromarray(np.flipud(to8(v)),'L').convert('RGB').resize((320,320),Image.Resampling.NEAREST))
    canvas=Image.new('RGB',(960,344),(7,10,15));draw=ImageDraw.Draw(canvas)
    for i,(p,label) in enumerate(zip(panels,['XY at z=0','XZ at y=0','YZ at x=0'])):
        canvas.paste(p,(i*320,24));draw.text((i*320+8,6),profile+' '+label,fill=(210,220,230))
    canvas.save(OUT/f'{profile}-slices.png')
    return {'projection':f'{profile}-projection.png','orthogonalSlices':f'{profile}-slices.png','previewOnly':'CPU front integration exact Beer-Lambert with approximate HG(mu=0), albedo.55 and exposure2.1; not GPU acceptance'}

def verify():
    manifest=json.loads((OUT/'manifest.json').read_text(encoding='utf8'))
    records=[]
    for profile in manifest['profiles']:
        arrays={}
        for kind in ('medium','light','occupancy','shading'):
            if kind not in profile:continue
            q=profile[kind];data=(OUT/q['file']).read_bytes();raw=gzip.decompress(data)
            assert len(data)==q['compressedBytes'] and len(raw)==q['uncompressedBytes']
            assert hashlib.sha256(data).hexdigest()==q['sha256']
            assert hashlib.sha256(raw).hexdigest()==q['uncompressedSha256']
            assert len(raw)==int(np.prod(q['dimensions']))*q['channels']
            arrays[kind]=np.frombuffer(raw,dtype=np.uint8).reshape(tuple(q['dimensions'][::-1])+((q['channels'],) if q['channels']>1 else ()))
        medium=arrays['medium'];occ=arrays['occupancy']
        m=np.maximum(np.max(medium[...,:3],axis=-1),medium[...,3])
        block=medium.shape[0]//32
        maxima=m.reshape(32,block,32,block,32,block).max(axis=(1,3,5))
        assert np.all(occ>=maxima),'Nonconservative occupancy!'
        # True depth variation and transparent-emitting gas are mandatory.
        assert np.count_nonzero(np.diff(medium[...,0].astype(np.int16),axis=0))>N*N
        assert np.any((medium[...,:3].max(axis=-1)>8)&(medium[...,3]<4))
        if profile['id']=='orion':
            # Reject the historical nested closed-shell/donut construction. The
            # new front must have materially stronger offcenter than symmetric pairs.
            projection=medium[...,:3].sum(axis=(0,3)).astype(F)
            assert np.mean(np.abs(projection-np.flip(projection,axis=1)))>np.mean(projection)*.12
        assert profile['statistics']['maxEmission'] <= profile['emissionScale'],'Emission encoding clips source highlight'
        records.append({'id':profile['id'],'hashes':'all pass','rawBytes':int(sum(profile[k]['uncompressedBytes'] for k in ('medium','light','occupancy','shading') if k in profile)),'compressedBytes':int(sum(profile[k]['compressedBytes'] for k in ('medium','light','occupancy','shading') if k in profile)),'occupiedBlocks':int(np.count_nonzero(occ)),'totalBlocks':int(occ.size),'majorantConservative':True,'trueDepthVariation':True})
    if 'detail' in manifest:
        q=manifest['detail'];data=(OUT/q['file']).read_bytes();raw=gzip.decompress(data)
        assert len(raw)==32**3 and hashlib.sha256(raw).hexdigest()==q['uncompressedSha256']
        assert hashlib.sha256(data).hexdigest()==q['sha256']
    print(json.dumps(records,indent=2))
    print('PASS integrity and UNORM/occupancy/depth invariants; NOT GPU or artistic acceptance')

def main():
    global MESH_PATH
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--profile',choices=['all','orion','pillars','horsehead','ring','remnant','bipolar','helix'],default='all');ap.add_argument('--pillars-stl',help='Optional NASA/STScI positioning-reference seed; requires appropriate source credit');ap.add_argument('--verify',action='store_true',help='Read-only check all compressed/raw hashes, lengths, voxel semantics and majorants');ap.add_argument('--preview-only',action='store_true',help='Re-render projection PNGs from current stored medium/light, without baking density');ap.add_argument('--sync-metadata',action='store_true',help='Refresh derived hero metadata only; never changes binary assets');ap.add_argument('--reencode-emission',action='store_true',help='Recompute only hero medium with sqrtUNORM encoding, reuse incident/shading caches');args=ap.parse_args()
    if args.verify:return verify()
    if args.reencode_emission:
        global MESH_META
        MESH_PATH=Path(args.pillars_stl) if args.pillars_stl else None
        path=OUT/'manifest.json';m=json.loads(path.read_text(encoding='utf8'))
        for p in m['profiles']:
            if p['id'] not in ('orion','pillars') or args.profile not in ('all',p['id']):continue
            print('REENCODE',p['id'],flush=True)
            if p['id']=='pillars' and p.get('meshSeed') and not MESH_PATH:raise ValueError('Reencoding NASA Pillars requires original --pillars-stl to reproduce density')
            rgb,sigma=field(p['id'],n=p['size'],seed=p['seed']);scale=p['emissionScale']
            encoded=np.concatenate([to8(np.sqrt(rgb/scale)),to8(sigma/12)[...,None]],axis=-1)
            occ=majorant(rgb,sigma,scale,True)
            p['medium']=pack(p['id']+'-medium.rgba8',encoded,4,[p['size']]*3)
            p['occupancy']=pack(p['id']+'-occupancy.r8',np.ceil(occ*255).astype(np.uint8),1,[32]*3)
            p['emissionEncoding']='sqrt-unorm8';p['emissionDecode']='j = (medium.rgb/255)^2 * emissionScale; alpha remains LINEAR sigma_t/12'
            p['encodingMetrics']={'firstNonzeroDecodedEmission':scale/255**2,'roundToNonzeroThreshold':scale/(4*255**2),'previousLinearThreshold':scale/510,'nonzeroEncodedGasVoxels':int(np.count_nonzero(encoded[...,:3].max(axis=-1))),'linearEncodingNonzeroGasVoxels':int(np.count_nonzero(to8(rgb/scale).max(axis=-1)))}
            p['statistics']['occupiedFraction']=float(np.mean(occ>0))
            print('DONE REENCODE',p['id'],p['encodingMetrics'],flush=True)
            path.write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
            del rgb,sigma,encoded,occ
        return
    if args.sync_metadata:
        path=OUT/'manifest.json';m=json.loads(path.read_text(encoding='utf8'))
        for p in m['profiles']:
            if 'shading' not in p:continue
            p['scatteringAlbedo']=[.62,.43,.25] if p['id']=='pillars' else [.56,.40,.25]
            p['sampling']={'grid':'texel centers','coordinateToIndex':'(p+1.3)*resolution/2.6 - 0.5','illuminationResolution':128,'illuminationSteps':40}
            p['preview']['previewOnly']='CPU front integration exact Beer-Lambert, approximate HG(mu=0), colored albedo and exposure2.1; not GPU acceptance'
            q=p['medium'];raw=np.frombuffer(gzip.decompress((OUT/q['file']).read_bytes()),dtype=np.uint8).reshape(tuple(q['dimensions'])+(4,)).astype(F)/255
            gas=raw[...,:3]**2 if p.get('emissionEncoding')=='sqrt-unorm8' else raw[...,:3]
            lum=np.sum(gas*p['emissionScale']*np.array([.2126,.7152,.0722],dtype=F),axis=-1);sig=raw[...,3]*p['sigmaMax']
            p['qualityMetrics']={'emittingVoxelFractionAbove005':float(np.mean(lum>.05)),'dimVoidFractionBelow0002':float(np.mean(lum<.002)),'p99EmissionLuminance':float(np.percentile(lum,99)),'dustTransitionFraction':float(np.mean((sig>.1)&(sig<3))),'gridTexelCenters':True}
        m['occupancyMethod']='32³ max over quantized stored RGB emission encoding (sqrt for heroes, linear legacy) and linear extinction, one-macrocell dilation; conservative encoded majorant, zero-only skipping.'
        m['dimensionsNote']='Root dimensions default160; heroes medium256/light128/shading128. Per-file dimensions authoritative.'
        m['illuminationMethod']='Heroes:3 sources,40 midpoint extinction samples/light at128³, plus luminance-weighted travel direction and extinction-outward normal octahedral cache. Others retain original64³20step cache.'
        path.write_text(json.dumps(m,indent=2,ensure_ascii=False)+'\n',encoding='utf8');return
    if args.preview_only:
        m=json.loads((OUT/'manifest.json').read_text(encoding='utf8'))
        for p in m['profiles']:
            if args.profile not in ('all',p['id']):continue
            def unpack(role):
                q=p[role];return np.frombuffer(gzip.decompress((OUT/q['file']).read_bytes()),dtype=np.uint8).reshape(tuple(q['dimensions'])+(q['channels'],)).astype(F)/255
            medium=unpack('medium');light=unpack('light')
            preview(p['id'],(medium[...,:3]**2 if p.get('emissionEncoding')=='sqrt-unorm8' else medium[...,:3])*p['emissionScale'],medium[...,3]*p['sigmaMax'],light[...,:3]*p['lightScale'])
        return
    MESH_PATH=Path(args.pillars_stl) if args.pillars_stl else None
    OUT.mkdir(parents=True,exist_ok=True)
    manifestPath=OUT/'manifest.json'
    manifest={'schemaVersion':1,'generator':'tools/bake-cinematic-nebula.py','dimensions':[N,N,N],'domain':{'min':[-DOMAIN]*3,'max':[DOMAIN]*3},'order':'z-major y-next x-fastest; interleaved RGBA','encoding':'UNORM8 LINEAR; no sRGB decode','license':{'id':'CC0-1.0','notes':'Original mathematical artwork and algorithm authored for Orbit; no external images, density datasets or copied shaders. CC0 dedication applies to generated media and previews.'},'truth':'Illustrative artist-generated 3D gas/dust, NOT an observational reconstruction or measured volume. Names describe morphological inspiration only.','profiles':[]}
    if manifestPath.exists():
        old=json.loads(manifestPath.read_text(encoding='utf8'));manifest['profiles']=old.get('profiles',[])
        if 'detail' in old:manifest['detail']=old['detail']
    manifest['version']=1;manifest['domainBounds']=[-DOMAIN,DOMAIN];manifest['dimensionsVaryByProfile']=True;manifest['dimensionsNote']='Root dimensions are default160; Orion/Pillars medium256 and light/shading128. Per-file dimensions are authoritative.'
    specs=[('orion',6,164837),('ring',7,705317),('remnant',8,816743),('pillars',9,398779),('bipolar',10,289033),('horsehead',11,917233),('helix',12,572399)]
    for profile,typeid,seed in specs:
        if args.profile not in ('all',profile):continue
        start=time.monotonic();print('BAKE',profile,flush=True)
        size=256 if profile in ('orion','pillars') else N
        rgb,sigma=field(profile,n=size,seed=seed)
        lights,shading=illumination(sigma,profile)
        emission_scale=16 if profile in ('pillars','remnant') else (8 if profile in ('orion','helix') else 4)
        while emission_scale<float(rgb.max()):emission_scale*=2
        sqrt_encoding=profile in ('orion','pillars')
        medium=np.concatenate([to8(np.sqrt(rgb/emission_scale) if sqrt_encoding else rgb/emission_scale),to8(sigma/12)[...,None]],axis=-1)
        occ=majorant(rgb,sigma,emission_scale,sqrt_encoding)
        block=size//32
        light_size=lights.shape[0]
        lp=np.concatenate([to8(lights/4),np.zeros(lights.shape[:3]+(1,),dtype=np.uint8)],axis=-1)
        entry={'id':profile,'type':typeid,'seed':seed,'dimensions':[size]*3,'domain':manifest['domain'],'emissionScale':emission_scale,'sigmaMax':12,'lightScale':4,'lightPosition':LIGHTS[profile][0]['position'],'lights':LIGHTS[profile],
          'medium':pack(profile+'-medium.rgba8',medium,4,[size]*3),'light':pack(profile+'-light.rgba8',lp,4,[light_size]*3),
          'occupancy':pack(profile+'-occupancy.r8',np.ceil(occ*255).astype(np.uint8),1,[32]*3),
          'statistics':{'maxSigma':float(sigma.max()),'maxEmission':float(rgb.max()),'occupiedFraction':float(np.mean(occ>0)),'fractionExtinctionAbove1':float(np.mean(sigma>1)),'fractionEmissionClipped':float(np.mean(np.max(rgb,axis=-1)>emission_scale))},
          'preview':preview(profile,rgb,sigma,lights),'bakeSeconds':round(time.monotonic()-start,2)}
        entry['size']=size
        if sqrt_encoding:
            entry['emissionEncoding']='sqrt-unorm8';entry['emissionDecode']='j = (medium.rgb/255)^2 * emissionScale; alpha remains LINEAR sigma_t/12'
            entry['encodingMetrics']={'firstNonzeroDecodedEmission':emission_scale/255**2,'roundToNonzeroThreshold':emission_scale/(4*255**2),'previousLinearThreshold':emission_scale/510,'nonzeroEncodedGasVoxels':int(np.count_nonzero(medium[...,:3].max(axis=-1))),'linearEncodingNonzeroGasVoxels':int(np.count_nonzero(to8(rgb/emission_scale).max(axis=-1)))}
        if profile in ('orion','pillars'):entry['scatteringAlbedo']=[.62,.43,.25] if profile=='pillars' else [.56,.40,.25]
        brightness=np.sum(rgb*np.array([.2126,.7152,.0722],dtype=F),axis=-1)
        entry['qualityMetrics']={'emittingVoxelFractionAbove005':float(np.mean(brightness>.05)),'dimVoidFractionBelow0002':float(np.mean(brightness<.002)),'p99EmissionLuminance':float(np.percentile(brightness,99)),'dustTransitionFraction':float(np.mean((sigma>.1)&(sigma<3))),'gridTexelCenters':True}
        del brightness
        entry['sampling']={'grid':'texel centers','coordinateToIndex':'(p+1.3)*resolution/2.6 - 0.5','illuminationResolution':128 if shading is not None else 64,'illuminationSteps':40 if shading is not None else 20}
        if shading is not None:
            entry['shading']=pack(profile+'-shading.rgba8',shading,4,[shading.shape[0]]*3)
            entry['shadingEncoding']={'normal':'RG octahedral UNORM8 outward -gradient(sigma_t); zero gradient +Z','incoming':'BA octahedral UNORM8 luminance-weighted irradiance travel direction light-to-voxel','space':'object-local','filter':'nearest to avoid octahedral fold interpolation seams'}
        if profile=='pillars' and MESH_META:
            entry['meshSeed']=dict(MESH_META,sourcePage='https://science.nasa.gov/asset/webb/pillars-of-creation-model-for-3d-printing/',credit='3D Model: Leah Hustak (STScI), Ralf Crawford (STScI)',rights='STScI copyright policy: unless otherwise specifically stated, no claim to copyright, freely used as public domain; NASA contract material. This source model is NOT claimed CC0 by Orbit.',rightsUrl='https://www.stsci.edu/copyright')
            entry['license']={'id':'NASA-STScI-public-domain-plus-original-processing','notes':'NASA/STScI model seed credited separately. Orbit original erosion, wisps, emissivity and irradiance processing. Interior occupancy inferred, not measured.'}
        else:entry['license']={'id':'CC0-1.0','notes':'Original mathematical artwork; no external imagery or geometry.'}
        manifest['profiles']=[p for p in manifest['profiles'] if p['id']!=profile]+[entry]
        for p in manifest['profiles']:
            p['size']=p['dimensions'][0]
            if 'license' not in p:p['license']={'id':'CC0-1.0','notes':'Original mathematical artwork; no external imagery or geometry.'}
            for key in ('medium','light','occupancy'):
                q=p[key];q['size']=q['dimensions'][0];q['rawBytes']=q['uncompressedBytes'];q['bytes']=q['compressedBytes'];q['rawSha256']=q['uncompressedSha256']
        manifest['license']={'notes':'Per-profile licenses are authoritative: original mathematical artwork CC0; optional NASA/STScI Pillars geometry credited under source public-domain policy, not claimed CC0.'}
        manifest['profiles'].sort(key=lambda p:p['type'])
        # Source-light incident term traced20 points, each x64³; fine scatter remains live.
        manifest['illuminationMethod']='Heroes:3 point sources,40 midpoint extinction samples/light at128³ plus luminance-weighted incoming direction moment and outward density gradient octahedral cache. Others retain64³20step cache. Incident RGB only, not pre-scattered; per-profile sampling metadata authoritative.'
        manifest['occupancyMethod']='32³ max over quantized stored RGB emission encoding (sqrt heroes, linear legacy) and linear extinction, one-macrocell dilation; conservative encoded majorant, zero-only skipping.'
        manifest['notes']=['Medium alpha represents sigma_t per LOCAL distance; integrate with world-to-local ray-length scale, not arbitrary world meters.','Medium RGB is j per local distance, decoded independently of alpha.','Light alpha optional occupancy; use dedicated32³ occupancy for skipping.','Clamp volume sampling at edge; only optional detail tile repeats.','No image extrusion; all morphology, erosion, warp, wisps and light attenuation vary across all three axes.']
        manifestPath.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
        print('DONE',profile,entry['bakeSeconds'],'seconds',flush=True)
        del rgb,sigma,lights,medium,lp
    # Shared smooth periodic multiscale detail tile, native repeat sampler.
    if args.profile=='all' or not (OUT/'detail.r8.bin.gz').exists():
        a=np.linspace(0,1,32,endpoint=False,dtype=F);z,y,x=np.meshgrid(a,a,a,indexing='ij')
        d=np.zeros(x.shape,dtype=F)
        for i,(freq,amp) in enumerate([(2,.30),(4,.20),(7,.13),(11,.08)]):
            d+=amp*np.sin(2*np.pi*(freq*x+(freq//2+1)*y))*np.cos(2*np.pi*((freq+1)*z-(freq//2)*x)+i*.7)
        d=np.clip(.5+d,0,1)
        manifest['detail']=pack('detail.r8',to8(d),1,[32]*3)
        manifest['detail']['repeat']=True
        manifestPath.write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf8')

if __name__=='__main__':main()
