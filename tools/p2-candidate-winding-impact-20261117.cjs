'use strict';
/* 反射投影（P·S）对宇宙层网格的影响：候选 v4 与生产入口在 lg≈21（银河盘主导）
 * 各取一帧，并统计 CS.mw / mwReal / CMB 的材质面与可见性。只读。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-candidate-winding-'+randomUUID());
fs.mkdirSync(output);
const reportPath=path.join(output,'report.json'),result={errors:[],shots:[]};
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(result,null,2));
async function run(){
 const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
 const server=http.createServer((req,res)=>{
   const p=path.join(root,'public',decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''));
   if(!p.startsWith(path.join(root,'public'))||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 result.inputs={app:createHash('sha256').update(fs.readFileSync(path.join(root,'public/js/app.js'))).digest('hex')};
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let src=fs.readFileSync(framework,'utf8');
 src=src.slice(0,src.indexOf('async function main() {'))
   .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const matProbe=`(()=>{const s=window.__SE,cs=s.CS,T=s.THREE;
   const side=n=>n===T.FrontSide?'front':n===T.BackSide?'back':'double';
   const info=o=>o?{visible:o.visible,side:side(o.material&&o.material.side),type:o.type,matType:o.material&&o.material.type,opacity:o.material&&o.material.opacity}:null;
   return {mw:info(cs.mw),mwReal:info(cs.mwReal),cmb:info(cs.cmbMat&&cs.cmbMat.uniforms?cs.cmbMesh||null:null),cmbOn:!!s.CMB.on,active:cs.active,r:cs.orbitR};})()`;
 const driver=`(async()=>{try{
  await launch();
  /* 候选 v4：seek 到 lg≈21.0 */
  await load('http://127.0.0.1:${port}/p2-candidate-preview-v7.html?auto=0&q=high&prewarm=0','http');
  await frames(3);
  await evaluate('__SE.journeySeek(__P2_CANDIDATE__.cineTimeAtLg(21.0));true');await frames(4);
  result.candState=await evaluate('({lg:__SE.journeyInfo.lg,r:__SE.CS.orbitR,mat:'+matProbe+'})');
  result.shots.push(await capture('p2-cand-lg21'));
  result.candChecks=await evaluate('({errors:__P2_CANDIDATE__.errors.length,first:!!__P2_CANDIDATE__.first,completed:!!(__P2_CANDIDATE__.first&&__P2_CANDIDATE__.first.completed)})');
  /* 生产入口：同一 t */
  await load('http://127.0.0.1:${port}/index.html?auto=0&q=high&prewarm=0','http');
  await frames(3);
  await evaluate('window.__SE.journey(0);true');
  await until('生产 lg>=20.95',()=>evaluate('__SE.journeyInfo.cs===true&&__SE.journeyInfo.lg>=20.95'),180000);
  await frames(2);
  result.prodState=await evaluate('({lg:__SE.journeyInfo.lg,r:__SE.CS.orbitR,mat:'+matProbe+'})');
  result.shots.push(await capture('p2-prod-lg21'));
  await evaluate('__SE.journeyStop();true');
  result.status='complete';
 }catch(e){result.errors.push({phase,error:errorText(e)});result.status='failed';}
 finally{
  try{server.close();}catch(_){}
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}}browser&&browser.ws.close();
  result.driverErrors=report.errors;save();
  console.log(JSON.stringify({status:result.status,cand:result.candState,prod:result.prodState,shots:result.shots.map(s=>({file:s.file,mean:s.meanLuminance,nonblack:s.nonblackRatio})),errors:result.errors},null,2));
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,server,save,matProbe){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,server,save,matProbe);
}
run();
