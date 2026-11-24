// Experimental math only: not imported by the product. Map equatorial vectors to
// the current galactic world basis; use a clip-X reflection for screen parity.
import * as THREE from '../public/js/three.module.min.js';
const DEG=Math.PI/180;
function direction(ra,dec){ra*=DEG;dec*=DEG;const c=Math.cos(dec);return new THREE.Vector3(c*Math.cos(ra),Math.sin(dec),c*Math.sin(ra));}
const north=direction(192.85948,27.12825), center=direction(266.40510,-28.936175), y=new THREE.Vector3().crossVectors(north,center).normalize();
export function mapDirection(v,out=new THREE.Vector3()){
  const length=Math.hypot(v.x,v.y,v.z);
  if(!Number.isFinite(length)||length<1e-10||length>1e150)throw new Error('invalid direction');
  return out.set(-v.dot(center),v.dot(north),-v.dot(y));
}
// Orthonormalize forward/up for lookAt; reject degenerate input instead of making up orientation.
export function candidateFrame(forward,up){
  const f=mapDirection(forward).normalize(), mappedUp=mapDirection(up).normalize();
  const u=mappedUp.addScaledVector(f,-mappedUp.dot(f));
  if(u.lengthSq()<1e-12)throw new Error('parallel forward/up');
  u.normalize();return {forward:f,up:u,right:new THREE.Vector3().crossVectors(f,u).normalize()};
}
// Pure snapshot candidate. All positions/radius are metres in their stated frames.
// Timestamp identifies the supplied snapshot; this function cannot prove inputs are co-temporal.
export function computeHandoff({time, cameraPosition, sunPosition, sunGalactic, forward, up, radius, projection, minRadius, maxRadius}) {
  const finiteVector=v=>v&&[v.x,v.y,v.z].every(Number.isFinite);
  if(!Number.isFinite(time)||![cameraPosition,sunPosition,sunGalactic].every(finiteVector)) throw new Error('invalid snapshot');
  if(!Number.isFinite(radius)||!Number.isFinite(minRadius)||!Number.isFinite(maxRadius)||minRadius<=0||maxRadius<minRadius||radius<minRadius||radius>maxRadius) throw new Error('invalid radius');
  if(!projection || !projection.elements || projection.elements.length!==16 || !projection.elements.every(Number.isFinite)) throw new Error('invalid projection');
  // Normalize homogeneous scale before inversion; bound the condition estimate and
  // residual rather than treating an absolute determinant as scale invariant.
  const scale=Math.max(...projection.elements.map(Math.abs));
  if(!Number.isFinite(scale)||scale===0) throw new Error('invalid projection');
  const normalized=projection.clone().multiplyScalar(1/scale);
  const determinant=normalized.determinant();
  if(!Number.isFinite(determinant)||determinant===0) throw new Error('invalid projection');
  const normalizedInverse=normalized.clone().invert();
  if(!normalizedInverse.elements.every(Number.isFinite)) throw new Error('invalid projection inverse');
  const rowNorm=m=>Math.max(...[0,1,2,3].map(i=>[0,1,2,3].reduce((s,j)=>s+Math.abs(m.elements[j*4+i]),0)));
  const condition=rowNorm(normalized)*rowNorm(normalizedInverse);
  const identity=normalized.clone().multiply(normalizedInverse).elements;
  const residual=Math.max(...identity.map((v,i)=>Math.abs(v-(i%5===0?1:0))));
  if(!Number.isFinite(condition)||condition>1e12||!Number.isFinite(residual)||residual>1e-9) throw new Error('ill-conditioned projection');
  const frame=candidateFrame(forward,up);
  const delta=cameraPosition.clone().sub(sunPosition);
  // Displacement is not a direction: permit arbitrarily small finite values, including
  // subnormal components, without the direction guard or lengthSq underflow.
  const mapped=new THREE.Vector3(-delta.dot(center),delta.dot(north),-delta.dot(y));
  const position=sunGalactic.clone().add(mapped);
  const outward=frame.forward.clone().negate();
  const phi=Math.asin(THREE.MathUtils.clamp(outward.y,-1,1));
  if(Math.abs(phi)>1.45) throw new Error('orbit latitude exceeds production clamp');
  const theta=Math.atan2(outward.z,outward.x);
  const target=position.clone().addScaledVector(frame.forward,radius);
  if(![position,target].every(finiteVector)) throw new Error('position overflow');
  const reconstructed=target.clone().addScaledVector(outward,radius);
  if(target.equals(position)||Math.hypot(reconstructed.x-position.x,reconstructed.y-position.y,reconstructed.z-position.z)>radius*1e-12) throw new Error('position precision insufficient');
  const projected=projection.clone().multiply(new THREE.Matrix4().makeScale(-1,1,1));
  const inverse=new THREE.Matrix4().makeScale(-1,1,1).multiply(normalizedInverse).multiplyScalar(1/scale);
  if(!inverse.elements.every(Number.isFinite)) throw new Error('invalid projection inverse');
  return {time,position,target,radius,theta,phi,forward:frame.forward,up:frame.up,projection:projected,inverse};
}
export function reflectedProjection(camera){
  // Reflect view-space X before applying the full original projection. Left-multiplying
  // clip-space X incorrectly flips principal-point/view offsets on asymmetric frusta.
  const projection=camera.projectionMatrix.clone().multiply(new THREE.Matrix4().makeScale(-1,1,1));
  const inverse=projection.clone().invert();
  return {projection,inverse};
}
