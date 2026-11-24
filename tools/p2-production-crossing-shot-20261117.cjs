'use strict';
/* 生产源码入口（public/index.html，未插桩）在自然旅程跨层前后各取一帧截图，
 * 与候选预览同尺度帧对照。只读页面，不改产品文件。 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.workbuddy','p2-production-crossing-'+randomUUID());
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
 result.inputs={app:createHash('sha256').update(fs.readFileSync(path.join(root,'public/js/app.js'))).digest('hex'),
   html:createHash('sha256').update(fs.readFileSync(path.join(root,'public/index.html'))).digest('hex')};
 const framework=path.join(root,'tools/test-deep-models.cjs');
 let src=fs.readFileSync(framework,'utf8');
 src=src.slice(0,src.indexOf('async function main() {'))
   .replace("const profile = fs.mkdtempSync(path.join(parent, 'probe-deep-models-'));","const profile = fs.mkdtempSync(path.join(output, 'chrome-profile-'));");
 const driver=`(async()=>{try{
  await launch();
  await load('http://127.0.0.1:${port}/index.html?auto=0&q=high&prewarm=0','http');
  await frames(3);
  await evaluate('window.__SE.journey(0);true');
  await until('主场景 lg>=19.95',()=>evaluate('__SE.journeyInfo.cs===false&&__SE.journeyInfo.lg>=19.95'),180000);
  const before=await evaluate('({lg:__SE.journeyInfo.lg,theta:__SE.CS.theta,phi:__SE.CS.phi})');
  result.before=before;result.shots.push(await capture('p2-prod-main-1995'));
  await until('宇宙层 lg>=20.10',()=>evaluate('__SE.journeyInfo.cs===true&&__SE.journeyInfo.lg>=20.10'),180000);
  await frames(2);
  const after=await evaluate('({lg:__SE.journeyInfo.lg,theta:__SE.CS.theta,phi:__SE.CS.phi,r:__SE.CS.orbitR})');
  result.after=after;result.shots.push(await capture('p2-prod-cosmic-2010'));
  await evaluate('__SE.journeyStop();true');
  result.status='complete';
 }catch(e){result.errors.push({phase,error:errorText(e)});result.status='failed';}
 finally{
  try{server.close();}catch(_){}
  if(browser){try{cleanupPromise=Promise.resolve();await browser.send('Browser.close');}catch(_){}}browser&&browser.ws.close();
  result.driverErrors=report.errors;
  save();console.log(JSON.stringify({status:result.status,before:result.before,after:result.after,shots:result.shots.map(s=>s.file),errors:result.errors},null,2));
 }})();`;
 vm.runInThisContext(`(function(require,__dirname,__filename,process,Buffer,WebSocket,output,result,server,save){${src}\n${driver}\n})`,{filename:framework})(require,__dirname,framework,process,Buffer,WebSocket,output,result,server,save);
}
run();
