'use strict';
// Package evidence only: compares shipped bytes, parses actual production Gaia
// decoder, and verifies retirement of photo-derived-depth assets. Not GPU proof.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(ROOT,p)),text=p=>read(p).toString('utf8'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(text('public/data/gaia/manifest.json'));
const binary=read('public/data/gaia/gaia-dr3.bin'),gaiaSource=text('public/js/gaia-stars.js'),appSource=text('public/js/app.js'),sourceOnly=process.argv.includes('--source-only');
assert(process.argv.slice(2).every(arg=>arg==='--source-only'),'usage: node tools/test-gaia-built.cjs [--source-only]');
assert.equal(binary.length,manifest.byteLength);assert.equal(hash(binary),manifest.sha256);assert.equal(manifest.binary.sha256,manifest.sha256);
assert.equal(binary.subarray(0,8).toString('ascii'),'GAIA3D1\0');assert.equal(binary.readUInt32LE(8),manifest.count);assert.equal(binary.readUInt32LE(12),48);assert.equal(binary.readDoubleLE(16),2016);assert.equal(binary.length,32+manifest.count*48);
const rawGzip=read('public/data/gaia/'+manifest.raw.file),rawCSV=zlib.gunzipSync(rawGzip);
assert.equal(hash(rawGzip),manifest.raw.gzipSHA256,'archived original gzip hash');assert.equal(hash(rawCSV),manifest.raw.csvSHA256,'original TAP CSV hash');assert.equal(rawCSV.length,manifest.raw.csvBytes);
const csvLines=rawCSV.toString('utf8').trim().split(/\r?\n/);assert.equal(csvLines.shift(),'source_id,ra,dec,parallax,parallax_error,phot_g_mean_mag,bp_rp,ruwe,parallax_over_error');assert.equal(csvLines.length,manifest.count);
for(let i=0;i<csvLines.length;i++){
 const c=csvLines[i].split(','),b=32+i*48;
 assert.equal(binary.readBigUInt64LE(b).toString(),c[0],`raw source_id exact row${i}`);
 assert.equal(binary.readDoubleLE(b+8),Number(c[1]),`raw RA exact row${i}`);assert.equal(binary.readDoubleLE(b+16),Number(c[2]),`raw Dec exact row${i}`);
 for(let j=3;j<9;j++)assert.equal(binary.readFloatLE(b+24+(j-3)*4),Math.fround(Number(c[j])),`raw scalar float32 row${i} col${j}`);
}
assert.equal(manifest.retrieval.countExpected,manifest.count);assert.equal(manifest.truncated,false);assert.equal(manifest.license.nonCommercialRestriction,true);assert.equal(manifest.license.name,'CC BY-NC 3.0 IGO');assert.equal(manifest.distancePolicy.zeroPointCorrectionApplied,false);
function extractPack(html,label){
 const marker='window.__ORBIT_INLINE__=',start=html.indexOf(marker);assert(start>=0,label+' inline marker');
 assert.equal(html.indexOf(marker,start+marker.length),-1,label+' one inline pack');
 const end=html.indexOf('};</script>',start);assert(end>start,label+' inline pack ending');
 return JSON.parse(html.slice(start+marker.length,end+1));
}
function assertCombinedContract(source,label){
 for(const retired of [/GAIA\.mode/,/GAIA\.selection/,/updateGaiaPanel/,/gaiaMeasuredPanel/,/data-gaia-(?:mode|selection|find|id)/,/\bgaiaMode\s*\(/,/\bgaiaSource\s*\(/,/\bcosmicPopulationMode\s*\(/])assert(!retired.test(source),label+' excludes retired independent-mode/panel/selection contract '+retired+'; rebuild artifacts if source has changed');
 assert(/GAIA\.catalog=window\.ORBIT_GAIA\.parse\(buffer,manifest\);GAIA\.ready=true/.test(source),label+' actual Gaia parsing remains');
 assert(/const starOpacity\s*=\s*1\s*-\s*photoOpacity\s*;/.test(source),label+' real Gaia retained in automatic combined handoff');
 assert(/GAIA\.layer\.update\(GAIA\.observerPc,CS\.unit,CS\.pxPerRad,renderer\.getPixelRatio\(\),starOpacity\)/.test(source),label+' actual Gaia rendering retained');
}
assertCombinedContract(appSource,'source');
const sourceHTML=text('public/index.html');assert(sourceHTML.includes('<script src="./js/gaia-stars.js"></script>'));assert(!sourceHTML.includes('photo-galaxy.js'),'source entry excludes retired photo-volume module');
function assertRetired(html,label){
 for(const forbidden of ['createPhotoGalaxy','uDiffusePanorama','mw-photo-diffuse.png','mw-photo-normalization.png','./js/photo-galaxy.js'])assert(!html.includes(forbidden),label+' excludes retired photo-depth '+forbidden);
 assert(html.includes(gaiaSource),label+' contains exact production Gaia module');
 const offlineApp=appSource.replace(/import \* as THREE from 'three';/,'const THREE = window.THREE;');assert.notEqual(offlineApp,appSource,'production import matches current build contract');assert(html.includes(offlineApp),label+' contains exact current production app; run node build.mjs --replace-existing before package validation');
 assertCombinedContract(html,label);
 assert(!html.includes('<script src="./js/gaia-stars.js"></script>'),label+' Gaia code inlined for distribution');
}
const ctx={ArrayBuffer,DataView,Uint8Array,BigInt,Set,Number,Math,console};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(gaiaSource,ctx,{filename:'gaia-stars.js'});
if(sourceOnly){
 const sourceBuffer=binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),sourceCatalog=ctx.ORBIT_GAIA.parse(sourceBuffer,manifest);assert.equal(sourceCatalog.count,manifest.count);for(const row of sourceCatalog.rows)assert(typeof row.sourceId==='string'&&Number.isFinite(row.distancePc)&&row.distancePc>0&&row.sigmaPc>0);
 console.log(`PASS Gaia source package preflight: ${manifest.count} raw/packed observations exact, hashes/manifest verified, production parser accepts all sources, automatic combined Gaia path retained and panel/modes removed. Built artifacts NOT inspected (--source-only); rebuild before full package test.`);process.exit(0);
}
let html=text('space.html');assertRetired(html,'offline');
let pack=extractPack(html,'offline');assert(pack.gaia&&pack.gaia.data,'offline Gaia data present');assert.deepEqual(pack.gaia.manifest,manifest,'offline exact catalogue manifest');
const embedded=Buffer.from(pack.gaia.data,'base64');assert(embedded.equals(binary),'offline binary byte-for-byte identical');assert.equal(hash(embedded),manifest.sha256,'offline decoded Gaia SHA256');
const ab=embedded.buffer.slice(embedded.byteOffset,embedded.byteOffset+embedded.byteLength),parsed=ctx.ORBIT_GAIA.parse(ab,pack.gaia.manifest);
assert.equal(parsed.count,manifest.count,'production parser counts shipped data');assert.equal(parsed.rows[0].sourceId,binary.readBigUInt64LE(32).toString());assert.equal(parsed.rows[parsed.rows.length-1].sourceId,binary.readBigUInt64LE(32+(manifest.count-1)*48).toString());
for(const row of parsed.rows)assert(typeof row.sourceId==='string'&&Number.isFinite(row.distancePc)&&row.distancePc>0&&row.sigmaPc>0);
assert(!Object.hasOwn(pack,'photoGalaxy'),'offline no retired reconstruction inline pack');
const rawPhoto=read('public/data/sky/eso0932a-source.jpg');assert(Buffer.from(pack.skyPanorama,'base64').equals(rawPhoto),'offline native unmodified panorama bytes preserved');
const offlineHash=hash(Buffer.from(html));assert.equal(hash(read('index.html')),offlineHash,'both offline files identical');
html=null;pack=null;
let http=text('space-http.html');assertRetired(http,'HTTP');let httpPack=extractPack(http,'HTTP');assert.equal(httpPack.gaia,null,'HTTP Gaia no inline binary');assert.equal(httpPack.skyPanorama,'','HTTP photo no inline bytes');assert(!Object.hasOwn(httpPack,'photoGalaxy'),'HTTP no retired reconstruction pack');
assert(http.includes('./data/gaia/gaia-dr3.bin')||http.includes("'gaia-dr3.bin'"),'HTTP relative Gaia binary loader retained');
console.log(`PASS Gaia package: ${manifest.count} observed rows; raw CSV/gzip hashes verified; all IDs/RA/Dec/scalars exact against CSV; offline byte-identical binary+manifest production parse; both offline files identical; original native photo bytes unchanged; HTTP Gaia/photo external fallback, no photo-depth module or blur assets. Package/CPU evidence, not GPU or photographic 3D completeness.`);
