// Compare one rAF-observed boundary pair with a candidate; not simultaneous frame data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../public/js/three.module.min.js';
import {computeHandoff,mapDirection} from './p2-handoff-prototype.mjs';
const sample=JSON.parse(fs.readFileSync(new URL('./p2-boundary-snapshot-example.json',import.meta.url),'utf8'));
const v=a=>new THREE.Vector3(...a),a=sample.before,b=sample.after;
const C_KPC=3.0856775814913673e19;
const h=computeHandoff({time:a.time,cameraPosition:v(a.position),sunPosition:v(a.sun),sunGalactic:new THREE.Vector3(8.15*C_KPC,0,0),forward:v(a.forward),up:v(a.up),radius:b.r,minRadius:1e19,maxRadius:1.2e27,projection:new THREE.Matrix4().fromArray(a.projection)});
const observedPosition=v(b.target).add(new THREE.Vector3(Math.cos(b.theta)*Math.cos(b.phi),Math.sin(b.phi),Math.sin(b.theta)*Math.cos(b.phi)).multiplyScalar(b.r));
const angle=(x,y)=>x.angleTo(y)*180/Math.PI;
const result={status:'measurement-not-validation',elapsedMs:b.time-a.time,deltaLg:b.lg-a.lg,assumption:'sunGalactic=(8.15 kpc,0,0); candidate radius equals observed after radius',candidatePosition:h.position.toArray(),observedPosition:observedPosition.toArray(),positionDifferenceMeters:h.position.distanceTo(observedPosition),positionDifferenceOverRadius:h.position.distanceTo(observedPosition)/b.r,mappedForwardVersusObservedDeg:angle(h.forward,v(b.forward)),numericAxisForwardAngleDeg:angle(v(a.forward),v(b.forward)),mappedUpAngleDeg:angle(h.up,v(b.up)),candidateTarget:h.target.toArray(),observedTarget:b.target,projectionMaxDifference:Math.max(...h.projection.elements.map((x,i)=>Math.abs(x-b.projection[i]))),limitations:sample.limitations};
assert.ok(Object.values(result).filter(x=>typeof x==='number').every(Number.isFinite));
console.log(JSON.stringify(result,null,2));
