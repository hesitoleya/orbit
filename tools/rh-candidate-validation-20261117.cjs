'use strict';
/* Serializable synchronous probe. No CDP, profiles, writes, polling or navigation.
 * Run on the isolated preview through BrowserSkill; rejects missing evidence. */
function probe() {
  const I=window.__rhInternals,R=window.__RH_CANDIDATE__,T=window.__SE.THREE,cs=window.__SE.CS;
  if(!I||!R||!R.entry||!R.first||!R.first.completed)throw Error('Completed natural handoff required');
  const V=(...x)=>new T.Vector3(...x),D=Math.PI/180;
  const angle=(a,b)=>a.angleTo(b)/D;
  const gc=V().fromArray(R.basis.gc),ngp=V().fromArray(R.basis.ngp),yg=V().fromArray(R.basis.yg);
  const M=v=>V(-v.dot(gc),v.dot(ngp),v.dot(yg));
  const lb=(l,b)=>V(-Math.cos(b*D)*Math.cos(l*D),Math.sin(b*D),-Math.cos(b*D)*Math.sin(l*D));
  const known=[['M31',10.685,41.269,121.17,-21.52],['M33',23.462,30.660,133.59,-31.33],['LMC',80.894,-69.756,280.46,-32.89],['SMC',13.187,-72.829,302.80,-44.30]];
  const knownDirs=known.map(k=>({name:k[0],degrees:angle(I.galWorld(k[1],k[2],1,V()),lb(k[3],k[4]))}));
  const axes=[V(1,0,0),V(0,1,0),V(0,0,1)].map(M),determinant=axes[0].clone().cross(axes[1]).dot(axes[2]);
  const galaxies=I.GAL_CAT.map((r,i)=>{
    const g=cs.gals[i];if(!g)throw Error('Missing galaxy '+r[0]);
    const rel=g.userData.pos.clone().sub(I.SUN_GAL);
    return {name:r[0],angle:angle(rel,I.galWorld(r[1],r[2],1,V())),ratio:rel.length()/(r[3]*I.C_MLY)};
  });
  const clusters=(I.MWGC_LIST||[]).map((r,i)=>({name:r[0],angle:angle(I.galWorld(r[2]*15,r[3],r[4],V()),V(-r[7],r[9],-r[8])),buffer:V().fromArray(cs.gcKpc,i*3).distanceTo(V(8.15-r[7],r[9],-r[8]))}));
  const dip=cs.cmbMat&&cs.cmbMat.uniforms.uDip&&cs.cmbMat.uniforms.uDip.value;
  const dipError=dip?angle(dip,lb(264,48)):null;
  const e=R.entry,qM=new T.Quaternion().fromArray(e.mainQuaternion).invert(),qC=cs.cam.getWorldQuaternion(new T.Quaternion()).invert();
  const Pm=new T.Matrix4().fromArray(e.mainProjection),Pc=cs.cam.projectionMatrix.clone();
  const wrongP=Pc.clone().multiply(new T.Matrix4().makeScale(-1,1,1));
  const project=(P,q,d)=>{
    const p=d.clone().applyQuaternion(q),v=new T.Vector4(p.x,p.y,p.z,0).applyMatrix4(P);
    return {x:v.x/v.w,y:v.y/v.w,front:p.z<0&&v.w>0};
  };
  const q=new T.Quaternion().fromArray(e.mainQuaternion),f=V().fromArray(e.mainForward),right=V(1,0,0).applyQuaternion(q),up=V(0,1,0).applyQuaternion(q);
  const rows=[];
  for(const a of [3,8,15])for(const [x,y] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
    const d=f.clone().addScaledVector(right,Math.tan(a*D)*x).addScaledVector(up,Math.tan(a*D)*y).normalize();
    const src=project(Pm,qM,d),dst=project(Pc,qC,M(d)),bad=project(wrongP,qC,M(d)),mirror=M(d);mirror.z=-mirror.z;
    const badMap=project(Pc,qC,mirror);
    rows.push({a,x,y,inFrustum:src.front&&dst.front&&Math.abs(src.x)<=1&&Math.abs(src.y)<=1&&Math.abs(dst.x)<=1&&Math.abs(dst.y)<=1,
      error:Math.hypot(src.x-dst.x,src.y-dst.y),reflectionNegative:bad.front?Math.hypot(src.x-bad.x,src.y-bad.y):null,
      mirrorNegative:badMap.front?Math.hypot(src.x-badMap.x,src.y-badMap.y):null});
  }
  const finite=xs=>xs.length>0&&xs.every(Number.isFinite),max=xs=>finite(xs)?Math.max(...xs):null;
  const front=rows.filter(r=>r.inFrustum),ndcError=max(front.map(r=>r.error));
  const reflectionNegative=max(front.map(r=>r.reflectionNegative).filter(Number.isFinite));
  const mirrorNegative=max(rows.map(r=>r.mirrorNegative).filter(Number.isFinite));
  const anchor=V().fromArray(e.candidatePosition).sub(M(V().fromArray(e.mainPosition).sub(V().fromArray(e.mainSun))));
  const anchorError=anchor.distanceTo(I.SUN_GAL)/I.SUN_GAL.length();
  const forward=angle(cs.cam.getWorldDirection(V()),V().fromArray(e.mappedForward));
  const effectiveUp=angle(V(0,1,0).applyQuaternion(cs.cam.getWorldQuaternion(new T.Quaternion())),V().fromArray(e.mappedUp));
  const mainXY=[0,4,8,12,1,5,9,13],projectionXY=max(mainXY.map(i=>Math.abs(Pm.elements[i]-Pc.elements[i])));
  const gaia=cs.mwRealMat.map,dust=cs.dustGroup.children[0]&&cs.dustGroup.children[0].material.map;
  const textureState=t=>t?{repeat:t.repeat.toArray(),offset:t.offset.toArray(),size:t.image?[t.image.width,t.image.height]:null}:null;
  const measurements={determinant,knownDirs,galaxyCount:galaxies.length,galaxyAngle:max(galaxies.map(x=>x.angle)),galaxyRatio:max(galaxies.map(x=>Math.abs(x.ratio-1))),clusterCount:clusters.length,clusterAngle:max(clusters.map(x=>x.angle)),clusterBuffer:max(clusters.map(x=>x.buffer)),dipError,
    ndc:{count:front.length,error:ndcError,reflectionNegative,mirrorNegative,rows},anchorError,forward,effectiveUp,projectionXY,frameDelta:R.first.frame-R.first.sourceFrame,
    positionRelative:R.first.positionRelativeError,gaia:textureState(gaia),dust:textureState(dust),look:[21,22.2959,24.4,26.3].map(lg=>({lg,angles:I.candidateLook(lg)}))};
  const checks={properRotation:Math.abs(determinant-1)<1e-5,
    knownDirs:knownDirs.length===4&&knownDirs.every(x=>Number.isFinite(x.degrees)&&x.degrees<0.1),
    galaxies:galaxies.length>50&&measurements.galaxyAngle!==null&&measurements.galaxyAngle<1e-4&&measurements.galaxyRatio<1e-4,
    clusters:clusters.length>100&&measurements.clusterAngle!==null&&measurements.clusterAngle<1.2&&measurements.clusterBuffer<2e-5,
    cmbPresentAndAligned:Number.isFinite(dipError)&&dipError>=0&&dipError<1e-4,
    originalProjectionCopied:projectionXY!==null&&projectionXY<1e-12,
    ndcContinuity:front.length===27&&ndcError!==null&&ndcError<1e-4,
    negativeExtraReflection:reflectionNegative!==null&&reflectionNegative>0.01,
    negativeMirrorMap:mirrorNegative!==null&&mirrorNegative>0.01,
    forwardMapped:Number.isFinite(forward)&&forward<0.01,upMapped:Number.isFinite(effectiveUp)&&effectiveUp<0.5,
    sunVectorAnchored:Number.isFinite(anchorError)&&anchorError<1e-10,
    adjacentCompletedFrame:measurements.frameDelta===1,
    gaiaReadyAndUFlipped:!!gaia&&gaia.repeat.x===-1&&gaia.offset.x===1,
    dustReadyAndVFlipped:!!dust&&dust.repeat.y===-1&&dust.offset.y===1&&dust.repeat.x===1,
    lookContinues:I.candidateLook(24.4)[0]!==I.candidateLook(26.3)[0],
    noCandidateErrors:R.errors.length===0};
  return {status:Object.values(checks).every(v=>v===true)?'passed-limited':'failed',checks,measurements,
    limitations:['isolated HTTP preview, not production or file entry','last completed main snapshot, not same physical time','NDC uses directions at infinity; not finite-star parallax or visual identity','natural adjacent-frame position error is reported, not treated as a same-time jump','no dual-scene composition, resize, full endpoint equivalence, continuous reverse playback or user visual approval']};
}
module.exports={probe};
