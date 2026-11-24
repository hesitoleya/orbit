'use strict';
/* Bounded single-provider Earth asset replacement. Run stage, inspect both staged
 * files using read_image, then run apply --visual-reviewed. No app/build changes. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const base=path.resolve(root,'.workbuddy/main-redesign-20261119');
const definitions=[
 {role:'surface',url:'https://www.solarsystemscope.com/textures/download/8k_earth_daymap.jpg',file:'earth-surface-8k.jpg',stage:'clean-earth-daymap-sss.jpg',semantics:'Display-referred RGB day map; NASA Blue Marble-derived composite, color adjusted by Solar System Scope; not raw calibrated albedo.'},
 {role:'clouds',url:'https://www.solarsystemscope.com/textures/download/8k_earth_clouds.jpg',file:'earth-cloudfraction.jpg',stage:'clean-earth-clouds-sss.jpg',semantics:'Grayscale cloud texture/visual coverage mask; not a calibrated cloud-fraction product, not live weather.'}
];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function dimensions(b){
 if(b.readUInt16BE(0)!==0xffd8)throw Error('Not JPEG');
 let p=2;while(p<b.length){if(b[p++]!==0xff)throw Error('Invalid JPEG marker');let marker=b[p++];while(marker===0xff)marker=b[p++];if(marker===0xd9||marker===0xda)break;if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;let len=b.readUInt16BE(p);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {width:b.readUInt16BE(p+5),height:b.readUInt16BE(p+3),components:b[p+7]};p+=len;}throw Error('Missing JPEG SOF');
}
function safe(rel){const p=path.resolve(root,rel);if(!p.startsWith(root+path.sep))throw Error('Outside root');return p;}
function prepareCloud(){
 const python=process.argv[3];if(!python)throw Error('prepare-cloud requires bundled Python executable');
 const source=path.join(base,definitions[1].stage),out=path.join(base,'clean-earth-clouds-sss-4k-q90.jpg');
 if(fs.existsSync(out))throw Error('Prepared cloud exists: '+out);
 const code='from PIL import Image; import sys; im=Image.open(sys.argv[1]).convert("RGB"); assert im.size==(8192,4096); im.resize((4096,2048), Image.Resampling.LANCZOS).save(sys.argv[2], format="JPEG", quality=90, subsampling=2, optimize=False, progressive=False)';
 const r=require('node:child_process').spawnSync(python,['-c',code,source,out],{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)throw Error('Pillow exit '+r.status);
 console.log(JSON.stringify({prepared:out,...dimensions(fs.readFileSync(out)),sha256:hash(fs.readFileSync(out))}));
}
function deployCloud(){
 if(!process.argv.includes('--visual-reviewed'))throw Error('Inspect prepared cloud using read_image first');
 const metaPath=safe('public/data/earth-imagery-sources.json'),metadata=JSON.parse(fs.readFileSync(metaPath,'utf8'));
 const original=fs.readFileSync(path.join(base,definitions[1].stage)),b=fs.readFileSync(path.join(base,'clean-earth-clouds-sss-4k-q90.jpg')),dim=dimensions(b),target=safe('public/data/earth-cloudfraction.jpg');
 if(dim.width!==4096||dim.height!==2048)throw Error('Unexpected cloud size');
 console.log('Verified exact cloud replacement target:',target);fs.writeFileSync(target,b);if(hash(fs.readFileSync(target))!==hash(b))throw Error('Hash mismatch');
 const a=metadata.assets.find(a=>a.role==='clouds');Object.assign(a,{bytes:b.length,sha256:hash(b),...dim,changes:'Resampled from original 8192x4096 to 4096x2048 using Pillow LANCZOS; JPEG quality90, RGB, 4:2:0 subsampling, no optimize or progressive',downloadedOriginal:{bytes:original.length,sha256:hash(original),...dimensions(original)},preparedPath:'.workbuddy/main-redesign-20261119/clean-earth-clouds-sss-4k-q90.jpg'});
 metadata.attribution='Earth textures by Solar System Scope (https://www.solarsystemscope.com/textures/), based on NASA imagery / Blue Marble; licensed CC BY 4.0. Surface unchanged; cloud texture downsampled to 4K and JPEG recompressed by Orbit.';
 metadata.verification.method='JPEG SOF dimensions, SHA-256 and byte counts; surface unchanged; clouds Pillow LANCZOS 4K/JPEG90';metadata.verification.visualReview+=' Prepared 4K cloud image separately inspected using read_image before deployment.';
 fs.writeFileSync(metaPath,JSON.stringify(metadata,null,2)+'\n');console.log(JSON.stringify(a,null,2));
}
async function stage(){fs.mkdirSync(base,{recursive:true});for(const d of definitions){const p=path.join(base,d.stage);if(fs.existsSync(p))throw Error('Staged target already exists: '+p);const response=await fetch(d.url,{signal:AbortSignal.timeout(60000),headers:{'User-Agent':'Orbit Earth texture provenance fetch'}});if(!response.ok)throw Error('HTTP '+response.status);const b=Buffer.from(await response.arrayBuffer());if(b.length<100000||b.length>35000000)throw Error('Unexpected length');const dim=dimensions(b);if(dim.width!==8192||dim.height!==4096)throw Error('Unexpected dimensions '+JSON.stringify(dim));fs.writeFileSync(p,b,{flag:'wx'});console.log(JSON.stringify({staged:p,source:response.url,bytes:b.length,sha256:hash(b),...dim}));}}
function apply(){
 if(!process.argv.includes('--visual-reviewed'))throw Error('Use read_image on both staged files before --visual-reviewed');
 const metaPath=safe('public/data/earth-imagery-sources.json');if(fs.existsSync(metaPath))throw Error('Metadata exists: inspect before modifying');
 const records=definitions.map(d=>{const staged=path.join(base,d.stage),target=safe('public/data/'+d.file),backup=path.join(base,'original-'+d.file),b=fs.readFileSync(staged),old=fs.readFileSync(target),dim=dimensions(b);if(dim.width!==8192||dim.height!==4096)throw Error('Invalid staged dimensions');if(fs.existsSync(backup))throw Error('Backup collision '+backup);return {d,staged,target,backup,b,old,dim};});
 // All paths and data checked before writing. No removals or moves.
 console.log('Verified exact replacement targets:',records.map(r=>r.target));
 for(const r of records){fs.writeFileSync(r.backup,r.old,{flag:'wx'});if(hash(fs.readFileSync(r.backup))!==hash(r.old))throw Error('Backup verification failed');}
 for(const r of records){fs.writeFileSync(r.target,r.b);if(hash(fs.readFileSync(r.target))!==hash(r.b))throw Error('Replacement verification failed');}
 const metadata={schemaVersion:1,retrievedAt:new Date().toISOString(),provider:'Solar System Scope',sourcePage:'https://www.solarsystemscope.com/textures/',license:{name:'Creative Commons Attribution 4.0 International',spdx:'CC-BY-4.0',url:'https://creativecommons.org/licenses/by/4.0/'},attribution:'Earth textures by Solar System Scope (https://www.solarsystemscope.com/textures/), based on NASA imagery / Blue Marble; licensed CC BY 4.0. No image alterations made by Orbit.',provenanceNotes:['Provider describes these as real planetary maps in equirectangular projection.','Provider says Earth maps merge/adjust geodata, space photos and NASA Blue Marble imagery; colors are saturated and seasonal vegetation/snow represent an illustrative composite.','Do not label this pair pure unmodified NASA public-domain data.','Filename earth-cloudfraction.jpg is retained for runtime compatibility; replacement is a visual cloud texture, not a calibrated cloud-fraction measurement.'],projection:{name:'equirectangular',aspectRatio:'2:1',rowOrientation:'North pole at top; south pole at bottom',columnOrientation:'Longitude increases left to right; central meridian approximately Greenwich; antimeridian at left/right edges'},verification:{visualReview:'Both staged originals inspected with read_image before replacement; coherent global continental map and cloud structures, no scrambled tile collage detected.',method:'JPEG SOF dimensions, SHA-256 and byte counts; no re-encoding or resampling',gpuOrUVValidated:false},assets:records.map(r=>({role:r.d.role,path:path.relative(root,r.target).replaceAll('\\','/'),downloadUrl:r.d.url,stagedOriginal:path.relative(root,r.staged).replaceAll('\\','/'),bytes:r.b.length,sha256:hash(r.b),...r.dim,semantics:r.d.semantics,changes:'none; downloaded JPEG bytes copied unchanged',replacedAssetBackup:{path:path.relative(root,r.backup).replaceAll('\\','/'),bytes:r.old.length,sha256:hash(r.old),...dimensions(r.old)}}))};
 fs.writeFileSync(metaPath,JSON.stringify(metadata,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(metadata,null,2));
}
(async()=>{if(process.argv[2]==='stage')await stage();else if(process.argv[2]==='prepare-cloud')prepareCloud();else if(process.argv[2]==='deploy-cloud')deployCloud();else if(process.argv[2]==='apply')apply();else throw Error('Usage: node tools/fetch-clean-earth.cjs stage | apply --visual-reviewed | prepare-cloud PYTHON_EXE | deploy-cloud --visual-reviewed');})().catch(e=>{console.error(e);process.exitCode=1;});
