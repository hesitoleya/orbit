'use strict';
// 仅在内存修改源码，预览与结果写入 tools 子目录；不修改正式源和入口。
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'coordinate-candidate-'+randomUUID());
fs.mkdirSync(output);const reportPath=path.join(output,'report.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
const inputs=['build.mjs','public/index.html','public/js/app.js','space.html','index.html','space-http.html','tools/test-deep-models.cjs'];
const result={status:'incomplete',errors:[],inputHashes:Object.fromEntries(inputs.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]))};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){let i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一：'+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function candidate(s){
 s=once(s,'return out.set(gx, gz, -gy).multiplyScalar(dist);','return out.set(-gx, gz, -gy).multiplyScalar(dist);');
 s=once(s,'/* ---------------- 星系目录 ----------------',`/* 方向保持纯向量；日心距离转换为银心坐标，单位须与 dist 一致。 */\nfunction galPosition(ra, dec, dist, sunOffset, out) {\n  return galWorld(ra, dec, dist, out).addScaledVector(SUN_GAL, sunOffset / C_KPC / 8.15);\n}\n\n/* ---------------- 星系目录 ----------------`);
 s=once(s,'galWorld(ra, dec, d, _filV);','galPosition(ra, dec, d, 0.00815, _filV);');
 s=once(s,'galWorld(ra, dec, d, v);','galPosition(ra, dec, d, 0.00815, v);');
 const pos='galWorld(ra, dec, mly * C_MLY, new THREE.Vector3())';
 if(s.split(pos).length!==3)throw Error('星系/大尺度目录数量变化');
 s=s.split(pos).join('galPosition(ra, dec, mly * C_MLY, 8.15 * C_KPC, new THREE.Vector3())');
 s=once(s,'WEB_NODES.map(n => galWorld(n[1], n[2], n[3], new THREE.Vector3()))','WEB_NODES.map(n => galPosition(n[1], n[2], n[3], 0.00815, new THREE.Vector3()))');
 s=once(s,'a.position.copy(galWorld(nd[1], nd[2], nd[3], new THREE.Vector3()));','a.position.copy(galPosition(nd[1], nd[2], nd[3], 0.00815, new THREE.Vector3()));');
 s=once(s,'const m31 = galWorld(10.685, 41.269, 2.54 * C_MLY, new THREE.Vector3());','const m31 = galPosition(10.685, 41.269, 2.54 * C_MLY, 8.15 * C_KPC, new THREE.Vector3());');
 s=once(s,'pos = galWorld(r[4], r[5], r[6] * C_MLY, new THREE.Vector3());','pos = galPosition(r[4], r[5], r[6] * C_MLY, 8.15 * C_KPC, new THREE.Vector3());');
 s=once(s,'if (a) { pos = a.obj.position.clone(); dia = a.dia; }','if (a) { pos = a.obj.position.clone().multiplyScalar(C_MPC); dia = a.dia; }');
 s=once(s,'const mly = Math.hypot(d.pos.x, d.pos.y, d.pos.z) / C_MLY;','const mly = d.pos.distanceTo(SUN_GAL) / C_MLY;');
 s=once(s,'window.__SE = {','window.__SE = { __coord:{galWorld,galPosition,cosmicBuild,cosmicUpdate,GA,SUN_GAL,C_KPC,C_MPC,C_MLY,STAR_B64,MWGC_LIST,COSMO_CAT,decodeFilaments,decodeGalaxies,cosmicAimLocal,selectCatalog:(item)=>select(item)},');
 // select 位于目录 IIFE 内，不能在全局引用；在其作用域暴露测试入口。
 s=once(s,'selectCatalog:(item)=>select(item)','getCatalogSelect:()=>window.__candidateSelect');
 s=once(s,'  function select(it) {','  window.__candidateSelect = select;\n  function select(it) {');
 s=once(s,'function warpOr(fn, dur, fallback, pull) {','function warpOr(fn, dur, fallback, pull) {\n  if (window.__coordinateImmediate) { fn(); return true; }');
 return s;
}
async function build(){let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);b=once(b,"const app = read('js/app.js');",`const app = candidate(read('js/app.js'));`);b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))},htmlOffline,{flag:'wx'});`);globalThis.candidate=candidate;try{await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));}finally{delete globalThis.candidate;}result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));}
function probe(){
 const p=__SE.__coord,T=__SE.THREE,cs=__SE.CS,V=(...x)=>new T.Vector3(...x),sun=p.SUN_GAL;
 p.cosmicBuild();const ang=(a,b)=>Math.atan2(a.clone().cross(b).length(),a.dot(b))*180/Math.PI;
 const gc=p.galWorld(266.40510,-28.936175,1,V());
 const clusters=p.MWGC_LIST.map((r,i)=>{const expected=V(-r[7],r[9],r[8]);const actual=p.galWorld(r[2]*15,r[3],r[4],V());return {name:r[0],expected:expected.toArray(),actual:actual.toArray(),angle:ang(expected,actual),distanceError:expected.distanceTo(actual),bufferError:V().fromArray(cs.gcKpc,i*3).distanceTo(expected.clone().add(V(8.15,0,0)))};});
 const galaxies=cs.gals.slice(0,4).map((g,i)=>{let r=__SE.GAL_CAT[i],dir=p.galWorld(r[1],r[2],1,V()),actual=g.userData.pos.clone().sub(sun);cs.flyTo(g);return {name:r[0],angle:ang(dir,actual),distanceRatio:actual.length()/(r[3]*p.C_MLY),navigationError:cs.target.distanceTo(g.userData.pos)};});
 const b=atob(p.STAR_B64);
 const attr=cs.localStars.obj.geometry.attributes.position;const stars=[];for(let i of [0,1,50,500,1000,3000,6000]){const byte=j=>b.charCodeAt(i*6+j),ra=(byte(0)*256+byte(1))/65535*360,dec=(byte(2)*256+byte(3))/65535*180-90;const a=V().fromBufferAttribute(attr,i).sub(V(8.15,0,0));stars.push({i,relativeKpc:a.toArray(),angle:ang(a,p.galWorld(ra,dec,1,V())),finite:a.length()>0});}
 const web=__SE.WEB_NODES[0],anchor=cs.cosAnchors.find(a=>a.obj.userData.name===web[0]),webExpected=p.galPosition(web[1],web[2],web[3],0.00815,V());
 const fb=new ArrayBuffer(12),fd=new DataView(fb);fd.setUint32(0,1,true);fd.setUint16(4,1,true);fd.setUint16(6,0,true);fd.setUint16(8,32768,true);fd.setUint16(10,10000,true);const fp=V().fromArray(p.decodeFilaments(fb)[0]),fexp=p.galPosition(0,32768/65535*180-90,10000/65535*900/0.7,0.00815,V());
 const gb=new ArrayBuffer(17),gd=new DataView(gb);gd.setUint8(0,71);gd.setUint8(1,88);gd.setUint8(2,89);gd.setUint8(3,49);gd.setUint32(4,1,true);gd.setFloat32(8,700,true);const packed=2000*268435456+2048*65536+1000*32+15;gd.setUint32(12,packed%4294967296,true);gd.setUint8(16,Math.floor(packed/4294967296));const gp=V().fromArray(p.decodeGalaxies(gb).pos),gexp=p.galPosition(2000/4095*360,2048/4095*180-90,1000/2047*700,0.00815,V());
 const row=p.COSMO_CAT.find(r=>r[0]==='sgra'),obj=cs.cosItems.find(o=>o.userData.name===row[1]);
 p.cosmicUpdate(0);const anchorError=anchor.obj.position.distanceTo(webExpected);
 window.__coordinateImmediate=true;
 const select=p.getCatalogSelect();select({name:row[1],type:'黑洞',desc:'',meta:'',cat:'cosmic',cosKey:'sgra'});const cosNav=cs.target.distanceTo(obj.userData.pos);
 select({name:web[0],type:'节点',desc:'',meta:'',cat:'cosmic',webName:web[0]});const webNav=cs.target.distanceTo(webExpected.clone().multiplyScalar(p.C_MPC));
 const cluster=p.MWGC_LIST[0];__SE.focusCluster(cluster[0]);const clusterNav=cs.target.distanceTo(V(8.15-cluster[7],cluster[9],cluster[8]).multiplyScalar(p.C_KPC));
 const label=cs.labels.find(x=>x.gc&&x.el.textContent===cluster[0]);label.el.click();const clusterLabelNav=cs.target.distanceTo(V().fromArray(cs.gcKpc,0).multiplyScalar(p.C_KPC));
 const galaxyLabel=cs.labels.find(x=>x.m===cs.gals[0]);galaxyLabel.el.click();const galaxyLabelNav=cs.target.distanceTo(cs.gals[0].userData.pos);window.__coordinateImmediate=false;
 return {gc:gc.toArray(),galaxies,clusterCount:clusters.length,clusterWorst:clusters.sort((a,b)=>b.angle-a.angle).slice(0,5),clusterMaxBuffer:Math.max(...clusters.map(x=>x.bufferError)),stars,web:{name:web[0],anchorError,anchorMpc:webExpected.toArray()},sgra:{positionKpc:obj.userData.pos.clone().divideScalar(p.C_KPC).toArray(),distanceToCenterKpc:obj.userData.pos.length()/p.C_KPC},navigation:{cosNav,webNav,clusterNav,clusterLabelNav,galaxyLabelNav},decodeMpc:{filamentError:fp.distanceTo(fexp),galaxyError:gp.distanceTo(gexp)},catalogSelectorAvailable:typeof select==='function'};
}
async function run(){await build();const framework=path.join(root,'tools/test-deep-models.cjs');let src=fs.readFileSync(framework,'utf8');src=src.slice(0,src.indexOf('async function main() {')).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
const driver=`(async()=>{try{await launch();await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');await frames(3);result.measurement=await evaluate('('+probe.toString()+')()');let m=result.measurement;result.checks={gcAxis:m.gc[0]<-0.999999&&Math.abs(m.gc[1])<0.00001,galaxies:m.galaxies.every(x=>x.angle<0.00001&&Math.abs(x.distanceRatio-1)<0.000002&&x.navigationError===0),clusters:m.clusterCount>100&&m.clusterWorst[0].angle<1.2&&m.clusterMaxBuffer<0.00002,stars:m.stars.every(x=>x.finite&&x.angle<0.002),webAnchor:m.web.anchorError<1e-9,catalogSelector:m.catalogSelectorAvailable,navigation:Object.values(m.navigation).every(x=>x<1e10),decodeMpc:Object.values(m.decodeMpc).every(x=>x<0.0001)};result.status=Object.values(result.checks).every(Boolean)?'passed-limited':'failed';}catch(e){result.errors.push({phase,error:errorText(e)});result.status='failed';}finally{result.driver={browser:report.browser,gpu:report.gpu,errors:report.errors};if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();result.changedInputs=Object.entries(result.inputHashes).filter(([f,h])=>hash(fs.readFileSync(path.join(root,f)))!==h).map(([f])=>f);if(result.changedInputs.length||result.errors.length||report.errors.length)result.status='failed';save();console.log(JSON.stringify({report:reportPath,status:result.status,checks:result.checks,errors:result.errors},null,2));if(result.status==='failed')process.exitCode=1;}})();`;
vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,probe,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,probe,reportPath,root);}
save();run().catch(e=>{result.status='failed';result.errors.push({error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors},null,2));process.exitCode=1;});
