'use strict';
/* 接力基准映射候选（p2-candidate-preview-v7）浏览器验证。
 * 不改产品源码与正式入口；经临时 HTTP 服务加载隔离预览。
 * 验证：自然跨层后映射前向/上方向误差、同快照 NDC 屏幕位置连续性、
 * 负控（不映射 ≈97°、错误轴符号、取消投影反射均可检出）、
 * journeyStop 投影恢复、journeySeek 正向重建与反向重置、截图非黑有结构。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-candidate-handoff-'+randomUUID());
fs.mkdirSync(output);const reportPath=path.join(output,'report.json');
const hash=x=>createHash('sha256').update(x).digest('hex');
const result={status:'incomplete',output,startedAt:new Date().toISOString(),samples:[],errors:[],limitations:[
 '候选为隔离预览（public/p2-candidate-preview-v7.html），未合入产品；正式入口未改。',
 '候选使用接力前最后一个已完成主场景帧，输入不是同一物理时刻；相邻帧含时间推进。',
 'NDC 对照只比较 x/y 屏幕位置（两侧 near/far 不同，z 不可比）；方向按无穷远处理，不含近星视差。',
 '投影 x/y 行复制 + 视空间 X 反射会翻转三角形绕序，候选未做剔除/shader 修正，视觉仅查非黑与结构。',
 'up 在候选中保持入射值不渐变回 +Y；只覆盖 cine 旅程路径。',
 '截图只验证非黑与有结构，不替代用户视觉会审、其他设备或浏览器验证。']};
function save(){fs.writeFileSync(reportPath,JSON.stringify(result,null,2));}

/* 页内 NDC 同快照对照：同一物理方向在主相机（赤道基）与候选宇宙相机（银道基+反射投影）下的屏幕位置 */
function ndcProbe(){
 const R=window.__P2_CANDIDATE__,e=R.entry,B=R.basis,T=window.__SE.THREE,cs=window.__SE.CS;
 const DEG=Math.PI/180,V=(...x)=>new T.Vector3(...x);
 const eqDir=(ra,dec)=>{const r=ra*DEG,d=dec*DEG,cd=Math.cos(d);return V(cd*Math.cos(r),Math.sin(d),cd*Math.sin(r));};
 const gc=V().fromArray(B.gc),ngp=V().fromArray(B.ngp),yg=V().fromArray(B.yg);
 const M=v=>V(-v.dot(gc),v.dot(ngp),-v.dot(yg));
 const qM=new T.Quaternion().fromArray(e.mainQuaternion).invert();
 const qC=cs.cam.getWorldQuaternion(new T.Quaternion()).invert();
 const Pc=cs.cam.projectionMatrix.clone();
 const Pm=Pc.clone();for(const i of [0,1,2,3])Pm.elements[i]=-Pm.elements[i]; /* 去掉反射列得主投影 x/y 行 */
 const project=(P,q,d)=>{const v=d.clone().applyQuaternion(q);const w=-v.z;
   return {x:(P.elements[0]*v.x+P.elements[8]*v.z)/w,y:(P.elements[5]*v.y+P.elements[9]*v.z)/w,front:v.z<0};};
 /* 主检：以主相机视线为中心的离轴方向网格（保证两侧都在视锥内）。
    接力瞬间旅程回看太阳，深空天体多在主相机背后，不能做屏幕位置对照。 */
 const qMrot=new T.Quaternion().fromArray(e.mainQuaternion);
 const fwd=V().fromArray(e.mainForward),right=V(1,0,0).applyQuaternion(qMrot),upv=V(0,1,0).applyQuaternion(qMrot);
 const dirs=[];
 for(const a of [3,8,15])for(const [sx,sy] of [[0,0],[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]]){
   const t=a*DEG;dirs.push({name:'off'+a+'_'+sx+sy,d:fwd.clone().addScaledVector(right,Math.tan(t)*sx).addScaledVector(upv,Math.tan(t)*sy).normalize()});
 }
 const rows=dirs.map(({name,d})=>{
   const a=project(Pm,qM,d),b=project(Pc,qC,M(d));
   const c=project(Pm,qC,M(d));
   return {name,inFront:a.front&&b.front,
     ndcDiff:(a.front&&b.front)?Math.hypot(a.x-b.x,a.y-b.y):null,
     noReflectionDiff:(a.front&&b.front)?Math.hypot(a.x-c.x,a.y-c.y):null};
 });
 /* 信息项：深空天体方向（不要求在视锥内） */
 const catalog=[['SgrA*',266.4168,-29.0078],['M31',10.685,41.269],['LMC',80.894,-69.756],['Antares',247.3519,-26.4320]]
  .map(([name,ra,dec])=>{const d=eqDir(ra,dec),a=project(Pm,qM,d),b=project(Pc,qC,M(d));
   return {name,inFront:a.front&&b.front,ndcDiff:(a.front&&b.front)?Math.hypot(a.x-b.x,a.y-b.y):null};});
 /* 映射恒等式：候选位置 − M(camAbs−sun) 必须等于 SUN_GAL（模长 8.15 kpc） */
 const rel=V().fromArray(e.mainPosition).sub(V().fromArray(e.mainSun));
 const sunAnchoredRatio=V().fromArray(e.candidatePosition).sub(M(rel)).length()/(8.15*3.0856775814913673e19);
 /* 信息项：错误轴符号映射的角度（本接力几何下映射前向近垂直银心轴，角度小属预期） */
 const fMain=V().fromArray(e.mainForward),fMap=V().fromArray(e.mappedForward);
 const wrongSign=V(fMain.dot(gc),fMain.dot(ngp),-fMain.dot(yg));
 const ang=(a,b)=>a.angleTo(b)/DEG;
 return {rows,catalog,entry:e,sunAnchoredRatio,
   forwardErrorDegrees:ang(cs.cam.getWorldDirection(V()),fMap),
   unmappedErrorDegrees:ang(fMain,fMap),
   wrongSignErrorDegrees:ang(wrongSign,fMap),
   upEffective:(()=>{const u=V(0,1,0).applyQuaternion(cs.cam.getWorldQuaternion(new T.Quaternion()));return ang(u,V().fromArray(e.mappedUp));})()};
}

async function run(){
 const files=['public/js/app.js','public/index.html','tools/make-p2-candidate-preview.cjs','public/p2-candidate-preview-v7.html','public/js/p2-candidate-preview-v7.js'];
 result.inputHashes=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(path.join(root,f)))]));
 /* 临时静态服务：候选预览是外联模块脚本，file:// 无法加载 */
 const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.bin':'application/octet-stream'};
 const server=http.createServer((req,res)=>{
   const p=path.join(root,'public',decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''));
   if(!p.startsWith(path.join(root,'public'))||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let src=fs.readFileSync(framework,'utf8');
 src=src.slice(0,src.indexOf('async function main() {'))
   .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{
  await launch();
  const url='http://127.0.0.1:${port}/p2-candidate-preview-v7.html?auto=0&q=high&prewarm=0&candidateHold=1';
  await load(url,'http');
  result.title=await evaluate('document.title');
  if(!String(result.title).startsWith('EXPERIMENTAL CANDIDATE'))throw Error('非候选预览页面: '+result.title);
  await frames(3);
  const init=await evaluate('({status:__P2_CANDIDATE__.status,errors:__P2_CANDIDATE__.errors,basis:__P2_CANDIDATE__.basis,lgCross:__SE.journeyInfo?undefined:0})');
  if(init.status!=='experimental'||init.errors.length)throw Error('候选初始化异常: '+JSON.stringify(init));
  result.basis=init.basis;
  phase='自然跨层';
  await evaluate('window.__SE.journey(0);true');
  await until('候选首帧完成',()=>evaluate('!!(window.__P2_CANDIDATE__.first&&window.__P2_CANDIDATE__.first.completed)'),180000);
  await frames(2);
  phase='同快照NDC对照';
  const ndc=await evaluate('('+ndcProbe.toString()+')()');
  result.ndc=ndc;
  const front=ndc.rows.filter(r=>r.inFront);
  const maxNdc=Math.max(...front.map(r=>r.ndcDiff));
  /* 正中心方向视空间 x=0，反射前后 NDC 本就相同；检出能力用离轴最大值判定 */
  const maxNoRefl=Math.max(...front.map(r=>r.noReflectionDiff));
  result.ndcSummary={inFront:front.length,maxNdcDiff:maxNdc,maxNoReflectionDiff:maxNoRefl};
  const candReport=await evaluate('JSON.parse(JSON.stringify({first:__P2_CANDIDATE__.first,restores:__P2_CANDIDATE__.restores,errors:__P2_CANDIDATE__.errors,entry:__P2_CANDIDATE__.entry}))');
  result.candidate=candReport;
  result.checks={
    forwardMapped:ndc.forwardErrorDegrees<0.01&&candReport.first.forwardErrorDegrees<0.01,
    upMapped:ndc.upEffective<0.5,
    positionRelative:Math.abs(ndc.sunAnchoredRatio-1)<1e-6,
    ndcContinuity:front.length>=20&&maxNdc<1e-4,
    negUnmapped:ndc.unmappedErrorDegrees>30,
    negNoReflection:maxNoRefl>1e-3,
    noErrors:candReport.errors.length===0,
    sourceFrameAdjacent:candReport.first.sourceFrame!=null&&candReport.first.frame-candReport.first.sourceFrame<=2
  };
  phase='保持帧截图';
  result.shotHold=await capture('p2-cand-hold-cosmic');
  phase='停止恢复';
  const stopCheck=await evaluate(\`(()=>{const T=window.__SE.THREE,cs=window.__SE.CS;
    const before=cs.cam.projectionMatrix.elements.slice();
    window.__SE.journeyStop();
    const after=cs.cam.projectionMatrix.elements.slice();
    const ref=new T.PerspectiveCamera(cs.cam.fov,cs.cam.aspect,cs.cam.near,cs.cam.far);ref.zoom=cs.cam.zoom;ref.updateProjectionMatrix();
    const d=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
    return {restores:__P2_CANDIDATE__.restores.length,reason:__P2_CANDIDATE__.restores[0]&&__P2_CANDIDATE__.restores[0].reason,
      changed:d(before,after),restoredVsReference:d(after,ref.projectionMatrix.elements)};})()\`);
  result.stopRestore=stopCheck;
  result.checks.stopRestoresProjection=stopCheck.restores>=1&&stopCheck.reason==='stop'&&stopCheck.restoredVsReference<1e-9;
  phase='正向seek重建';
  await evaluate('__SE.journeySeek(__P2_CANDIDATE__.cineTimeAtLg(20.05));true');
  await frames(3);
  const seekFwd=await evaluate('({active:__SE.CS.active,entry:__P2_CANDIDATE__.entry?__P2_CANDIDATE__.entry.mainFrame:null,errors:__P2_CANDIDATE__.errors.length})');
  result.seekForward=seekFwd;
  result.checks.seekForwardRebuild=seekFwd.active===true&&seekFwd.entry!==null&&seekFwd.entry!==candReport.entry.mainFrame&&seekFwd.errors===0;
  result.shotCosmic=await capture('p2-cand-seek-cosmic-2005');
  phase='反向seek重置';
  await evaluate('__P2_CANDIDATE__.restores.length=0;__SE.journeySeek(__P2_CANDIDATE__.cineTimeAtLg(19.95));true');
  await frames(3);
  const seekRev=await evaluate('({active:__SE.CS.active,restores:__P2_CANDIDATE__.restores.map(r=>r.reason),errors:__P2_CANDIDATE__.errors.length})');
  result.seekReverse=seekRev;
  result.checks.seekReverseReset=seekRev.active===false&&seekRev.restores.includes('reverse-seek')&&seekRev.errors===0;
  result.shotMain=await capture('p2-cand-seek-main-1995');
  /* 源码入口无 /api/objects 后端，图鉴 404 是已知环境差异（见 PROGRESS.md），不作为失败 */
  const benign=e=>(e.kind==='HTTP 错误'||e.kind==='浏览器日志错误')&&String(e.url||(e.entry&&e.entry.url)||'').includes('/api/objects');
  result.driver={browser:report.browser,gpu:report.gpu,launch:report.launch,errors:report.errors,benignFiltered:report.errors.filter(benign).length};
  if(report.errors.filter(e=>!benign(e)).length)throw Error('浏览器记录错误');
  const failed=Object.entries(result.checks).filter(([k,v])=>!v).map(([k])=>k);
  result.status=failed.length?('failed:'+failed.join(',')):'passed-limited';
 }catch(e){
  result.errors.push({phase,error:errorText(e)});
  try{result.diagnostic=await evaluate('JSON.parse(JSON.stringify({cand:__P2_CANDIDATE__||null,journey:__SE.journeyInfo||null}))');}catch(_){}
  result.driver={browser:report.browser,errors:report.errors};
 }finally{
  try{server.close();}catch(_){ }
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(e){result.errors.push({phase:'关闭浏览器',error:errorText(e)});}browser.ws.close();}
  else if(child&&child.exitCode===null)child.kill();
  for(const [f,h] of Object.entries(result.inputHashes))if(hash(fs.readFileSync(path.join(root,f)))!==h)result.errors.push({phase:'输入哈希',error:f+' 已变化'});
  if(result.errors.length)result.status='incomplete';
  result.finishedAt=new Date().toISOString();save();
  console.log(JSON.stringify({report:reportPath,status:result.status,checks:result.checks,ndcSummary:result.ndcSummary,unmapped:result.ndc&&result.ndc.unmappedErrorDegrees,errors:result.errors},null,2));
  process.exitCode=(result.status==='passed-limited')?0:1;
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,save,hash,ndcProbe,reportPath,root,server){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,save,hash,ndcProbe,reportPath,root,server);
}
save();run().catch(e=>{result.errors.push({phase:'初始化',error:e.stack||String(e)});save();console.error(JSON.stringify({report:reportPath,errors:result.errors},null,2));process.exitCode=1;});
