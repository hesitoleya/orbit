'use strict';
/* 调试 v5 在 lg=20.05 / 20.5 / 21.0 的相机—目标—银河位置关系。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-cand-view-debug-'+randomUUID());
fs.mkdirSync(output);
const probe=function(){
 const s=window.__SE,cs=s.CS,T=s.THREE;
 const n=new T.Vector3(Math.cos(cs.theta)*Math.cos(cs.phi),Math.sin(cs.phi),Math.sin(cs.theta)*Math.cos(cs.phi));
 const camPos=cs.target.clone().addScaledVector(n,cs.orbitR);
 const fwd=n.clone().negate();
 const toGal=camPos.clone().negate().normalize();
 return {lg:s.journeyInfo.lg,r:cs.orbitR,target:cs.target.toArray(),theta:cs.theta,phi:cs.phi,unit:cs.unit,
   camAbs:camPos.toArray(),distToGal:camPos.length(),angleFwdToGal:fwd.angleTo(toGal)*180/Math.PI,
   mwVisible:cs.mw.visible,mwRealVisible:cs.mwReal.visible,mwOpacity:cs.mwReal.material.opacity,
   mwScenePos:cs.mw.position.toArray(),fov:cs.cam.fov};
};
async function run(){
 const MIME={'.html':'text/html','.js':'text/javascript'};
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
  await load('http://127.0.0.1:${port}/p2-candidate-preview-v7.html?auto=0&q=high&prewarm=0','http');
  await frames(3);
  for(const lg of [20.05,20.5,21.0]){
    await evaluate('__SE.journeySeek(__P2_CANDIDATE__.cineTimeAtLg('+lg+'));true');await frames(3);
    console.log('VIEW',JSON.stringify(await evaluate('('+probe.toString()+')()')));
  }
 }catch(e){console.error('DBG-ERR',e.stack||String(e));}
 finally{
  try{server.close();}catch(_){}
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}}browser&&browser.ws.close();
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,server,probe){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,server,probe);
}
run();
