'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-axis-calibration-'+randomUUID());
fs.mkdirSync(output);const reportPath=path.join(output,'report.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'incomplete',errors:[],limitations:['独立源码预览，强制构建宇宙层并 seek 至 lg=19.98，不是自然同帧跨层或正式入口验收。','投影为 Three.js 测试相机投影的中心几何，不是最终 GPU 像素、遮挡或生产后处理。','星空主侧为相机中心的无视差球，宇宙近星使用估计距离和随尺度变化的 shader/对象偏移；不可当成同一真实三维位置。','星系宇宙目录实际 pos 未加 SUN_GAL，不能把方向变换直接当作物理位置映射；距离和目录精度有差异。宇宙更新使用人为机位，并非该尺度自然活动路径。']};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){const i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一: '+a);return s.slice(0,i)+b+s.slice(i+a.length);}
function probe(){
 const s=__SE,p=s.__axis,T=s.THREE,cs=s.CS; p.cosmicBuild();
 const V=(...a)=>new T.Vector3(...a), unit=v=>v.clone().normalize();
 const angle=(a,b)=>Math.atan2(new T.Vector3().crossVectors(a,b).length(),a.dot(b))*180/Math.PI;
 const map=v=>V(v.dot(p.GA.gc),v.dot(p.GA.ngp),-v.dot(p.GA.yg));
 const axes=[V(1,0,0),V(0,1,0),V(0,0,1)].map(map);
 const det=axes[0].dot(new T.Vector3().crossVectors(axes[1],axes[2]));
 const neg=v=>V(v.x,v.y,-v.z), sky=s.starfield;
 sky.updateMatrixWorld(true);cs.scene.updateMatrixWorld(true);
 const dir=(ra,dec)=>{ra*=Math.PI/180;dec*=Math.PI/180;return V(Math.cos(dec)*Math.cos(ra),Math.sin(dec),Math.cos(dec)*Math.sin(ra));};
 const bin=atob(p.STAR_B64),counts=[0,0,0,0,0,0],max=[1.2,2.6,3.6,4.6,5.4,9.9],stars=[];
 const picks=[0,1,50,500,1000,3000,6000];
 for(let i=0;i<Math.floor(bin.length/6);i++){
  const b=j=>bin.charCodeAt(i*6+j),ra=(b(0)*256+b(1))/65535*360,dec=(b(2)*256+b(3))/65535*180-90,mag=b(4)/255*8.7-1.5;let k=0;while(k<5&&mag>max[k])k++;const j=counts[k]++;
  if(!picks.includes(i))continue;
  const attr=sky.children[k].geometry.attributes.position,main=V().fromBufferAttribute(attr,j).transformDirection(sky.children[k].matrixWorld),loc=V().fromBufferAttribute(cs.localStars.obj.geometry.attributes.position,i).sub(V(8.15,0,0)),expected=map(main);
  stars.push({i,ra,dec,mag,bucket:k,mainDirection:main.toArray(),cosmosBufferRelativeSunKpc:loc.toArray(),mappingErrorDeg:angle(expected,loc),identityErrorDeg:angle(main,loc),signFlipErrorDeg:angle(neg(expected),loc)});
 }
 const cameraFor=(forward,up)=>{const c=new T.PerspectiveCamera(50,1.5,0.01,1e9);c.position.set(0,0,0);c.up.copy(up);c.lookAt(forward);c.updateMatrixWorld(true);c.updateProjectionMatrix();return c;};
 cs.orbitR=2e20;cs.theta=0;cs.phi=0;cs.target.set(0,0,0);cs.autoCenter=false;p.cosmicUpdate(0);cs.scene.updateMatrixWorld(true);
 const project=(v,c)=>v.clone().multiplyScalar(1e6).project(c).toArray();
 const galaxies=['仙女座星系 M31','三角座星系 M33','大麦哲伦云','小麦哲伦云'].map(name=>{
  const nb=window.__NEB.find(n=>n.n===name),idx=p.GAL_CAT.findIndex(r=>r[0]===name),row=p.GAL_CAT[idx],m=cs.gals[idx];
  const main=nb.sprite.getWorldPosition(V()).sub(s.camera.position).normalize(),catalogDir=unit(p.galWorld(row[1],row[2],1,V())),mapped=unit(map(main)),actual=unit(m.userData.pos),fromSun=unit(m.userData.pos.clone().sub(p.SUN_GAL));
  const up=Math.abs(main.y)>0.95?V(1,0,0):V(0,1,0),camA=cameraFor(main,up),camB=cameraFor(map(main),map(up)),camBad=cameraFor(main,up);
  const a=project(main,camA),b=project(catalogDir,camB),bad=project(catalogDir,camBad);
  const renderPoint=V().fromBufferAttribute(cs.galPts.geometry.attributes.position,idx),meshPosition=m.getWorldPosition(V());
  return {name,renderPoint:renderPoint.toArray(),meshPosition:meshPosition.toArray(),renderPointMeshDelta:renderPoint.distanceTo(meshPosition),galPointVisible:cs.galPts.visible,mainHours:nb.ra,mainDec:nb.dec,cosmosRA:row[1],cosmosDec:row[2],mainDirection:main.toArray(),actualCatalogPositionMeters:m.userData.pos.toArray(),galWorldDirection:catalogDir.toArray(),directionErrorDeg:angle(mapped,catalogDir),actualOriginDirectionErrorDeg:angle(mapped,actual),actualSunRelativeErrorDeg:angle(mapped,fromSun),identityErrorDeg:angle(main,catalogDir),mainNdc:a,mappedNdc:b,identityCameraNdc:bad,ndcDelta:Math.hypot(a[0]-b[0],a[1]-b[1]),identityNdcDelta:Math.hypot(a[0]-bad[0],a[1]-bad[1]),meshVisible:m.visible,mainSpriteVisible:nb.sprite.visible};
 });
 const basisError=Math.max(...axes.map(x=>Math.abs(x.length()-1)),Math.abs(axes[0].dot(axes[1])),Math.abs(axes[0].dot(axes[2])),Math.abs(axes[1].dot(axes[2])));
 const transformedSunCenter=p.galWorld(266.40510,-28.936175,1,V());
 return {axes:axes.map(x=>x.toArray()),determinant:det,basisError,sun:p.SUN_GAL.toArray(),galacticCenterDirectionWorld:transformedSunCenter.toArray(),stars,galaxies,sceneState:{lg:p.JOURNEY.lg,active:cs.active,starfieldVisible:sky.visible,starfieldPosition:sky.position.toArray(),cameraPosition:s.camera.position.toArray(),localVisible:cs.localStars.obj.visible,localObjectPosition:cs.localStars.obj.position.toArray(),localUniforms:{scale:cs.localStars.mat.uniforms.uScale.value,cam:cs.localStars.mat.uniforms.uCam.value.toArray(),gain:cs.localStars.mat.uniforms.uGain.value},galPtsVisible:cs.galPts.visible}};
}
async function run(){
 const files=['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs','tools/p2-axis-calibration-independent-20261117.cjs'];result.inputHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);
 b=once(b,"const app = read('js/app.js');",`const app = read('js/app.js').replace('window.__SE = {', 'window.__SE = { __axis:{cosmicBuild,cosmicUpdate,GA,galWorld,GAL_CAT,SUN_GAL,STAR_B64,JOURNEY,timeAtLg:cineTimeAtLg},');`);
 b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))},htmlOffline,{flag:'wx'});`);
 await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
 const framework=path.join(root,'tools/test-deep-models.cjs');let src=fs.readFileSync(framework,'utf8');src=src.slice(0,src.indexOf('async function main() {')).replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{await launch();await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');await evaluate('__SE.journey(0);__SE.ts=0;__SE.journeySeek(__SE.__axis.timeAtLg(19.98));true');await frames(3);result.measurement=await evaluate('('+probe.toString()+')()');const m=result.measurement;result.checks={axesOrthonormal:m.basisError<1e-5,starCount:m.stars.length===7,starsMapped:m.stars.every(x=>x.mappingErrorDeg<0.001),starIdentityNegative:m.stars.some(x=>x.identityErrorDeg>10),starSignNegative:m.stars.some(x=>x.signFlipErrorDeg>10),galaxyCount:m.galaxies.length===4,galaxyDirection:m.galaxies.every(x=>x.directionErrorDeg<0.1),projectionNegative:m.galaxies.some(x=>x.identityNdcDelta>0.1)};result.status=Object.values(result.checks).every(Boolean)?'measured-not-validation':'failed';}catch(e){result.errors.push({phase,error:errorText(e)});result.status='failed';}finally{result.driver={browser:report.browser,gpu:report.gpu,errors:report.errors};if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}else if(child&&child.exitCode===null)child.kill();result.changedInputs=[];for(const [f,h] of Object.entries(result.inputHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.changedInputs.push(f);if(result.changedInputs.length||result.errors.length||report.errors.length)result.status='failed';save();console.log(JSON.stringify({report:reportPath,status:result.status,checks:result.checks,errors:result.errors,driverErrors:report.errors},null,2));if(result.status==='failed')process.exitCode=1;}})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,probe,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,probe,reportPath,root);
}
save();run().catch(e=>{result.errors.push({phase:'构建或初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors}));process.exitCode=1;});
