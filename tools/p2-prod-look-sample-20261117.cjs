'use strict';
/* 采样生产入口自然旅程的 (lg, CS.theta, CS.phi) 曲线，供候选的“衰减到正规取景”
 * 用生产实际观感作目标。只读页面。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-prod-look-'+randomUUID());
fs.mkdirSync(output);
const result={samples:[],errors:[]};
async function run(){
 const MIME={'.html':'text/html','.js':'text/javascript'};
 const server=http.createServer((req,res)=>{
   const p=path.join(root,'public',decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,''));
   if(!p.startsWith(path.join(root,'public'))||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 result.appSha=createHash('sha256').update(fs.readFileSync(path.join(root,'public/js/app.js'))).digest('hex');
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let src=fs.readFileSync(framework,'utf8');
 src=src.slice(0,src.indexOf('async function main() {'))
   .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{
  await launch();
  await load('http://127.0.0.1:${port}/index.html?auto=0&q=high&prewarm=0','http');
  await frames(3);
  await evaluate('window.__SE.journey(0);true');
  /* 每帧采样，直到 lg>=22.5 或超时 */
  const t0=Date.now();
  while(Date.now()-t0<120000){
    const s=await evaluate('({lg:__SE.journeyInfo.lg,cs:__SE.journeyInfo.cs,th:__SE.CS.theta,ph:__SE.CS.phi,r:__SE.CS.orbitR})');
    if(s.cs&&(!result.samples.length||s.lg-result.samples[result.samples.length-1].lg>0.01))result.samples.push(s);
    if(s.lg>=22.5)break;
  }
  await evaluate('__SE.journeyStop();true');
  result.status='complete';
 }catch(e){result.errors.push({phase,error:errorText(e)});result.status='failed';}
 finally{
  try{server.close();}catch(_){}
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}}browser&&browser.ws.close();
  fs.writeFileSync(path.join(output,'look.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({status:result.status,file:path.join(output,'look.json'),count:result.samples.length,
    head:result.samples.slice(0,3),tail:result.samples.slice(-3),errors:result.errors},null,2));
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,server,result){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,server,result);
}
run();
