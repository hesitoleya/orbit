'use strict';
/* 坐标合并验证：以【当前正式源码】构建独立插桩预览（不覆盖正式入口），
 * 浏览器实测：银心方向、已知银道坐标天体、星系目录/近星/球团/宇宙网位置、
 * 目录导航、星系位置角（PA 镜像手性）、CMB 偶极、自然旅程跨层相邻帧连续性、
 * 关键站截图非黑。插桩只加只读导出与采样，不改产品逻辑。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-coordinate-merge-'+randomUUID());
fs.mkdirSync(output);const reportPath=path.join(output,'report.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'incomplete',output,startedAt:new Date().toISOString(),samples:[],errors:[],limitations:[
 '插桩预览基于当前正式源码；采样为只读导出与每帧记录，不改变产品逻辑。',
 'PA 检查验证四元数与目录位置角的一致性，不验证照片纹理内部旋转或视觉形态。',
 '跨层相邻帧含时间推进；方向/up 连续性是数值连续，画面内容硬切是已知遗留问题。',
 '截图只验证非黑与有结构，不替代用户视觉会审、其他设备或浏览器验证。',
 '旅程 seek 截图使用冻结帧路径，不代表自然播放逐帧表现。']};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}
function once(s,a,b){let i=s.indexOf(a);if(i<0||s.indexOf(a,i+a.length)>=0)throw Error('替换点缺失或不唯一: '+a);return s.slice(0,i)+b+s.slice(i+a.length);}

/* 自然跨层相邻帧采样（与 p2-physical-camera-probe 同一方法） */
function measure(){
 if(!JOURNEY.on||!JOURNEY.cine)return;
 const c=CS.active?CS.cam:camera;
 const x={frame:frameId,now:performance.now(),lg:JOURNEY.lg,active:CS.active,
   target:CS.target.toArray(),orbitR:CS.orbitR,theta:CS.theta,phi:CS.phi,
   direction:c.getWorldDirection(new THREE.Vector3()).toArray(),
   up:c.up.toArray(),
   effectiveUp:new THREE.Vector3(0,1,0).applyQuaternion(c.getWorldQuaternion(new THREE.Quaternion())).toArray()};
 if(!CS.active&&JOURNEY.lg<20)window.__physicalBefore=x;
 if(CS.active&&JOURNEY.lg>=20&&!window.__physicalAfter){window.__physicalAfter=x;window.__physicalPair={before:window.__physicalBefore||null,after:x};}
}

/* 页内测量：全部走产品实际构建结果 */
function probe(){
 const p=window.__coord,T=window.__SE.THREE,cs=window.__SE.CS,V=(...x)=>new T.Vector3(...x),sun=p.SUN_GAL;
 p.cosmicBuild();
 const DEG=Math.PI/180;
 const ang=(a,b)=>Math.atan2(a.clone().cross(b).length(),a.dot(b))*180/Math.PI;
 /* A. 银心方向 → 世界 -X */
 const gc=p.galWorld(266.40510,-28.936175,1,V()).toArray();
 /* B. 独立银道标准：公开 (l,b) → 期望世界方向。
    GA.yg=ngp×gc 指向 l=270（与标准 ĝ₂ 反号），故真实银道 (l,b) 映射为
    (-cosb·cosl, sinb, +cosb·sinl) —— Z 为正，别照抄叉乘符号（本轮踩过）。 */
 const lb=(l,b)=>V(-Math.cos(b*DEG)*Math.cos(l*DEG),Math.sin(b*DEG),Math.cos(b*DEG)*Math.sin(l*DEG));
 const known=[['M31',10.685,41.269,121.17,-21.52],['M33',23.462,30.660,133.59,-31.33],
   ['LMC',80.894,-69.756,280.46,-32.89],['SMC',13.187,-72.829,302.80,-44.30],
   ['SgrA*',266.4168,-29.0078,359.94417,-0.04617]];
 const knownDirs=known.map(k=>({name:k[0],angle:ang(p.galWorld(k[1],k[2],1,V()),lb(k[3],k[4]))}));
 /* C. 星系目录：位置-太阳 ∥ galWorld 方向，距离比 1（GAL_CAT 与 CS.gals 同序） */
 const galN=Math.min(p.GAL_CAT.length,cs.gals.length);
 const galaxies=[];
 for(let i=0;i<galN;i++){
   const r=p.GAL_CAT[i],g=cs.gals[i];
   const rel=g.userData.pos.clone().sub(sun);
   const dir=p.galWorld(r[1],r[2],1,V());
   galaxies.push({i,name:r[0],angle:ang(rel,dir),ratio:rel.length()/(r[3]*p.C_MLY)});
 }
 const galWorst=[...galaxies].sort((a,b)=>b.angle-a.angle).slice(0,5);
 const galMaxAngle=Math.max(...galaxies.map(x=>x.angle));
 const galMaxRatioErr=Math.max(...galaxies.map(x=>Math.abs(x.ratio-1)));
 /* D. 球状星团：缓冲 vs (8.15-X, Z, Y) kpc；RA 为小时（×15） */
 const clusters=p.MWGC_LIST.map((r,i)=>{
   const expected=V(-r[7],r[9],r[8]);
   const actual=p.galWorld(r[2]*15,r[3],r[4],V());
   return {name:r[0],angle:ang(expected,actual),
     bufferError:V().fromArray(cs.gcKpc,i*3).distanceTo(expected.clone().add(V(8.15,0,0)))};
 });
 const clusterMaxAngle=Math.max(...clusters.map(x=>x.angle));
 const clusterMaxBuffer=Math.max(...clusters.map(x=>x.bufferError));
 /* E. 近星：顶点-太阳 ∥ galWorld(星表方向) */
 const b=atob(p.STAR_B64),attr=cs.localStars.obj.geometry.attributes.position,stars=[];
 for(let i of [0,1,50,500,1000,3000,6000]){
   const byte=j=>b.charCodeAt(i*6+j),ra=(byte(0)*256+byte(1))/65535*360,dec=(byte(2)*256+byte(3))/65535*180-90;
   const a=V().fromBufferAttribute(attr,i).sub(V(8.15,0,0));
   stars.push({i,angle:ang(a,p.galWorld(ra,dec,1,V())),finite:a.length()>0});
 }
 /* F. 宇宙网锚点与导航 */
 const web=p.WEB_NODES[0];
 const anchor=cs.cosAnchors.find(a=>a.obj.userData.name===web[0]);
 const webExpected=p.galPosition(web[1],web[2],web[3],0.00815,V());
 const anchorError=anchor?anchor.obj.position.distanceTo(webExpected):-1;
 const row=p.COSMO_CAT.find(r=>r[0]==='sgra'),obj=cs.cosItems.find(o=>o.userData.name===row[1]);
 p.cosmicUpdate(0);
 window.__coordinateImmediate=true;
 const select=window.__candidateSelect;
 select({name:row[1],type:'黑洞',desc:'',meta:'',cat:'cosmic',cosKey:'sgra'});
 const cosNav=cs.target.distanceTo(obj.userData.pos);
 select({name:web[0],type:'节点',desc:'',meta:'',cat:'cosmic',webName:web[0]});
 const webNav=cs.target.distanceTo(webExpected.clone().multiplyScalar(p.C_MPC));
 const cl=p.MWGC_LIST[0];window.__SE.focusCluster(cl[0]);
 const clusterNav=cs.target.distanceTo(V(8.15-cl[7],cl[9],cl[8]).multiplyScalar(p.C_KPC));
 const gLabel=cs.labels.find(x=>x.m===cs.gals[0]);
 if(gLabel)gLabel.el.click();
 const galLabelNav=cs.target.distanceTo(cs.gals[0].userData.pos);
 window.__coordinateImmediate=false;
 /* G. 姿态：镜像共轭轴一致性 —— 长轴线必须等于 RY(-pa)·X̂（信息项：表观 PA）。
    旧实现的 Euler(incl,pa) 本就不是严格 PA 构造（盘面平躺世界 XZ 面），
    本轮只要求镜像换算精确保留旧视觉语言，表观 PA 变化记录不判失败。 */
 const paChecks=[];
 for(let i=0;i<galN;i++){
   const r=p.GAL_CAT[i],g=cs.gals[i],pa=r[7];
   if(!(pa>5&&pa<175))continue;
   const P=g.userData.pos,Vv=P.clone().sub(sun).normalize();
   if(Math.abs(Vv.y)>0.9)continue;
   const nrm=V(0,1,0).sub(Vv.clone().multiplyScalar(Vv.y)).normalize();
   const a=r[1]*DEG;
   const eEq=V(-Math.sin(a),0,Math.cos(a));
   const eW=V(-eEq.dot(p.GA.gc),eEq.dot(p.GA.ngp),-eEq.dot(p.GA.yg));
   const e=eW.sub(Vv.clone().multiplyScalar(eW.dot(Vv))).normalize();
   const ax=V(1,0,0).applyQuaternion(g.quaternion);
   const ap=ax.clone().sub(Vv.clone().multiplyScalar(ax.dot(Vv)));
   let m=Math.atan2(ap.dot(e),ap.dot(nrm))/DEG;while(m<0)m+=180;
   /* 期望长轴线（不受 incl 影响）：Euler(-incl,-pa,'YXZ') 作用于 X̂ */
   const exp=V(1,0,0).applyQuaternion(new T.Quaternion().setFromEuler(new T.Euler(-Math.min(r[6]*DEG*0.18,0.30),-pa*DEG,0,'YXZ')));
   const axErr=Math.min(ang(ax,exp),ang(ax,exp.clone().multiplyScalar(-1)));
   paChecks.push({i,name:r[0],catalogPa:pa,apparentPa:m,axisErrorDeg:axErr});
 }
 const paMax=Math.max(...paChecks.map(x=>x.axisErrorDeg));
 const paWorst=[...paChecks].sort((a,b)=>b.axisErrorDeg-a.axisErrorDeg).slice(0,5);
 /* H. CMB 偶极 */
 const dip=cs.cmbMat&&cs.cmbMat.uniforms.uDip?cs.cmbMat.uniforms.uDip.value.toArray():null;
 const dipErr=dip?ang(V().fromArray(dip),lb(264,48)):-1;
 /* I. 二进制解码（人工记录走真实解码路径） */
 const fb=new ArrayBuffer(12),fd=new DataView(fb);fd.setUint32(0,1,true);fd.setUint16(4,1,true);fd.setUint16(6,0,true);fd.setUint16(8,32768,true);fd.setUint16(10,10000,true);
 const fp=V().fromArray(p.decodeFilaments(fb)[0]);
 const fexp=p.galPosition(0,32768/65535*180-90,10000/65535*900/0.7,0.00815,V());
 const gb=new ArrayBuffer(17),gd=new DataView(gb);gd.setUint8(0,71);gd.setUint8(1,88);gd.setUint8(2,89);gd.setUint8(3,49);gd.setUint32(4,1,true);gd.setFloat32(8,700,true);
 const packed=2000*268435456+2048*65536+1000*32+15;gd.setUint32(12,packed%4294967296,true);gd.setUint8(16,Math.floor(packed/4294967296));
 const gp=V().fromArray(p.decodeGalaxies(gb).pos);
 const gexp=p.galPosition(2000/4095*360,2048/4095*180-90,1000/2047*700,0.00815,V());
 return {gc,knownDirs,galaxyCount:galN,galMaxAngle,galMaxRatioErr,galWorst,
   clusterCount:clusters.length,clusterMaxAngle,clusterMaxBuffer,
   clusterWorst:[...clusters].sort((a,b)=>b.angle-a.angle).slice(0,5),
   stars,web:{name:web[0],anchorError},navigation:{cosNav,webNav,clusterNav,galLabelNav},
   paCount:paChecks.length,paMax,paWorst,dip,dipErr,
   decodeMpc:{filament:fp.distanceTo(fexp),galaxy:gp.distanceTo(gexp)}};
}

async function run(){
 const files=['build.mjs','public/index.html','public/js/app.js','tools/test-deep-models.cjs','tools/p2-coordinate-merge-validation-20261117.cjs'];
 result.inputHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 let b=fs.readFileSync(path.join(root,'build.mjs'),'utf8').replace(/\r\n/g,'\n');
 b=once(b,'const ROOT = path.dirname(fileURLToPath(import.meta.url));',`const ROOT = ${JSON.stringify(root)};`);
 const edits=`const app = read('js/app.js').replace(/\\r\\n/g,'\\n')\n .replace('window.__SE = {', ${JSON.stringify('window.__coord={galWorld,galPosition,GA,SUN_GAL,C_KPC,C_MPC,C_MLY,STAR_B64,MWGC_LIST,GAL_CAT,WEB_NODES,COSMO_CAT,decodeFilaments,decodeGalaxies,cosmicBuild,cosmicUpdate,cineTimeAtLg,camAbsNow:()=>camAbs.toArray()};\nfunction __coordMeasure(){'+measure.toString().slice('function measure(){'.length,-1)+'}\nwindow.__SE = {')})\n .replace('  function select(it) {', ${JSON.stringify('  window.__candidateSelect = select;\n  function select(it) {')})\n .replace('function warpOr(fn, dur, fallback, pull) {', ${JSON.stringify('function warpOr(fn, dur, fallback, pull) {\n  if (window.__coordinateImmediate) { fn(); return true; }')})\n .replace('    cosmicUpdate(dt);\\n    renderFrame(CS.scene, CS.cam);','    cosmicUpdate(dt);\\n    __coordMeasure();\\n    renderFrame(CS.scene, CS.cam);')\n .replace('  placeCamera();\\n  /* 对话 139','  placeCamera();\\n  __coordMeasure();\\n  /* 对话 139');`;
 b=once(b,"const app = read('js/app.js');",edits);
 b=once(b,`for (const name of ['space.html', 'index.html']) {\n  fs.writeFileSync(path.join(ROOT, name), htmlOffline);\n}\nfs.writeFileSync(path.join(ROOT, 'space-http.html'), htmlHttp);`,`fs.writeFileSync(${JSON.stringify(path.join(output,'preview.html'))},htmlOffline,{flag:'wx'});`);
 await import('data:text/javascript;base64,'+Buffer.from(b).toString('base64'));
 result.previewSha256=hash(fs.readFileSync(path.join(output,'preview.html')));
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let src=fs.readFileSync(framework,'utf8');
 src=src.slice(0,src.indexOf('async function main() {'))
   .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{
  await launch();
  await load(pathToFileURL(path.join(output,'preview.html')).href+'?auto=0&q=high&prewarm=0','file');
  await frames(3);
  phase='坐标测量';
  const m=await evaluate('('+probe.toString()+')()');
  result.measurement=m;
  result.checks={
    gcAxis:m.gc[0]<-0.999999&&Math.abs(m.gc[1])<1e-4&&Math.abs(m.gc[2])<1e-4,
    knownDirs:m.knownDirs.every(x=>x.angle<0.1),
    galaxies:m.galMaxAngle<1e-4&&m.galMaxRatioErr<1e-4,
    clusters:m.clusterCount>100&&m.clusterMaxAngle<1.2&&m.clusterMaxBuffer<2e-5,
    stars:m.stars.every(x=>x.finite&&x.angle<0.002),
    webAnchor:m.web.anchorError<1e-6,
    navigation:Object.values(m.navigation).every(x=>x<1e-6),
    positionAngle:m.paCount>=5&&m.paMax<1e-6,
    cmbDipole:m.dipErr<1e-4,
    decodeMpc:m.decodeMpc.filament<1e-3&&m.decodeMpc.galaxy<1e-3
  };
  phase='自然跨层';
  await evaluate('window.__SE.journey(0);true');
  await until('自然跨层采样',()=>evaluate('window.__physicalPair||null'),120000);
  const pair=await evaluate('window.__physicalPair');
  result.samples.push(pair);
  const sub=(x,y)=>x.map((v,i)=>v-y[i]),norm=x=>Math.hypot(...x),
        angle=(x,y)=>Math.acos(Math.max(-1,Math.min(1,x.reduce((t,v,i)=>t+v*y[i],0)/(norm(x)*norm(y)))))*180/Math.PI;
  const a=pair.before,c=pair.after;
  result.crossLayer={directionDegrees:angle(a.direction,c.direction),effectiveUpDegrees:angle(a.effectiveUp,c.effectiveUp),
    upPropertyDegrees:angle(a.up,c.up),frameDelta:c.frame-a.frame,beforeLg:a.lg,afterLg:c.lg,beforeActive:a.active,afterActive:c.active};
  result.checks.crossLayer=result.crossLayer.frameDelta===1&&!a.active&&c.active
    &&result.crossLayer.directionDegrees<0.001&&result.crossLayer.effectiveUpDegrees<0.01;
  await evaluate('window.__SE.journeyStop();true');
  phase='站点截图';
  await evaluate('__SE.journeySeek(__coord.cineTimeAtLg(20.45));true');await frames(3);
  result.shotGalaxy=await capture('p2-coord-merge-galaxy');
  await evaluate('__SE.journeySeek(__coord.cineTimeAtLg(24.45));true');await frames(3);
  result.shotVirgo=await capture('p2-coord-merge-virgo');
  result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors};
  if(report.errors.length)throw Error('浏览器记录错误');
  const failed=Object.entries(result.checks).filter(([k,v])=>!v).map(([k])=>k);
  result.status=failed.length?('failed:'+failed.join(',')):'passed-limited';
 }catch(e){
  result.errors.push({phase,error:errorText(e)});
  try{result.diagnostic=await evaluate('({journey:__SE.journeyInfo,pair:window.__physicalPair||null})');}catch(_){}
  result.driver={browser:report.browser,errors:report.errors};
 }finally{
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}
  else if(child&&child.exitCode===null)child.kill();
  for(const [f,h] of Object.entries(result.inputHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});
  if(result.errors.length)result.status='incomplete';
  result.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({report:reportPath,status:result.status,checks:result.checks,crossLayer:result.crossLayer,paMax:result.measurement&&result.measurement.paMax,errors:result.errors},null,2));
  process.exitCode=(result.status==='passed-limited')?0:1;
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,probe,reportPath,root){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,probe,reportPath,root);
}
save();run().catch(e=>{result.errors.push({phase:'构建或初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors},null,2));process.exitCode=1;});
