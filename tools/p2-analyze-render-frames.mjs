// Analyze retained adjacent CPU render-call samples; not a same-time/visual comparison.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as THREE from '../public/js/three.module.min.js';
import {computeHandoff} from './p2-handoff-prototype.mjs';
const data=JSON.parse(fs.readFileSync(new URL('./p2-render-frame-sample.json',import.meta.url),'utf8'));
const {before:a,after:b}=data,v=x=>new THREE.Vector3(...x);
assert.equal(a.completed,true);assert.equal(b.completed,true);assert.equal(a.kind,'main');assert.equal(b.kind,'cosmic');assert.equal(b.frame-a.frame,1);
const result=computeHandoff({time:a.now,cameraPosition:v(a.camAbs),sunPosition:v(a.sun),sunGalactic:v(a.sunGal),forward:v(a.forward),up:v(a.up),radius:b.radius,minRadius:1e19,maxRadius:1.2e27,projection:new THREE.Matrix4().fromArray(a.projection)});
const observed=v(b.target).add(new THREE.Vector3(Math.cos(b.theta)*Math.cos(b.phi),Math.sin(b.phi),Math.sin(b.theta)*Math.cos(b.phi)).multiplyScalar(b.radius));
const angle=(p,q)=>p.angleTo(q)*180/Math.PI;
const info={status:'comparison-not-validation',frameDelta:b.frame-a.frame,elapsedMs:b.now-a.now,lgDelta:b.lg-a.lg,axisIdenticalForwardDeg:angle(v(a.forward),v(b.forward)),mappedForwardDeg:angle(result.forward,v(b.forward)),mappedUpDeg:angle(result.up,v(b.up)),candidatePositionMeters:result.position.toArray(),observedOrbitPositionMeters:observed.toArray(),positionDifferenceMeters:result.position.distanceTo(observed),differenceOverRadius:result.position.distanceTo(observed)/b.radius,assumptions:'solar anchor + mapped (camera - sun), radius taken from later frame',limitations:data.limitations};
assert.ok(Object.values(info).filter(x=>typeof x==='number').every(Number.isFinite));console.log(JSON.stringify(info,null,2));
