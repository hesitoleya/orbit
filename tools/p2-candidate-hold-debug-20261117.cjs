'use strict';
/* 调试：candidateHold=1 时旅程是否在首帧后冻结。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-candidate-hold-debug-'+randomUUID());
fs.mkdirSync(output);
const result={errors:[]};
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
  await load('http://127.0.0.1:${port}/p2-candidate-preview-v3.html?auto=0&q=high&prewarm=0&candidateHold=1','http');
  await evaluate('window.__SE.journey(0);true');
  await until('候选首帧完成',()=>evaluate('!!(window.__P2_CANDIDATE__.first&&window.__P2_CANDIDATE__.first.completed)'),180000);
  const s0=await evaluate('({lg:__SE.journeyInfo.lg,theta:__SE.CS.theta,phi:__SE.CS.phi,r:__SE.CS.orbitR,frame:__P2_CANDIDATE__.first.frame})');
  await new Promise(r=>setTimeout(r,1500));
  const s1=await evaluate('({lg:__SE.journeyInfo.lg,theta:__SE.CS.theta,phi:__SE.CS.phi,r:__SE.CS.orbitR})');
  console.log('FREEZE-DEBUG',JSON.stringify({s0,s1,dlg:s1.lg-s0.lg,dtheta:s1.theta-s0.theta}));
 }catch(e){console.error('DBG-ERR',e.stack||String(e));}
 finally{
  try{server.close();}catch(_){}
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}}browser&&browser.ws.close();
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,server){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,server);
}
run();
