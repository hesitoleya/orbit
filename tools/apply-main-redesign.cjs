'use strict';
// One reproducible source migration, backed up once. No historical candidates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Missing/nonunique '+a.slice(0,90));return s.replace(a,()=>b);};
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const backup=path.join(root,'.workbuddy','main-redesign-20261119');
const targets=['public/js/app.js','public/index.html','build.mjs','space.html','index.html','space-http.html'];
const before=Object.fromEntries(targets.map(f=>[f,read(f)]));
const formal=before['space.html'];
let imagery=formal.match(/const __earthImagery = \(function \(\) \{[\s\S]*?\n\}\)\(\);/);
if(!imagery)throw Error('Missing current imagery source');imagery=imagery[0];
const assets=[];
for(const [field,key,file] of [['tex','earthSurface','earth-surface-8k.jpg'],['wxTex','earthClouds','earth-cloudfraction.jpg']]){
 const re=new RegExp(field+": load\\('(data:image/jpeg;base64,([^']+))'\\)");
 const m=imagery.match(re);if(!m)throw Error('Missing image '+field);
 assets.push([path.join(root,'public/data',file),Buffer.from(m[2],'base64')]);
 imagery=imagery.replace(re,`${field}: load((window.__ORBIT_INLINE__||{}).${key} ? 'data:image/jpeg;base64,'+(window.__ORBIT_INLINE__||{}).${key} : './data/${file}')`);
}
let app=once(before['public/js/app.js'],'const R_EARTH = 6.371e6;','const R_EARTH = 6.371e6;\n'+imagery);
app=require('./main-scene-patch.cjs').transformApp(app);
app=require('./earth-satellite-patch.cjs').transformApp(app);
app=require('./sun-sphere-patch.cjs').transformApp(app);
new vm.SourceTextModule(app); // launched with --experimental-vm-modules
let html=before['public/index.html'];
html=html.replace(/  body\.deep-model #ui[\s\S]*?(?=<\/style>)/,'');
html=html.replace(/<section id="deepModelPanel"[\s\S]*?<\/section>\s*/,'');
html=html.replace(/\s*<button class="chip" id="deepModelBtn"[^\n]+\n/,'\n');
html=once(html,'<script src="./js/deep-models.js"></script>','<script src="./js/main-volumes.js"></script>');
let build=before['build.mjs'];
build=once(build,"html = html.replace('<script src=\"./js/deep-models.js\"></script>', () => '<script>' + read('js/deep-models.js') + '</script>');","html = html.replace('<script src=\"./js/main-volumes.js\"></script>', () => '<script>' + read('js/main-volumes.js') + '</script>');\nconst earthSurface=b64('data/earth-surface-8k.jpg');\nconst earthClouds=b64('data/earth-cloudfraction.jpg');");
build=once(build,'  terrain, climate, biome, peaks, volcanoes, gal, cos, fil, gxy, mwf, mws, mwg,','  terrain, climate, biome, peaks, volcanoes, gal, cos, fil, gxy, mwf, mws, mwg, earthSurface, earthClouds,');
if(fs.existsSync(backup))throw Error('Backup already exists; inspect before rerun');
fs.mkdirSync(backup,{recursive:true});
for(const f of targets){const dest=path.join(backup,f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,before[f],{flag:'wx'});}
for(const [file,data] of assets){if(fs.existsSync(file))throw Error('New asset collision '+file);fs.writeFileSync(file,data,{flag:'wx'});}
for(const [f,text] of [['public/js/app.js',app],['public/index.html',html],['build.mjs',build]])fs.writeFileSync(path.join(root,f),text);
const record={status:'sources-migrated-not-built',backup,oldHashes:Object.fromEntries(targets.map(f=>[f,hash(before[f])])),assets:assets.map(([p,b])=>({path:p,bytes:b.length,hash:hash(b)})),newApp:hash(app),truth:'Volume fields are illustrative, satellite imagery is observational composite'};
fs.writeFileSync(path.join(backup,'migration.json'),JSON.stringify(record,null,2),{flag:'wx'});
console.log(JSON.stringify(record,null,2));
