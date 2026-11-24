// One browser-observed main-scene sample, 2026-11-17; not a frame-boundary capture.
import * as THREE from '../public/js/three.module.min.js';
import {computeHandoff} from './p2-handoff-prototype.mjs';
import assert from 'node:assert/strict';
const v=a=>new THREE.Vector3(...a);
const input={time:40177.39999997616,cameraPosition:v([149588465237.7835,-2048138.392227474,82464062.37004238]),sunPosition:v([0,0,0]),sunGalactic:v([8.15*3.0856775814913673e19,0,0]),forward:v([.6059566947748165,.1119401211157838,-.7875823089316846]),up:v([.7911268665056486,.01884161312008889,.611361819799034]),projection:new THREE.Matrix4().fromArray([1.005280802197346,0,0,0,0,1.9209821269711664,0,0,0,0,-1.000000000000016,-1,0,0,-.8000000000000064,0]),radius:2e20,minRadius:1e19,maxRadius:1e27};
const h=computeHandoff(input);
const n=v([Math.cos(h.theta)*Math.cos(h.phi),Math.sin(h.phi),Math.sin(h.theta)*Math.cos(h.phi)]);
const error=h.target.clone().addScaledVector(n,h.radius).distanceTo(h.position)/h.radius;
assert.ok(error<1e-12);const product=h.projection.clone().multiply(h.inverse).elements;
assert.ok(product.every((x,i)=>Math.abs(x-(i%5===0?1:0))<1e-9));
console.log(JSON.stringify({status:'PASS',relativePositionError:error,theta:h.theta,phi:h.phi,position:h.position.toArray(),target:h.target.toArray(),limitations:['single non-boundary synchronous browser read','sunGalactic and radius supplied as assumptions','not natural transition, GPU, physical or visual validation']},null,2));
